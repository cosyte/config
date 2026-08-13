import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveToolBin } from "../src/resolve.js";

/** The package root, which is also where `pnpm test` runs from. */
export const PKG_ROOT = join(import.meta.dirname, "..");

/** The built bin every end-to-end test invokes. */
export const CLI = join(PKG_ROOT, "dist", "cli.mjs");

/** Where the fixture-consumer trees live. They are data: nothing lints or typechecks them. */
export const FIXTURES = join(import.meta.dirname, "fixtures");

const tempDirs: string[] = [];

/** Newest mtime under a directory tree, for the staleness check below. */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * Build `dist/` if it is missing or older than `src/`.
 *
 * The end-to-end tests run the real bin, and CI runs `pnpm test` before `pnpm build`, so the suite
 * cannot assume a build has happened. Building through the resolved `tsup` bin also exercises term
 * 5's resolution on every run.
 */
export function ensureBuilt(): void {
  if (existsSync(CLI) && statSync(CLI).mtimeMs >= newestMtime(join(PKG_ROOT, "src"))) {
    return;
  }
  const result = spawnSync(process.execPath, [resolveToolBin("tsup")], {
    cwd: PKG_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`could not build @cosyte/process for the e2e tests:\n${result.stderr}`);
  }
}

/** A temp directory removed when the process exits. Always outside the config workspace. */
export function makeTempDir(prefix = "cosyte-process-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Remove every temp directory this module handed out. */
export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Copy a fixture consumer into a fresh temp directory.
 *
 * The copy gets a `node_modules` symlink to this package's own, which is what an installed consumer
 * has: the tools the fixture's own configs import (vitest in a test file, say) resolve the way they
 * would in a real repo. The delegated verbs themselves never consult it (term 5).
 */
export function useFixture(name: string): string {
  const dir = join(makeTempDir(`cosyte-process-${name}-`), name);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  symlinkSync(join(PKG_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/**
 * The line the decoy vitest prints if anything ever executes it.
 *
 * A consumer's own vitest is a REAL vitest, so a fixture that installed one could only be told apart
 * from this package's own by a version banner. A decoy that fails loudly is the stronger discriminator:
 * if `cosyte-process test` ever reached for the consumer's copy, this string appears and the run dies.
 */
export const DECOY_VITEST_MARKER = "COSYTE-PROCESS-DECOY-CONSUMER-VITEST-RAN";

/** Exit code the decoy vitest bin uses. Not 1, so it cannot be confused with a failing test run. */
export const DECOY_VITEST_EXIT = 97;

/** A fixture consumer that declares (and physically carries) its own vitest. */
export interface OwnVitestFixture {
  /** The consumer's working directory. */
  readonly dir: string;
  /** The version of the vitest this package resolves for itself (term 5's copy). */
  readonly providerVersion: string;
  /** The version the consumer declares and carries: same major, different patch. */
  readonly consumerVersion: string;
  /** The consumer's `node_modules/.bin/vitest`, the entry a PATH lookup would find first. */
  readonly consumerBin: string;
}

/** The decoy bin: whatever runs it says so and fails. Written as the consumer's vitest. @internal */
function decoySource(): string {
  return [
    "#!/usr/bin/env node",
    "// The consumer's own vitest, replaced by a sentinel: see test/helpers.ts.",
    `process.stdout.write("${DECOY_VITEST_MARKER}\\n");`,
    `process.stderr.write("${DECOY_VITEST_MARKER}\\n");`,
    `process.exit(${String(DECOY_VITEST_EXIT)});`,
    "",
  ].join("\n");
}

/**
 * Copy the `own-vitest` fixture and give it a vitest of its very own (term 5, Amendment 1).
 *
 * The consumer's copy sits where a pnpm install would put a declared devDependency -
 * `node_modules/vitest` plus a `node_modules/.bin/vitest` shim - and its version is derived from this
 * package's own vitest so the "same major, different patch" relationship cannot rot. Nothing else is
 * linked in: the tree carries no `@vitest/coverage-v8`, exactly as term 5 requires of a consumer.
 *
 * @returns The fixture directory and the two versions, for the test to assert on.
 */
export function useFixtureWithOwnVitest(): OwnVitestFixture {
  const dir = join(makeTempDir("cosyte-process-own-vitest-"), "own-vitest");
  cpSync(join(FIXTURES, "own-vitest"), dir, { recursive: true });

  const providerVersion = (
    JSON.parse(readFileSync(join(PKG_ROOT, "node_modules", "vitest", "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const [major, minor, patch] = providerVersion.split(".");
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`cannot read a major.minor.patch out of vitest@${providerVersion}`);
  }
  // Same major line (term 5's condition), one patch along: what a consumer that installed vitest a
  // day later would have.
  const consumerVersion = `${major}.${minor}.${String(Number.parseInt(patch, 10) + 1)}`;

  const modules = join(dir, "node_modules");
  const pkgDir = join(modules, "vitest");
  const binDir = join(modules, ".bin");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    `${JSON.stringify(
      {
        name: "vitest",
        version: consumerVersion,
        type: "module",
        bin: { vitest: "./vitest.mjs" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(pkgDir, "vitest.mjs"), decoySource(), { mode: 0o755 });
  const consumerBin = join(binDir, "vitest");
  writeFileSync(consumerBin, decoySource(), { mode: 0o755 });

  // The manifest declares exactly what is installed, so the fixture is a consumer that really did
  // `pnpm add -D vitest@<same major>`.
  const manifestPath = join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    devDependencies: Record<string, string>;
  };
  manifest.devDependencies["vitest"] = consumerVersion;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { dir, providerVersion, consumerVersion, consumerBin };
}

/** The result of running the bin. */
export interface CliResult {
  /** Exit code, or 1 when the process was killed by a signal. */
  readonly code: number;
  /** Everything the run wrote to stdout. */
  readonly stdout: string;
  /** Everything the run wrote to stderr. */
  readonly stderr: string;
}

/**
 * Run the built bin in a working directory, exactly as a package.json script would.
 *
 * Vitest's own environment variables are stripped: a delegated `test` verb starts a real vitest, and
 * inheriting the outer runner's pool variables makes a nested run behave unpredictably.
 *
 * @param args - Arguments after the bin name.
 * @param cwd - The consumer directory to run in.
 * @param extraEnv - Environment entries layered over the inherited ones, for the one test that has to
 *   put a consumer's `node_modules/.bin` on PATH the way `pnpm run` does.
 */
export function runCli(
  args: readonly string[],
  cwd: string,
  extraEnv: Readonly<Record<string, string>> = {},
): CliResult {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("VITEST") && key !== "TEST") {
      env[key] = value;
    }
  }
  Object.assign(env, extraEnv);
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env,
    timeout: 180_000,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
