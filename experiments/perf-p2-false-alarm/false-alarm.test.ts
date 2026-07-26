/**
 * PERF-P2 · the false-alarm sweep — "the gate does **not** fire across 200 clean runs".
 *
 * The roadmap makes this an acceptance clause for P2 rather than a nice-to-have, and ADR 0001 §2
 * says why it cannot be inherited from P0:
 *
 * > `min` over 5 reps partially launders an unfinished warmup, because the last reps are the fast
 * > ones — and `RATIO_CEILING` was set from the worst false alarm in the whole population, which is a
 * > _warm_ row. **Changing the warmup rule moves the operating point, so the ceiling must be
 * > re-checked — on both sides.** […] that run must be taken under the warmup rule decided here, not
 * > under `hl7`'s fixed-count one. P2 owns both.
 *
 * P0 measured 3,200 ratios after an `hl7`-shaped **fixed-count** warmup. The kit ships a
 * **time-budgeted** warmup with a stability rule, which was P1's judgement and has never been run at
 * scale. So the false-alarm side has to be re-measured against the thing that actually ships.
 *
 * One invocation of this file is **one run**: a fresh process, one `scalingGate` call over a workload
 * that is linear by construction, at `hl7`'s own fixture sizes. Every ratio it records is therefore a
 * false alarm by definition — the question is only how large, and how often the gate refuses to
 * answer at all. `run.sh` launches this file many times so the runs are genuinely independent, the
 * way a real CI gate runs once per fresh fork.
 *
 * The workload is imported from `../perf-calibration/workload.js` **unchanged** — the exact module
 * P0's 3,200 committed ratios were measured against. Nothing in this directory modifies it.
 *
 * That does **not** make the warmup rule the only variable, and ANALYSIS.md §1/§4 depend on saying
 * so: P0 ran one axis per process where this runs both (size second, so it inherits a warmed,
 * 5,000-message process), and the timed loop body differs (`parseMessage(m)` in-module versus
 * `weigh(parse(input))` through two parameter bindings, which changes the bytecode length feeding
 * W1's tier-up budget). This sweep measures the SHIPPED configuration end to end — which is what the
 * acceptance clause asks — and cannot attribute a difference from P0 to the warmup rule alone.
 *
 * Env inputs: `RUN_INDEX`, `OUT` (JSONL file, appended to). No assertions beyond liveness: this is
 * an experiment, not a gate.
 */

import { appendFileSync } from "node:fs";

import { expect, it } from "vitest";

import { scalingGate, type ScalingGateOptions } from "../../packages/test-utils/src/perf/index.js";
import {
  adtMessage,
  oruMessage,
  parseMessage,
  type ParsedMessage,
} from "../perf-calibration/workload.js";

/** `hl7`'s fixture, and P0 Experiment A's: 1,000 ADT messages, and 10 ORU messages at 500 OBX. */
const COUNT_N = 1_000;
const SIZE_M = 10;
const SIZE_S = 500;

interface AxisRow {
  readonly status: "measured" | "skipped" | "not-reached";
  readonly reason: string | null;
  readonly ratio: number | null;
  readonly baseMin: number | null;
  readonly baseSamples: readonly number[] | null;
  readonly scaledSamples: readonly number[] | null;
  readonly warmupStable: boolean | null;
  readonly warmupMs: number | null;
  readonly warmupBatches: number | null;
}

/**
 * The placeholder for an axis that produced no report. `scalingGate` builds its report only on the
 * way out, so ANY axis throwing discards BOTH axes' rows — including an axis that already ran and
 * measured cleanly. It does not mean this axis fired, and it does not imply the fire was on a later
 * axis either. The two were conflated in the first cut of this file and the conflation invented a
 * measurement; the name now says only what is known.
 */
const NOT_REACHED: AxisRow = {
  status: "not-reached",
  reason: null,
  ratio: null,
  baseMin: null,
  baseSamples: null,
  scaledSamples: null,
  warmupStable: null,
  warmupMs: null,
  warmupBatches: null,
};

it("records one clean run of the shipped gate", () => {
  const runIndex = Number(process.env["RUN_INDEX"] ?? "0");
  const out = process.env["OUT"];

  const options: ScalingGateOptions<string, ParsedMessage> = {
    name: "false-alarm sweep",
    parse: parseMessage,
    weigh: (parsed) => parsed.segments.length,
    count: { n: COUNT_N, generate: (i) => adtMessage(i) },
    size: { inputs: SIZE_M, size: SIZE_S, generate: (i, size) => oruMessage(i, size) },
    report: () => {},
  };

  let count = NOT_REACHED;
  let size = NOT_REACHED;
  let fired: string | null = null;
  let firedRatio: number | null = null;
  let firedAxis: string | null = null;
  let firedDiagnostic: string | null = null;
  const t0 = performance.now();

  try {
    const report = scalingGate(options);
    for (const axis of [report.count, report.size]) {
      const row: AxisRow =
        axis.status === "measured"
          ? {
              status: "measured",
              reason: null,
              ratio: axis.ratio,
              baseMin: axis.base.min,
              baseSamples: axis.base.samples,
              scaledSamples: axis.scaled.samples,
              warmupStable: axis.warmup.stable,
              warmupMs: Math.round(axis.warmup.elapsedMs),
              warmupBatches: axis.warmup.batches.length,
            }
          : {
              status: "skipped",
              reason: axis.skipReason,
              ratio: null,
              baseMin: axis.base?.min ?? null,
              baseSamples: axis.base?.samples ?? null,
              scaledSamples: axis.scaled?.samples ?? null,
              warmupStable: axis.warmup.stable,
              warmupMs: Math.round(axis.warmup.elapsedMs),
              warmupBatches: axis.warmup.batches.length,
            };
      if (axis.axis === "count") count = row;
      else size = row;
    }
  } catch (error) {
    // A throw is the gate FIRING on a workload that cannot regress — the event this sweep exists to
    // count. `operator` distinguishes the ceiling from the floor from a liveness failure, and
    // `actual` carries the offending ratio: without it a fired run would record only that it fired,
    // and "how far over 8 did a linear workload go" is the whole question.
    const e = error as { operator?: string; actual?: number; message?: string };
    fired = e.operator ?? "unknown";
    firedRatio = typeof e.actual === "number" ? e.actual : null;

    // Which axis fired has to be read out of the diagnostic, and there is no shortcut.
    //
    // The tempting one — "the count axis runs first, so an unmeasured count axis means count fired"
    // — is WRONG, and wrong in the silent direction: `scalingGate` throws, so the loop above never
    // runs, so *neither* axis is ever assigned on a fired run and the test is vacuously true. It
    // would have hard-coded every fire to "count" and this file would have reported an invented
    // attribution as a measurement. The gate's own message names the axis (`describe()` writes
    // "— <axis> axis:"), so parse it, and record `null` rather than guess if the shape ever changes.
    const axisMatch = /— (count|size) axis[:\s]/.exec(e.message ?? "");
    firedAxis = axisMatch?.[1] ?? null;

    // Keep the whole diagnostic. It carries both phases' full sample vectors and the warmup shape
    // for the run that fired — precisely the rows the acceptance clause is about, and the ones the
    // `NOT_REACHED` placeholders above would otherwise throw away. It is PHI-safe by construction: the
    // gate emits sizes, counts, ratios and timings and never echoes input content (ADR 0001 §9).
    firedDiagnostic = e.message ?? null;
  }

  const row = JSON.stringify({
    run: runIndex,
    node: process.versions.node,
    v8: process.versions.v8,
    elapsedMs: Math.round(performance.now() - t0),
    fired,
    firedRatio,
    firedAxis,
    firedDiagnostic,
    count,
    size,
  });
  if (out) appendFileSync(out, `${row}\n`);
  else process.stdout.write(`${row}\n`);

  // Liveness only. The sweep's output is the data, not a verdict.
  expect(typeof row).toBe("string");
}, 600_000);
