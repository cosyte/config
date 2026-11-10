/**
 * The benchmark constants, frozen.
 *
 * Every value here is fixed by the performance standard,
 * `documentation/decisions/0005-the-performance-standard.md` in the `config` repo, which says for
 * each one whether it was measured or chosen, and on what basis. The warmup rule is not here: it
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
  LONG_RUN_ROUNDS: 30,
  LONG_RUN_SETTLE_ROUNDS: 5,
  LONG_RUN_ROUND_MS: 100,
  LONG_RUN_GROWTH_BYTES: 64 * 1024,
  GC_SETTLE_BYTES: 64 * 1024,
  GC_SETTLE_ROUNDS: 2,
  GC_MAX_ROUNDS: 7,
  IMPORT_RUNS: 20,
  REQUIRED_FALSE_ALARM_RATE: 0.01,
  REQUIRED_CONFIDENCE: 0.95,
});
