/**
 * Guards the one thing `scripts/scaffold-parser.mjs` could never be asked about: is the repo it
 * emits format-clean on the day it is created?
 *
 * THE DEFECT. `scripts/parser-template` is `.prettierignore`d WHOLESALE, because it carries
 * `{{PLACEHOLDER}}` tokens and is not valid TS or JSON until it has been generated. So nothing in
 * this repo formatted the template, and nothing formatted the emitted tree either: every parser
 * this generator has ever minted was born with a RED `format:check`, which is a gate in the shared
 * workflow the emitted `.github/workflows/ci.yml` calls. A new repo's first CI run failed on
 * whitespace. `#56` widened this repo's own `format`/`format:check` globs to read `.mjs` and closed
 * the half a glob can reach; this is the other half, and no glob can reach it, because the input
 * does not exist until the generator runs.
 *
 * IT IS PACKAGE-NAME-LENGTH DEPENDENT, WHICH IS WHY ONE PROBE READS CLEAN AND PROVES NOTHING.
 * Substitution changes line lengths in BOTH directions, so which files come out unformatted depends
 * on the name. Measured on this template at `printWidth` 100, with the format step removed:
 *
 *   - `cli` / `x12` / `hl7` (3)  ->  test/property/round-trip.property.test.ts
 *   - `terminology` (11)         ->  src/index.ts, test/docs-content.test.ts
 *   - `a-a-a-a-a-a` (11)         ->  test/docs-content.test.ts, round-trip.property.test.ts
 *
 * A short name SHORTENS an already-wrapped import until prettier wants it collapsed onto one line;
 * a long one pushes a signature and a ternary past 100 until prettier wants them broken. The two
 * real ends red DISJOINT file sets, so measuring either one alone clears neither. The third row is
 * the axis that is easy to miss: same segment length as `terminology`, different result, because
 * the generator DROPS HYPHENS when it builds the PascalCase identifier, so the segment and the
 * identifier are two different lengths.
 *
 * WHAT IS ASSERTED, AND WHAT IS NOT. The generator now runs prettier over what it emitted, so the
 * emitted bytes are a fixed point of prettier for every name at every length, and nothing in it has
 * to be kept in step with the template's line lengths. This suite does NOT take the generator's
 * word for that: its own post-write `--check` is part of what is under test, so every case here
 * re-runs the check independently, with the globs read out of the EMITTED `package.json`, which is
 * the script the new repo's CI runs.
 *
 * SCOPE, STATED NO WIDER THAN IT HOLDS. The emitted repo would resolve `prettier` and
 * `@cosyte/prettier-config` from its own `node_modules`, and `pnpm install` is not available to a
 * test. Both the generator and this suite therefore use THIS repo's copies. That closes the gap
 * that produced the defect (nothing formatted the emitted tree at all) and leaves one open: the
 * template pins `@cosyte/prettier-config` at `^0.0.2` while this repo builds `0.0.4`, and under
 * caret-on-`0.0.x` semantics those are different releases. Measured rather than reasoned from the
 * changelog: `index.json` is BYTE-IDENTICAL across all four published versions and this repo's
 * working copy (sha256 `605a669523ab8b44...`), so nothing is hidden right now. A settings change
 * shipped without moving the template's pin would be invisible here. That is a pin question rather
 * than a formatting one, and it is not in this slice.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const TEMPLATE = join(REPO_ROOT, "scripts", "parser-template");
const DRIFT_MANIFEST = join(REPO_ROOT, "drift-manifest.json");

const resolveFrom = createRequire(import.meta.url);
const PRETTIER_BIN = resolveFrom.resolve("prettier/bin/prettier.cjs");
const PRETTIER_CONFIG = resolveFrom.resolve("@cosyte/prettier-config");

/**
 * Read out of the config the generator itself formats with, never written down here. It is the only
 * number the defect depends on: a name is "long" exactly when substitution pushes a line past it.
 */
const PRINT_WIDTH = (JSON.parse(readFileSync(PRETTIER_CONFIG, "utf8")) as { printWidth: number })
  .printWidth;

/** Scaffolding shells out three times (generator, its write, its check); the default 5s is not it. */
const SPAWN_TIMEOUT = 120_000;

/**
 * THE PROBE SET IS DERIVED FROM THE TWO THINGS THAT DECIDE THE ANSWER, AND FROM THE REPOS THIS
 * GENERATOR ACTUALLY EXISTS TO MINT. Nothing here is a list of names anyone has to maintain.
 *
 * Axis one is the package segment's length, which is what moves a line across `printWidth`. Its
 * real ends come from `drift-manifest.json`'s `targets`, the canonical roster of `@cosyte/*` parser
 * repos, so the probes track the ecosystem instead of going stale beside it: today the shortest is
 * three characters and the longest is eleven, and those two red disjoint file sets. Its ABSOLUTE
 * ends come from the generator's own rules: one character is the shortest name `[a-z][a-z0-9-]*`
 * admits, and a name of `printWidth` characters is past the point where any token-bearing line can
 * still fit, so no longer name reaches a regime that one does not.
 *
 * Axis two is the PascalCase identifier the same name produces, which is a SEPARATE length: the
 * generator drops hyphens when it builds it. The hyphenated probe is therefore built to the same
 * segment length as the longest real target, which holds axis one fixed and moves only axis two.
 */
const TARGETS = (JSON.parse(readFileSync(DRIFT_MANIFEST, "utf8")) as { targets: string[] }).targets;
const byLength = [...TARGETS].sort((a, b) => a.length - b.length || a.localeCompare(b));
const SHORTEST_REAL = byLength[0] as string;
const LONGEST_REAL = byLength[byLength.length - 1] as string;

const PROBES: Record<string, string> = {
  "shortest-possible": "a",
  "shortest-real": SHORTEST_REAL,
  "longest-real": LONGEST_REAL,
  "longest-real-hyphenated": Array.from({ length: Math.ceil(LONGEST_REAL.length / 2) }, () => "a")
    .join("-")
    .slice(0, LONGEST_REAL.length),
  saturating: "a".repeat(PRINT_WIDTH),
};

interface RunResult {
  code: number;
  out: string;
}

let root: string;
/** Emitted repos, one per probe, produced by the REAL generator. */
const emitted = new Map<string, string>();

function run(command: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(command, args, { cwd, encoding: "utf8", timeout: SPAWN_TIMEOUT });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run the generator (or a modified copy of it) and return the emitted repo's path. */
function scaffold(
  name: string,
  into: string,
  scaffolder = SCAFFOLDER,
): RunResult & { dir: string } {
  mkdirSync(into, { recursive: true });
  const result = run(process.execPath, [scaffolder, name, "--out", into], REPO_ROOT);
  return { ...result, dir: join(into, name) };
}

/**
 * The globs the EMITTED repo's own script hands prettier. Derived from the emitted `package.json`
 * rather than restated here, for the same reason the generator derives them: a list in this file
 * would be a claim about the template, and it would go stale the first time the template grows a
 * directory. The shape is asserted, so a restructure reds LOUDLY instead of quietly reducing this
 * suite to checking an empty set, which is the never-pointed-at-its-input failure the item is about.
 */
function emittedGlobs(dir: string, scriptName: "format" | "format:check"): string[] {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = (pkg.scripts?.[scriptName] ?? "").trim();
  const flag = scriptName === "format" ? "--write" : "--check";
  const matched = new RegExp(`^prettier ${flag} ((?:"[^"]+"\\s*)+)$`).exec(script);
  if (!matched) {
    throw new Error(
      `The emitted "${scriptName}" script is no longer \`prettier ${flag} "<glob>" ...\`, so this ` +
        `suite can no longer derive what the new repo checks.\n  got: ${script || "(missing)"}\n` +
        `Teach emittedGlobs() the new shape. Do not narrow it to get green.`,
    );
  }
  return [...(matched[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

function prettier(dir: string, flag: string, globs: string[]): RunResult {
  return run(process.execPath, [PRETTIER_BIN, "--config", PRETTIER_CONFIG, flag, ...globs], dir);
}

/** The emitted repo's own `format:check`, run independently of the generator's internal one. */
function formatCheck(dir: string): RunResult {
  return prettier(dir, "--check", emittedGlobs(dir, "format:check"));
}

/**
 * Repo-relative paths the emitted `format:check` would red, in prettier's own words.
 *
 * Prettier's diagnostics are dropped rather than counted as paths. `[error] No files matching the
 * pattern were found` on stderr would otherwise read as one "unformatted file", and the census
 * below asserts it found a non-empty set: a glob that matched nothing would then satisfy the
 * assertion that exists to catch exactly that. That route is unreachable today (prettier exits 2 on
 * an unmatched pattern, and the generator's own `--write` fails first), which is the point: the
 * claim is that the set is real, so it must not be true only by luck.
 */
function unformattedFiles(dir: string): string[] {
  return prettier(dir, "--list-different", emittedGlobs(dir, "format:check"))
    .out.split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[error]") && !line.startsWith("[warn]"))
    .sort();
}

function everyFileUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...everyFileUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/**
 * WHICH FILES THE EMITTED `format:check` ACTUALLY READS, DERIVED EVERY RUN AND NEVER WRITTEN DOWN.
 *
 * A count in this file would be a claim; `#56`'s first draft wrote one down and it was off by one.
 * So the census is measured with prettier itself: a throwaway copy of the emitted tree has every
 * one of its files perturbed in a way prettier always undoes (extra blank lines at end of file),
 * and `--list-different` then names exactly the files the globs matched. Nothing here decides what
 * is in scope; prettier's own glob expansion does.
 *
 * The perturbation is APPENDED rather than prepended on purpose: the emitted tree ships shebang
 * files, and text before a `#!` is a parse error, which reports as an unreadable file rather than
 * an unformatted one and would silently drop those two files from the census.
 */
function checkedCensus(dir: string): string[] {
  const copy = mkdtempSync(join(root, "census-"));
  cpSync(dir, copy, { recursive: true });
  for (const file of everyFileUnder(copy)) appendFileSync(file, "\n\n\n");
  const census = unformattedFiles(copy);
  rmSync(copy, { recursive: true, force: true });
  return census;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cosyte-scaffold-format-"));
  for (const [label, name] of Object.entries(PROBES)) {
    const result = scaffold(name, join(root, label));
    if (result.code !== 0) {
      throw new Error(`scaffolding "${label}" failed (exit ${result.code}):\n${result.out}`);
    }
    emitted.set(label, result.dir);
  }
}, SPAWN_TIMEOUT * 2);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a scaffolded parser is born format-clean", () => {
  it.each(Object.keys(PROBES))(
    "%s: the emitted tree passes the format:check its own CI will run",
    (label) => {
      const dir = emitted.get(label) as string;
      const result = formatCheck(dir);
      expect(
        result.code,
        `A repo scaffolded as "${PROBES[label]}" (${PROBES[label]?.length} chars) is born with a ` +
          `red format:check. Its first CI run fails on whitespace.\n${result.out}`,
      ).toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "checks a real, non-empty file set that does not depend on the package name",
    () => {
      // Without this, the cases above would pass just as happily against globs that match nothing,
      // which is the exact shape of the defect they exist to catch. The emitted tree carries no
      // name-derived filenames, so the census must also be identical across the probes; were it not,
      // the cases above would be covering different corpora at each end without saying so.
      const censuses = Object.keys(PROBES).map((label) =>
        checkedCensus(emitted.get(label) as string),
      );
      expect(censuses[0]?.length ?? 0).toBeGreaterThan(0);
      for (const census of censuses) expect(census).toEqual(censuses[0]);
    },
    SPAWN_TIMEOUT,
  );

  it("formats exactly the set it checks", () => {
    // If the emitted `format` and `format:check` ever name different globs, a scaffolded repo is
    // born red in the difference and `pnpm format` cannot fix it. The generator writes with the
    // first and verifies with the second, which is what makes that pair load-bearing.
    for (const dir of emitted.values()) {
      expect(emittedGlobs(dir, "format")).toEqual(emittedGlobs(dir, "format:check"));
    }
  });
});

describe("counterfactual: the same generator without its format step", () => {
  /**
   * The guard above is worth its runtime only if it fails when the format step goes away, and worth
   * its PROBE SET only if the names in it are genuinely different regimes. Both are measured here
   * rather than argued, by rebuilding the pre-fix generator out of the shipped one: a copy with the
   * `formatEmitted(...)` call textually removed. The substitution is asserted to have changed the
   * file, so a rename cannot quietly turn this into a second test of the fixed generator.
   */
  let stripped: string;
  let workspace: string;
  const red = new Map<string, string[]>();

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "cosyte-scaffold-unformatted-"));
    // The copy resolves `prettier` and `@cosyte/prettier-config` exactly as the original does, so
    // it needs this repo's `node_modules` reachable from where it sits.
    symlinkSync(join(REPO_ROOT, "node_modules"), join(workspace, "node_modules"), "dir");
    mkdirSync(join(workspace, "scripts"), { recursive: true });
    cpSync(TEMPLATE, join(workspace, "scripts", "parser-template"), { recursive: true });

    const source = readFileSync(SCAFFOLDER, "utf8");
    const withoutFormatting = source.replace(
      "formatEmitted(formatter, destDir);",
      "void formatter;",
    );
    expect(
      withoutFormatting,
      "the generator no longer calls formatEmitted(formatter, destDir), so this counterfactual is " +
        "reconstructing nothing and would pass vacuously",
    ).not.toBe(source);
    stripped = join(workspace, "scripts", "scaffold-parser.mjs");
    writeFileSync(stripped, withoutFormatting);

    for (const [label, name] of Object.entries(PROBES)) {
      const result = scaffold(name, join(workspace, label), stripped);
      if (result.code !== 0) {
        throw new Error(`stripped generator failed on "${label}" (${result.code}):\n${result.out}`);
      }
      red.set(label, unformattedFiles(result.dir));
    }
  }, SPAWN_TIMEOUT * 2);

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it.each(Object.keys(PROBES))("%s: reds without the format step", (label) => {
    // A probe that reds nothing even with the fix removed clears nothing when the fix is present.
    expect(
      red.get(label),
      `Removing the format step left "${label}" format-clean, so that probe cannot detect the ` +
        `defect and its place in the set has to be re-derived.`,
    ).not.toEqual([]);
  });

  it("reds DISJOINT file sets at the two real name lengths", () => {
    // The item's headline trap, pinned on the names this generator is actually asked for rather
    // than on constructed extremes: measuring the short end clears nothing about the long end, and
    // the reverse. If these ever overlap, one probe would have sufficed and the reason there are
    // two has changed, so re-derive rather than deleting an end to get green.
    const short = red.get("shortest-real") as string[];
    const long = red.get("longest-real") as string[];
    expect(short.filter((path) => long.includes(path))).toEqual([]);
  });

  it("reds a different set again when only the PascalCase identifier gets shorter", () => {
    // Same segment length as the longest real target, hyphens instead of letters. The generator
    // drops the hyphens when it builds the identifier, so this holds the length axis fixed and
    // moves the identifier axis alone. A probe set indexed on segment length would miss it.
    expect(red.get("longest-real-hyphenated")).not.toEqual(red.get("longest-real"));
  });
});
