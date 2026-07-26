/**
 * The gate's wiring, end to end, on an injected clock: does a ratio above the ceiling fail, does one
 * below the floor fail, and does an unmeasurable phase skip loudly instead of doing either?
 *
 * Every duration here is arithmetic rather than measurement — see `_clock.ts` for why that is the
 * right substrate for these particular assertions, and why a wall-clock spin is not. The consequence
 * is that these tests are exact, finish in milliseconds, and are immune to whatever else is running
 * on the machine, so they run in the default `pnpm test` (and therefore in `scripts/verify.sh
 * config`) rather than in the timed `pnpm test:perf`.
 *
 * ADR 0001 §6 takes *clock-reading* tests out of the coverage run, because coverage instrumentation
 * lowers an effectful counter into the measured function body at a cost that does not cleanly cancel
 * in a ratio. Nothing here reads the real clock, so nothing here is distorted by it. The one test
 * that genuinely measures — a real parser at a real fixture size — lives in `timed/`.
 */

import { describe, expect, it } from "vitest";

import { PERF_CONTRACT, scalingGate, type ScalingGateOptions } from "../../src/perf/index.js";
import { warmUp } from "../../src/perf/measure.js";
import { costingParse, installFakeClock, type FakeClock } from "./_clock.js";

/** An input carrying the exact fake-millisecond cost of parsing it. */
interface Costed {
  readonly i: number;
  readonly ms: number;
}

/**
 * Options whose count axis is exactly linear (cost is per input, so 4× the inputs is 4× the time)
 * and whose size axis produces exactly the ratio `scaledMs / baseMs`.
 */
function options(
  clock: FakeClock,
  name: string,
  baseMs: number,
  scaledMs: number,
  inputs: number,
  lines: string[],
): ScalingGateOptions<Costed, number> {
  return {
    name,
    parse: costingParse(clock, (input: Costed) => input.ms),
    weigh: (v) => v,
    count: { n: inputs, generate: (i) => ({ i, ms: baseMs }) },
    size: {
      inputs,
      // The size knob is in "units of base cost", so the base phase is generated at `baseMs` and the
      // scaled phase at `baseMs * SCALE_STEP`. What the parse charges for the scaled one is what
      // makes the axis linear or quadratic.
      size: baseMs,
      generate: (i, s) => ({ i, ms: s === baseMs ? baseMs : scaledMs }),
    },
    report: (line) => lines.push(line),
  };
}

describe("scalingGate — the happy path", () => {
  it("measures both axes and reports a ratio inside the band", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // 2 ms per input on the base side, 8 ms on the scaled side of the size axis: an exact ratio of
    // 4 on both axes, the ideal linear result.
    const report = scalingGate(options(clock, "linear", 2, 8, 4, lines));

    expect(report.count.status).toBe("measured");
    expect(report.size.status).toBe("measured");
    expect(report.contract).toBe(PERF_CONTRACT);
    if (report.count.status !== "measured" || report.size.status !== "measured") return;

    // Exact, not approximate: 4 inputs x 2 ms = 8 ms base; 16 inputs x 2 ms = 32 ms scaled.
    expect(report.count.ratio).toBe(4);
    expect(report.count.base.min).toBe(8);
    expect(report.count.scaled.min).toBe(32);
    // Size axis: 4 inputs x 2 ms vs 4 inputs x 8 ms.
    expect(report.size.ratio).toBe(4);
    expect(report.size.base.min).toBe(8);
    expect(report.size.scaled.min).toBe(32);

    for (const axis of [report.count, report.size]) {
      expect(axis.warmup.stable).toBe(true);
      // The FULL sample vector is retained, never pre-reduced (W2's one surviving remedy).
      expect(axis.base.samples).toHaveLength(PERF_CONTRACT.REPS);
      expect(axis.scaled.samples).toHaveLength(PERF_CONTRACT.REPS);
      expect(axis.base.min).toBe(axis.base.median);
    }

    // Phase order and axis shapes.
    expect(report.count.base.inputs).toBe(4);
    expect(report.count.scaled.inputs).toBe(4 * PERF_CONTRACT.SCALE_STEP);
    expect(report.count.base.size).toBeNull();
    expect(report.size.base.inputs).toBe(report.size.scaled.inputs);
    expect(report.size.scaled.size).toBe(2 * PERF_CONTRACT.SCALE_STEP);

    // Nothing was skipped, so nothing reached the skip channel.
    expect(lines).toEqual([]);
    // And the runner really did read the injected clock.
    expect(clock.reads()).toBeGreaterThan(0);
  });

  it("warms once per axis, for at least WARMUP_MIN_MS, and stops when three batches agree", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const report = scalingGate(options(clock, "warmup shape", 2, 8, 4, lines));
    if (report.count.status !== "measured") throw new Error("expected a measured axis");

    const { warmup } = report.count;
    expect(warmup.stable).toBe(true);
    // A constant-cost workload is stable from the third batch, so the rule is bounded below by
    // WARMUP_MIN_MS and stops at the first batch boundary past it.
    expect(warmup.elapsedMs).toBeGreaterThanOrEqual(PERF_CONTRACT.WARMUP_MIN_MS);
    expect(warmup.elapsedMs).toBeLessThan(
      PERF_CONTRACT.WARMUP_MIN_MS + PERF_CONTRACT.WARMUP_BATCH_MS * 2,
    );
    // Batches aggregate whole passes until at least WARMUP_BATCH_MS is timed: 8 ms per pass means
    // 7 passes to reach 50 ms, reported as one 56/7 = 8 ms-per-pass aggregate.
    expect(warmup.batches.every((b) => b === 8)).toBe(true);
  });
});

describe("scalingGate — the ceiling fires on the SIZE axis", () => {
  it("throws when a size-scaling ratio exceeds RATIO_CEILING, after the count axis passed", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // The shape of an O(n²)-in-length tokenizer: 4x the length costs 12.5x the time. The count
    // axis, at fixed input size, sees nothing wrong at all — which is exactly why the size axis is
    // not optional and there is no way to ask for only one.
    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      scalingGate(options(clock, "quadratic-in-length", 2, 25, 4, lines));
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }

    expect(thrown).toBeDefined();
    expect(thrown?.operator).toBe("perf-scaling-ceiling");
    expect(thrown?.actual).toBe(12.5);
    expect(thrown?.message).toContain("size axis");
    expect(thrown?.message).toMatch(/exceeds RATIO_CEILING 8/);
    expect(thrown?.message).toContain("complexity regression");
    // The diagnostic carries the evidence, not just the verdict.
    expect(thrown?.message).toMatch(/samples \[/);
  });

  it("does NOT fire on the count axis for a length-only regression — the structural blind spot", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // Same 12.5x-per-4x cost curve. Read only the count axis, which the ceiling test above proved
    // runs first and passes: at fixed input size a quadratic-in-length parser still scores exactly 4.
    let report;
    try {
      report = scalingGate(options(clock, "count axis blind spot", 2, 25, 4, lines));
    } catch {
      /* the size axis throws; the count axis report is what this test is about */
    }
    expect(report).toBeUndefined();

    // Proved directly instead: with the size axis made linear, the count axis reports a clean 4.
    const clock2 = installFakeClock();
    const clean = scalingGate(options(clock2, "count axis alone", 2, 8, 4, lines));
    expect(clean.count.status).toBe("measured");
    if (clean.count.status !== "measured") return;
    expect(clean.count.ratio).toBe(4);
    expect(clean.count.ratio).toBeLessThan(PERF_CONTRACT.RATIO_CEILING);
  });

  it("fires on the COUNT axis for a regression super-linear in the number of inputs", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const n = 8;
    // An accumulating rescan: parsing input `i` costs more because `i` inputs came before it. Total
    // cost is quadratic in the corpus length, so the 4x step scores far above SCALE_STEP.
    const opts: ScalingGateOptions<Costed, number> = {
      ...options(clock, "accumulating rescan", 2, 8, n, lines),
      parse: costingParse(clock, (input: Costed) => 1 + input.i),
    };

    let thrown: (Error & { operator?: string }) | undefined;
    try {
      scalingGate(opts);
    } catch (error) {
      thrown = error as Error & { operator?: string };
    }
    expect(thrown?.operator).toBe("perf-scaling-ceiling");
    expect(thrown?.message).toContain("count axis");
    // Sum(1..8) = 36 vs Sum(1..32) = 528 -> 14.667, well clear of the ceiling.
    expect((thrown as { actual?: number } | undefined)?.actual).toBe(14.6667);
  });
});

describe("scalingGate — the floor fires", () => {
  it("throws when both phases received the same workload", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // The size axis's generator charges the base cost on both phases, so the scaled phase parses
    // the base phase's workload: a ratio of exactly 1. This is the bug the floor exists to catch —
    // a wrong input size, or a corpus builder returning the same thing twice — and it is
    // deterministic, so it is caught the first time rather than needing luck.
    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      scalingGate(options(clock, "same workload both phases", 2, 2, 4, lines));
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }

    expect(thrown?.operator).toBe("perf-scaling-floor");
    expect(thrown?.actual).toBe(1);
    expect(thrown?.message).toMatch(/under RATIO_FLOOR 1\.5/);
    // The message must not overclaim. The floor does NOT catch dead-code elimination: a count-axis
    // loop with the parse optimized away still runs 4N vs N iterations and stays at ~4.
    expect(thrown?.message).toContain("does NOT catch dead-code elimination");
    expect(thrown?.message).toContain("the two phases received the same workload");
  });

  it("passes at the floor exactly, and fails just under it", () => {
    // RATIO_FLOOR is inclusive: `ratio < FLOOR` fails, so a ratio of exactly 1.5 is allowed.
    const atFloor = installFakeClock();
    const lines: string[] = [];
    const ok = scalingGate(options(atFloor, "at the floor", 2, 3, 4, lines));
    expect(ok.size.status).toBe("measured");
    if (ok.size.status === "measured") expect(ok.size.ratio).toBe(1.5);

    const underFloor = installFakeClock();
    expect(() => scalingGate(options(underFloor, "under the floor", 2, 2.9, 4, lines))).toThrow(
      /under RATIO_FLOOR/,
    );
  });
});

describe("scalingGate — the fail-safe skips", () => {
  it("skips loudly with `phase-too-short` rather than extrapolating below the calibrated regime", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // 3 inputs x 1 ms = a 3 ms base phase, under MIN_PHASE_MS. The fastest base phase in P0's whole
    // 3,200-sample population was 4.14 ms; below that the ceiling is extrapolation, so the gate
    // refuses to answer rather than answering wrongly.
    const report = scalingGate(options(clock, "sub-threshold fixture", 1, 4, 3, lines));

    expect(report.count.status).toBe("skipped");
    if (report.count.status !== "skipped") return;
    expect(report.count.skipReason).toBe("phase-too-short");
    expect(report.count.base?.min).toBe(3);
    // It measured both phases before refusing, so the diagnostic can show what it saw.
    expect(report.count.base?.samples).toHaveLength(PERF_CONTRACT.REPS);
    expect(report.count.scaled?.samples).toHaveLength(PERF_CONTRACT.REPS);

    // Loudly: it reached the report channel, said it is not a pass, and said what to do about it.
    const emitted = lines.join("\n");
    expect(emitted).toContain("A skip is NOT a pass");
    expect(emitted).toContain("below the calibrated regime");
    expect(emitted).toMatch(/MIN_PHASE_MS 4 ms/);
  });

  it("measures rather than skips at exactly MIN_PHASE_MS", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const report = scalingGate(options(clock, "exactly at the threshold", 1, 4, 4, lines));
    expect(report.count.status).toBe("measured");
    if (report.count.status === "measured") expect(report.count.base.min).toBe(4);
  });

  it("skips loudly with `warmup-unstable` when the runtime never reaches steady state", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // A cost that grows 10% per pass can never satisfy "three consecutive batches within +/-5% of
    // their median", so WARMUP_MAX_MS is reached and the gate refuses — without ever timing a phase.
    let cost = 8;
    const report = scalingGate<Costed, number>({
      ...options(clock, "never settles", 2, 8, 4, lines),
      parse: costingParse(clock, () => {
        cost *= 1.1;
        return cost;
      }),
    });

    for (const axis of [report.count, report.size]) {
      expect(axis.status).toBe("skipped");
      if (axis.status !== "skipped") continue;
      expect(axis.skipReason).toBe("warmup-unstable");
      // Never measured anyway: no phase was timed at all.
      expect(axis.base).toBeNull();
      expect(axis.scaled).toBeNull();
      expect(axis.warmup.stable).toBe(false);
      expect(axis.warmup.elapsedMs).toBeGreaterThanOrEqual(PERF_CONTRACT.WARMUP_MAX_MS);
    }
    const emitted = lines.join("\n");
    expect(emitted).toContain("A skip is NOT a pass");
    expect(emitted).toContain("warmup-unstable");
  });

  it("caps an unsettleable warmup at WARMUP_MAX_MS rather than looping forever", () => {
    const clock = installFakeClock();
    let cost = 8;
    const parse = costingParse(clock, () => {
      cost *= 1.1;
      return cost;
    });
    const result = warmUp([{ i: 0, ms: 0 }] as Costed[], parse, () => 1);
    expect(result.stable).toBe(false);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(PERF_CONTRACT.WARMUP_MAX_MS);
    expect(result.batches.length).toBeGreaterThan(PERF_CONTRACT.WARMUP_STABLE_BATCHES);
  });
});

describe("scalingGate — the sink is a liveness check, not decoration", () => {
  it("throws rather than reporting a ratio when nothing reached the sink", () => {
    // `weigh` returning 0 everywhere is the observable form of "the measured loop may have been
    // eliminated". A ratio computed from a deleted loop is confident, fast and meaningless, so the
    // runner refuses to produce one. Turboshaft's dead-code elimination is use-based, which is what
    // makes reading the sink back the structural defence rather than a superstition.
    const clock = installFakeClock();
    const lines: string[] = [];
    let thrown: (Error & { operator?: string }) | undefined;
    try {
      scalingGate<Costed, number>({
        ...options(clock, "empty sink", 2, 8, 4, lines),
        weigh: () => 0,
      });
    } catch (error) {
      thrown = error as Error & { operator?: string };
    }
    expect(thrown?.operator).toBe("perf-sink-liveness");
    expect(thrown?.message).toContain("the sink never moved");
    expect(thrown?.message).toContain("Supply `weigh`");
  });
});

describe("scalingGate — every diagnostic names its own axis", () => {
  // The gate runs two axes and throws from whichever one trips, so the axis name in the message is
  // the ONLY thing that says which. Anything reading the outcome after the fact — a CI log, a
  // developer, or `experiments/perf-p2-false-alarm/`, which parses it to attribute a false alarm —
  // depends on that. It is asserted here rather than assumed because the alternative inference
  // ("the count axis runs first, so an unreported count axis must be the one that fired") is
  // wrong in the silent direction: a throw means NEITHER axis was reported.
  it.each([
    { kind: "count" as const, expected: "count" },
    { kind: "size" as const, expected: "size" },
  ])("names the $kind axis when the $kind axis fires", ({ kind, expected }) => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const base = options(clock, "axis naming", 2, 25, 8, lines);
    const opts: ScalingGateOptions<Costed, number> =
      kind === "count"
        ? { ...base, parse: costingParse(clock, (input: Costed) => 1 + input.i) }
        : base;

    let message = "";
    try {
      scalingGate(opts);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(/— (count|size) axis[:\s]/.exec(message)?.[1]).toBe(expected);
  });

  it("names the axis on a loud skip too", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    scalingGate(options(clock, "axis naming on skip", 1, 4, 3, lines));
    expect(/— (count|size) axis[:\s]/.exec(lines[0] ?? "")?.[1]).toBe("count");
  });
});

describe("scalingGate — PHI", () => {
  it("never echoes input content in a skip or a failure diagnostic", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const secret = "PATIENT-IDENTIFIER-DO-NOT-ECHO";
    const opts: ScalingGateOptions<{ i: number; ms: number; raw: string }, number> = {
      name: "phi discipline",
      parse: costingParse(clock, (input) => input.ms),
      weigh: (v) => v,
      count: { n: 4, generate: (i) => ({ i, ms: 2, raw: secret }) },
      size: { inputs: 4, size: 2, generate: (i, s) => ({ i, ms: s === 2 ? 2 : 25, raw: secret }) },
      report: (line) => lines.push(line),
    };

    let thrown: Error | undefined;
    try {
      scalingGate(opts);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect([thrown?.message ?? "", ...lines].join("\n")).not.toContain(secret);
    // It still says enough to act on.
    expect(thrown?.message).toContain("4 input(s)");
  });
});
