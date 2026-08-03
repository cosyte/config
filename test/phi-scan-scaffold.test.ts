/**
 * Guards the PHI scanner `scripts/parser-template/` mints into every new parser.
 *
 * THE DEFECT. A symbolic link under a scan root read CLEAN on BOTH enumerating
 * routes, so a link pointing at a PHI-bearing file passed the commit gate twice
 * over. `walk()` enumerates `Dirent.isFile()`, an lstat answer, so a link is
 * neither a file nor a directory and fell out of the loop silently; `--staged`
 * reads content with `git show :<path>`, and git stores a link as its TARGET
 * PATH under mode 120000, so that route was handed the path text and never the
 * target's bytes. The payload is detectable the whole time. The two routes never
 * looked at it.
 *
 * WHY THIS FILE IS HERE RATHER THAN IN THE TEMPLATE'S OWN SUITE. The template's
 * `test/scripts/phi-scan.test.ts` travels into a scaffolded repo and runs there,
 * against that repo's `node_modules`. Nothing in THIS repo ever executes it, so
 * a defect in the template's scanner is invisible to this repo's CI. That is the
 * same reason `test/attw-scaffold.test.ts` exists, and it is the whole point of
 * the porting campaign: `scripts/scaffold-parser.mjs` mints every new
 * `@cosyte/*` parser from this template, so a hole left here is re-minted
 * forever. This suite runs the REAL scaffolder and exercises the EMITTED
 * scanner.
 *
 * HOW THE EMITTED SCANNER IS RUN. Its shebang is `tsx`, which is a dependency of
 * the scaffolded repo and is not installed by a test. Node's own type stripping
 * runs the same source with no transform, so it stands in. If a future edit uses
 * syntax the stripper rejects, this suite reds loudly rather than skipping.
 *
 * COUNTERFACTUALS, NOT JUST ASSERTIONS. Three cases below build a deliberately
 * WEAKENED scanner out of the emitted one by textual substitution and show it
 * failing where the shipped one refuses. Each substitution is asserted to have
 * actually changed the file, so a counterfactual cannot go vacuous if the source
 * is reworded.
 *
 * SECURITY / PHI: the payload is synthetic. It is name-bearing on purpose (its
 * FILENAME carries a synthetic surname/given/DOB shape) because the no-echo
 * assertions below are vacuous against a payload with no name in it.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const TEMPLATE = join(REPO_ROOT, "scripts", "parser-template");
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");

/**
 * Node runs TypeScript by stripping types. The flag is required on 22 and the
 * behaviour is on by default from 23, where passing an unknown flag would be a
 * hard error rather than a skip.
 */
const STRIP: string[] =
  Number(process.versions.node.split(".")[0]) >= 23 ? [] : ["--experimental-strip-types"];

/** A synthetic, name-bearing payload. Nothing here is real. */
const PAYLOAD_BASENAME = "rivera-jordan-19700101.txt";
const PAYLOAD_BODY = "contact rivera.jordan@stmarysclinic.example.org ssn 123-45-6789\n";
/** The one token that must never appear in a refusal: it is off the link target. */
const TARGET_TOKEN = "rivera";

interface RunResult {
  code: number;
  out: string;
}

let root: string;
/** The emitted parser repo, produced by the real scaffolder. */
let scaffold: string;
/** The synthetic payload, deliberately OUTSIDE every scan root. */
let payload: string;

function git(args: string[], cwd = scaffold): RunResult {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run a scanner inside the emitted repo. `scanner` is repo-relative. */
function scan(scanner: string, args: string[] = [], cwd = scaffold): RunResult {
  const r = spawnSync(
    process.execPath,
    [...STRIP, "--no-warnings", join(scaffold, scanner), ...args],
    {
      cwd,
      encoding: "utf8",
    },
  );
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Write a WEAKENED copy of the emitted scanner beside it, and prove the
 * weakening actually landed. A counterfactual that silently failed to apply
 * would pass every assertion below for the wrong reason.
 */
function weakened(name: string, from: string, to: string): string {
  const source = readFileSync(join(scaffold, "scripts", "phi-scan.ts"), "utf8");
  expect(source, `counterfactual "${name}" no longer matches the shipped scanner`).toContain(from);
  const rel = join("scripts", name);
  writeFileSync(join(scaffold, rel), source.replace(from, to), "utf8");
  return rel;
}

/** Reset the emitted repo to its baseline commit. */
function resetToBaseline(): void {
  git(["reset", "-q", "--hard", "baseline"]);
  git(["clean", "-qfd"]);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "phi-scan-scaffold-"));

  payload = join(root, PAYLOAD_BASENAME);
  writeFileSync(payload, PAYLOAD_BODY, "utf8");

  // Run the real scaffolder, exactly as a human would.
  const scaffolded = spawnSync(process.execPath, [SCAFFOLDER, "demo", "--out", root], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  expect(scaffolded.status, `${scaffolded.stdout ?? ""}${scaffolded.stderr ?? ""}`).toBe(0);
  scaffold = join(root, "demo");

  // The scan roots the emitted scanner walks. The template ships neither.
  mkdirSync(join(scaffold, "test", "fixtures"), { recursive: true });
  mkdirSync(join(scaffold, "src"), { recursive: true });
  writeFileSync(join(scaffold, "src", "index.ts"), "export const x = 1;\n", "utf8");
  writeFileSync(join(scaffold, "test", "fixtures", "ok.txt"), "nothing to see\n", "utf8");

  git(["init", "-q", "."]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
  git(["config", "commit.gpgsign", "false"]);
  // The whole scaffold is the baseline. `--no-verify` because a developer box may
  // carry a global pre-commit hook; CI does not, and this repo is throwaway.
  git(["add", "-A"]);
  const committed = git(["commit", "-qm", "baseline", "--no-verify"]);
  expect(committed.code, committed.out).toBe(0);
  git(["tag", "baseline"]);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("controls: the suite is exercising the emitted scanner, and it can still pass", () => {
  it("the emitted scanner survived token substitution and matches the template", () => {
    const emitted = readFileSync(join(scaffold, "scripts", "phi-scan.ts"), "utf8");
    const source = readFileSync(join(TEMPLATE, "scripts", "phi-scan.ts"), "utf8");
    // The template's copy is tokenized; the emitted one is not.
    expect(source).toContain("{{PKG}}");
    expect(emitted).not.toContain("{{PKG}}");
    expect(emitted).toContain("@cosyte/demo");
    // Byte identity is the wrong assertion for a TOKENIZED file, and re-deriving
    // the scaffolder's token map here would couple this control to a
    // substitution it is not testing. Pin the load-bearing lines instead: these
    // are exactly what the cases below depend on, and each is a line whose loss
    // reopens a measured hole.
    expect(emitted).not.toContain("{{");
    for (const line of [
      "function isUnderScanRoot",
      "isUnderScanRoot(s.path) && !REGULAR_BLOB_MODES.has(s.mode)",
      '["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=d"]',
      "unscannable.push({ path: normalizePath(full), kind: direntKind(e) });",
    ]) {
      expect(source).toContain(line);
      expect(emitted).toContain(line);
    }
  });

  it("NEGATIVE CONTROL: pointed at the wrong package it refuses rather than reporting clean", () => {
    // Every green below has to come from the scaffolded package's own corpus and
    // its own allow-list. Run the same scanner against this repo's root, which is
    // not that package, and it must refuse rather than sweep nothing and say so.
    //
    // The code is 2, the invocation-error code, and the exact value is the
    // assertion rather than "not 0". `loadAllowList()` used to sit OUTSIDE
    // `main`'s InvocationError handler, so this route escaped as an uncaught
    // throw and took node's exit 1: the code this contract reserves for HITS
    // FOUND. A caller that branches on the code, and CI is one, read "this
    // corpus contains PHI" off a run that never opened a file.
    const wrong = scan("scripts/phi-scan.ts", [], REPO_ROOT);
    expect(wrong.code).toBe(2);
    expect(wrong.out).toMatch(/allow-list not found/);
    // ...and it is a REFUSAL, not a report: no hit line, so the 2 cannot be
    // confused for a scan that ran.
    expect(wrong.out).not.toMatch(/OK: no hits/);

    // COUNTERFACTUAL: the old placement, rebuilt out of the emitted scanner, so
    // the fix above is measured against the defect rather than asserted from a
    // changelog. Loading at the DECLARATION puts the call back outside the
    // handler (the assignment inside it never runs, because the throw comes
    // first), and the uncaught InvocationError takes node's exit 1 again.
    const unhandled = weakened(
      "allow-list-unhandled.ts",
      "  let allow: AllowList;\n",
      "  let allow: AllowList = loadAllowList();\n",
    );
    const before = scan(unhandled, [], REPO_ROOT);
    expect(before.code).toBe(1);
    expect(before.out).toMatch(/allow-list not found/);
  });

  it("an ordinary clean tree passes both routes", () => {
    resetToBaseline();
    expect(scan("scripts/phi-scan.ts").code).toBe(0);
    expect(scan("scripts/phi-scan.ts", ["--staged"]).code).toBe(0);
  });

  it("the payload is detectable, so a clean report over it is a miss and not an absence", () => {
    const named = scan("scripts/phi-scan.ts", [payload]);
    expect(named.code).toBe(1);
    expect(named.out).toContain("123-45-6789");
  });
});

describe("all mode refuses a non-regular entry under a scan root", () => {
  it("refuses a link under test/fixtures, naming the entry and its kind", () => {
    resetToBaseline();
    symlinkSync(payload, join(scaffold, "test", "fixtures", "leak.txt"));
    const r = scan("scripts/phi-scan.ts");
    expect(r.code).toBe(2);
    expect(r.out).toContain("test/fixtures/leak.txt");
    expect(r.out).toContain("a symbolic link");
  });

  it("NEVER echoes the link target, which is working-tree text that can carry PHI", () => {
    resetToBaseline();
    symlinkSync(payload, join(scaffold, "test", "fixtures", "leak.txt"));
    const r = scan("scripts/phi-scan.ts");
    expect(r.code).toBe(2);
    expect(r.out).not.toContain(TARGET_TOKEN);
    expect(r.out).not.toContain(PAYLOAD_BASENAME);
  });

  it("keeps ONE boundary: a gitignored link is exempt, and force-adding it is not a bypass", () => {
    resetToBaseline();
    writeFileSync(join(scaffold, ".gitignore"), "test/fixtures/ignored.txt\n", { flag: "a" });
    symlinkSync(payload, join(scaffold, "test", "fixtures", "ignored.txt"));
    expect(scan("scripts/phi-scan.ts").code).toBe(0);

    // `git check-ignore` is index-aware, so once the link is tracked it is no
    // longer reported ignored. That is the only reason `git add -f` cannot buy a
    // bypass, and nothing else states it.
    git(["add", "-f", "test/fixtures/ignored.txt"]);
    expect(scan("scripts/phi-scan.ts").code).toBe(2);
  });

  it("leaves the .md READ exemption alone: a regular .md file is still not read", () => {
    resetToBaseline();
    writeFileSync(join(scaffold, "test", "fixtures", "notes.md"), "ssn 123-45-6789\n", "utf8");
    expect(scan("scripts/phi-scan.ts").code).toBe(0);
  });

  it("still scans, and still catches, an ordinary regular fixture", () => {
    resetToBaseline();
    writeFileSync(join(scaffold, "test", "fixtures", "bad.txt"), "ssn 123-45-6789\n", "utf8");
    const r = scan("scripts/phi-scan.ts");
    expect(r.code).toBe(1);
    expect(r.out).toContain("test/fixtures/bad.txt");
  });
});

describe("--staged refuses a non-regular entry, and keys on the ROOT half of scope", () => {
  it("refuses a staged link under test/fixtures", () => {
    resetToBaseline();
    symlinkSync(payload, join(scaffold, "test", "fixtures", "leak.txt"));
    git(["add", "test/fixtures/leak.txt"]);
    const r = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("test/fixtures/leak.txt");
    expect(r.out).not.toContain(TARGET_TOKEN);
  });

  it("refuses a .md-named link under src/ on BOTH routes, where a shared predicate would not", () => {
    // The disagreement two sibling ports shipped: `src/notes.md` is a link, and
    // the READ filter (`src/**.ts`) drops it while the walk refuses it. Keying
    // the refusal on the read filter makes the pre-commit route pass a
    // mode-120000 blob green over a corpus all-mode refuses.
    resetToBaseline();
    symlinkSync(payload, join(scaffold, "src", "notes.md"));
    git(["add", "src/notes.md"]);

    expect(scan("scripts/phi-scan.ts").code).toBe(2);
    const staged = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(staged.code).toBe(2);
    expect(staged.out).toContain("src/notes.md");

    const collapsed = weakened(
      "collapsed-predicate.ts",
      "isUnderScanRoot(s.path) && !REGULAR_BLOB_MODES.has(s.mode)",
      "isStagedReadable(s.path) && !REGULAR_BLOB_MODES.has(s.mode)",
    );
    expect(scan(collapsed, ["--staged"]).code).toBe(0); // the defect, reproduced
  });

  it("--no-renames is load-bearing: a plain `git mv` of a link into the corpus is refused", () => {
    resetToBaseline();
    symlinkSync(payload, join(scaffold, "toplink.txt"));
    git(["add", "toplink.txt"]);
    expect(git(["commit", "-qm", "add link", "--no-verify"]).code).toBe(0);
    git(["mv", "toplink.txt", "test/fixtures/moved.txt"]);

    // The git premise first: with detection ON the rename arrives as ONE record
    // carrying TWO paths, which the two-field stride cannot read. `--no-renames`
    // decomposes it into a `D` the filter drops and a single-path `A` whose
    // destination mode is the link's.
    expect(git(["diff", "--cached", "--raw", "--diff-filter=d"]).out).toMatch(/\sR\d*\s/);
    expect(git(["diff", "--cached", "--raw", "--no-renames", "--diff-filter=d"]).out).toContain(
      "120000",
    );

    const r = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("test/fixtures/moved.txt");

    // The defect, reproduced. Under the `AMT` allow-list this template used to
    // ship, dropping `--no-renames` deleted the record outright and the route
    // reported clean (exit 0) over a mode-120000 entry in the corpus. The
    // exclusion filter no longer drops it, so the same weakening now desyncs the
    // stride and REFUSES instead. Both codes are asserted, in the same case, so
    // the flag's load-bearing half is still pinned and the polarity change is
    // shown to have moved a silent miss to a loud refusal rather than to have
    // made `--no-renames` redundant.
    const renamesOnOldFilter = weakened(
      "renames-on-old-filter.ts",
      '"-z", "--no-renames", "--diff-filter=d"',
      '"-z", "--diff-filter=AMT"',
    );
    expect(scan(renamesOnOldFilter, ["--staged"]).code).toBe(0);

    const renamesOn = weakened(
      "renames-on.ts",
      '"-z", "--no-renames", "--diff-filter=d"',
      '"-z", "--diff-filter=d"',
    );
    const desynced = scan(renamesOn, ["--staged"]);
    expect(desynced.code).toBe(2);
    expect(desynced.out).toMatch(/unrecognized record/);
  });

  it("admits typechange, so replacing a TRACKED fixture with a link is not invisible", () => {
    resetToBaseline();
    writeFileSync(join(scaffold, "test", "fixtures", "tracked.txt"), "clean\n", "utf8");
    git(["add", "test/fixtures/tracked.txt"]);
    expect(git(["commit", "-qm", "track", "--no-verify"]).code).toBe(0);
    rmSync(join(scaffold, "test", "fixtures", "tracked.txt"));
    symlinkSync(payload, join(scaffold, "test", "fixtures", "tracked.txt"));
    git(["add", "test/fixtures/tracked.txt"]);

    // The git premise: under the `AM` allow-list the record does not exist at
    // all, which is the shape an allow-list keeps producing. The exclusion filter
    // this template now ships lists it.
    expect(git(["diff", "--cached", "--raw", "--no-renames", "--diff-filter=AM"]).out.trim()).toBe(
      "",
    );
    expect(git(["diff", "--cached", "--raw", "--no-renames", "--diff-filter=d"]).out).toContain(
      "120000",
    );

    const r = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("test/fixtures/tracked.txt");
  });

  it("the status filter is an EXCLUSION: an unmerged path is listed and refused, not dropped", () => {
    // The concrete delta this template's move from `--diff-filter=AMT` to
    // `--diff-filter=d` buys. `U` is a letter the allow-list did not name, so it
    // was dropped in silence: the index holds no single blob for a conflicted
    // path, and "no record" is indistinguishable from "nothing staged here".
    // Under an exclusion filter the record arrives, its destination mode is not a
    // regular blob, and the scan refuses. An allow-list can only ever drop the
    // letters nobody thought of; this is what that costs, made concrete.
    resetToBaseline();
    const conflicted = join(scaffold, "test", "fixtures", "conflicted.txt");
    writeFileSync(conflicted, "one\n", "utf8");
    git(["add", "test/fixtures/conflicted.txt"]);
    expect(git(["commit", "-qm", "seed conflict", "--no-verify"]).code).toBe(0);
    expect(git(["checkout", "-q", "-b", "side-a"]).code).toBe(0);
    writeFileSync(conflicted, "side a\n", "utf8");
    expect(git(["commit", "-qam", "side a", "--no-verify"]).code).toBe(0);
    expect(git(["checkout", "-q", "-b", "side-b", "HEAD~1"]).code).toBe(0);
    writeFileSync(conflicted, "side b\n", "utf8");
    expect(git(["commit", "-qam", "side b", "--no-verify"]).code).toBe(0);
    // The merge is EXPECTED to fail; the conflict is the fixture.
    git(["merge", "--no-verify", "side-a"]);
    expect(git(["status", "--short"]).out).toContain("UU test/fixtures/conflicted.txt");

    // The git premise, both directions, so neither half is assumed.
    expect(git(["diff", "--cached", "--raw", "--no-renames", "--diff-filter=AMT"]).out.trim()).toBe(
      "",
    );
    const listed = git(["diff", "--cached", "--raw", "--no-renames", "--diff-filter=d"]).out;
    expect(listed).toContain("test/fixtures/conflicted.txt");
    expect(listed).toMatch(/\sU\s/);

    const r = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("test/fixtures/conflicted.txt");

    // And the counterfactual: restore the allow-list and the same tree reports
    // clean, which is the silence the polarity change removes.
    const oldFilter = weakened(
      "old-status-allow-list.ts",
      '"--no-renames", "--diff-filter=d"',
      '"--no-renames", "--diff-filter=AMT"',
    );
    expect(scan(oldFilter, ["--staged"]).code).toBe(0);
  });

  it("refuses the corpus root itself when it is staged as a link", () => {
    // Git records no index entry for a directory, so an entry at exactly
    // `test/fixtures` can only be a blob or a link: the whole corpus replaced.
    resetToBaseline();
    rmSync(join(scaffold, "test", "fixtures"), { recursive: true, force: true });
    symlinkSync(join(root, "elsewhere"), join(scaffold, "test", "fixtures"));
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    git(["add", "-A", "test"]);
    const r = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("test/fixtures");
    expect(r.out).toContain("a symbolic link");
  });

  it("still scans, and still catches, an ordinary staged fixture", () => {
    resetToBaseline();
    writeFileSync(join(scaffold, "test", "fixtures", "bad.txt"), "ssn 123-45-6789\n", "utf8");
    git(["add", "test/fixtures/bad.txt"]);
    const r = scan("scripts/phi-scan.ts", ["--staged"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("test/fixtures/bad.txt");
  });
});
