/**
 * The throughput scaling gate: the generic, per-package regression gate for
 * *complexity-shaped* slowdowns.
 *
 * It measures two axes in one process and asserts both:
 *
 * - **count**: `N` inputs of a fixed size vs `4N` of the same size. Catches work that is
 *   super-linear in the *number* of messages (an accumulating rescan, an O(n²) index rebuild).
 * - **size**: a fixed number of inputs at length `S` vs the same number at length `4S`. Catches an
 *   O(n²)-in-length tokenizer, which the count axis **structurally cannot see**: at fixed message
 *   size, a quadratic-in-length parser still scores ≈4 on the count axis.
 *
 * Size-scaling is therefore not optional and there is no way to ask for one axis. That is deliberate.
 *
 * ## What this does not catch
 *
 * - **Constant-factor regressions.** A 10% slowdown passes, and will keep passing. This is not a
 *   tuning gap: from a single cloud instance only 17–22% of configurations reliably detect a ≤10%
 *   slowdown, so the sensitivity is a property of the technique. Do not claim 10% sensitivity
 *   anywhere in a package's docs.
 * - **Complexity regressions whose fixture is too small.** "Catches complexity-shaped regressions"
 *   is **conditional**, not absolute: the signal a real O(n²) parser produces climbs with fixture
 *   size (4.69 → 8.09 → 8.84 → 10.68 as the base grows 125 → 250 → 500 → 1000 repeated segments, on
 *   the noisier runner class), while the false-alarm tail stays at 6.649. At the smallest of those
 *   the signal is *inside the noise* and the gate reads green while blind. **Each adopting package
 *   must prove its own fixtures are large enough**, that is what
 *   {@link ../self-check.js | assertScalingGateFires} is for, and it fails the build when they are not.
 * - Anything that only manifests under real I/O, network, or concurrency. Every workload here is
 *   synthetic and in-memory.
 *
 * ## Fail-safe
 *
 * Borrowed from the parser class: **a performance measurement must never report a confident wrong
 * answer.** When the preconditions for a ratio do not hold the gate **skips loudly** with a typed
 * reason rather than passing silently or failing: see {@link PerfSkipReason}. A skip is not a pass.
 *
 * ## PHI
 *
 * Every diagnostic prints sizes, counts, ratios and sample vectors and **never** echoes input
 * content. Inputs are synthetic and generated in-process by construction: the runner takes a
 * generator function, never a file path.
 *
 * @packageDocumentation
 */

import { AssertionError } from "node:assert/strict";

import { PERF_CONTRACT, type PerfContractShape } from "./contract.js";
import {
  defaultWeigh,
  medianOf,
  minOf,
  perfSink,
  round4,
  timePhase,
  toStderr,
  warmUp,
  type WarmupReport,
} from "./measure.js";

/**
 * The two scaling axes. `count` scales the number of inputs; `size` scales each input's length.
 */
export type PerfAxis = "count" | "size";

/**
 * Why a gate refused to answer. A skip is **not** a pass.
 *
 * - `phase-too-short`: the base phase's `min` sample is under `MIN_PHASE_MS` (4 ms). The fastest
 *   base phase in P0's whole 3,200-sample population was 4.14 ms; below that the ceiling is
 *   extrapolation, so the gate refuses rather than answers wrongly. It means the package's fixture
 *   is below the calibrated regime.
 * - `warmup-unstable`: `WARMUP_MAX_MS` elapsed without `WARMUP_STABLE_BATCHES` consecutive batches
 *   inside the tolerance, i.e. the runtime never reached steady state.
 *
 * The memory runner adds `gc-unavailable` and `gc-unsettled` to this union when it lands.
 */
export type PerfSkipReason = "phase-too-short" | "warmup-unstable";

/**
 * The **count** axis fixture: `n` inputs vs `n * SCALE_STEP` inputs, all the same size.
 */
export interface CountAxisFixture<TInput> {
  /** Inputs in the base phase. The scaled phase builds `n * SCALE_STEP` (i.e. `4n`) of them. */
  readonly n: number;
  /**
   * Build one input. `index` varies so the corpus is not one object repeated, but the input's
   * **length must not depend on it**: this axis holds size constant so the ratio isolates count.
   */
  readonly generate: (index: number) => TInput;
}

/**
 * The **size** axis fixture: `inputs` inputs at `size` vs the same `inputs` count at
 * `size * SCALE_STEP`.
 */
export interface SizeAxisFixture<TInput> {
  /** Inputs per phase: identical on both phases, so the ratio isolates length. */
  readonly inputs: number;
  /**
   * The base phase's size knob, in whatever unit the generator scales (repeated segments, records,
   * frames). The scaled phase uses `size * SCALE_STEP`. **This number is a calibration parameter,
   * not a convenience**: see the module docs, and prove it with `assertScalingGateFires`.
   */
  readonly size: number;
  /** Build one input of the given size. */
  readonly generate: (index: number, size: number) => TInput;
}

/**
 * Everything {@link scalingGate} needs. The same object is handed to
 * {@link ../self-check.js | assertScalingGateFires}, which is how "run the self-check at the fixture
 * sizes your real gate uses" is made structural rather than a thing you remember to do.
 */
export interface ScalingGateOptions<TInput, TResult> {
  /** Name used in diagnostics, e.g. `"@cosyte/hl7 parseHL7"`. */
  readonly name: string;
  /** The function under test. Called once per input, on a local binding, inside the timed loop. */
  readonly parse: (input: TInput) => TResult;
  /** The count axis fixture. */
  readonly count: CountAxisFixture<TInput>;
  /** The size axis fixture. */
  readonly size: SizeAxisFixture<TInput>;
  /**
   * Reduce a parse result to a number summed into {@link ../measure.js | perfSink}, so the compiler
   * cannot delete the measured call. Defaults to `1` per non-nullish result. **If your `parse`
   * returns nothing, you must supply this**: the runner refuses to report a ratio from an empty
   * sink.
   */
  readonly weigh?: (result: TResult) => number;
  /**
   * Where loud skip diagnostics go. Defaults to `process.stderr`. A test host that wants to fail
   * rather than warn on a skip should inspect the returned report instead of replacing this.
   */
  readonly report?: (line: string) => void;
}

/** One phase's measurement. The **full** sample vector is always retained, never pre-reduced. */
export interface PhaseReport {
  /** `"base"` (the `N` / `S` phase) or `"scaled"` (the `4N` / `4S` phase). */
  readonly phase: "base" | "scaled";
  /** Inputs in this phase's corpus. */
  readonly inputs: number;
  /** The size knob for this phase, or `null` on the count axis where size is held constant. */
  readonly size: number | null;
  /** Every timed rep, in milliseconds, in the order taken. */
  readonly samples: readonly number[];
  /** `min(samples)`: the estimator the ratio assertion uses. */
  readonly min: number;
  /** `median(samples)`: the estimator a published headline uses. Reported, never asserted on. */
  readonly median: number;
}

/** One axis's outcome: either a ratio was measured and asserted, or the gate refused to answer. */
export type AxisReport<A extends PerfAxis = PerfAxis> =
  | {
      readonly axis: A;
      readonly status: "measured";
      readonly warmup: WarmupReport;
      readonly base: PhaseReport;
      readonly scaled: PhaseReport;
      /** `min(scaled) / min(base)`. Asserted against the floor and the ceiling. */
      readonly ratio: number;
      readonly diagnostic: string;
    }
  | {
      readonly axis: A;
      readonly status: "skipped";
      readonly skipReason: PerfSkipReason;
      readonly warmup: WarmupReport;
      /** `null` when the warmup never reached a phase. */
      readonly base: PhaseReport | null;
      readonly scaled: PhaseReport | null;
      readonly diagnostic: string;
    };

/** What {@link scalingGate} returns: one report per axis, plus the contract they were judged by. */
export interface ScalingGateReport {
  /** The `name` from the options. */
  readonly name: string;
  /** The constants in force. */
  readonly contract: PerfContractShape;
  /** The count axis. */
  readonly count: AxisReport<"count">;
  /** The size axis. */
  readonly size: AxisReport<"size">;
}

function requirePositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`scalingGate: ${label} must be a positive integer, got ${String(value)}`);
  }
}

function phaseReport(
  phase: "base" | "scaled",
  inputs: number,
  size: number | null,
  samples: readonly number[],
): PhaseReport {
  return {
    phase,
    inputs,
    size,
    samples: samples.map(round4),
    min: round4(minOf(samples)),
    median: round4(medianOf(samples)),
  };
}

function describe(
  name: string,
  axis: PerfAxis,
  warmup: WarmupReport,
  base: PhaseReport | null,
  scaled: PhaseReport | null,
  ratio: number | null,
  headline: string,
): string {
  const lines = [
    `[@cosyte/test-utils/perf] ${name}: ${axis} axis: ${headline}`,
    `  contract: floor ${String(PERF_CONTRACT.RATIO_FLOOR)} <= min(scaled)/min(base) <= ceiling ` +
      `${String(PERF_CONTRACT.RATIO_CEILING)}, reps ${String(PERF_CONTRACT.REPS)}, ` +
      `step ${String(PERF_CONTRACT.SCALE_STEP)}x, phase order base -> scaled (fixed)`,
    `  warmup:  ${warmup.stable ? "stable" : "UNSTABLE"} after ${String(round4(warmup.elapsedMs))} ms, ` +
      `${String(warmup.passes)} passes, ${String(warmup.batches.length)} batches ` +
      `(ms/pass: ${warmup.batches.map(round4).join(", ")})`,
  ];
  for (const p of [base, scaled]) {
    if (p === null) continue;
    lines.push(
      `  ${p.phase.padEnd(6)}: ${String(p.inputs)} input(s)` +
        (p.size === null ? "" : ` @ size ${String(p.size)}`) +
        ` | min ${String(p.min)} ms | median ${String(p.median)} ms | samples [${p.samples.join(", ")}]`,
    );
  }
  if (ratio !== null) lines.push(`  ratio:   ${String(round4(ratio))}`);
  lines.push(
    "  (diagnostics carry sizes, counts and timings only: never input content. ADR 0001.)",
  );
  return lines.join("\n");
}

function runAxis<TInput, TResult, A extends PerfAxis>(
  axis: A,
  options: ScalingGateOptions<TInput, TResult>,
  weigh: (result: TResult) => number,
  report: (line: string) => void,
): AxisReport<A> {
  const { name, parse } = options;
  // Built here rather than up front so the other axis's corpus is not resident while this one is
  // timed. On the size axis a 4x corpus is the largest allocation the kit makes, and holding both
  // axes' worth of it across every timed region would put GC pressure into the measurement that
  // P0's one-axis-per-process calibration never saw.
  const {
    base: baseCorpus,
    scaled: scaledCorpus,
    baseSize,
    scaledSize,
  } = buildAxisCorpora(axis, options);

  const warmup = warmUp(baseCorpus, parse, weigh);
  if (!warmup.stable) {
    const diagnostic = describe(
      name,
      axis,
      warmup,
      null,
      null,
      null,
      `SKIPPED (warmup-unstable): ${String(PERF_CONTRACT.WARMUP_MAX_MS)} ms elapsed without ` +
        `${String(PERF_CONTRACT.WARMUP_STABLE_BATCHES)} consecutive batches within ` +
        `+/-${String(PERF_CONTRACT.WARMUP_STABLE_TOL * 100)}% of their median. A skip is NOT a pass.`,
    );
    report(diagnostic);
    return {
      axis,
      status: "skipped",
      skipReason: "warmup-unstable",
      warmup,
      base: null,
      scaled: null,
      diagnostic,
    };
  }

  const sinkBefore = perfSink.value;
  const baseSamples = timePhase(baseCorpus, parse, weigh);
  const scaledSamples = timePhase(scaledCorpus, parse, weigh);
  if (perfSink.value === sinkBefore) {
    throw new AssertionError({
      message:
        `[@cosyte/test-utils/perf] ${name}: ${axis} axis: the sink never moved, so the measured ` +
        "loop may have been eliminated and any ratio from it would be meaningless. Supply `weigh` " +
        "if `parse` returns nothing (the default counts one per non-nullish result).",
      operator: "perf-sink-liveness",
    });
  }

  const base = phaseReport("base", baseCorpus.length, baseSize, baseSamples);
  const scaled = phaseReport("scaled", scaledCorpus.length, scaledSize, scaledSamples);

  if (base.min < PERF_CONTRACT.MIN_PHASE_MS) {
    const diagnostic = describe(
      name,
      axis,
      warmup,
      base,
      scaled,
      null,
      `SKIPPED (phase-too-short): base min ${String(base.min)} ms is under MIN_PHASE_MS ` +
        `${String(PERF_CONTRACT.MIN_PHASE_MS)} ms, so the ceiling would be extrapolation. ` +
        "This fixture is below the calibrated regime: grow it. A skip is NOT a pass.",
    );
    report(diagnostic);
    return {
      axis,
      status: "skipped",
      skipReason: "phase-too-short",
      warmup,
      base,
      scaled,
      diagnostic,
    };
  }

  const ratio = scaled.min / base.min;
  const measured = describe(name, axis, warmup, base, scaled, ratio, "measured");

  if (ratio > PERF_CONTRACT.RATIO_CEILING) {
    throw new AssertionError({
      message:
        `${measured}\n  FAILED: ratio ${String(round4(ratio))} exceeds RATIO_CEILING ` +
        `${String(PERF_CONTRACT.RATIO_CEILING)}: this is the shape of a complexity regression on the ` +
        `${axis} axis (ideal linear ratio is ${String(PERF_CONTRACT.SCALE_STEP)}).`,
      actual: round4(ratio),
      expected: `<= ${String(PERF_CONTRACT.RATIO_CEILING)}`,
      operator: "perf-scaling-ceiling",
    });
  }
  if (ratio < PERF_CONTRACT.RATIO_FLOOR) {
    throw new AssertionError({
      message:
        `${measured}\n  FAILED: ratio ${String(round4(ratio))} is under RATIO_FLOOR ` +
        `${String(PERF_CONTRACT.RATIO_FLOOR)}. What this catches is narrow and specific: **the two ` +
        "phases received the same workload**: a wrong input size, or a generator returning the same " +
        "corpus twice. It does NOT catch dead-code elimination (that stays at ~4 on the count axis " +
        "and is prevented structurally by the sink).",
      actual: round4(ratio),
      expected: `>= ${String(PERF_CONTRACT.RATIO_FLOOR)}`,
      operator: "perf-scaling-floor",
    });
  }

  return {
    axis,
    status: "measured",
    warmup,
    base,
    scaled,
    ratio: round4(ratio),
    diagnostic: measured,
  };
}

/**
 * Build **only the base corpus** for one axis.
 *
 * Separate from {@link buildAxisCorpora} because the self-check's precondition pass needs the base
 * phase of *both* axes and the scaled phase of neither. Building the pair and discarding `.scaled`
 * would hold an extra 4× corpus live across a timed region: at `hl7`'s fixture that is 4,000 more
 * messages, and adding GC pressure to a `>= MIN_PHASE_MS` check pushes it the wrong way: it
 * inflates the measured time, which is what lets a knife-edge fixture pass the precondition and then
 * skip `phase-too-short` on every real run.
 *
 * **This reduces the resident set, it does not empty it.** The injection axis's own corpora are built
 * before the precondition loop and stay reachable throughout it. That residual is deliberate and
 * benign: `runAxis` also times its base phase with the matching 4× corpus resident, so what is left
 * moves the precondition *toward* the condition the real gate measures under, which is the direction
 * that makes it a faithful precondition rather than an optimistic one.
 *
 * @internal
 */
export function buildAxisBaseCorpus<TInput, TResult>(
  axis: PerfAxis,
  options: ScalingGateOptions<TInput, TResult>,
): { base: readonly TInput[]; baseSize: number | null } {
  if (axis === "count") {
    requirePositiveInt(options.count.n, "count.n");
    return {
      base: Array.from({ length: options.count.n }, (_v, i) => options.count.generate(i)),
      baseSize: null,
    };
  }
  requirePositiveInt(options.size.inputs, "size.inputs");
  requirePositiveInt(options.size.size, "size.size");
  const { inputs, size } = options.size;
  return {
    base: Array.from({ length: inputs }, (_v, i) => options.size.generate(i, size)),
    baseSize: size,
  };
}

/**
 * Build the two corpora for one axis, **outside** every timed region. Exported for the self-check,
 * which must run at exactly the sizes the real gate uses.
 *
 * @internal
 */
export function buildAxisCorpora<TInput, TResult>(
  axis: PerfAxis,
  options: ScalingGateOptions<TInput, TResult>,
): {
  base: readonly TInput[];
  scaled: readonly TInput[];
  baseSize: number | null;
  scaledSize: number | null;
} {
  const step = PERF_CONTRACT.SCALE_STEP;
  const { base, baseSize } = buildAxisBaseCorpus(axis, options);
  if (axis === "count") {
    return {
      base,
      scaled: Array.from({ length: options.count.n * step }, (_v, i) => options.count.generate(i)),
      baseSize: null,
      scaledSize: null,
    };
  }
  const { inputs, size } = options.size;
  return {
    base,
    scaled: Array.from({ length: inputs }, (_v, i) => options.size.generate(i, size * step)),
    baseSize,
    scaledSize: size * step,
  };
}

/**
 * Run the scaling gate on both axes and assert both ratios.
 *
 * Per axis: build both corpora outside every timed region, warm up on the base corpus with the
 * time-budgeted stability rule, time the base phase then the scaled phase (**fixed** order: C5 is
 * a reproducible ~4.7–5.1% bias, not noise, and randomizing would fold it into the variance of a
 * window only 1.33× wide), sum every result into the sink, then assert
 * `RATIO_FLOOR <= min(scaled)/min(base) <= RATIO_CEILING`.
 *
 * **Throws** an `AssertionError` on a ratio outside the band. **Skips loudly**: writes the full
 * diagnostic to stderr and returns a `status: "skipped"` axis report, when the preconditions for a
 * ratio do not hold. Read the returned report if you want a skip to fail your suite; a skip is not
 * a pass, and `assertScalingGateFires` is what stops a package from shipping a permanently-skipping
 * gate.
 *
 * @example
 * ```ts
 * import { scalingGate } from "@cosyte/test-utils/perf";
 *
 * const line = (n: number) => `OBX|${String(n)}|NM|GLU^Glucose^LN||99|mg/dL|70-110|N|||F`;
 * const message = (i: number, segments: number) =>
 *   `MSH|^~\\&|LAB|F|EHR|F|20260101120000||ORU^R01|R${String(i)}|P|2.5\r` +
 *   Array.from({ length: segments }, (_v, k) => line(k)).join("\r");
 * const parse = (raw: string) => raw.split("\r").map((l) => l.split("|"));
 *
 * const report = scalingGate({
 *   name: "example parser",
 *   parse,
 *   weigh: (segments) => segments.length,
 *   count: { n: 1500, generate: (i) => message(i, 8) },
 *   size: { inputs: 16, size: 500, generate: (i, size) => message(i, size) },
 * });
 *
 * report.count.axis; // => "count"
 * report.size.axis; // => "size"
 * ```
 */
export function scalingGate<TInput, TResult>(
  options: ScalingGateOptions<TInput, TResult>,
): ScalingGateReport {
  const weigh = options.weigh ?? defaultWeigh;
  const report = options.report ?? toStderr;

  const count = runAxis("count", options, weigh, report);
  const size = runAxis("size", options, weigh, report);

  return { name: options.name, contract: PERF_CONTRACT, count, size };
}
