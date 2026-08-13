import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  readdirSync,
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
 */
export function runCli(args: readonly string[], cwd: string): CliResult {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("VITEST") && key !== "TEST") {
      env[key] = value;
    }
  }
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
