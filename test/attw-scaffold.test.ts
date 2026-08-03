/**
 * Guards the `attw` publish gate across the two places this repo controls it.
 *
 * THE DEFECT. `attw --pack .` prints "This package does not contain types." and
 * EXITS 0. `getExitCode.js` in `@arethetypeswrong/cli` opens with
 * `if (!analysis.types) return 0`, returning before the problem list is read, so
 * for a package that ships types the CLI reports a broken publish as a pass. A
 * false red costs an hour; a false green merges.
 *
 * WHY THIS FILE IS SEPARATE FROM `packages/test-utils/test/attw-gate.test.ts`.
 * That suite proves the wrapper works for the package this repo publishes. This
 * one proves the OTHER copy works: `scripts/parser-template/` is what
 * `scripts/scaffold-parser.mjs` mints every NEW `@cosyte/*` parser repo from, so
 * a fix that lands only in `packages/` leaves the defect being re-minted into
 * every future parser. That is the reason this repo is in the porting campaign at
 * all, and asserting it on the template alone would not prove it: the scaffolder
 * substitutes tokens as it copies, so what matters is the emitted tree.
 *
 * The end-to-end case therefore runs the REAL scaffolder, plumbs an `attw` binary
 * into the emitted repo at the path the emitted wrapper looks for, and shows the
 * emitted gate reddening on a pack that bare `attw` passes. `pnpm install` is not
 * available to a test, so the binary is reached through a generated shim; nothing
 * else about the emitted tree is touched.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell form.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const TEMPLATE = join(REPO_ROOT, "scripts", "parser-template");
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const TEST_UTILS = join(REPO_ROOT, "packages", "test-utils");
const UNTYPED = "This package does not contain types.";
const OFFLINE = ["--no-definitely-typed"];
// `attw --pack` runs a real `npm pack`, which is far past the default timeout.
const SPAWN_TIMEOUT = 120_000;

/** The bare invocation this campaign exists to remove. Matching it is the failure. */
const BARE_INVOCATION = /^attw\b/;

interface RunResult {
  code: number;
  out: string;
}

function run(bin: string, args: string[], cwd: string): RunResult {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 100_000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

let root: string;
/** The emitted parser repo, produced by the real scaffolder. */
let scaffold: string;
/** A package whose declaration file exists on disk but is left out of `files`. */
let typesNotPacked: string;
/** The real attw CLI entry point, resolved through test-utils' dependency tree. */
let attwEntry: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "attw-scaffold-"));

  // Run the real scaffolder, exactly as a human would.
  const scaffolded = run(process.execPath, [SCAFFOLDER, "demo", "--out", root], REPO_ROOT);
  expect(scaffolded.code, scaffolded.out).toBe(0);
  scaffold = join(root, "demo");

  // Resolve the attw CLI through the only package here that depends on it. Its
  // `exports` map does not expose the entry point, so go via the manifest.
  const require = createRequire(join(TEST_UTILS, "package.json"));
  const manifestPath = require.resolve("@arethetypeswrong/cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin: { attw: string } };
  attwEntry = join(dirname(manifestPath), manifest.bin.attw);

  // Plumb it in at the path the emitted wrapper resolves, which is
  // `<repo>/node_modules/.bin/attw` relative to the wrapper's own location.
  const binDir = join(scaffold, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "attw");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${attwEntry}" "$@"\n`);
  chmodSync(shim, 0o755);

  // The fixture: a package that ships types on disk but leaves them out of the
  // tarball. This is precisely the case attw reports and does not fail on.
  typesNotPacked = join(root, "types-not-packed");
  mkdirSync(typesNotPacked, { recursive: true });
  writeFileSync(
    join(typesNotPacked, "package.json"),
    JSON.stringify(
      {
        name: "attw-scaffold-fixture-unpacked",
        version: "1.0.0",
        main: "./index.js",
        types: "./index.d.ts",
        files: ["index.js"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(typesNotPacked, "index.js"), "module.exports = {};\n");
  writeFileSync(join(typesNotPacked, "index.d.ts"), "export declare const a: number;\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the attw wrapper is carried by both manifests this repo owns", () => {
  it("the parser template invokes the wrapper, not the bare CLI", () => {
    const pkg = JSON.parse(readFileSync(join(TEMPLATE, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.attw).toBe("node scripts/attw.mjs");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
  });

  it("@cosyte/test-utils invokes the wrapper, not the bare CLI", () => {
    const pkg = JSON.parse(readFileSync(join(TEST_UTILS, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.attw).toBe("node scripts/attw.mjs");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
  });

  it("both copies of the wrapper are byte-identical, so neither can drift", () => {
    // Two copies exist because the template's has to travel into a new repo while
    // test-utils' has to sit beside its own node_modules. Nothing keeps them in
    // step except this assertion, so a one-sided edit reds here rather than
    // leaving one gate weaker than the other.
    const fromTemplate = readFileSync(join(TEMPLATE, "scripts", "attw.mjs"));
    const fromPackage = readFileSync(join(TEST_UTILS, "scripts", "attw.mjs"));
    expect(fromTemplate.equals(fromPackage)).toBe(true);
  });
});

describe("a freshly scaffolded parser inherits the fixed gate", () => {
  it("emits the wrapper and an attw script that calls it", () => {
    const pkg = JSON.parse(readFileSync(join(scaffold, "package.json"), "utf8")) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe("@cosyte/demo"); // the scaffolder really ran
    expect(pkg.scripts.attw).toBe("node scripts/attw.mjs");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
    // NOTHING IS ASSERTED ABOUT `prepublishOnly` HERE, DELIBERATELY. The template
    // still ends it with `&& pnpm attw`, which is the shape #40 (`f32e7dd`)
    // removed from `@cosyte/test-utils`: `attw --pack .` packs a tarball of its
    // own, and inside `pnpm publish`'s staging context that pack lands where attw
    // cannot find it, so the step dies with ENOENT on its own tgz. That is a
    // separate, pre-existing defect and a separate slice. Pinning the current
    // string here would red the day someone fixes it, which is the wrong way
    // round for a test to behave.

    // The emitted wrapper survived token substitution unchanged. It carries no
    // {{...}} tokens, so byte-identity through the scaffolder is the expectation.
    const emitted = readFileSync(join(scaffold, "scripts", "attw.mjs"));
    const source = readFileSync(join(TEMPLATE, "scripts", "attw.mjs"));
    expect(emitted.equals(source)).toBe(true);
  });

  it(
    "reds on an untyped pack, where the invocation it replaced exits 0",
    () => {
      // The counterfactual first: this is the false green, measured here rather
      // than asserted from the changelog. If attw ever fixes its exit code this
      // reds, and the wrapper's post-check can be revisited.
      const bare = run(attwEntry, ["--pack", ".", ...OFFLINE], typesNotPacked);
      expect(bare.out).toContain(UNTYPED);
      expect(bare.code).toBe(0);

      // The same pack, through the gate a scaffolded parser would actually run.
      const gated = run(
        process.execPath,
        [join(scaffold, "scripts", "attw.mjs"), ...OFFLINE],
        typesNotPacked,
      );
      expect(gated.out).toContain(UNTYPED);
      expect(gated.code).not.toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "reds, naming the file, when the build has not produced the declarations",
    () => {
      // The realistic trigger: tsup writes JS in one pass and declarations in a
      // later one, so every build has a window where dist/ holds .mjs/.cjs and no
      // .d.ts. The emitted repo's own manifest points at exactly those paths and
      // nothing has been built in it, so it is that window, frozen.
      const gated = run(
        process.execPath,
        [join(scaffold, "scripts", "attw.mjs"), ...OFFLINE],
        scaffold,
      );
      expect(gated.code).not.toBe(0);
      expect(gated.out).toContain("./dist/index.d.ts");
      expect(gated.out).toContain("missing");
      // The preflight must name the artifact rather than leave the reader to infer
      // it from attw's silence.
      expect(gated.out).toContain("attw gate");
    },
    SPAWN_TIMEOUT,
  );
});
