/**
 * How a package describes its benchmarks.
 *
 * A suite is a module whose default export is {@link defineSuite}'s result. It is handed the module
 * under test (`bind`) rather than importing it, so one suite file measures the base build and the
 * head build of a comparison. Every corpus is built in code (`build`): the runner never takes a data
 * file, which is how its inputs stay synthetic by construction.
 *
 * @packageDocumentation
 */

/** One corpus: the inputs one pass runs over, built outside every timed region. */
export interface BenchCorpus<TInput> {
  /** The inputs. One pass calls the measured function once on each. */
  readonly inputs: readonly TInput[];
  /** Bytes one pass handles, when it means something. Turns operations a second into bytes a second. */
  readonly bytes?: number;
  /** Called once the process has finished with this corpus, for example to remove a temporary directory. */
  readonly teardown?: () => void;
}

/** One input size of a benchmark: small, large, or anything between. */
export interface BenchSize<TInput> {
  /** How a reader names this size, for example `"1 KiB"`. Unique within its benchmark. */
  readonly label: string;
  /** Build the corpus. Called once per process, before anything is timed. */
  readonly build: () => BenchCorpus<TInput>;
  /**
   * Whether the base against head comparison runs this size. Defaults to `true`. Set `false` for a
   * size whose processes are too slow for a pull request's time budget; a reading still measures it.
   */
  readonly compare?: boolean;
}

/** One benchmark: a function measured at one or more input sizes. */
export interface Benchmark<TTarget, TInput, TResult> {
  /** Unique within the suite. */
  readonly name: string;
  /** The sizes, smallest first. Each size is measured on its own. */
  readonly sizes: readonly BenchSize<TInput>[];
  /** Take the imported module under test and return the function to measure. */
  readonly bind: (target: TTarget) => (input: TInput) => TResult;
  /**
   * Reduce a result to a number summed into a sink the runner checks, so the compiler cannot delete
   * the measured call. Defaults to 1 for each result that is not `null` or `undefined`; supply it
   * when the function returns nothing. The sum must grow over a measurement, so return a positive
   * number for at least some results; a run whose sink did not grow is refused.
   */
  readonly weigh?: (result: TResult) => number;
  /** The size label the long run (is the heap flat?) uses. Defaults to the first size. */
  readonly longRun?: string;
}

/** A benchmark with its input and result types erased, as a suite holds it. */
export type AnyBenchmark<TTarget> = Benchmark<TTarget, unknown, unknown>;

/** A suite: the benchmarks of one package. */
export interface BenchSuite<TTarget> {
  /** Shown in every report, for example `"@cosyte/script-utils phi-scan"`. */
  readonly name: string;
  /** At least one. */
  readonly benchmarks: readonly AnyBenchmark<TTarget>[];
}

/**
 * Type one benchmark. Only a type helper: it returns its argument, with the input and result types
 * erased so benchmarks of different shapes can sit in one suite.
 *
 * @example
 * ```ts
 * import { defineBenchmark } from "@cosyte/bench";
 *
 * const b = defineBenchmark({
 *   name: "split",
 *   sizes: [{ label: "1 KiB", build: () => ({ inputs: ["a|b".repeat(341)] }) }],
 *   bind: () => (s: string) => s.split("|"),
 * });
 * b.name; // => "split"
 * ```
 */
export function defineBenchmark<TTarget, TInput, TResult>(
  benchmark: Benchmark<TTarget, TInput, TResult>,
): AnyBenchmark<TTarget> {
  return benchmark as unknown as AnyBenchmark<TTarget>;
}

/**
 * Check a suite and freeze it. Throws a `TypeError` naming the problem: an empty name, no
 * benchmarks, a repeated name or label, a benchmark with no sizes, or a `longRun` naming no size.
 *
 * @example
 * ```ts
 * import { defineBenchmark, defineSuite } from "@cosyte/bench";
 *
 * export default defineSuite({
 *   name: "example",
 *   benchmarks: [
 *     defineBenchmark({
 *       name: "split",
 *       sizes: [{ label: "1 KiB", build: () => ({ inputs: ["a|b".repeat(341)] }) }],
 *       bind: () => (s: string) => s.split("|"),
 *     }),
 *   ],
 * });
 * ```
 */
export function defineSuite<TTarget>(suite: BenchSuite<TTarget>): BenchSuite<TTarget> {
  return checkSuite(suite);
}

function fail(message: string): never {
  throw new TypeError(`@cosyte/bench: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function checkName(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${what} must be a non-empty string`);
  return value;
}

/**
 * Check that a value is a suite, as a suite module's default export must be. The messages name
 * benchmarks and sizes, never an input.
 *
 * @internal
 */
export function checkSuite(value: unknown): BenchSuite<unknown> {
  if (!isRecord(value)) fail("a suite must be an object made by defineSuite");
  const name = checkName(value["name"], "the suite name");
  const benchmarks = value["benchmarks"];
  if (!Array.isArray(benchmarks) || benchmarks.length === 0) {
    fail(`suite "${name}" must have at least one benchmark`);
  }
  const seen = new Set<string>();
  for (const b of benchmarks as unknown[]) {
    if (!isRecord(b)) fail(`suite "${name}" holds a benchmark that is not an object`);
    const bName = checkName(b["name"], `a benchmark name in suite "${name}"`);
    if (seen.has(bName)) fail(`suite "${name}" has two benchmarks named "${bName}"`);
    seen.add(bName);
    if (typeof b["bind"] !== "function") fail(`benchmark "${bName}" has no bind function`);
    if (b["weigh"] !== undefined && typeof b["weigh"] !== "function") {
      fail(`benchmark "${bName}" has a weigh that is not a function`);
    }
    const sizes = b["sizes"];
    if (!Array.isArray(sizes) || sizes.length === 0) fail(`benchmark "${bName}" has no sizes`);
    const labels = new Set<string>();
    for (const s of sizes as unknown[]) {
      if (!isRecord(s)) fail(`benchmark "${bName}" holds a size that is not an object`);
      const label = checkName(s["label"], `a size label in benchmark "${bName}"`);
      if (labels.has(label)) fail(`benchmark "${bName}" has two sizes labelled "${label}"`);
      labels.add(label);
      if (typeof s["build"] !== "function")
        fail(`size "${label}" of "${bName}" has no build function`);
      if (s["compare"] !== undefined && typeof s["compare"] !== "boolean") {
        fail(`size "${label}" of "${bName}" has a compare that is not true or false`);
      }
    }
    if (b["longRun"] !== undefined && !labels.has(b["longRun"] as string)) {
      fail(`benchmark "${bName}" names a longRun size it does not have`);
    }
  }
  return Object.freeze(value) as unknown as BenchSuite<unknown>;
}

/** One case: a benchmark at one size. */
export interface CaseRef {
  readonly benchmark: string;
  readonly size: string;
}

/**
 * Every case in a suite, in suite order, optionally kept to the ones `only` names. A name in
 * `only` matches a whole benchmark (`"scan"`) or one case (`"scan @ 1 KiB"`). A name that matches
 * nothing throws, so a typo cannot quietly measure less than was asked. With `forComparison`, a
 * size marked `compare: false` is left out.
 *
 * @internal
 */
export function listCases(
  suite: BenchSuite<unknown>,
  only: readonly string[] = [],
  forComparison = false,
): CaseRef[] {
  const all: CaseRef[] = [];
  for (const b of suite.benchmarks) {
    for (const s of b.sizes) {
      if (!forComparison || s.compare !== false) all.push({ benchmark: b.name, size: s.label });
    }
  }
  if (only.length === 0) return all;
  for (const o of only) {
    if (!all.some((c) => c.benchmark === o || caseId(c) === o)) {
      fail(`--only "${o}" names no benchmark or case in suite "${suite.name}"`);
    }
  }
  return all.filter((c) => only.includes(c.benchmark) || only.includes(caseId(c)));
}

/**
 * How a case is named in reports and in `--only`: `benchmark @ size`.
 *
 * @internal
 */
export function caseId(c: CaseRef): string {
  return `${c.benchmark} @ ${c.size}`;
}

/**
 * Find a case's benchmark and size in a suite. Throws when either is missing.
 *
 * @internal
 */
export function findCase(
  suite: BenchSuite<unknown>,
  c: CaseRef,
): { benchmark: AnyBenchmark<unknown>; size: BenchSize<unknown> } {
  const benchmark = suite.benchmarks.find((b) => b.name === c.benchmark);
  const size = benchmark?.sizes.find((s) => s.label === c.size);
  // No benchmark means no size either, so one check covers both.
  if (size === undefined) fail(`suite "${suite.name}" has no case "${caseId(c)}"`);
  return { benchmark: benchmark as AnyBenchmark<unknown>, size };
}
