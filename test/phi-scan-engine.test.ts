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

import { exemptsMarkdown, runPhiScan } from "@cosyte/script-utils/phi-scan";

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
    // default would keep the old spelling, get the new default, and read more than it declared —
    // or, had the flip gone the other way, less.
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
    // live dashed identifier — a PHI gate reporting clean while opening no file, reachable by
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
    // empty — and even then the violator outside the roots is still not read, which is the scope
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
