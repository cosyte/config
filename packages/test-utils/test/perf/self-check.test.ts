/**
 * The self-check's decision logic, on an injected clock.
 *
 * `assertScalingGateFires` is the mechanism that turns `RATIO_CEILING` from a global constant into a
 * per-package guarantee, so *every* way it can refuse matters as much as the way it passes. Those
 * are decisions about arithmetic and ordering, not about a workload, so they are driven here with
 * exact fake-millisecond costs — see `_clock.ts`.
 *
 * The one thing that cannot be faked is whether a *real* O(n²) parser at a *real* fixture size
 * clears the ceiling on a real clock. That is the roadmap's load-bearing acceptance clause for
 * PERF-P2 and it lives in `timed/self-check.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  PERF_CONTRACT,
  assertScalingGateFires,
  type ScalingGateOptions,
} from "../../src/perf/index.js";
import { costingParse, installFakeClock, type FakeClock } from "./_clock.js";

interface Costed {
  readonly i: number;
  readonly size: number;
}

/**
 * A gate fixture on the size axis. The clean parse costs `cleanPerUnit` per size unit; the injected
 * regression costs `regressedPerUnit` per size unit **squared over the base**, which is what makes
 * its ratio differ from the clean 4.
 */
function fixture(
  clock: FakeClock,
  opts: { inputs: number; size: number; cleanPerUnit: number },
  lines: string[],
): ScalingGateOptions<Costed, number> {
  return {
    name: "self-check subject",
    parse: costingParse(clock, (input: Costed) => input.size * opts.cleanPerUnit),
    weigh: (v) => v,
    count: { n: opts.inputs, generate: (i) => ({ i, size: opts.size }) },
    size: { inputs: opts.inputs, size: opts.size, generate: (i, size) => ({ i, size }) },
    report: (line) => lines.push(line),
  };
}

/** A regression costing `k * size^exponentish`: pick the per-unit cost to hit an exact ratio. */
function regressionWithRatio(clock: FakeClock, base: number, ratio: number) {
  // base phase: size S costs `c`; scaled phase: size 4S costs `c * ratio`. Charged per input, so the
  // phase ratio is exactly `ratio` regardless of how many inputs there are.
  return costingParse(clock, (input: Costed) => (input.size === base ? 20 : 20 * ratio));
}

describe("assertScalingGateFires — the signal side", () => {
  it("passes and reports the margin when the injected regression clears the ceiling", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts = fixture(clock, { inputs: 4, size: 10, cleanPerUnit: 0.2 }, lines);

    const report = assertScalingGateFires(opts, {
      regressedParse: regressionWithRatio(clock, 10, 12),
      equals: () => true,
    });

    expect(report.signal).toBe(12);
    expect(report.margin).toBe(1.5);
    expect(report.axis).toBe("size");
    expect(report.baseSize).toBe(10);
    expect(report.inputs).toEqual([4, 4]);
    expect(report.samples.base).toHaveLength(PERF_CONTRACT.REPS);
    // The clean precondition was measured and recorded on BOTH axes: 4 inputs x 10 units x 0.2 = 8 ms
    // on each (the count axis's inputs are generated at the same size knob).
    expect(report.cleanBaseMinMs).toEqual({ count: 8, size: 8 });
    expect(lines.join("\n")).toContain("signal 12");
  });

  it("FAILS the build when the signal does not clear the ceiling", () => {
    // ADR 0001 §5's whole point: the signal a real quadratic produces is not a constant, it climbs
    // with fixture size. Below the ceiling the gate cannot fail, so it would read green while
    // broken — and the self-check is what converts that into a build failure at adoption.
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts = fixture(clock, { inputs: 4, size: 10, cleanPerUnit: 0.2 }, lines);

    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      assertScalingGateFires(opts, {
        regressedParse: regressionWithRatio(clock, 10, 6),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }

    expect(thrown?.operator).toBe("perf-self-check");
    expect(thrown?.actual).toBe(6);
    expect(thrown?.message).toContain("does not clear");
    expect(thrown?.message).toContain("read green while blind");
    // The remedy it names is the correct one. Raising the ceiling would "fix" the failure by
    // deleting the guarantee.
    expect(thrown?.message).toContain("GROW the fixture, never to raise the ceiling");
  });

  it("requires the signal to clear the ceiling strictly, not merely reach it", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts = fixture(clock, { inputs: 4, size: 10, cleanPerUnit: 0.2 }, lines);
    expect(() =>
      assertScalingGateFires(opts, {
        regressedParse: regressionWithRatio(clock, 10, PERF_CONTRACT.RATIO_CEILING),
        equals: () => true,
      }),
    ).toThrow(/does not clear/);
  });
});

describe("assertScalingGateFires — the precondition side", () => {
  it("FAILS when the CLEAN parse is too fast to measure, even though the regressed one is not", () => {
    // The asymmetry that makes this check necessary, and the defect it closes. The regressed parse
    // is several times SLOWER than the real one, so a fixture on which the real gate would skip
    // `phase-too-short` on every single run can still give the self-check's own phases a comfortable
    // multi-millisecond base. Without checking the clean side, a package could pass here and ship a
    // permanently-skipping gate — green while blind, the exact outcome ADR 0001 §2 claims this makes
    // structurally impossible. It only is if the clean side is checked too.
    const clock = installFakeClock();
    const lines: string[] = [];
    // Clean: 2 inputs x 10 units x 0.1 = 2 ms, under MIN_PHASE_MS. Regressed: 2 x 20 = 40 ms, well
    // over it — so the signal side alone would have been perfectly happy.
    const opts = fixture(clock, { inputs: 2, size: 10, cleanPerUnit: 0.1 }, lines);

    let thrown: (Error & { operator?: string; actual?: number }) | undefined;
    try {
      assertScalingGateFires(opts, {
        regressedParse: regressionWithRatio(clock, 10, 12),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error & { operator?: string; actual?: number };
    }

    expect(thrown?.operator).toBe("perf-self-check");
    expect(thrown?.actual).toBe(2);
    expect(thrown?.message).toContain("CLEAN base phase");
    expect(thrown?.message).toMatch(/MIN_PHASE_MS 4 ms/);
    expect(thrown?.message).toContain("Grow this axis's fixture");
    // It names WHICH axis, and it caught the count axis — the one the size-axis injection never
    // touches. That is the second half of the guarantee: the gate asserts both axes, so a
    // precondition that only covered the injection's axis would let a package ship an axis that
    // skips on every run.
    expect(thrown?.message).toContain("precondition on the count axis");
    expect(thrown?.message).toContain("The real gate asserts BOTH axes");
  });

  it("checks the precondition on the size axis too, not only the count axis", () => {
    // Count axis healthy (8 inputs x 10 units x 0.2 = 16 ms), size axis starved (its `inputs` is
    // what differs), so the failure must come from the size axis specifically.
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts: ScalingGateOptions<Costed, number> = {
      ...fixture(clock, { inputs: 8, size: 10, cleanPerUnit: 0.2 }, lines),
      size: { inputs: 1, size: 10, generate: (i, size) => ({ i, size }) },
    };

    let thrown: (Error & { actual?: number }) | undefined;
    try {
      assertScalingGateFires(opts, {
        regressedParse: regressionWithRatio(clock, 10, 12),
        equals: () => true,
      });
    } catch (error) {
      thrown = error as Error & { actual?: number };
    }
    expect(thrown?.message).toContain("precondition on the size axis");
    expect(thrown?.actual).toBe(2);
  });

  it("FAILS when the CLEAN parse's warmup never settles", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    let cost = 8;
    const opts: ScalingGateOptions<Costed, number> = {
      ...fixture(clock, { inputs: 4, size: 10, cleanPerUnit: 0.2 }, lines),
      parse: costingParse(clock, () => {
        cost *= 1.1;
        return cost;
      }),
    };

    expect(() =>
      assertScalingGateFires(opts, {
        regressedParse: regressionWithRatio(clock, 10, 12),
        equals: () => true,
      }),
    ).toThrow(/CLEAN parse's warmup never settled/);
  });

  it("FAILS when the REGRESSED parse's warmup never settles", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts = fixture(clock, { inputs: 4, size: 10, cleanPerUnit: 0.2 }, lines);
    let cost = 40;

    expect(() =>
      assertScalingGateFires(opts, {
        regressedParse: costingParse(clock, () => {
          cost *= 1.1;
          return cost;
        }),
        equals: () => true,
      }),
    ).toThrow(/warmup never settled/);
  });

  it("FAILS when the regressed loop never reached the sink", () => {
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts: ScalingGateOptions<Costed, number> = {
      ...fixture(clock, { inputs: 4, size: 10, cleanPerUnit: 0.2 }, lines),
      weigh: () => 0,
    };
    expect(() =>
      assertScalingGateFires(opts, {
        regressedParse: regressionWithRatio(clock, 10, 12),
        equals: () => true,
      }),
    ).toThrow(/sink never moved/);
  });
});

describe("assertScalingGateFires — the count axis", () => {
  it("can be pointed at a regression super-linear in the number of inputs", () => {
    // The default axis is `size`, because that is the one an O(n²)-in-length tokenizer blows up and
    // the one count-scaling structurally cannot see. A regression super-linear in the NUMBER of
    // inputs is the other case, and the axis is selectable for it.
    const clock = installFakeClock();
    const lines: string[] = [];
    const opts = fixture(clock, { inputs: 8, size: 10, cleanPerUnit: 0.2 }, lines);

    // An accumulating rescan: input `i` costs `1 + i`. Sum(1..8) = 36 vs Sum(1..32) = 528 = 14.667.
    const report = assertScalingGateFires(opts, {
      regressedParse: costingParse(clock, (input: Costed) => 1 + input.i),
      equals: () => true,
      axis: "count",
    });

    expect(report.axis).toBe("count");
    expect(report.baseSize).toBeNull();
    expect(report.inputs).toEqual([8, 8 * PERF_CONTRACT.SCALE_STEP]);
    expect(report.signal).toBe(14.6667);
    expect(report.cleanBaseMinMs.count).toBeGreaterThanOrEqual(PERF_CONTRACT.MIN_PHASE_MS);
    expect(report.cleanBaseMinMs.size).toBeGreaterThanOrEqual(PERF_CONTRACT.MIN_PHASE_MS);
  });
});
