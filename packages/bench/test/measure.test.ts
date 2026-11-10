import { describe, expect, it } from "vitest";

import { BENCH_CONTRACT } from "../src/contract.js";
import {
  WARMUP,
  batchesAreStable,
  measureLatency,
  sampleThroughput,
  tailPercentile,
  timerOverheadNs,
  warmUp,
} from "../src/measure.js";
import { fakeClock, fakeNs } from "./support/clock.js";

describe("batchesAreStable", () => {
  it("needs three batches", () => {
    expect(batchesAreStable([])).toBe(false);
    expect(batchesAreStable([10, 10])).toBe(false);
    expect(batchesAreStable([10, 10, 10])).toBe(true);
  });

  it("holds the last three within 5% of their median", () => {
    expect(batchesAreStable([10, 10.5, 10])).toBe(true);
    expect(batchesAreStable([10, 9.5, 10])).toBe(true);
    expect(batchesAreStable([10, 10.6, 10])).toBe(false);
    expect(batchesAreStable([10, 9.4, 10])).toBe(false);
    expect(batchesAreStable([100, 10, 10, 10])).toBe(true);
    expect(batchesAreStable([10, 10, 10, 100])).toBe(false);
  });

  it("refuses a zero median rather than dividing by it", () => {
    expect(batchesAreStable([0, 0, 0])).toBe(false);
    expect(batchesAreStable([0, 0, 1])).toBe(false);
  });
});

describe("warmUp", () => {
  it("stops once three batches agree after 500 ms, never before", () => {
    // The clock starts far from zero, as `performance.now` does in a process that has run a while.
    const clock = fakeClock(0, 1_000_000);
    const report = warmUp(() => clock.advance(10), clock.now);
    expect(report.stable).toBe(true);
    expect(report.elapsedMs).toBe(WARMUP.MIN_MS);
    expect(report.passes).toBe(50);
    expect(report.batches).toEqual(Array.from({ length: 10 }, () => 10));
  });

  it("gives up after 5 s when the batches never agree", () => {
    const clock = fakeClock();
    let calls = 0;
    const report = warmUp(() => clock.advance(calls++ % 2 === 0 ? 50 : 100), clock.now);
    expect(report.stable).toBe(false);
    expect(report.elapsedMs).toBeGreaterThanOrEqual(WARMUP.MAX_MS);
    expect(report.elapsedMs).toBeLessThan(WARMUP.MAX_MS + 100);
    expect(report.batches.slice(0, 4)).toEqual([50, 100, 50, 100]);
  });

  it("keeps a batch to whole passes of at least 50 ms", () => {
    const clock = fakeClock();
    const report = warmUp(() => clock.advance(30), clock.now);
    // Two 30 ms passes make each 60 ms batch: 30 ms per pass.
    expect(report.batches[0]).toBe(30);
    expect(report.passes).toBe(report.batches.length * 2);
  });
});

describe("sampleThroughput", () => {
  it("reports milliseconds per operation over whole passes of at least 50 ms", () => {
    const clock = fakeClock(0, 1_000_000);
    const samples = sampleThroughput(() => clock.advance(20), 4, clock.now);
    // Three 20 ms passes of 4 operations: 60 ms / 12 operations.
    expect(samples).toEqual(Array.from({ length: BENCH_CONTRACT.SAMPLES }, () => 5));
  });

  it("ends a sample on the pass that reaches 50 ms, not one after", () => {
    const clock = fakeClock(0, 1_000_000);
    let passes = 0;
    sampleThroughput(
      () => {
        passes++;
        clock.advance(25);
      },
      1,
      clock.now,
    );
    // Two 25 ms passes reach exactly 50 ms: a sample is two passes.
    expect(passes).toBe(2 * BENCH_CONTRACT.SAMPLES);
  });

  it("spins exactly the injected fraction of each pass", () => {
    const clock = fakeClock(1, 1_000_000);
    // Each read is 1 ms; a pass is 9 ms of work plus its 1 ms read, 10 ms in all. A 0.3 slowdown
    // spins reads until 3 ms more have passed: 13 ms a pass, four passes (52 ms) a sample.
    const samples = sampleThroughput(() => clock.advance(9), 1, clock.now, 0.3);
    expect(samples).toEqual(Array.from({ length: BENCH_CONTRACT.SAMPLES }, () => 13));
  });

  it("injects a known slowdown in proportion to each pass", () => {
    const plain = fakeClock(0.01);
    const slowed = fakeClock(0.01);
    const base = sampleThroughput(() => plain.advance(20), 1, plain.now)[0] ?? 0;
    const head = sampleThroughput(() => slowed.advance(20), 1, slowed.now, 0.5)[0] ?? 0;
    expect(head / base).toBeGreaterThan(1.45);
    expect(head / base).toBeLessThan(1.55);
  });

  it("injects nothing at zero", () => {
    const a = fakeClock(0.01);
    const b = fakeClock(0.01);
    expect(sampleThroughput(() => a.advance(20), 1, a.now, 0)).toEqual(
      sampleThroughput(() => b.advance(20), 1, b.now),
    );
  });
});

describe("latency", () => {
  it("measures the clock's own cost", () => {
    expect(timerOverheadNs(fakeNs(50n).ns)).toBe(50);
    expect(timerOverheadNs(fakeNs(7n).ns, 3)).toBe(7);
    expect(timerOverheadNs(fakeNs(7n).ns, 1)).toBe(7);
    // Gaps of 1, 3 and 100 ns: two pairs have a median of 2, three of 3.
    const reads = [0n, 1n, 10n, 13n, 20n, 120n];
    const scripted = () => reads.shift() ?? 0n;
    expect(timerOverheadNs(scripted, 2)).toBe(2);
  });

  it("reports a percentile only with at least ten calls above it", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(tailPercentile(twenty, 0.5)).toBe(10);
    expect(tailPercentile(twenty, 0.95)).toBeNull();
    const thousand = Array.from({ length: 1000 }, (_, i) => i + 1);
    expect(tailPercentile(thousand, 0.99)).toBe(990);
    expect(tailPercentile(thousand.slice(0, 999), 0.99)).toBeNull();
  });

  it("times each call and stops at the call limit", () => {
    const clock = fakeNs(10n);
    const report = measureLatency(() => clock.advance(1000n), clock.ns);
    expect(report).toEqual({
      status: "measured",
      calls: BENCH_CONTRACT.LATENCY_MAX_CALLS,
      timerOverheadNs: 10,
      p50Ns: 1010,
      p95Ns: 1010,
      p99Ns: 1010,
      maxNs: 1010,
    });
  });

  it("stops at the time budget, and leaves out tails it has too few calls for", () => {
    const clock = fakeNs(10n);
    const report = measureLatency(() => clock.advance(1_000_000n), clock.ns);
    expect(report.status).toBe("measured");
    expect(report.calls).toBe(2000);
    if (report.status !== "measured") return;
    expect(report.p99Ns).toBe(1_000_010);
  });

  it("stops at the call that reaches the budget exactly, not one after", () => {
    // A clock that does not move on a read, far from zero: each call is exactly 1 ms.
    const clock = fakeNs(0n, 10n ** 12n);
    const report = measureLatency(() => clock.advance(1_000_000n), clock.ns);
    expect(report.calls).toBe(2000);
  });

  it("takes the minimum number of calls even past the budget", () => {
    const clock = fakeNs(10n);
    const report = measureLatency(() => clock.advance(1_000_000_000n), clock.ns);
    expect(report).toMatchObject({
      status: "measured",
      calls: BENCH_CONTRACT.LATENCY_MIN_CALLS,
      p95Ns: null,
      p99Ns: null,
    });
  });

  it("varies with the call, and reports the slowest", () => {
    const clock2 = fakeNs(1n);
    let j = 0;
    const report2 = measureLatency(
      () => clock2.advance(BigInt(1000 + (j++ % 100) * 10)),
      clock2.ns,
    );
    expect(report2).toMatchObject({ status: "measured", maxNs: 1991, p50Ns: 1491 });
  });

  it("skips, typed, when the call is too short for the clock", () => {
    const clock = fakeNs(10n);
    const report = measureLatency(() => clock.advance(189n), clock.ns);
    expect(report).toEqual({
      status: "skipped",
      reason: "latency-below-timer-resolution",
      calls: BENCH_CONTRACT.LATENCY_MAX_CALLS,
      timerOverheadNs: 10,
      p50Ns: 199,
    });
    const enough = measureLatency(() => clock.advance(190n), clock.ns);
    expect(enough.status).toBe("measured");
  });
});
