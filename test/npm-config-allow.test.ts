import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// THE NEGATIVE CONTROL FOR THE PUBLISH CONFIGURATION ALLOW-CHECK (spec S0081, resolving S0055's F9).
//
// The defect: everything that decides WHERE these eight tarballs go, WHAT goes inside them and WHAT
// METADATA rides along is npm/pnpm configuration, assembled at publish time out of sources nothing
// in this repository inspected. A redirected `registry`, a disabled `provenance`, a widened `access`
// or an injected lifecycle-script setting changes what reaches the public registry without changing
// a tracked file in a way review would see. An npm publish is permanent and cannot be withdrawn.
//
// A gate against a silent change is worth exactly what its negative control proves, so this suite
// asserts BOTH directions for every source and every refusal state:
//
//   NEGATIVE  a value no allow-set entry permits must make the check exit NON-ZERO.
//   POSITIVE  the repository as it stands today, and any value the allow-set does permit, must make
//             it exit ZERO. A gate that refuses everything also fails the negative case.
//
// It drives the SHIPPED CLI with execFileSync rather than calling the exported functions, because
// what release.yml depends on is the process exit code. The same gap bit this repo before: attw's
// wrapper exited 0 on an untyped pack while its unit surface reported the failure correctly (#42).

const REPO_ROOT = join(import.meta.dirname, "..");
const CHECK = join(REPO_ROOT, "scripts", "npm-config-allow.mjs");
const RELEASE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "release.yml");

// Every run of the check spawns npm twice and pnpm twice (effective plus a measured defaults
// baseline). Vitest's five second default is not a budget this can live inside, and a timeout here
// would read as a flaky gate rather than as a slow one.
const SLOW = 180_000;

/** A token shape the redaction rule must never let through, built so this file holds no real one. */
const FAKE_TOKEN = `npm_${"a".repeat(36)}`;

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir === undefined) continue;
    // A fixture deliberately chmods a file to 000 to prove the unreadable-source refusal. Put the
    // bits back before removing, or the cleanup fails on the very case it was asked to set up.
    try {
      restorePermissions(dir);
    } catch {
      /* best effort */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Make every file under a directory removable again.
 *
 * @param dir Directory to walk.
 */
function restorePermissions(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) restorePermissions(path);
    else chmodSync(path, 0o644);
  }
}

/**
 * Make a throwaway directory that is cleaned up after the test.
 *
 * @param prefix Name prefix.
 * @returns The directory.
 */
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  temporaryDirs.push(dir);
  return dir;
}

interface AllowEntry {
  key: string;
  value?: unknown;
  anyValue?: true;
  pattern?: string;
  why: string;
}

/**
 * The settings this harness's own context contributes, declared once.
 *
 * A test fixture cannot be given a context in which NOTHING is contributed: pointing npm at an empty
 * global rc is itself an environment contribution, and pnpm derives its own global rc path from
 * HOME. These entries are that noise, named honestly rather than filtered out inside the check,
 * where filtering would be a hole.
 */
const AMBIENT_ALLOW: AllowEntry[] = [
  { key: "globalconfig", anyValue: true, why: "the harness points the resolvers at an empty rc" },
  { key: "npm-globalconfig", anyValue: true, why: "same" },
  { key: "userconfig", anyValue: true, why: "same" },
  { key: "prefix", anyValue: true, why: "the fixture root differs from the baseline sandbox" },
  { key: "dir", anyValue: true, why: "same" },
  { key: "user-agent", anyValue: true, why: "embeds tool versions" },
];

interface FixtureOptions {
  projectNpmrc?: string;
  userNpmrc?: string;
  workspaceYaml?: string;
  changesetConfig?: string;
  rootPnpmField?: Record<string, unknown>;
  packages?: Record<string, Record<string, unknown>>;
  packageNpmrc?: Record<string, string>;
  env?: Record<string, string>;
}

interface Fixture {
  root: string;
  home: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Build a throwaway workspace and the process context the check will be run in.
 *
 * The context is BUILT rather than inherited: a test that read the developer's own `~/.npmrc` would
 * pass or fail on a fact about the laptop it ran on, which is the opposite of what this gate is for.
 *
 * @param options What the fixture should carry.
 * @returns The workspace root, its HOME, and the environment.
 */
function fixture(options: FixtureOptions = {}): Fixture {
  const root = temp("npm-config-allow");
  const home = temp("npm-config-allow-home");

  const manifest: Record<string, unknown> = { name: "fixture", version: "0.0.0", private: true };
  if (options.rootPnpmField !== undefined) manifest.pnpm = options.rootPnpmField;
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.projectNpmrc !== undefined) {
    writeFileSync(join(root, ".npmrc"), options.projectNpmrc, "utf8");
  }
  if (options.workspaceYaml !== undefined) {
    writeFileSync(join(root, "pnpm-workspace.yaml"), options.workspaceYaml, "utf8");
  }
  if (options.changesetConfig !== undefined) {
    mkdirSync(join(root, ".changeset"), { recursive: true });
    writeFileSync(join(root, ".changeset", "config.json"), options.changesetConfig, "utf8");
  }
  for (const [name, extras] of Object.entries(options.packages ?? {})) {
    const dir = join(root, "packages", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: `@fixture/${name}`, version: "0.0.1", ...extras }, null, 2)}\n`,
      "utf8",
    );
  }
  for (const [name, contents] of Object.entries(options.packageNpmrc ?? {})) {
    writeFileSync(join(root, "packages", name, ".npmrc"), contents, "utf8");
  }

  const emptyRc = join(home, "empty-npmrc");
  writeFileSync(emptyRc, "", "utf8");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    NPM_CONFIG_GLOBALCONFIG: emptyRc,
  };
  if (options.userNpmrc !== undefined) {
    const userRc = join(home, "user-npmrc");
    writeFileSync(userRc, options.userNpmrc, "utf8");
    env.NPM_CONFIG_USERCONFIG = userRc;
  }
  Object.assign(env, options.env ?? {});
  return { root, home, env };
}

/**
 * Write an allow-set and hand back its path.
 *
 * @param dir Where to put it.
 * @param allowSet The allow-set, or raw text for the malformed cases.
 * @returns The path.
 */
function allowSetFile(dir: string, allowSet: unknown, name = "allow-set.json"): string {
  const path = join(dir, name);
  writeFileSync(path, typeof allowSet === "string" ? allowSet : JSON.stringify(allowSet), "utf8");
  return path;
}

/**
 * A well-formed allow-set carrying the harness noise plus whatever a test needs.
 *
 * @param allow Entries under test.
 * @param require Requirements under test.
 * @returns The allow-set object.
 */
function allowing(allow: AllowEntry[] = [], require: AllowEntry[] = []): object {
  return { version: 1, allow: [...AMBIENT_ALLOW, ...allow], require };
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * Run the shipped CLI and capture its exit code and output.
 *
 * @param root Workspace root.
 * @param env The process context.
 * @param extraArgs Extra CLI arguments.
 * @returns The exit code and output.
 */
function runCheck(root: string, env: NodeJS.ProcessEnv, extraArgs: string[] = []): Run {
  const args = [CHECK, "--workspace", root, ...extraArgs];
  try {
    const stdout = execFileSync("node", args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "", output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    const stdout = err.stdout ?? "";
    const stderr = err.stderr ?? "";
    return { code: err.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
  }
}

/**
 * Normalize a whole report so an assertion about a key name survives pnpm spelling the same setting
 * `ignore-scripts` in one major version and `ignoreScripts` in the next.
 *
 * @param text The report.
 * @returns The report with camelCase keys folded to dash-case.
 */
function foldKeys(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Hash every file under a directory, so "byte-identical" can be asserted rather than assumed.
 *
 * @param dir The directory.
 * @returns Path to hash, for every regular file.
 */
function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, hashTree(path));
    else out[path] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  return out;
}

/**
 * Write an executable stand-in for a package manager.
 *
 * @param dir Where to put it.
 * @param name The file name.
 * @param body Shell body after the shebang.
 * @returns The path.
 */
function fakeBin(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
  return path;
}

// ---------------------------------------------------------------------------------------------
// CORE BEHAVIOUR (C1 to C4)
// ---------------------------------------------------------------------------------------------

describe("npm-config-allow: the negative control", () => {
  it(
    "REFUSES a contributed setting no allow-set entry permits, and names the key and its source (C1, C2)",
    () => {
      const { root, env } = fixture({ projectNpmrc: "foo-bar=1\n" });
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);

      // Non-zero is the whole point: the failure being closed is a publish under configuration
      // nobody approved, and an npm publish cannot be withdrawn.
      expect(code).toBe(1);
      expect(output).toContain("foo-bar");
      // C2: the SOURCE, not just the key. A reader who is told a key changed goes looking; a reader
      // who is told which file supplied it goes and fixes it.
      expect(output).toContain(join(root, ".npmrc"));
      expect(output).toContain("NOT permitted by the allow-set");
    },
    SLOW,
  );

  it(
    "ACCEPTS the same setting once the allow-set permits it at that value (C1)",
    () => {
      const { root, env } = fixture({ projectNpmrc: "foo-bar=1\n" });
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([{ key: "foo-bar", value: "1", why: "under test" }])),
      ]);

      expect(code).toBe(0);
      expect(output).toContain("npm-config-allow: OK");
    },
    SLOW,
  );

  it(
    "REFUSES the same key at a value the allow-set does not permit (C1)",
    () => {
      // The control for the line above. An entry that permits a key at ANY value would also pass
      // the positive case, so the pair is what proves the value is being compared.
      const { root, env } = fixture({ projectNpmrc: "foo-bar=2\n" });
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([{ key: "foo-bar", value: "1", why: "under test" }])),
      ]);

      expect(code).toBe(1);
      expect(output).toContain("foo-bar");
    },
    SLOW,
  );

  it(
    "leaves every configuration source byte-identical (C4)",
    () => {
      const { root, env, home } = fixture({
        projectNpmrc: "foo-bar=1\n",
        userNpmrc: "user-key=u\n",
        workspaceYaml: 'packages:\n  - "packages/*"\n',
        changesetConfig: '{"access":"public"}\n',
        rootPnpmField: { overrides: { left: "1.0.0" } },
        packages: { alpha: { publishConfig: { access: "public" } } },
        packageNpmrc: { alpha: "package-key=p\n" },
      });
      // Written BEFORE the census, so the allow-set itself is in it: a check that rewrote its own
      // input would be caught here as well.
      const allowSet = allowSetFile(root, allowing());
      // Scoped to the configuration SOURCES, which is what the criterion is about. npm writes a
      // timestamped debug log under `$HOME/.npm/_logs` on every invocation, which is its own cache
      // rather than anybody's configuration, and asserting over the whole of HOME would be
      // asserting about npm's logging.
      const census = (): Record<string, string> => ({
        ...hashTree(root),
        [join(home, "user-npmrc")]: createHash("sha256")
          .update(readFileSync(join(home, "user-npmrc")))
          .digest("hex"),
        [join(home, "empty-npmrc")]: createHash("sha256")
          .update(readFileSync(join(home, "empty-npmrc")))
          .digest("hex"),
      });
      const before = census();

      runCheck(root, env, ["--allow-set", allowSet]);

      expect(census()).toEqual(before);
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// OBSERVATION COVERAGE (C5 to C9). One case per configuration source, each proving the source is
// OBSERVED rather than assumed, and each with the allow-set as the only thing standing between the
// value and a release.
// ---------------------------------------------------------------------------------------------

describe("npm-config-allow: every configuration source is observed", () => {
  it(
    "observes a key set only in the USER config (C5)",
    () => {
      const { root, env } = fixture({ userNpmrc: "user-only-key=u\n" });
      const refused = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);
      expect(refused.code).toBe(1);
      expect(refused.output).toContain("user-only-key");

      const permitted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([{ key: "user-only-key", value: "u", why: "under test" }])),
      ]);
      expect(permitted.code).toBe(0);
    },
    SLOW,
  );

  it(
    "observes a key set only in the REPOSITORY .npmrc (C6)",
    () => {
      const { root, env } = fixture({ projectNpmrc: "project-only-key=p\n" });
      const refused = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);
      expect(refused.code).toBe(1);
      expect(refused.output).toContain("project-only-key");

      const permitted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([{ key: "project-only-key", value: "p", why: "under test" }])),
      ]);
      expect(permitted.code).toBe(0);
    },
    SLOW,
  );

  it(
    "observes a key set only in a PER-PACKAGE .npmrc, which is the publish command's own cwd (C6)",
    () => {
      // `changeset publish` spawns `pnpm publish` with the PACKAGE directory as its working
      // directory, so an `.npmrc` there is a project config for that publish and not a stray file.
      const { root, env } = fixture({
        workspaceYaml: 'packages:\n  - "packages/*"\n',
        packages: { alpha: {} },
        packageNpmrc: { alpha: "package-only-key=p\n" },
      });
      const refused = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);
      expect(refused.code).toBe(1);
      expect(refused.output).toContain("packageNpmrc:package-only-key");
      expect(refused.output).toContain(join(root, "packages", "alpha", ".npmrc"));

      const permitted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([
            { key: "packageNpmrc:package-only-key", value: "p", why: "under test" },
            { key: "packages", value: ["packages/*"], why: "under test" },
          ]),
        ),
      ]);
      expect(permitted.code).toBe(0);
    },
    SLOW,
  );

  it(
    "observes a key set only in the WORKSPACE configuration (C7)",
    () => {
      const { root, env } = fixture({
        workspaceYaml: 'packages:\n  - "packages/*"\nnodeLinker: hoisted\n',
        packages: { alpha: {} },
      });
      const refused = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);
      expect(refused.code).toBe(1);
      expect(foldKeys(refused.output)).toContain("node-linker");

      const permitted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([
            { key: "node-linker", value: "hoisted", why: "under test" },
            { key: "packages", value: ["packages/*"], why: "under test" },
          ]),
        ),
      ]);
      expect(permitted.code).toBe(0);
    },
    SLOW,
  );

  it(
    "observes the root manifest's `pnpm` block and each package's `publishConfig` (C7)",
    () => {
      const { root, env } = fixture({
        workspaceYaml: 'packages:\n  - "packages/*"\n',
        rootPnpmField: { overrides: { left: "1.0.0" } },
        packages: { alpha: { publishConfig: { access: "restricted" } } },
      });
      const refused = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);
      expect(refused.code).toBe(1);
      expect(refused.output).toContain("pnpm-field:overrides");
      expect(refused.output).toContain("publishConfig:access");
      expect(refused.output).toContain("restricted");

      const permitted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([
            { key: "pnpm-field:overrides", value: { left: "1.0.0" }, why: "under test" },
            { key: "publishConfig:access", value: "restricted", why: "under test" },
            { key: "packages", value: ["packages/*"], why: "under test" },
          ]),
        ),
      ]);
      expect(permitted.code).toBe(0);
    },
    SLOW,
  );

  it(
    "observes a key set only in the PROCESS ENVIRONMENT of the publish step (C8)",
    () => {
      const { root, env } = fixture({ env: { npm_config_env_only_key: "e" } });
      const refused = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);
      expect(refused.code).toBe(1);
      expect(refused.output).toContain("env-only-key");

      const permitted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([{ key: "env-only-key", value: "e", why: "under test" }])),
      ]);
      expect(permitted.code).toBe(0);
    },
    SLOW,
  );

  it(
    "judges the value the publish would USE, never a shadowed one (C9)",
    () => {
      // The environment outranks a repository `.npmrc`. An allow-set that permits only the value
      // the `.npmrc` declares must NOT clear this run: the publish would use the environment's.
      const { root, env } = fixture({
        projectNpmrc: "shadow-key=from-npmrc\n",
        env: { npm_config_shadow_key: "from-env" },
      });
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([{ key: "shadow-key", value: "from-npmrc", why: "the value that LOST" }]),
        ),
      ]);

      expect(code).toBe(1);
      expect(output).toContain("from-env");
      // The losing value is reported so a reader can see the conflict, and it is labelled as not
      // judged so it can never be mistaken for the basis of a pass.
      expect(output).toContain("shadowed, not judged");
    },
    SLOW,
  );

  it(
    "clears the same run when the allow-set permits the value that WINS (C9)",
    () => {
      const { root, env } = fixture({
        projectNpmrc: "shadow-key=from-npmrc\n",
        env: { npm_config_shadow_key: "from-env" },
      });
      const { code } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([{ key: "shadow-key", value: "from-env", why: "the value that WINS" }]),
        ),
      ]);

      expect(code).toBe(0);
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// PLACEMENT (C10 to C12). The check is a property of a SPECIFIC PROCESS, so where it runs is the
// substance rather than a detail: a configuration observed in the ungated preflight job is not
// evidence about the gated publish.
// ---------------------------------------------------------------------------------------------

/**
 * Split `release.yml` into its job blocks.
 *
 * A line reader rather than a YAML parse, for the same reason the guards under `scripts/` are
 * zero-dependency: this must not acquire a dependency to assert a property of a workflow file. The
 * shape it depends on (jobs at two spaces, job keys at four, step entries at six) is asserted below,
 * so a restructure fails loudly here instead of quietly reducing these tests to tautologies.
 *
 * @param text The workflow file.
 * @returns Job name to the block's lines.
 */
function jobBlocks(text: string): Map<string, string[]> {
  const lines = text.split("\n");
  const blocks = new Map<string, string[]>();
  let current: string | null = null;
  let seenJobs = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      seenJobs = true;
      continue;
    }
    if (!seenJobs) continue;
    const header = /^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (header !== null) {
      current = header[1];
      blocks.set(current, []);
      continue;
    }
    if (current !== null) blocks.get(current)?.push(line);
  }
  return blocks;
}

describe("npm-config-allow: where the check runs", () => {
  const workflow = readFileSync(RELEASE_WORKFLOW, "utf8");
  const blocks = jobBlocks(workflow);

  it("parses the three jobs the release workflow is split into", () => {
    // If this fails, every assertion below is measuring nothing. Asserted first, on purpose.
    expect([...blocks.keys()].sort()).toEqual(["preflight", "publish", "version"]);
  });

  it("runs the allow-check inside the gated publish job, BEFORE the step that publishes (C10)", () => {
    const publish = blocks.get("publish") ?? [];
    const checkStep = publish.findIndex((line) =>
      line.includes("- name: The publish configuration must be one the allow-set permits"),
    );
    const publishStep = publish.findIndex((line) => line.includes("publish: pnpm run release"));

    expect(checkStep).toBeGreaterThanOrEqual(0);
    expect(publishStep).toBeGreaterThanOrEqual(0);
    // Before the publish, so a refusal happens with no tarball created and no registry write
    // attempted. `changeset publish` packs and uploads in one command; there is no later point.
    expect(checkStep).toBeLessThan(publishStep);
    // And it runs the shipped CLI, not a re-implementation.
    expect(publish.slice(checkStep, publishStep).join("\n")).toContain(
      "node scripts/npm-config-allow.mjs",
    );
  });

  it("runs the allow-check in NO other job (C10, and the spec's explicit out-of-scope)", () => {
    // An advisory copy in `preflight` would run in a different execution context, with different
    // permissions, no npm credentials and no `release` environment. A green answer about the wrong
    // process is precisely the evidence F9 says is worthless, and shipping one alongside the real
    // check invites it to be read as one.
    for (const job of ["preflight", "version"]) {
      expect((blocks.get(job) ?? []).join("\n")).not.toContain("npm-config-allow");
    }
  });

  it("carries the same npm configuration environment as the step that publishes (C10)", () => {
    // Effective configuration is a property of a process. NPM_CONFIG_PROVENANCE is supplied at STEP
    // level, so a check that ran without it would be reporting on a configuration the publish does
    // not have. This is the assertion that keeps the two blocks in step.
    const publish = (blocks.get("publish") ?? []).join("\n");
    const checkStepEnv =
      /- name: The publish configuration must be one the allow-set permits\n([\s\S]*?)\n {6}- /.exec(
        publish,
      );
    expect(checkStepEnv).not.toBeNull();
    const stepText = checkStepEnv?.[1] ?? "";
    expect(stepText).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(stepText).toContain(
      "NPM_CONFIG_PROVENANCE: ${{ github.event.repository.visibility == 'public' }}",
    );
    // AND NOT ONE VARIABLE MORE. `NPM_TOKEN` is in the publish step because `changesets/action`
    // wants it; nothing on the CONFIGURATION path reads it, since npm reads only `npm_config_*` and
    // the registry credential arrives through the generated npmrc. Copying it here would widen this
    // repository's declared credential surface (S0080) by one step for no gain. Matched as an env
    // KEY, because the line above legitimately contains the substring `secrets.NPM_TOKEN`.
    expect(stepText).not.toMatch(/^\s+NPM_TOKEN:/m);
    // C20's workflow half: nothing may let this step be skipped or downgraded to a warning. A gate
    // that can be skipped is a gate that will be.
    expect(stepText).not.toContain("continue-on-error");
    expect(stepText).not.toMatch(/^\s+if:/m);
  });

  it("declares its own credential exposure in the S0080 surface declaration (C10, C11)", () => {
    // `scripts/credential-surface.mjs` already refuses a workflow that disagrees with the
    // declaration, and it runs in the required `verify` job. This asserts the other half from this
    // side: the step this spec added is NAMED in the declaration rather than having been slipped
    // past it, so a reader of either file finds the other. Both gates stay whole.
    const declaration = JSON.parse(
      readFileSync(join(REPO_ROOT, ".github", "credential-surface.json"), "utf8"),
    );
    const step = "The publish configuration must be one the allow-set permits";
    const npmToken = declaration.credentials.find(
      (entry: { name: string }) => entry.name === "NPM_TOKEN",
    );
    expect(
      npmToken.exposures.some(
        (exposure: { job: string; step: string; name: string }) =>
          exposure.job === "publish" &&
          exposure.step === step &&
          exposure.name === "NODE_AUTH_TOKEN",
      ),
    ).toBe(true);
    // And NPM_TOKEN itself is declared nowhere but the publish step.
    expect(
      npmToken.exposures.filter((exposure: { name: string }) => exposure.name === "NPM_TOKEN"),
    ).toEqual([{ job: "publish", step: "Publish", as: "env", name: "NPM_TOKEN", mode: "value" }]);

    const provenance = declaration.settings.find(
      (entry: { name: string }) => entry.name === "NPM_CONFIG_PROVENANCE",
    );
    expect(
      provenance.exposures.some(
        (exposure: { job: string; step: string }) =>
          exposure.job === "publish" && exposure.step === step,
      ),
    ).toBe(true);
  });

  it("leaves every existing gate exactly where S0074 put it (C11)", () => {
    const preflightLines = blocks.get("preflight") ?? [];
    const versionLines = blocks.get("version") ?? [];
    const preflight = preflightLines.join("\n");
    const publish = (blocks.get("publish") ?? []).join("\n");
    const version = versionLines.join("\n");

    // The publish arm is still gated on the protected environment. Matched as a JOB-LEVEL KEY (four
    // spaces) rather than as a substring, because this file's comments discuss `environment:
    // release` at length and a substring assertion would pass on the prose.
    expect(
      (blocks.get("publish") ?? []).some((line) => /^ {4}environment: release$/.test(line)),
    ).toBe(true);
    // The two existing release gates still run in the UNGATED preflight job, so no human is asked
    // to approve a run that was already doomed.
    expect(preflight).toContain("node scripts/changeset-guard.mjs");
    expect(preflight).toContain("node scripts/release-notes.mjs prepare");
    expect(preflightLines.some((line) => /^ {4}environment:/.test(line))).toBe(false);
    expect(versionLines.some((line) => /^ {4}environment:/.test(line))).toBe(false);

    // Registry credentials still reach no job but the gated one.
    expect(preflight).not.toContain("secrets.NPM_TOKEN");
    expect(version).not.toContain("secrets.NPM_TOKEN");
    expect(publish).toContain("secrets.NPM_TOKEN");
  });

  it(
    "produces a verdict when a maintainer runs it outside CI with no credentials anywhere (C12)",
    () => {
      // No token in any source, no registry auth, no CI environment. The check must ANSWER, not
      // fall over: a gate that only works inside CI cannot be used to find out why CI refused.
      const { root, env } = fixture({ projectNpmrc: "foo-bar=1\n" });
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([{ key: "foo-bar", value: "1", why: "under test" }])),
      ]);

      expect(code).toBe(0);
      expect(output).toContain("npm-config-allow: OK");
      expect(output).not.toContain("could not run");
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// UNHAPPY PATHS (C13 to C20). Every one of these must be non-zero, and the ones that mean "this
// gate could not read its input" must be exit 2 rather than exit 1, or a broken gate and a caught
// violation become one signal in CI.
// ---------------------------------------------------------------------------------------------

describe("npm-config-allow: a source it cannot read is a refusal, never a skip", () => {
  it(
    "exits 2 naming a MALFORMED npmrc, and never treats it as contributing nothing (C13)",
    () => {
      // npm's own ini reader does not throw on this: it invents the setting `this is not ini` with
      // the value `true`. Reporting it as an empty source is the failure this refuses.
      const { root, env } = fixture({ projectNpmrc: "this is not ini\n" });
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);

      expect(code).toBe(2);
      expect(output).toContain(join(root, ".npmrc"));
      expect(output).toContain("could not run");
    },
    SLOW,
  );

  it(
    "exits 2 naming a MALFORMED changesets config (C13)",
    () => {
      const { root, env } = fixture({ changesetConfig: "{ not json\n" });
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);

      expect(code).toBe(2);
      expect(output).toContain(join(root, ".changeset", "config.json"));
    },
    SLOW,
  );

  it(
    "exits 2 naming a pnpm-workspace.yaml shape it cannot read (C13)",
    () => {
      const { root, env } = fixture({
        workspaceYaml: 'packages:\n  - "packages/*"\nnotes: >\n  a block scalar\n',
        packages: { alpha: {} },
      });
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);

      expect(code).toBe(2);
      expect(output).toContain(join(root, "pnpm-workspace.yaml"));
    },
    SLOW,
  );

  it(
    "exits 2 naming a source that EXISTS but cannot be read, and the reason (C14)",
    () => {
      const { root, env } = fixture({ projectNpmrc: "foo-bar=1\n" });
      chmodSync(join(root, ".npmrc"), 0o000);
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);

      expect(code).toBe(2);
      expect(output).toContain(join(root, ".npmrc"));
      expect(output).toContain("EACCES");
    },
    SLOW,
  );

  it(
    "exits 2 when a RESOLVER cannot be run, rather than passing over what it did resolve (C15)",
    () => {
      const { root, env } = fixture();
      const bin = temp("fake-bin");
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing()),
        "--npm-bin",
        fakeBin(bin, "npm", 'echo "npm exploded" >&2\nexit 1'),
      ]);

      expect(code).toBe(2);
      expect(output).toContain("npm's effective configuration");
      expect(output).toContain("Refusing to report a pass over the sources it did resolve");
    },
    SLOW,
  );

  it(
    "exits 2 when a resolver's ANSWER cannot be parsed (C15)",
    () => {
      const { root, env } = fixture();
      const bin = temp("fake-bin");
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing()),
        "--pnpm-bin",
        fakeBin(bin, "pnpm", 'echo "not json at all"'),
      ]);

      expect(code).toBe(2);
      expect(output).toContain("pnpm's effective configuration");
    },
    SLOW,
  );

  it(
    "exits 2 when it cannot find out WHERE a configuration source lives (C15)",
    () => {
      // npm answers, but without saying where its user config is. A source whose location is
      // unknown cannot be read, and a check that cannot read it must not report a pass.
      const { root, env } = fixture();
      const bin = temp("fake-bin");
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing()),
        "--npm-bin",
        fakeBin(
          bin,
          "npm",
          'case "$*" in\n  *--json*) echo \'{"globalconfig":"/dev/null"}\' ;;\n  *) echo "; node version = v22.14.0" ;;\nesac',
        ),
      ]);

      expect(code).toBe(2);
      expect(output).toContain("userconfig");
    },
    SLOW,
  );
});

describe("npm-config-allow: the allow-set itself", () => {
  it(
    "exits 2 when the allow-set is ABSENT, and never reads absence as permission (C16)",
    () => {
      // The configuration here would pass under a permissive allow-set, so a green exit would prove
      // absence had been read as "permit everything". That is the single most likely way a control
      // like this stops controlling anything.
      const { root, env } = fixture();
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        join(root, "does-not-exist.json"),
      ]);

      expect(code).toBe(2);
      expect(output).toContain("An absent allow-set is a REFUSAL");
    },
    SLOW,
  );

  it(
    "exits 2 when the allow-set is EMPTY of content (C16)",
    () => {
      const { root, env } = fixture();
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, "\n  \n")]);

      expect(code).toBe(2);
      expect(output).toContain("is empty");
    },
    SLOW,
  );

  it(
    "exits 2 when the allow-set is UNPARSEABLE (C16)",
    () => {
      const { root, env } = fixture();
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, '{"version": 1, "allow": ['),
      ]);

      expect(code).toBe(2);
      expect(output).toContain("not parseable JSON");
    },
    SLOW,
  );

  it(
    "ACCEPTS a well-formed allow-set declaring ZERO permitted deviations when nothing deviates (C17)",
    () => {
      // A genuinely pristine context is not reachable on a real machine: pointing the resolvers at
      // an empty rc is itself an environment contribution, and pnpm derives its own global rc path
      // from HOME. So the resolvers are stood in for here, which is the only part of the system
      // this criterion is about: zero declared deviations plus zero observed deviations is a PASS,
      // and an empty allow-set is therefore a legitimate state rather than a broken one.
      const { root, env, home } = fixture();
      const bin = temp("fake-bin");
      const emptyRc = join(home, "empty-npmrc");
      const { code, output } = runCheck(root, { ...env, FAKE_RC: emptyRc }, [
        "--allow-set",
        allowSetFile(root, { version: 1, allow: [], require: [] }),
        "--npm-bin",
        fakeBin(
          bin,
          "npm",
          'case "$*" in\n  *--json*) printf \'{"userconfig":"%s","globalconfig":"%s"}\\n\' "$FAKE_RC" "$FAKE_RC" ;;\n  *) echo "; node version = v22.14.0" ;;\nesac',
        ),
        "--pnpm-bin",
        fakeBin(bin, "pnpm", 'echo \'{"registry":"https://registry.npmjs.org/"}\''),
      ]);

      expect(code).toBe(0);
      expect(output).toContain("0 setting(s) contributed");
    },
    SLOW,
  );

  it(
    "REFUSES under a zero-deviation allow-set the moment any source contributes anything (C17)",
    () => {
      const { root, env } = fixture({ projectNpmrc: "foo-bar=1\n" });
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, { version: 1, allow: [], require: [] }),
      ]);

      expect(code).toBe(1);
      expect(output).toContain("foo-bar");
    },
    SLOW,
  );

  it(
    "REFUSES when a required key holds a different value, naming key, requirement and observation (C18)",
    () => {
      const { root, env } = fixture();
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing(
            [],
            [{ key: "registry", value: "https://registry.example.com/", why: "under test" }],
          ),
        ),
      ]);

      expect(code).toBe(1);
      expect(output).toContain("registry is required at");
      expect(output).toContain("https://registry.example.com/");
      expect(output).toContain("https://registry.npmjs.org/");
    },
    SLOW,
  );

  it(
    "REFUSES a required key that NO source contributes, rather than passing it by default (C18)",
    () => {
      // Two shapes of "no source contributes it": a key that has a package-manager default (npm
      // defaults `provenance` to false) and a key nothing knows at all. Both must be findings, or a
      // requirement could be satisfied by silence.
      const { root, env } = fixture();
      const defaulted = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, allowing([], [{ key: "provenance", value: true, why: "under test" }])),
      ]);
      expect(defaulted.code).toBe(1);
      expect(defaulted.output).toContain("provenance is required at true");
      expect(defaulted.output).toContain("false");

      const unknown = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([], [{ key: "no-source-sets-this", value: "x", why: "under test" }]),
        ),
      ]);
      expect(unknown.code).toBe(1);
      expect(unknown.output).toContain("(unset)");
    },
    SLOW,
  );

  it(
    "exits 2 on an allow-set that PINS a credential value, which would be a committed secret (C19)",
    () => {
      const { root, env } = fixture();
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, {
          version: 1,
          allow: [
            {
              key: "//registry.npmjs.org/:_authToken",
              value: FAKE_TOKEN,
              why: "this must be refused",
            },
          ],
          require: [],
        }),
      ]);

      expect(code).toBe(2);
      expect(output).toContain("PUBLIC repository");
      // The refusal must not print the very thing it is refusing.
      expect(output).not.toContain(FAKE_TOKEN);
    },
    SLOW,
  );

  it(
    "exits 2 on an allow-set entry with no `why`, and on one with two match modes",
    () => {
      const { root, env } = fixture();
      const noWhy = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, {
          version: 1,
          allow: [{ key: "registry", anyValue: true }],
          require: [],
        }),
      ]);
      expect(noWhy.code).toBe(2);
      expect(noWhy.output).toContain("`why`");

      const twoModes = runCheck(root, env, [
        "--allow-set",
        allowSetFile(root, {
          version: 1,
          allow: [{ key: "registry", value: "a", anyValue: true, why: "x" }],
          require: [],
        }),
      ]);
      expect(twoModes.code).toBe(2);
      expect(twoModes.output).toContain("EXACTLY ONE");
    },
    SLOW,
  );
});

describe("npm-config-allow: credentials never reach the output", () => {
  it(
    "prints a credential key's NAME with a fixed marker and never its value, on a refusal (C19)",
    () => {
      const { root, env } = fixture({
        projectNpmrc: `//registry.example.com/:_authToken=${FAKE_TOKEN}\ninnocent-looking-key=${FAKE_TOKEN}\n`,
      });
      const { code, output } = runCheck(root, env, ["--allow-set", allowSetFile(root, allowing())]);

      expect(code).toBe(1);
      // This repository is PUBLIC, so its build logs are public.
      expect(output).not.toContain(FAKE_TOKEN);
      expect(output).toContain("//registry.example.com/:_authToken");
      expect(output).toContain("[REDACTED]");
      // The second half is the one the key-name rule cannot see: a token pasted under a key nobody
      // would call a credential is scrubbed by shape as well as by name.
      expect(output).toContain("innocent-looking-key");
    },
    SLOW,
  );

  it(
    "prints a credential key's NAME with a fixed marker and never its value, on a PASS (C19)",
    () => {
      const { root, env } = fixture({
        projectNpmrc: `//registry.example.com/:_authToken=${FAKE_TOKEN}\n`,
      });
      const { code, output } = runCheck(root, env, [
        "--allow-set",
        allowSetFile(
          root,
          allowing([
            { key: "//registry.example.com/:_authToken", anyValue: true, why: "under test" },
          ]),
        ),
      ]);

      expect(code).toBe(0);
      expect(output).not.toContain(FAKE_TOKEN);
      expect(output).toContain("[REDACTED]");
    },
    SLOW,
  );
});

describe("npm-config-allow: a broken gate must not look like a caught violation, and never like a pass", () => {
  it(
    "exits 2, not 1, on an unknown argument (C20)",
    () => {
      const { root, env } = fixture();
      const { code, output } = runCheck(root, env, ["--bogus", "x"]);
      expect(code).toBe(2);
      expect(output).toContain("could not run");
    },
    SLOW,
  );

  it(
    "never exits 0 on any failure mode, so the publish step can never run on an unexamined configuration (C20)",
    () => {
      // The property C20 states is a property of the SET of failure modes, not of any one of them,
      // so it is asserted over the set. Whatever the reason, the release run reds.
      //
      // Each mode gets its own allow-set FILE. Sharing one path would let the last write win over
      // every earlier mode, and the broken-allow-set case would quietly become the healthy one.
      const { root, env } = fixture();
      const bin = temp("fake-bin");
      const good = allowSetFile(root, allowing(), "good-allow-set.json");
      const modes: string[][] = [
        ["--bogus"],
        ["--allow-set", join(root, "absent.json")],
        ["--allow-set", allowSetFile(root, "{", "broken-allow-set.json")],
        ["--allow-set", good, "--npm-bin", fakeBin(bin, "npm-dead", "exit 3")],
        ["--allow-set", good, "--pnpm-bin", fakeBin(bin, "pnpm-dead", "exit 3")],
      ];
      for (const args of modes) {
        const { code } = runCheck(root, env, args);
        expect(code, `arguments ${args.join(" ")}`).not.toBe(0);
      }
    },
    SLOW,
  );
});

// ---------------------------------------------------------------------------------------------
// THE REAL REPOSITORY (C3, C21, C22). Not a tautology: this is the state release.yml will actually
// run the check against.
// ---------------------------------------------------------------------------------------------

describe("npm-config-allow: the real repository", () => {
  /**
   * Build the context the check will meet, without inheriting the machine's own npm configuration.
   *
   * @param ci Whether to add what `actions/setup-node` puts in place for the gated publish job.
   * @returns The environment.
   */
  function repoContext(ci: boolean): NodeJS.ProcessEnv {
    const home = temp("real-repo-home");
    const emptyRc = join(home, "empty-npmrc");
    writeFileSync(emptyRc, "", "utf8");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      NPM_CONFIG_GLOBALCONFIG: emptyRc,
    };
    if (ci) {
      // What `actions/setup-node@v6` with `registry-url` actually does: it GENERATES an npmrc under
      // RUNNER_TEMP and exports NPM_CONFIG_USERCONFIG at it, then release.yml's publish step adds
      // the provenance flag and the token the generated file expands.
      const userRc = join(home, "setup-node.npmrc");
      writeFileSync(
        userRc,
        "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n",
        "utf8",
      );
      env.NPM_CONFIG_USERCONFIG = userRc;
      env.NPM_CONFIG_PROVENANCE = "true";
      env.NODE_AUTH_TOKEN = FAKE_TOKEN;
    }
    return env;
  }

  it("has no repository-level .npmrc, which must be a normal state and not an error (C3)", () => {
    expect(() => readFileSync(join(REPO_ROOT, ".npmrc"), "utf8")).toThrow();
  });

  it(
    "passes over this repository's own committed configuration (C3)",
    () => {
      const { code, output } = runCheck(REPO_ROOT, repoContext(false));
      expect(code).toBe(0);
      expect(output).toContain("npm-config-allow: OK");
      // The publish configuration of every one of the eight published packages was examined, not
      // merely the repository root's. A census that read nothing would also print OK.
      expect(output.match(/publishConfig:access/g)?.length).toBe(8);
      expect(output).toContain("pnpm-field:overrides");
      expect(output).toContain("changesets:access");
    },
    SLOW,
  );

  it(
    "passes in the context the GATED PUBLISH JOB will actually give it (C3, C10)",
    () => {
      // The one that matters: the generated user config, its token, and the provenance flag the
      // publish step supplies. If the committed allow-set does not cover this, the first real
      // release refuses, and finding that out here costs nothing.
      const { code, output } = runCheck(REPO_ROOT, repoContext(true));
      expect(code).toBe(0);
      expect(output).toContain("provenance = true");
      expect(output).not.toContain(FAKE_TOKEN);
    },
    SLOW,
  );

  it(
    "leaves this repository's own configuration sources byte-identical (C4)",
    () => {
      const sources = [
        join(REPO_ROOT, "package.json"),
        join(REPO_ROOT, "pnpm-workspace.yaml"),
        join(REPO_ROOT, ".changeset", "config.json"),
        join(REPO_ROOT, "npm-config-allow.json"),
      ];
      const before = sources.map((path) =>
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      );

      runCheck(REPO_ROOT, repoContext(true));

      expect(
        sources.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex")),
      ).toEqual(before);
    },
    SLOW,
  );

  it("is wired into the root manifest so a maintainer can run it locally (C12)", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(manifest.scripts["release:config-allow"]).toBe("node scripts/npm-config-allow.mjs");
  });

  it("documents the check, every refusal state and how to extend the allow-set (C21)", () => {
    const releasing = readFileSync(join(REPO_ROOT, "RELEASING.md"), "utf8");
    for (const required of [
      "npm-config-allow.json",
      "scripts/npm-config-allow.mjs",
      "pnpm run release:config-allow",
      "Adding an entry to the allow-set",
    ]) {
      expect(releasing).toContain(required);
    }
    // Each refusal state carries its terminal action, which is the half a runbook usually omits.
    for (const state of [
      "a value no entry permits",
      "a required key does not hold",
      "the allow-set is absent, empty or unparseable",
      "a configuration source is unreadable or malformed",
      "a resolver could not be run",
    ]) {
      expect(releasing).toContain(state);
    }
  });
});
