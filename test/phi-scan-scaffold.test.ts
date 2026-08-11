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
 * THE SECOND DEFECT, INDEPENDENT OF THE FIRST. `--allow-fixture` withdrew a file
 * from the read set AFTER enumeration, and the empty remainder reported
 * `OK: no hits` and exit 0. Four argv shapes did it, including one with no
 * positional path at all and one on `--staged`, the route a commit is blocked
 * on. The shipped scanner now refuses over a target it enumerated and never
 * read, in every mode, comparing the two sets by DIFFERENCE so the refusal can
 * name the paths. A count cannot: it counts the targets that DID get read.
 *
 * COUNTERFACTUALS, NOT JUST ASSERTIONS. Several cases below build a deliberately
 * WEAKENED scanner out of the emitted one by textual substitution and show it
 * failing where the shipped one refuses. Each substitution is asserted to have
 * actually changed the file, so a counterfactual cannot go vacuous if the source
 * is reworded. No count is written down here, because it went stale once.
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

/** A synthetic violator INSIDE the scaffold's own corpus, and the bypass flag. */
const VIOLATOR = "test/fixtures/violator.txt";
const BYPASS = "--allow-fixture";

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
function scan(
  scanner: string,
  args: string[] = [],
  cwd = scaffold,
  env: NodeJS.ProcessEnv = process.env,
): RunResult {
  const r = spawnSync(
    process.execPath,
    [...STRIP, "--no-warnings", join(scaffold, scanner), ...args],
    {
      cwd,
      encoding: "utf8",
      env,
    },
  );
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Write a WEAKENED copy of the emitted scanner beside it, and prove the
 * weakening actually landed. A counterfactual that silently failed to apply
 * would pass every assertion below for the wrong reason.
 */
function weakenedAll(name: string, subs: [string, string][]): string {
  let source = readFileSync(join(scaffold, "scripts", "phi-scan.ts"), "utf8");
  for (const [from, to] of subs) {
    expect(source, `counterfactual "${name}" no longer matches the shipped scanner`).toContain(
      from,
    );
    source = source.replace(from, to);
  }
  const rel = join("scripts", name);
  writeFileSync(join(scaffold, rel), source, "utf8");
  return rel;
}

function weakened(name: string, from: string, to: string): string {
  return weakenedAll(name, [[from, to]]);
}

/** Collapse every run of whitespace, so a line BREAK cannot fail a content pin. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Write a file into the scaffold, `git add` it, and commit. Returns its repo path. */
function commitFile(rel: string, content: string): string {
  writeFileSync(join(scaffold, ...rel.split("/")), content, "utf8");
  git(["add", "--", rel]);
  const c = git(["commit", "-qm", `add ${rel}`, "--no-verify"]);
  expect(c.code, c.out).toBe(0);
  return rel;
}

/** `git hash-object -w --stdin`: write a blob and return its object id. */
function hashObject(content: string): string {
  const r = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: scaffold,
    input: content,
    encoding: "utf8",
  });
  expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
  return (r.stdout ?? "").trim();
}

/**
 * Put `path` into the index at stages 1/2/3 with the given contents, exactly as
 * a modify/modify conflict does.
 *
 * FABRICATED RATHER THAN MERGED, AND THE PREMISE IS ASSERTED RATHER THAN
 * ARGUED. A real `git merge` writes the conflicted BOTH-SIDES text into the
 * working tree, which the walk then reads, so the stage the INDEX route picks
 * could not be observed in isolation. Fabricating the stages leaves the working
 * tree under this test's control; the caller checks `git ls-files -s` reports
 * the three stages, so the fixture cannot go vacuous.
 */
function fabricateStages(rel: string, sides: { base: string; ours: string; theirs: string }): void {
  const rm = spawnSync("git", ["update-index", "--force-remove", "--", rel], {
    cwd: scaffold,
    encoding: "utf8",
  });
  expect(rm.status, `${rm.stdout ?? ""}${rm.stderr ?? ""}`).toBe(0);
  const info = [
    `100644 ${hashObject(sides.base)} 1\t${rel}`,
    `100644 ${hashObject(sides.ours)} 2\t${rel}`,
    `100644 ${hashObject(sides.theirs)} 3\t${rel}`,
    "",
  ].join("\n");
  const r = spawnSync("git", ["update-index", "--index-info"], {
    cwd: scaffold,
    input: info,
    encoding: "utf8",
  });
  expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
}

/**
 * Log a `--allow-fixture` bypass in the scaffold's own override log, so the
 * argument-tier gate admits it and the run reaches the completeness tiers.
 *
 * This lives here rather than in the template's own suite for one reason: the
 * template's `phi-scan-overrides.md` is COMMITTED and travels into every
 * scaffolded parser, so it must ship with no entries. A throwaway scaffold is
 * the only place a LOGGED bypass can be exercised.
 */
function logBypass(...repoPaths: string[]): void {
  const entries = repoPaths
    .map((p) => `\n### ${p}\n\n- **Date:** 2026-08-08\n- **Reason:** test\n`)
    .join("");
  writeFileSync(join(scaffold, "phi-scan-overrides.md"), entries, { flag: "a" });
}

/** A synthetic violator inside the scaffold's own corpus. */
function writeViolator(rel = VIOLATOR): string {
  writeFileSync(join(scaffold, ...rel.split("/")), "patient ssn 123-45-6789 on file\n", "utf8");
  return rel;
}

/**
 * Reset the emitted repo to its baseline commit.
 *
 * `-ff` rather than `-f`: a single `-f` leaves a NESTED GIT REPOSITORY in place,
 * and one case below plants one deliberately. Left behind, its `.git/logs`
 * carry the committer identity of whoever ran the suite, which the email floor
 * then reports as a hit in every later case. Measured, not anticipated.
 */
function resetToBaseline(): void {
  git(["reset", "-q", "--hard", "baseline"]);
  git(["clean", "-qffd"]);
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
    //
    // COMPARED WITH WHITESPACE SQUASHED, WHICH IS NOT A CONVENIENCE. The two
    // copies are formatted by two different prettier invocations (this repo's
    // check runs over the template; the scaffolder formats the emitted tree),
    // and they were measured to disagree about where to break a line that
    // lands exactly on the 100-column limit. A control that reds on a line
    // BREAK teaches the next reader to relax the control, which is the last
    // thing a pin like this should teach.
    expect(emitted).not.toContain("{{");
    for (const line of [
      "function isUnderScanRoot",
      "isUnderScanRoot(s.path) && !REGULAR_BLOB_MODES.has(s.mode)",
      '["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=d"]',
      "unscannable.push({ path: normalizePath(full), kind: direntKind(e) });",
      // The completeness rule. Each of these is a line whose loss reopens a
      // measured exit-0-over-an-unopened-corpus hole.
      'const scanPaths = mode === "paths" ? dedupeByRepoPath([...paths, ...allowFixtures]) : paths;',
      "const unmatched = [...allowed].filter((p) => !enumerated.has(p));",
      "const unread = [...enumerated].filter((p) => !read.has(p));",
      // THE UNION. The sweep reads the bytes git carries, keyed on STAGE 0, and
      // deduplicated against the walk BY CONTENT.
      '["ls-files", "-s", "-z"]',
      'if (stage === "0") entries.set(path, { mode, oid });',
      "if (readOids.get(path) === entry.oid) continue;",
      '["cat-file", "blob", entry.oid]',
      "if (index !== null) for (const p of unionCandidatePaths(index)) enumerated.add(p);",
    ]) {
      expect(squash(source)).toContain(squash(line));
      expect(squash(emitted)).toContain(squash(line));
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

    // AND `all` MODE NOW REFUSES IT TOO, which is a CHANGE the union brought
    // and is pinned here so the docblock clause about the two routes giving
    // different answers stays true only where it still is. Before the index was
    // read, the walk FOLLOWED the link and scanned whatever was on the other
    // side; once the link is TRACKED it is a mode-120000 index entry and the
    // index rule refuses. An UNTRACKED root link is still followed.
    const swept = scan("scripts/phi-scan.ts");
    expect(swept.code, swept.out).toBe(2);
    expect(swept.out).toContain("test/fixtures");
    expect(swept.out).toContain("a symbolic link");
    expect(swept.out).not.toContain("OK: no hits");
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

/**
 * THE COMPLETENESS RULE: a target the run ENUMERATED and never READ refuses.
 *
 * The defect, measured on the template's own scanner before this suite existed:
 * four argv shapes printed `OK: no hits` and exited 0 over a corpus carrying a
 * live, detectable hit, because `--allow-fixture` withdrew a file from the read
 * set AFTER enumeration and the empty remainder read as clean. Two separate
 * causes sat underneath, and the second is the sharper one: the target list was
 * seeded `paths.length > 0 ? paths : [...allowFixtures]`, so the flag seeded it
 * ONLY when no positional path was given and was a silent no-op the moment one
 * was. The violator was never ADMITTED to the run rather than withdrawn from it.
 *
 * Every case below is the exit code AND the message, because a refusal that
 * names no path is not a remedy a developer can act on, and a set DIFFERENCE is
 * the only comparison that can name one. A size comparison cannot: a count
 * counts the targets that DID get read.
 */
describe("a target enumerated but never read refuses, in every mode", () => {
  /** The four shapes that used to exit 0. Each must now name the unread path. */
  const shapes: { label: string; argv: string[] }[] = [
    // The item's own reproduction: a clean positional plus a bypass on a violator.
    { label: "a clean positional path alongside a bypass", argv: ["README.md", BYPASS, VIOLATOR] },
    // The floor of one at whole-run scope: the entire target list withdrawn.
    { label: "the same path as target and bypass", argv: [VIOLATOR, BYPASS, VIOLATOR] },
    // No positional at all. The worst of the four: it reads like a full sweep.
    { label: "a bare bypass with no positional path", argv: [BYPASS, VIOLATOR] },
    // The route a commit is actually blocked on.
    {
      label: "--staged with a bypass on the only staged violator",
      argv: ["--staged", BYPASS, VIOLATOR],
    },
  ];

  for (const { label, argv } of shapes) {
    it(`refuses: ${label}`, () => {
      resetToBaseline();
      writeViolator();
      logBypass(VIOLATOR);
      git(["add", "test/fixtures/violator.txt", "phi-scan-overrides.md"]);

      const r = scan("scripts/phi-scan.ts", argv);
      expect(r.code, r.out).toBe(2);
      expect(r.out).toContain("enumerated and never read");
      expect(r.out).toContain(VIOLATOR);
      // A refusal, not a report: the clean line must never appear beside it.
      expect(r.out).not.toContain("OK: no hits");
    });
  }

  it("THE DEFECT, REPRODUCED: without the rule the same argv exits 0 over the unopened violator", () => {
    resetToBaseline();
    writeViolator();
    logBypass(VIOLATOR);

    // Both halves restored: the conditional seed AND the missing reconciliation.
    // Either one alone still refuses (the other tier catches it), which is the
    // point of having two: this is what the pre-fix scanner did.
    const pre = weakenedAll("pre-completeness-rule.ts", [
      [
        'const scanPaths = mode === "paths" ? dedupeByRepoPath([...paths, ...allowFixtures]) : paths;',
        "const scanPaths = paths.length > 0 ? paths : [...allowFixtures];",
      ],
      [
        "const unread = [...enumerated].filter((p) => !read.has(p));",
        "const unread: string[] = [];",
      ],
      [
        "const unmatched = [...allowed].filter((p) => !enumerated.has(p));",
        "const unmatched: string[] = [];",
      ],
    ]);

    for (const argv of [
      ["README.md", "--allow-fixture", VIOLATOR],
      [VIOLATOR, "--allow-fixture", VIOLATOR],
      ["--allow-fixture", VIOLATOR],
    ]) {
      const r = scan(pre, argv);
      expect(r.code, `${argv.join(" ")}: ${r.out}`).toBe(0);
      expect(r.out).toContain("OK: no hits");
    }

    // ANTI-VACUITY: the violator is detectable the whole time. A clean report
    // over it is a miss, not an absence.
    const named = scan("scripts/phi-scan.ts", [VIOLATOR]);
    expect(named.code).toBe(1);
    expect(named.out).toContain("123-45-6789");
  });

  it("the two tiers are a union, not a duplicate: the old seed alone still refuses", () => {
    // With the seed restored but the reconciliation intact, the violator is
    // never enumerated at all, so the UNMATCHED tier catches it instead. Neither
    // tier subsumes the other, and the message says which one fired.
    resetToBaseline();
    writeViolator();
    logBypass(VIOLATOR);

    const oldSeed = weakened(
      "old-conditional-seed.ts",
      'const scanPaths = mode === "paths" ? dedupeByRepoPath([...paths, ...allowFixtures]) : paths;',
      "const scanPaths = paths.length > 0 ? paths : [...allowFixtures];",
    );
    const r = scan(oldSeed, ["README.md", "--allow-fixture", VIOLATOR]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("does not enumerate");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("refuses a bypass naming a path the run does not enumerate", () => {
    // `docs/notes.md` is nowhere near a scan root, so an all-mode run never
    // enumerates it and the flag subtracts nothing. Honouring it silently would
    // let a developer believe a file was acknowledged.
    resetToBaseline();
    mkdirSync(join(scaffold, "docs"), { recursive: true });
    writeFileSync(join(scaffold, "docs", "notes.md"), "ordinary prose\n", "utf8");
    logBypass("docs/notes.md");

    writeViolator(); // a live hit sitting in the corpus the whole time

    const r = scan("scripts/phi-scan.ts", ["--allow-fixture", "docs/notes.md"]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("does not enumerate");
    expect(r.out).toContain("docs/notes.md");
    expect(r.out).not.toContain("OK: no hits");
    // AND THE LIMIT OF THAT TIER, PINNED RATHER THAN GLOSSED: it refuses BEFORE
    // any target is read, so it prints no hit. That is not the same guarantee
    // the unread tier gives (which reports hits first), and the docblock says so
    // in those words. Loud and never green either way.
    expect(r.out).not.toContain("123-45-6789");
  });

  it("DISCLOSURE, PINNED: an allow-list that exists but cannot be READ still takes exit 1", () => {
    // The one state the emitted exit contract does NOT deliver, and says it does
    // not. `existsSync` passes, `readFileSync` throws a plain Error rather than
    // an InvocationError, nothing handles it, and the run takes node's own exit
    // 1: the code reserved for "hits found". Pre-existing, and deliberately not
    // closed by widening a catch or enumerating errno spellings (the
    // deny-list-of-spellings shape this template already retired on the attw
    // gate). This test exists so the DISCLOSURE cannot go stale: a later slice
    // that closes the escape has to come here and change the claim too.
    //
    // A DIRECTORY rather than mode 000, because a chmod is a no-op for a
    // privileged uid and this must not depend on who runs it.
    resetToBaseline();
    rmSync(join(scaffold, "scripts", "phi-allow-list.txt"), { force: true });
    mkdirSync(join(scaffold, "scripts", "phi-allow-list.txt"), { recursive: true });

    const r = scan("scripts/phi-scan.ts", ["README.md"]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).not.toContain("OK: no hits");

    // ...whereas a MISSING allow-list is the state the contract does assign: 2.
    rmSync(join(scaffold, "scripts", "phi-allow-list.txt"), { recursive: true, force: true });
    const missing = scan("scripts/phi-scan.ts", ["README.md"]);
    expect(missing.code, missing.out).toBe(2);
    expect(missing.out).toContain("allow-list not found");
  });

  it("dedupes by repo-relative path, so one file named twice is scanned once", () => {
    // PINNED ON THE ONE OBSERVABLE DEDUPE ACTUALLY HAS, which is the hit count.
    // An earlier version of this case asserted the refusal named the path once,
    // and that passed with the dedupe removed: `enumerated`, `read` and the
    // difference between them are Sets keyed on the normalized path, so a
    // duplicate collapses there whatever `parseArgs` returns. A test that the
    // rest of the code would satisfy on its own pins nothing.
    resetToBaseline();
    writeViolator();

    const r = scan("scripts/phi-scan.ts", [VIOLATOR, `./${VIOLATOR}`]);
    expect(r.code, r.out).toBe(1);
    expect(r.out.split("segment=").length - 1).toBe(1);

    // The defect, reproduced: without the dedupe the same file is read twice and
    // the same SSN is reported twice, which is a scanner that cannot count.
    const noDedupe = weakened(
      "no-dedupe.ts",
      'const scanPaths = mode === "paths" ? dedupeByRepoPath([...paths, ...allowFixtures]) : paths;',
      'const scanPaths = mode === "paths" ? [...paths, ...allowFixtures] : paths;',
    );
    const doubled = scan(noDedupe, [VIOLATOR, `./${VIOLATOR}`]);
    expect(doubled.code, doubled.out).toBe(1);
    expect(doubled.out.split("segment=").length - 1).toBe(2);
  });

  it("NEVER SWALLOWS A HIT: an incomplete run carrying hits prints both, and exits 2", () => {
    // The order matters and is asserted rather than assumed. Refusing first
    // would drop a real PHI finding on the floor; reporting the clean line
    // alongside a refusal would contradict it.
    resetToBaseline();
    writeViolator();
    logBypass("test/fixtures/ok.txt");

    const r = scan("scripts/phi-scan.ts", ["--allow-fixture", "test/fixtures/ok.txt"]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("123-45-6789"); // the hit survived
    expect(r.out).toContain("enumerated and never read");
    expect(r.out).toContain("test/fixtures/ok.txt");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("the hit footer does not advertise --allow-fixture, which now leads to exit 2", () => {
    resetToBaseline();
    writeViolator();
    const r = scan("scripts/phi-scan.ts", [VIOLATOR]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/phi-allow-list.txt");
    expect(r.out).not.toMatch(/run with --allow-fixture/);
  });

  it("POSITIVES: a bypass-free run is untouched in every mode", () => {
    // The superset proof's other polarity. Every row above moved toward a
    // REFUSAL; nothing that used to be judged is judged more leniently, and
    // nothing that used to pass now fails.
    resetToBaseline();
    expect(scan("scripts/phi-scan.ts").code).toBe(0); // all: clean corpus
    expect(scan("scripts/phi-scan.ts", ["--staged"]).code).toBe(0); // staged: empty index
    expect(scan("scripts/phi-scan.ts", ["README.md"]).code).toBe(0); // paths: clean file

    writeViolator();
    expect(scan("scripts/phi-scan.ts").code).toBe(1); // all: still catches
    expect(scan("scripts/phi-scan.ts", [VIOLATOR]).code).toBe(1); // paths: still catches
    git(["add", "test/fixtures/violator.txt"]);
    expect(scan("scripts/phi-scan.ts", ["--staged"]).code).toBe(1); // staged: still catches

    // And the floor-of-one polarity with no bypass in sight: a clean path first
    // does not hide a violator second.
    const pair = scan("scripts/phi-scan.ts", ["README.md", VIOLATOR]);
    expect(pair.code).toBe(1);
    expect(pair.out).toContain(VIOLATOR);
  });

  it("leaves the read filters alone: a skipped file is not an unread target", () => {
    // Enumeration is the run's own declaration of what it will read. A `.md`
    // file the walk skips, and a gitignored entry, are never enumerated, so the
    // rule must not fire on them. Without this the gate reds on every repo.
    resetToBaseline();
    writeFileSync(join(scaffold, "test", "fixtures", "notes.md"), "ssn 123-45-6789\n", "utf8");
    writeFileSync(join(scaffold, ".gitignore"), "test/fixtures/ignored.txt\n", { flag: "a" });
    writeFileSync(join(scaffold, "test", "fixtures", "ignored.txt"), "ssn 123-45-6789\n", "utf8");
    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("OK: no hits");
  });
});

/**
 * `all` MODE READS THE BYTES GIT CARRIES AS A UNION WITH THE WALK.
 *
 * The walk answers "what is on disk under the scan roots", which is not the same
 * question as "what does this repository carry". Where the two disagree the walk
 * was the only voice, so the sweep printed `OK: no hits` at exit 0 over TRACKED
 * bytes it never opened. Every state below is reproduced on a weakened copy of
 * the shipped scanner (the union removed, nothing else), so each case measures a
 * defect rather than asserting a feature.
 *
 * The payload is the same synthetic dashed SSN the rest of this file uses.
 */
describe("all mode reads the bytes git carries as a UNION with the walk", () => {
  /**
   * The pre-union scanner, rebuilt out of the emitted one: the union sweep AND
   * the enumeration of its candidates, which is the shape this file shipped
   * before. Nothing else changes.
   *
   * BOTH SUBSTITUTIONS ARE REQUIRED, AND THAT IS A FINDING RATHER THAN A
   * MECHANICAL DETAIL: with only the sweep removed, the completeness rule
   * refuses (exit 2) over the tracked paths the run enumerated and then never
   * read. The two halves are not redundant - one widens what the sweep reads,
   * the other refuses when something enumerated goes unread - and a half-ported
   * union is caught by the second rather than reported clean. That is pinned in
   * its own case below.
   */
  function withoutUnion(name = "no-union.ts"): string {
    return weakenedAll(name, [
      [
        "    const unionFailure = sweep(buildTargetsForGitIndex(index, readOids));",
        "    const unionFailure = sweep([]);",
      ],
      [
        "  if (index !== null) for (const p of unionCandidatePaths(index)) enumerated.add(p);",
        '  if (index !== null && false) enumerated.add("");',
      ],
    ]);
  }

  it("A HALF-PORTED UNION IS REFUSED, NOT REPORTED CLEAN", () => {
    // The interlock between the two rules, measured. Remove the union's READ
    // half and leave its enumeration in place - the shape a hurried port
    // produces - and the completeness rule names every tracked path that went
    // unread instead of letting the sweep report on a corpus it did not open.
    resetToBaseline();
    const rel = commitFile("test/fixtures/half-ported.txt", "patient ssn 123-45-6789 on file\n");
    rmSync(join(scaffold, ...rel.split("/")));

    const half = weakened(
      "half-ported-union.ts",
      "    const unionFailure = sweep(buildTargetsForGitIndex(index, readOids));",
      "    const unionFailure = sweep([]);",
    );
    const r = scan(half);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("enumerated and never read");
    expect(r.out).toContain(rel);
    expect(r.out).not.toContain("OK: no hits");
  });

  it("STATE 1: the path is occupied by a DIRECTORY, and only reading the OBJECT sees it", () => {
    // The decoy-contents shape. `git ls-files` still names the path, the walk
    // finds a DIRECTORY there and descends into it, and a path-SET
    // reconciliation cannot see it either, because the path IS present.
    resetToBaseline();
    const rel = commitFile("test/fixtures/decoy.txt", "patient ssn 123-45-6789 on file\n");
    rmSync(join(scaffold, ...rel.split("/")));
    mkdirSync(join(scaffold, ...rel.split("/")), { recursive: true });
    writeFileSync(join(scaffold, ...rel.split("/"), "inside.txt"), "nothing to see\n", "utf8");

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("123-45-6789");
    expect(r.out).toContain("as git carries it");

    // THE DEFECT, REPRODUCED: without the union the same tree reports clean.
    const before = scan(withoutUnion(), []);
    expect(before.code, before.out).toBe(0);
    expect(before.out).toContain("OK: no hits");
  });

  it("STATE 2: the working tree is SHORT, and no count can notice", () => {
    // A tracked fixture deleted from the working tree but not from the index.
    // Other files still exist, so a floor-of-one and a count both stay happy.
    resetToBaseline();
    const rel = commitFile("test/fixtures/gone.txt", "patient ssn 123-45-6789 on file\n");
    rmSync(join(scaffold, ...rel.split("/")));

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(rel);
    expect(r.out).toContain("as git carries it");

    const before = scan(withoutUnion(), []);
    expect(before.code, before.out).toBe(0);
  });

  it("STATE 3: the two copies DIFFER, and BOTH are read", () => {
    // The index carries the violator; the working tree carries a clean file of
    // the same name. The walk answers with the disk copy and nothing else asked
    // git what it was carrying.
    resetToBaseline();
    const rel = commitFile("test/fixtures/differs.txt", "patient ssn 123-45-6789 on file\n");
    writeFileSync(join(scaffold, ...rel.split("/")), "nothing to see\n", "utf8");

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("as git carries it");

    const before = scan(withoutUnion(), []);
    expect(before.code, before.out).toBe(0);
  });

  it("THE EOL AXIS: an index normalized to LF beside a CRLF working tree scans BOTH", () => {
    // The measured mechanism, not an argument from the code: with a `text`
    // attribute git stores LF and checks out (here: leaves) CRLF, so the two
    // object ids differ and the content dedupe cannot collapse them. BOTH forms
    // are scanned, which is what makes the union correct under EOL
    // normalization rather than merely untested by it.
    resetToBaseline();
    writeFileSync(join(scaffold, ".gitattributes"), "*.txt text eol=lf\n", "utf8");
    const rel = "test/fixtures/crlf.txt";
    writeFileSync(join(scaffold, ...rel.split("/")), "patient ssn 123-45-6789 on file\r\n", "utf8");
    git(["add", "--", ".gitattributes", rel]);
    expect(git(["commit", "-qm", "crlf", "--no-verify"]).code).toBe(0);

    // The git premise first: the blob git carries is LF, the file on disk is not.
    const stored = git(["cat-file", "blob", `:${rel}`]);
    expect(stored.out).not.toContain("\r\n");
    expect(readFileSync(join(scaffold, ...rel.split("/")), "utf8")).toContain("\r\n");

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(1);
    // Two loci for one path: the disk copy and the copy git carries.
    expect(r.out).toContain(`HIT: ${rel}\n`);
    expect(r.out).toContain(`HIT: ${rel} (as git carries it)`);
  });

  it("DEDUPE IS BY CONTENT: a clean checkout reads each file ONCE", () => {
    // The cost half of the union, pinned on the one observable dedupe has: the
    // hit count. On a checkout where the two copies agree, the union adds no
    // read at all and the same SSN is reported once.
    resetToBaseline();
    commitFile("test/fixtures/tracked-violator.txt", "patient ssn 123-45-6789 on file\n");

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(1);
    expect(r.out.split("segment=").length - 1).toBe(1);
    expect(r.out).not.toContain("as git carries it");

    // The defect, reproduced: with the dedupe disabled every tracked file is
    // read twice and the same SSN is reported twice, which is a scanner that
    // cannot count and a sweep that pays a subprocess per file.
    const noDedupe = weakened(
      "union-no-dedupe.ts",
      "if (readOids.get(path) === entry.oid) continue;",
      "if (false) continue;",
    );
    const doubled = scan(noDedupe);
    expect(doubled.code, doubled.out).toBe(1);
    expect(doubled.out.split("segment=").length - 1).toBe(2);
  });

  it("refuses an in-scope GITLINK, which has no bytes at that path at all", () => {
    resetToBaseline();
    const nested = join(scaffold, "test", "fixtures", "nested");
    mkdirSync(nested, { recursive: true });
    expect(spawnSync("git", ["init", "-q", "."], { cwd: nested, encoding: "utf8" }).status).toBe(0);
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: nested });
    spawnSync("git", ["config", "user.name", "test"], { cwd: nested });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: nested });
    writeFileSync(join(nested, "inner.txt"), "nothing to see\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: nested });
    spawnSync("git", ["commit", "-qm", "inner", "--no-verify"], { cwd: nested });
    git(["add", "--", "test/fixtures/nested"]);

    // The git premise: the index carries a mode-160000 entry for that path.
    expect(git(["ls-files", "-s", "--", "test/fixtures/nested"]).out).toContain("160000");

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("test/fixtures/nested");
    expect(r.out).toContain("a gitlink");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("refuses an in-scope path with NO STAGE-0 BLOB, and keys on the STAGE not the mode", () => {
    // 🛑 The trap this axis exists for. `git ls-files -s` reports an unmerged
    // path at stages 1/2/3 with ORDINARY BLOB MODES, so the mode rule cannot
    // see it, and the `--staged` route's signal (`--raw` status `U`, dest mode
    // `000000`) does not appear in this command's output at all.
    resetToBaseline();
    const rel = commitFile("test/fixtures/conflict.txt", "nothing to see\n");
    fabricateStages(rel, {
      base: "nothing to see\n",
      ours: "still nothing\n",
      theirs: "patient ssn 123-45-6789 on file\n",
    });
    // The premise, from the run's own artifact rather than from reasoning: three
    // records, stages 1/2/3, every one of them an ordinary blob mode.
    const staged = git(["ls-files", "-s", "--", rel]).out.trim().split("\n");
    expect(staged).toHaveLength(3);
    expect(staged.map((l) => l.split(" ")[0])).toEqual(["100644", "100644", "100644"]);
    expect(staged.map((l) => l.split(" ")[2]?.split("\t")[0])).toEqual(["1", "2", "3"]);

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(rel);
    expect(r.out).toContain("no stage-0 blob");
    expect(r.out).not.toContain("OK: no hits");

    // THE DEFECT, REPRODUCED, and it is the sharp one: taking the FIRST record
    // per path scans STAGE 1 - THE MERGE BASE - labels it as the bytes git
    // carries, and prints a clean line at exit 0 over a marker that lives only
    // in stage 3. The working tree copy is clean here, so nothing else covers it.
    const firstRecord = weakened(
      "stage-blind.ts",
      'if (stage === "0") entries.set(path, { mode, oid });\n    else higherStages.add(path);',
      "if (!entries.has(path)) entries.set(path, { mode, oid });",
    );
    const blind = scan(firstRecord);
    expect(blind.code, blind.out).toBe(0);
    expect(blind.out).toContain("OK: no hits");
  });

  it("refuses a REAL merge conflict too, on the sweeping route", () => {
    // The fabricated index above is the microscope; this is the ordinary tree a
    // developer actually has. The merge is EXPECTED to fail: the conflict is the
    // fixture, and this repo's committer identity is configured in beforeAll, so
    // a non-zero exit here is a conflict rather than a crash - asserted below by
    // the index's own three stages, never by the exit code alone.
    resetToBaseline();
    const rel = "test/fixtures/real-conflict.txt";
    commitFile(rel, "one\n");
    expect(git(["checkout", "-q", "-b", "u-side-a"]).code).toBe(0);
    writeFileSync(join(scaffold, ...rel.split("/")), "side a\n", "utf8");
    expect(git(["commit", "-qam", "side a", "--no-verify"]).code).toBe(0);
    expect(git(["checkout", "-q", "-b", "u-side-b", "HEAD~1"]).code).toBe(0);
    writeFileSync(join(scaffold, ...rel.split("/")), "side b\n", "utf8");
    expect(git(["commit", "-qam", "side b", "--no-verify"]).code).toBe(0);
    git(["merge", "--no-verify", "u-side-a"]);
    expect(git(["ls-files", "-s", "--", rel]).out.trim().split("\n")).toHaveLength(3);

    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain(rel);
    expect(r.out).toContain("no stage-0 blob");
    git(["merge", "--abort"]);
    git(["checkout", "-q", "main"]);
  });

  it("refuses when git cannot name the index, or names it EMPTY", () => {
    // Without the index the union cannot run and the sweep is back to the walk's
    // word alone, which is the state the rule exists to end.
    //
    // THE TWO STATES ARRIVE THROUGH DIFFERENT BRANCHES, AND BOTH PREMISES ARE
    // MEASURED HERE RATHER THAN ONE OF THEM ASSERTED. A directory that is no
    // repository at all FATALS (exit 128), so it is the `catch` that turns it
    // into a refusal; a repository whose index is empty prints nothing and
    // exits 0, so it is the size check. An earlier draft of this case measured
    // only the second and wrote prose claiming both, which reads to the next
    // porter as "the catch is redundant" and would put the non-repo run back on
    // node's own exit 1: the code this contract reserves for HITS FOUND.
    const outside = mkdtempSync(join(tmpdir(), "phi-scan-noindex-"));
    mkdirSync(join(outside, "scripts"), { recursive: true });
    mkdirSync(join(outside, "test", "fixtures"), { recursive: true });
    writeFileSync(
      join(outside, "scripts", "phi-allow-list.txt"),
      readFileSync(join(scaffold, "scripts", "phi-allow-list.txt"), "utf8"),
      "utf8",
    );
    writeFileSync(join(outside, "test", "fixtures", "ok.txt"), "nothing to see\n", "utf8");

    // No repository at all. The premise first: git FATALS here, it does not
    // answer with an empty list.
    const noRepoList = spawnSync("git", ["ls-files", "-s", "-z"], {
      cwd: outside,
      encoding: "utf8",
    });
    expect(noRepoList.status).not.toBe(0);
    expect(noRepoList.stderr).toContain("not a git repository");

    const noRepo = scan("scripts/phi-scan.ts", [], outside);
    expect(noRepo.code, noRepo.out).toBe(2);
    expect(noRepo.out).toContain("index");
    expect(noRepo.out).not.toContain("OK: no hits");
    // ...and it is NOT the allow-list refusal wearing a different hat.
    expect(noRepo.out).not.toContain("allow-list not found");

    // A repository whose index is empty reaches the same refusal by the OTHER
    // branch: exit 0 with no output, which the size check turns into `null`.
    expect(spawnSync("git", ["init", "-q", "."], { cwd: outside }).status).toBe(0);
    const emptyList = spawnSync("git", ["ls-files", "-s", "-z"], {
      cwd: outside,
      encoding: "utf8",
    });
    expect(emptyList.status).toBe(0);
    expect(emptyList.stdout).toBe("");
    const emptyIndex = scan("scripts/phi-scan.ts", [], outside);
    expect(emptyIndex.code, emptyIndex.out).toBe(2);
    expect(emptyIndex.out).toContain("index");

    rmSync(outside, { recursive: true, force: true });
  });

  it("leaves AXIS 2 alone: a TRACKED .md is still read by neither sweeping route", () => {
    // The union inherits the walk's read filter rather than getting a wider one
    // of its own. One boundary, not two: moving it is a roots-and-exclusions
    // decision, taken deliberately, not a side effect of widening the sweep.
    resetToBaseline();
    commitFile("test/fixtures/notes.md", "ssn 123-45-6789\n");
    const r = scan("scripts/phi-scan.ts");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("OK: no hits");
  });

  it("THE COMPLETENESS RULE COVERS THE UNION: a bypass on a tracked-but-absent path refuses", () => {
    // The two tiers meet here. The path is not on disk, so only the union would
    // ever read it; because the union's candidates are enumerated BEFORE the
    // sweep, the bypass is judged as SUBTRACTING SOMETHING (not as naming a
    // path the run does not enumerate), and the run then refuses for the true
    // reason: a target it enumerated and never read.
    resetToBaseline();
    const rel = commitFile("test/fixtures/absent.txt", "patient ssn 123-45-6789 on file\n");
    rmSync(join(scaffold, ...rel.split("/")));
    logBypass(rel);

    const r = scan("scripts/phi-scan.ts", [BYPASS, rel]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("enumerated and never read");
    expect(r.out).toContain(rel);
    expect(r.out).not.toContain("does not enumerate");
    expect(r.out).not.toContain("OK: no hits");
  });

  it("COSTS WHAT IT SAYS: a clean checkout invokes NO `cat-file`, and ONE `rev-parse`", () => {
    // The cost claim in the scanner's docblock, MEASURED rather than derived
    // from reading the code. A `git` shim first on PATH records every
    // invocation and then execs the real one, so the counts are the run's own
    // artifact. "No subprocess" would have been the easy sentence and it is
    // false: the content dedupe needs the repository's object format before it
    // can compare anything, which is exactly one `rev-parse` per all-mode run.
    resetToBaseline();
    commitFile("test/fixtures/tracked-clean.txt", "nothing to see\n");

    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    expect(realGit).not.toBe("");
    const shimDir = join(root, "git-shim");
    const log = join(root, "git-calls.log");
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(
      join(shimDir, "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\nexec ${realGit} "$@"\n`,
      {
        mode: 0o755,
      },
    );
    const shimmed = { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ""}` };

    writeFileSync(log, "", "utf8");
    const r = scan("scripts/phi-scan.ts", [], scaffold, shimmed);
    expect(r.code, r.out).toBe(0);
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    expect(calls.filter((c) => c.startsWith("cat-file"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("rev-parse --show-object-format"))).toHaveLength(1);

    // ...and the counterfactual, so the zero is the DEDUPE's doing rather than
    // an empty index: disable it and the union reads every tracked in-scope
    // blob through `cat-file`.
    const noDedupe = weakened(
      "union-cost-no-dedupe.ts",
      "if (readOids.get(path) === entry.oid) continue;",
      "if (false) continue;",
    );
    writeFileSync(log, "", "utf8");
    expect(scan(noDedupe, [], scaffold, shimmed).code).toBe(0);
    const dumbCalls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    expect(dumbCalls.filter((c) => c.startsWith("cat-file")).length).toBeGreaterThan(0);
  });

  it("POSITIVES: an ordinary clean tracked tree is untouched, on every route", () => {
    resetToBaseline();
    commitFile("test/fixtures/clean-tracked.txt", "nothing to see\n");
    expect(scan("scripts/phi-scan.ts").code).toBe(0);
    expect(scan("scripts/phi-scan.ts", ["--staged"]).code).toBe(0);
    expect(scan("scripts/phi-scan.ts", ["test/fixtures/clean-tracked.txt"]).code).toBe(0);
  });
});
