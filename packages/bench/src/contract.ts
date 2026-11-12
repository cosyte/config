/**
 * The benchmark constants, frozen.
 *
 * Every value here is fixed by the performance standard,
 * `documentation/decisions/0005-the-performance-standard.md` in the `config` repo, which says for
 * each one whether it was measured or chosen, and on what basis; `LARGE_INPUT_BYTES`,
 * `FLOOR_MIN_READINGS`, `FLOOR_NOISE_MULTIPLE` and `FLOOR_MEMORY_MARGIN` are fixed by the performance budgets standard,
 * `documentation/decisions/0007-the-performance-budgets-standard.md`. The warmup rule is not here: it
 * is `PERF_CONTRACT` in `@cosyte/test-utils/perf` (ADR 0001 section 2), which `measure.ts` imports
 * and the build bundles, so the scaling gate and the benchmarks warm up by one rule kept in one
 * place.
 *
 * They are not tuning knobs and cannot be overridden per package. A comparison's false alarm rate
 * was measured with these values; change one and the measurement no longer describes the tool.
 *
 * @packageDocumentation
 */

/** The benchmark constants. See {@link BENCH_CONTRACT}. */
export interface BenchContractShape {
  /** Timed samples per case per process. Each sample is whole passes over the corpus. */
  readonly SAMPLES: number;
  /** Minimum timed length of one sample, in milliseconds. A sample runs whole passes until it is reached. */
  readonly SAMPLE_MIN_MS: number;
  /** Rounds in one base against head comparison. Each round runs both sides once, in fresh processes. */
  readonly ROUNDS: number;
  /** One-sided error allowed at each end of the comparison's interval on the median ratio. */
  readonly ALPHA: number;
  /** The smallest slowdown a comparison will call a regression, as a fraction: 0.03 is 3%. */
  readonly THRESHOLD: number;
  /** Time budget for the latency calls of one case, in milliseconds. */
  readonly LATENCY_BUDGET_MS: number;
  /** Most latency calls taken for one case. */
  readonly LATENCY_MAX_CALLS: number;
  /** Fewest latency calls taken for one case, whatever the budget says. */
  readonly LATENCY_MIN_CALLS: number;
  /** A percentile q is reported only when at least this many calls lie above it: n(1 - q) >= 10. */
  readonly LATENCY_TAIL_CALLS: number;
  /** The median call must be at least this many timer reads long, or latency is skipped. */
  readonly LATENCY_TIMER_MULTIPLE: number;
  /** Most operations in the first allocation window. Halved while a garbage collection lands in a window. */
  readonly ALLOC_WINDOW_OPS: number;
  /** The first allocation window is cut to about this many milliseconds of operations, from the warmup's pace. */
  readonly ALLOC_WINDOW_MS: number;
  /** The young generation size the allocation process runs with, in MiB, so a window rarely collects. */
  readonly ALLOC_SEMI_SPACE_MIB: number;
  /** Calls measured one by one for the peak heap. */
  readonly PEAK_CALLS: number;
  /**
   * An input under this many bytes, on average, is budgeted on its median call's total peak above
   * the empty-call floor's median, rather than its highest raw peak. On a GitHub-hosted runner the
   * peak probe costs about 3.3 KiB on a typical empty call and 28 KiB on its highest (one call, the
   * first), so the highest of a small input's calls reads the probe more than the code: 20 times a
   * 1 KiB input is spent before the code runs. At 64 KiB even the probe's highest call is about 2%
   * of a 20 times budget, so above it the raw highest peak is read as before.
   */
  readonly FLOOR_INPUT_BYTES: number;
  /** Rounds in the long run that checks the heap stays flat. */
  readonly LONG_RUN_ROUNDS: number;
  /** Rounds at the start of the long run left out of the slope, while caches and compiled code settle. */
  readonly LONG_RUN_SETTLE_ROUNDS: number;
  /** Minimum length of one long run round, in milliseconds, fixed as a number of operations by the first. */
  readonly LONG_RUN_ROUND_MS: number;
  /** A long run whose fitted growth over the measured rounds reaches this many bytes is reported as growing. */
  readonly LONG_RUN_GROWTH_BYTES: number;
  /** A garbage collection round that reclaims less than this, in bytes, counts as settled (ADR 0001 section 8). */
  readonly GC_SETTLE_BYTES: number;
  /** Consecutive settled rounds needed (ADR 0001 section 8). */
  readonly GC_SETTLE_ROUNDS: number;
  /** Most garbage collection rounds before giving up (ADR 0001 section 8). */
  readonly GC_MAX_ROUNDS: number;
  /** Fresh processes timed for the cold import, for the target and for an empty module each. */
  readonly IMPORT_RUNS: number;
  /**
   * A case whose last three warmup batches each took at least this many milliseconds a pass runs on
   * the large-case plan: every batch is one pass, so the warmup rule's aggregation cannot happen.
   */
  readonly LARGE_PASS_MS: number;
  /** Passes in each of the two windows whose medians the large-case warmup compares. */
  readonly LARGE_WARMUP_WINDOW: number;
  /** Hard cap on the large-case warmup, in milliseconds, from the start of the warmup. */
  readonly LARGE_WARMUP_MAX_MS: number;
  /**
   * The long run also runs on a benchmark's largest size whose rounds fit in this many milliseconds,
   * a round being at least one pass.
   */
  readonly LONG_RUN_MAX_MS: number;
  /**
   * An input of at least this many bytes, on average, is in the `large` size class of a budgets
   * file; one of at least `FLOOR_INPUT_BYTES` and under this is `medium`, and one under that is
   * `small`.
   */
  readonly LARGE_INPUT_BYTES: number;
  /**
   * The fewest readings of one commit a floor is recorded from: the spread between the highest and
   * the lowest of them is the noise a floor check allows for.
   */
  readonly FLOOR_MIN_READINGS: number;
  /** A floor's limit is its highest A/A reading plus this many times their spread. */
  readonly FLOOR_NOISE_MULTIPLE: number;
  /**
   * A memory measure's floor limit (the peak and bytes allocated an operation) is at least this
   * fraction above its highest A/A reading, whatever their spread. V8 compiles on a background
   * thread, so one process of unchanged code lands on one of two allocation levels, the higher up
   * to 4.7% above the lower on a GitHub-hosted runner, and a set of readings that all landed on one
   * level measures a spread of a few bytes. Time keeps its spread alone, and the gzipped bytes stay
   * exact.
   */
  readonly FLOOR_MEMORY_MARGIN: number;
  /** The timing comparison may become a required check when A/A false alarms are under this rate. */
  readonly REQUIRED_FALSE_ALARM_RATE: number;
  /** The confidence that the false alarm rate is under the line, for the rule above. */
  readonly REQUIRED_CONFIDENCE: number;
}

/**
 * The frozen benchmark constants.
 *
 * @example
 * ```ts
 * import { BENCH_CONTRACT } from "@cosyte/bench";
 *
 * BENCH_CONTRACT.ROUNDS; // => 12
 * BENCH_CONTRACT.THRESHOLD; // => 0.03
 * ```
 */
export const BENCH_CONTRACT: BenchContractShape = Object.freeze({
  SAMPLES: 5,
  SAMPLE_MIN_MS: 50,
  ROUNDS: 12,
  ALPHA: 0.05,
  THRESHOLD: 0.03,
  LATENCY_BUDGET_MS: 2_000,
  LATENCY_MAX_CALLS: 5_000,
  LATENCY_MIN_CALLS: 20,
  LATENCY_TAIL_CALLS: 10,
  LATENCY_TIMER_MULTIPLE: 20,
  ALLOC_WINDOW_OPS: 256,
  ALLOC_WINDOW_MS: 100,
  ALLOC_SEMI_SPACE_MIB: 64,
  PEAK_CALLS: 20,
  FLOOR_INPUT_BYTES: 64 * 1024,
  LONG_RUN_ROUNDS: 30,
  LONG_RUN_SETTLE_ROUNDS: 5,
  LONG_RUN_ROUND_MS: 100,
  LONG_RUN_GROWTH_BYTES: 64 * 1024,
  GC_SETTLE_BYTES: 64 * 1024,
  GC_SETTLE_ROUNDS: 2,
  GC_MAX_ROUNDS: 7,
  IMPORT_RUNS: 20,
  LARGE_PASS_MS: 50,
  LARGE_WARMUP_WINDOW: 5,
  LARGE_WARMUP_MAX_MS: 30_000,
  LONG_RUN_MAX_MS: 60_000,
  LARGE_INPUT_BYTES: 1024 * 1024,
  FLOOR_MIN_READINGS: 7,
  FLOOR_NOISE_MULTIPLE: 3,
  FLOOR_MEMORY_MARGIN: 0.05,
  REQUIRED_FALSE_ALARM_RATE: 0.01,
  REQUIRED_CONFIDENCE: 0.95,
});
