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
 * one proves what a NEW parser runs: `scripts/parser-template/` is what
 * `scripts/scaffold-parser.mjs` mints every new `@cosyte/*` parser repo from, and
 * its `attw` script is `cosyte-attw`, the gate's published command from
 * `@cosyte/script-utils`, with no copy of a wrapper beside it. Asserting it on the
 * template alone would not prove it: the scaffolder substitutes tokens as it
 * copies, so what matters is the emitted tree.
 *
 * The end-to-end case therefore runs the REAL scaffolder, SIMULATES THE INSTALL,
 * and shows the emitted gate reddening on a pack that bare `attw` passes.
 * `pnpm install` is not available to a test, so the simulation is two plants and
 * nothing else: the `attw` binary where pnpm would link it, reached through a
 * generated shim, and `@cosyte/script-utils` where pnpm would put it. The emitted
 * `pnpm attw` runs that package's `cosyte-attw` bin in the repository root, so the
 * cases here run that bin, found through the planted package's own `bin` map, in
 * the directory under test. A COPY rather than a symlink, for the reason
 * `test/phi-scan-scaffold.test.ts` gives about its own engine plant: a symlink
 * into this workspace would let a test mutate the source tree.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell form.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const TEMPLATE = join(REPO_ROOT, "scripts", "parser-template");
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const TEST_UTILS = join(REPO_ROOT, "packages", "test-utils");
/** The one body of the probe. Every wrapper in this repo is a caller of it. */
const SHARED_PACKAGE_SRC = join(REPO_ROOT, "packages", "script-utils");
const SHARED_BODY = join(SHARED_PACKAGE_SRC, "attw.js");
/**
 * The marker a SECOND body would carry: the DECLARATION of the function nets 1, 3 and 4 all derive
 * their one set from. A copy of the gate carries it; a file that merely talks about the gate does
 * not.
 *
 * ASSEMBLED RATHER THAN WRITTEN OUT, and that is not obfuscation. A detector whose own source
 * contains its needle reports itself, so the first shape of this case named this file and the
 * inventory beside it as bodies of the gate. Joining the two halves keeps the literal out of every
 * file but the one being detected, which is the only way "exactly one" can be an exact number.
 */
const BODY_MARKER = ["function", "declaredArtifacts("].join(" ");
const UNTYPED = "This package does not contain types.";
const OFFLINE = ["--no-definitely-typed"];
// `attw --pack` runs a real `npm pack`, which is far past the default timeout.
const SPAWN_TIMEOUT = 120_000;

/** The bare invocation this campaign exists to remove. Matching it is the failure. */
const BARE_INVOCATION = /^attw\b/;

interface RunResult {
  code: number;
  /** stdout then stderr, for the cases that only read what was said. */
  out: string;
  /** Kept apart for the cases where WHICH stream carried a line is the assertion. */
  stdout: string;
  stderr: string;
}

/**
 * The npm config that decides whether and where a nested `npm pack` writes its
 * tarball, in every spelling npm honours. `attw --pack` opens a path it computed,
 * so either one leaves it reading a file npm put somewhere else or never wrote.
 * The emitted wrapper strips both from the child it spawns; this suite calls the
 * BARE CLI for its counterfactuals, which has no such protection, so it strips
 * them here too. The pins for the wrapper's own stripping live beside the wrapper,
 * in `packages/test-utils/test/attw-gate.test.ts`, and this file's byte-identity
 * case is what carries them into the scaffolded copy.
 */
const PACK_PLACEMENT_CONFIG = /^npm_config_(dry[_-]run|pack[_-]destination)$/i;

/**
 * Put `@cosyte/script-utils` where `pnpm install` would put it for one tree.
 *
 * `node_modules` is filtered out of the copy: the package's own dev tree is irrelevant to a
 * consumer and dragging vitest into every fixture costs seconds per case.
 */
function installShared(dir: string): void {
  cpSync(SHARED_PACKAGE_SRC, join(dir, "node_modules", "@cosyte", "script-utils"), {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes("node_modules"),
  });
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): RunResult {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !PACK_PLACEMENT_CONFIG.test(key)),
    ),
    ...extraEnv,
  };
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 100_000, env });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { code: r.status ?? -1, out: `${stdout}${stderr}`, stdout, stderr };
}

/**
 * The file `pnpm attw` runs in `dir`: the `cosyte-attw` entry of the planted
 * `@cosyte/script-utils` package's own `bin` map, so a renamed or moved bin reds
 * here instead of being hard-coded past.
 */
function attwCommand(dir: string): string {
  const pkg = join(dir, "node_modules", "@cosyte", "script-utils");
  const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
    bin: Record<string, string>;
  };
  const bin = manifest.bin["cosyte-attw"];
  if (bin === undefined) throw new Error("@cosyte/script-utils declares no cosyte-attw bin");
  return join(pkg, bin);
}

/** Run the emitted `pnpm attw` in `dir`: the shared command, in the directory under test. */
function emittedAttw(dir: string, args: string[], extraEnv: Record<string, string> = {}) {
  return run(process.execPath, [attwCommand(dir), ...args], dir, extraEnv);
}

/** Put an `attw` shim where `pnpm install` links the CLI in `dir`. */
function linkAttw(dir: string): void {
  const binDir = join(dir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "attw");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${attwEntry}" "$@"\n`);
  chmodSync(shim, 0o755);
}

let root: string;
/** The emitted parser repo, produced by the real scaffolder. */
let scaffold: string;
/** A package whose declaration file exists on disk but is left out of `files`. */
let typesNotPacked: string;
/** The real attw CLI entry point, resolved through test-utils' dependency tree. */
let attwEntry: string;
/** A package whose `attw` binary is a shim that records the argv it was handed. */
let argvProbe: string;
/** Where that shim writes the arguments of its most recent invocation. */
let argvLog: string;

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

  // Plumb it in where `pnpm install` links it, `<repo>/node_modules/.bin/attw`,
  // which is the binary the shared gate runs for the package in the working
  // directory...
  linkAttw(scaffold);

  // ...and the shared gate, where `pnpm install` would put it. The emitted `attw`
  // script is that package's command; without this plant every case below would
  // measure a missing dependency rather than the gate.
  installShared(scaffold);

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
  // The same two plants as the scaffold, since the shared command runs the attw
  // and reads the package of the directory it is run in.
  linkAttw(typesNotPacked);
  installShared(typesNotPacked);

  // A second fixture package whose `attw` is a SHIM that records its argv. The
  // real CLI cannot answer "what did the gate forward?": it reports on a tarball,
  // not on its own arguments, and `--no-definitely-typed` only suppresses a
  // network lookup, so dropping it changes nothing this suite could otherwise
  // observe.
  //
  // THE MANIFEST DECLARES ONE PATH, AND IT USED TO DECLARE NONE. The old comment
  // here read "the manifest declares no artifacts, so the wrapper's preflight has
  // nothing to find missing and the run reaches the spawn", which was true of the
  // 1500-line body and is not true of the shared one: a manifest that declares
  // nothing is now REFUSED before the spawn, because nets 1, 3 and 4 all grade
  // that one set and an empty set makes three of the four vacuous. So the fixture
  // declares the smallest thing that still reaches the spawn: one `main` with the
  // file present and packed. Nothing about what is FORWARDED changes, and the
  // argv assertions below are unchanged.
  argvProbe = join(root, "argv-probe");
  argvLog = join(root, "argv-probe.log");
  mkdirSync(join(argvProbe, "scripts"), { recursive: true });
  writeFileSync(
    join(argvProbe, "package.json"),
    JSON.stringify(
      {
        name: "attw-argv-probe",
        version: "1.0.0",
        private: true,
        main: "./index.js",
        files: ["index.js"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(argvProbe, "index.js"), "module.exports.a = 1;\n");
  // The shared command the emitted `attw` script names, so this pins what a
  // scaffolded parser would really run.
  installShared(argvProbe);
  const probeBin = join(argvProbe, "node_modules", ".bin");
  mkdirSync(probeBin, { recursive: true });
  const probeShim = join(probeBin, "attw");
  // Newline-separated so an argument containing a space cannot be read as two.
  //
  // The shim must also print a PASSING attw JSON DOCUMENT. The wrapper's net 2
  // forces `--format json` and parses stdout, so a shim that printed prose (or
  // nothing) would red on the parse and this suite would be measuring the parse
  // rather than the forwarding. `kind: "included"` is the one shape that passes.
  const probeReport = JSON.stringify({
    analysis: {
      packageName: "attw-argv-probe",
      packageVersion: "1.0.0",
      types: { kind: "included" },
    },
  });
  writeFileSync(
    probeShim,
    `#!/bin/sh\n: > "${argvLog}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\n` +
      `cat <<'ATTWJSON'\n${probeReport}\nATTWJSON\n`,
  );
  chmodSync(probeShim, 0o755);
});

/** Run the emitted gate against the argv probe and return what attw was handed. */
function forwardedArgv(args: string[]): { code: number; out: string; argv: string[] } {
  rmSync(argvLog, { force: true });
  const r = emittedAttw(argvProbe, args);
  let argv: string[] = [];
  try {
    argv = readFileSync(argvLog, "utf8").split("\n").filter(Boolean);
  } catch {
    argv = [];
  }
  return { ...r, argv };
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the attw wrapper is carried by both manifests this repo owns", () => {
  it("the parser template invokes the shared command, not the bare CLI", () => {
    const pkg = JSON.parse(readFileSync(join(TEMPLATE, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.attw).toBe("cosyte-attw");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
  });

  it("@cosyte/test-utils invokes the wrapper, not the bare CLI", () => {
    const pkg = JSON.parse(readFileSync(join(TEST_UTILS, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.attw).toBe("node scripts/attw.mjs");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
  });

  it("the parser template carries no wrapper of its own to drift from the shared one", () => {
    // It used to carry a copy of test-utils' wrapper, held byte-identical by a case
    // here. The shared command needs no file in the repository, so a new parser
    // gets none.
    expect(existsSync(join(TEMPLATE, "scripts", "attw.mjs"))).toBe(false);
  });

  it("every wrapper is a CALLER: it imports the shared body and carries no net of its own", () => {
    for (const wrapper of [join(TEST_UTILS, "scripts", "attw.mjs")]) {
      const src = readFileSync(wrapper, "utf8");
      expect(src, `${wrapper} does not call the shared body`).toContain(
        'from "@cosyte/script-utils/attw"',
      );
      // `callerUrl` is what makes the gate spawn THIS package's own attw rather
      // than one resolved relative to wherever the shared body was installed. A
      // wrapper that dropped it would be refused at run time; this says so at
      // read time, per wrapper, so the reason is visible in a diff.
      expect(src, `${wrapper} does not hand the gate its own url`).toContain(
        "runAttwGate({ callerUrl: import.meta.url })",
      );
      expect(src, `${wrapper} carries net logic of its own`).not.toContain(BODY_MARKER);
    }
  });

  it("exactly one body of the net logic exists in this repository", () => {
    // THE DUPLICATION THIS SLICE REMOVED, PINNED SO IT CANNOT COME BACK. Two bodies of a gate
    // drift, every escape found in one keeps shipping from the other, and that is what the
    // byte-identity assertion above was buying at the price of a 1500-line copy. Derived from
    // git's own list of tracked files rather than a walk, so an untracked scratch copy in a
    // working tree is not a false red and a COMMITTED one cannot hide.
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    expect(tracked.length, "git listed no tracked files").toBeGreaterThan(50);

    const bodies = (paths: string[]): string[] =>
      paths.filter((rel) => {
        // `resolve` rather than `join`, because the mutation control below hands this an ABSOLUTE
        // path and `join` would happily glue it onto the repo root and then find nothing: the
        // control would pass by missing its own plant, which is the vacuous shape it exists to
        // rule out. Measured: it did exactly that in the first draft.
        const full = resolve(REPO_ROOT, rel);
        try {
          // READ, THEN JUDGE. An earlier shape checked the size with `statSync` and then read the
          // file, which is a check-then-use race (CodeQL `js/file-system-race`) and buys nothing
          // here: every tracked file in this repository is small enough to read, and a file that
          // vanishes between the two calls would be reported as absent rather than as an error.
          return readFileSync(full, "utf8").includes(BODY_MARKER);
        } catch {
          return false;
        }
      });

    expect(bodies(tracked)).toEqual(["packages/script-utils/attw.js"]);

    // NON-VACUITY, AND THE MUTATION THIS CHECK HAS TO FAIL AGAINST. A detector that matched
    // nothing would pass the assertion above by accident on a repository that still held two
    // copies, so the marker is proved to select the shipped body, and a second file carrying it is
    // proved to be caught. The copy is written outside the repository and never tracked.
    expect(readFileSync(SHARED_BODY, "utf8")).toContain(BODY_MARKER);
    const planted = join(root, "planted-second-body.js");
    writeFileSync(planted, readFileSync(SHARED_BODY));
    expect(bodies([...tracked, planted])).toEqual(["packages/script-utils/attw.js", planted]);
    rmSync(planted, { force: true });
  });
});

describe("a freshly scaffolded parser inherits the fixed gate", () => {
  it("emits an attw script that runs the shared command, last in prepublishOnly", () => {
    const pkg = JSON.parse(readFileSync(join(scaffold, "package.json"), "utf8")) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe("@cosyte/demo"); // the scaffolder really ran
    expect(pkg.scripts.attw).toBe("cosyte-attw");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
    expect(existsSync(join(scaffold, "scripts", "attw.mjs"))).toBe(false);
    // A library's `prepublishOnly` ends in the types check, so the tree it packs
    // has passed the gate, types last.
    //
    // WHY THIS IS SAFE NOW, WHEN IT WAS ONCE REMOVED. `attw --pack .` packs a
    // tarball of its own, and under `pnpm publish --dry-run` npm exports
    // `npm_config_dry_run=true` into every lifecycle script, so `npm pack` wrote
    // nothing and attw died with ENOENT on its own tgz. That blocked every release
    // of `@cosyte/test-utils` until #40 (`f32e7dd`) took attw out of its chain, and
    // the template followed. The shared gate now strips the two pack-placement
    // keys from the attw child (`packages/test-utils/test/attw-gate.test.ts`
    // pins it), and the case below runs the emitted gate under that variable.
    expect(pkg.scripts.prepublishOnly).toBe(
      "pnpm clean && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm attw",
    );
  });

  it(
    "judges the pack under the variable `pnpm publish --dry-run` exports, rather than dying",
    () => {
      // Without the strip, `npm pack` writes nothing and attw fails on a missing
      // tarball before it judges anything. With it, the gate reaches its verdict.
      const gated = emittedAttw(typesNotPacked, OFFLINE, { npm_config_dry_run: "true" });
      expect(gated.code).not.toBe(0);
      expect(gated.out).toContain("analysed this package as UNTYPED");
      expect(gated.out).not.toContain("ENOENT");
    },
    SPAWN_TIMEOUT,
  );

  describe("the allow-listed arguments are FORWARDED, each pinned on its own", () => {
    // WHY THIS EXISTS. Every other case in this file passes `--no-definitely-typed`
    // so the gate stays off the network, and that is exactly why none of them
    // pins it: the flag rode along on every run, so a wrapper that ACCEPTED it
    // and then dropped it on the floor would keep the whole suite green. The
    // acceptance half is covered incidentally (removing it from the allow-list
    // makes every other case die at the argument guard); the FORWARDING half was
    // not covered at all. The same gap is open upstream in `terminology`.

    it("hands attw exactly `--pack . --no-definitely-typed --format json`", () => {
      const r = forwardedArgv(OFFLINE);
      expect(r.code, r.out).toBe(0);
      expect(r.argv).toEqual(["--pack", ".", "--no-definitely-typed", "--format", "json"]);
    });

    it("NEGATIVE CONTROL: without the flag, attw is handed `--pack .` and the format only", () => {
      // Without this, the assertion above would pass just as well against a
      // wrapper that hard-coded the flag, which pins nothing about forwarding.
      const r = forwardedArgv([]);
      expect(r.code, r.out).toBe(0);
      expect(r.argv).toEqual(["--pack", ".", "--format", "json"]);
    });

    it("APPENDS `--format json` itself, because net 2 reads structure", () => {
      // The gate's own argument, not a forwarded one: a caller cannot pass
      // `--format` (the allow-list refuses it), and net 2 parses the document
      // this flag produces. A wrapper that dropped it would leave net 2 parsing
      // attw's table and reddening every green run, so this is pinned on its own
      // rather than left riding along on the two cases above.
      expect(forwardedArgv(OFFLINE).argv.slice(-2)).toEqual(["--format", "json"]);
      expect(forwardedArgv([]).argv.slice(-2)).toEqual(["--format", "json"]);
    });

    it("forwards `--profile` with its value, in both spellings", () => {
      // The other allow-listed argument. Sibling manifests pass
      // `--profile node16`, and a separated value has to be claimed explicitly or
      // it would be read as an option on the next turn and refused.
      expect(forwardedArgv(["--profile", "node16"]).argv).toEqual([
        "--pack",
        ".",
        "--profile",
        "node16",
        "--format",
        "json",
      ]);
      expect(forwardedArgv(["--profile=node16"]).argv).toEqual([
        "--pack",
        ".",
        "--profile=node16",
        "--format",
        "json",
      ]);
    });

    it("refuses everything else, so `forwards it` cannot be satisfied by forwarding all", () => {
      // The allow-list is what makes the two cases above a PIN rather than a
      // description: a wrapper that simply passed its argv through would satisfy
      // them and reopen every blinding route in the wrapper's own BLINDING note.
      const r = forwardedArgv(["--quiet"]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("not an argument this gate accepts");
      expect(r.argv).toEqual([]); // attw was never reached
    });
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
      const gated = emittedAttw(typesNotPacked, OFFLINE);
      expect(gated.code).not.toBe(0);
      // Structurally, and WITHOUT the sentence: the emitted gate forces
      // `--format json`, in which attw never renders the untyped prose. The
      // negation is what carries the change into the scaffolded copy.
      expect(gated.out).toContain("analysed this package as UNTYPED");
      expect(gated.out).not.toContain(UNTYPED);
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
      const gated = emittedAttw(scaffold, OFFLINE);
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

describe("a freshly scaffolded parser's `prepare` keeps the hook's output off stdout", () => {
  // THE DEFECT, found 2026-11-07 while setting up cosyte/pathways from this scaffolder. npm runs
  // `prepare` during `npm pack`, and that includes the `npm pack --dry-run --json` whose stdout
  // the shared gate's tarball net JSON.parses. A lifecycle script's stdout lands in npm's stdout,
  // ahead of the document. simple-git-hooks 2.13.0 reports on stdout (`console.log` and
  // `console.info` in its `cli.js` and `simple-git-hooks.js`), so once `pnpm install` had put it
  // in `node_modules/.bin`, the template's old `prepare` left every scaffolded repo with a
  // `pnpm attw` that refused, "did not print JSON". cosyte/hl7 and cosyte/pathways send the hook's
  // output to stderr with `1>&2`, and the template now does too.
  //
  // DIVERTED, NOT DISCARDED. simple-git-hooks reports a FAILED install on stdout as well, and
  // exits 0 anyway, so a `prepare` that dropped its stdout would hide a repo whose PHI pre-commit
  // scan was never installed. The case below asserts the line reaches stderr, not only that stdout
  // is clean.
  //
  // THE HOOK IS A STAND-IN, because nothing here installs simple-git-hooks. It sits where
  // `pnpm install` puts the real one, which is on the PATH npm gives a lifecycle script, and it
  // prints on stdout as the real one does. It also leaves a marker, so a `prepare` that never
  // reached it (deleted, or skipped) reds on liveness rather than passing on an empty stdout.
  //
  // WHAT THE npm CHILD INHERITS (#47): the environment minus the two pack-placement keys, as for
  // every other spawn in this file. `--dry-run`, `--json` and `--ignore-scripts=false` are on
  // argv, where they outrank an ambient `npm_config_*` of the same name, so the run is the gate's
  // own call with `prepare` firing.
  const OLD_PREPARE = "command -v simple-git-hooks >/dev/null 2>&1 && simple-git-hooks || true";
  const HOOK_LINE = "[INFO] Successfully set all git hooks";

  /** The emitted repo, as the scaffolder wrote it. */
  let emitted: string;
  /** The same repo with the template's old `prepare` put back: the counterfactual. */
  let unfixed: string;

  /** Plant the stand-in hook in `dir`; it touches `marker` and prints on stdout when it runs. */
  function plantHook(dir: string, marker: string): void {
    const binDir = join(dir, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const hook = join(binDir, "simple-git-hooks");
    writeFileSync(hook, `#!/bin/sh\n: > "${marker}"\necho "${HOOK_LINE}"\n`);
    chmodSync(hook, 0o755);
  }

  /** The package names an `npm pack --json` document lists. Throws when stdout is not one. */
  function packedNames(stdout: string): unknown[] {
    // npm 10 and 11 print an array of tarballs and npm 12 an object keyed by package name, all
    // three measured. This asks only that stdout is one JSON document and that it names this
    // package.
    const doc: unknown = JSON.parse(stdout);
    const entries: unknown[] = Array.isArray(doc) ? doc : Object.values(doc as object);
    return entries.map((entry) => (entry as { name?: unknown }).name);
  }

  function packDryRun(dir: string): RunResult {
    return run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts=false"], dir);
  }

  beforeAll(() => {
    const out = join(root, "hooks");
    const scaffolded = run(process.execPath, [SCAFFOLDER, "demo", "--out", out], REPO_ROOT);
    expect(scaffolded.code, scaffolded.out).toBe(0);
    emitted = join(out, "demo");

    unfixed = join(root, "hooks-unfixed");
    cpSync(emitted, unfixed, { recursive: true });
    const manifestPath = join(unfixed, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.prepare = OLD_PREPARE;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  });

  it(
    "COUNTERFACTUAL: under the old `prepare` the hook's line is in npm's stdout, which is not JSON",
    () => {
      // Without this, the case below would pass just as well on an npm that stopped passing a
      // lifecycle script's stdout through, and it would pin nothing about the `prepare` line.
      const marker = join(root, "hook-ran-unfixed");
      plantHook(unfixed, marker);
      const r = packDryRun(unfixed);
      expect(r.code, r.out).toBe(0);
      expect(existsSync(marker), "the old prepare never reached the hook").toBe(true);
      expect(r.stdout).toContain(HOOK_LINE);
      expect(() => packedNames(r.stdout)).toThrow();
    },
    SPAWN_TIMEOUT,
  );

  it(
    "the emitted `prepare` sends the hook's line to stderr, so npm's stdout stays JSON",
    () => {
      const marker = join(root, "hook-ran-emitted");
      plantHook(emitted, marker);
      const r = packDryRun(emitted);
      expect(r.code, r.out).toBe(0);
      expect(existsSync(marker), "the emitted prepare never reached the hook").toBe(true);
      expect(r.stdout).not.toContain(HOOK_LINE);
      expect(packedNames(r.stdout)).toEqual(["@cosyte/demo"]);
      expect(r.stderr).toContain(HOOK_LINE);
    },
    SPAWN_TIMEOUT,
  );
});
