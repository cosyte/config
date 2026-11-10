import { describe, expect, it } from "vitest";

import {
  binomialCdf,
  median,
  nearestRank,
  rateUpperBound,
  round,
  signTestInterval,
  signTestRank,
  sortedCopy,
  theilSenSlope,
  trialsForZeroEvents,
} from "../src/stats.js";

describe("median and nearestRank", () => {
  it("takes the middle value, or the mean of the two middle values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it("is NaN for nothing, so an empty measurement cannot read as fast", () => {
    expect(median([])).toBeNaN();
    expect(nearestRank([], 0.5)).toBeNaN();
  });

  it("sorts a copy and leaves the input alone", () => {
    const xs = [3, 1, 2];
    expect(sortedCopy(xs)).toEqual([1, 2, 3]);
    expect(xs).toEqual([3, 1, 2]);
    expect(sortedCopy([10, 9, 100])).toEqual([9, 10, 100]);
  });

  it("reports an observed value at the nearest rank, without interpolating", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(nearestRank(hundred, 0.95)).toBe(95);
    expect(nearestRank(hundred, 0.99)).toBe(99);
    expect(nearestRank(hundred, 0.5)).toBe(50);
    expect(nearestRank([1, 2, 3], 0.5)).toBe(2);
    expect(nearestRank([5, 6], 0)).toBe(5);
    expect(nearestRank([5, 6], 1)).toBe(6);
  });
});

describe("binomialCdf", () => {
  it("matches the exact tails of Binomial(12, 1/2)", () => {
    expect(binomialCdf(2, 12, 0.5)).toBeCloseTo(79 / 4096, 12);
    expect(binomialCdf(3, 12, 0.5)).toBeCloseTo(299 / 4096, 12);
    expect(binomialCdf(0, 12, 0.5)).toBeCloseTo(1 / 4096, 12);
  });

  it("handles a skewed p", () => {
    // P(X <= 1) for n = 10, p = 0.1: 0.9^10 + 10 * 0.1 * 0.9^9.
    expect(binomialCdf(1, 10, 0.1)).toBeCloseTo(0.9 ** 10 + 10 * 0.1 * 0.9 ** 9, 12);
  });

  it("is exact at the edges", () => {
    expect(binomialCdf(-1, 5, 0.5)).toBe(0);
    expect(binomialCdf(5, 5, 0.5)).toBe(1);
    expect(binomialCdf(6, 5, 0.5)).toBe(1);
  });

  it("stays finite for a long run of trials", () => {
    expect(binomialCdf(3, 2000, 0.001)).toBeCloseTo(0.857, 3);
  });
});

describe("the sign test", () => {
  it("picks rank 3 for 12 rounds at alpha 0.05", () => {
    expect(signTestRank(12, 0.05)).toBe(3);
    expect(signTestRank(5, 0.05)).toBe(1);
    expect(signTestRank(4, 0.05)).toBe(0);
    expect(signTestRank(12, 0.0193)).toBe(3);
    expect(signTestRank(12, 0.0192)).toBe(2);
    // At exactly the tail the rank qualifies: at most alpha, not under it.
    expect(signTestRank(12, binomialCdf(2, 12, 0.5))).toBe(3);
    // When every rank qualifies it stops at n.
    expect(signTestRank(3, 1)).toBe(3);
  });

  it("bounds the median by the 3rd smallest and 3rd largest of 12, each end missing 79 / 4096", () => {
    const xs = [12, 1, 11, 2, 10, 3, 9, 4, 8, 5, 7, 6];
    const interval = signTestInterval(xs, 0.05);
    expect(interval).toEqual({
      low: 3,
      high: 10,
      rank: 3,
      tail: expect.closeTo(79 / 4096, 12) as number,
    });
  });

  it("gives no interval when no rank meets alpha", () => {
    expect(signTestInterval([1, 2, 3, 4], 0.05)).toBeNull();
  });
});

describe("rateUpperBound and trialsForZeroEvents", () => {
  it("needs 299 clean A/A comparisons to put the false alarm rate under 1% at 95%", () => {
    expect(trialsForZeroEvents(0.01, 0.95)).toBe(299);
    expect(rateUpperBound(0, 299, 0.95)).toBeLessThan(0.01);
    expect(rateUpperBound(0, 298, 0.95)).toBeGreaterThan(0.01);
  });

  it("matches the closed form with no events", () => {
    expect(rateUpperBound(0, 100, 0.95)).toBeCloseTo(1 - 0.05 ** (1 / 100), 9);
  });

  it("matches the Clopper-Pearson bound with events", () => {
    // One event in 100 trials, one-sided 95%: 0.04656 (exact).
    expect(rateUpperBound(1, 100, 0.95)).toBeCloseTo(0.04656, 4);
    expect(rateUpperBound(5, 100, 0.95)).toBeCloseTo(0.10221, 4);
  });

  it("is 1 when it cannot say anything", () => {
    expect(rateUpperBound(0, 0, 0.95)).toBe(1);
    expect(rateUpperBound(3, 3, 0.95)).toBe(1);
    expect(rateUpperBound(1, 1, 0.95)).toBe(1);
  });
});

describe("theilSenSlope", () => {
  it("ignores one wild point", () => {
    expect(theilSenSlope([1, 2, 3, 4, 5], [2, 4, 6, 8, 100])).toBe(2);
  });

  it("takes every pair, the last point's included", () => {
    // Slopes 1 (first two), 3 and 2: the median is 2. Leaving the last point out would give 1.
    expect(theilSenSlope([0, 1, 2], [0, 1, 4])).toBe(2);
  });

  it("skips pairs that share an x", () => {
    expect(theilSenSlope([1, 1, 2], [0, 5, 2])).toBe(-0.5);
  });

  it("is NaN with fewer than two distinct x", () => {
    expect(theilSenSlope([3, 3], [1, 2])).toBeNaN();
  });
});

describe("round", () => {
  it("rounds to decimal places, four by default", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.234567)).toBe(1.2346);
  });
});
