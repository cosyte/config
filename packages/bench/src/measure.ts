/**
 * The timing primitives: the warmup, the throughput samples and the latency calls. They run inside
 * a measuring process, one case per process, and take their clocks as arguments so their tests can
 * drive them with exact arithmetic instead of a machine's noise.
 *
 * @packageDocumentation
 */

// The one source of the warmup rule. A relative import of the scaling gate's own contract file, not
// of the published `@cosyte/test-utils/perf`, so the build bundles it into `dist` and this package
// keeps no runtime dependency (that one would bring `fast-check` in as a peer). A change to the rule
// there changes this package's build, so it needs a changeset that bumps this package too.
import { PERF_CONTRACT } from "../../test-utils/src/perf/contract.js";
import { BENCH_CONTRACT } from "./contract.js";
import { median, nearestRank, round } from "./stats.js";

/**
 * The warmup rule, read from `PERF_CONTRACT` in `@cosyte/test-utils/perf` (ADR 0001 section 2) and
 * renamed, so the scaling gate and the benchmarks warm up by one rule kept in one place.
 *
 * @internal
 */
export const WARMUP = Object.freeze({
  MIN_MS: PERF_CONTRACT.WARMUP_MIN_MS,
  BATCH_MS: PERF_CONTRACT.WARMUP_BATCH_MS,
  MAX_MS: PERF_CONTRACT.WARMUP_MAX_MS,
  STABLE_TOL: PERF_CONTRACT.WARMUP_STABLE_TOL,
  STABLE_BATCHES: PERF_CONTRACT.WARMUP_STABLE_BATCHES,
});

/**
 * A millisecond clock. `performance.now` in a real run.
 *
 * @internal
 */
export type Clock = () => number;

/**
 * A nanosecond clock. `process.hrtime.bigint` in a real run.
 *
 * @internal
 */
export type NsClock = () => bigint;

/** What the warmup did. */
export interface WarmupReport {
  /** Whether three batches in a row came within 5% of their median before 5 s ran out. */
  readonly stable: boolean;
  /** Wall time spent warming, in milliseconds. */
  readonly elapsedMs: number;
  /** Passes over the corpus. */
  readonly passes: number;
  /** Each batch's milliseconds per pass. */
  readonly batches: readonly number[];
}

/**
 * Whether the last `STABLE_BATCHES` batches all lie within `STABLE_TOL` of their median.
 *
 * @internal
 */
export function batchesAreStable(batches: readonly number[]): boolean {
  if (batches.length < WARMUP.STABLE_BATCHES) return false;
  const window = batches.slice(-WARMUP.STABLE_BATCHES);
  const mid = median(window);
  // A zero median makes every relative distance `NaN`, which no tolerance accepts: refused.
  return window.every((b) => Math.abs(b - mid) / mid <= WARMUP.STABLE_TOL);
}

/**
 * Warm up by time, with a stability rule, never by a fixed count (ADR 0001 section 2): batches of
 * whole passes of at least 50 ms, at least 500 ms in all, until three batches in a row lie within
 * 5% of their median, or 5 s pass without that.
 *
 * @internal
 */
export function warmUp(pass: () => void, clock: Clock): WarmupReport {
  const start = clock();
  const batches: number[] = [];
  let passes = 0;
  for (;;) {
    const b0 = clock();
    let inBatch = 0;
    let batchMs: number;
    do {
      pass();
      inBatch++;
      batchMs = clock() - b0;
    } while (batchMs < WARMUP.BATCH_MS);
    passes += inBatch;
    batches.push(batchMs / inBatch);
    const elapsedMs = clock() - start;
    if (elapsedMs >= WARMUP.MIN_MS && batchesAreStable(batches)) {
      return { stable: true, elapsedMs, passes, batches };
    }
    if (elapsedMs >= WARMUP.MAX_MS) return { stable: false, elapsedMs, passes, batches };
  }
}

/**
 * Take `SAMPLES` throughput samples. A sample runs whole passes until `SAMPLE_MIN_MS` has passed
 * and reports milliseconds per operation.
 *
 * `inject` plants a slowdown, for calibration only: after each pass the loop reads the clock until
 * `inject` times that pass's own measured time has passed, then starts the next pass, so each
 * sample's time includes the spin. That is all it does. It does not make the measured code slower
 * by exactly that fraction: the spin changes the loop the engine compiles and what the processor
 * does between passes, so the ratio a comparison then measures is not `1 + inject` and differs by
 * workload and machine. A calibration reports the ratio it observed for each case
 * (`CalibrationBody.observed`), and a detection rate is read against that, never against `inject`.
 * Zero in every real measurement.
 *
 * @internal
 */
export function sampleThroughput(
  pass: () => void,
  opsPerPass: number,
  clock: Clock,
  inject = 0,
): number[] {
  const samples: number[] = [];
  for (let s = 0; s < BENCH_CONTRACT.SAMPLES; s++) {
    const t0 = clock();
    let t = t0;
    let passes = 0;
    do {
      const p0 = t;
      pass();
      t = clock();
      // Zero in a real measurement, so `until` is `t` and the clock is not read again.
      const until = t + inject * (t - p0);
      while (t < until) t = clock();
      passes++;
    } while (t - t0 < BENCH_CONTRACT.SAMPLE_MIN_MS);
    samples.push((t - t0) / (passes * opsPerPass));
  }
  return samples;
}

/**
 * The median gap between two back-to-back reads of the nanosecond clock: what one latency reading
 * costs before the call itself.
 *
 * @internal
 */
export function timerOverheadNs(ns: NsClock, reads = 1_000): number {
  const gaps: number[] = [];
  for (let i = 0; i < reads; i++) {
    const a = ns();
    const b = ns();
    gaps.push(Number(b - a));
  }
  return median(gaps);
}

/** Per-call latency, or why there is none. */
export type LatencyReport =
  | {
      readonly status: "measured";
      readonly calls: number;
      readonly timerOverheadNs: number;
      /** `null` when fewer than `LATENCY_TAIL_CALLS` calls lie above the percentile. */
      readonly p50Ns: number | null;
      readonly p95Ns: number | null;
      readonly p99Ns: number | null;
      readonly maxNs: number;
    }
  | {
      readonly status: "skipped";
      readonly reason: "latency-below-timer-resolution";
      readonly calls: number;
      readonly timerOverheadNs: number;
      readonly p50Ns: number;
    };

/**
 * A percentile, or `null` when too few calls lie above it to tell it from the maximum.
 *
 * @internal
 */
export function tailPercentile(times: readonly number[], q: number): number | null {
  return times.length * (1 - q) >= BENCH_CONTRACT.LATENCY_TAIL_CALLS ? nearestRank(times, q) : null;
}

/**
 * Time calls one at a time: at least `LATENCY_MIN_CALLS`, then until `LATENCY_BUDGET_MS` or
 * `LATENCY_MAX_CALLS`. Skips, loudly and typed, when the median call is under
 * `LATENCY_TIMER_MULTIPLE` clock reads: then the clock, not the call, is being measured.
 *
 * @internal
 */
export function measureLatency(call: (i: number) => void, ns: NsClock): LatencyReport {
  const overhead = timerOverheadNs(ns);
  const budgetNs = BigInt(BENCH_CONTRACT.LATENCY_BUDGET_MS) * 1_000_000n;
  const times: number[] = [];
  const start = ns();
  let now = start;
  while (
    times.length < BENCH_CONTRACT.LATENCY_MAX_CALLS &&
    (times.length < BENCH_CONTRACT.LATENCY_MIN_CALLS || now - start < budgetNs)
  ) {
    const a = ns();
    call(times.length);
    now = ns();
    times.push(Number(now - a));
  }
  const p50 = nearestRank(times, 0.5);
  if (p50 < BENCH_CONTRACT.LATENCY_TIMER_MULTIPLE * overhead) {
    return {
      status: "skipped",
      reason: "latency-below-timer-resolution",
      calls: times.length,
      timerOverheadNs: round(overhead, 1),
      p50Ns: p50,
    };
  }
  return {
    status: "measured",
    calls: times.length,
    timerOverheadNs: round(overhead, 1),
    p50Ns: tailPercentile(times, 0.5),
    p95Ns: tailPercentile(times, 0.95),
    p99Ns: tailPercentile(times, 0.99),
    maxNs: Math.max(...times),
  };
}
