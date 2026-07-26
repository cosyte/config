/**
 * The measurement primitives, tested without a clock.
 *
 * Everything here is pure: the two estimators ADR 0001 separates (`min` for the ratio assertion,
 * `median` for the reported headline), the rounding used in diagnostics, and the warmup stability
 * predicate — which is the rule that decides when V8 is considered settled, and therefore the rule
 * the whole warmup budget hangs off.
 *
 * Clock-free, so it runs in the default `pnpm test` rather than the timed `pnpm test:perf`.
 */

import { describe, expect, it } from "vitest";

import { PERF_CONTRACT } from "../../src/perf/contract.js";
import {
  batchesAreStable,
  defaultWeigh,
  medianOf,
  minOf,
  round4,
  perfSink,
} from "../../src/perf/measure.js";

describe("minOf — the ratio assertion's estimator", () => {
  it("returns the smallest sample", () => {
    expect(minOf([9.1, 4.2, 7.7])).toBe(4.2);
  });

  it("returns +Infinity on an empty vector rather than 0", () => {
    // 0 would silently produce a ratio of Infinity or NaN downstream. +Infinity propagates into a
    // phase that fails MIN_PHASE_MS' comparison the safe way — it never looks like a fast phase.
    expect(minOf([])).toBe(Number.POSITIVE_INFINITY);
  });

  it("is the estimator that ignores a one-sided stall", () => {
    // The whole reason ADR 0001 picks min for the ratio: CI noise is one-sided (things get slower,
    // never faster), so a single stalled rep must not move the statistic.
    const clean = [8.0, 8.1, 8.05, 8.02, 8.03];
    const stalled = [8.0, 8.1, 8.05, 61.4, 8.03];
    expect(minOf(clean)).toBe(minOf(stalled));
    expect(medianOf(clean)).not.toBe(medianOf(stalled));
  });
});

describe("medianOf — the reported headline's estimator", () => {
  it("takes the middle sample of an odd-length vector", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });

  it("averages the two middle samples of an even-length vector", () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });

  it("handles a single sample", () => {
    expect(medianOf([7])).toBe(7);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    medianOf(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("round4", () => {
  it("rounds to four decimal places", () => {
    expect(round4(4.123456)).toBe(4.1235);
    expect(round4(4)).toBe(4);
  });
});

describe("defaultWeigh — the sink contribution", () => {
  it("counts one per non-nullish result", () => {
    expect(defaultWeigh({})).toBe(1);
    expect(defaultWeigh(0)).toBe(1);
    expect(defaultWeigh("")).toBe(1);
  });

  it("counts zero for a parse that returns nothing, which is what trips the liveness check", () => {
    // A `parse` returning void weighs 0 everywhere, so the sink never moves and the runner throws
    // rather than reporting a ratio from a loop the compiler was entitled to delete.
    expect(defaultWeigh(undefined)).toBe(0);
    expect(defaultWeigh(null)).toBe(0);
  });
});

describe("perfSink", () => {
  it("is a live accumulator the runner reads back", () => {
    // Not decoration: Turboshaft's dead-code elimination is use-based, so a measured loop whose
    // result is never read is a loop the compiler may delete — and a deleted loop produces a
    // confident, fast, meaningless number.
    const before = perfSink.value;
    perfSink.value += 3;
    expect(perfSink.value).toBe(before + 3);
    perfSink.value = before;
  });
});

describe("batchesAreStable — when V8 counts as settled", () => {
  const { WARMUP_STABLE_BATCHES, WARMUP_STABLE_TOL } = PERF_CONTRACT;

  it("is false before WARMUP_STABLE_BATCHES batches exist", () => {
    expect(batchesAreStable([10, 10])).toBe(false);
    expect(batchesAreStable([])).toBe(false);
  });

  it("is true when the last three batches sit within the tolerance of their median", () => {
    expect(batchesAreStable([40, 20, 10.2, 10, 9.8])).toBe(true);
  });

  it("judges only the LAST three, so an unsettled prefix does not veto a settled tail", () => {
    // The rule is "stop when three consecutive batches agree", not "all batches agree" — a warmup
    // that starts slow and converges is the normal case, not a failure.
    expect(batchesAreStable([500, 250, 10.1, 10, 9.9])).toBe(true);
  });

  it("is false when any of the last three sits outside the tolerance", () => {
    const outside = 10 * (1 + WARMUP_STABLE_TOL * 2);
    expect(batchesAreStable([10, 10, outside])).toBe(false);
  });

  it("is false when a settled tail is followed by drift", () => {
    expect(batchesAreStable([10, 10, 10, 12])).toBe(false);
  });

  it("holds exactly at the tolerance boundary and fails just outside it", () => {
    const hi = 10 * (1 + WARMUP_STABLE_TOL);
    expect(batchesAreStable([10, 10, hi])).toBe(true);
    expect(batchesAreStable([10, 10, hi + 1e-6])).toBe(false);
  });

  it("is false on a non-positive median rather than dividing by zero", () => {
    // A zero-length batch would make the relative test NaN, and NaN comparisons are false in a way
    // that reads as "unstable" only by accident. Refuse explicitly.
    expect(batchesAreStable([0, 0, 0])).toBe(false);
  });

  it("uses exactly WARMUP_STABLE_BATCHES samples", () => {
    expect(WARMUP_STABLE_BATCHES).toBe(3);
    // A pair that agrees is not enough — two consecutive can be a coincidence on a heavy tail.
    expect(batchesAreStable([10, 10])).toBe(false);
  });
});
