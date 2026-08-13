import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

import { checkWiring } from "./check.js";
import {
  isModifierFor,
  MODIFIERS_BY_VERB,
  SUPPORTED_MODIFIER_PAIRS,
  applyModifier,
} from "./modifiers.js";
import { applyOverride, loadOverrides, OverrideError } from "./overrides.js";
import { ToolResolutionError, resolveToolBin } from "./resolve.js";
import {
  BASELINE,
  DELEGATED_VERBS,
  type Invocation,
  isDelegatedVerb,
  isVerb,
  toArgv,
} from "./verbs.js";

/**
 * The `cosyte-process` command itself: argv to exit code.
 *
 * Everything here is exit codes and streams, so the bin (`src/cli.ts`) is three lines and the
 * behaviour is testable in-process.
 */

/** How a resolved tool is executed. Injected in tests so an invocation can be asserted, not run. */
export type SpawnTool = (bin: string, args: readonly string[], cwd: string) => Promise<number>;

/** Options for {@link run}. Every field has a real default; tests are the reason they are options. */
export interface RunOptions {
  /** The consumer's working directory. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Where diagnostics go. Defaults to `process.stderr`. */
  readonly stderr?: NodeJS.WritableStream;
  /**
   * Where the upward search for the baseline tools starts (term 5).
   *
   * @internal
   */
  readonly toolBase?: string;
  /**
   * How to execute a resolved tool.
   *
   * @internal
   */
  readonly spawnTool?: SpawnTool;
}

/** Exit code for every failure `cosyte-process` itself detects, as opposed to a tool's own. @internal */
const SELF_ERROR = 1;

/**
 * This package's own manifest. `src/` and the built `dist/` are both one level below it, so the same
 * relative path answers whether the code is running from source (tests) or from the tarball.
 *
 * @internal
 */
const OWN_MANIFEST = join(import.meta.dirname, "..", "package.json");

/** The only field of our own manifest this module reads. @internal */
interface OwnManifest {
  version: string;
}

/**
 * This package's own version, read from its manifest at run time (term 10).
 *
 * Read rather than inlined, because the line exists to say which `@cosyte/process` a consumer is
 * actually running: a literal would survive the next version bump and lie about it.
 *
 * @returns The `version` field of `@cosyte/process`'s package.json.
 * @internal
 */
function ownVersion(): string {
  return (JSON.parse(readFileSync(OWN_MANIFEST, "utf8")) as OwnManifest).version;
}

/**
 * The supported verbs and modifiers, as `cosyte-process` prints them on a usage error.
 *
 * @returns The usage text, newline terminated.
 * @example
 * usageText().startsWith("usage: cosyte-process"); // => true
 */
export function usageText(): string {
  const lines = [
    "usage: cosyte-process <verb> [modifier]",
    "",
    "Verbs:",
    ...DELEGATED_VERBS.map((verb) => `  ${verb.padEnd(10)} ${toArgv(BASELINE[verb]).join(" ")}`),
    "  check      verify this repo's process wiring (scripts and override file)",
    "",
    "Modifiers (at most one per invocation):",
    ...SUPPORTED_MODIFIER_PAIRS.map((pair) => `  cosyte-process ${pair}`),
    "",
    `Overrides: cosyte-process.config.json at the repo root, keyed by verb (${DELEGATED_VERBS.join(", ")}),`,
    "each an object with optional string arrays `globs` and `flags`. See the @cosyte/process README.",
  ];
  return `${lines.join("\n")}\n`;
}

/** Write a `cosyte-process: ...` diagnostic followed by the usage text. @internal */
function fail(stderr: NodeJS.WritableStream, message: string, withUsage = false): number {
  stderr.write(`cosyte-process: ${message}\n`);
  if (withUsage) {
    stderr.write(usageText());
  }
  return SELF_ERROR;
}

/** Run a tool as a child of the current Node executable, inheriting all three streams. @internal */
function defaultSpawnTool(bin: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (code !== null) {
        resolvePromise(code);
        return;
      }
      // Killed by a signal: report it the way a shell would, so a Ctrl-C stays distinguishable
      // from a clean exit and from an ordinary failure.
      const number: number | undefined = signal === null ? undefined : constants.signals[signal];
      resolvePromise(number === undefined ? SELF_ERROR : 128 + number);
    });
  });
}

/**
 * Run one `cosyte-process` invocation.
 *
 * The order of checks is the order of the contract's unhappy paths: argv first (an unknown verb is
 * an unknown verb wherever it is typed), then the working directory, then the override file, then
 * the tool. Only after all four does anything execute.
 *
 * @param argv - Arguments after the bin name, i.e. `process.argv.slice(2)`.
 * @param options - Working directory, streams, and the two injection points tests use.
 * @returns The process exit code: a tool's own code verbatim, or 1 for a failure detected here.
 * @example
 * await run(["check"], { cwd: "/repo" }); // => 0 when the wiring conforms
 */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const stderr = options.stderr ?? process.stderr;
  const spawnTool = options.spawnTool ?? defaultSpawnTool;

  const [verb, ...rest] = argv;

  if (verb === undefined) {
    return fail(stderr, "no verb given", true);
  }
  if (!isVerb(verb)) {
    return fail(stderr, `unknown verb "${verb}"`, true);
  }
  if (rest.length > 1) {
    return fail(stderr, `at most one modifier may be given, got ${rest.join(" ")}`, true);
  }

  const modifier = rest[0];
  if (modifier !== undefined) {
    if (!isDelegatedVerb(verb)) {
      return fail(stderr, `"check" takes no modifier, got "${modifier}"`, true);
    }
    if (!isModifierFor(verb, modifier)) {
      const accepted = MODIFIERS_BY_VERB[verb];
      const detail =
        accepted.length === 0
          ? `"${verb}" takes no modifier`
          : `"${verb}" accepts ${accepted.join(", ")}`;
      return fail(stderr, `unknown modifier "${modifier}": ${detail}`, true);
    }
  }

  const manifestPath = join(cwd, "package.json");
  if (!existsSync(manifestPath)) {
    return fail(stderr, `no package.json in ${cwd} (expected ${manifestPath})`);
  }

  if (verb === "check") {
    let violations: string[];
    try {
      violations = checkWiring(cwd);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail(stderr, `cannot check ${manifestPath}: ${reason}`);
    }
    if (violations.length > 0) {
      for (const violation of violations) {
        stderr.write(`cosyte-process: ${violation}\n`);
      }
      stderr.write(
        `cosyte-process: check failed with ${String(violations.length)} violation(s) in ${cwd}\n`,
      );
      return SELF_ERROR;
    }
    return 0;
  }

  let invocation: Invocation;
  try {
    invocation = applyOverride(BASELINE[verb], loadOverrides(cwd)[verb]);
  } catch (error: unknown) {
    if (error instanceof OverrideError) {
      return fail(stderr, error.message);
    }
    throw error;
  }
  if (modifier !== undefined && isModifierFor(verb, modifier)) {
    invocation = applyModifier(modifier, invocation);
  }

  let bin: string;
  try {
    bin =
      options.toolBase === undefined
        ? resolveToolBin(invocation.tool)
        : resolveToolBin(invocation.tool, options.toolBase);
  } catch (error: unknown) {
    if (error instanceof ToolResolutionError) {
      return fail(stderr, error.message);
    }
    throw error;
  }

  const [, ...args] = toArgv(invocation);
  // Term 10: one line naming this package's version, written before the tool is spawned so it
  // precedes the tool's own output. The five delegated verbs only; `check` prints nothing.
  stderr.write(`cosyte-process ${ownVersion()}\n`);
  return spawnTool(bin, args, cwd);
}
