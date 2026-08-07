/**
 * Tests for scripts/attw.mjs, the wrapper that makes the `attw` publish gate
 * report its own failure.
 *
 * WHAT THESE PIN, AND WHY EACH ONE IS HERE:
 *
 *  1. THE UPSTREAM BEHAVIOUR THE WRAPPER EXISTS FOR. `attw` prints "This package
 *     does not contain types." and exits **0**. If a future `attw` upgrade fixes
 *     that exit code, this test reds, which is the point. NOTE THAT THE WRAPPER NO
 *     LONGER READS THAT SENTENCE: net 2 forces `--format json` and asserts on
 *     `analysis.types.kind`, so a REWORDING is now this counterfactual's problem
 *     and not the gate's. The sentence is pinned here as evidence of the upstream
 *     behaviour, never as the gate's mechanism.
 *  2. That the wrapper turns that exit 0 into a failure.
 *  3. That the preflight catches a declared-but-missing artifact. That is the
 *     shape the defect actually takes here: `tsup` writes JS before declarations,
 *     so every build has a window in which `dist/` holds `.mjs`/`.cjs` and no
 *     `.d.ts`.
 *  4. A NEGATIVE CONTROL. On a package whose tarball really does carry types, the
 *     wrapper is transparent: same exit status as `attw` itself, and green. A gate
 *     that only ever fails is not a gate, and a false red here would cost every
 *     later run an hour.
 *  5. THE GATE'S MOST BASIC OBLIGATION, that a real `attw` failure still fails.
 *     Without this, every other test here would pass on a wrapper that swallowed
 *     attw's own exit status, because net 2 reds the untyped fixture regardless.
 *  6. THE ARGUMENT ALLOW-LIST that keeps net 2 legible. Each spelling in that
 *     table was measured on this repo either to make the untyped sentence
 *     unreadable while attw exits 0, or to be indistinguishable from a pass. The
 *     guard is an allow-list because a deny-list bought exactly one more evasion
 *     per round: the table is kept as evidence, not as the definition of what is
 *     refused.
 *  7. THE CONFIG ROUTE, WHICH IS THE HALF THE ALLOW-LIST NEVER REACHED.
 *     `readConfig()` applies a committed `.attw.json` AFTER argv and calls
 *     `setOptionValueWithSource` for every key but three, so a config beats any
 *     argument the gate passes. There is no key deny-list any more; net 2's
 *     structural form is what closes it, and these cases pin each half:
 *     `quiet` and `format` land as an unparseable transcript, and
 *     `definitelyTyped`, which parses FINE and exits 0, lands on the
 *     `kind === "included"` assertion. That last one is the case the whole change
 *     is for, and it is pinned with its own counterfactual because it exited 0
 *     through the gate's previous shape.
 *  8. THE INHERITED npm CONFIG THAT BREAKS THE NESTED `npm pack`. `attw --pack`
 *     runs `npm pack` and opens a path it computed, so `npm_config_dry_run` (which
 *     `pnpm publish --dry-run` sets in every lifecycle script, and `prepublishOnly`
 *     runs this suite) or `npm_config_pack_destination` leaves it opening a file
 *     that was never written there. Each is planted on the bare CLI, where it must
 *     still break, and on the wrapper, where it must not.
 *
 * The fixtures are minimal throwaway packages in a temp dir, nothing to do with
 * this package's own build, so the test does not need one and cannot race one.
 * `attw` is invoked with `--no-definitely-typed` so the runs stay offline; the
 * wrapper forwards arguments, which is what makes that possible.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell form.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PKG_ROOT = process.cwd();
const WRAPPER = join(PKG_ROOT, "scripts", "attw.mjs");
const ATTW_BIN = join(PKG_ROOT, "node_modules", ".bin", "attw");
const UNTYPED = "This package does not contain types.";
/**
 * THE WRAPPER'S OWN untyped verdict, which is what net 2 now produces. It is a
 * different string from `UNTYPED` on purpose: the gate forces `--format json`, in
 * which attw renders no prose at all, so the sentence above is the BARE CLI's
 * behaviour and this one is the GATE's. Cases that mean "the gate got to analyse
 * the pack" assert this; cases that mean "attw itself said so" assert `UNTYPED`.
 */
const GATE_UNTYPED = "analysed this package as UNTYPED";
const OFFLINE = ["--no-definitely-typed"];
// Each case shells out to `attw --pack`, which runs a real `npm pack`; two of those
// in one test comfortably exceeds this suite's default timeout.
const SPAWN_TIMEOUT = 120_000;

// The npm config that decides whether and where a nested `npm pack` writes its
// tarball, in every spelling npm honours. See "the environment a nested npm pack
// must not inherit" below for why this suite strips it, and what it plants back.
const PACK_PLACEMENT_CONFIG = /^npm_config_(dry[_-]run|pack[_-]destination)$/i;

interface RunResult {
  code: number;
  out: string;
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): RunResult {
  // THIS SUITE SHELLS OUT TO `attw --pack`, WHICH RUNS A REAL `npm pack`, AND IT IS
  // ITSELF RUN FROM `prepublishOnly`. Under `pnpm publish --dry-run` that means the
  // vitest process inherits `npm_config_dry_run=true`, which makes every one of
  // those packs write nothing and every case here die on ENOENT. Stripping it here
  // is not hiding the defect: the cases below plant it back deliberately, on both
  // the bare CLI (where it still breaks, which is the counterfactual) and on the
  // wrapper (where it must not, which is the pin).
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !PACK_PLACEMENT_CONFIG.test(key)),
  );
  const r = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    timeout: 100_000,
    env: { ...base, ...extraEnv },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const runAttw = (cwd: string, extraEnv: Record<string, string> = {}): RunResult =>
  run(ATTW_BIN, ["--pack", ".", ...OFFLINE], cwd, extraEnv);
const runWrapper = (
  cwd: string,
  args: string[] = OFFLINE,
  extraEnv: Record<string, string> = {},
): RunResult => run(process.execPath, [WRAPPER, ...args], cwd, extraEnv);

let root: string;

/** A package whose declaration file exists on disk but is left out of `files`. */
let typesNotPacked: string;
/** A package whose `package.json` points at a `dist/` that was never built. */
let noBuild: string;
/** A well-formed dual ESM/CJS package: the negative control. */
let wellFormed: string;
/** A package with a real attw problem: `require` resolves to ESM. */
let attwFails: string;
/** Declarations present, JS entry point missing. attw itself is green on this. */
let jsMissing: string;

function writePkg(dir: string, pkg: Record<string, unknown>, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "attw-gate-"));

  typesNotPacked = join(root, "types-not-packed");
  writePkg(
    typesNotPacked,
    {
      name: "attw-gate-fixture-unpacked",
      version: "1.0.0",
      main: "./index.js",
      types: "./index.d.ts",
      files: ["index.js"],
    },
    { "index.js": "module.exports = {};\n", "index.d.ts": "export declare const a: number;\n" },
  );

  noBuild = join(root, "no-build");
  writePkg(
    noBuild,
    {
      name: "attw-gate-fixture-nobuild",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      files: ["dist"],
    },
    {},
  );

  wellFormed = join(root, "well-formed");
  writePkg(
    wellFormed,
    {
      name: "attw-gate-fixture-wellformed",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": {
          import: { types: "./index.d.ts", default: "./index.js" },
          require: { types: "./index.d.cts", default: "./index.cjs" },
        },
      },
      files: ["index.js", "index.d.ts", "index.cjs", "index.d.cts"],
    },
    {
      "index.js": "export const a = 1;\n",
      "index.d.ts": "export declare const a: number;\n",
      "index.cjs": "module.exports.a = 1;\n",
      "index.d.cts": "export declare const a: number;\n",
    },
  );

  // ESM-only, with no `require` condition: attw's strict profile reports
  // CJSResolvesToESM and exits non-zero of its own accord.
  attwFails = join(root, "attw-fails");
  writePkg(
    attwFails,
    {
      name: "attw-gate-fixture-problem",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
      files: ["index.js", "index.d.ts"],
    },
    { "index.js": "export const a = 1;\n", "index.d.ts": "export declare const a: number;\n" },
  );

  jsMissing = join(root, "js-missing");
  writePkg(
    jsMissing,
    {
      name: "attw-gate-fixture-jsmissing",
      version: "1.0.0",
      main: "./dist/index.js",
      types: "./index.d.ts",
      files: ["index.d.ts"],
    },
    { "index.d.ts": "export declare const a: number;\n" },
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("attw's own exit code (the reason this wrapper exists)", () => {
  it(
    "reports an untyped pack and still exits 0",
    () => {
      const r = runAttw(typesNotPacked);
      expect(r.out).toContain(UNTYPED);
      // If this ever fails because the status is now non-zero, attw has fixed the
      // early return in getExitCode() and net 2 of scripts/attw.mjs is redundant.
      // Read that file's header before deleting anything.
      expect(r.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe("scripts/attw.mjs", () => {
  it(
    "fails when the tarball carries no types, where attw exits 0",
    () => {
      const r = runWrapper(typesNotPacked);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("analysed this package as UNTYPED");
      // AND IT GOT THERE WITHOUT THE SENTENCE. The gate forces `--format json`, in
      // which attw never renders the untyped prose at all, so this assertion is
      // what distinguishes the structural net from the string match it replaced:
      // it would fail against any gate that still keyed on the sentence.
      expect(r.out).not.toContain(UNTYPED);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "fails, naming the file, when a declared artifact was never built",
    () => {
      const r = runWrapper(noBuild);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.d.ts");
      expect(r.out).toContain("missing");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "makes NO claim about attw's exit code from the preflight, in either direction",
    () => {
      // The preflight reads the MANIFEST and never the TARBALL, and the tarball is
      // what `containsTypes()` keys on, so any "attw would have..." sentence here
      // is a guess. It used to carry two of them, switched on whether a
      // declaration was among the casualties; both are deleted rather than
      // reworded. This fixture is the case that made the old wording defensible
      // (declarations intact, only JS missing: bare attw reports no problems and
      // exits 0) and it is pinned so the sentence cannot come back on this branch.
      const bare = runAttw(jsMissing);
      expect(bare.out).toContain("No problems found");
      expect(bare.code).toBe(0);
      const r = runWrapper(jsMissing);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.js");
      expect(r.out).not.toContain(UNTYPED);
      // The two sentences that were deleted, verbatim.
      expect(r.out).not.toContain("attw does not gate these");
      expect(r.out).not.toContain("EXITED 0");
      expect(r.out).toContain("attw was not run");

      // ...and on the other branch too, where the old wording asserted exit 0.
      const declarationsHit = runWrapper(noBuild);
      expect(declarationsHit.out).not.toContain("attw does not gate these");
      expect(declarationsHit.out).not.toContain("EXITED 0");
      expect(declarationsHit.out).toContain("attw was not run");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "reads `bin`, which attw never looks at at all",
    () => {
      // A manifest can promise a command that is not in the tarball, and nothing
      // else here would say so. This package declares no `bin`; the half is in
      // the gate because it is the shape every scaffolded parser inherits.
      const dir = join(root, "bin-missing");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-bin",
          version: "1.0.0",
          type: "module",
          bin: { demo: "./dist/cli.js" },
          exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
          files: ["index.js", "index.d.ts"],
        },
        { "index.js": "export const a = 1;\n", "index.d.ts": "export declare const a: number;\n" },
      );
      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/cli.js");
      expect(r.out).toContain("missing");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "checks a path declared WITHOUT a leading ./, which is legal and used to be skipped",
    () => {
      // `"types": "dist/index.d.ts"` is the spelling npm's own documentation
      // uses. The preflight used to drop it silently while still reporting it had
      // checked. `exports` leaves are deliberately not normalized: Node requires
      // `./` there, so a leaf without one is not a path of ours.
      const dir = join(root, "no-dot-slash");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-nodotslash",
          version: "1.0.0",
          type: "module",
          types: "dist/index.d.ts",
          exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
          files: ["index.js", "index.d.ts"],
        },
        { "index.js": "export const a = 1;\n", "index.d.ts": "export declare const a: number;\n" },
      );
      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("./dist/index.d.ts");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "still fails when attw itself fails, with attw's own status",
    () => {
      const bare = runAttw(attwFails);
      expect(bare.code).not.toBe(0);
      expect(bare.out).not.toContain(UNTYPED);
      const wrapped = runWrapper(attwFails);
      expect(wrapped.code).toBe(bare.code);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "is transparent on a package that really does ship types",
    () => {
      const bare = runAttw(wellFormed);
      const wrapped = runWrapper(wellFormed);
      expect(bare.out).not.toContain(UNTYPED);
      expect(wrapped.code).toBe(bare.code);
      expect(wrapped.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe("the argument allow-list that keeps the post-check readable", () => {
  // THE GUARD IS AN ALLOW-LIST, SO THIS TABLE IS NOT THE SET IT REFUSES: it is a
  // set of spellings that would each have to be enumerated by a deny-list, kept
  // here because each one was MEASURED to restore the exact false green or to be
  // indistinguishable from a pass.
  //
  // The first group blinds by hiding or reformatting attw's output, and a
  // deny-list caught them only after two rounds of enumeration (`-fjson` walked
  // through a set holding the exact token `-f`; `-qP` walked through until the
  // guard started matching short clusters per character).
  //
  // THE SECOND GROUP IS WHAT THE ALLOW-LIST BUYS, and it is the reason for the
  // change. `--help`, `-h`, `--version` and `-V` were each measured exiting 0
  // through the per-character deny-list, with the untyped sentence absent and a
  // NON-EMPTY transcript, so the empty-output net could not backstop them
  // either: the gate could not tell any of them from a pass. `--definitely-typed`
  // and `--ignore-rules` are the ones nobody had enumerated yet. None of them
  // needed a line of their own here; they fall out of allow-listing.
  it.each([
    ["--quiet", ["--quiet"]],
    ["-q", ["-q"]],
    ["--format json", ["--format", "json"]],
    ["-f json", ["-f", "json"]],
    ["--format=json", ["--format=json"]],
    ["-fjson (attached short value)", ["-fjson"]],
    ["-qP (cluster, blinding first)", ["-qP"]],
    ["-Pq (cluster, blinding second)", ["-Pq"]],
    ["--config-path", ["--config-path", "other.json"]],
    ["--help", ["--help"]],
    ["-h", ["-h"]],
    ["--version", ["--version"]],
    ["-V", ["-V"]],
    ["--definitely-typed", ["--definitely-typed", "types.tgz"]],
    ["--ignore-rules", ["--ignore-rules", "no-resolution"]],
    ["-P (--pack, harmless, refused anyway)", ["-P"]],
  ])("refuses %s", (_name, extra) => {
    const r = runWrapper(typesNotPacked, [...OFFLINE, ...extra]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("is not an argument this gate accepts");
    expect(r.out).not.toContain(UNTYPED);
  });

  it(
    "the counterfactual: --help and friends exit 0 through attw itself, sentence absent",
    () => {
      // The gate's refusal above is only worth having if these really are
      // indistinguishable from a pass underneath it. Measured, not assumed.
      for (const flag of ["--help", "-h", "--version", "-V"]) {
        const bare = run(ATTW_BIN, ["--pack", ".", ...OFFLINE, flag], typesNotPacked);
        expect(bare.code, flag).toBe(0);
        expect(bare.out, flag).not.toContain(UNTYPED);
        expect(bare.out.trim(), flag).not.toBe(""); // so the empty-output net cannot help
      }
    },
    SPAWN_TIMEOUT,
  );

  it(
    "forwards the allow-listed arguments, and does not drop or default --profile's value",
    () => {
      // A guard that refuses everything is not a guard, it is a broken script.
      //
      // THE FIXTURE HAS TO BE ONE attw JUDGES DIFFERENTLY PER PROFILE, or every
      // assertion below is `0 === 0`. `attwFails` is ESM-only with no `require`
      // condition, so the default (`strict`) reds it and `esm-only` does not.
      // The premise is asserted FIRST, on the bare CLI, so the case cannot go
      // vacuous if attw's profile behaviour ever changes.
      const noProfile = run(ATTW_BIN, ["--pack", ".", ...OFFLINE], attwFails);
      const esmOnly = run(
        ATTW_BIN,
        ["--pack", ".", ...OFFLINE, "--profile", "esm-only"],
        attwFails,
      );
      expect(noProfile.code).not.toBe(0);
      expect(esmOnly.code).toBe(0);

      // Now the wrapper, separated and fused. Each must reach attw with THIS
      // value: a dropped value or a hardcoded default reds these, because the
      // package reds under any other profile.
      const separated = runWrapper(attwFails, [...OFFLINE, "--profile", "esm-only"]);
      expect(separated.out).not.toContain("is not an argument this gate accepts");
      expect(separated.code).toBe(0);
      expect(runWrapper(attwFails, [...OFFLINE, "--profile=esm-only"]).code).toBe(0);

      // ...and the same wrapper on the same package WITHOUT a profile still reds,
      // so the greens above are the value's doing and not the fixture's.
      expect(runWrapper(attwFails, OFFLINE).code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it("refuses --profile with no value rather than forwarding a bare flag", () => {
    const r = runWrapper(typesNotPacked, [...OFFLINE, "--profile"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--profile was given with no value");
  });

  it(
    "--config-path blinds only through the file it selects, which is why it is refused",
    () => {
      // The distinction the wrapper header draws, pinned so it cannot rot into
      // the stronger and FALSE claim that the flag blinds on its own.
      const pointedAtNothing = run(
        ATTW_BIN,
        ["--pack", ".", ...OFFLINE, "--config-path", "does-not-exist.json"],
        typesNotPacked,
      );
      expect(pointedAtNothing.code).toBe(0);
      expect(pointedAtNothing.out).toContain(UNTYPED); // blinds NOTHING by itself

      const dir = join(root, "config-path-blinded");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-configpath",
          version: "1.0.0",
          main: "./index.js",
          types: "./index.d.ts",
          files: ["index.js"],
        },
        {
          "index.js": "module.exports = {};\n",
          "index.d.ts": "export declare const a: number;\n",
          "elsewhere.json": JSON.stringify({ quiet: true }),
        },
      );
      const pointedAtQuiet = run(
        ATTW_BIN,
        ["--pack", ".", ...OFFLINE, "--config-path", "elsewhere.json"],
        dir,
      );
      expect(pointedAtQuiet.code).toBe(0);
      expect(pointedAtQuiet.out).not.toContain(UNTYPED); // this is the real route
    },
    SPAWN_TIMEOUT,
  );
});

describe("the config route, which no argument guard can reach", () => {
  // `readConfig()` applies a committed `.attw.json` AFTER argv and calls
  // `setOptionValueWithSource` for every key except configPath/help/version, so a
  // config file beats every argument this gate passes. There is no key deny-list
  // any more. That was the shape the argument guard retired, and it refused only
  // `quiet` and `format` while `definitelyTyped` walked past it. Net 2's
  // structural form is what closes the route, and these cases pin each half
  // against the mechanism that closes it.

  /** A package whose tarball carries no types, plus whatever config the case needs. */
  function untypedWithConfig(name: string, config: unknown): string {
    const dir = join(root, name);
    writePkg(
      dir,
      {
        name: `attw-gate-fixture-${name}`,
        version: "1.0.0",
        main: "./index.js",
        types: "./index.d.ts",
        files: ["index.js"],
      },
      {
        // A REAL named export, so that once types are merged in attw finds no
        // problem to red on. Without it the DefinitelyTyped case below reds on
        // `NamedExports` and would pass for a reason that is not this gate's.
        "index.js": "module.exports.a = 1;\n",
        "index.d.ts": "export declare const a: number;\n",
        ".attw.json": JSON.stringify(config),
      },
    );
    return dir;
  }

  it(
    'reds on {"quiet": true}, which empties the transcript',
    () => {
      const dir = untypedWithConfig("config-quiet", { quiet: true });
      // The counterfactual: bare attw takes the config and goes silent, exit 0.
      const bare = runAttw(dir);
      expect(bare.code).toBe(0);
      expect(bare.out).not.toContain(UNTYPED);

      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("printed nothing to stdout");
    },
    SPAWN_TIMEOUT,
  );

  it(
    'reds on {"format": "table"}, which BEATS the --format json the gate passes',
    () => {
      // This is the half that proves config wins over argv: the gate appends
      // `--format json`, and readConfig overwrites it afterwards.
      const dir = untypedWithConfig("config-format", { format: "table" });
      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("not the JSON document this gate asked for");
    },
    SPAWN_TIMEOUT,
  );

  it(
    'reds on {"definitelyTyped": "<@types tarball>"}, the one the parse alone does NOT catch',
    () => {
      // THE CASE THE STRUCTURAL NET EXISTS FOR, and the one that exited 0 through
      // this gate's previous shape. `checkPackage` sets its verdict from
      // `pkg.typesPackage` ALONE, so merging a DefinitelyTyped tarball in makes a
      // tarball with no declaration file anywhere analyse as fully typed. The
      // output is valid JSON and attw exits 0, so nothing about parsing catches
      // it: `analysis.types.kind` is what does.
      const dtSrc = join(root, "dt-source");
      writePkg(
        dtSrc,
        {
          // `@types/<name>` for the victim below, so the merged declarations land
          // where TypeScript actually resolves them. A mis-named types package
          // merges in and then fails to resolve, which reds for the wrong reason.
          name: "@types/attw-gate-fixture-config-dt",
          version: "1.0.0",
          types: "./index.d.ts",
          files: ["index.d.ts"],
          homepage: "https://example.invalid",
        },
        { "index.d.ts": "export declare const a: number;\n" },
      );
      // `--no-json` PINS THE OUTPUT FORMAT THIS PARSE ASSUMES, AND IT IS NOT
      // BELT-AND-BRACES. `--silent` controls how MUCH npm prints, never in WHICH
      // FORMAT, and `json` is an ordinary npm config: any ambient `npm_config_json`
      // (or `NPM_CONFIG_JSON`) in the environment makes `npm pack` emit a JSON array
      // instead of the filename. Reading `.pop()` off that yields `]`, so the assertion
      // below fails with "expected ']' to match /\.tgz$/" on an unrelated change. This
      // reproduced deterministically in the `release` job while passing locally and in
      // `verify`, which is exactly the shape of a test that inherits its format from the
      // caller's environment. Never read npm's human output without pinning the flag.
      const packed = run("npm", ["pack", "--silent", "--no-json"], dtSrc);
      expect(packed.code, packed.out).toBe(0);
      const tgz = packed.out.trim().split("\n").filter(Boolean).pop() ?? "";
      expect(tgz).toMatch(/\.tgz$/);

      const dir = untypedWithConfig("config-dt", { definitelyTyped: "./types.tgz" });
      copyFileSync(join(dtSrc, tgz), join(dir, "types.tgz"));

      // THE COUNTERFACTUAL, MEASURED RATHER THAN ASSERTED: bare attw exits 0, the
      // untyped sentence never appears, and the JSON says the package is typed.
      // Without this the wrapper's red below could be any old failure.
      //
      // NOTE THAT THESE RUNS PASS `--no-definitely-typed`, WHICH SETS THE OPTION
      // FALSE, AND THE MERGE HAPPENS ANYWAY. That is the config route in one
      // assertion: readConfig() runs after argv, so the file overwrites even an
      // explicit flag. It also keeps these runs off the network, since the types
      // come from the local tarball.
      const bare = runAttw(dir);
      expect(bare.code).toBe(0);
      expect(bare.out).not.toContain(UNTYPED);
      const asJson = run(ATTW_BIN, ["--pack", ".", ...OFFLINE, "--format", "json"], dir);
      expect(asJson.code).toBe(0);
      const report = JSON.parse(asJson.out) as { analysis: { types: { kind: string } } };
      expect(report.analysis.types.kind).toBe("@types");

      // ...and the gate reds on it, naming the reason.
      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("did NOT come from its own");
      expect(r.out).toContain('"@types"');
    },
    SPAWN_TIMEOUT,
  );

  it(
    "CONTROL: the same fixture WITHOUT a config still reds, and a well-formed one is still green",
    () => {
      // The first half stops the cases above passing because the fixture is
      // broken in some way that has nothing to do with the config. The second is
      // the over-strictness control: `kind === "included"` must not red a package
      // that legitimately ships its own types, or the gate is worse than useless.
      const noConfig = join(root, "config-control");
      writePkg(
        noConfig,
        {
          name: "attw-gate-fixture-config-control",
          version: "1.0.0",
          main: "./index.js",
          types: "./index.d.ts",
          files: ["index.js"],
        },
        {
          "index.js": "module.exports.a = 1;\n",
          "index.d.ts": "export declare const a: number;\n",
        },
      );
      const r = runWrapper(noConfig);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("analysed this package as UNTYPED");

      const green = runWrapper(wellFormed);
      expect(green.code).toBe(0);
      expect(green.out).toContain("kind=included");
    },
    SPAWN_TIMEOUT,
  );
});

describe("what the pass line may and may not claim", () => {
  /**
   * A package whose declarations are reachable only through `exports`, so node10
   * (which does not understand `exports`) cannot resolve them. attw reds on it at
   * `strict` and exits 0 under `--profile node16`, which suppresses node10. That
   * makes it the fixture for the difference between attw's STATUS and attw's
   * FINDINGS: `getExitCode` filters `analysis.problems` for the status, while the
   * JSON document keeps the unfiltered list.
   */
  let node10Unresolvable: string;

  beforeAll(() => {
    node10Unresolvable = join(root, "node10-unresolvable");
    mkdirSync(join(node10Unresolvable, "dist"), { recursive: true });
    writeFileSync(
      join(node10Unresolvable, "package.json"),
      JSON.stringify(
        {
          name: "attw-gate-fixture-node10",
          version: "1.0.0",
          type: "module",
          exports: {
            ".": {
              import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
              require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
            },
          },
          files: ["dist"],
        },
        null,
        2,
      ),
    );
    for (const [name, body] of Object.entries({
      "dist/index.mjs": "export const a = 1;\n",
      "dist/index.d.ts": "export declare const a: number;\n",
      "dist/index.cjs": "module.exports.a = 1;\n",
      "dist/index.d.cts": "export declare const a: number;\n",
    })) {
      writeFileSync(join(node10Unresolvable, name), body);
    }
  });

  it(
    "never says `no problems` when attw reported some and only its STATUS was suppressed",
    () => {
      // THE COUNTERFACTUAL FIRST, so this cannot pass on a fixture with no problem
      // to suppress: strict reds, and `--profile node16` (which SEVERAL SIBLING
      // MANIFESTS PASS, so this is not an exotic invocation) turns the same package
      // green while the finding stays in the document.
      const strict = runAttw(node10Unresolvable);
      expect(strict.code).not.toBe(0);
      const suppressed = run(
        ATTW_BIN,
        ["--pack", ".", ...OFFLINE, "--profile", "node16"],
        node10Unresolvable,
      );
      expect(suppressed.code).toBe(0);

      const r = runWrapper(node10Unresolvable, [...OFFLINE, "--profile", "node16"]);
      expect(r.code).toBe(0);
      // BOTH WORDINGS OF THE FALSE CLAIM, pinned as absent, because the string moved
      // once already. The draft that shipped wrong said `and attw found no problems.`
      // over exactly this case; the current line says `reported no problems`. Pinning
      // only the current spelling would not have caught the draft it replaced, which
      // is the whole reason this case exists.
      expect(r.out).not.toContain("found no problems");
      expect(r.out).not.toContain("reported no problems");
      // ...and the finding is surfaced rather than swallowed by the exit code.
      expect(r.out).toContain("NoResolution");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "CONTROL: a package with genuinely no problems DOES say so",
    () => {
      // Without this the assertion above is satisfied by a gate that never claims
      // a clean bill of health, which would make the message useless.
      const r = runWrapper(wellFormed);
      expect(r.code).toBe(0);
      expect(r.out).toContain("reported no problems");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "renders a readable problem digest on the failure path, not raw JSON",
    () => {
      // The gate asks for `--format json` because net 2 reads structure, which
      // costs the human attw's table. This file calls itself a gate "made to report
      // its own failure", so the digest is what pays that back.
      const r = runWrapper(node10Unresolvable);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("attw reported 1 problem kind(s)");
      expect(r.out).toContain("NoResolution");
      expect(r.out).not.toContain('{"analysis"');
    },
    SPAWN_TIMEOUT,
  );

  it(
    "DISCLOSED AND STILL OPEN: a config that relaxes attw's exit code passes a package whose DECLARED types are not packed",
    () => {
      // THIS CASE IS EXPECTED TO PASS. It is pinned because the docblock and
      // `scripts/parser-template/CLAUDE.md` both state it as an open hole, and a
      // disclosure that names a case must name a real one. If someone closes it,
      // this reds and the prose has to be corrected in the same change.
      //
      // `kind === "included"` is `containsTypes()`: SOME TypeScript-extension file
      // in the tarball. Here the DECLARED `dist/index.d.ts` is left out of `files`
      // while an undeclared `dist/internal.d.ts` is packed, so the declared promise
      // is broken and `kind` is still "included".
      const dir = join(root, "stray-ts");
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "attw-gate-fixture-strayts",
            version: "1.0.0",
            main: "./dist/index.js",
            types: "./dist/index.d.ts",
            files: ["dist/index.js", "dist/internal.d.ts"],
          },
          null,
          2,
        ),
      );
      writeFileSync(join(dir, "dist/index.js"), "module.exports.a = 1;\n");
      writeFileSync(join(dir, "dist/index.d.ts"), "export declare const a: number;\n");
      writeFileSync(join(dir, "dist/internal.d.ts"), "export declare const b: number;\n");

      // Without a config the gate reds, on attw's own status.
      expect(runWrapper(dir).code).not.toBe(0);

      // With one that relaxes that status, it passes. THIS IS THE OPEN HALF.
      writeFileSync(
        join(dir, ".attw.json"),
        JSON.stringify({ ignoreRules: ["untyped-resolution"] }),
      );
      const r = runWrapper(dir);
      expect(r.code).toBe(0);
      // The one thing the gate still does here: it prints the finding it did not gate.
      expect(r.out).toContain("UntypedResolution");
      expect(r.out).not.toContain("reported no problems");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "reads a JSON document larger than spawnSync's default 1 MiB buffer",
    () => {
      // `--format json` is 20 to 50 times the size of the table this gate used to
      // read, so the default buffer is reachable by an ordinary package with many
      // entrypoints or unbundled declarations. Without maxBuffer the gate dies on
      // ENOBUFS: a RED on a package attw passed, and an illegible one.
      const dir = join(root, "big-output");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "attw-gate-fixture-big", version: "1.0.0", private: true }, null, 2),
      );
      writeFileSync(join(dir, "scripts", "attw.mjs"), readFileSync(WRAPPER));
      const shim = join(dir, "node_modules", ".bin", "attw");
      // A valid document, deliberately past the default buffer.
      writeFileSync(
        shim,
        `#!/usr/bin/env node\n` +
          `const pad = "x".repeat(2 * 1024 * 1024);\n` +
          `process.stdout.write(JSON.stringify({ analysis: { packageName: "big", ` +
          `packageVersion: "1.0.0", types: { kind: "included" }, pad } }) + "\\n");\n`,
      );
      chmodSync(shim, 0o755);

      // THE CONTROL: the document really is past the default, so this case is not
      // vacuous. Measured here rather than assumed from the padding constant.
      const emitted = run(process.execPath, [shim], dir);
      expect(emitted.out.length).toBeGreaterThan(1024 * 1024);

      const r = run(process.execPath, [join(dir, "scripts", "attw.mjs")], dir);
      expect(r.out).not.toContain("ENOBUFS");
      expect(r.code).toBe(0);
      expect(r.out).toContain("kind=included");
    },
    SPAWN_TIMEOUT,
  );
});

describe("the environment a nested npm pack must not inherit", () => {
  // WHAT THIS IS, AND WHY IT IS NOT AN INVENTED HAZARD. `pnpm publish --dry-run`
  // exports `npm_config_dry_run=true` into every lifecycle script it runs, and
  // `@cosyte/test-utils`'s `prepublishOnly` runs `pnpm test`, which runs this file.
  // Under that variable `npm pack` prints its listing and writes no tarball, so
  // every `attw --pack` here opened a file that was never written: seven cases red
  // with `ENOENT`, on a Version PR, on a tree whose only change was a CHANGELOG.
  // It hid until then because `publish --dry-run` SKIPS a version already on npm,
  // so the chain runs on nothing but a version bump.
  //
  // The plants below are the whole of that fault, reproduced without a publish.

  /**
   * The spellings that reach npm THROUGH THIS ROUTE. attw packs with
   * `execSync("npm pack")`, so the variable has to survive a shell; see the case
   * below for the one npm honours that does not.
   */
  const DRY_RUN_SPELLINGS: [string, Record<string, string>][] = [
    ["npm_config_dry_run", { npm_config_dry_run: "true" }],
    ["NPM_CONFIG_DRY_RUN (npm lower-cases the key)", { NPM_CONFIG_DRY_RUN: "true" }],
  ];

  it(
    "COUNTERFACTUAL: bare attw dies on ENOENT under an inherited npm dry run",
    () => {
      // Without this, every case below could pass on a wrapper that changed
      // nothing, because a plant that does not break anything proves nothing.
      const r = runAttw(typesNotPacked, { npm_config_dry_run: "true" });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("ENOENT");
      // And the gate goes BLIND rather than merely noisy: the sentence net 2 reads
      // is absent, because there was no tarball to analyse.
      expect(r.out).not.toContain(UNTYPED);
    },
    SPAWN_TIMEOUT,
  );

  it.each(DRY_RUN_SPELLINGS)(
    "the wrapper still gates an untyped pack with %s planted",
    (_name, env) => {
      const r = runWrapper(typesNotPacked, OFFLINE, env);
      expect(r.out).toContain(GATE_UNTYPED);
      expect(r.out).not.toContain("ENOENT");
      expect(r.code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "the hyphen spelling reaches npm only if /bin/sh forwards it, and the wrapper holds either way",
    () => {
      // WHY THIS CASE MEASURES THE SHELL INSTEAD OF ASSERTING ONE ANSWER. npm
      // honours `npm_config_dry-run` too, but attw packs with
      // `execSync("npm pack")`, so the variable has to cross `/bin/sh`, and that
      // name is not a valid shell identifier. DASH, which Debian and Ubuntu ship as
      // `/bin/sh` (so the CI runner too), drops it; BASH forwards it, including when
      // it is invoked as `sh`. Two earlier drafts of this case got that wrong in opposite
      // directions: the first planted the hyphen through the wrapper as though it
      // pinned something (it passes against the unfixed wrapper, so it pinned
      // nothing), the second asserted dash's answer as a property of shells, which
      // would red on a box where `/bin/sh` is bash.
      // `/bin/sh` LITERALLY, not `sh` from PATH: `execSync` takes the former, and a
      // PATH holding a different `sh` would have this case measuring one shell and
      // attw using another. Both mismatch directions fail red rather than green,
      // but red for a reason that is not about this gate costs an hour.
      const probe = spawnSync("/bin/sh", ["-c", "printenv npm_config_dry-run || true"], {
        encoding: "utf8",
        env: { ...process.env, "npm_config_dry-run": "true" },
      });
      const shellForwardsIt = (probe.stdout ?? "").trim() === "true";

      // The bare CLI, where nothing strips anything: whichever answer this shell
      // gives, attw's behaviour follows from it.
      const bare = runAttw(typesNotPacked, { "npm_config_dry-run": "true" });
      if (shellForwardsIt) {
        expect(bare.out).toContain("ENOENT");
        expect(bare.code).not.toBe(0);
      } else {
        expect(bare.out).toContain(UNTYPED);
        expect(bare.out).not.toContain("ENOENT");
        expect(bare.code).toBe(0);
      }

      // The wrapper's answer, which is the same sentence on both shells. ON DASH
      // THIS PINS NOTHING and is not labelled as though it did: the hyphen never
      // reaches npm there, so the UNFIXED wrapper satisfies these three assertions
      // too. It is coverage that becomes a real pin on a bash-as-`sh` box, and the
      // wrapper is pinned non-vacuously either way by the underscore cases above.
      const gated = runWrapper(typesNotPacked, OFFLINE, { "npm_config_dry-run": "true" });
      expect(gated.out).toContain(GATE_UNTYPED);
      expect(gated.out).not.toContain("ENOENT");
      expect(gated.code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "the same, for a pack-destination that would move the tarball attw computed",
    () => {
      // attw builds `<dir>/<name>-<version>.tgz` from the manifest and never asks
      // npm where the file went, so redirecting the write is the other half of the
      // same fault. Counterfactual first, on the bare CLI.
      const elsewhere = mkdtempSync(join(tmpdir(), "attw-gate-packdest-"));
      try {
        const bare = runAttw(typesNotPacked, { npm_config_pack_destination: elsewhere });
        expect(bare.code).not.toBe(0);
        expect(bare.out).toContain("ENOENT");
        expect(bare.out).not.toContain(UNTYPED);

        const gated = runWrapper(typesNotPacked, OFFLINE, {
          npm_config_pack_destination: elsewhere,
        });
        expect(gated.out).toContain(GATE_UNTYPED);
        expect(gated.out).not.toContain("ENOENT");
        expect(gated.code).not.toBe(0);
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT,
  );

  it(
    "NEGATIVE CONTROL: the strip does not turn a real attw failure green",
    () => {
      // The wrapper hands attw a clean pack environment; it must not hand it a
      // clean bill of health. `attwFails` reds on its own merits, planted or not.
      const r = runWrapper(attwFails, OFFLINE, { npm_config_dry_run: "true" });
      expect(r.code).not.toBe(0);
      expect(r.out).not.toContain("ENOENT");
      expect(r.code).toBe(runAttw(attwFails).code);
    },
    SPAWN_TIMEOUT,
  );
});
