/**
 * THE EIGHT GAPS THE ENGINE'S FIRST CONSUMER FOUND, AND HOW EACH ONE IS SETTLED.
 *
 * WHY THIS FILE LIVES IN THE PACKAGE RATHER THAN IN THE REPOSITORY ROOT'S `test/`. The two suites at
 * the root grade the engine as this repository uses it: one drives `runPhiScan` in process, the
 * other drives the EMITTED scanner of a real scaffold as a subprocess. This one is keyed to the
 * settlements themselves, each case named for the criterion it grades, and it runs under the
 * PACKAGE's own `test` script, which is what a consumer's adoption check and this item's acceptance
 * routes both invoke. Keeping it here is what makes `pnpm --filter @cosyte/script-utils test` an
 * answer about the published surface rather than about the workspace around it.
 *
 * WHAT IS PINNED HERE AND NOT ELSEWHERE: the SETTLEMENT of each gap, including the two that NARROW
 * what a commit gate refuses. Those two carry AC-8 in their names, and each is measured beside the
 * route that still refuses the same entry, so the narrowing cannot be read as a loss nobody bounded.
 * The decision itself is `documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md`.
 *
 * SECURITY / PHI: every payload here is SYNTHETIC. `123-45-6789` is a reserved, never-issued dashed
 * shape and `clinic.invalid` is an RFC 2606 reserved TLD; nothing is written anywhere but a
 * throwaway temp directory this suite removes afterwards (`phi-safety` P1, P3).
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exemptsMarkdown, runPhiScan } from "../phi-scan.js";

/** A synthetic dashed identifier the cross-cutting floor detects. Never issued by anyone. */
const SSN = "123-45-6789";
/** What a report of it LOOKS LIKE: a locator and the rule, never the token (`phi-safety` P4). */
const SSN_FINDING = "segment=(ssn) (dashed SSN pattern)";

const CODES = { clean: 0, hits: 1, refuse: 2 } as const;

type Config = Parameters<typeof runPhiScan>[0];

let repo: string;

function git(args: string[], cwd = repo): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function abs(rel: string): string {
  return join(repo, ...rel.split("/"));
}

function write(rel: string, content: string): void {
  const target = abs(rel);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

/**
 * Run the engine and collect BOTH streams, kept apart.
 *
 * STDOUT AND STDERR ARE SEPARATE HERE AND MERGED IN THE ROOT SUITES, and that is the apparatus for
 * AC-13: the clean line is the one thing a reader watching stdout alone sees, so a case about
 * qualifying it cannot be written against a merged transcript.
 */
function run(config: Partial<Config> = {}): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  try {
    const code = runPhiScan({
      repoRoot: repo,
      argv: [],
      exitCodes: CODES,
      scanRoots: ["."],
      isStagedReadable: exemptsMarkdown,
      ...config,
    });
    return { code, out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "phi-scan-gaps-"));
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

/** Put `rel` into the index at stage 2 only, which is what an unmerged path looks like. */
function fabricateUnmerged(rel: string, content: string): void {
  write(rel, content);
  const hashed = spawnSync("git", ["hash-object", "-w", "--", rel], {
    cwd: repo,
    encoding: "utf8",
  });
  expect(hashed.status, hashed.stderr ?? "").toBe(0);
  const oid = (hashed.stdout ?? "").trim();
  rmSync(abs(rel), { force: true });
  const staged = spawnSync("git", ["update-index", "--index-info"], {
    cwd: repo,
    encoding: "utf8",
    input: `100644 ${oid} 2\t${rel}\n`,
  });
  expect(staged.status, staged.stderr ?? "").toBe(0);
}

// ===========================================================================================
// AC-10: a root's three KINDS, one settled outcome each
// ===========================================================================================

describe("AC-10: every scan-root KIND has one settled outcome, derived from the filesystem", () => {
  it("AC-10: a root naming a REGULAR FILE is scanned as one target", () => {
    // The shape one sibling declares as `{ rel, shape: "file" }` and this parameter derives. The
    // settlement is recorded in ADR 0003: the kind is derived, and what derivation gives up is
    // carried by AC-8 below rather than left implicit.
    write("corpus.txt", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    const r = run({ scanRoots: ["corpus.txt"] });
    expect(r.code, r.err).toBe(1);
    expect(r.err).toContain("corpus.txt");

    // ...and the SAME outcome on every run, which is what "settled" means here.
    expect(run({ scanRoots: ["corpus.txt"] }).code).toBe(1);
  });

  it("AC-10: a root naming a DIRECTORY THAT CANNOT BE ENUMERATED refuses, at the refuse code", () => {
    // IT USED TO CRASH. `readdirSync` ran bare, so an `EACCES` escaped uncaught and the run took
    // node's own exit 1, the code this contract reserves for HITS FOUND: a caller branching on the
    // code (CI does) read "this corpus contains PHI" off a scan that never opened a file.
    //
    // THE PREMISE IS MEASURED RATHER THAN ASSUMED, because a permission bit is a no-op for a
    // privileged uid and this suite must say something true either way.
    write("src/index.ts", "export const x = 1;\n");
    write("blocked/inside.txt", "nothing to see\n");
    commitAll();

    chmodSync(abs("blocked"), 0o000);
    let listable = true;
    try {
      readdirSync(abs("blocked"));
    } catch {
      listable = false;
    }

    try {
      const r = run({ scanRoots: ["blocked", "src"] });
      if (listable) {
        // A privileged run: the directory IS listable, so the premise cannot be built here. What is
        // still graded is the other half of the settlement, that an enumerable root is ordinary.
        expect(r.code, r.err).toBe(0);
      } else {
        expect(r.code, r.err).toBe(2);
        expect(r.err).toContain("could not enumerate blocked");
        expect(r.err).not.toContain("OK: no hits");
        // Not the starved-root refusal wearing this one's name: the two states have different
        // remedies and the message has to say which one this is.
        expect(r.err).not.toContain("observed no files");
      }
    } finally {
      chmodSync(abs("blocked"), 0o755);
    }
  });

  it("AC-10: a root naming a SYMBOLIC LINK is refused rather than followed", () => {
    // A root is the one place a link could have been followed by construction, because the walk
    // STARTS there instead of meeting it as a directory entry. The target is never printed: it is
    // working-tree text that can itself carry PHI.
    const outside = join(repo, "..", "phi-scan-gaps-root-link");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leak.txt"), `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      symlinkSync(outside, abs("corpus"));

      const r = run({ scanRoots: ["corpus"] });
      expect(r.code, r.err).toBe(2);
      expect(r.err).toContain("corpus");
      expect(r.err).toContain("a symbolic link");
      expect(r.err).not.toContain(SSN);
      expect(r.err).not.toContain("phi-scan-gaps-root-link");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ===========================================================================================
// AC-11: the per-root observation rule
// ===========================================================================================

describe("AC-11: a starved root refuses, at the REFUSE code, after the hits are printed", () => {
  it("AC-11: names every starved root, and a failure to scan is not a finding", () => {
    write("src/index.ts", "export const x = 1;\n");
    write("test/fixtures/data.txt", "nothing to see\n");
    commitAll();

    // The premise: with both roots yielding a read file the sweep is clean.
    expect(run({ scanRoots: ["src", "test/fixtures"] }).code).toBe(0);

    const r = run({ scanRoots: ["src", "gone", "also-gone"] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("observed no files under 2 of its 3 scan roots");
    expect(r.err).toContain("gone");
    expect(r.err).toContain("also-gone");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-11: prints a hit from a YIELDING root BEFORE refusing, and still exits at refuse", () => {
    // A failure to scan is an invocation error, not a finding (`cli` N1), so the code is the
    // REFUSE one. What must not happen is the finding being traded for the refusal.
    write("src/leak.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    commitAll();

    const r = run({ scanRoots: ["src", "gone"] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain(SSN_FINDING);
    expect(r.err).toContain("src/leak.ts");
    expect(r.err.indexOf(SSN_FINDING)).toBeLessThan(r.err.indexOf("observed no files"));
  });
});

// ===========================================================================================
// AC-1 to AC-4: the per-root observation rule is answered from the WALK's reads alone
// ===========================================================================================

describe("AC-1 to AC-4: a root is credited by what the walk read, never by the index union", () => {
  /** The one sentence every starved-root refusal carries, naming `root` as the only starved one. */
  const starvedOneOfTwo = (root: string): string =>
    `observed no files under 1 of its 2 scan roots (${root})`;

  it("AC-1: per-root observation rule, a root MISSING or EMPTY on disk refuses though git tracks a file under it", () => {
    write("src/index.ts", "export const x = 1;\n");
    write("test/fixtures/data.txt", "nothing to see\n");
    commitAll();
    const roots = { scanRoots: ["src", "test/fixtures"] };

    // The premise: with both roots yielding a walk read the sweep is clean.
    expect(run(roots).code).toBe(0);

    rmSync(abs("test/fixtures"), { recursive: true, force: true });
    expect(git(["ls-files", "--", "test/fixtures"]).out).toBe("test/fixtures/data.txt\n");
    const missing = run(roots);
    expect(missing.code, missing.err).toBe(2);
    expect(missing.err).toContain(starvedOneOfTwo("test/fixtures"));
    expect(missing.out).not.toContain("OK: no hits");

    mkdirSync(abs("test/fixtures"), { recursive: true });
    const empty = run(roots);
    expect(empty.code, empty.err).toBe(2);
    expect(empty.err).toContain(starvedOneOfTwo("test/fixtures"));
    expect(empty.out).not.toContain("OK: no hits");
  });

  /**
   * One of AC-2's two throwaway repositories. The twins are built by this one function and differ
   * ONLY in whether `src/index.ts` reaches the index before `src` is emptied on disk.
   */
  function starvedSrcTwin(tracked: boolean): ReturnType<typeof run> {
    write("test/fixtures/data.txt", "nothing to see\n");
    write("src/index.ts", "export const x = 1;\n");
    git(["add", "--", "scripts", ".gitignore", "test/fixtures"]);
    if (tracked) git(["add", "--", "src/index.ts"]);
    expect(git(["commit", "-qm", "corpus", "--no-verify"]).code).toBe(0);
    rmSync(abs("src/index.ts"));
    expect(git(["ls-files", "--", "src"]).out).toBe(tracked ? "src/index.ts\n" : "");
    return run({ scanRoots: ["test/fixtures", "src"] });
  }

  it("AC-2: per-root observation rule, the twin whose src/index.ts is UNTRACKED refuses naming src", () => {
    const r = starvedSrcTwin(false);
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain(starvedOneOfTwo("src"));
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-2: per-root observation rule, the twin whose src/index.ts is TRACKED refuses the same way", () => {
    const r = starvedSrcTwin(true);
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain(starvedOneOfTwo("src"));
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-3: per-root observation rule, a hit in the bytes git carries under a starved root prints BEFORE the refusal", () => {
    // The index route still reads the starved root's tracked file and reports what it finds; it
    // only stops vouching for the root. The refusal wins the exit code, as every refusal does.
    write("test/fixtures/data.txt", "nothing to see\n");
    write("src/leak.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    commitAll();
    rmSync(abs("src/leak.ts"));

    const r = run({ scanRoots: ["test/fixtures", "src"] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain(`HIT: src/leak.ts (git index)\n  ${SSN_FINDING}`);
    expect(r.err).not.toContain(SSN);
    expect(r.err).toContain(starvedOneOfTwo("src"));
    expect(r.err.indexOf(SSN_FINDING)).toBeLessThan(r.err.indexOf("observed no files"));
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-4: per-root observation rule, roots the walk read keep their clean and hits codes, a differing working tree included", () => {
    write("test/fixtures/data.txt", "nothing to see\n");
    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    const roots = { scanRoots: ["test/fixtures", "src"] };

    // The walk reads a copy of `src/index.ts` that differs from the bytes git carries.
    write("src/index.ts", "export const x = 2;\n");
    const clean = run(roots);
    expect(clean.code, clean.err).toBe(0);
    expect(clean.out).toBe("[phi-scan] OK: no hits\n");
    expect(clean.err).not.toContain("observed no files");

    // The same shape with the identifier in the index bytes and a clean decoy on disk.
    write("src/leak.ts", `const ssn = "${SSN}";\nexport default ssn;\n`);
    commitAll();
    write("src/leak.ts", "export default 0;\n");
    const hits = run(roots);
    expect(hits.code, hits.err).toBe(1);
    expect(hits.out).toBe("");
    expect(hits.err).toContain("HIT: src/leak.ts (git index; the working tree differs)");
    expect(hits.err).not.toContain("observed no files");
  });
});

// ===========================================================================================
// AC-12: the index route is not narrowed by scanRoots
// ===========================================================================================

describe("AC-12: `all` mode considers every path the INDEX carries", () => {
  it("AC-12: reads a tracked file under an UNDECLARED top-level directory", () => {
    // The escape this route exists for: a root list is the WALK's scope, and a message nobody
    // declared a root for was read by neither route.
    write("src/index.ts", "export const x = 1;\n");
    write("examples/data/sample.txt", `ssn ${SSN}\n`);
    commitAll();

    const r = run({ scanRoots: ["src"] });
    expect(r.code, r.err).toBe(1);
    expect(r.err).toContain("examples/data/sample.txt (git index)");

    // ...and the WALK is still bounded by the roots, so the two halves are distinguishable: an
    // UNTRACKED file outside them is read by neither route, because git carries no bytes for it.
    write("examples/data/untracked.txt", `ssn ${SSN}\n`);
    expect(run({ scanRoots: ["src"] }).err).not.toContain("examples/data/untracked.txt");
  });

  it("AC-12: REFUSES a tracked symbolic link and a GITLINK outside every walk root", () => {
    const outside = join(repo, "..", "phi-scan-gaps-index-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      symlinkSync(outside, abs("pointer.txt"));
      commitAll();

      const link = run({ scanRoots: ["src"] });
      expect(link.code, link.err).toBe(2);
      expect(link.err).toContain("pointer.txt (a symbolic link)");
      expect(link.err).not.toContain(SSN);
      rmSync(abs("pointer.txt"));
      git(["rm", "-q", "--cached", "--", "pointer.txt"]);

      // A gitlink carries another repository's commit id and no bytes at this path at all, so it
      // gets its own half of the sentence rather than the link's.
      const head = git(["rev-parse", "HEAD"]).out.trim();
      git(["update-index", "--add", "--cacheinfo", `160000,${head},vendor/sub`]);
      const gitlink = run({ scanRoots: ["src"] });
      expect(gitlink.code, gitlink.err).toBe(2);
      expect(gitlink.err).toContain("vendor/sub (a gitlink (a nested repository))");
      expect(gitlink.err).toContain("another repository's commit id");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("AC-12: does NOT widen `--staged`, which is what a COMMIT is blocked on", () => {
    // The pre-commit route keeps its own scope predicate, deliberately. The same staged violator is
    // caught by `all` mode and is not caught by `--staged`, and that gap is a measured fact here
    // rather than a claim, so widening it later has to be a deliberate act.
    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    write("examples/data/sample.txt", `ssn ${SSN}\n`);
    git(["add", "-A"]);

    const staged = run({
      argv: ["--staged"],
      scanRoots: ["src"],
      isStagedReadable: (p) => p.startsWith("src/"),
    });
    expect(staged.code, staged.err).toBe(0);

    const sweep = run({ scanRoots: ["src"], isStagedReadable: (p) => p.startsWith("src/") });
    expect(sweep.code, sweep.err).toBe(1);
    expect(sweep.err).toContain("examples/data/sample.txt");
  });

  it("AC-12: the `.md` read exemption still applies to the index route: one boundary, not two", () => {
    write("src/index.ts", "export const x = 1;\n");
    write("notes/secret.md", `ssn ${SSN}\n`);
    commitAll();
    const r = run({ scanRoots: ["src"] });
    expect(r.code, r.err).toBe(0);
    expect(r.err).not.toContain(SSN_FINDING);
  });
});

// ===========================================================================================
// AC-13: the enumeration TOCTOU window, and the qualified clean line
// ===========================================================================================

describe("AC-13: an untracked file gone by read time is SKIPPED, and the clean line says so", () => {
  it("AC-13: qualifies the CLEAN LINE on stdout and names the file on stderr", () => {
    // A reader watching stdout alone must not be able to take an unqualified OK from a sweep that
    // skipped a file: the skip report is on stderr, and stderr is where a CI log buries it.
    write("a-first.txt", "nothing to see\n");
    commitAll();
    write("z-vanishes.txt", "nothing to see\n");

    const r = run({
      detect: (ctx) => {
        if (ctx.path === "a-first.txt") rmSync(abs("z-vanishes.txt"), { force: true });
      },
    });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe("[phi-scan] OK: no hits (1 untracked file(s) skipped, see stderr)\n");
    expect(r.err).toContain("skipped 1 untracked file(s) gone between enumeration and read");
    expect(r.err).toContain("z-vanishes.txt");
  });

  it("AC-13: and the unqualified line is byte-identical when nothing was skipped", () => {
    // The subtraction is visible exactly when there is one. A consumer matching the plain line
    // still matches it, which is what keeps this a qualification rather than a new format.
    write("a-first.txt", "nothing to see\n");
    commitAll();
    expect(run().out).toBe("[phi-scan] OK: no hits\n");
  });

  it("AC-13: a TRACKED vanish, a non-ENOENT failure and a path that came BACK all refuse", () => {
    write("a-first.txt", "nothing to see\n");
    write("m-tracked.txt", "nothing to see\n");
    write("m-swapped.txt", "nothing to see\n");
    write("zz-last.txt", "nothing to see\n");
    commitAll();

    const tracked = run({
      detect: (ctx) => {
        if (ctx.path === "a-first.txt") rmSync(abs("m-tracked.txt"), { force: true });
      },
    });
    expect(tracked.code, tracked.err).toBe(2);
    expect(tracked.err).toContain("m-tracked.txt");
    write("m-tracked.txt", "nothing to see\n");

    const eisdir = run({
      detect: (ctx) => {
        if (ctx.path === "a-first.txt") {
          rmSync(abs("m-swapped.txt"), { force: true });
          mkdirSync(abs("m-swapped.txt"), { recursive: true });
        }
      },
    });
    expect(eisdir.code, eisdir.err).toBe(2);
    expect(eisdir.err).toContain("m-swapped.txt");
    rmSync(abs("m-swapped.txt"), { recursive: true, force: true });
    write("m-swapped.txt", "nothing to see\n");

    write("m-reappears.txt", "nothing to see\n");
    const reappeared = run({
      detect: (ctx) => {
        if (ctx.path === "a-first.txt") rmSync(abs("m-reappears.txt"), { force: true });
        if (ctx.path === "zz-last.txt") write("m-reappears.txt", "back again\n");
      },
    });
    expect(reappeared.code, reappeared.err).toBe(2);
    expect(reappeared.err).toContain("m-reappears.txt");
    expect(reappeared.out).not.toContain("OK: no hits");
  });
});

// ===========================================================================================
// AC-14: the two index-origin labels, and the per-origin footer
// ===========================================================================================

describe("AC-14: a hit in the bytes git carries says WHICH index origin it came from", () => {
  it("AC-14: labels a path whose working tree DIFFERS apart from one it never read", () => {
    write("src/index.ts", "export const x = 1;\n");
    write("differs.txt", `ssn ${SSN}\n`);
    write("gone.txt", `ssn ${SSN}\n`);
    commitAll();
    // One copy replaced by a clean decoy: the disk copy IS read and carries other bytes.
    writeFileSync(abs("differs.txt"), "nothing to see\n", "utf8");
    // ...and one removed outright: there is nothing on disk to read at all.
    rmSync(abs("gone.txt"), { force: true });

    const r = run();
    expect(r.code, r.err).toBe(1);
    expect(r.err).toContain("HIT: differs.txt (git index; the working tree differs)");
    expect(r.err).toContain("HIT: gone.txt (git index)");
    // The footer counts the hits whose remedy includes RE-STAGING, which a count of `HIT:` lines
    // cannot tell apart from a hit in the file on disk.
    expect(r.err).toContain("2 of those are in bytes git carries at that path");
  });

  it("AC-14: prints no such footer when every hit is in the file on disk", () => {
    write("leak.txt", `ssn ${SSN}\n`);
    commitAll();
    const r = run();
    expect(r.code, r.err).toBe(1);
    expect(r.err).not.toContain("in bytes git carries at that path");
    expect(r.err).not.toContain("(git index");
  });
});

// ===========================================================================================
// AC-15: an index-route refusal does not swallow a hit
// ===========================================================================================

describe("AC-15: an index-route refusal prints the walk's hits first, then refuses", () => {
  it("AC-15: over an UNMERGED index entry", () => {
    write("leak.txt", `ssn ${SSN}\n`);
    commitAll();
    fabricateUnmerged("conflict.txt", "nothing to see\n");

    const r = run();
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("HIT: leak.txt");
    expect(r.err).toContain(SSN_FINDING);
    expect(r.err).toContain("unmerged");
    expect(r.err).toContain("conflict.txt");
    expect(r.err.indexOf(SSN_FINDING)).toBeLessThan(r.err.indexOf("unmerged"));
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-15: over a TRACKED LINK, and the refusal still wins the exit code", () => {
    const outside = join(repo, "..", "phi-scan-gaps-swallow-target.txt");
    writeFileSync(outside, "nothing to see here\n", "utf8");
    try {
      write("leak.txt", `ssn ${SSN}\n`);
      symlinkSync(outside, abs("pointer.txt"));
      commitAll();
      rmSync(abs("pointer.txt"));

      const r = run();
      expect(r.code, r.err).toBe(2);
      expect(r.err).toContain("HIT: leak.txt");
      expect(r.err).toContain("pointer.txt (a symbolic link)");
      expect(r.err.indexOf(SSN_FINDING)).toBeLessThan(r.err.indexOf("a symbolic link"));
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

// ===========================================================================================
// AC-16: the --staged route keys on the caller's own scope
// ===========================================================================================

describe("AC-16: `--staged` refusals key on `isStagedReadable`, and an unmerged path says so", () => {
  /** A staged scope like the first consumer's: `src/**.ts` and the fixture tree, nothing else. */
  const stagedScope = (p: string): boolean => p.endsWith(".ts") || p.startsWith("test/fixtures/");

  it("AC-16: a staged path the caller's own scope declines is not refused on the ROOT half", () => {
    const outside = join(repo, "..", "phi-scan-gaps-staged-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      symlinkSync(outside, abs("src/notes.txt"));
      git(["add", "-A"]);
      expect(git(["diff", "--cached", "--raw", "--no-renames"]).out).toContain("120000");

      const r = run({ argv: ["--staged"], scanRoots: ["src"], isStagedReadable: stagedScope });
      expect(r.code, r.err).toBe(0);

      // THE DISCRIMINATION: the same entry under a name the scope DOES admit is refused, so this is
      // the rule rather than a route that stopped refusing.
      rmSync(abs("src/notes.txt"));
      git(["rm", "-q", "--cached", "--", "src/notes.txt"]);
      symlinkSync(outside, abs("src/notes.ts"));
      git(["add", "-A"]);
      const admitted = run({
        argv: ["--staged"],
        scanRoots: ["src"],
        isStagedReadable: stagedScope,
      });
      expect(admitted.code, admitted.err).toBe(2);
      expect(admitted.err).toContain("src/notes.ts");
      expect(admitted.err).toContain("a symbolic link");
      expect(admitted.err).not.toContain(SSN);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("AC-16: an UNMERGED staged path gets its own sentence, naming the missing stage-0 blob", () => {
    // A `U` record's destination mode is `000000`, which the mode rule would otherwise describe as
    // "a git mode-000000 entry" beside a sentence about content git holds at the path. Both halves
    // are false for a conflicted regular file, and a developer sent looking for a link finds none.
    write("src/index.ts", "export const x = 1;\n");
    commitAll();
    fabricateUnmerged("src/conflict.ts", "nothing to see\n");

    const r = run({ argv: ["--staged"], scanRoots: ["src"], isStagedReadable: stagedScope });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("src/conflict.ts");
    expect(r.err).toContain("unmerged");
    expect(r.err).toContain("no stage-0 blob");
    expect(r.err).not.toContain("a symbolic link");
    expect(r.err).not.toContain("a gitlink");
    expect(r.err).not.toContain("mode-000000");
  });

  it("AC-16: a staged path the scope admits that NO scan root covers is still refused", () => {
    // The containment the engine enforces rather than assumes, and it comes FIRST: a developer
    // whose `isStagedReadable` admits a path no root covers needs to hear that, not a sentence
    // about one entry's kind.
    const outside = join(repo, "..", "phi-scan-gaps-containment-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      mkdirSync(abs("test/fixtures"), { recursive: true });
      symlinkSync(outside, abs("test/fixtures/link.txt"));
      git(["add", "-A"]);

      const r = run({ argv: ["--staged"], scanRoots: ["src"], isStagedReadable: stagedScope });
      expect(r.code, r.err).toBe(2);
      expect(r.err).toContain("test/fixtures/link.txt");
      expect(r.err).toContain("outside every scan root");
      expect(r.err).not.toContain(SSN);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

// ===========================================================================================
// AC-17: which tier refuses a bypass
// ===========================================================================================

describe("AC-17: a bypass is refused by the tier its MODE decides, and never reaches clean", () => {
  beforeEach(() => {
    write("src/index.ts", "export const x = 1;\n");
    write("test/fixtures/decoy.txt", "nothing to see\n");
    write("phi-scan-overrides.md", "### test/fixtures/decoy.txt\n### nowhere/absent.txt\n");
    commitAll();
  });

  it("AC-17: a LONE bypass is admitted past the log gate and refused on the COMPLETENESS tier", () => {
    const r = run({ argv: ["--allow-fixture", "test/fixtures/decoy.txt"] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).not.toContain("--allow-fixture rejected");
    expect(r.err).toContain("enumerated and never read");
    expect(r.err).toContain("test/fixtures/decoy.txt");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-17: a lone bypass naming a path no route would have reached refuses on the same tier", () => {
    // In `all` mode the run's declared scope is the whole corpus, so naming a path says "this run
    // would have read that". The honest tier is the completeness rule whatever the sweep reached.
    const r = run({ argv: ["--allow-fixture", "nowhere/absent.txt"] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("enumerated and never read");
    expect(r.err).toContain("nowhere/absent.txt");
  });

  it("AC-17: a bypass BESIDE a positional path is refused on the UNMATCHED tier", () => {
    const r = run({
      argv: ["test/fixtures/decoy.txt", "--allow-fixture", "nowhere/absent.txt"],
    });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("does not enumerate");
    expect(r.err).toContain("nowhere/absent.txt");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("AC-17: an UNLOGGED bypass never reaches either tier", () => {
    const r = run({ argv: ["--allow-fixture", "test/fixtures/unlogged.txt"] });
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("--allow-fixture rejected");
    expect(r.err).toContain("phi-scan-overrides.md");
  });
});

// ===========================================================================================
// AC-18: two index states, two remedies, two messages
// ===========================================================================================

describe("AC-18: `could not read the index` and `the index holds no entries` are different states", () => {
  it("AC-18: a directory that is no repository says it could not READ the index", () => {
    const bare = mkdtempSync(join(tmpdir(), "phi-scan-gaps-bare-"));
    try {
      mkdirSync(join(bare, "scripts"), { recursive: true });
      writeFileSync(join(bare, "scripts", "phi-allow-list.txt"), "", "utf8");
      writeFileSync(join(bare, "data.txt"), "nothing to see\n", "utf8");
      const r = run({ repoRoot: bare });
      expect(r.code, r.err).toBe(2);
      expect(r.err).toContain("could not read this repository's git index");
      expect(r.err).not.toContain("holds no entries");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("AC-18: a repository whose index is EMPTY says exactly that instead", () => {
    // Nothing is committed in this repo yet, so git answers and the answer is nothing. The remedy
    // is "stage and commit the corpus", which is no help to the case above and vice versa.
    write("data.txt", "nothing to see\n");
    const r = run();
    expect(r.code, r.err).toBe(2);
    expect(r.err).toContain("the git index holds no entries");
    expect(r.err).not.toContain("could not read this repository's git index");
  });
});

// ===========================================================================================
// AC-20: a required axis is refused BY NAME, at call time
// ===========================================================================================

describe("AC-20: a missing or malformed required axis throws, naming the axis", () => {
  it("AC-20: names the axis rather than defaulting it, and reads no file first", () => {
    write("leak.txt", `ssn ${SSN}\n`);
    commitAll();

    const reached: string[] = [];
    const detect = (ctx: { path: string }): void => {
      reached.push(ctx.path);
    };
    const base = { repoRoot: repo, argv: [] as string[], detect };
    const ok = { exitCodes: CODES, scanRoots: ["."], isStagedReadable: exemptsMarkdown };

    const broken: [string, Record<string, unknown>][] = [
      ["exitCodes` is REQUIRED", { ...ok, exitCodes: undefined }],
      ["three DIFFERENT numbers", { ...ok, exitCodes: { clean: 0, hits: 1, refuse: 1 } }],
      ["must be an integer in 0..125", { ...ok, exitCodes: { clean: 0, hits: 1, refuse: 900 } }],
      ["scanRoots` is REQUIRED", { ...ok, scanRoots: undefined }],
      ["scanRoots` is REQUIRED", { ...ok, scanRoots: [] }],
      ["must be a non-empty string", { ...ok, scanRoots: [""] }],
      ["isStagedReadable` is REQUIRED", { ...ok, isStagedReadable: undefined }],
      ["isStagedReadable` is REQUIRED", { ...ok, isStagedReadable: "yes" }],
      ["excludedPaths` must be a Set", { ...ok, excludedPaths: ["a"] }],
    ];

    for (const [message, axes] of broken) {
      let thrown: unknown;
      try {
        runPhiScan({ ...base, ...axes } as unknown as Config);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, message).toBeInstanceOf(TypeError);
      expect(String(thrown)).toContain(message);
    }

    // NO CODE FROM `exitCodes` WAS RETURNED and NO FILE WAS READ: each call threw, so there is no
    // value to mistake for a verdict, and the detector never ran once.
    expect(reached).toEqual([]);
  });
});

// ===========================================================================================
// AC-8: the two settlements that NARROW what a commit gate refuses
// ===========================================================================================

describe("AC-8: every narrowing is recorded, and measured beside the route that still refuses", () => {
  it("AC-8, AC-16: the staged route stops refusing what the caller's scope declines, and `all` mode does not", () => {
    // NARROWING N1 in ADR 0003. The pre-commit route no longer refuses a staged non-regular entry
    // that `isStagedReadable` declines. Both halves are measured in one case, because the
    // compensating control is the whole reason the narrowing is acceptable.
    const outside = join(repo, "..", "phi-scan-gaps-narrowing-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      symlinkSync(outside, abs("src/notes.txt"));
      git(["add", "-A"]);

      const narrowScope = (p: string): boolean => p.endsWith(".ts");

      // THE NARROWING: the commit is not blocked by this route any more.
      const staged = run({
        argv: ["--staged"],
        scanRoots: ["src"],
        isStagedReadable: narrowScope,
      });
      expect(staged.code, staged.err).toBe(0);

      // THE COMPENSATING CONTROL, ROUTE 1: the walk refuses the entry under a scan root.
      const walk = run({ scanRoots: ["src"], isStagedReadable: narrowScope });
      expect(walk.code, walk.err).toBe(2);
      expect(walk.err).toContain("src/notes.txt");
      expect(walk.err).toContain("a symbolic link");

      // THE COMPENSATING CONTROL, ROUTE 2: with the entry gone from disk, only the INDEX can see
      // it, and it refuses the tracked mode-120000 record wherever it sits.
      rmSync(abs("src/notes.txt"));
      const index = run({ scanRoots: ["src"], isStagedReadable: narrowScope });
      expect(index.code, index.err).toBe(2);
      expect(index.err).toContain("src/notes.txt");
      expect(index.err).toContain("index entry is not a regular blob");
      expect(index.err).not.toContain(SSN);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("AC-8, AC-10: a root that became a regular FILE is scanned, and the index still covers its corpus", () => {
    // NARROWING N2 in ADR 0003. A declared root-kind axis would have refused this; derivation
    // cannot, and the sweep reads the file rather than the tree that used to be there. What keeps
    // the corpus covered is the index route, which is not narrowed by `scanRoots`.
    write("test/fixtures/patient.txt", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    // The premise: as a directory, the root's own corpus is walked and the identifier is found.
    const asDirectory = run({ scanRoots: ["test/fixtures", "src"] });
    expect(asDirectory.code, asDirectory.err).toBe(1);
    expect(asDirectory.err).toContain("HIT: test/fixtures/patient.txt\n");

    // THE NARROWING: the same root, now a regular file, is SCANNED as one target rather than
    // refused, so the walk no longer covers what was under it.
    rmSync(abs("test/fixtures"), { recursive: true, force: true });
    write("test/fixtures", "nothing to see\n");
    const asFile = run({ scanRoots: ["test/fixtures", "src"] });
    expect(asFile.code, asFile.err).toBe(1);

    // THE COMPENSATING CONTROL: the tracked corpus is still read, from the bytes git carries, and
    // the label says a developer will not find it in the file on disk.
    expect(asFile.err).toContain("HIT: test/fixtures/patient.txt (git index)");
    expect(asFile.err).toContain("in bytes git carries at that path");
  });
});
