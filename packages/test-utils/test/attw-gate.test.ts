/**
 * Tests for scripts/attw.mjs, the wrapper that makes the `attw` publish gate
 * report its own failure.
 *
 * WHAT THESE PIN, AND WHY EACH ONE IS HERE:
 *
 *  1. THE UPSTREAM BEHAVIOUR THE WRAPPER EXISTS FOR. `attw` prints "This package
 *     does not contain types." and exits **0**. If a future `attw` upgrade fixes
 *     that exit code or rewords the sentence, this test reds, which is the point.
 *     A guard that silently stops matching is worse than no guard, and this is the
 *     one net in `attw.mjs` that depends on a string.
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
 *  6. THE ARGUMENT ALLOW-LIST that keeps net 2 readable, and the `.attw.json`
 *     refusal beside it. Each spelling in that table was measured on this repo
 *     either to make the untyped sentence unreadable while attw exits 0, or to be
 *     indistinguishable from a pass. The guard is an allow-list because a
 *     deny-list bought exactly one more evasion per round: the table is kept as
 *     evidence, not as the definition of what is refused.
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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PKG_ROOT = process.cwd();
const WRAPPER = join(PKG_ROOT, "scripts", "attw.mjs");
const ATTW_BIN = join(PKG_ROOT, "node_modules", ".bin", "attw");
const UNTYPED = "This package does not contain types.";
const OFFLINE = ["--no-definitely-typed"];
// Each case shells out to `attw --pack`, which runs a real `npm pack`; two of those
// in one test comfortably exceeds this suite's default timeout.
const SPAWN_TIMEOUT = 120_000;

interface RunResult {
  code: number;
  out: string;
}

function run(bin: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 100_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const runAttw = (cwd: string): RunResult => run(ATTW_BIN, ["--pack", ".", ...OFFLINE], cwd);
const runWrapper = (cwd: string, args: string[] = OFFLINE): RunResult =>
  run(process.execPath, [WRAPPER, ...args], cwd);

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
      expect(r.out).toContain(UNTYPED);
      expect(r.code).not.toBe(0);
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

  it(
    "refuses a .attw.json that sets quiet or format",
    () => {
      const dir = join(root, "config-blinded");
      writePkg(
        dir,
        {
          name: "attw-gate-fixture-configblind",
          version: "1.0.0",
          main: "./index.js",
          types: "./index.d.ts",
          files: ["index.js"],
        },
        {
          "index.js": "module.exports = {};\n",
          "index.d.ts": "export declare const a: number;\n",
          ".attw.json": JSON.stringify({ quiet: true }),
        },
      );
      // Bare attw takes the config and goes silent: exit 0 over an untyped pack.
      const bare = runAttw(dir);
      expect(bare.code).toBe(0);
      expect(bare.out).not.toContain(UNTYPED);

      const r = runWrapper(dir);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(".attw.json");
    },
    SPAWN_TIMEOUT,
  );
});
