/**
 * The frozen measurement constants.
 *
 * Every value here is fixed by **ADR 0001: the performance measurement contract**
 * (`documentation/decisions/0001-perf-measurement-contract.md` in the `config` repo), which in turn
 * derives them from the PERF-P0 calibration: 3,200 4N-vs-N ratios on a linear workload, 320 on a
 * deliberately O(n²) one, across two runner classes on Node 22.23.1 / V8 12.4.
 *
 * They are **not tuning knobs and are deliberately not overridable per package.** The ceiling was
 * set from the worst false alarm in that population and the weakest real signal at `hl7`'s own
 * fixture size, so it is conditional on the estimator, the sampling shape *and* the warmup rule:
 * changing any one of them moves the operating point the ceiling was measured against. The ADR's
 * review triggers are the process for changing them.
 *
 * @packageDocumentation
 */

/**
 * The measurement constants, frozen. See {@link PERF_CONTRACT}.
 */
export interface PerfContractShape {
  /**
   * Upper bound on `min(scaled) / min(base)`. **8**: above the worst false alarm in 3,200 samples
   * (6.649, `min`, container leg) and below the weakest real O(n²) signal measured at `hl7`'s own
   * fixture size (8.84). Margins 1.20× / 1.10×. Measured.
   */
  readonly RATIO_CEILING: number;
  /**
   * Lower bound on the same ratio. **1.5**: below all 3,200 samples (worst 1.702) and above the ≈1
   * that a same-workload-on-both-phases bug produces. Margin 1.13×, the thinnest in the contract.
   * Measured.
   */
  readonly RATIO_FLOOR: number;
  /**
   * Timed repetitions per phase. **5**, measured by construction: the whole calibration was taken at
   * 5 reps, and `min` over a different rep count is a different statistic.
   */
  readonly REPS: number;
  /**
   * The multiplier between the base phase and the scaled phase. **4×**, measured by construction:
   * every ratio in the dataset is a 4× step, so the ideal linear ratio is 4.
   */
  readonly SCALE_STEP: number;
  /**
   * Floor on the base phase's `min` sample, in milliseconds. **4**: the fastest base phase in all
   * 3,200 samples was 4.14 ms; below that the ceiling is extrapolation, so the gate refuses to
   * answer. Measured.
   */
  readonly MIN_PHASE_MS: number;
  /**
   * Minimum total warmup time before the stability rule may fire, in milliseconds. **500**: one
   * further P0 trial (136–294 ms of the same workload) brought rep-to-rep drift from as much as
   * 1.23× inside ±5%; 500 ms is 1.7–3.7× that. Measured.
   */
  readonly WARMUP_MIN_MS: number;
  /**
   * Minimum timed duration of one warmup batch, in milliseconds. **50**: judgement forced by
   * measurement: a single ~4–9 ms pass is not stable enough to satisfy ±5% three times running
   * (1–92% of warm phases do, by axis), and a 50 ms batch aggregates 5–12 passes. Aggregation is
   * what shrinks that jitter, so the batch length is load-bearing rather than a free choice.
   */
  readonly WARMUP_BATCH_MS: number;
  /**
   * Hard cap on total warmup, in milliseconds. **5 000**: judgement, no measured basis. Bounds the
   * fleet cost and leaves ~100 batches of headroom, so the cap is reached only by a genuinely
   * unsettled runtime.
   */
  readonly WARMUP_MAX_MS: number;
  /**
   * Relative tolerance for the warmup stability rule, as a fraction. **0.05** (±5%): judgement
   * anchored on P0's rep1/rep5 ratio inside a warm 5-rep phase (0.96–1.05× GitHub, 0.97–1.02×
   * container), which is a different statistic at a different granularity.
   */
  readonly WARMUP_STABLE_TOL: number;
  /**
   * How many consecutive batches must lie inside the tolerance. **3**: two consecutive can be met
   * by a coincidental pair on a heavy-tailed distribution; a third costs 50 ms against a 5 s cap.
   */
  readonly WARMUP_STABLE_BATCHES: number;
}

/**
 * The frozen measurement constants, as decided by ADR 0001.
 *
 * Read them, print them in your own diagnostics, assert against them, but do not expect a knob to
 * override them. A package that cannot satisfy the contract at its fixture sizes has a fixture-size
 * problem, and {@link assertScalingGateFires} is what turns that into a build failure.
 *
 * @example
 * ```ts
 * import { PERF_CONTRACT } from "@cosyte/test-utils/perf";
 *
 * PERF_CONTRACT.RATIO_CEILING; // => 8
 * PERF_CONTRACT.SCALE_STEP; // => 4
 * ```
 */
export const PERF_CONTRACT: PerfContractShape = Object.freeze({
  RATIO_CEILING: 8,
  RATIO_FLOOR: 1.5,
  REPS: 5,
  SCALE_STEP: 4,
  MIN_PHASE_MS: 4,
  WARMUP_MIN_MS: 500,
  WARMUP_BATCH_MS: 50,
  WARMUP_MAX_MS: 5_000,
  WARMUP_STABLE_TOL: 0.05,
  WARMUP_STABLE_BATCHES: 3,
});
