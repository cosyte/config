/**
 * Guards `@cosyte/script-utils/phi-scan`: the shared machinery every `@cosyte/*` PHI scanner now
 * depends on instead of copying.
 *
 * WHY THIS FILE IS NOT `test/phi-scan-scaffold.test.ts`. That suite runs the REAL scaffolder and
 * drives the EMITTED scanner as a subprocess, which is the right shape for the rules that only make
 * sense against a real repository and a real index, and it is where every previously-closed escape
 * stays pinned. This one drives `runPhiScan` IN PROCESS, because the engine returns an exit code
 * rather than calling `process.exit`, and covers what became newly expressible when the machinery
 * became a parameterised library:
 *
 *   - the CONFIGURATION contract, which did not exist while every repo hard-coded its own constants;
 *   - the ordering guarantee around a fatal that happens PARTWAY THROUGH the sweep;
 *   - the floor's allow-list consultation, which is a correction rather than a port;
 *   - whole-repository scan roots, which is what closes the hole a fresh scaffold was born with.
 *
 * SECURITY / PHI: every payload here is synthetic and lives only in a throwaway temp directory.
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESERVED_SPACES, exemptsMarkdown, runPhiScan } from "@cosyte/script-utils/phi-scan";

/** The engine's own file URL, so a subprocess can import exactly the copy this suite drives. */
const ENGINE_URL = new URL("../packages/script-utils/phi-scan.js", import.meta.url).href;

/** A synthetic dashed identifier the floor detects, and its undashed rendering. */
const SSN = "123-45-6789";
const SSN_DIGITS = "123456789";

const CODES = { clean: 0, hits: 1, refuse: 2 } as const;

let repo: string;

function git(args: string[], cwd = repo): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function write(rel: string, content: string): void {
  const abs = join(repo, ...rel.split("/"));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/**
 * Run the engine and collect everything it wrote. The engine returns its code rather than exiting,
 * which is the whole reason this suite can exist in process.
 */
function run(config: Partial<Parameters<typeof runPhiScan>[0]> & { argv?: string[] } = {}): {
  code: number;
  out: string;
} {
  let out = "";
  const sink = (chunk: unknown): boolean => {
    out += String(chunk);
    return true;
  };
  const err = vi.spyOn(process.stderr, "write").mockImplementation(sink);
  const std = vi.spyOn(process.stdout, "write").mockImplementation(sink);
  try {
    const code = runPhiScan({
      repoRoot: repo,
      argv: [],
      exitCodes: CODES,
      scanRoots: ["."],
      ...config,
    });
    return { code, out };
  } finally {
    err.mockRestore();
    std.mockRestore();
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "phi-scan-engine-"));
  // The allow-list the engine looks for by default, with one reserved domain declared.
  write("scripts/phi-allow-list.txt", "EMAILDOMAIN example.com\n");
  write(".gitignore", "node_modules/\n");
  git(["init", "-q", "."]);
  git(["config", "user.email", "probe@example.com"]);
  git(["config", "user.name", "probe"]);
  git(["config", "commit.gpgsign", "false"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Stage everything and commit, so `all` mode has an index to union with. */
function commitAll(): void {
  git(["add", "-A"]);
  expect(git(["commit", "-qm", "corpus", "--no-verify"]).code).toBe(0);
}

describe("the configuration contract refuses to be inherited by accident", () => {
  // A MISCONFIGURED SCANNER MUST NOT BE ABLE TO REPORT CLEAN. Each of these throws rather than
  // returning a code, because at the point a required axis is missing there is no trustworthy code
  // to return: `exitCodes` is itself the thing that was not supplied.

  it("REQUIRES the exit codes, because the siblings do not agree on them", () => {
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        scanRoots: ["."],
      } as unknown as Parameters<typeof runPhiScan>[0]),
    ).toThrow(/exitCodes` is REQUIRED/);
  });

  it("REFUSES three codes that are not three different numbers", () => {
    // A caller has to be able to tell "PHI was found here" from "this scan is not trustworthy".
    // Collapsing them makes the second read as the first, which is the failure the whole exit
    // contract exists to prevent.
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: { clean: 0, hits: 2, refuse: 2 },
        scanRoots: ["."],
      }),
    ).toThrow(/three DIFFERENT numbers/);
  });

  it("REQUIRES the scan roots, which have no safe default in either direction", () => {
    // Five repos need the whole repository; two measured that the whole repository makes them exit
    // on their own manifest's author address; five more measured that copying a sibling's narrow
    // roots silently dropped tracked files the index union had been reading. So there is no value
    // this engine could pick that is not wrong somewhere, and it declines to pick one.
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
      } as unknown as Parameters<typeof runPhiScan>[0]),
    ).toThrow(/scanRoots` is REQUIRED/);
  });

  it("REFUSES the retired `isStagedReadable` rather than ignoring it", () => {
    // A parameter the engine no longer reads must not be accepted in silence: a repo carrying one
    // forward would have its `--staged` scope quietly become something else. This is the same
    // class as the allow-list's old `default: break`.
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        scanRoots: ["."],
        isStagedReadable: exemptsMarkdown,
      } as unknown as Parameters<typeof runPhiScan>[0]),
    ).toThrow(/`isStagedReadable` has been replaced by `stagedRoots`/);
  });

  it("REFUSES the retired `isWalkReadable`, whose DEFAULT also changed under it", () => {
    // Renaming it silently would be worse than dropping it: a repo that had relied on the old
    // default would keep the old spelling, get the new default, and read more than it declared
    // (or, had the flip gone the other way, less).
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        scanRoots: ["."],
        isWalkReadable: exemptsMarkdown,
      } as unknown as Parameters<typeof runPhiScan>[0]),
    ).toThrow(/`isWalkReadable` is now `isReadable`/);
  });

  it("READS Markdown BY DEFAULT, and the exemption is an explicit opt-in", () => {
    // 🛑 THE DEFAULT IS FLIPPED FROM 0.0.2, AND THIS IS THE FIX FOR THE MEASURED DEFECT. The old
    // default exempted Markdown on both sweeping routes, so a tracked `.md` was read by neither
    // while `README.md` and `CHANGELOG.md` ship inside the npm tarball. Pinned in BOTH directions,
    // so neither the default nor the opt-in can go vacuous.
    write("test/fixtures/notes.md", `ssn ${SSN}\n`);
    write("test/fixtures/data.txt", "nothing to see\n");
    commitAll();

    const byDefault = run();
    expect(byDefault.code).toBe(1);
    expect(byDefault.out).toContain("test/fixtures/notes.md");

    // The old behaviour is still reachable, but only by declaring it.
    expect(run({ isReadable: exemptsMarkdown }).code).toBe(0);
  });

  it("READS a Markdown FILE ROOT, which used to report clean over a live identifier", () => {
    // 🛑 THE HEADLINE DEFECT OF THIS SLICE, PINNED. Under 0.0.2 a `README.md` scan root went through
    // the shared Markdown read exemption, read NOTHING, and returned `OK: no hits` at exit 0 over a
    // live dashed identifier, a PHI gate reporting clean while opening no file, reachable by
    // default. A declared FILE root now bypasses the read filter entirely, because naming a file as
    // a root is the same explicit act as naming it on the command line.
    write("README.md", `ssn ${SSN}\n`);
    write("src/a.ts", "nothing to see\n");
    commitAll();

    const r = run({ scanRoots: [{ rel: "README.md", shape: "file" }] });
    expect(r.code).toBe(1);
    expect(r.out).toContain("README.md");

    // AND IT SURVIVES THE OPT-IN. A repo that declares the Markdown exemption for its SWEEP must
    // still read a file it named as a root, or the defect comes straight back through the override.
    const exempted = run({
      scanRoots: [{ rel: "README.md", shape: "file" }],
      isReadable: exemptsMarkdown,
    });
    expect(exempted.code).toBe(1);
    expect(exempted.out).toContain("README.md");
  });
});

describe("the cross-cutting floor answers to the allow-list on BOTH branches", () => {
  // THE SSN BRANCH CONSULTING THE ALLOW-LIST IS A CORRECTION, NOT A PORT. A sibling's reviewer
  // measured that its dashed-SSN branch consulted nothing while its footer claimed the token
  // allow-list was the only remedy that reaches a clean run. With the whole-file bypass closed, a
  // developer meeting that branch had no remedy at all.

  it("catches a dashed identifier and an email at an undeclared domain", () => {
    write("test/fixtures/bad.txt", `ssn ${SSN} and mail person@clinic.invalid\n`);
    commitAll();
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("(ssn)");
    expect(r.out).toContain("(email)");
  });

  it("honours an ID declaration in EITHER rendering, so one entry covers both", () => {
    write("test/fixtures/bad.txt", `ssn ${SSN}\n`);
    commitAll();
    expect(run().code).toBe(1);

    write("scripts/phi-allow-list.txt", `EMAILDOMAIN example.com\nID ${SSN}\n`);
    expect(run().code).toBe(0);

    write("scripts/phi-allow-list.txt", `EMAILDOMAIN example.com\nID ${SSN_DIGITS}\n`);
    expect(run().code).toBe(0);
  });

  it("says only what it can know in the hit footer", () => {
    // THE FOOTER IS SCOPED TO THIS ENGINE'S OWN DETECTORS. It cannot claim the allow-list answers
    // every hit, because a repo's `detect` may raise one without consulting it, and a sibling
    // shipped exactly that wider claim and had it refuted. It also must not advertise
    // `--allow-fixture`, which leads to a refusal rather than to the clean run it would promise.
    write("test/fixtures/bad.txt", `ssn ${SSN}\n`);
    commitAll();
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/phi-allow-list.txt");
    expect(r.out).toContain("REFUSED");
    expect(r.out).not.toMatch(/run with --allow-fixture/);
    // The scoped clause: it names the condition rather than asserting the remedy always works.
    expect(r.out).toContain("only if that detector");
  });
});

describe("a per-standard detector is handed the locus, and cannot take down the exit contract", () => {
  it("receives the ORIGIN-LABELLED locus for a hit the union found", () => {
    // The rule that used to be a sentence in a comment ("report against `locus`, not `target.path`")
    // is now the only path a caller can reach: `ctx.hit` fills the locus in.
    write("test/fixtures/tracked.txt", "the tracked bytes\n");
    commitAll();
    writeFileSync(
      join(repo, "test", "fixtures", "tracked.txt"),
      "the working-tree bytes\n",
      "utf8",
    );

    const seen: string[] = [];
    const r = run({
      detect: (ctx) => {
        seen.push(ctx.path);
        if (ctx.text.includes("tracked bytes")) {
          ctx.hit({ segment: "(demo)", value: "tracked bytes", reason: "detector saw the blob" });
        }
      },
    });
    expect(r.code).toBe(1);
    // Both copies were offered to the detector, and only the union's carries the label.
    expect(seen).toContain("test/fixtures/tracked.txt");
    expect(seen).toContain("test/fixtures/tracked.txt (as git carries it)");
    expect(r.out).toContain("HIT: test/fixtures/tracked.txt (as git carries it)");
  });

  it("REFUSES when a detector throws, rather than taking node's own exit code", () => {
    // A per-standard parser meeting input it cannot handle is an ordinary event, and the code node
    // would pick for an uncaught throw is the one this contract reserves for HITS FOUND.
    write("test/fixtures/a.txt", "nothing to see\n");
    commitAll();
    const r = run({
      detect: () => {
        throw new Error("the parser gave up");
      },
    });
    expect(r.code).toBe(2);
    expect(r.out).toContain("field detector threw");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("PRINTS THE HITS IT ALREADY FOUND before refusing partway through the sweep", () => {
    // THE ORDERING IS A DECISION, NOT AN ACCIDENT OF CONTROL FLOW, and it is a change from the
    // copied scanners. A refuter measured the old shape: a fatal partway through the sweep threw
    // away every hit found before it, so a consumer saw a refusal with no indication that PHI had
    // already been found. The refusal still wins the exit code and the clean line is still
    // unreachable, so nothing is reported as accounted for that is not; what changed is that a
    // finding already made is not discarded.
    write("test/fixtures/a-hit.txt", `ssn ${SSN}\n`);
    write("test/fixtures/b-boom.txt", "detonate\n");
    commitAll();

    const r = run({
      detect: (ctx) => {
        if (ctx.text.includes("detonate")) throw new Error("the parser gave up");
      },
    });
    expect(r.code).toBe(2);
    expect(r.out).toContain(SSN); // the hit survived the fatal
    expect(r.out).toContain("test/fixtures/a-hit.txt");
    expect(r.out).toContain("field detector threw");
    expect(r.out).not.toContain("OK: no hits");

    // ANTI-VACUITY: the ordering is what is being measured, so the hit has to come first in the
    // stream rather than merely be present somewhere in it.
    expect(r.out.indexOf(SSN)).toBeLessThan(r.out.indexOf("field detector threw"));
  });
});

describe("the two containments a reviewer falsified, now enforced rather than asserted", () => {
  // BOTH OF THESE WERE PROSE BEFORE THEY WERE CODE, AND BOTH WERE FALSE. The `.d.ts` said
  // `isStagedReadable` was "narrower than the root half by construction" and nothing constructed it;
  // `normalizeConfig` said a misconfigured scanner could not report clean and a root spelling its own
  // type documents as valid did exactly that. Each reproduction below is the reviewer's, kept as the
  // regression rather than paraphrased.

  it("cannot be given a `--staged` scope outside the scan roots AT ALL", () => {
    // THE MEASURED HOLE, AND THE REPAIR IS STRUCTURAL RATHER THAN A NEW RUNTIME CHECK. With roots at
    // `["src"]` and the old `isStagedReadable` predicate at the shared Markdown exemption, a STAGED
    // symbolic link under `test/fixtures/` was outside every scan root, so the non-regular refusal
    // never saw it. The route then enumerated it, READ it, handed the link's TARGET PATH to the
    // detector as if it were content, counted the scan complete, and printed `OK: no hits` at exit
    // 0. A predicate and a root list were two independent keys with nothing relating them.
    //
    // `stagedRoots` is a second declared LIST, so the containment is a comparison the engine can
    // make before any file is opened. It REFUSES rather than narrowing silently to the
    // intersection: narrowing would hide a misconfiguration in the one place this gate blocks a
    // commit.
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: ["--staged"],
        exitCodes: CODES,
        scanRoots: ["src"],
        stagedRoots: ["test/fixtures"],
      }),
    ).toThrow(/covered by no scan root/);
  });

  it("still refuses a staged link INSIDE the roots, with the mode's own noun", () => {
    // The other side of the same boundary, and it is the anti-vacuity half: making the misconfigured
    // shape unreachable must not also disarm the check for the shape that IS configurable. A staged
    // link under a covered root is refused on its mode, before any read.
    const outside = join(repo, "..", "phi-scan-engine-staged-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      // STAGED but not committed, so `git diff --cached` has a record to read.
      mkdirSync(join(repo, "test", "fixtures"), { recursive: true });
      symlinkSync(outside, join(repo, "test", "fixtures", "link.txt"));
      git(["add", "-A"]);

      // The git premise first: the staged record really is a mode-120000 entry at that path.
      expect(git(["diff", "--cached", "--raw", "--no-renames"]).out).toContain("120000");

      const seen: string[] = [];
      const r = run({
        argv: ["--staged"],
        scanRoots: ["."],
        detect: (ctx) => seen.push(ctx.path),
      });
      expect(r.code, r.out).toBe(2);
      expect(r.out).toContain("test/fixtures/link.txt");
      expect(r.out).toContain("a symbolic link");
      expect(r.out).not.toContain("OK: no hits");
      // The refusal fires BEFORE the read, so the link's target never reached a detector, and the
      // target path is never echoed: it is working-tree text that can itself carry PHI.
      expect(seen).toEqual([]);
      expect(r.out).not.toContain("phi-scan-engine-staged-target");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("NORMALISES a scan root, so `./src` and `src` are one root and both match the index", () => {
    // THE MEASURED HOLE. `./src` is a spelling the type documents as valid. The walk resolved it
    // fine; `isUnderScanRoot` compared the NORMALIZED index path `src/link.ts` against the literal
    // `"./src"` and never matched, so the union, the index non-blob refusal and the unmerged refusal
    // all went silently empty and the sweep printed `OK: no hits` at exit 0 over a tracked
    // mode-120000 entry.
    const outside = join(repo, "..", "phi-scan-engine-root-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      mkdirSync(join(repo, "src"), { recursive: true });
      symlinkSync(outside, join(repo, "src", "link.ts"));
      commitAll();
      expect(git(["ls-files", "-s", "--", "src/link.ts"]).out).toContain("120000");

      for (const roots of [["src"], ["./src"], ["src/"], [join(repo, "src")]]) {
        const r = run({ scanRoots: roots });
        expect(r.code, `${JSON.stringify(roots)}: ${r.out}`).toBe(2);
        expect(r.out).toContain("src/link.ts");
      }
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("REFUSES a scan root that resolves outside the repository", () => {
    // Same silently-empty class by another spelling: no path git can name is under it.
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        scanRoots: ["../elsewhere"],
      }),
    ).toThrow(/resolves outside the repository/);
  });

  it("REFUSES an optional axis of the wrong shape, instead of throwing from inside enumeration", () => {
    // `excludedPaths: ["a"]` is a plausible reading of "repo-relative paths". It used to survive
    // normalization, reach `.has(...)` inside enumeration, and take node's exit 1 from there, which
    // this contract reserves for HITS FOUND.
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        scanRoots: ["."],
        excludedPaths: ["a"] as unknown as ReadonlySet<string>,
      }),
    ).toThrow(/excludedPaths` must be a Set/);
  });
});

describe("whole-repository scan roots, which is what a fresh scaffold needs", () => {
  it("reads a tracked file no narrow root would have covered", () => {
    // The measured hole: with `["test/fixtures", "src"]` a scaffold had ONE of its tracked files in
    // scope, so a tracked test carrying a dashed identifier exited 0. Both polarities are asserted
    // here, so the widening is shown to be the cause.
    write("test/leak.test.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    // 🛑 THE NARROW ROOTS NOW REFUSE RATHER THAN REPORTING CLEAN, and that is the per-root
    // observation tier, not the corpus. `test/fixtures` is declared and yields nothing read, which
    // is indistinguishable from a root that was never there. Under 0.0.2 this same configuration
    // printed `OK: no hits` at exit 0 over the tracked violator below.
    const narrow = run({ scanRoots: ["test/fixtures", "src"] });
    expect(narrow.code, narrow.out).toBe(2);
    expect(narrow.out).toContain("test/fixtures");
    expect(narrow.out).not.toContain("OK: no hits");

    // The old silent-clean shape is still reachable, but only by DECLARING that the root may be
    // empty, and even then the violator outside the roots is still not read, which is the scope
    // decision this test is really about.
    const declared = run({
      scanRoots: [{ rel: "test/fixtures", require: false }, "src"],
    });
    expect(declared.code, declared.out).toBe(0);
    expect(declared.out).not.toContain("test/leak.test.ts");

    const wide = run();
    expect(wide.code).toBe(1);
    expect(wide.out).toContain("test/leak.test.ts");
  });

  it("PRUNES an ignored directory during descent instead of walking it", () => {
    // Without pruning, `["."]` descends into `node_modules`, which is the reason a whole-repository
    // root would otherwise be unusable. Equivalent to filtering afterwards, because git cannot
    // re-include a path under an excluded directory, and measured rather than argued: a violator
    // planted inside the ignored directory is not reported.
    write("node_modules/pkg/leak.txt", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(SSN);
  });

  it("PRUNES ONLY WHAT THE FILE FILTER WOULD HAVE DROPPED: a TRACKED file under an ignored dir is still read", () => {
    // THE DANGEROUS DIRECTION, and the case above does not measure it: planting a violator in an
    // ignored directory shows that pruning HAPPENS, not that it is safe. What carries the
    // equivalence is that `git check-ignore` is INDEX-AWARE AT DIRECTORY GRANULARITY, so the premise
    // is measured from git rather than argued from the gitignore pattern rules.
    write("node_modules/pkg/tracked.txt", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    git(["add", "-f", "--", "node_modules/pkg/tracked.txt"]);
    commitAll();

    // The premise, both ways round, from git's own answer:
    expect(git(["check-ignore", "--", "node_modules"]).code).not.toBe(0); // NOT ignored: tracked inside
    expect(git(["check-ignore", "--", "node_modules/pkg/tracked.txt"]).code).not.toBe(0);

    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("node_modules/pkg/tracked.txt");

    // ...and the contrast, so the pin is a discrimination rather than one observation: untrack it
    // and the same directory IS reported ignored, is pruned, and the file is not read.
    git(["rm", "-q", "--cached", "--", "node_modules/pkg/tracked.txt"]);
    expect(git(["check-ignore", "--", "node_modules"]).code).toBe(0);
    const pruned = run();
    expect(pruned.code, pruned.out).toBe(0);
    expect(pruned.out).not.toContain(SSN);
  });

  it("SKIPS `.git` by name, which git does not report as ignored", () => {
    // git's own object store is not the corpus, and `check-ignore` says nothing about it, so the
    // skip is a literal directory name rather than a predicate. The premise is measured first: git
    // does not call this path ignored.
    const check = git(["check-ignore", "--", ".git/leak.txt"]);
    expect(check.code).not.toBe(0);

    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    writeFileSync(join(repo, ".git", "leak.txt"), `ssn ${SSN}\n`, "utf8");
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(SSN);
  });

  it("still refuses a non-regular entry anywhere in the repository, not just under a corpus dir", () => {
    // The widening applies to the ROOT half of scope too, so a link outside what used to be a scan
    // root is now the scan's business. The refusal never names the target, which is working-tree
    // text that can itself carry PHI.
    const outside = join(repo, "..", "phi-scan-engine-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      symlinkSync(outside, join(repo, "tools-link.txt"));
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      const r = run();
      expect(r.code, r.out).toBe(2);
      expect(r.out).toContain("tools-link.txt");
      expect(r.out).toContain("a symbolic link");
      expect(r.out).not.toContain(SSN);
      expect(r.out).not.toContain("phi-scan-engine-target");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("SCANS a root that names a regular FILE, instead of crashing on it", () => {
    // THE SHAPE ONE SIBLING DECLARES AND THIS PARAMETER DERIVES. It lists its roots as
    // `{ rel, shape: "directory" | "file" }` with a single file among them, which a plain `string[]`
    // can express only if the engine looks at what is actually there. It could not: every root went
    // straight to `readdirSync`, so a file root threw `ENOTDIR`, uncaught, and the run took node's
    // exit 1, the code this contract reserves for HITS FOUND. Measured, then fixed.
    write("README.md", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    const r = run({ scanRoots: [{ rel: "README.md", shape: "file" }] });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("README.md");

    // ...and the root half of scope really is just that file: a violator elsewhere is out of scope.
    write("src/leak.ts", `const ssn = "${SSN}";\n`);
    const scoped = run({ scanRoots: [{ rel: "README.md", shape: "file" }] });
    expect(scoped.out).not.toContain("src/leak.ts");

    // 🛑 AND THE SHAPE IS DECLARED, NOT DERIVED. Deriving is what let a corpus root replaced by a
    // one-line file through: the sweep read the replacement, the per-root tier saw something read
    // under that root, and a run went from refusing to clean. `require` cannot catch that state,
    // because the replacement IS read; only the declaration can.
    const mismatch = run({ scanRoots: ["README.md"] });
    expect(mismatch.code, mismatch.out).toBe(2);
    expect(mismatch.out).toContain("a file, where a directory is declared");
  });

  it("REFUSES a root that names a symbolic link, rather than following it", () => {
    // A root is the one place a link could have been followed by construction, because the walk
    // STARTS there rather than meeting it as a directory entry. It is refused with the same closed
    // set of tokens, and the target is never printed.
    const outside = join(repo, "..", "phi-scan-engine-root-link-target");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leak.txt"), `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      symlinkSync(outside, join(repo, "corpus"));

      const r = run({ scanRoots: ["corpus"] });
      expect(r.code, r.out).toBe(2);
      expect(r.out).toContain("corpus");
      expect(r.out).toContain("a symbolic link");
      expect(r.out).not.toContain(SSN);
      expect(r.out).not.toContain("phi-scan-engine-root-link-target");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("EXCLUDES a literal path on every route, and only the one named", () => {
    // The subtractive half of the roots axis. An entry here is a file the scan has NO verdict about,
    // which is why it is a literal path rather than a predicate over content.
    write("test/deliberate.test.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    write("test/other.test.ts", `const other = "${SSN}";\nexport default other;\n`);
    commitAll();

    const r = run({ excludedPaths: new Set(["test/deliberate.test.ts"]) });
    expect(r.code).toBe(1);
    // It is ANNOUNCED and it is not judged. The announcement is the point: a sibling's superseded
    // scanner printed its exclusions and the engine dropped them silently, which is the same class
    // as a dropped allow-list tag. So the assertion is about the HIT report, not about the whole
    // stream.
    expect(r.out).toContain("EXCLUDED: test/deliberate.test.ts");
    expect(r.out).not.toContain("HIT: test/deliberate.test.ts");
    expect(r.out).toContain("HIT: test/other.test.ts");
  });
});

describe("runPhiScanCli: the process tail, which is where the report used to die", () => {
  // 🛑 THREE TAILS WERE MEASURED AND ALL THREE WERE WRONG, which is why this is shipped rather
  // than written thirteen times. Over 2,000 hits against two consumer shapes, a sibling measured:
  //
  //   `process.exit(runPhiScan(...))`   delivered 86 of 2,000 HIT lines and NO summary to a
  //                                     reader that had not drained stderr.
  //   `process.exitCode = ...`          HUNG against an open, never-drained pipe, AND turned a
  //                                     CLEAN run into this contract's HITS code through an
  //                                     uncaught `EPIPE` when the stdout reader had gone.
  //   the same plus an `EPIPE` guard    still HUNG.
  //
  // A hang in a pre-commit hook is worse than a truncated report, so neither is shippable alone.
  // These cases pin all three properties at once, because a fix for any one of them reintroduces
  // one of the others.

  /** The CLI tail, in a real subprocess: none of this is observable in process. */
  function cli(
    args: string[],
    opts: { drain: boolean; drainGraceMs?: number },
  ): { code: number | null; err: string; ms: number } {
    const grace = opts.drainGraceMs ?? 1500;
    const driver = `
      const { spawn } = require("node:child_process");
      const t0 = Date.now();
      const child = spawn(process.execPath, ["--input-type=module", "-e", process.argv[1]], {
        cwd: ${JSON.stringify(repo)},
        stdio: ["ignore", "pipe", "pipe"],
      });
      let err = "";
      ${opts.drain ? 'child.stderr.on("data", (c) => { err += String(c); }); child.stdout.resume();' : ""}
      const kill = setTimeout(() => { child.kill("SIGKILL"); }, 12000);
      child.on("exit", (code, signal) => {
        clearTimeout(kill);
        process.stdout.write(JSON.stringify({ code, signal, err, ms: Date.now() - t0 }));
      });
    `;
    const scanner = `
      import { runPhiScanCli } from ${JSON.stringify(ENGINE_URL)};
      runPhiScanCli({
        exitCodes: { clean: 0, hits: 1, refuse: 2 },
        scanRoots: ["."],
        repoRoot: ${JSON.stringify(repo)},
        argv: ${JSON.stringify(args)},
        drainGraceMs: ${String(grace)},
      });
    `;
    const r = spawnSync(process.execPath, ["-e", driver, scanner], { encoding: "utf8" });
    const parsed = JSON.parse(r.stdout) as {
      code: number | null;
      signal: string | null;
      err: string;
      ms: number;
    };
    expect(parsed.signal, "the tail hung and had to be killed").toBeNull();
    return { code: parsed.code, err: parsed.err, ms: parsed.ms };
  }

  it("does NOT turn a clean run into the HITS code when the stdout reader has gone", () => {
    // The `EPIPE` flip, and it is the worst of the three: a repo would read exit 1 as "PHI found
    // here" on a corpus that is clean. The guard is installed BEFORE the report is written,
    // because the writes are what raise it.
    //
    // WHICH TAIL THIS DISCRIMINATES AGAINST: the naive repair (`process.exitCode` alone), not the
    // one the template used to ship, `process.exit` gets this case right, by abandoning the write
    // queue before it can fail. That is the trade this whole function exists to unpick.
    write("src/a.ts", "nothing to see\n");
    commitAll();
    const r = cli([], { drain: false });
    expect(r.code, r.err).toBe(0);
  });

  it("TERMINATES against a pipe that is open and never drained, instead of hanging", () => {
    // The hang. An unref'd timer is what bounds it: when the queues drain the loop empties and
    // node exits on its own with the status already set, so the timer never participates; when a
    // reader holds the pipe open and never reads, the pending write keeps the loop alive, the
    // timer fires, and the process ends with the SAME status.
    write("src/leak.ts", `const ssn = "${SSN}";\n`);
    commitAll();
    const r = cli([], { drain: false, drainGraceMs: 500 });
    expect(r.code, r.err).toBe(1);
    // Bounded by the grace, not by the 12-second kill the driver would otherwise apply.
    expect(r.ms).toBeLessThan(9000);
  });

  it("delivers the WHOLE report, every hit and the summary, when the reader drains", () => {
    // 🛑 THIS CASE PINS DELIVERY, AND IT DOES NOT REPRODUCE THE TRUNCATION. Measured here, on this
    // runner, with this corpus: a `process.exit(runPhiScan(...))` tail delivers all 400 lines too,
    // so the two tails are indistinguishable by this assertion. The 86-of-2,000 truncation was
    // measured in a different environment and is NOT reproduced by anything in this repository.
    //
    // It is kept anyway, and the reason is worth stating rather than leaving to be inferred: the
    // property a consumer depends on is that the report ARRIVES, and a future change to the tail
    // that starts dropping lines reds here. What it must not be read as is evidence that the
    // truncation is fixed, the two cases above are what discriminate this tail from the two
    // wrong ones, and each names which.
    const lines = Array.from({ length: 400 }, (_, i) => {
      const tail = String(i).padStart(4, "0");
      return `ssn 123-45-${tail}`;
    });
    write("src/many.txt", `${lines.join("\n")}\n`);
    commitAll();

    const r = cli([], { drain: true });
    expect(r.code).toBe(1);
    const delivered = r.err.split("\n").filter((l) => l.includes("segment=(ssn)")).length;
    expect(delivered).toBe(400);
    expect(r.err).toContain("400 hit(s) across 1 file(s)");
  });
});

describe("declared detectors: the vocabulary is data, and the boundary is deliberate", () => {
  // The half a repo actually writes. The engine ships the GRAMMARS and the value RULES; a repo
  // declares positions, conjunctive equality guards over a sibling position, and a named rule.
  //
  // 🛑 THE KIND SET IS DECLARED AND OPEN, AND SEVERAL REPOS LEGITIMATELY FILL NONE. The premise this
  // work began from, five universal kinds with only the vocabulary differing, was refuted on both
  // axes across the fleet: one repo has no address, phone or identifier vocabulary, one declares no
  // field vocabulary at all because its corpus is code-system content, one has no address, and one
  // has no date-of-birth detector at all.

  /** A synthetic HL7-shaped record. Every value here is invented and none is a real identifier. */
  const HL7 = [
    "MSH|^~\\&|APP|FAC|APP2|FAC2|20240101120000||ADT^A01|1|P|2.5",
    "PID|1||900001^^^HOSP^MR~123-45-6789^^^USA^SS|" +
      "|QUINCE^ROWAN^T||19850211|F|||742 EVERGREEN TER^^SPRINGFIELD^IL^62704||5551234567",
  ].join("\r");

  const hl7Detector = {
    id: "hl7v2",
    grammar: { kind: "delimited-record" as const },
    appliesTo: { pathSuffixes: [".hl7"] },
    fields: [
      { record: "PID", field: 5, kind: "name" as const, id: "PID-5" },
      {
        record: "PID",
        field: 7,
        component: 0,
        kind: "dob" as const,
        pattern: /^\d{8}$/,
        id: "PID-7",
      },
      { record: "PID", field: 11, component: 0, kind: "address" as const, id: "PID-11" },
      { record: "PID", field: 13, kind: "phone" as const, id: "PID-13" },
    ],
  };

  function segmentsOf(out: string): string[] {
    return [...out.matchAll(/segment=(\S+)/g)].map((m) => m[1] ?? "");
  }

  it("reads a delimited wire format through DECLARED positions, and answers to the allow-list", () => {
    write("test/fixtures/a.hl7", `${HL7}\r`);
    commitAll();

    const found = run({ detectors: [hl7Detector] });
    expect(found.code, found.out).toBe(1);
    // Every declared position fired, and the ids are the ones the vocabulary named.
    expect(new Set(segmentsOf(found.out))).toEqual(
      new Set(["PID-5", "PID-7", "PID-11", "PID-13", "(ssn)"]),
    );

    // ...and DECLARING the values clears it, which is the remedy the footer points at. The address
    // is lower-cased, the name is tokenised, the phone is reduced to digits, and the date is
    // compared VERBATIM.
    write(
      "scripts/phi-allow-list.txt",
      [
        "EMAILDOMAIN example.com",
        "NAME QUINCE",
        "NAME ROWAN",
        "DOB 19850211",
        "ADDR 742 evergreen ter",
        "PHONE 5551234567",
        `ID ${SSN}`,
        "",
      ].join("\n"),
    );
    const cleared = run({ detectors: [hl7Detector] });
    expect(cleared.code, cleared.out).toBe(0);
  });

  it("keys on the DECLARED POSITION, not on the value, so a coded field is not a name", () => {
    // ANTI-VACUITY FOR THE WHOLE MECHANISM. A detector that fired on any name-shaped token anywhere
    // would pass the case above for the wrong reason. Here the same tokens sit in a field the
    // vocabulary does not name, and nothing fires.
    write(
      "test/fixtures/a.hl7",
      `${HL7.replace("QUINCE^ROWAN^T", "")}\rOBX|1|ST|CBC^QUINCE ROWAN||x\r`,
    );
    commitAll();
    const r = run({ detectors: [hl7Detector] });
    expect(segmentsOf(r.out)).not.toContain("PID-5");
  });

  it("applies a GUARD as equality over a sibling position, and nothing more", () => {
    // The identifier vocabulary has to tell an MRN from a national identifier sitting in the same
    // repeating field, and the only thing that distinguishes them is a sibling component. This is
    // the whole of the guard language: a position, and a set of literals it must equal.
    write("test/fixtures/a.hl7", `${HL7}\r`);
    commitAll();
    const withGuard = {
      ...hl7Detector,
      fields: [
        {
          record: "PID",
          field: 3,
          component: 0,
          guard: [{ component: 4, oneOf: ["MR"] }],
          kind: "id" as const,
          minDigits: 6,
          id: "PID-3-MR",
        },
      ],
    };
    const r = run({ detectors: [withGuard] });
    expect(r.code, r.out).toBe(1);
    expect(segmentsOf(r.out)).toContain("PID-3-MR");
    // The repetition whose sibling component says SS is NOT reported under this entry: the guard
    // selected one repetition out of two.
    const mrHits = [...r.out.matchAll(/segment=PID-3-MR value="([^"]*)"/g)].map((m) => m[1]);
    expect(mrHits).toEqual(["900001"]);
  });

  it("answers a RESERVED SPACE without a per-value declaration", () => {
    // The alternative to maintaining literals by hand, which is the thing this work deletes. The
    // engine's phone rule defaults to the NANP fictional range, and it is STRICTER than the
    // `includes("555")` test four sibling scanners carried.
    write("test/fixtures/a.hl7", `${HL7.replace("5551234567", "5555550123")}\r`);
    commitAll();
    const r = run({ detectors: [hl7Detector] });
    expect(segmentsOf(r.out)).not.toContain("PID-13");

    // ...and a number that merely CONTAINS 555 is not in that space, which is the tightening.
    write("test/fixtures/a.hl7", `${HL7.replace("5551234567", "5552224444")}\r`);
    const loose = run({ detectors: [hl7Detector] });
    expect(segmentsOf(loose.out)).toContain("PID-13");
  });

  it("reads XML by local name and by attribute, prefix-tolerant and entity-decoded", () => {
    write(
      "test/fixtures/a.xml",
      '<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3">' +
        "<patient><name><family>Q&#x75;INCE</family></name>" +
        '<birthTime value="19850211"/>' +
        '<id root="2.16.840.1.113883.4.1" extension="123456789"/>' +
        '<id root="1.2.3" extension="900001"/>' +
        "</patient></ClinicalDocument>",
    );
    commitAll();
    const r = run({
      detectors: [
        {
          id: "cda",
          grammar: { kind: "xml" as const },
          appliesTo: { pathSuffixes: [".xml"] },
          fields: [
            { record: "family", kind: "name" as const, id: "family" },
            {
              record: "birthtime",
              attr: "value",
              kind: "dob" as const,
              pattern: /^\d{8}$/,
              id: "birthTime",
            },
            {
              record: "id",
              attr: "extension",
              guard: [{ attr: "root", oneOf: ["2.16.840.1.113883.4.1"] }],
              kind: "id" as const,
              minDigits: 9,
              maxDigits: 9,
              id: "id@ssn-root",
            },
          ],
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    const segs = new Set(segmentsOf(r.out));
    // The entity was decoded before the token check, so `&#x75;` could not smuggle the name past it.
    expect(r.out).toContain('value="QuINCE"');
    expect(segs).toContain("birthTime");
    // The guard picked the id whose root says so, and left the other one alone.
    const ids = [...r.out.matchAll(/segment=id@ssn-root value="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["123456789"]);
  });

  it("REFUSES a declared format it cannot parse, instead of falling back to the floor", () => {
    // 🛑 A sibling's shipped scanner does the opposite: on a JSON parse failure it falls back to the
    // cross-cutting floor alone, and reports 0 hits at exit 0 over a FRAGMENTARY resource carrying a
    // name, a date of birth AND a street address. A run that could not read a format it declared has
    // no verdict to give about that file.
    write("test/fixtures/broken.json", '{"name":[{"family":"QUINCE"');
    commitAll();
    const detector = {
      id: "fhir",
      grammar: { kind: "json" as const },
      appliesTo: { pathSuffixes: [".json"] },
      fields: [{ record: "name.family", kind: "name" as const, id: "name.family" }],
    };
    const r = run({ detectors: [detector] });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("could not parse it");
    expect(r.out).not.toContain("OK: no hits");

    // ...and the same vocabulary over a WELL-FORMED document still reports, so the refusal above is
    // about the parse and not about the detector being inert.
    write("test/fixtures/broken.json", '{"name":[{"family":"QUINCE"}]}');
    commitAll();
    const ok = run({ detectors: [detector] });
    expect(ok.code, ok.out).toBe(1);
    expect(segmentsOf(ok.out)).toContain("name.family");
  });

  it("keys JSON on the property PATH, so an ordinary English word is not a vocabulary", () => {
    // `family`, `given`, `line` and `city` are ordinary property names. A detector keyed on the bare
    // word fires on prose and on unrelated structures; the path is what makes it structural.
    write("test/fixtures/a.json", '{"unrelated":{"family":"QUINCE"}}');
    commitAll();
    const r = run({
      detectors: [
        {
          id: "fhir",
          grammar: { kind: "json" as const },
          appliesTo: { pathSuffixes: [".json"] },
          fields: [{ record: "name.family", kind: "name" as const, id: "name.family" }],
        },
      ],
    });
    expect(r.code, r.out).toBe(0);
  });

  it("REFUSES a misdeclared vocabulary at configuration time, rather than matching nothing", () => {
    // Every one of these would otherwise be a detector that silently judges nothing, which is this
    // whole item's failure class arriving through configuration.
    const base = { repoRoot: repo, argv: [], exitCodes: CODES, scanRoots: ["."] };
    const detector = (over: Record<string, unknown>) => ({
      id: "d",
      grammar: { kind: "delimited-record" },
      fields: [{ record: "PID", field: 5, kind: "name" }],
      ...over,
    });
    expect(() =>
      runPhiScan({ ...base, detectors: [detector({ fields: [{ kind: "nope" }] })] } as never),
    ).toThrow(/declares kind "nope"/);
    expect(() =>
      runPhiScan({
        ...base,
        detectors: [detector({ fields: [{ kind: "name", bucket: "nope" }] })],
      } as never),
    ).toThrow(/names bucket "nope"/);
    expect(() =>
      runPhiScan({
        ...base,
        detectors: [detector({ fields: [{ kind: "phone", reservedSpaces: ["nope"] }] })],
      } as never),
    ).toThrow(/names reserved space "nope"/);
    expect(() =>
      runPhiScan({ ...base, detectors: [detector({ grammar: { kind: "yaml" } })] } as never),
    ).toThrow(/declares grammar kind "yaml"/);
    // A guard is an equality test over a sibling position and nothing else.
    expect(() =>
      runPhiScan({
        ...base,
        detectors: [detector({ fields: [{ kind: "name", guard: [{ component: 4 }] }] })],
      } as never),
    ).toThrow(/guard without a non-empty `oneOf`/);
    // A grammar that REFUSES what it cannot parse must say which targets carry that format, or it
    // would refuse on every file in the corpus.
    expect(() =>
      runPhiScan({
        ...base,
        detectors: [
          detector({ grammar: { kind: "json" }, fields: [{ record: "a", kind: "name" }] }),
        ],
      } as never),
    ).toThrow(/must declare an `appliesTo`/);
  });

  it("runs SEVERAL vocabularies over one target, because recogniser count is per-repo", () => {
    // 🛑 "ONE VOCABULARY PER REPO" IS FALSE AND WAS MEASURED SO. One repo carries a single synthetic
    // identity in three vocabularies which CO-OCCUR INSIDE SINGLE FILES, so neither a per-root nor a
    // per-file-type selection can pick between them. The parameter is a LIST.
    write("test/fixtures/both.hl7", `${HL7}\r`);
    write("test/fixtures/both.json", '{"name":[{"family":"ROWAN"}]}');
    commitAll();
    const r = run({
      detectors: [
        hl7Detector,
        {
          id: "fhir",
          grammar: { kind: "json" as const },
          appliesTo: { pathSuffixes: [".json"] },
          fields: [{ record: "name.family", kind: "name" as const, id: "name.family" }],
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    const segs = new Set(segmentsOf(r.out));
    expect(segs).toContain("PID-5");
    expect(segs).toContain("name.family");
  });
});

describe("pass-2 repairs: each of these was a live escape a reviewer measured", () => {
  it("leaves NO scanned bytes in the process-global RegExp statics", () => {
    // 🛑 THE MOST SERIOUS FINDING OF THE ADOPTION RUN, and no per-repo parameter could restore it.
    // V8 keeps the last successful match on the RegExp CONSTRUCTOR, so every `matchAll` the floor
    // runs over a target writes the file and the matched identifier into process globals. A sibling
    // measured, through `runPhiScan`, that a 153,954-code-unit scanned file and the matched
    // identifier both survived the return: reachable by anything later in the same process and by
    // any crash dump. That sibling had closed the same residual twice by hand, so adopting the
    // engine would have REINTRODUCED it.
    //
    // Subclassing `RegExp` does not avoid it (measured on this runner), so the containment is to
    // overwrite the statics with engine-owned constants.
    write("test/fixtures/bad.txt", `ssn ${SSN} and mail person@clinic.invalid\n`);
    commitAll();

    // The premise, so a green below cannot come from the statics never having been written: a plain
    // match over the same payload DOES leave it there.
    /\b\d{3}-\d{2}-\d{4}\b/.exec(`ssn ${SSN}`);
    expect(RegExp.lastMatch).toBe(SSN);

    expect(run().code).toBe(1);
    expect(RegExp.lastMatch).not.toBe(SSN);
    expect(RegExp.input).not.toContain(SSN);
    expect(RegExp.input.length).toBeLessThan(64);

    // ...and on a refusal path too, which exits between targets rather than after one.
    expect(run({ scanRoots: ["does-not-exist"] }).code).toBe(2);
    expect(RegExp.input).not.toContain(SSN);
  });

  it("reads a primitive inside a JSON array, which is where FHIR keeps given names and street lines", () => {
    // FHIR R4 declares `HumanName.given` and `Address.line` as arrays of STRINGS, so a patient's
    // given name and street line always arrive this way. The walk recursed into the array and then
    // required an object, so both were invisible and the run reported clean at exit 0.
    write(
      "test/fixtures/p.json",
      '{"resourceType":"Patient","name":[{"given":["ROWAN","T"],"family":"QUINCE"}],' +
        '"address":[{"line":["742 EVERGREEN TER"]}]}',
    );
    commitAll();
    const r = run({
      detectors: [
        {
          id: "fhir",
          grammar: { kind: "json" },
          appliesTo: { pathSuffixes: [".json"] },
          fields: [
            { record: "name.given", kind: "name", id: "given" },
            { record: "address.line", kind: "address", id: "line" },
          ],
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("segment=given");
    expect(r.out).toContain("segment=line");
  });

  it("does not let one line of PROSE disable a delimited detector for the whole file", () => {
    // Delimiter discovery took the FIRST line whose opening characters matched a header id, with any
    // punctuation at the separator offset. `MSH-9`, the commonest way an HL7 field is spelled in
    // documentation, therefore set the separator to `-`, after which every real record failed the
    // admission test and the file scanned clean at exit 0. The candidate admitting the MOST records
    // now wins, so prose loses to the document: a prose line admits itself and nothing else.
    const message =
      "MSH|^~\\&|A|B|C|D|20240101||ADT^A01|1|P|2.5\n" +
      "PID|1||900001^^^HOSP^MR||QUINCE^ROWAN||19850211\n";
    const detector = {
      id: "hl7v2",
      grammar: { kind: "delimited-record" },
      appliesTo: { pathPrefixes: ["test/"] },
      fields: [{ record: "PID", field: 5, kind: "name", id: "PID-5" }],
    };

    // ONE prose line, which is what the discarded first heuristic lost to.
    write("test/notes.md", `MSH-9 carries the message type.\n${message}`);
    commitAll();
    const one = run({ detectors: [detector] });
    expect(one.code, one.out).toBe(1);
    expect(one.out).toContain("segment=PID-5");

    // 🛑 AND A WHOLE FIELD TABLE, which is what the SECOND heuristic lost to: `MSH-1` through
    // `MSH-10` is one admitted line each under separator `-`, so enough documentation lines
    // outvoted the message they document. Declared delimiters have no vote to lose.
    const table = Array.from({ length: 12 }, (_, i) => `MSH-${String(i + 1)} some field`).join(
      "\n",
    );
    write("test/notes.md", `${table}\n${message}`);
    commitAll();
    const many = run({ detectors: [detector] });
    expect(many.code, many.out).toBe(1);
    expect(many.out).toContain("segment=PID-5");

    // ANTI-VACUITY: prose ALONE must still not manufacture a record.
    write("test/notes.md", `${table}\n`);
    commitAll();
    expect(run({ detectors: [detector] }).code).toBe(0);
  });

  it("never prints the parser's own message, which embeds a window of the document", () => {
    // A refuter measured a patient's given name reaching stderr verbatim through `JSON.parse`'s
    // "Unexpected token" text. Everywhere else this engine prints only a repo-relative path and a
    // token from a closed set; this was a second, engine-owned exception and a consumer could not
    // fix it.
    write("test/fixtures/broken.json", '{"name":[{"family":"QUINCE","given":["ROWAN"]},}');
    commitAll();
    const r = run({
      detectors: [
        {
          id: "fhir",
          grammar: { kind: "json" },
          appliesTo: { pathSuffixes: [".json"] },
          fields: [{ record: "name.family", kind: "name" }],
        },
      ],
    });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("could not parse it");
    expect(r.out).not.toContain("QUINCE");
    expect(r.out).not.toContain("ROWAN");
  });

  it("reads a BOM-prefixed JSON document instead of refusing a legitimate one", () => {
    // RFC 8259 section 8.1 permits a parser to ignore a byte-order mark, and `JSON.parse` rejects
    // one. Refusing there is a false red on a conformant fixture, against this ecosystem's own
    // liberal-on-parse convention.
    write("test/fixtures/bom.json", '﻿{"name":[{"family":"QUINCE"}]}');
    commitAll();
    const r = run({
      detectors: [
        {
          id: "fhir",
          grammar: { kind: "json" },
          appliesTo: { pathSuffixes: [".json"] },
          fields: [{ record: "name.family", kind: "name", id: "family" }],
        },
      ],
    });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("segment=family");
  });

  it("keeps a declared VIEW strictly additive: it can add a finding, never subtract a verdict", () => {
    // A `source-literals` view decodes escapes, and a decoded newline inside a JSON string literal
    // makes the decoded text invalid JSON. Running a REFUSING grammar over it turned a clean run
    // into a refusal on a file whose real bytes parse fine, so a strict grammar now runs on the raw
    // view only.
    write("test/fixtures/ok.json", '{"note":"line one\\nline two"}');
    commitAll();
    const r = run({
      textViews: [{ kind: "source-literals", appliesTo: [".json"] }],
      detectors: [
        {
          id: "fhir",
          grammar: { kind: "json" },
          appliesTo: { pathSuffixes: [".json"] },
          fields: [{ record: "name.family", kind: "name" }],
        },
      ],
    });
    expect(r.code, r.out).toBe(0);
  });

  it("REFUSES a root it cannot stat, where absent is skipped and caught by `require`", () => {
    // Absent and unreadable both came back `null` and both were skipped, so a root the scan cannot
    // stat contributed nothing and the run could still report clean: fail-open, on the axis that
    // decides what the corpus IS. A root UNDER A REGULAR FILE is the portable way to reach a
    // non-ENOENT errno (`ENOTDIR`) without a chmod, which is a no-op for a privileged uid.
    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    const r = run({ scanRoots: ["src", "src/index.ts/nested"] });
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("src/index.ts/nested");
    expect(r.out).toContain("cannot stat");
    expect(r.out).not.toContain("OK: no hits");

    // ...and an ABSENT root is still the OTHER tier, with its own sentence, so the two answers are
    // told apart rather than merged back together.
    const absent = run({ scanRoots: ["src", "not-there"] });
    expect(absent.code, absent.out).toBe(2);
    expect(absent.out).toContain("yielded");
    expect(absent.out).not.toContain("cannot stat");
  });

  it("unions the whole index when `unionScope` says so, without widening the walk", () => {
    // 🛑 THE WALK AND THE UNION ARE TWO AXES. Six repos walk a narrow corpus while their index half
    // was already repository-wide, so a literal rename of their roots silently stopped reading
    // tracked files; two others need a narrow union because a whole-repository read hits their own
    // manifest's author address. One root list collapsed the two, and made those look like a
    // conflict when they are not.
    write("src/index.ts", "export const x = 1;\n");
    write("elsewhere/leak.txt", `ssn ${SSN}\n`);
    commitAll();

    expect(run({ scanRoots: ["src"] }).code).toBe(0);

    const wide = run({ scanRoots: ["src"], unionScope: "repository" });
    expect(wide.code, wide.out).toBe(1);
    expect(wide.out).toContain("elsewhere/leak.txt (as git carries it)");
    // ...and the WALK is still narrow: an UNTRACKED file outside the roots is not read.
    write("elsewhere/untracked.txt", `ssn ${SSN}\n`);
    const still = run({ scanRoots: ["src"], unionScope: "repository" });
    expect(still.out).not.toContain("elsewhere/untracked.txt\n");
  });

  it("REFUSES an unaccountable index entry that `unionScope` brought into scope", () => {
    // 🛑 WIDENING WHAT IS READ WITHOUT WIDENING WHAT IS ACCOUNTED FOR IS THIS GATE'S OWN FAILURE
    // SHAPE. When `unionScope` first landed it widened only the union's candidate list, so with a
    // narrow walk and a repository-wide union a tracked path outside the roots was READ while the
    // tiers that say "this path has bytes I cannot account for" still keyed on the walk's roots. An
    // unmerged path carrying a dashed identifier in one conflict side reported `OK: no hits` at
    // exit 0, where the same repository under `["."]` refused.
    write("src/index.ts", "export const x = 1;\n");
    write("data/notes.txt", "base\n");
    commitAll();
    expect(git(["checkout", "-q", "-b", "side-a"]).code).toBe(0);
    writeFileSync(join(repo, "data", "notes.txt"), `side a ${SSN}\n`, "utf8");
    expect(git(["commit", "-qam", "side a", "--no-verify"]).code).toBe(0);
    expect(git(["checkout", "-q", "-b", "side-b", "HEAD~1"]).code).toBe(0);
    writeFileSync(join(repo, "data", "notes.txt"), "side b\n", "utf8");
    expect(git(["commit", "-qam", "side b", "--no-verify"]).code).toBe(0);
    // The merge is EXPECTED to fail; the conflict is the fixture.
    git(["merge", "--no-verify", "side-a"]);
    expect(git(["status", "--short"]).out).toContain("UU data/notes.txt");

    const wide = run({ scanRoots: ["src"], unionScope: "repository" });
    expect(wide.code, wide.out).toBe(2);
    expect(wide.out).toContain("data/notes.txt");
    expect(wide.out).toContain("unmerged");
    expect(wide.out).not.toContain("OK: no hits");

    // ...and the narrow default still leaves it out of scope entirely, which is the other polarity:
    // the refusal follows the scope rather than being unconditional.
    expect(run({ scanRoots: ["src"] }).code).toBe(0);
  });

  it("reads a declared FILE root on the union and staged routes, not only on the walk", () => {
    // The bypass held on the walk alone, so the same declaration that read a Markdown file root off
    // disk reported clean at exit 0 over the bytes GIT carries at it, and clean over the same file
    // STAGED. Both routes applied the read filter the walk had been told to skip.
    const roots = [{ rel: "README.md", shape: "file" as const }, "src"];

    // THE UNION HALF: git carries the identifier, the working tree is clean.
    write("README.md", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    writeFileSync(join(repo, "README.md"), "clean on disk now\n", "utf8");
    const union = run({ scanRoots: roots, isReadable: exemptsMarkdown });
    expect(union.code, union.out).toBe(1);
    expect(union.out).toContain("README.md (as git carries it)");

    // THE COMMIT-BLOCKING ROUTE: commit a clean file, then STAGE one carrying the identifier.
    git(["add", "-A"]);
    expect(git(["commit", "-qm", "clean readme", "--no-verify"]).code).toBe(0);
    writeFileSync(join(repo, "README.md"), `ssn ${SSN}\n`, "utf8");
    git(["add", "README.md"]);
    const staged = run({ argv: ["--staged"], scanRoots: roots, isReadable: exemptsMarkdown });
    expect(staged.code, staged.out).toBe(1);
    expect(staged.out).toContain("README.md");
  });

  it("lets a path-scoped mail declaration clear the file it is declared in", () => {
    // A scoped entry necessarily writes the address into the allow-list, and under whole-repository
    // roots that file is scanned, so the remedy reported itself as a hit and the footer sent the
    // developer to declare a value they had just declared.
    write("src/x.ts", "const contact = 'nurse.jane@clinic.invalid';\n");
    write(
      "scripts/phi-allow-list.txt",
      "EMAILDOMAIN example.com\nEMAILAT src/x.ts nurse.jane@clinic.invalid\n",
    );
    commitAll();
    const r = run();
    expect(r.code, r.out).toBe(0);

    // ...and the scope still governs everywhere else: the same address in another file is a hit.
    write("src/y.ts", "const contact = 'nurse.jane@clinic.invalid';\n");
    commitAll();
    const elsewhere = run();
    expect(elsewhere.code, elsewhere.out).toBe(1);
    expect(elsewhere.out).toContain("src/y.ts");
  });

  it("REFUSES a key it does not read, in a detector, a grammar or a field", () => {
    // A misspelled key is a vocabulary entry that judges nothing and looks exactly like one that
    // judges something. A reviewer typed `guards` for `guard` and the entry fired unguarded, and
    // `headerRecordIDs` for `headerRecordIds` and the delimiters silently fell back.
    const base = { repoRoot: repo, argv: [], exitCodes: CODES, scanRoots: ["."] };
    expect(() =>
      runPhiScan({
        ...base,
        detectors: [
          {
            id: "d",
            grammar: { kind: "delimited-record", headerRecordIDs: ["MSH"] },
            fields: [{ record: "PID", field: 5, kind: "name" }],
          },
        ],
      } as never),
    ).toThrow(/"headerRecordIDs"/);
    expect(() =>
      runPhiScan({
        ...base,
        detectors: [
          {
            id: "d",
            grammar: { kind: "delimited-record" },
            fields: [{ record: "PID", field: 5, kind: "name", guards: [] }],
          },
        ],
      } as never),
    ).toThrow(/"guards"/);
  });

  it("does not accept a domain the cited RFCs do not reserve", () => {
    // A reserved space is only a provenance marker if every member is genuinely reserved. RFC 2606
    // section 3 reserves example.com, .net and .org; `example.edu` is in neither cited RFC, so
    // accepting it cleared an address at a domain that can really exist.
    expect(RESERVED_SPACES["reserved-domain"]("a@example.com")).toBe(true);
    expect(RESERVED_SPACES["reserved-domain"]("a@example.edu")).toBe(false);
    // The other two members, checked in both directions.
    expect(RESERVED_SPACES["nanp-fictional"]("212-555-0134")).toBe(true);
    expect(RESERVED_SPACES["nanp-fictional"]("212-555-0200")).toBe(false);
    expect(RESERVED_SPACES["ssa-never-issued"]("900-12-3456")).toBe(true);
    expect(RESERVED_SPACES["ssa-never-issued"]("899-12-3456")).toBe(false);
  });
});
