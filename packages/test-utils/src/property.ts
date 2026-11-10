/**
 * How every property runner in this kit runs: how many cases, from which seed, and what a failure
 * prints so it replays exactly.
 *
 * - **Depth.** {@link DEFAULT_NUM_RUNS} cases per property by default, fast enough for every pull
 *   request. One environment variable, `COSYTE_PROPERTY_RUNS`, sets the depth of every property
 *   in the run: a nightly job sets it to 10,000 or more.
 * - **Replay.** A failure prints its seed and its path. Setting `COSYTE_PROPERTY_SEED` and
 *   `COSYTE_PROPERTY_PATH` to them (or passing `seed` and `path`) runs that one failing case
 *   again, already shrunk, so a nightly failure becomes a local one.
 *
 * The environment wins over a runner's own options, so a deep run or a replay never needs a code
 * change. A value that is set but malformed throws rather than being ignored: a nightly job that
 * typed its depth wrong must not quietly run the pull-request depth.
 *
 * @packageDocumentation
 */

import type { IProperty, Parameters as FcParameters, RunDetails } from "fast-check";
import fc from "fast-check";

/** Cases per property when neither the runner's options nor the environment set a depth. */
export const DEFAULT_NUM_RUNS = 100;

/** The environment variables a property run reads. */
export const PROPERTY_ENV = Object.freeze({
  /** The number of cases for every property in the run, for example `10000` nightly. */
  runs: "COSYTE_PROPERTY_RUNS",
  /** The seed to run from, as a failure printed it. */
  seed: "COSYTE_PROPERTY_SEED",
  /** The path of the failing case, as a failure printed it; needs the seed. */
  path: "COSYTE_PROPERTY_PATH",
} as const);

/** The run options every property runner takes. */
export interface PropertyRunOptions {
  /** Number of generated cases. Defaults to {@link DEFAULT_NUM_RUNS}; `COSYTE_PROPERTY_RUNS` wins. */
  readonly numRuns?: number;
  /** The seed to run from; `COSYTE_PROPERTY_SEED` wins. */
  readonly seed?: number;
  /** The path of one case to replay, with its seed; `COSYTE_PROPERTY_PATH` wins. */
  readonly path?: string;
}

/** What a property run resolves to: the depth, and the seed and path when replaying. */
export interface ResolvedPropertyRun {
  readonly numRuns: number;
  readonly seed?: number;
  readonly path?: string;
}

/**
 * Read one variable, refusing a value that is set but malformed.
 *
 * @param env The environment.
 * @param name The variable.
 * @param shape What a good value looks like.
 * @param meaning What it must be, for the message.
 * @returns The value, or `undefined` when it is unset or empty.
 */
function readEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  shape: RegExp,
  meaning: string,
): string | undefined {
  const value = env[name];
  if (value === undefined || value === "") return undefined;
  if (!shape.test(value)) {
    throw new RangeError(`${name} must be ${meaning}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Work out a property run's depth, seed and path from a runner's options and the environment.
 * The environment wins.
 *
 * @param options The runner's own options.
 * @param env The environment; defaults to `process.env`.
 * @returns The resolved run.
 * @throws {RangeError} When a value is malformed, or a path is given without a seed.
 * @example
 * ```ts
 * import { resolvePropertyRun } from "@cosyte/test-utils";
 *
 * resolvePropertyRun({}, {}).numRuns; // 100
 * resolvePropertyRun({ numRuns: 50 }, { COSYTE_PROPERTY_RUNS: "10000" }).numRuns; // 10000
 * ```
 */
export function resolvePropertyRun(
  options: PropertyRunOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedPropertyRun {
  const runs = readEnv(env, PROPERTY_ENV.runs, /^[1-9]\d*$/, "a whole number of cases, 1 or more");
  const seed = readEnv(
    env,
    PROPERTY_ENV.seed,
    /^-?\d+$/,
    "a whole number, the seed a failure printed",
  );
  const path = readEnv(
    env,
    PROPERTY_ENV.path,
    /^\d+(?::\d+)*$/,
    "a path like 0:3:1, as a failure printed it",
  );
  const numRuns = runs === undefined ? (options.numRuns ?? DEFAULT_NUM_RUNS) : Number(runs);
  const resolvedSeed = seed === undefined ? options.seed : Number(seed);
  const resolvedPath = path ?? options.path;
  if (!Number.isInteger(numRuns) || numRuns < 1) {
    throw new RangeError(`numRuns must be a whole number of cases, 1 or more, got ${numRuns}`);
  }
  if (resolvedPath !== undefined && resolvedSeed === undefined) {
    throw new RangeError(`a replay path needs its seed: set ${PROPERTY_ENV.seed} too`);
  }
  return {
    numRuns,
    ...(resolvedSeed === undefined ? {} : { seed: resolvedSeed }),
    ...(resolvedPath === undefined ? {} : { path: resolvedPath }),
  };
}

/**
 * The message a failed run throws: what failed, how to replay it exactly, then fast-check's own
 * report (the counterexample, the shrinks, and the failing check's message).
 *
 * @param name The property's name.
 * @param details fast-check's run details.
 * @returns The message.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { propertyFailureMessage } from "@cosyte/test-utils";
 *
 * const details = fc.check(fc.property(fc.nat(), (n) => n < 0), { seed: 1 });
 * propertyFailureMessage("negative", details); // "negative: property failed after 1 case(s), ..."
 * ```
 */
export function propertyFailureMessage<Ts>(name: string, details: RunDetails<Ts>): string {
  const replay = `${PROPERTY_ENV.seed}=${details.seed} ${PROPERTY_ENV.path}=${details.counterexamplePath}`;
  return [
    `${name}: property failed after ${details.numRuns} case(s), shrunk ${details.numShrinks} time(s).`,
    `Replay exactly: ${replay}`,
    `(or pass { seed: ${details.seed}, path: ${JSON.stringify(details.counterexamplePath)} } to the runner)`,
    "",
    fc.defaultReportMessage(details) as string,
  ].join("\n");
}

/**
 * Run a fast-check property at the resolved depth and seed, and throw a replayable error when it
 * fails. Every runner in this kit goes through here; a parser's own properties can too.
 *
 * @param name The property's name, which leads the failure message.
 * @param property The fast-check property.
 * @param options Depth, seed and path; the environment wins over them.
 * @param env The environment; defaults to `process.env`.
 * @returns Nothing; it throws on the first counterexample.
 * @throws {Error} When the property fails, with the seed and path in the message and fast-check's
 *   error as `cause`.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { assertProperty } from "@cosyte/test-utils";
 *
 * assertProperty("addition commutes", fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a), {});
 * ```
 */
export function assertProperty<Ts>(
  name: string,
  property: IProperty<Ts>,
  options: PropertyRunOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const run = resolvePropertyRun(options, env);
  // A replay stops at the case its path names: that case is already shrunk.
  const parameters: FcParameters<Ts> = {
    ...run,
    endOnFailure: run.path !== undefined,
    includeErrorInReport: true,
  };
  const details = fc.check(property, parameters);
  if (!details.failed) return;
  throw new Error(propertyFailureMessage(name, details), { cause: details.errorInstance });
}
