/**
 * The per-package self-check: **prove your fixtures are large enough for the gate to be able to
 * fail.**
 *
 * This is the load-bearing half of the perf kit, not a formality. The ceiling of 8 is a *global*
 * constant derived from two numbers that move in opposite directions: the worst false alarm across
 * 3,200 clean ratios (6.649, on the noisier runner class) and the weakest real O(n²) signal, and
 * the signal is **not a constant**. Measured, on the same runner, with the same estimator and the
 * same 4× step, varying only the fixture size:
 *
 * | base size → 4× | real O(n²) signal | worst false alarm | usable window |
 * | -------------- | ----------------- | ----------------- | ------------- |
 * | 125 → 500      | 4.69              | 6.649             | **none**      |
 * | 250 → 1000     | 8.09              | 6.649             | 1.22×         |
 * | 500 → 2000     | 8.84              | 6.649             | 1.33×         |
 * | 1000 → 4000    | 10.68             | 6.649             | 1.61×         |
 *
 * At the smallest fixture a genuine quadratic regression is *indistinguishable from noise*: the gate
 * would read green while broken. So a package cannot inherit the ceiling: it has to **earn** it, by
 * showing that a deliberately regressed parse, at its own fixture sizes, clears the ceiling.
 *
 * `assertScalingGateFires` takes the **same options object** your real gate is given. That is the
 * whole design: "run the self-check at the sizes your real gate uses" becomes structural instead of
 * a thing you remember to do. Running it at some convenient large size instead is theatre.
 *
 * It also refuses to be satisfied by a skip. A gate that skips forever reads green while blind; the
 * self-check runs the same warmup and the same phase machinery, so a package whose warmup will not
 * settle, or whose base phase is under `MIN_PHASE_MS`, **fails the build here** rather than shipping
 * a silently-skipping gate.
 *
 * That last guarantee needs two steps the obvious implementation does not have, and they are worth
 * spelling out because ADR 0001 §2 leans on the guarantee being real.
 *
 * 1. **It checks the clean parse, not only the regressed one.** The self-check's own phases run
 *    `regressedParse`, which is *several times slower* than the real `parse`, so a fixture the real
 *    gate would skip on (`phase-too-short`) can still give the regressed parse a comfortable phase,
 *    and a naive self-check would pass while the real gate skipped forever. The asymmetry runs one
 *    way only: the regressed parse is never the faster one, so the clean side is the binding one.
 * 2. **It checks both axes, not only the injection's.** `scalingGate` asserts the count axis *and*
 *    the size axis and skips per axis, while an injected regression only ever exercises one. A
 *    self-check that checked only its own axis would let a package prove its size axis and ship a
 *    count axis that skips on every run: the same silent failure, one axis over.
 *
 * The signal side is still measured on the injection's axis alone; it is only the *precondition*
 * that has to cover everything the gate will assert.
 *
 * @packageDocumentation
 */

import { AssertionError } from "node:assert/strict";

import { PERF_CONTRACT } from "./contract.js";
import {
  defaultWeigh,
  medianOf,
  minOf,
  perfSink,
  round4,
  timePhase,
  toStderr,
  warmUp,
} from "./measure.js";
import {
  buildAxisBaseCorpus,
  buildAxisCorpora,
  type PerfAxis,
  type ScalingGateOptions,
} from "./scaling-gate.js";

/**
 * The deliberately-regressed parse, and how to prove it is a regression rather than a different
 * program.
 */
export interface ScalingRegressionInjection<TInput, TResult> {
  /**
   * A parse with a deliberate complexity regression: the honest shape is the real algorithm reached
   * the wrong way (re-scanning from offset 0 for every segment instead of carrying a cursor), not a
   * pathological `sleep`. It **must compute the same output** as the real `parse`; a "regression"
   * that computes something else is a different program and its timing means nothing.
   */
  readonly regressedParse: (input: TInput) => TResult;
  /**
   * Which axis the injected regression is expected to blow up. Defaults to `"size"`, because an
   * O(n²)-in-length regression is invisible on the count axis by construction: at fixed message size
   * the count axis still scores ≈4. Pass `"count"` only when the injected regression is
   * super-linear in the *number* of inputs.
   */
  readonly axis?: PerfAxis;
  /**
   * Equality used to prove the regression computes the same thing. Defaults to comparing
   * `JSON.stringify` output: override for models JSON does not round-trip (`Map`, `Set`, `bigint`,
   * class instances with private state).
   */
  readonly equals?: (a: TResult, b: TResult) => boolean;
}

/** What the self-check measured, once it has passed. */
export interface ScalingSelfCheckReport {
  /** The `name` from the gate options. */
  readonly name: string;
  /** The axis the regression was measured on. */
  readonly axis: PerfAxis;
  /** The base phase's size knob (`null` on the count axis), and the scaled phase's. */
  readonly baseSize: number | null;
  /** Inputs per phase, base then scaled. */
  readonly inputs: readonly [number, number];
  /** `min(scaled)/min(base)` for the **regressed** parse: the signal. */
  readonly signal: number;
  /** `signal / RATIO_CEILING`. How much room the package actually has. */
  readonly margin: number;
  /**
   * `min` of the **clean** parse's base phase, in milliseconds, **per axis**: the precondition
   * check. The real gate measures `parse`, not `regressedParse`, and it asserts both axes, so these
   * are the two numbers that decide whether the real gate can produce a ratio at all rather than
   * skipping `phase-too-short` on one of them.
   */
  readonly cleanBaseMinMs: { readonly count: number; readonly size: number };
  /** Full sample vectors, milliseconds, retained and never pre-reduced. */
  readonly samples: { readonly base: readonly number[]; readonly scaled: readonly number[] };
  /** The whole diagnostic, as emitted. */
  readonly diagnostic: string;
}

/**
 * Does a measured signal clear the ceiling, and by how much?
 *
 * Trivial arithmetic, factored out on purpose: it is the single decision that converts the ceiling
 * from a global constant into a per-package guarantee, so it is worth being able to drive it
 * directly with P0's four measured signal values in a test that does not depend on a clock.
 *
 * @internal
 */
export function signalVerdict(
  signal: number,
  ceiling: number = PERF_CONTRACT.RATIO_CEILING,
): { clears: boolean; margin: number } {
  return { clears: signal > ceiling, margin: round4(signal / ceiling) };
}

const defaultEquals = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function fail(message: string, extra?: { actual: number; expected: string }): never {
  throw new AssertionError({
    message,
    operator: "perf-self-check",
    ...(extra === undefined ? {} : extra),
  });
}

/**
 * Prove this package's gate can fail: run the injected regression through the same warmup, the same
 * fixed phase order and the same estimator as the real gate, at the **same fixture sizes**, and
 * assert the resulting ratio clears `RATIO_CEILING`.
 *
 * It proves two things, in this order:
 *
 * 1. **The real gate can produce a ratio here at all**: the *clean* `parse`'s warmup settles and its
 *    base phase clears `MIN_PHASE_MS`, **on both axes**. Checked on the clean parse specifically,
 *    because that is what the real gate measures and it is the faster of the two; checked on both
 *    axes because the gate asserts both and skips per axis (see the module docs).
 * 2. **A real complexity regression at these sizes clears `RATIO_CEILING`**: the signal side, which
 *    is what converts the global ceiling into a guarantee for *these* fixtures.
 *
 * Throws (with the full diagnostic, and a specific instruction to grow the fixture) when either
 * fails, or when the injected parse does not compute the same output as the real one. Returns the
 * measured signal and its margin on success. Sizes, counts and timings only; input content is never
 * echoed.
 *
 * @example
 * ```ts
 * import { assertScalingGateFires, type ScalingGateOptions } from "@cosyte/test-utils/perf";
 *
 * const message = (i: number, segments: number) =>
 *   `MSH|^~\\&|LAB|F|EHR|F|20260101120000||ORU^R01|R${String(i)}|P|2.5\r` +
 *   Array.from({ length: segments }, (_v, k) => `OBX|${String(k)}|NM|GLU^Glucose^LN||99|mg/dL`).join("\r");
 *
 * // The real parser: one forward pass.
 * const parse = (raw: string) => raw.split("\r").map((l) => l.split("|"));
 * // The injected regression: same output, reached by rescanning from 0 for every segment.
 * const regressedParse = (raw: string) => {
 *   const out: string[][] = [];
 *   let lines = 1;
 *   for (let p = raw.indexOf("\r"); p !== -1; p = raw.indexOf("\r", p + 1)) lines++;
 *   for (let i = 0; i < lines; i++) {
 *     let start = 0;
 *     for (let k = 0; k < i; k++) start = raw.indexOf("\r", start) + 1;
 *     let end = raw.indexOf("\r", start);
 *     if (end === -1) end = raw.length;
 *     out.push(raw.slice(start, end).split("|"));
 *   }
 *   return out;
 * };
 *
 * // EXACTLY the options the real gate gets, that is what makes the sizes match.
 * const options: ScalingGateOptions<string, string[][]> = {
 *   name: "example parser",
 *   parse,
 *   weigh: (segments) => segments.length,
 *   count: { n: 1500, generate: (i) => message(i, 8) },
 *   size: { inputs: 16, size: 500, generate: (i, size) => message(i, size) },
 * };
 *
 * const report = assertScalingGateFires(options, { regressedParse });
 * report.axis; // => "size"
 * ```
 */
export function assertScalingGateFires<TInput, TResult>(
  options: ScalingGateOptions<TInput, TResult>,
  injection: ScalingRegressionInjection<TInput, TResult>,
): ScalingSelfCheckReport {
  const axis = injection.axis ?? "size";
  const equals = injection.equals ?? defaultEquals;
  const weigh = options.weigh ?? defaultWeigh;
  const report = options.report ?? toStderr;
  const { regressedParse } = injection;

  const { base, scaled, baseSize, scaledSize } = buildAxisCorpora(axis, options);
  const label = `[@cosyte/test-utils/perf] ${options.name}: self-check on the ${axis} axis`;
  const fixture =
    `${String(base.length)} input(s)` +
    (baseSize === null
      ? ` vs ${String(scaled.length)}`
      : ` @ size ${String(baseSize)} vs ${String(scaledSize)}`);

  // A "regression" that computes something different is not a regression. Check one input from
  // each phase: the scaled one matters most, since a length-dependent bug hides at small sizes.
  for (const corpus of [base, scaled]) {
    const input = corpus[0];
    if (input === undefined) fail(`${label}: the ${axis}-axis corpus is empty.`);
    if (!equals(regressedParse(input), options.parse(input))) {
      fail(
        `${label}: the injected \`regressedParse\` does not compute the same output as \`parse\` ` +
          `(fixture: ${fixture}). A regression that computes something else is a different program, ` +
          "and its timing means nothing. Fix the injection, or supply `equals` if your model does " +
          "not round-trip through JSON.",
      );
    }
  }

  // ── Precondition, measured on the CLEAN parse, on BOTH axes.
  //
  // Two reasons this is not the obvious one-axis check.
  //
  // 1. **The clean parse, not the regressed one.** The self-check's own phases run `regressedParse`,
  //    which is several times SLOWER than `parse`, so a fixture on which the real gate would skip
  //    `phase-too-short` can still give the regressed parse a comfortable multi-millisecond phase.
  // 2. **Both axes, not just the injection's.** `scalingGate` asserts the count axis AND the size
  //    axis and skips per axis, while an injected regression only exercises one of them. Checking
  //    only the injection's axis would let a package prove its size axis and ship a count axis that
  //    skips on every run.
  //
  // Either gap produces the same outcome: a permanently-skipping gate that reads green while blind,
  // which is exactly what ADR 0001 §2 claims the self-check makes structurally impossible. It only
  // is if the clean side of every axis the gate will assert is checked here.
  const cleanBaseMinMs = { count: 0, size: 0 };
  for (const preAxis of ["count", "size"] as const) {
    // Base corpus only: the precondition never times a scaled phase, and holding a 4x corpus live
    // across this measurement would inflate it: the direction that lets a knife-edge fixture pass
    // here and skip `phase-too-short` on every real run.
    const corpus = buildAxisBaseCorpus(preAxis, options);
    const preLabel = `[@cosyte/test-utils/perf] ${options.name}: self-check precondition on the ${preAxis} axis`;
    const preFixture =
      `${String(corpus.base.length)} input(s)` +
      (corpus.baseSize === null ? "" : ` @ size ${String(corpus.baseSize)}`);

    const cleanWarmup = warmUp(corpus.base, options.parse, weigh);
    if (!cleanWarmup.stable) {
      fail(
        `${preLabel}: FAILED, the CLEAN parse's warmup never settled ` +
          `(${String(round4(cleanWarmup.elapsedMs))} ms, ${String(cleanWarmup.batches.length)} batches, ` +
          `ms/pass ${cleanWarmup.batches.map(round4).join(", ")}). The real gate warms on \`parse\` on ` +
          "this axis too, so it would skip `warmup-unstable` on every run, and a permanently-skipping " +
          "gate reads green while blind. This is a build failure on purpose.",
      );
    }
    const min = minOf(timePhase(corpus.base, options.parse, weigh));
    if (min < PERF_CONTRACT.MIN_PHASE_MS) {
      fail(
        `${preLabel}: FAILED, the CLEAN base phase measured ${String(round4(min))} ms, under ` +
          `MIN_PHASE_MS ${String(PERF_CONTRACT.MIN_PHASE_MS)} ms (fixture: ${preFixture}). The real ` +
          `gate asserts BOTH axes, so a ${preAxis} axis below the calibrated regime skips on every ` +
          "run however healthy the other axis is. Grow this axis's fixture.",
        { actual: round4(min), expected: `>= ${String(PERF_CONTRACT.MIN_PHASE_MS)}` },
      );
    }
    cleanBaseMinMs[preAxis] = round4(min);
  }

  const warmup = warmUp(base, regressedParse, weigh);
  if (!warmup.stable) {
    fail(
      `${label}: FAILED, warmup never settled (${String(round4(warmup.elapsedMs))} ms, ` +
        `${String(warmup.batches.length)} batches, ms/pass ${warmup.batches.map(round4).join(", ")}). ` +
        "The real gate would skip here, and a permanently-skipping gate reads green while blind. " +
        "This is a build failure on purpose.",
    );
  }

  const sinkBefore = perfSink.value;
  const baseSamples = timePhase(base, regressedParse, weigh);
  const scaledSamples = timePhase(scaled, regressedParse, weigh);
  if (perfSink.value === sinkBefore) {
    fail(
      `${label}: FAILED, the sink never moved, so the measured loop may have been eliminated. ` +
        "Supply `weigh` if `parse` returns nothing.",
    );
  }

  const baseMin = minOf(baseSamples);
  const scaledMin = minOf(scaledSamples);
  if (baseMin < PERF_CONTRACT.MIN_PHASE_MS) {
    fail(
      `${label}: FAILED, the regressed base phase measured ${String(round4(baseMin))} ms, under ` +
        `MIN_PHASE_MS ${String(PERF_CONTRACT.MIN_PHASE_MS)} ms (fixture: ${fixture}). The real gate ` +
        "would skip, so this fixture cannot demonstrate anything. Grow it.",
    );
  }

  const signal = scaledMin / baseMin;
  const verdict = signalVerdict(signal);
  const diagnostic = [
    `${label}: signal ${String(round4(signal))} vs RATIO_CEILING ` +
      `${String(PERF_CONTRACT.RATIO_CEILING)} (margin ${String(verdict.margin)}x)`,
    `  fixture: ${fixture}, the sizes this package's real gate uses`,
    `  base:    min ${String(round4(baseMin))} ms | median ${String(round4(medianOf(baseSamples)))} ms | ` +
      `samples [${baseSamples.map(round4).join(", ")}]`,
    `  scaled:  min ${String(round4(scaledMin))} ms | median ${String(round4(medianOf(scaledSamples)))} ms | ` +
      `samples [${scaledSamples.map(round4).join(", ")}]`,
    `  warmup:  stable after ${String(round4(warmup.elapsedMs))} ms, ${String(warmup.passes)} passes`,
    `  clean:   base min ${String(cleanBaseMinMs.count)} ms (count) / ${String(cleanBaseMinMs.size)} ms ` +
      `(size), both >= MIN_PHASE_MS ${String(PERF_CONTRACT.MIN_PHASE_MS)} ms: the real gate can ` +
      "produce a ratio on both axes, not skip",
  ].join("\n");

  if (!verdict.clears) {
    fail(
      `${diagnostic}\n  FAILED: a real complexity regression at THESE fixture sizes does not clear ` +
        `the ceiling, so this package's gate cannot fail: it would read green while blind. The ` +
        `signal climbs with fixture size (4.69 → 8.09 → 8.84 → 10.68 for 125/250/500/1000 base ` +
        `segments, measured); the fix is to GROW the fixture, never to raise the ceiling.`,
      { actual: round4(signal), expected: `> ${String(PERF_CONTRACT.RATIO_CEILING)}` },
    );
  }

  report(diagnostic);
  return {
    name: options.name,
    axis,
    baseSize,
    inputs: [base.length, scaled.length],
    signal: round4(signal),
    margin: verdict.margin,
    cleanBaseMinMs,
    samples: { base: baseSamples.map(round4), scaled: scaledSamples.map(round4) },
    diagnostic,
  };
}
