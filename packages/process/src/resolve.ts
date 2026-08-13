import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

import { TOOL_PACKAGES, type ToolName } from "./verbs.js";

/**
 * Term 5: resolving a baseline tool from THIS package's own dependencies.
 *
 * The tools are dependencies of @cosyte/process, so a shared tool upgrade reaches every consumer
 * through a version bump of this package alone. Nothing here consults PATH or the consumer's
 * node_modules: a consumer that has to install eslint for `cosyte-process lint` to work would make
 * the delegated verbs depend on consumer-side state, which is exactly what term 5 removes.
 */

/**
 * A baseline tool that could not be resolved from this package's dependencies.
 *
 * Under term 5 this is a provider defect (a broken install of @cosyte/process), never a missing
 * consumer install step, and the message says so.
 *
 * @example
 * new ToolResolutionError("tsc", "/pkg", "no reason").message;
 */
export class ToolResolutionError extends Error {
  /** The bin name that could not be resolved. */
  readonly tool: ToolName;

  /**
   * @param tool - The bin name that could not be resolved.
   * @param from - The directory the upward search started from.
   * @param reason - What went wrong.
   */
  constructor(tool: ToolName, from: string, reason: string) {
    super(
      `cannot resolve the "${tool}" tool (npm package "${TOOL_PACKAGES[tool]}") from ` +
        `@cosyte/process's own dependencies, searching up from ${from}: ${reason}. ` +
        `This is a defect in the @cosyte/process install, not a missing dependency in this repo.`,
    );
    this.name = "ToolResolutionError";
    this.tool = tool;
  }
}

/** The `bin` field of a package manifest, in either of the two shapes npm allows. @internal */
type BinField = string | Record<string, string> | undefined;

/**
 * Find the directory of `pkg` by walking `node_modules` upward from `from`.
 *
 * This is node's own resolution walk rather than `require.resolve`, because a package's `exports`
 * map may refuse `<pkg>/package.json` and the manifest is exactly what has to be read to learn where
 * the bin lives.
 *
 * @internal
 */
function findPackageDir(pkg: string, from: string): string | undefined {
  let dir = resolvePath(from);
  for (;;) {
    const candidate = join(dir, "node_modules", pkg);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolve the executable JavaScript file for a baseline tool (term 5).
 *
 * @param tool - The bin name a baseline invocation calls.
 * @param from - Directory to start the upward `node_modules` walk from; defaults to this module's
 *   own directory, which is what puts the resolution inside @cosyte/process's dependencies.
 * @returns Absolute path to the tool's bin script, to be run with the current Node executable.
 * @throws ToolResolutionError When the package, its bin entry, or the bin file is missing.
 * @example
 * resolveToolBin("prettier"); // => "/…/node_modules/prettier/bin/prettier.cjs"
 */
export function resolveToolBin(tool: ToolName, from: string = import.meta.dirname): string {
  const pkg = TOOL_PACKAGES[tool];
  const pkgDir = findPackageDir(pkg, from);
  if (pkgDir === undefined) {
    throw new ToolResolutionError(tool, from, `no node_modules/${pkg} directory on the way up`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as unknown;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ToolResolutionError(tool, from, `its package.json could not be read (${reason})`);
  }

  const bin: BinField =
    typeof manifest === "object" && manifest !== null
      ? ((manifest as { bin?: BinField }).bin ?? undefined)
      : undefined;

  let relative: string | undefined;
  if (typeof bin === "string") {
    relative = pkg === tool ? bin : undefined;
  } else if (bin !== undefined) {
    relative = bin[tool];
  }
  if (relative === undefined) {
    throw new ToolResolutionError(tool, from, `${pkg}'s package.json declares no "${tool}" bin`);
  }

  const binPath = join(pkgDir, relative);
  if (!existsSync(binPath)) {
    throw new ToolResolutionError(tool, from, `its bin file is missing at ${binPath}`);
  }
  return binPath;
}
