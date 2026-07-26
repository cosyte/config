/**
 * The frozen contract, asserted constant by constant against ADR 0001.
 *
 * This file exists so that a change to any number in `src/perf/contract.ts` cannot land quietly. The
 * constants are not tuning knobs: `RATIO_CEILING` was set from the worst false alarm in a 3,200-row
 * measured population *and* the weakest real O(n²) signal at `hl7`'s own fixture size, so it is
 * conditional on the estimator, the sampling shape and the warmup rule together. ADR 0001's review
 * triggers are the process for moving one; a red test here is the reminder that the process exists.
 *
 * Clock-free by construction, so it runs in the default `pnpm test` (and therefore in
 * `scripts/verify.sh config`) rather than in the timed `pnpm test:perf`.
 */

import { describe, expect, it } from "vitest";

import { PERF_CONTRACT } from "../../src/perf/index.js";
import { signalVerdict } from "../../src/perf/self-check.js";

describe("PERF_CONTRACT", () => {
  it("holds exactly the values ADR 0001 froze", () => {
    // Asserted as one object rather than field by field: an added constant is as much a contract
    // change as a moved one, and toEqual catches both.
    expect({ ...PERF_CONTRACT }).toEqual({
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
  });

  it("is frozen, so no consumer can tune it at runtime", () => {
    expect(Object.isFrozen(PERF_CONTRACT)).toBe(true);
  });

  it("keeps the band open and straddling the ideal linear ratio", () => {
    // If the floor ever rose above SCALE_STEP, or the ceiling fell below it, a perfectly linear
    // parser would fail the gate on every run. The ideal ratio must sit strictly inside the band.
    expect(PERF_CONTRACT.RATIO_FLOOR).toBeLessThan(PERF_CONTRACT.SCALE_STEP);
    expect(PERF_CONTRACT.RATIO_CEILING).toBeGreaterThan(PERF_CONTRACT.SCALE_STEP);
  });

  it("clears P0's worst measured false alarm and stays under the weakest measured signal", () => {
    // The two numbers the ceiling was derived from, per ADR 0001's constants table. A ceiling has to
    // sit ABOVE the noise and BELOW the weakest real signal; `hl7`'s shipped LINEARITY_MAX = 10
    // satisfied only the first, which is why P4 must lower it.
    const worstFalseAlarm = 6.649;
    const weakestSignalAtHl7FixtureSize = 8.84;
    expect(PERF_CONTRACT.RATIO_CEILING).toBeGreaterThan(worstFalseAlarm);
    expect(PERF_CONTRACT.RATIO_CEILING).toBeLessThan(weakestSignalAtHl7FixtureSize);
  });

  it("keeps the floor below the lowest ratio in P0's 3,200-sample population", () => {
    expect(PERF_CONTRACT.RATIO_FLOOR).toBeLessThan(1.702);
  });
});

describe("signalVerdict — the ceiling as a per-package guarantee", () => {
  // ADR 0001 §5's measured table, encoded. The signal a genuine O(n²)-in-length parser produces is
  // NOT a constant: it climbs with fixture size, so at the smallest of these the gate reads green
  // while blind. This is the single arithmetic decision that turns 8 from a global guess into a
  // per-package guarantee, so it is driven directly with the measured values.
  it.each([
    { baseSegments: 125, signal: 4.69, clears: false },
    { baseSegments: 250, signal: 8.09, clears: true },
    { baseSegments: 500, signal: 8.84, clears: true },
    { baseSegments: 1000, signal: 10.68, clears: true },
  ])("base $baseSegments segments → signal $signal clears: $clears", ({ signal, clears }) => {
    expect(signalVerdict(signal).clears).toBe(clears);
  });

  it("reports the margin as signal over ceiling", () => {
    expect(signalVerdict(8.84).margin).toBe(1.105);
    expect(signalVerdict(16, 8).margin).toBe(2);
  });

  it("does not treat a signal exactly at the ceiling as clearing it", () => {
    // Strictly greater. A signal that merely equals the ceiling would fail the gate's `>` comparison
    // only by luck of rounding, and "the gate can just barely fail" is not a guarantee.
    expect(signalVerdict(PERF_CONTRACT.RATIO_CEILING).clears).toBe(false);
  });
});
