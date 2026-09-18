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
 * The end-to-end case therefore runs the REAL scaffolder, SIMULATES THE INSTALL,
 * and shows the emitted gate reddening on a pack that bare `attw` passes.
 * `pnpm install` is not available to a test, so the simulation is two plants and
 * nothing else: the `attw` binary at the path the emitted wrapper looks for,
 * reached through a generated shim, and `@cosyte/script-utils` where pnpm would
 * put it. The second plant is new, and it is what the consolidation costs this
 * suite: the emitted wrapper is now a CALLER of `@cosyte/script-utils/attw`
 * rather than a 1500-line copy of the gate, so a tree with no `node_modules`
 * would fail to resolve the body instead of running it. A COPY rather than a
 * symlink, for the reason `test/phi-scan-scaffold.test.ts` gives about its own
 * engine plant: a symlink into this workspace would let a test mutate the source
 * tree.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell form.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
  out: string;
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

function run(bin: string, args: string[], cwd: string): RunResult {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !PACK_PLACEMENT_CONFIG.test(key)),
  );
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 100_000, env });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
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

  // Plumb it in at the path the emitted wrapper resolves, which is
  // `<repo>/node_modules/.bin/attw` relative to the wrapper's own location.
  const binDir = join(scaffold, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, "attw");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${attwEntry}" "$@"\n`);
  chmodSync(shim, 0o755);

  // ...and the shared body, where `pnpm install` would put it. The emitted wrapper imports
  // `@cosyte/script-utils/attw`; without this plant it would not resolve, and every case below
  // would measure a missing dependency rather than the gate.
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
  // The EMITTED wrapper, so this pins what a scaffolded parser would really run,
  // and the shared body it calls, at the path its import resolves through.
  writeFileSync(
    join(argvProbe, "scripts", "attw.mjs"),
    readFileSync(join(scaffold, "scripts", "attw.mjs")),
  );
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

/** Run the emitted wrapper against the argv probe and return what attw was handed. */
function forwardedArgv(args: string[]): { code: number; out: string; argv: string[] } {
  rmSync(argvLog, { force: true });
  const r = run(process.execPath, [join(argvProbe, "scripts", "attw.mjs"), ...args], argvProbe);
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
    // Two files exist because the template's has to travel into a new repo while
    // test-utils' has to sit beside its own node_modules. Nothing keeps them in
    // step except this assertion, so a one-sided edit reds here rather than
    // leaving one gate weaker than the other.
    //
    // WHAT THEY ARE COPIES OF CHANGED, AND THE ASSERTION DID NOT. Each used to be
    // a 1500-line copy of the whole gate, and this line was the only thing
    // stopping the two drifting; they are now callers of
    // `@cosyte/script-utils/attw`, which is where drift is prevented instead. The
    // assertion is kept rather than deleted because two callers can still drift
    // (an argument dropped here, a different url passed there), and the case below
    // is what pins the stronger claim the caller shape now allows.
    const fromTemplate = readFileSync(join(TEMPLATE, "scripts", "attw.mjs"));
    const fromPackage = readFileSync(join(TEST_UTILS, "scripts", "attw.mjs"));
    expect(fromTemplate.equals(fromPackage)).toBe(true);
  });

  it("every wrapper is a CALLER: it imports the shared body and carries no net of its own", () => {
    for (const wrapper of [
      join(TEMPLATE, "scripts", "attw.mjs"),
      join(TEST_UTILS, "scripts", "attw.mjs"),
    ]) {
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
          if (statSync(full).size > 2 * 1024 * 1024) return false;
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
  it("emits the wrapper and an attw script that calls it", () => {
    const pkg = JSON.parse(readFileSync(join(scaffold, "package.json"), "utf8")) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe("@cosyte/demo"); // the scaffolder really ran
    expect(pkg.scripts.attw).toBe("node scripts/attw.mjs");
    expect(pkg.scripts.attw).not.toMatch(BARE_INVOCATION);
    // `prepublishOnly` MUST NOT END IN A TOOL THAT PACKS. `attw --pack .` packs a
    // tarball of its own INTO THE DIRECTORY BEING PUBLISHED, and under
    // `pnpm publish --dry-run` it does not pack at all: that command exports
    // `npm_config_dry_run=true` into every lifecycle script it runs, `npm pack`
    // honours it and writes nothing, and attw then opens the path it computed and
    // dies with ENOENT on its own tgz. (An earlier reading of this blamed a
    // "staging context" and said a real publish would fail identically. Both are
    // RETRACTED: the lifecycle environment of a non-dry-run publish carries no
    // such variable, measured.) It stayed hidden because `publish --dry-run` SKIPS
    // a version already on npm, so the chain only ever runs on a version bump: it
    // blocked every release of `@cosyte/test-utils` until #40 (`f32e7dd`) removed
    // it there. The template re-minted the same shape into every new parser until
    // this slice. attw still runs where it belongs, as its own CI step.
    expect(pkg.scripts.prepublishOnly).not.toMatch(/\battw\b/);
    // ...and the rest of the chain is still there, so this cannot be satisfied by
    // deleting the script.
    for (const step of ["pnpm clean", "pnpm typecheck", "pnpm lint", "pnpm test", "pnpm build"]) {
      expect(pkg.scripts.prepublishOnly).toContain(step);
    }

    // The emitted wrapper survived token substitution unchanged. It carries no
    // {{...}} tokens, so byte-identity through the scaffolder is the expectation.
    const emitted = readFileSync(join(scaffold, "scripts", "attw.mjs"));
    const source = readFileSync(join(TEMPLATE, "scripts", "attw.mjs"));
    expect(emitted.equals(source)).toBe(true);
  });

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
      const gated = run(
        process.execPath,
        [join(scaffold, "scripts", "attw.mjs"), ...OFFLINE],
        typesNotPacked,
      );
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
