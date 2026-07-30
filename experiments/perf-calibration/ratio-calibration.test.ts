/**
 * PERF-P0 · Experiment A: the empirical distribution of the 4N-vs-N ratio.
 *
 * Produces the two constants the kit cannot get from any published source (roadmap §10/O1): the
 * **ratio ceiling** and the **ratio floor**. It does that by running a workload that is linear by
 * construction (`workload.ts`) many times and recording where the ratio actually lands, so the
 * ceiling is set from a measured false-alarm distribution rather than from judgement.
 *
 * ## Why this file is a vitest test and not a script
 *
 * The gate it calibrates will live in vitest, so the calibration has to be hosted the same way or it
 * measures the wrong thing. Two of the confirmed hazards only exist inside this host:
 *   - **V1**: `@vitest/coverage-v8` turns on V8's `kBlockCount` precise coverage, which compiles an
 *     effectful counter increment into the measured function body in every tier. Its cost scales with
 *     executed-block count and density, so it is *not* guaranteed to cancel in a ratio. Magnitude
 *     unmeasured; the `--coverage` leg of this experiment is what settles it.
 *   - **V4**: Vite's SSR transform rewrites cross-module imports into namespace property accesses,
 *     which Vitest's own guide warns can dominate a hot loop. `hl7`'s gate imports `../../src/index.js`
 *     and so measures transformed code; importing `./workload.js` here reproduces that faithfully.
 *
 * ## What one process contributes
 *
 * A real gate runs **once**, in a fresh fork, right after a bounded warmup. So the distribution that
 * matters is the distribution of *first* ratios in fresh processes, not the steady-state noise of a
 * long-running loop. Each invocation of this file therefore contributes:
 *   - one **cold** ratio: the first trial after an `hl7`-shaped fixed-count warmup, which is exactly
 *     what CI sees; and
 *   - `WARM_TRIALS` **warm** ratios from the same process, which characterise the steady-state noise
 *     floor once V8 has settled.
 * The sweep in `run.sh` launches this file many times so the cold samples are genuinely independent.
 *
 * ## Why both orderings
 *
 * C5 is the one confound a same-process ratio does *not* cancel: the N phase can warm, tier up or
 * deoptimize the code the 4N phase then measures. Running `N→4N` and `4N→N` and comparing the two
 * distributions is what bounds that effect. If ordering does not move the distribution, C5 is small
 * here; if it does, the kit has to randomize or interleave.
 *
 * Env inputs: `CELL` (`count:NF` | `count:FN` | `size:NF` | `size:FN`), `WARM_TRIALS`, `RUN_INDEX`,
 * `OUT` (JSONL file appended to). No assertions beyond liveness. This is an experiment, not a gate.
 */

import { appendFileSync } from "node:fs";

import { expect, it } from "vitest";

import { adtMessage, oruMessage, parseMessage, sink, timePhase } from "./workload.js";

/** Reps per phase. Matches `hl7`'s shipped gate so the constants transfer to the thing they gate. */
const REPS = 5;
/** Messages in the base phase of the count axis; the compared phase parses 4×. Mirrors `hl7`. */
const COUNT_N = 1_000;
/** Messages per phase on the size axis (equal on both sides, so the ratio isolates length). */
const SIZE_M = 10;
/** OBX lines in the base phase of the size axis; the compared phase uses 4×. Mirrors `hl7`. */
const SIZE_S = 500;

type Axis = "count" | "size";
type Ordering = "NF" | "FN";

interface Phases {
  /** Full sample vector, ms, for the 1× phase. Never pre-reduced (W2). */
  readonly base: number[];
  /** Full sample vector, ms, for the 4× phase. */
  readonly quad: number[];
}

function min(xs: readonly number[]): number {
  return Math.min(...xs);
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

/** Mean after discarding one sample from each tail: criterion.rs/pyperf's shape, not min-of-N. */
function trimmedMean(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const kept = s.length > 2 ? s.slice(1, -1) : s;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

const ESTIMATORS = { min, median, trimmedMean, mean } as const;

/** Build the two message arrays for an axis. Built once, outside every timed region. */
function buildCorpus(axis: Axis): { base: string[]; quad: string[] } {
  if (axis === "count") {
    return {
      base: Array.from({ length: COUNT_N }, (_v, i) => adtMessage(i)),
      quad: Array.from({ length: COUNT_N * 4 }, (_v, i) => adtMessage(i)),
    };
  }
  return {
    base: Array.from({ length: SIZE_M }, (_v, i) => oruMessage(i, SIZE_S)),
    quad: Array.from({ length: SIZE_M }, (_v, i) => oruMessage(i, SIZE_S * 4)),
  };
}

/**
 * `hl7`'s beforeAll warmup, reproduced exactly: a fixed ~2,100 invocations. W1 says a fixed count
 * cannot reach steady state (the effective TurboFan budget is 16,000 interrupt units scaled by
 * bytecode length), so this is deliberately the *inadequate* warmup the shipped gate uses: the
 * cold-vs-warm gap this experiment records is the size of that inadequacy.
 */
function hl7ShapedWarmup(): void {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 500; i++) sink.value += parseMessage(adtMessage(i)).segments.length;
    for (let i = 0; i < 200; i++) sink.value += parseMessage(oruMessage(i)).segments.length;
    sink.value += parseMessage(oruMessage(0, 2_000)).segments.length;
  }
}

function runTrial(corpus: { base: string[]; quad: string[] }, ordering: Ordering): Phases {
  if (ordering === "NF") {
    const base = timePhase(corpus.base, REPS);
    const quad = timePhase(corpus.quad, REPS);
    return { base, quad };
  }
  const quad = timePhase(corpus.quad, REPS);
  const base = timePhase(corpus.base, REPS);
  return { base, quad };
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

it("records the 4N-vs-N ratio distribution for one cell", () => {
  const cell = process.env["CELL"] ?? "count:NF";
  const [axisRaw, orderingRaw] = cell.split(":");
  const axis: Axis = axisRaw === "size" ? "size" : "count";
  const ordering: Ordering = orderingRaw === "FN" ? "FN" : "NF";
  const warmTrials = Number(process.env["WARM_TRIALS"] ?? "7");
  const runIndex = Number(process.env["RUN_INDEX"] ?? "0");
  const out = process.env["OUT"];

  const corpus = buildCorpus(axis);
  hl7ShapedWarmup();

  const rows: string[] = [];
  for (let t = 0; t <= warmTrials; t++) {
    const phases = runTrial(corpus, ordering);
    const ratios: Record<string, number> = {};
    for (const [name, est] of Object.entries(ESTIMATORS)) {
      ratios[name] = round(est(phases.quad) / est(phases.base));
    }
    rows.push(
      JSON.stringify({
        axis,
        ordering,
        coverage: process.env["COV"] === "1",
        node: process.versions.node,
        run: runIndex,
        trial: t,
        // Trial 0 is the only one a real gate would ever see: first measurement after warmup.
        phase: t === 0 ? "cold" : "warm",
        base: phases.base.map(round),
        quad: phases.quad.map(round),
        ratios,
      }),
    );
  }

  if (out) appendFileSync(out, rows.join("\n") + "\n");
  // Liveness only: proves the parse actually ran and was not eliminated.
  expect(sink.value).toBeGreaterThan(0);
}, 600_000);
