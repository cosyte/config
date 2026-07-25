/**
 * PERF-P0 · Experiment C — what a real O(n²) regression actually scores.
 *
 * Experiment A measures where the ratio lands when nothing is wrong. This measures where it lands
 * when something is. Without it the ceiling constant is half-derived: you know the noise floor and
 * you are *assuming* the signal, which is the same species of unbacked constant P0 was created to
 * eliminate (§10/O1).
 *
 * Same host, same estimator, same trial structure as `ratio-calibration.test.ts`, on the size axis
 * (message length is the axis an O(n²) tokenizer blows up on; the count axis at fixed size cannot
 * see it at all). The only change is which parser runs. Sizes are smaller than Experiment A's
 * because the quadratic parser is several times slower at these sizes (~1.4× at S=125, ~3.5× at
 * S=500, and widening) — the ratio is what transfers, not the absolute time.
 *
 * Correctness first: a "regression" that computes something different is not a regression, it is a
 * different program, and its timing would mean nothing. The test asserts the two parsers agree
 * before it times anything.
 *
 * Env inputs: `WARM_TRIALS`, `RUN_INDEX`, `OUT`, `COV`.
 */

import { appendFileSync } from "node:fs";

import { expect, it } from "vitest";

import { parseMessageQuadratic } from "./workload-quadratic.js";
import { oruMessage, parseMessage, sink } from "./workload.js";

/** Messages per phase. Both phases parse the same count, so the ratio isolates length. */
const M = 2;
/**
 * OBX lines in the base phase; the compared phase uses 4×. Ideal linear ratio is still 4.
 *
 * Swept, not fixed, because the first run of this experiment showed the signal is **not** a
 * constant: a quadratic parser only scores near 16 once the quadratic term dominates the linear
 * per-line splitting work, and near the crossover it scores far lower. Which means the fixture size
 * is part of the gate's calibration, and the sweep is how we find out where it stops mattering.
 */
const S = Number(process.env["SIGNAL_S"] ?? "500");
const REPS = 5;

function timeQuadratic(msgs: readonly string[], reps: number): number[] {
  const samples: number[] = [];
  for (let r = 0; r < reps; r++) {
    let local = 0;
    const t0 = performance.now();
    for (const m of msgs) local += parseMessageQuadratic(m).segments.length;
    samples.push(performance.now() - t0);
    sink.value += local;
  }
  return samples;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;
const min = (xs: readonly number[]): number => Math.min(...xs);

it("records what an O(n^2)-in-length regression scores on the same ratio", () => {
  const warmTrials = Number(process.env["WARM_TRIALS"] ?? "1");
  const runIndex = Number(process.env["RUN_INDEX"] ?? "0");
  const out = process.env["OUT"];

  const base = Array.from({ length: M }, (_v, i) => oruMessage(i, S));
  const quad = Array.from({ length: M }, (_v, i) => oruMessage(i, S * 4));

  // The quadratic parser must be a REGRESSION, not a different program.
  for (const m of [base[0], quad[0]]) {
    expect(JSON.stringify(parseMessageQuadratic(m ?? ""))).toBe(
      JSON.stringify(parseMessage(m ?? "")),
    );
  }

  // Same fixed-count warmup shape as Experiment A, scaled to this parser's cost.
  for (let r = 0; r < 3; r++) {
    for (const m of base) sink.value += parseMessageQuadratic(m).segments.length;
  }

  const rows: string[] = [];
  for (let t = 0; t <= warmTrials; t++) {
    const b = timeQuadratic(base, REPS);
    const q = timeQuadratic(quad, REPS);
    rows.push(
      JSON.stringify({
        workload: "quadratic",
        axis: "size",
        baseObx: S,
        coverage: process.env["COV"] === "1",
        node: process.versions.node,
        run: runIndex,
        trial: t,
        phase: t === 0 ? "cold" : "warm",
        base: b.map(round),
        quad: q.map(round),
        // `min` is the estimator ANALYSIS.md §1 recommends for the ratio assertion, so the signal
        // has to be reported on the same estimator the noise floor is compared against.
        ratioMin: round(min(q) / min(b)),
      }),
    );
  }

  if (out) appendFileSync(out, rows.join("\n") + "\n");
  expect(sink.value).toBeGreaterThan(0);
}, 600_000);
