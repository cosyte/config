/**
 * Self-sizing, on an injected clock: the gate repeats each phase's corpus until the base phase
 * reaches a target, runs the scaled phase the same number of times, and reports the count it chose.
 *
 * Why it exists: a fixture sized by hand to clear `MIN_PHASE_MS` on one runner reads under it on a
 * faster one, and every parser speedup shrinks it again. The gate then skips `phase-too-short`, and a
 * skip is not a pass. Self-sizing moves the base phase above the floor by repetition, which leaves
 * the ratio alone: `k` passes over the scaled corpus against `k` passes over the base corpus is the
 * same ratio as one against one.
 *
 * What it must not do, each asserted below: change a gate that has not opted in, hide a ratio above
 * the ceiling or under the floor, or turn a phase that cannot reach the floor into a pass.
 *
 * Every duration is arithmetic: see `_clock.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  PERF_CONTRACT,
  SELF_SIZE_TARGET_MS,
  assertScalingGateFires,
  scalingGate,
  type ScalingGateOptions,
} from "../../src/perf/index.js";
import { MAX_PHASE_PASSES, choosePasses, perfSink, timePhase } from "../../src/perf/measure.js";
import { costingParse, installFakeClock, type FakeClock } from "./_clock.js";

interface Costed {
  readonly i: number;
  readonly ms: number;
}

/**
 * One input per phase on the size axis and one (against four) on the count axis, each costing
 * `baseMs`, with the size axis's scaled input costing `scaledMs`. At `baseMs` under 4 ms this is the
 * fixture the gate without self-sizing skips on: the base phase is a single sub-floor parse.
 */
function tiny(
  clock: FakeClock,
  baseMs: number,
  scaledMs: number,
  lines: string[],
  selfSize?: ScalingGateOptions<Costed, number>["selfSize"],
): ScalingGateOptions<Costed, number> {
  return {
    name: "tiny fixture",
    parse: costingParse(clock, (input: Costed) => input.ms),
    weigh: (v) => v,
    count: { n: 1, generate: (i) => ({ i, ms: baseMs }) },
    size: {
      inputs: 1,
      size: 1,
      generate: (i, s) => ({ i, ms: s === 1 ? baseMs : scaledMs }),
    },
    report: (line) => lines.push(line),
    ...(selfSize === undefined ? {} : { selfSize }),
  };
}

/** The cost of an input is the `ms` it carries. */
const ms = (input: Costed): number => input.ms;

/**
 * Calls a one-input corpus at 1 ms a pass takes to warm: 50-pass batches, stable from the third,
 * and the rule may fire only once 500 ms have passed, so ten batches.
 */
const WARMUP_CALLS = 500;

/**
 * A parse that costs 1 ms for its first `warmCalls` calls and nothing afterwards. A parse that
 * costs nothing from the start cannot be warmed on a fake clock at all, since a warmup batch runs
 * until 50 ms have passed, so this is how a test reaches a phase that no count of passes can lift
 * over the floor.
 */
function warmThenFree<T>(clock: FakeClock, warmCalls: number): (input: T) => number {
  let calls = 0;
  return costingParse(clock, () => (calls++ < warmCalls ? 1 : 0));
}

describe("self-sizing: the tiny fixture the gate used to skip", () => {
  it("is skipped `phase-too-short` without self-sizing: the defect, unchanged by default", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const report = scalingGate(tiny(clock, 0.5, 2, lines));

    expect(report.count.status).toBe("skipped");
    expect(report.size.status).toBe("skipped");
    if (report.count.status !== "skipped") return;
    expect(report.count.skipReason).toBe("phase-too-short");
    // One pass per rep, as before: a gate that has not opted in measures exactly what it did.
    expect(report.count.base?.passes).toBe(1);
    expect(report.count.base?.min).toBe(0.5);
    // And its diagnostic says nothing about self-sizing.
    expect(lines.join("\n")).not.toContain("self-sized");
    expect(lines.join("\n")).not.toContain("passes per rep");
    expect(report.count.diagnostic).toContain(
      "under MIN_PHASE_MS 4 ms, so the ceiling would be extrapolation. This fixture",
    );
    // Every line after the headline is an indented detail: nothing empty was pushed in.
    for (const line of report.count.diagnostic.split("\n").slice(1)) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  it("is measured with self-sizing, at the default target, with the ratio unchanged", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const report = scalingGate(tiny(clock, 0.5, 2, lines, true));

    expect(report.count.status).toBe("measured");
    expect(report.size.status).toBe("measured");
    if (report.count.status !== "measured" || report.size.status !== "measured") return;

    // 0.5 ms a pass, 20 ms wanted: 40 passes, on the base phase AND the scaled phase.
    expect(SELF_SIZE_TARGET_MS).toBe(20);
    for (const axis of [report.count, report.size]) {
      expect(axis.diagnostic.split("\n")[0]).toBe(
        `[@cosyte/test-utils/perf] tiny fixture: ${axis.axis} axis: measured`,
      );
      expect(axis.base.phase).toBe("base");
      expect(axis.scaled.phase).toBe("scaled");
      expect(axis.base.passes).toBe(40);
      expect(axis.scaled.passes).toBe(40);
      expect(axis.base.min).toBe(20);
      expect(axis.scaled.min).toBe(80);
      // Exactly the ratio one pass against one pass would have given.
      expect(axis.ratio).toBe(4);
      // The count it chose is in the diagnostic, so a CI log shows it.
      expect(axis.diagnostic).toContain(
        "\n  self-sized: 40 passes per rep (target 20 ms on the base phase; the scaled phase runs " +
          "the same count, so the ratio is unchanged)\n",
      );
    }
    // Inputs are per pass and unchanged: repetition is not a bigger corpus.
    expect(report.count.base.inputs).toBe(1);
    expect(report.count.scaled.inputs).toBe(PERF_CONTRACT.SCALE_STEP);
    expect(lines).toEqual([]);
  });

  it("takes a target of the caller's own, no lower than the floor", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const report = scalingGate(tiny(clock, 0.5, 2, lines, { targetMs: 50 }));
    if (report.size.status !== "measured") throw new Error("expected a measured axis");
    expect(report.size.base.passes).toBe(100);
    expect(report.size.base.min).toBe(50);
    expect(report.size.diagnostic).toContain("target 50 ms");

    const at = installFakeClock();
    const atFloor = scalingGate(tiny(at, 0.5, 2, lines, { targetMs: PERF_CONTRACT.MIN_PHASE_MS }));
    if (atFloor.size.status !== "measured") throw new Error("expected a measured axis");
    expect(atFloor.size.base.passes).toBe(8);
  });

  it.each([3.99, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a target of %s: under the floor, or not a number of milliseconds",
    (targetMs) => {
      const clock = installFakeClock();
      expect(() => scalingGate(tiny(clock, 0.5, 2, [], { targetMs }))).toThrow(
        /selfSize\.targetMs must be a finite number of milliseconds of at least MIN_PHASE_MS 4/,
      );
    },
  );

  it("runs one pass a rep when the base phase already reaches the target", () => {
    const clock = installFakeClock();
    const report = scalingGate(tiny(clock, 25, 100, [], true));
    if (report.size.status !== "measured") throw new Error("expected a measured axis");
    expect(report.size.base.passes).toBe(1);
    expect(report.size.ratio).toBe(4);
  });

  it("explicit `selfSize: false` is the default", () => {
    const clock = installFakeClock();
    const report = scalingGate(tiny(clock, 0.5, 2, [], false));
    expect(report.size.status).toBe("skipped");
  });
});

describe("self-sizing keeps the ceiling, the floor and the fail-safe", () => {
  it("still throws on a ratio above RATIO_CEILING: repetition does not dilute a quadratic", () => {
    const clock = installFakeClock();
    // 0.5 ms base, 6.25 ms at 4 times the size: the 12.5 shape of a quadratic in length.
    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      scalingGate(tiny(clock, 0.5, 6.25, [], true));
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }
    expect(thrown?.operator).toBe("perf-scaling-ceiling");
    expect(thrown?.actual).toBe(12.5);
    expect(thrown?.message).toContain("size axis");
    expect(thrown?.message).toContain("self-sized: 40 passes per rep");
  });

  it("still throws under RATIO_FLOOR when both phases received the same workload", () => {
    const clock = installFakeClock();
    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      scalingGate(tiny(clock, 0.5, 0.5, [], true));
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }
    expect(thrown?.operator).toBe("perf-scaling-floor");
    expect(thrown?.actual).toBe(1);
  });

  it("still skips `phase-too-short` when no count of passes reaches the floor", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    // The count axis's parse costs 1 ms a pass while it warms and nothing after: the cap on passes
    // is reached and the base phase is still 0 ms. The size axis is an ordinary 25 ms input.
    const free = warmThenFree(clock, WARMUP_CALLS);
    const report = scalingGate<Costed, number>({
      ...tiny(clock, 25, 100, lines, true),
      parse: (input) => (input.ms === 0 ? free(input) : costingParse(clock, ms)(input)),
      count: { n: 1, generate: (i) => ({ i, ms: 0 }) },
    });
    expect(report.count.warmup.passes).toBe(WARMUP_CALLS);
    expect(report.count.status).toBe("skipped");
    expect(report.size.status).toBe("measured");
    if (report.count.status !== "skipped") return;
    expect(report.count.skipReason).toBe("phase-too-short");
    expect(report.count.base?.passes).toBe(MAX_PHASE_PASSES);
    expect(report.count.base?.min).toBe(0);
    const emitted = lines.join("\n");
    expect(emitted).toContain("A skip is NOT a pass");
    expect(emitted).toContain(`even at ${String(MAX_PHASE_PASSES)} passes per rep`);
  });
});

describe("choosePasses", () => {
  it("lands on the smallest count that reaches the target when the cost is exact", () => {
    const clock = installFakeClock();
    let calls = 0;
    const parse = costingParse(clock, (ms: number) => {
      calls++;
      return ms;
    });
    expect(choosePasses([0.25], parse, () => 1, 20)).toBe(80);
    // One pass to estimate from, then the 80 it estimated: no creeping up a pass at a time.
    expect(calls).toBe(1 + 80);
    expect(choosePasses([0.25, 0.25], parse, () => 1, 20)).toBe(40);
    expect(choosePasses([30], parse, () => 1, 20)).toBe(1);
  });

  it("grows by at least one pass when its estimate falls short", () => {
    // The first pass costs 1 ms and every later one 0.5 ms, so the estimate made from the first
    // pass (20) is short of the target (10.5 ms) and the next round has to grow past it.
    const clock = installFakeClock();
    let calls = 0;
    const parse = costingParse(clock, () => (calls++ === 0 ? 1 : 0.5));
    const passes = choosePasses([0], parse, () => 1, 20);
    expect(passes).toBeGreaterThan(20);
    expect(passes * 0.5).toBeGreaterThanOrEqual(20);
  });

  it("doubles while a pass reads as no time, then estimates from the first round that does", () => {
    // Calls 0 to 2 cost nothing: one pass, then two, read 0 ms. The third round (four passes) costs
    // 2 ms, so the estimate is 4 x 20 / 2 = 40 passes, which reach the target exactly.
    const clock = installFakeClock();
    let calls = 0;
    const parse = costingParse(clock, () => (calls++ < 3 ? 0 : 0.5));
    expect(choosePasses([0], parse, () => 1, 20)).toBe(40);
  });

  it("doubles when a pass reads as no time at all, and stops at the cap", () => {
    const clock = installFakeClock();
    const parse = costingParse(clock, () => 0);
    expect(choosePasses([0], parse, () => 1, 20)).toBe(MAX_PHASE_PASSES);
  });

  it("grows past an estimate that floating point rounds down to the current count", () => {
    // Target 7.3 ms. Round 1: one pass of 0.171875 ms, so the estimate is ceil(7.3 / 0.171875) = 43.
    // Round 2: 43 passes read 7.299999999999999 ms, just under the target, and
    // ceil(43 * 7.3 / 7.299999999999999) is 43 itself. Only the one-pass floor moves the count on,
    // to 44. Round 3: the 44th pass is the one that costs time, so 44 reaches the target and 43
    // would not. Without the floor the count stays at 43 and never reaches the target.
    const clock = installFakeClock(-0.171875);
    let calls = 0;
    const parse = costingParse(clock, () => {
      const call = calls++;
      if (call === 0) return 0.171875;
      if (call === 1) return 7.299999999999999;
      return call === 1 + 43 + 43 ? 8 : 0;
    });
    expect(Math.ceil((43 * 7.3) / 7.299999999999999)).toBe(43);
    expect(choosePasses([0], parse, () => 1, 7.3)).toBe(44);
    expect(calls).toBe(1 + 43 + 44);
  });

  it("returns 1 without timing anything when there is no target", () => {
    const clock = installFakeClock();
    let calls = 0;
    const parse = costingParse(clock, () => {
      calls++;
      return 1;
    });
    expect(choosePasses([0, 0], parse, () => 1, null)).toBe(1);
    expect(calls).toBe(0);
  });

  it("feeds the sink, so the calibration loop cannot be eliminated either", () => {
    const clock = installFakeClock();
    const before = perfSink.value;
    choosePasses(
      [1],
      costingParse(clock, (ms: number) => ms),
      () => 1,
      4,
    );
    expect(perfSink.value - before).toBe(1 + 4);
  });
});

describe("timePhase with passes", () => {
  it("times every pass in each rep and sums every result into the sink", () => {
    const clock = installFakeClock();
    const before = perfSink.value;
    const samples = timePhase(
      [0.5, 0.5],
      costingParse(clock, (ms: number) => ms),
      () => 1,
      3,
    );
    // 3 passes over 2 inputs at 0.5 ms: 3 ms a rep, and 6 results a rep into the sink.
    expect(samples).toEqual(Array.from({ length: PERF_CONTRACT.REPS }, () => 3));
    expect(perfSink.value - before).toBe(PERF_CONTRACT.REPS * 6);
  });
});

describe("self-sizing in the self-check", () => {
  interface Sized {
    readonly i: number;
    readonly size: number;
  }

  /**
   * A clean parse at `perUnit` ms per size unit (by default 0.1: 1 ms at the base size of 10, under
   * the floor), one input on the count axis and two on the size axis, so the two axes need
   * different counts of passes.
   */
  function sized(
    clock: FakeClock,
    selfSize?: true,
    perUnit = 0.1,
  ): ScalingGateOptions<Sized, number> {
    return {
      name: "self-check subject",
      parse: costingParse(clock, (input: Sized) => input.size * perUnit),
      weigh: (v) => v,
      count: { n: 1, generate: (i) => ({ i, size: 10 }) },
      size: { inputs: 2, size: 10, generate: (i, size) => ({ i, size }) },
      report: () => undefined,
      ...(selfSize === undefined ? {} : { selfSize }),
    };
  }

  /** The regression: 2 ms at the base size and `2 * ratio` at 4 times it. */
  const regressed = (clock: FakeClock, ratio: number) =>
    costingParse(clock, (input: Sized) => (input.size === 10 ? 2 : 2 * ratio));

  it("without self-sizing, fails the precondition on the tiny clean phase", () => {
    const clock = installFakeClock();
    let thrown: Error | undefined;
    try {
      assertScalingGateFires(sized(clock), {
        regressedParse: regressed(clock, 12),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain("CLEAN base phase measured 1 ms, under");
    expect(thrown?.message).not.toContain("passes per rep");
  });

  it("without self-sizing, passes as before: one pass a rep and no sizing in the diagnostic", () => {
    const clock = installFakeClock();
    // 0.4 ms a unit: 4 ms at the base size, exactly the floor.
    const report = assertScalingGateFires(sized(clock, undefined, 0.4), {
      regressedParse: costingParse(clock, (input: Sized) => (input.size === 10 ? 4 : 48)),
      equals: () => true,
    });
    expect(report.signal).toBe(12);
    expect(report.passes).toBe(1);
    expect(report.cleanPasses).toEqual({ count: 1, size: 1 });
    expect(report.diagnostic).not.toContain("self-sized");
    expect(report.diagnostic).not.toContain("passes per rep");
  });

  it("without self-sizing, a regressed phase under the floor names no count of passes", () => {
    const clock = installFakeClock();
    let thrown: Error | undefined;
    try {
      assertScalingGateFires(sized(clock, undefined, 0.4), {
        // 1 ms a regressed input, 2 ms the size axis's base phase: under the floor.
        regressedParse: costingParse(clock, (input: Sized) => (input.size === 10 ? 1 : 12)),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain("regressed base phase measured 2 ms, under");
  });

  it("with self-sizing, sizes the clean and the regressed phases and reports both counts", () => {
    const clock = installFakeClock();
    const report = assertScalingGateFires(sized(clock, true), {
      regressedParse: regressed(clock, 12),
      equals: () => true,
    });
    expect(report.signal).toBe(12);
    // Clean: 1 ms a pass on the count axis (one input), 2 ms on the size axis (two).
    expect(report.cleanPasses).toEqual({ count: 20, size: 10 });
    expect(report.cleanBaseMinMs).toEqual({ count: 20, size: 20 });
    // Regressed: two inputs at 2 ms, so 4 ms a pass and 5 passes; 5 x 2 x 24 ms scaled.
    expect(report.passes).toBe(5);
    expect(report.samples.base[0]).toBe(20);
    expect(report.samples.scaled[0]).toBe(240);
    expect(report.diagnostic).toContain("\n  self-sized: 5 passes per rep (target 20 ms");
    expect(report.diagnostic).toContain(
      "\n  clean self-sized: 20 (count) / 10 (size) passes per rep",
    );
  });

  it("with self-sizing, still fails a quadratic whose signal does not clear the ceiling", () => {
    // Repetition lifts a phase over the floor; it does not lift a signal over the ceiling. The
    // signal climbs only with the size of each input, so a fixture too small to show it still fails.
    const clock = installFakeClock();
    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      assertScalingGateFires(sized(clock, true), {
        regressedParse: regressed(clock, 6),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }
    expect(thrown?.operator).toBe("perf-self-check");
    expect(thrown?.actual).toBe(6);
    expect(thrown?.message).toContain("does not clear");
  });

  it("with self-sizing, still fails when the clean phase cannot reach the floor", () => {
    const clock = installFakeClock();
    // The equality check calls the clean parse twice before the count axis warms.
    const opts: ScalingGateOptions<Sized, number> = {
      ...sized(clock, true),
      parse: warmThenFree(clock, 2 + WARMUP_CALLS),
    };
    let thrown: (Error & { actual?: number }) | undefined;
    try {
      assertScalingGateFires(opts, { regressedParse: regressed(clock, 12), equals: () => true });
    } catch (error) {
      thrown = error as Error & { actual?: number };
    }
    expect(thrown?.message).toContain("precondition on the count axis");
    expect(thrown?.message).toContain(`even at ${String(MAX_PHASE_PASSES)} passes per rep`);
    expect(thrown?.actual).toBe(0);
  });

  it("with self-sizing, still fails when the regressed phase cannot reach the floor", () => {
    const clock = installFakeClock();
    // Two calls for the equality check, then the regressed warmup.
    let thrown: Error | undefined;
    try {
      assertScalingGateFires(sized(clock, true), {
        regressedParse: warmThenFree(clock, 2 + WARMUP_CALLS),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toContain("regressed base phase measured 0 ms");
    expect(thrown?.message).toContain(`even at ${String(MAX_PHASE_PASSES)} passes per rep`);
  });
});
