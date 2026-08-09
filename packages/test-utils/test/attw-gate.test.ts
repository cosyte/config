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
 *  9. NET 3, WHICH IS THE ONLY NET attw's CONFIGURATION CANNOT REACH. `"included"`
 *     is `containsTypes()`, so net 2 is satisfied by ANY TypeScript-extension file
 *     in the tarball, and net 1 reads the working tree rather than the tarball. A
 *     package that loses its DECLARED `.d.ts` while packing a stray one therefore
 *     sits behind attw's exit code alone, and a committed `.attw.json` relaxes
 *     exactly that. Net 3 reads `npm pack --dry-run --json` instead. Each
 *     relaxation is pinned WITH ITS COUNTERFACTUAL, against a copy of the shipped
 *     wrapper with net 3 sliced out at test time, so the RED-BEFORE is derived
 *     rather than pasted and cannot go stale. The block also pins the RESIDUE: net
 *     3 proves PRESENCE and not RESOLUTION, so a package whose declared paths are
 *     all packed and whose types resolve wrongly still passes under such a config.
 *     That case is a test so a future draft of the prose cannot quietly widen the
 *     claim, which is a thing this file's docblock has already done twice.
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
  statSync,
  symlinkSync,
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
  /**
   * stdout ALONE. `out` folds stderr in because most cases here only ask "did this
   * sentence appear anywhere", but a case that PARSES a subprocess's output must
   * not read a warning line as part of the document. npm writes its warnings to
   * stderr and its `--json` report to stdout.
   */
  stdout: string;
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
  return {
    code: r.status ?? -1,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    stdout: r.stdout ?? "",
  };
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
    "CLOSED BY NET 3, AND NOT BY WIDENING THIS NET: a config relaxing attw's exit code no longer passes a package whose DECLARED types are not packed",
    () => {
      // THIS CASE USED TO BE EXPECTED TO PASS, and was pinned as an open hole that
      // the docblock and `scripts/parser-template/CLAUDE.md` both disclosed. It is
      // inverted here rather than deleted, because the inversion IS the record that
      // the hole closed, and the prose in both files moved in the same change.
      //
      // WHAT DID NOT CHANGE, and the distinction is the whole point: `kind` is
      // still `containsTypes()`, this net still asserts nothing more than that, and
      // the pass line still says nothing more than that. The DECLARED
      // `dist/index.d.ts` is left out of `files` while an undeclared
      // `dist/internal.d.ts` is packed, so `kind` is legitimately "included" and
      // net 2 is legitimately satisfied. What refuses it is net 3, which reads
      // npm's pack listing and asks attw nothing.
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

      // Without a config the gate reds, on attw's own status. Unchanged.
      expect(runWrapper(dir).code).not.toBe(0);

      // With one that relaxes that status it used to pass. It now reds on net 3,
      // and names the declared path that went missing rather than leaving the
      // reader to infer it from a resolution table.
      writeFileSync(
        join(dir, ".attw.json"),
        JSON.stringify({ ignoreRules: ["untyped-resolution"] }),
      );
      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("declares paths the published tarball would NOT carry");
      expect(r.out).toContain("./dist/index.d.ts");
      // And it did NOT get there by reading attw's suppressed findings: net 3 never
      // looks at them. See the residue case in the net 3 block, which is a package
      // with a suppressed finding that still passes because its declared paths are
      // all packed.
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

describe("net 3: the DECLARED paths must be in the tarball", () => {
  // THE CASE THIS BLOCK EXISTS FOR. Net 2 asserts `analysis.types.kind`, and
  // `"included"` is `containsTypes()`: SOME TypeScript-extension file is in the
  // tarball, never that the DECLARED ones are. So a package that loses its
  // declared `.d.ts` while packing a stray one satisfies net 2, and net 1 misses
  // it because net 1 reads the WORKING TREE while the loss is in `files`. The only
  // thing left catching it was attw's own EXIT CODE, and a committed `.attw.json`
  // relaxes exactly that. Net 3 reads npm's own pack listing, which no attw
  // configuration can reach.

  /**
   * The item's exact shape: the declared `./dist/index.d.ts` is on disk (so net 1
   * passes) but out of `files`, while an UNDECLARED `./dist/internal.d.ts` is
   * packed (so `containsTypes()` is true and net 2 passes).
   */
  function declaredTypesLost(name: string, config?: unknown): string {
    const dir = join(root, name);
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `attw-gate-fixture-${name}`,
          version: "1.0.0",
          type: "module",
          main: "./dist/index.mjs",
          types: "./dist/index.d.ts",
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" } },
          files: ["dist/index.mjs", "dist/internal.d.ts"],
        },
        null,
        2,
      ),
    );
    writeFileSync(join(dir, "dist/index.mjs"), "export const a = 1;\n");
    writeFileSync(join(dir, "dist/index.d.ts"), "export declare const a: number;\n");
    writeFileSync(join(dir, "dist/internal.d.ts"), "export declare const b: number;\n");
    if (config !== undefined) writeFileSync(join(dir, ".attw.json"), JSON.stringify(config));
    return dir;
  }

  /**
   * The wrapper with net 3 SURGICALLY REMOVED. This is the RED-BEFORE half, and it
   * is derived from the shipped file at test time rather than pasted, so it cannot
   * drift away from the thing it is the counterfactual for; if the markers stop
   * matching it reds here instead of silently testing nothing.
   *
   * It is written to a THROWAWAY TREE, never beside the real one, because a second
   * copy of a gate inside the repo is a file that can be committed by accident. The
   * wrapper resolves `attw` at `../node_modules/.bin/attw` relative to its own URL,
   * so the tree symlinks THE WHOLE `node_modules` DIRECTORY rather than that one
   * bin.
   *
   * THAT DISTINCTION IS NOT TIDINESS, IT IS A CI RED THIS SUITE ALREADY TOOK: on
   * PR #55 these three cases passed locally and failed on both runner legs, dying
   * in ~70 ms with a module-not-found before `attw` ever ran, so the exit-0
   * assertion saw a 1. Linking the directory instead of the one bin is what turned
   * the runner green (measured on the runner: red before, green after, Node 22 and
   * 24 alike).
   *
   * ▶ WHAT IS DELIBERATELY NOT WRITTEN HERE IS *WHY* THAT WORKS, BECAUSE A DRAFT OF
   * THIS COMMENT GOT IT WRONG AND A REFUTER CAUGHT IT. pnpm's `.bin` entry is a
   * shell shim whose reach back into the store varies by layout, and Node collapses
   * `..` LEXICALLY, so for a shim that climbs several levels no symlink placed at
   * the temp tree is on the path it resolves. A mechanism sentence here would be a
   * claim about every layout from a sample of one box, which is the exact failure
   * this file's own subject matter is about.
   *
   * ▶ SO THIS CONSTRUCTION IS STILL BOX-DEPENDENT, AND THAT IS AN OPEN RESIDUAL
   * RATHER THAN A CLOSED PROBLEM: a fresh clone plus a stock `pnpm install` reds
   * these three cases, ON THE BASE COMMIT TOO. Linking the directory is strictly
   * better than linking the bin, everywhere it was measured, and it is not a fix for
   * the general case. The real fix is for the counterfactual to reach `attw` without
   * depending on the shim's relative reach at all; that is its own item, not a
   * widening of this one.
   */
  let withoutNet3 = "";
  let withoutNet3Root = "";

  beforeAll(() => {
    const src = readFileSync(WRAPPER, "utf8");
    const from = src.indexOf("// ---- Net 3:");
    const to = src.indexOf("// WHAT THIS LINE MAY AND MAY NOT SAY.");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    withoutNet3Root = mkdtempSync(join(tmpdir(), "attw-gate-net3-base-"));
    mkdirSync(join(withoutNet3Root, "scripts"), { recursive: true });
    symlinkSync(join(PKG_ROOT, "node_modules"), join(withoutNet3Root, "node_modules"), "dir");
    withoutNet3 = join(withoutNet3Root, "scripts", "attw.mjs");
    writeFileSync(withoutNet3, src.slice(0, from) + src.slice(to));
  });

  afterAll(() => {
    if (withoutNet3Root) rmSync(withoutNet3Root, { recursive: true, force: true });
  });

  // Each of these was measured to relax attw's exit code on this fixture. They are
  // pinned as CASES, never as a list the gate refuses: net 3 never reads the config
  // at all, which is why a key nobody has enumerated is not a hole in it.
  const relaxations: [string, unknown][] = [
    ["ignoreRules", { ignoreRules: ["untyped-resolution", "no-resolution", "fallback-condition"] }],
    ["ignoreResolutions", { ignoreResolutions: ["node10", "node16-cjs", "node16-esm", "bundler"] }],
    ["an-empty-entrypoints", { entrypoints: [] }],
  ];

  for (const [label, config] of relaxations) {
    it(
      `RED BEFORE, GREEN AFTER: a config setting ${label} hid a lost declaration`,
      () => {
        const dir = declaredTypesLost(`net3-${label}`, config);

        // COUNTERFACTUAL. Without net 3 this exact tree passes the whole gate,
        // which is the defect. attw is not at fault and is not being blamed here:
        // it exits 0 because it was configured to.
        const before = run(process.execPath, [withoutNet3, ...OFFLINE], dir);
        expect(before.code).toBe(0);
        // LIVENESS, so a counterfactual that died before reaching `attw` can never
        // be mistaken for one that ran and passed. Exit 0 alone would not
        // distinguish them if this file ever grows an early success path.
        expect(before.out).toContain("attw gate:");

        // And with net 3 it reds, naming the path that went missing.
        const after = runWrapper(dir);
        expect(after.code).not.toBe(0);
        expect(after.out).toContain("declares paths the published tarball would NOT carry");
        expect(after.out).toContain("./dist/index.d.ts");
      },
      SPAWN_TIMEOUT,
    );
  }

  it(
    "the unconfigured case was already red and stays red, through attw's own status",
    () => {
      // Net 3 must not be credited with a catch that was never open. With no
      // config, attw reds on its own and the gate forwards that, before and after.
      const dir = declaredTypesLost("net3-unconfigured");
      expect(run(process.execPath, [withoutNet3, ...OFFLINE], dir).code).not.toBe(0);
      expect(runWrapper(dir).code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "NEGATIVE CONTROL: a well-formed package stays green, and the pass line counts what it checked",
    () => {
      // A gate that only ever fails is not a gate. `wellFormed` declares four paths
      // and packs all four.
      const r = runWrapper(wellFormed);
      expect(r.code).toBe(0);
      expect(r.out).toContain("all 4 relative artifact path(s) package.json declares are in the");
      // The claim is bounded in the same breath it is made. See "WHAT THESE NETS
      // DO NOT CLAIM" in the wrapper's docblock.
      expect(r.out).toContain("presence, not resolution");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "THE RESIDUE, PINNED SO THE PROSE CANNOT QUIETLY WIDEN: net 3 says nothing about resolution",
    () => {
      // All declared paths ARE packed, and the package is still broken: it ships
      // ESM under a CJS-default `main`. Bare attw reds; a config that relaxes its
      // exit code makes the whole gate green, net 3 included, and net 3 is RIGHT to
      // be satisfied because both declared paths really are in the tarball. This is
      // the half of the config route that is still open, and it is pinned here so
      // that a future draft claiming otherwise reds.
      const dir = join(root, "net3-residue");
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "attw-gate-fixture-net3-residue",
            version: "1.0.0",
            main: "./dist/index.js",
            types: "./dist/index.d.ts",
            exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
            files: ["dist"],
          },
          null,
          2,
        ),
      );
      writeFileSync(join(dir, "dist/index.js"), "export const a = 1;\n");
      writeFileSync(join(dir, "dist/index.d.ts"), "export declare const a: number;\n");

      expect(runAttw(dir).code).not.toBe(0);

      writeFileSync(
        join(dir, ".attw.json"),
        JSON.stringify({ ignoreRules: ["unexpected-module-syntax", "fallback-condition"] }),
      );
      const r = runWrapper(dir);
      expect(r.code).toBe(0);
      expect(r.out).toContain("all 2 relative artifact path(s) package.json declares are in the");
      // Suppressed, but never swallowed: the gate prints what it did not gate.
      expect(r.out).toContain("UnexpectedModuleSyntax");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "FAILS CLOSED when npm's pack listing cannot be read",
    () => {
      // An answer this net could not read is not a green one. The shim intercepts
      // ONLY the `--json` call net 3 makes and hands the real npm everything else,
      // so attw's own nested `npm pack` still works and the run reaches net 3.
      const shimDir = mkdtempSync(join(tmpdir(), "attw-gate-npmshim-"));
      try {
        const shim = join(shimDir, "npm");
        // IT RESTORES THE ORIGINAL PATH BEFORE DELEGATING, AND THAT IS NOT
        // COSMETIC. `npm` can itself be a version-manager shim that re-resolves
        // `npm` through PATH (mise's does), in which case exec-ing the path
        // `command -v npm` reports lands back on THIS file and recurses until the
        // test times out. Measured, and it cost a run.
        writeFileSync(
          shim,
          `#!/bin/sh\n` +
            `for a in "$@"; do [ "$a" = "--json" ] && { echo 'not a json document'; exit 0; }; done\n` +
            `PATH=${JSON.stringify(process.env["PATH"] ?? "")}; export PATH\n` +
            `exec npm "$@"\n`,
        );
        chmodSync(shim, 0o755);
        const r = runWrapper(wellFormed, OFFLINE, {
          PATH: `${shimDir}:${process.env["PATH"] ?? ""}`,
        });
        expect(r.code).not.toBe(0);
        expect(r.out).toContain("could not read which files a tarball");
        expect(r.out).toContain("did not print JSON");
      } finally {
        rmSync(shimDir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT,
  );
});

describe("the field set nets 1 and 3 share: `exports` is not the only field that names a file", () => {
  // WHY THIS BLOCK EXISTS. Nets 1 and 3 ask their questions of ONE set, the one
  // `declaredArtifacts()` returns, so a declaring field missing from that set is a
  // hole in BOTH at once and neither of them says a word. `typesVersions`,
  // `imports`, `browser`, `man`, `unpkg` and `jsdelivr` all name files inside the
  // package and all six were walked past, so a path declared through any of them
  // could sit outside the tarball with the whole gate green. That is net 3's own
  // defect shape arriving through a field net 3 did not read.
  //
  // `man` IS THE ONE WORTH NAMING: it is `bin`'s own sibling in the npm spec, and
  // `bin` is a hole this gate claims to have closed. It was disclosed rather than
  // read on the ground that it is only a LINK-TIME promise, a reason equally true
  // of `bin`, which is read, so the reason was retired instead of restated.
  //
  // THE HONEST BOUND, PINNED IN PROSE HERE BECAUSE NO TEST CAN CARRY IT: this
  // closed a LATENT hole. `typesVersions` is the only one of the six any cosyte
  // manifest uses (`ncpdp`, `@cosyte/test-utils`), and in both of them every
  // `typesVersions` target is already declared through `exports`, so the derived set
  // does not move. `man`, `unpkg` and `jsdelivr` appear in NO cosyte manifest,
  // re-derived over every one of them, not assumed. Nothing shipped broken.

  /**
   * A well-formed dual ESM/CJS package that packs everything EXCEPT one path, which
   * is left on disk (so net 1 passes) and declared ONLY through `fragment`. attw is
   * green on it and net 2 is satisfied, so the field under test is the only thing
   * standing between this package and a false green.
   */
  function declaredOnlyVia(label: string, fragment: Record<string, unknown>): string {
    const dir = join(root, `fieldset-${label}`);
    writePkg(
      dir,
      {
        name: `attw-gate-fixture-fieldset-${label}`,
        version: "1.0.0",
        type: "module",
        exports: {
          ".": {
            import: { types: "./index.d.ts", default: "./index.js" },
            require: { types: "./index.d.cts", default: "./index.cjs" },
          },
        },
        ...fragment,
        files: ["index.js", "index.d.ts", "index.cjs", "index.d.cts"],
      },
      {
        "index.js": "export const a = 1;\n",
        "index.d.ts": "export declare const a: number;\n",
        "index.cjs": "module.exports.a = 1;\n",
        "index.d.cts": "export declare const a: number;\n",
        // The paths that are on disk and NOT in `files`. `extra.1` is here so the
        // `man` cases can declare something with a man page's shape rather than
        // borrowing a JS file; nothing enumerates the tree, so an extra unpacked
        // file changes no other case.
        "extra.d.ts": "export declare const b: number;\n",
        "extra.mjs": "export const b = 2;\n",
        "extra.1": ".TH EXTRA 1\n",
      },
    );
    return dir;
  }

  /**
   * The wrapper with the three fields SLICED BACK OUT, derived from the shipped file
   * at test time so the RED-BEFORE half cannot drift away from the thing it is the
   * counterfactual for. Same throwaway-tree-plus-symlinked-`node_modules`
   * construction as the net 3 block above, and it inherits that block's documented
   * residual unchanged: the reach of `node_modules/.bin/attw` from a temp tree is
   * box-dependent, and that is a pre-existing open residual rather than something
   * this block introduces.
   */
  let withoutFields = "";
  let withoutFieldsRoot = "";

  beforeAll(() => {
    const src = readFileSync(WRAPPER, "utf8");
    const from = src.indexOf("// ---- BEYOND `exports`:");
    const to = src.indexOf("// ---- END BEYOND `exports`");
    // If either marker stops matching, this reds rather than silently testing a
    // counterfactual identical to the shipped gate.
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    withoutFieldsRoot = mkdtempSync(join(tmpdir(), "attw-gate-fieldset-base-"));
    mkdirSync(join(withoutFieldsRoot, "scripts"), { recursive: true });
    symlinkSync(join(PKG_ROOT, "node_modules"), join(withoutFieldsRoot, "node_modules"), "dir");
    withoutFields = join(withoutFieldsRoot, "scripts", "attw.mjs");
    writeFileSync(withoutFields, src.slice(0, from) + src.slice(to));
  });

  afterAll(() => {
    if (withoutFieldsRoot) rmSync(withoutFieldsRoot, { recursive: true, force: true });
  });

  const cases: [string, Record<string, unknown>, string][] = [
    // Targets are paths with an OPTIONAL `./`, so this one is read the lenient way
    // `types` is. The spelling without the prefix is the one TypeScript's own
    // documentation uses, and it is what this case pins.
    ["typesVersions", { typesVersions: { "*": { sub: ["extra.d.ts"] } } }, "./extra.d.ts"],
    // A `#foo` that resolves into an unpacked file breaks the package's OWN runtime
    // resolution once installed, which is a broken publish by any reading.
    ["imports", { imports: { "#internal": "./extra.mjs" } }, "./extra.mjs"],
    // The map form: only the VALUES are read.
    ["browser-map-value", { browser: { "./index.js": "./extra.mjs" } }, "./extra.mjs"],
    // The string form, which is an entry point like `main` and is read like one.
    ["browser-string", { browser: "./extra.mjs" }, "./extra.mjs"],
    // `man` takes a bare string or an array of them, and the `./` is optional on
    // both: the same lenient grammar `bin` has. Both spellings are pinned, because
    // the array form is the one npm's own documentation leads with and the lenient
    // string is the one that would silently normalize wrongly.
    ["man-string", { man: "extra.1" }, "./extra.1"],
    ["man-array", { man: ["./extra.1"] }, "./extra.1"],
    // CDN conventions with `main`'s grammar. A path the tarball does not carry is a
    // 404 from the CDN, which is the same broken promise by a different consumer.
    ["unpkg", { unpkg: "./extra.mjs" }, "./extra.mjs"],
    ["jsdelivr", { jsdelivr: "./extra.mjs" }, "./extra.mjs"],
  ];

  for (const [label, fragment, missing] of cases) {
    it(
      `RED BEFORE, GREEN AFTER: a path declared only through \`${label}\` was invisible`,
      () => {
        const dir = declaredOnlyVia(label, fragment);

        // COUNTERFACTUAL. Without the field, this exact tree passes the WHOLE gate:
        // net 1 finds nothing missing because it never looked, attw exits 0, and net
        // 3 grades a set the path is not in.
        const before = run(process.execPath, [withoutFields, ...OFFLINE], dir);
        expect(before.code).toBe(0);
        // LIVENESS, so a counterfactual that died before reaching attw can never be
        // mistaken for one that ran and passed.
        expect(before.out).toContain("attw gate:");
        expect(before.out).not.toContain(missing);

        // And with the field read, it reds, naming the path that went missing.
        const after = runWrapper(dir);
        expect(after.code).not.toBe(0);
        expect(after.out).toContain("declares paths the published tarball would NOT carry");
        expect(after.out).toContain(missing);
      },
      SPAWN_TIMEOUT,
    );
  }

  it(
    "NEGATIVE CONTROL: the shapes that are NOT files of ours stay out of the set",
    () => {
      // Widening a field set is exactly how a gate acquires false reds, so every
      // exclusion the pass line claims is asserted here on one package. Every shape
      // that must be SKIPPED names a path that is neither on disk nor packed, so if
      // any of them were read, net 1 would red before attw even ran. The two that
      // point at real packed files (`./index.js` as a browser VALUE, `./index.cjs` as
      // a browser KEY) are there to keep the count honest: the value is legitimately
      // read and is already in the set, so the total must still be 4.
      const dir = declaredOnlyVia("negative-control", {
        typesVersions: {
          "*": {
            // A wildcard target names a SET, not a file. Keyed off a subpath that is
            // not `*` on purpose: a `*` KEY remaps every subpath including `.`, which
            // reds attw itself and would measure the wrong thing.
            sub: ["./dist/*.d.ts"],
            // Not ours to promise.
            abs: ["/nowhere/absent.d.ts"],
          },
        },
        imports: {
          // Someone else's package.
          "#dep": "some-package-that-is-not-here",
          // The "block this specifier" form.
          "#blocked": null,
        },
        browser: {
          // A KEY is what a browser build stops loading, not a promise about the
          // tarball. Reading keys would red a package that maps a file away
          // precisely because it does not ship it to browsers.
          "./absent-key.js": "./index.js",
          // The "stub this out" form, which falls out of the same rule as a bare
          // specifier rather than needing a case of its own.
          fs: false,
          // A replacement that is a dependency, not a file.
          "./index.cjs": "some-polyfill-package",
        },
      });

      const r = runWrapper(dir);
      expect(r.code, r.out).toBe(0);
      // The four packed paths of the base fixture, and nothing above added to them.
      expect(r.out).toContain("all 4 relative artifact path(s) package.json declares are in the");
      // The pass line names its exclusions rather than printing a bare total, so the
      // claim above is bounded in the same breath it is made.
      expect(r.out).toContain("browser-map keys");
      expect(r.out).toContain("presence, not resolution");
    },
    SPAWN_TIMEOUT,
  );

  /**
   * The known-unread field names, PARSED OUT OF THE SHIPPED GATE rather than
   * written here. `KNOWN_UNREAD_FIELDS` is the gate's single copy of that claim and
   * the pass line prints it, so a name that appears in one appears in both.
   */
  function knownUnreadFields(): string[] {
    const src = readFileSync(WRAPPER, "utf8");
    const decl = /const KNOWN_UNREAD_FIELDS = \[([^\]]*)\];/.exec(src);
    // If the constant is renamed or deleted, this reds rather than silently
    // grading an empty list, which would pass vacuously.
    expect(decl, "KNOWN_UNREAD_FIELDS is not declared in the shape this test reads").not.toBeNull();
    const names = [...(decl?.[1] ?? "").matchAll(/"([^"]+)"/g)].flatMap((m) => m[1] ?? []);
    expect(names.length).toBeGreaterThan(0);
    return names;
  }

  /**
   * One probe per known-unread name: a manifest fragment declaring, through THAT
   * field only, paths that exist nowhere: not on disk and not in the tarball. If
   * the gate read the field, net 1 would red before attw ever ran.
   */
  const UNREAD_PROBES: Record<string, Record<string, unknown>> = {
    directories: {
      directories: { bin: "./absent-bin", man: "./absent-man", lib: "./absent-lib" },
    },
  };

  it(
    "THE KNOWN-UNREAD DISCLOSURE IS DERIVED FROM THE GATE, NOT PASTED BESIDE IT",
    () => {
      // WHY THIS TEST HAS THIS SHAPE. The disclosure sentence has drifted ahead of
      // `declaredArtifacts()` three rounds running, and every guard on it so far
      // compared one COPY OF THE PROSE to another copy of the prose. The two
      // wrapper files are held byte-identical, which catches a divergence between
      // them and nothing at all about whether either is true. This compares the
      // prose to the GATE: every name the pass line prints is measured to be really
      // unread, and a name with no probe below cannot be added without one.
      const names = knownUnreadFields();
      expect(
        Object.keys(UNREAD_PROBES).sort(),
        "every KNOWN_UNREAD_FIELDS name needs a probe here, and every probe a name",
      ).toEqual([...names].sort());

      const dir = declaredOnlyVia(
        "known-unread",
        Object.assign({}, ...names.map((n) => UNREAD_PROBES[n])) as Record<string, unknown>,
      );
      const r = runWrapper(dir);
      // Green: every one of those absent paths went unseen, which is the claim.
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("all 4 relative artifact path(s) package.json declares are in the");
      // And the sentence says exactly which fields, in the gate's own words.
      expect(r.out).toContain(`Known-unread: ${names.join(", ")}.`);
      expect(r.out).toContain("It does NOT cover every field that can name a file");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "`directories` STAYS UNREAD ON A MEASURED GRAMMAR GROUND, NOT A POPULARITY ONE",
    () => {
      // The reason the other five were retired on was "no user in this org". That
      // is not a reason to leave a hole open, and it is not the reason here.
      // `directories` names DIRECTORIES and both nets grade FILES, so reading it
      // with the machinery that reads `bin` would be wrong in both directions at
      // once. Measured on a package whose `directories` trees are FULLY PACKED:
      const dir = join(root, "directories-grammar");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-directories-grammar",
          version: "1.0.0",
          directories: { bin: "./binscripts", man: "./mandir" },
          files: ["binscripts", "mandir"],
        },
        {},
      );
      mkdirSync(join(dir, "binscripts"), { recursive: true });
      mkdirSync(join(dir, "mandir"), { recursive: true });
      writeFileSync(join(dir, "binscripts", "tool.js"), "#!/usr/bin/env node\n");
      writeFileSync(join(dir, "mandir", "page.1"), ".TH PAGE 1\n");

      const packed = run("npm", ["pack", "--dry-run", "--json"], dir);
      expect(packed.code, packed.out).toBe(0);
      // stdout ALONE: npm writes config warnings to stderr on this box, and folding
      // them into the document would make this parse fail for the wrong reason.
      const report = (JSON.parse(packed.stdout) as { files: { path: string }[] }[])[0];
      // npm reports an ARRAY of tarballs. One fixture, one entry: anything else and
      // the assertions below would be graded against a document this test did not
      // ask for, so it reds here instead.
      expect(report, packed.stdout).toBeDefined();
      const listed: string[] = (report?.files ?? []).map((f) => f.path);

      // (a) NET 3 WOULD MISS ON A CORRECTLY PACKED PACKAGE. npm's listing carries
      //     the files inside the directory and no entry for the directory itself,
      //     so `packed.files.has("binscripts")` is false however well it packed:
      //     a false red for the healthy case, which is the worst kind.
      expect(listed).toContain("binscripts/tool.js");
      expect(listed).toContain("mandir/page.1");
      expect(listed).not.toContain("binscripts");
      expect(listed).not.toContain("mandir");

      // (b) NET 1 WOULD PASS IT BLIND, from the other side: its test is "missing or
      //     zero bytes", and a directory stats non-zero without anything being in
      //     it. So neither net grades what the field actually promises.
      expect(statSync(join(dir, "binscripts")).size).toBeGreaterThan(0);
      expect(statSync(join(dir, "binscripts")).isDirectory()).toBe(true);

      // Reading `directories` therefore needs a PREFIX test against the packed
      // list, a second grading rule and not a wider field set. That is out of this
      // slice deliberately, and the pass line says so.
    },
    SPAWN_TIMEOUT,
  );
});
