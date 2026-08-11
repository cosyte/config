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
function run(
  config: Partial<Parameters<typeof runPhiScan>[0]> & { argv?: string[] } = {},
): { code: number; out: string } {
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
      isStagedReadable: exemptsMarkdown,
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
        isStagedReadable: exemptsMarkdown,
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
        isStagedReadable: exemptsMarkdown,
      }),
    ).toThrow(/three DIFFERENT numbers/);
  });

  it("REQUIRES the scan roots and the --staged read filter", () => {
    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        isStagedReadable: exemptsMarkdown,
      } as unknown as Parameters<typeof runPhiScan>[0]),
    ).toThrow(/scanRoots` is REQUIRED/);

    expect(() =>
      runPhiScan({
        repoRoot: repo,
        argv: [],
        exitCodes: CODES,
        scanRoots: ["."],
      } as unknown as Parameters<typeof runPhiScan>[0]),
    ).toThrow(/isStagedReadable` is REQUIRED/);
  });

  it("DEFAULTS the Markdown read exemption, so moving it is one change rather than thirteen", () => {
    // `isWalkReadable` is deliberately optional. A repo that does not set it inherits the shared
    // exemption, which is what makes the `.md` boundary a one-line decision in this package rather
    // than an edit in every consumer. Pinned in both directions so the default cannot go vacuous.
    write("test/fixtures/notes.md", `ssn ${SSN}\n`);
    write("test/fixtures/data.txt", "nothing to see\n");
    commitAll();
    expect(run().code).toBe(0);

    const strict = run({ isWalkReadable: () => true });
    expect(strict.code).toBe(1);
    expect(strict.out).toContain("test/fixtures/notes.md");
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
    writeFileSync(join(repo, "test", "fixtures", "tracked.txt"), "the working-tree bytes\n", "utf8");

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

describe("whole-repository scan roots, which is what a fresh scaffold needs", () => {
  it("reads a tracked file no narrow root would have covered", () => {
    // The measured hole: with `["test/fixtures", "src"]` a scaffold had ONE of its tracked files in
    // scope, so a tracked test carrying a dashed identifier exited 0. Both polarities are asserted
    // here, so the widening is shown to be the cause.
    write("test/leak.test.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    expect(run({ scanRoots: ["test/fixtures", "src"] }).code).toBe(0);

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

  it("EXCLUDES a literal path on every route, and only the one named", () => {
    // The subtractive half of the roots axis. An entry here is a file the scan has NO verdict about,
    // which is why it is a literal path rather than a predicate over content.
    write("test/deliberate.test.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    write("test/other.test.ts", `const other = "${SSN}";\nexport default other;\n`);
    commitAll();

    const r = run({ excludedPaths: new Set(["test/deliberate.test.ts"]) });
    expect(r.code).toBe(1);
    expect(r.out).not.toContain("test/deliberate.test.ts");
    expect(r.out).toContain("test/other.test.ts");
  });
});
