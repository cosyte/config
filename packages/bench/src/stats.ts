/**
 * The statistics the benchmarks report and judge by. Plain arithmetic with no dependencies, each
 * function small enough to check by hand against the worked numbers in its tests.
 *
 * @packageDocumentation
 */

/**
 * A sorted copy, ascending. The input is not touched.
 *
 * @internal
 */
export function sortedCopy(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/**
 * The median: the middle value, or the mean of the two middle values. `NaN` for an empty vector,
 * so an empty measurement can never read as a fast one.
 *
 * @internal
 */
export function median(xs: readonly number[]): number {
  const s = sortedCopy(xs);
  const mid = Math.floor(s.length / 2);
  // An even length of at least 2 has both middle values. An empty vector takes the even branch and
  // reads two missing values, which is `NaN`: the empty answer, by arithmetic rather than a check.
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * A percentile by nearest rank: the smallest value with at least a fraction `q` of the values at or
 * below it. No interpolation, so every reported percentile is a value that was observed.
 *
 * @internal
 */
export function nearestRank(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = sortedCopy(xs);
  const rank = Math.max(1, Math.ceil(q * s.length));
  return s[rank - 1] as number;
}

/**
 * `P(X <= k)` for `X ~ Binomial(n, p)`, summed in log space so it stays finite for large `n`, for
 * `0 < p < 1` (every caller's range). A negative `k` sums nothing and is 0; a `k` past `n` sums all
 * of it and is 1.
 *
 * @internal
 */
export function binomialCdf(k: number, n: number, p: number): number {
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  let logCoef = 0;
  let total = 0;
  for (let i = 0; i <= Math.min(k, n); i++) {
    if (i > 0) logCoef += Math.log(n - i + 1) - Math.log(i);
    total += Math.exp(logCoef + i * logP + (n - i) * logQ);
  }
  return Math.min(1, total);
}

/**
 * The sign test's rank for an interval on the median of `n` values: the largest `k` such that the
 * `k`-th smallest value lies below the true median with probability at most `alpha`, that is
 * `P(Binomial(n, 1/2) <= k - 1) <= alpha`. `0` when no rank qualifies (too few values).
 *
 * @internal
 */
export function signTestRank(n: number, alpha: number): number {
  let k = 0;
  while (k < n && binomialCdf(k, n, 0.5) <= alpha) k++;
  return k;
}

/** An interval on a median, from the sign test. */
export interface MedianInterval {
  /** The `rank`-th smallest value. */
  readonly low: number;
  /** The `rank`-th largest value. */
  readonly high: number;
  /** Which order statistics bound it. */
  readonly rank: number;
  /** The chance that each end alone misses the median, exactly: `P(Binomial(n, 1/2) <= rank - 1)`. */
  readonly tail: number;
}

/**
 * The distribution-free interval on the median of independent values: the `k`-th smallest and the
 * `k`-th largest, with `k` from {@link signTestRank}. It assumes nothing about the shape of the
 * noise, which on a shared runner is one-sided and heavy-tailed. `null` when there are too few
 * values for any rank to meet `alpha`.
 *
 * @internal
 */
export function signTestInterval(xs: readonly number[], alpha: number): MedianInterval | null {
  const rank = signTestRank(xs.length, alpha);
  if (rank === 0) return null;
  const s = sortedCopy(xs);
  // `rank` is at least 1 and at most `n`, so both order statistics exist.
  return {
    low: s[rank - 1] as number,
    high: s[s.length - rank] as number,
    rank,
    tail: binomialCdf(rank - 1, xs.length, 0.5),
  };
}

/**
 * The exact (Clopper-Pearson) one-sided upper confidence bound on a rate, from `k` events in `n`
 * trials: the largest rate `p` at which seeing `k` or fewer is still at least `1 - confidence`
 * likely. With no events this is `1 - (1 - confidence)^(1/n)`, about `3 / n` at 95%.
 *
 * @internal
 */
export function rateUpperBound(k: number, n: number, confidence: number): number {
  // No trials say nothing. Every trial an event bisects to 1 on its own.
  if (n === 0) return 1;
  const alpha = 1 - confidence;
  let lo = k / n;
  let hi = 1;
  // Stryker disable next-line EqualityOperator: a 101st halving moves the bound by under 2^-100, below a double's resolution.
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    // Stryker disable next-line EqualityOperator: `>` and `>=` differ only where the tail equals alpha exactly, which bisection over doubles does not land on.
    if (binomialCdf(k, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The fewest trials, all without an event, whose {@link rateUpperBound} is under `rate`: how long an
 * A/A calibration has to run before a clean record can show a false alarm rate under `rate`.
 *
 * @internal
 */
export function trialsForZeroEvents(rate: number, confidence: number): number {
  return Math.ceil(Math.log(1 - confidence) / Math.log1p(-rate));
}

/**
 * The Theil-Sen slope: the median of the slopes between every pair of points with distinct `x`.
 * One wild point moves it little, which matters for a heap reading that a late collection can
 * spike. `NaN` with fewer than two distinct `x`.
 *
 * @internal
 */
export function theilSenSlope(xs: readonly number[], ys: readonly number[]): number {
  // Pairs only exist where both vectors do; a caller passes vectors of one length.
  const slopes: number[] = [];
  xs.forEach((xi, i) => {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = (xs[j] as number) - xi;
      if (dx !== 0) slopes.push(((ys[j] as number) - (ys[i] as number)) / dx);
    }
  });
  return median(slopes);
}

/**
 * Round to a number of decimal places, for readable reports. The full values stay in
 * the sample vectors.
 *
 * @internal
 */
export function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
