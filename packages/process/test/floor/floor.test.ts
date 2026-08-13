import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, ensureBuilt, makeTempDir, PKG_ROOT } from "../helpers.js";

/**
 * Term 9, the compatibility floor: @cosyte/process must install and run under node 22.0.x and
 * pnpm 10.0.0, which is what the consumer repos declare, even though config itself is on node
 * >=22.14 and pnpm@10.34.5.
 *
 * The fixture lives in a temp directory OUTSIDE the config workspace and pins its own
 * `packageManager: pnpm@10.0.0`, so config's root pnpm@10.34.5 invariant is never touched. The
 * toolchain is provisioned into that same temp tree from the npm registry; nothing global moves.
 *
 * This is the one test here that needs a network, which is why it has its own config and its own
 * script (`pnpm test:floor`) instead of running on every `pnpm test`.
 */

const NODE_FLOOR = "22.0.0";
const PNPM_FLOOR = "10.0.0";

interface Toolchain {
  /** The node 22.0.x executable. */
  readonly node: string;
  /** The pnpm 10.0.0 entry script, to be run with `node`. */
  readonly pnpm: string;
  /** The directory holding the floor `node`, and no other one. */
  readonly binDir: string;
}

/**
 * A PATH on which the ONLY reachable `node` is the floor one.
 *
 * `/usr/bin` and `/bin` stay because a pnpm bin shim is a shell script that calls `dirname`, `sed`
 * and `uname` before it ever reaches node. What is deliberately absent is the directory holding the
 * newer node this suite itself runs on, so a `#!/usr/bin/env node` shim cannot quietly find it and
 * report a pass for a version the floor never exercised.
 */
function floorPath(binDir: string): string {
  return `${binDir}:/usr/bin:/bin`;
}

let toolchain: Toolchain | undefined;
let fixture: string | undefined;
let provisioningError: string | undefined;

/**
 * The environment minus everything the OUTER pnpm run put there.
 *
 * `pnpm test:floor` exports a wall of `npm_config_*` and `npm_package_*` variables describing the
 * config workspace, and a pnpm started underneath them reads them as its own configuration: it
 * would provision into the wrong place, honour the wrong settings, and quietly ignore flags passed
 * on the command line. The floor fixture has to be installed by a pnpm that knows nothing about
 * this repo, so the slate is wiped.
 */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const lower = key.toLowerCase();
    if (lower.startsWith("npm_") || lower.startsWith("pnpm_") || lower.startsWith("vitest")) {
      continue;
    }
    env[key] = value;
  }
  return { ...env, ...extra };
}

/** Run a command, returning the pieces the assertions and the diagnostics need. */
function exec(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = cleanEnv(),
): { code: number; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env, timeout: 600_000 });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

beforeAll(() => {
  ensureBuilt();
  const root = makeTempDir("cosyte-process-floor-");

  // 1. The floor toolchain, installed as ordinary packages into the temp tree.
  const toolchainDir = join(root, "toolchain");
  mkdirSync(toolchainDir);
  writeFileSync(
    join(toolchainDir, "package.json"),
    `${JSON.stringify(
      {
        name: "floor-toolchain",
        version: "0.0.0",
        private: true,
        // pnpm 10 reads the build allow-list from here.
        pnpm: { onlyBuiltDependencies: ["node"] },
      },
      null,
      2,
    )}\n`,
  );
  // The `node` package fetches its arch-specific binary from a PREINSTALL script, and pnpm 10 and
  // later refuse to run a dependency's build scripts unless asked. Unasked, the install reports
  // success and leaves no binary behind, so the allow-list is spelled in every place a pnpm in the
  // 10.x-to-11.x range looks for it. Writing pnpm-workspace.yaml here also makes this directory a
  // workspace root, which stops any upward search for one.
  writeFileSync(
    join(toolchainDir, "pnpm-workspace.yaml"),
    "packages: []\nallowBuilds:\n  node: true\nonlyBuiltDependencies:\n  - node\n",
  );
  const added = exec("pnpm", ["add", `node@${NODE_FLOOR}`, `pnpm@${PNPM_FLOOR}`], toolchainDir);
  if (added.code !== 0) {
    provisioningError = `could not provision node ${NODE_FLOOR} and pnpm ${PNPM_FLOOR}:\n${added.output}`;
    return;
  }
  const node = join(toolchainDir, "node_modules", "node", "bin", "node");
  const pnpm = join(toolchainDir, "node_modules", "pnpm", "bin", "pnpm.cjs");
  let rebuilt = "";
  if (!existsSync(node)) {
    // A pnpm that spells the allow-list differently again still has to honour an explicit rebuild.
    rebuilt = exec("pnpm", ["rebuild", "node"], toolchainDir).output;
  }
  if (!existsSync(node) || !existsSync(pnpm)) {
    provisioningError = `the provisioned toolchain is not where it was expected: ${readdirSync(
      join(toolchainDir, "node_modules"),
    ).join(", ")}\n--- add ---\n${added.output}\n--- rebuild ---\n${rebuilt}`;
    return;
  }
  toolchain = { node, pnpm, binDir: dirname(node) };

  // 2. A tarball of this package, exactly what the registry would serve.
  const packed = exec("pnpm", ["pack", "--pack-destination", root], PKG_ROOT);
  if (packed.code !== 0) {
    provisioningError = `could not pack @cosyte/process:\n${packed.output}`;
    return;
  }
  const tarball = readdirSync(root).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) {
    provisioningError = `pnpm pack wrote no tarball into ${root}`;
    return;
  }

  // 3. The out-of-tree consumer, pinning the floor package manager itself.
  const consumer = join(root, "fixture");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "floor-fixture",
        version: "0.0.0",
        private: true,
        type: "module",
        engines: { node: ">=22.0.0" },
        packageManager: `pnpm@${PNPM_FLOOR}`,
        scripts: {
          build: "cosyte-process build",
          test: "cosyte-process test",
          lint: "cosyte-process lint",
          typecheck: "cosyte-process typecheck",
          format: "cosyte-process format",
        },
        dependencies: { "@cosyte/process": `file:${join(root, tarball)}` },
      },
      null,
      2,
    )}\n`,
  );

  // 4. Install it with the floor pnpm, running on the floor node.
  const installed = exec(
    toolchain.node,
    [toolchain.pnpm, "install", "--ignore-workspace"],
    consumer,
    cleanEnv({ PATH: floorPath(toolchain.binDir) }),
  );
  if (installed.code !== 0) {
    provisioningError = `pnpm ${PNPM_FLOOR} could not install the package:\n${installed.output}`;
    return;
  }
  fixture = consumer;
});

afterAll(cleanupTempDirs);

describe(`the compatibility floor: node ${NODE_FLOOR} and pnpm ${PNPM_FLOOR}`, () => {
  it("provisioned the floor toolchain and installed the package", () => {
    expect(provisioningError ?? "").toBe("");
    expect(fixture).toBeDefined();
  });

  it("really is node 22.0.x and pnpm 10.0.0", () => {
    expect(toolchain).toBeDefined();
    const tools = toolchain as Toolchain;
    const consumer = fixture as string;
    expect(exec(tools.node, ["-v"], consumer).output.trim()).toBe(`v${NODE_FLOOR}`);
    // Asked from the fixture, whose own `packageManager` field pins the floor: pnpm manages its own
    // version from that field, so asking anywhere else answers for that other directory's repo.
    expect(exec(tools.node, [tools.pnpm, "-v"], consumer).output.trim()).toBe(PNPM_FLOOR);
  });

  it("leaves no other node on the PATH the shim will use", () => {
    const tools = toolchain as Toolchain;
    const consumer = fixture as string;
    const found = exec("node", ["-v"], consumer, cleanEnv({ PATH: floorPath(tools.binDir) }));
    expect(found.output.trim()).toBe(`v${NODE_FLOOR}`);
  });

  it("installs the bin where a consumer's scripts find it", () => {
    const consumer = fixture as string;
    expect(existsSync(join(consumer, "node_modules", ".bin", "cosyte-process"))).toBe(true);
  });

  it("runs `cosyte-process check` successfully under the floor node", () => {
    const consumer = fixture as string;
    const tools = toolchain as Toolchain;
    const result = exec(
      join(consumer, "node_modules", ".bin", "cosyte-process"),
      ["check"],
      consumer,
      cleanEnv({ PATH: floorPath(tools.binDir) }),
    );
    expect(result.code, result.output).toBe(0);
  });

  it("reports a drifted script under the floor node too", () => {
    const consumer = fixture as string;
    const tools = toolchain as Toolchain;
    const manifestPath = join(consumer, "package.json");
    const original = readFileSync(manifestPath, "utf8");
    writeFileSync(manifestPath, original.replace('"cosyte-process build"', '"tsup"'));
    try {
      const result = exec(
        join(consumer, "node_modules", ".bin", "cosyte-process"),
        ["check"],
        consumer,
        cleanEnv({ PATH: floorPath(tools.binDir) }),
      );
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('script "build"');
    } finally {
      writeFileSync(manifestPath, original);
    }
  });
});
