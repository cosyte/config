/**
 * S0330-phi-scan-consolidation, config slice: the guarantees `@cosyte/script-utils/phi-scan` owes
 * the first consumer it has ever had, and the twelve-item SUPERSET list that consumer holds the
 * engine to.
 *
 * WHY IT IS A SECOND ENGINE SUITE RATHER THAN MORE CASES IN `test/phi-scan-engine.test.ts`. That
 * file pins what became newly expressible when the machinery became a parameterised library, and
 * every case in it is a regression of something a reviewer measured. This file is keyed to a
 * SPEC: every case names the acceptance criterion or the numbered superset item it grades, which
 * is how AC-25 can ask the suite which of the twelve are covered and get an answer. Keeping the
 * two apart keeps that question answerable.
 *
 * THE SUPERSET ITEMS HAVE NO IDS OF THEIR OWN. They are prose in the spec's Contract, so AC-20
 * assigns them `SUPERSET-1` through `SUPERSET-12` in the order the list numbers them, and each
 * case below carries the token for the item it exercises.
 *
 * SECURITY / PHI: every payload here is SYNTHETIC and declared as such. `SSN` is a reserved,
 * never-issued dashed shape, `clinic.invalid` is an RFC 2606 reserved TLD, and nothing is written
 * anywhere but a throwaway temp directory this suite removes afterwards (`phi-safety` P1, P3).
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exemptsMarkdown, runPhiScan } from "@cosyte/script-utils/phi-scan";

/** A synthetic dashed identifier the cross-cutting floor detects. Never issued by anyone. */
const SSN = "123-45-6789";
/** A domain no `EMAILDOMAIN` declaration below covers. `.invalid` is reserved by RFC 2606. */
const UNDECLARED_EMAIL = "person@clinic.invalid";

const CODES = { clean: 0, hits: 1, refuse: 2 } as const;

const ENGINE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "script-utils",
  "phi-scan.js",
);

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

type Config = Parameters<typeof runPhiScan>[0];

/**
 * Run the engine and collect everything it wrote. It returns its code rather than exiting, which
 * is what lets this suite drive it in process.
 */
function run(config: Partial<Config> = {}): { code: number; out: string } {
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

/**
 * THE MOST PERMISSIVE CONFIGURATION THE OPTION SURFACE ALLOWS, which is what AC-17 and AC-18 are
 * about: the widest root, a read filter that admits every path on both sweeping routes, nothing
 * excluded, and no per-repo detector. If either guarantee were subtractable, this is the setting
 * that would subtract it.
 */
const MOST_PERMISSIVE: Partial<Config> = {
  scanRoots: ["."],
  isWalkReadable: () => true,
  isStagedReadable: () => true,
  excludedPaths: new Set<string>(),
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "phi-scan-superset-"));
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

// ===========================================================================================
// The two guarantees a caller must not be able to switch off
// ===========================================================================================

describe("the guarantees, graded as guarantees rather than as behaviour that happens to hold", () => {
  it("AC-4: no setting a caller can reach produces a clean verdict over a corpus nothing was read from", () => {
    // THE SUBTRACTIVE END OF THE OPTION SURFACE, which is the end AC-17 and AC-18 do not reach.
    // `isWalkReadable` is a READ filter, so one that admits nothing leaves both sweeping routes
    // with no target at all: the walk reads nothing and the union's candidate set is filtered by
    // the same predicate. MEASURED BEFORE THE PER-ROOT OBSERVATION RULE EXISTED: this exact
    // configuration printed `OK: no hits` and returned the CLEAN code over a tracked file
    // carrying a live dashed identifier. A caller cannot be allowed to reach that.
    write("test/fixtures/bad.txt", `ssn ${SSN}\n`);
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    const blind = run({ isWalkReadable: () => false });
    expect(blind.code, blind.out).toBe(2);
    expect(blind.out).not.toContain("OK: no hits");

    // ...and the contrast, so this is a discrimination rather than one observation: the same
    // corpus under the default read filter finds the identifier.
    const seeing = run();
    expect(seeing.code, seeing.out).toBe(1);
    expect(seeing.out).toContain("test/fixtures/bad.txt");
  });

  it("AC-17: the completeness rule survives the most permissive configuration, and names the path", () => {
    // There is no setting that turns the completeness rule off. The bypass is the only route a
    // caller has to withdraw a target it enumerated, and it is refused rather than honoured.
    write("test/fixtures/decoy.txt", "nothing to see\n");
    write("test/fixtures/other.txt", "nothing to see either\n");
    write("phi-scan-overrides.md", "### test/fixtures/decoy.txt\n");
    commitAll();

    const paths = run({
      ...MOST_PERMISSIVE,
      argv: [
        "test/fixtures/decoy.txt",
        "test/fixtures/other.txt",
        "--allow-fixture",
        "test/fixtures/decoy.txt",
      ],
    });
    expect(paths.code, paths.out).toBe(2);
    expect(paths.out).toContain("enumerated and never read");
    expect(paths.out).toContain("test/fixtures/decoy.txt");
    expect(paths.out).not.toContain("OK: no hits");

    const sweep = run({
      ...MOST_PERMISSIVE,
      argv: ["--allow-fixture", "test/fixtures/decoy.txt"],
    });
    expect(sweep.code, sweep.out).toBe(2);
    expect(sweep.out).toContain("test/fixtures/decoy.txt");
    expect(sweep.out).not.toContain("OK: no hits");
  });

  it("AC-18: the cross-cutting floor survives the most permissive configuration, and reports both shapes", () => {
    // A caller may WIDEN what is scanned and may ADD detection through `detect`. It may subtract
    // neither branch of the floor, and there is no key through which it could try.
    write("test/fixtures/bad.txt", `ssn ${SSN} and mail ${UNDECLARED_EMAIL}\n`);
    commitAll();

    const r = run(MOST_PERMISSIVE);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("test/fixtures/bad.txt");
    expect(r.out).toContain("(ssn)");
    expect(r.out).toContain("(email)");
  });

  it("AC-19: with no file at `allowListPath` nothing is declared, and the clean code is unreachable", () => {
    // THE ENGINE BAKES IN NO REPO'S RULES. If it carried a default declaration, one consumer's
    // synthetic token would travel to another consumer through a version bump, which is the
    // failure the rules/engine boundary exists to prevent.
    rmSync(abs("scripts/phi-allow-list.txt"));
    write("test/fixtures/bad.txt", `ssn ${SSN}\n`);
    commitAll();

    const missing = run();
    expect(missing.code, missing.out).toBe(2);
    expect(missing.out).toContain("allow-list not found");
    expect(missing.out).not.toContain("OK: no hits");

    // ...and an allow-list that exists and declares NOTHING leaves every PHI-shaped token
    // undeclared: a hit, never a clean run.
    write("scripts/phi-allow-list.txt", "# nothing is declared here\n");
    const empty = run();
    expect(empty.code, empty.out).toBe(1);
    expect(empty.out).toContain("test/fixtures/bad.txt");
    expect(empty.out).not.toContain("OK: no hits");

    // ...and the ONLY thing that reaches the clean code is this repo's own positive declaration.
    write("scripts/phi-allow-list.txt", `ID ${SSN}\n`);
    expect(run().code).toBe(0);
  });

  it("AC-20: the two superset items the engine did not already satisfy are closed here", () => {
    // AC-20's own summary case. SUPERSET-3 (the per-root observation rule) and SUPERSET-5 (the
    // enumeration TOCTOU window) are the two items the walk of the list found missing; the other
    // ten were already satisfied and are pinned by their own cases below. Both of these were RED
    // against the engine at the pin.
    write("src/index.ts", "export const x = 1;\n");
    write("test/fixtures/keep.txt", "nothing to see\n");
    commitAll();

    // SUPERSET-3: a root that yielded no file that was read refuses, naming the root.
    const starved = run({ scanRoots: ["src", "test/fixtures", "corpus"] });
    expect(starved.code, starved.out).toBe(2);
    expect(starved.out).toContain("corpus");

    // SUPERSET-5: an untracked file the walk listed and that is gone by read time is SKIPPED.
    write("z-untracked.txt", "nothing to see\n");
    const skipped = run({
      detect: (ctx) => {
        if (ctx.path === "src/index.ts") rmSync(abs("z-untracked.txt"), { force: true });
      },
    });
    expect(skipped.code, skipped.out).toBe(0);
    expect(skipped.out).toContain("z-untracked.txt");
    expect(skipped.out).toContain("skipped");
  });

  it("AC-21: a missing or malformed required axis throws a TypeError before any file is read", () => {
    // A MISCONFIGURED SCANNER REPORTED AS A CLEAN PASS IS THE DEFECT THIS PACKAGE EXISTS TO
    // REMOVE. Each of these throws rather than RETURNING a code, because at the point a required
    // axis is missing there is no trustworthy code to return.
    write("test/fixtures/bad.txt", `ssn ${SSN}\n`);
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
    // value to mistake for a verdict, and the detector the engine runs over every target it opens
    // never ran once.
    expect(reached).toEqual([]);
  });

  it("AC-22, SUPERSET-7: a staged path outside every scan root is refused, naming the path", () => {
    // THE MEASURED CASE. `isStagedReadable` and `scanRoots` are two independent keys and nothing
    // relates them, so a STAGED mode-120000 entry under `test/fixtures/` with roots narrowed to
    // `src` is outside every scan root: the non-regular refusal never sees it, and git hands the
    // route the LINK'S TARGET PATH as if it were content.
    const outside = join(repo, "..", "phi-scan-superset-staged-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      mkdirSync(abs("test/fixtures"), { recursive: true });
      symlinkSync(outside, abs("test/fixtures/link.txt"));
      git(["add", "-A"]);

      // The git premise first: the staged record really is a mode-120000 entry at that path.
      expect(git(["diff", "--cached", "--raw", "--no-renames"]).out).toContain("120000");

      const seen: string[] = [];
      const r = run({
        argv: ["--staged"],
        scanRoots: ["src"],
        detect: (ctx) => seen.push(ctx.path),
      });
      expect(r.code, r.out).toBe(2);
      expect(r.out).toContain("test/fixtures/link.txt");
      expect(r.out).toContain("outside every scan root");
      expect(r.out).not.toContain("OK: no hits");
      // It refuses BEFORE the read, so the link's target never reached a detector.
      expect(seen).toEqual([]);
      expect(r.out).not.toContain("phi-scan-superset-staged-target");
      expect(r.out).not.toContain(SSN);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("AC-23: a refusal and a surfaced detector message name a position and never a value or a link target", () => {
    // EVERY SURFACE ON WHICH THIS ENGINE SYNTHESISES TEXT ABOUT CONTENT IT CANNOT VOUCH FOR:
    // the non-regular refusal (which must never echo what is on the other side of a link), the
    // starved-root refusal, the skipped-target line, and the one disclosed residual, a detector's
    // own thrown message. A diagnostic ABOUT a PHI leak is itself a PHI surface
    // (`phi-safety` P4, `observability` B1 and B2).
    const outside = join(repo, "..", "phi-scan-superset-secret-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      symlinkSync(outside, abs("tools-link.txt"));

      const link = run();
      expect(link.code, link.out).toBe(2);
      // POSITION: the entry's own repo-relative path and an engine-owned token for its kind.
      expect(link.out).toContain("tools-link.txt");
      expect(link.out).toContain("a symbolic link");
      // ...and NOT the target path, NOT the bytes on the other side of it.
      expect(link.out).not.toContain("phi-scan-superset-secret-target");
      expect(link.out).not.toContain(SSN);
      rmSync(abs("tools-link.txt"));

      // A DETECTOR THAT THROWS: the message is printed verbatim, which is why the contract on
      // `DetectFn` is that it names a position. The ENGINE adds the locus and nothing else: no
      // text, no bytes, no interpolated record content.
      write("test/fixtures/record.txt", `ssn ${SSN}\n`);
      commitAll();
      const threw = run({
        detect: (ctx) => {
          if (ctx.path.startsWith("test/fixtures/record.txt")) {
            throw new Error("segment 3: unparseable");
          }
        },
      });
      expect(threw.code, threw.out).toBe(2);
      expect(threw.out).toContain("the field detector threw on test/fixtures/record.txt");
      expect(threw.out).toContain("segment 3: unparseable");
      // The engine never appends the target's own text to what the detector said.
      expect(threw.out).not.toContain("ssn 123");
      rmSync(abs("test/fixtures/record.txt"));

      // THE TWO SURFACES THIS CHANGE ADDS carry a path and a closed-set sentence, nothing else.
      write("secret/keep.md", `ssn ${SSN}\n`);
      commitAll();
      const starved = run({ scanRoots: ["src", "secret"] });
      expect(starved.code, starved.out).toBe(2);
      expect(starved.out).toContain("secret");
      expect(starved.out).not.toContain(SSN);

      write("z-vanishes.txt", `ssn ${SSN}\n`);
      const skipped = run({
        scanRoots: ["."],
        detect: (ctx) => {
          if (ctx.path === "src/index.ts") rmSync(abs("z-vanishes.txt"), { force: true });
        },
      });
      expect(skipped.out).toContain("z-vanishes.txt");
      expect(skipped.out).not.toContain(SSN);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

// ===========================================================================================
// The superset list: what the consumer holds the engine to, item by item
// ===========================================================================================

describe("SUPERSET: everything the consumer's local variant did on the engine half of the boundary", () => {
  it("SUPERSET-1: three modes plus the no-arg `all` sweep, which unions the walk with the index by CONTENT", () => {
    write("test/fixtures/tracked.txt", "the tracked bytes\n");
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    // MODE 1, explicit paths.
    const seenPaths: string[] = [];
    const paths = run({
      argv: ["test/fixtures/tracked.txt"],
      detect: (ctx) => seenPaths.push(ctx.path),
    });
    expect(paths.code, paths.out).toBe(0);
    expect(seenPaths).toEqual(["test/fixtures/tracked.txt"]);

    // MODE 2, `--staged`: exactly the blobs a commit would carry.
    write("test/fixtures/staged.txt", "staged bytes\n");
    git(["add", "-A"]);
    const seenStaged: string[] = [];
    const staged = run({ argv: ["--staged"], detect: (ctx) => seenStaged.push(ctx.path) });
    expect(staged.code, staged.out).toBe(0);
    expect(seenStaged).toContain("test/fixtures/staged.txt");
    commitAll();

    // MODE 3, the no-arg sweep, DEDUPLICATED BY CONTENT: on a clean checkout the union adds zero
    // reads, so each path is offered to the detector exactly once.
    const seenClean: string[] = [];
    const clean = run({ detect: (ctx) => seenClean.push(ctx.path) });
    expect(clean.code, clean.out).toBe(0);
    expect(seenClean.filter((p) => p.startsWith("test/fixtures/tracked.txt"))).toEqual([
      "test/fixtures/tracked.txt",
    ]);

    // ...and where the two copies DIFFER, BOTH are scanned, and the union's hit carries the label
    // so a developer is not sent to open a file that is clean.
    writeFileSync(abs("test/fixtures/tracked.txt"), `ssn ${SSN}\n`, "utf8");
    const union = run();
    expect(union.code, union.out).toBe(1);
    expect(union.out).toContain("test/fixtures/tracked.txt");
    writeFileSync(abs("test/fixtures/tracked.txt"), `clean again\n`, "utf8");
    git(["add", "-A"]);
    git(["commit", "-qm", "index carries the identifier", "--no-verify"]);
    git(["reset", "-q", "--soft", "HEAD~1"]);
  });

  it("SUPERSET-2: the completeness rule fires in EVERY mode, as a set difference that names the paths", () => {
    // A COUNT COUNTS THE TARGETS THAT DID GET READ, so `1 of 2 read` hides exactly which one did
    // not. Every mode below names the path, which is what a set difference can do and a count
    // cannot.
    write("test/fixtures/decoy.txt", "nothing to see\n");
    write("test/fixtures/other.txt", "nothing to see either\n");
    write("src/index.ts", "export const x = 1;\n");
    write("phi-scan-overrides.md", "### test/fixtures/decoy.txt\n");
    commitAll();

    const named = run({
      argv: [
        "test/fixtures/decoy.txt",
        "test/fixtures/other.txt",
        "--allow-fixture",
        "test/fixtures/decoy.txt",
      ],
    });
    expect(named.code, named.out).toBe(2);
    expect(named.out).toContain("test/fixtures/decoy.txt");
    expect(named.out).not.toContain("test/fixtures/other.txt");

    const sweep = run({ argv: ["--allow-fixture", "test/fixtures/decoy.txt"] });
    expect(sweep.code, sweep.out).toBe(2);
    expect(sweep.out).toContain("test/fixtures/decoy.txt");

    write("test/fixtures/fresh.txt", "nothing to see\n");
    write("phi-scan-overrides.md", "### test/fixtures/fresh.txt\n");
    git(["add", "-A"]);
    const staged = run({ argv: ["--staged", "--allow-fixture", "test/fixtures/fresh.txt"] });
    expect(staged.code, staged.out).toBe(2);
    expect(staged.out).toContain("test/fixtures/fresh.txt");
  });

  it("SUPERSET-3: `all` mode refuses unless EVERY scan root yielded a file that was READ, naming the starved roots", () => {
    // A ROOT THAT CONTRIBUTES NOTHING IS THE SILENTLY-NARROWED SWEEP. A typo, a directory that
    // moved, a root every read filter drops: each one leaves the run covering less than its own
    // configuration says, and the walk has no other way to say so.
    write("src/index.ts", "export const x = 1;\n");
    write("test/fixtures/data.txt", "nothing to see\n");
    commitAll();

    // The premise: with both roots yielding a read file the sweep is clean.
    expect(run({ scanRoots: ["src", "test/fixtures"] }).code).toBe(0);

    // A root that does not exist at all.
    const missing = run({ scanRoots: ["src", "corpus/elsewhere"] });
    expect(missing.code, missing.out).toBe(2);
    expect(missing.out).toContain("corpus/elsewhere");
    expect(missing.out).not.toContain("OK: no hits");

    // A root that EXISTS and is not empty, but whose every file the read filter drops. This is
    // the state the engine's own docblock names as a hole a root can fall into silently.
    write("documentation/guide.md", "nothing to see\n");
    commitAll();
    const filtered = run({ scanRoots: ["src", "documentation"] });
    expect(filtered.code, filtered.out).toBe(2);
    expect(filtered.out).toContain("documentation");

    // ...and the same root stops being starved the moment the filter admits it, so this is a
    // discrimination rather than one observation.
    expect(run({ scanRoots: ["src", "documentation"], isWalkReadable: () => true }).code).toBe(0);

    // EVERY starved root is named, not just the first: a developer who has to re-run a gate once
    // per root learns to distrust it.
    const two = run({ scanRoots: ["src", "corpus/elsewhere", "documentation"] });
    expect(two.code, two.out).toBe(2);
    expect(two.out).toContain("corpus/elsewhere");
    expect(two.out).toContain("documentation");
  });

  it("SUPERSET-4: an in-scope entry that is not a regular file refuses on BOTH enumerating routes", () => {
    const outside = join(repo, "..", "phi-scan-superset-kind-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      write("src/index.ts", "export const x = 1;\n");
      commitAll();

      // ROUTE 1, the walk's own `lstat` answer.
      symlinkSync(outside, abs("src/link.ts"));
      const walk = run();
      expect(walk.code, walk.out).toBe(2);
      expect(walk.out).toContain("src/link.ts");
      expect(walk.out).toContain("a symbolic link");
      expect(walk.out).not.toContain("phi-scan-superset-kind-target");

      // ROUTE 2, `--staged`, where git stores a symbolic link as its TARGET PATH under mode
      // 120000 and `git show :<path>` hands that text back as if it were content.
      git(["add", "-A"]);
      expect(git(["diff", "--cached", "--raw", "--no-renames"]).out).toContain("120000");
      const staged = run({ argv: ["--staged"] });
      expect(staged.code, staged.out).toBe(2);
      expect(staged.out).toContain("src/link.ts");
      expect(staged.out).toContain("a symbolic link");
      expect(staged.out).not.toContain("phi-scan-superset-kind-target");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("SUPERSET-5: the enumeration TOCTOU window skips an untracked vanished file, and refuses every other shape", () => {
    // THE WINDOW IS REAL AND IT IS NARROW. Between the walk listing a path and the sweep opening
    // it, an editor, a build or a test can remove it. For an UNTRACKED file in `all` mode that is
    // an ordinary event and the honest report is `skipped`: nothing in the repository was left
    // unaccounted for. Every other shape of the same failure refuses, because each one leaves
    // bytes this run declared it would read and then did not.
    // THE TARGET ORDER IS THE APPARATUS. The walk sorts by repo-relative path, so `.gitignore` is
    // the FIRST target every run below opens and `zz-last.txt` is the last: removing a victim from
    // the first detector call puts the removal inside the window, and re-creating it from the last
    // one puts the re-creation inside the same run.
    write("src/index.ts", "export const x = 1;\n");
    write("m-tracked.txt", "nothing to see\n");
    write("m-swapped.txt", "nothing to see\n");
    write("zz-last.txt", "nothing to see\n");
    commitAll();

    // 1. UNTRACKED and gone by read time: SKIPPED, and the skip is reported.
    write("m-untracked.txt", "nothing to see\n");
    const skipped = run({
      detect: (ctx) => {
        if (ctx.path === ".gitignore") rmSync(abs("m-untracked.txt"), { force: true });
      },
    });
    expect(skipped.code, skipped.out).toBe(0);
    expect(skipped.out).toContain("m-untracked.txt");
    expect(skipped.out).toContain("skipped");

    // 2. TRACKED and gone by read time: REFUSED. Git carries bytes at that path, so a run that
    // did not read them has no verdict about the repository.
    const tracked = run({
      detect: (ctx) => {
        if (ctx.path === ".gitignore") rmSync(abs("m-tracked.txt"), { force: true });
      },
    });
    expect(tracked.code, tracked.out).toBe(2);
    expect(tracked.out).toContain("m-tracked.txt");
    expect(tracked.out).not.toContain("OK: no hits");
    write("m-tracked.txt", "nothing to see\n");

    // 3. A NON-ENOENT read failure: REFUSED. Replacing an enumerated file with a DIRECTORY is the
    // same window with a different errno, and only the errno tells the two apart.
    const eisdir = run({
      detect: (ctx) => {
        if (ctx.path === ".gitignore") {
          rmSync(abs("m-swapped.txt"), { force: true });
          mkdirSync(abs("m-swapped.txt"), { recursive: true });
        }
      },
    });
    expect(eisdir.code, eisdir.out).toBe(2);
    expect(eisdir.out).toContain("m-swapped.txt");
    rmSync(abs("m-swapped.txt"), { force: true, recursive: true });
    write("m-swapped.txt", "nothing to see\n");

    // 4. GONE AND BACK AGAIN: REFUSED. A path that is absent at read time and present at the end
    // of the run was not merely a file being deleted; the run cannot say which bytes lived there
    // while it was looking away.
    write("m-reappears.txt", "nothing to see\n");
    const reappeared = run({
      detect: (ctx) => {
        if (ctx.path === ".gitignore") rmSync(abs("m-reappears.txt"), { force: true });
        if (ctx.path === "zz-last.txt") write("m-reappears.txt", "back again\n");
      },
    });
    expect(reappeared.code, reappeared.out).toBe(2);
    expect(reappeared.out).toContain("m-reappears.txt");
    expect(reappeared.out).not.toContain("OK: no hits");
    rmSync(abs("m-reappears.txt"), { force: true });

    // 5. `all` MODE ONLY. The same vanished untracked file named on argv REFUSES, because there
    // the caller asked for that path by name and is owed an answer about it.
    write("m-argv.txt", "nothing to see\n");
    const named = run({
      argv: ["src/index.ts", "m-argv.txt"],
      detect: (ctx) => {
        if (ctx.path === "m-argv.txt") return;
        rmSync(abs("m-argv.txt"), { force: true });
      },
    });
    expect(named.code, named.out).toBe(2);
    expect(named.out).toContain("m-argv.txt");
  });

  it("SUPERSET-6: `--allow-fixture` is rejected unless logged, and refused even when it is", () => {
    write("test/fixtures/decoy.txt", "nothing to see\n");
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    // UNLOGGED: rejected outright, naming the log it looked in.
    const unlogged = run({ argv: ["--allow-fixture", "test/fixtures/decoy.txt"] });
    expect(unlogged.code, unlogged.out).toBe(2);
    expect(unlogged.out).toContain("--allow-fixture rejected");
    expect(unlogged.out).toContain("phi-scan-overrides.md");

    // LOGGED AND ENUMERATED: admitted past the log, then refused by the completeness rule.
    write("phi-scan-overrides.md", "### test/fixtures/decoy.txt\n");
    commitAll();
    const logged = run({ argv: ["--allow-fixture", "test/fixtures/decoy.txt"] });
    expect(logged.code, logged.out).toBe(2);
    expect(logged.out).toContain("enumerated and never read");

    // LOGGED AND NOT ENUMERATED: refused by the companion tier, because a flag that subtracts
    // nothing lets a developer believe a file was acknowledged.
    write("phi-scan-overrides.md", "### test/fixtures/decoy.txt\n### nowhere/absent.txt\n");
    commitAll();
    const unmatched = run({
      scanRoots: ["src"],
      argv: ["--allow-fixture", "nowhere/absent.txt"],
    });
    expect(unmatched.code, unmatched.out).toBe(2);
    expect(unmatched.out).toContain("does not enumerate");

    // IN NO MODE DOES IT REACH THE CLEAN CODE.
    const inPaths = run({
      argv: ["test/fixtures/decoy.txt", "--allow-fixture", "test/fixtures/decoy.txt"],
    });
    expect(inPaths.code, inPaths.out).not.toBe(0);
  });

  it("SUPERSET-8: the cross-cutting floor runs over every file, always, with no detector supplied", () => {
    // NOT A FIXTURE DIRECTORY, NOT A FILE TYPE ANY DETECTOR WOULD CLAIM: hand-written source and
    // a plain text file both go through the floor, and no `detect` is configured at all.
    write("src/index.ts", `const id = "${SSN}";\nexport default id;\n`);
    write("notes/contact.txt", `${UNDECLARED_EMAIL}\n`);
    commitAll();

    const r = run();
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("src/index.ts");
    expect(r.out).toContain("notes/contact.txt");
    expect(r.out).toContain("(ssn)");
    expect(r.out).toContain("(email)");

    // A DECLARATION IS THE ONLY ANSWER, and it is per-repo: the domain has to be declared HERE.
    write("scripts/phi-allow-list.txt", `EMAILDOMAIN clinic.invalid\nID ${SSN}\n`);
    expect(run().code).toBe(0);
  });

  it("SUPERSET-9: every subprocess is `git`, invoked with array arguments, never in shell form", () => {
    // THE OBSERVABLE IS THE CALL SITE. A shell-form invocation is indistinguishable from an
    // array-form one at runtime until the day a path carries a metacharacter, and by then the
    // scan has already run. So this reads the engine's own call sites, which is the only place
    // the property is decidable, and it reads them structurally rather than by matching a
    // comment that claims the property.
    const source = readFileSync(ENGINE, "utf8");

    // No API that takes a command STRING, and no opt-in to a shell. The lookbehind keeps
    // `RAW_RECORD.exec(...)` out of it: a regex method is not a subprocess.
    expect(source).not.toMatch(/(?<![.\w])execSync\s*\(/);
    expect(source).not.toMatch(/(?<![.\w])spawnSync\s*\(/);
    expect(source).not.toMatch(/(?<![.\w])spawn\s*\(/);
    expect(source).not.toMatch(/(?<![.\w])exec\s*\(/);
    expect(source).not.toMatch(/shell\s*:/);

    // Every `execFileSync` names `git` as the file and hands it an ARRAY.
    const calls = source.match(/execFileSync\s*\(/g) ?? [];
    const gitArrayCalls = source.match(/execFileSync\s*\(\s*"git",\s*\[/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(gitArrayCalls.length).toBe(calls.length);

    // ...and the engine really does reach git: outside a repository the sweep refuses rather
    // than reporting on a working tree git cannot vouch for.
    const bare = mkdtempSync(join(tmpdir(), "phi-scan-superset-bare-"));
    try {
      mkdirSync(join(bare, "scripts"), { recursive: true });
      writeFileSync(join(bare, "scripts", "phi-allow-list.txt"), "", "utf8");
      writeFileSync(join(bare, "data.txt"), "nothing to see\n", "utf8");
      const outside = run({ repoRoot: bare });
      expect(outside.code, outside.out).toBe(2);
      expect(outside.out).toContain("index");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("SUPERSET-10: a root's KIND is derived from the filesystem, and the kinds that cannot be walked refuse", () => {
    const outside = join(repo, "..", "phi-scan-superset-root-link");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leak.txt"), `ssn ${SSN}\n`, "utf8");
    try {
      write("README.md", `ssn ${SSN}\n`);
      write("src/index.ts", "export const x = 1;\n");
      commitAll();

      // A ROOT MAY NAME A REGULAR FILE and is scanned as one target.
      const fileRoot = run({ scanRoots: ["README.md"], isWalkReadable: () => true });
      expect(fileRoot.code, fileRoot.out).toBe(1);
      expect(fileRoot.out).toContain("README.md");
      expect(fileRoot.out).not.toContain("src/index.ts");

      // A ROOT NAMING A SYMBOLIC LINK is refused rather than followed, and the target is never
      // printed: a root is the one place a link could have been followed by construction.
      symlinkSync(outside, abs("corpus"));
      const linkRoot = run({ scanRoots: ["corpus"] });
      expect(linkRoot.code, linkRoot.out).toBe(2);
      expect(linkRoot.out).toContain("corpus");
      expect(linkRoot.out).toContain("a symbolic link");
      expect(linkRoot.out).not.toContain("phi-scan-superset-root-link");
      expect(linkRoot.out).not.toContain(SSN);
      rmSync(abs("corpus"));

      // A ROOT RESOLVING OUTSIDE THE REPOSITORY is refused before anything is read: no path git
      // can name is under it, so every index-keyed rule would go silently empty.
      expect(() =>
        runPhiScan({
          repoRoot: repo,
          argv: [],
          exitCodes: CODES,
          scanRoots: ["../elsewhere"],
          isStagedReadable: exemptsMarkdown,
        }),
      ).toThrow(/resolves outside the repository/);

      // A MISSING ROOT IS SKIPPED BY THE WALK: it is not reported as an unscannable KIND and it
      // does not crash the enumeration. What it does do is contribute nothing, which is the
      // starved-root refusal of SUPERSET-3 and carries that sentence rather than this one.
      const absent = run({ scanRoots: ["src", "gone"] });
      expect(absent.code, absent.out).toBe(2);
      expect(absent.out).not.toContain("not a regular file");
      expect(absent.out).not.toContain("a symbolic link");
      expect(absent.out).toContain("gone");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("SUPERSET-11: `src`, `./src`, `src/` and the absolute path are ONE root, and all of them match index paths", () => {
    // THE MEASURED HOLE. The walk resolved `./src` fine while `isUnderScanRoot` compared it
    // against the NORMALIZED index path and never matched, so the union, the index non-blob
    // refusal and the unmerged refusal all went silently empty.
    const outside = join(repo, "..", "phi-scan-superset-normal-target.txt");
    writeFileSync(outside, `ssn ${SSN}\n`, "utf8");
    try {
      mkdirSync(abs("src"), { recursive: true });
      symlinkSync(outside, abs("src/link.ts"));
      commitAll();
      expect(git(["ls-files", "-s", "--", "src/link.ts"]).out).toContain("120000");

      for (const roots of [["src"], ["./src"], ["src/"], [abs("src")]]) {
        const r = run({ scanRoots: roots });
        expect(r.code, `${JSON.stringify(roots)}: ${r.out}`).toBe(2);
        expect(r.out).toContain("src/link.ts");
      }

      // ...and two spellings of ONE root are deduped, so nothing is walked twice.
      rmSync(abs("src/link.ts"));
      write("src/index.ts", "export const x = 1;\n");
      commitAll();
      const seen: string[] = [];
      const deduped = run({
        scanRoots: ["src", "./src", "src/"],
        detect: (ctx) => seen.push(ctx.path),
      });
      expect(deduped.code, deduped.out).toBe(0);
      expect(seen).toEqual(["src/index.ts"]);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("SUPERSET-12: EOL normalisation is machinery, not an axis: an index carrying LF and a tree carrying CRLF are BOTH scanned", () => {
    // THE DEDUPLICATION IS BY CONTENT, so a `text` attribute or `core.autocrlf` that makes the
    // two copies differ by line ending makes them two sets of bytes, and both are read. There is
    // no parameter for this and a port has nothing to set: it has to CHECK it.
    write("test/fixtures/eol.txt", "nothing to see\n");
    write("src/index.ts", "export const x = 1;\n");
    commitAll();

    // Identical bytes: one read, no `git cat-file` at all.
    const same: string[] = [];
    expect(run({ detect: (ctx) => same.push(ctx.path) }).code).toBe(0);
    expect(same.filter((p) => p.startsWith("test/fixtures/eol.txt"))).toEqual([
      "test/fixtures/eol.txt",
    ]);

    // The SAME TEXT with CRLF endings on disk: different bytes, so BOTH copies are scanned.
    writeFileSync(abs("test/fixtures/eol.txt"), "nothing to see\r\n", "utf8");
    const both: string[] = [];
    expect(run({ detect: (ctx) => both.push(ctx.path) }).code).toBe(0);
    expect(both).toContain("test/fixtures/eol.txt");
    expect(both).toContain("test/fixtures/eol.txt (as git carries it)");

    // ...and a violator living in only ONE of the two forms is still found.
    writeFileSync(abs("test/fixtures/eol.txt"), `ssn ${SSN}\r\n`, "utf8");
    const worktree = run();
    expect(worktree.code, worktree.out).toBe(1);
    expect(worktree.out).toContain("test/fixtures/eol.txt");
  });
});
