import { afterEach, describe, expect, it } from "vitest";

import { BENCH_CONTRACT } from "../src/contract.js";
import {
  measureAllocations,
  measureLongRun,
  measurePeak,
  realProbe,
  settle,
  type HeapProbe,
} from "../src/memory.js";
import { theilSenSlope } from "../src/stats.js";
import { fakeClock } from "./support/clock.js";

/**
 * A scripted heap. `heap` and `external` are what the probe reads; `gc` reclaims `garbage`, or
 * whatever `reclaim` says for this round; `profile` reports the collections `gcsFor` says ran, and
 * when one ran, it reclaimed the window's `garbage` and `externalGarbage` and says how much.
 */
function scripted(
  options: {
    reclaim?: (round: number) => number;
    gcsFor?: (call: number) => number;
    peakFor?: (call: number) => number;
    peakExternalFor?: (call: number) => number;
    peakTotalFor?: (call: number) => number;
  } = {},
) {
  const state = {
    heap: 1_000_000,
    external: 0,
    garbage: 0,
    externalGarbage: 0,
    rounds: 0,
    profiles: 0,
  };
  const probe: HeapProbe = {
    gc: () => {
      const r = options.reclaim?.(state.rounds) ?? state.garbage;
      state.heap -= r;
      state.garbage = 0;
      state.rounds++;
    },
    usedHeap: () => state.heap,
    external: () => state.external,
    profile: (fn) => {
      const call = state.profiles++;
      fn();
      const gcs = options.gcsFor?.(call) ?? 0;
      const reclaimedHeap = gcs > 0 ? state.garbage : 0;
      const reclaimedExternal = gcs > 0 ? state.externalGarbage : 0;
      state.heap -= reclaimedHeap;
      state.external -= reclaimedExternal;
      if (gcs > 0) {
        state.garbage = 0;
        state.externalGarbage = 0;
      }
      return {
        gcs,
        peakBeforeGc: options.peakFor?.(call) ?? 0,
        peakExternalBeforeGc: options.peakExternalFor?.(call) ?? 0,
        peakTotalBeforeGc:
          options.peakTotalFor?.(call) ??
          (options.peakFor?.(call) ?? 0) + (options.peakExternalFor?.(call) ?? 0),
        reclaimedHeap,
        reclaimedExternal,
      };
    },
  };
  return { state, probe };
}

describe("settle", () => {
  it("stops after two quiet rounds", () => {
    const { state, probe } = scripted();
    state.garbage = 10_000_000;
    expect(settle(probe)).toEqual({ settled: true, rounds: 3, heap: 1_000_000 - 10_000_000 });
  });

  it("counts a round reclaiming exactly 64 KiB as busy, and one byte less as quiet", () => {
    const busy = scripted({ reclaim: () => BENCH_CONTRACT.GC_SETTLE_BYTES });
    expect(settle(busy.probe).settled).toBe(false);
    const quiet = scripted({ reclaim: () => BENCH_CONTRACT.GC_SETTLE_BYTES - 1 });
    expect(settle(quiet.probe)).toMatchObject({ settled: true, rounds: 2 });
  });

  it("needs the two quiet rounds in a row", () => {
    const { probe } = scripted({ reclaim: (r) => (r === 1 ? 1_000_000 : 0) });
    expect(settle(probe)).toMatchObject({ settled: true, rounds: 4 });
  });

  it("gives up after seven rounds", () => {
    const { state, probe } = scripted({ reclaim: () => 100_000 });
    expect(settle(probe)).toEqual({ settled: false, rounds: 7, heap: 1_000_000 - 700_000 });
    expect(state.rounds).toBe(BENCH_CONTRACT.GC_MAX_ROUNDS);
  });
});

describe("measureAllocations", () => {
  it("takes the growth between a window of n and one of 2n, per operation", () => {
    const { state, probe } = scripted();
    // Each call allocates 100 heap bytes and 8 external; each read of the heap allocates 50 more,
    // a fixed cost that lands in both windows and cancels.
    const call = () => {
      state.heap += 100;
      state.garbage += 100;
      state.external += 8;
    };
    const usedHeap = probe.usedHeap;
    const withOverhead: HeapProbe = {
      ...probe,
      usedHeap: () => {
        const v = usedHeap();
        state.heap += 50;
        state.garbage += 50;
        return v;
      },
    };
    expect(measureAllocations(call, withOverhead, 1)).toEqual({
      status: "measured",
      method: "no-gc-window",
      collections: 0,
      windowOps: 100,
      heapBytesPerOp: 100,
      externalBytesPerOp: 8,
    });
  });

  it("runs exactly n and then 2n operations", () => {
    const { probe } = scripted();
    let calls = 0;
    measureAllocations(() => calls++, probe, 1000);
    expect(calls).toBe(3);
  });

  it("measures each window from its own starting heap, when some of each call stays", () => {
    const { state, probe } = scripted();
    // 100 bytes a call, 10 of them kept: the second window starts higher than the first.
    const call = () => {
      state.heap += 100;
      state.garbage += 90;
    };
    expect(measureAllocations(call, probe, 1)).toMatchObject({ heapBytesPerOp: 100 });
  });

  it("starts from about 100 ms of operations, at most 256", () => {
    const { probe } = scripted();
    expect(measureAllocations(() => undefined, probe, 0.001)).toMatchObject({ windowOps: 256 });
    expect(measureAllocations(() => undefined, probe, 25)).toMatchObject({ windowOps: 4 });
    expect(measureAllocations(() => undefined, probe, 1000)).toMatchObject({ windowOps: 1 });
    expect(measureAllocations(() => undefined, probe, 0)).toMatchObject({ windowOps: 256 });
  });

  it("halves the window while a collection lands in it", () => {
    const { probe } = scripted({ gcsFor: (call) => (call < 3 ? 1 : 0) });
    // Calls 0 and 1 are the first pair, 2 and 3 the second: both pairs have a collection.
    expect(measureAllocations(() => undefined, probe, 1)).toMatchObject({ windowOps: 25 });
  });

  it("halves the window when either one of the pair collects", () => {
    const first = scripted({ gcsFor: (call) => (call === 0 ? 1 : 0) });
    expect(measureAllocations(() => undefined, first.probe, 1)).toMatchObject({ windowOps: 50 });
    const second = scripted({ gcsFor: (call) => (call === 1 ? 1 : 0) });
    expect(measureAllocations(() => undefined, second.probe, 1)).toMatchObject({ windowOps: 50 });
  });

  it("counts what the collections reclaimed when every window collects", () => {
    const { state, probe } = scripted({ gcsFor: () => 1 });
    // Each call allocates 100 heap bytes and 8 external, all garbage, and every window collects:
    // the heap ends each window where it began, and only the reclaimed bytes show the allocation.
    const call = () => {
      state.heap += 100;
      state.garbage += 100;
      state.external += 8;
      state.externalGarbage += 8;
    };
    expect(measureAllocations(call, probe, 1)).toEqual({
      status: "measured",
      method: "gc-accounted",
      collections: 2,
      windowOps: 100,
      heapBytesPerOp: 100,
      externalBytesPerOp: 8,
    });
  });

  it("counts the growth a collection left as well as what it reclaimed", () => {
    const { state, probe } = scripted({ gcsFor: () => 1 });
    // 100 bytes a call, 10 of them kept past the collection.
    const call = () => {
      state.heap += 100;
      state.garbage += 90;
    };
    expect(measureAllocations(call, probe, 1000)).toMatchObject({
      method: "gc-accounted",
      windowOps: 1,
      heapBytesPerOp: 100,
    });
  });

  it("accounts the first, largest pair of windows, and tries no more after the halving", () => {
    const { probe } = scripted({ gcsFor: () => 1 });
    let calls = 0;
    measureAllocations(() => calls++, probe, 25);
    // Pairs of 4 and 8, 2 and 4, 1 and 2 operations: 21 calls, then the first pair is accounted.
    expect(calls).toBe(21);
    expect(
      measureAllocations(() => undefined, scripted({ gcsFor: () => 1 }).probe, 25),
    ).toMatchObject({ windowOps: 4, collections: 2 });
  });

  it("skips, typed, when the heap will not settle", () => {
    const { probe } = scripted({ reclaim: () => 100_000 });
    expect(measureAllocations(() => undefined, probe, 1)).toEqual({
      status: "skipped",
      reason: "gc-unsettled",
    });
    const second = scripted({ reclaim: (r) => (r >= 3 ? 100_000 : 0) });
    expect(measureAllocations(() => undefined, second.probe, 1)).toEqual({
      status: "skipped",
      reason: "gc-unsettled",
    });
  });
});

describe("measurePeak", () => {
  it("takes the higher of the heap before a collection and at the end, above the settled heap", () => {
    const { state, probe } = scripted({ peakFor: (call) => (call === 3 ? 1_000_000 + 5_000 : 0) });
    const call = () => {
      state.heap += 1_000;
      state.garbage += 1_000;
    };
    expect(measurePeak(call, probe)).toEqual({
      status: "measured",
      calls: BENCH_CONTRACT.PEAK_CALLS,
      peakHeapBytes: 5_000,
      medianPeakHeapBytes: 1_000,
      peakExternalBytes: 0,
      medianPeakExternalBytes: 0,
      peakTotalBytes: 5_000,
      medianPeakTotalBytes: 1_000,
    });
  });

  it("reports external memory beside the heap, and their sum at its own high point", () => {
    const { state, probe } = scripted({
      // Call 2 held 9,000 external bytes just before a collection; call 4 held the most in all.
      peakExternalFor: (call) => (call === 2 ? 9_000 : 0),
      peakTotalFor: (call) => (call === 4 ? 1_000_000 + 20_000 : 0),
    });
    // Each call leaves 1,000 heap bytes and 4,000 external ones held at its end.
    const call = () => {
      state.heap += 1_000;
      state.garbage += 1_000;
      state.external += 4_000;
      state.externalGarbage += 4_000;
    };
    const free: HeapProbe = {
      ...probe,
      gc: () => {
        probe.gc();
        state.external -= state.externalGarbage;
        state.externalGarbage = 0;
      },
    };
    expect(measurePeak(call, free)).toEqual({
      status: "measured",
      calls: BENCH_CONTRACT.PEAK_CALLS,
      peakHeapBytes: 1_000,
      medianPeakHeapBytes: 1_000,
      peakExternalBytes: 9_000,
      medianPeakExternalBytes: 4_000,
      peakTotalBytes: 20_000,
      medianPeakTotalBytes: 5_000,
    });
  });

  it("skips, typed, when the heap will not settle", () => {
    const { probe } = scripted({ reclaim: () => 100_000 });
    expect(measurePeak(() => undefined, probe)).toEqual({
      status: "skipped",
      reason: "gc-unsettled",
    });
  });
});

describe("measureLongRun", () => {
  it("reads a heap that holds nothing as flat", () => {
    const clock = fakeClock(0, 1_000_000);
    const { probe } = scripted();
    let passes = 0;
    const report = measureLongRun(
      () => {
        passes++;
        clock.advance(10);
      },
      4,
      probe,
      clock.now,
    );
    // Ten 10 ms passes size a round, and every round after the first runs ten more.
    expect(passes).toBe(BENCH_CONTRACT.LONG_RUN_ROUNDS * 10);
    expect(report).toEqual({
      status: "measured",
      verdict: "flat",
      ops: BENCH_CONTRACT.LONG_RUN_ROUNDS * 40,
      opsPerRound: 40,
      settledHeap: Array.from({ length: BENCH_CONTRACT.LONG_RUN_ROUNDS }, () => 1_000_000),
      slopeBytesPerOp: 0,
      growthBytes: 0,
      // 64 KiB over the 24 fitted rounds of 40 operations.
      detectableBytesPerOp: 68.2667,
    });
  });

  it("reads a leak of 100 bytes an operation as growing, and its slope as 100", () => {
    const clock = fakeClock();
    const { state, probe } = scripted();
    const report = measureLongRun(
      () => {
        clock.advance(10);
        state.heap += 100 * 4;
      },
      4,
      probe,
      clock.now,
    );
    expect(report).toMatchObject({
      status: "measured",
      verdict: "growing",
      slopeBytesPerOp: 100,
      growthBytes: 96_000,
    });
  });

  const leaking = (bytesPerOp: number) => {
    const clock = fakeClock();
    const { state, probe } = scripted();
    return measureLongRun(
      () => {
        clock.advance(10);
        state.heap += bytesPerOp;
      },
      1,
      probe,
      clock.now,
    );
  };

  it("draws the line at 64 KiB of fitted growth", () => {
    // 24 fitted rounds of 10 operations: 240 operations.
    expect(leaking(273)).toMatchObject({ verdict: "flat", growthBytes: 65_520 });
    expect(leaking(274)).toMatchObject({ verdict: "growing", growthBytes: 65_760 });
  });

  it("does not call a small slope over a short span growing", () => {
    expect(leaking(2)).toMatchObject({ verdict: "flat", slopeBytesPerOp: 2, growthBytes: 480 });
  });

  it("fits only the rounds after the settling ones", () => {
    const clock = fakeClock();
    const { state, probe } = scripted();
    let rounds = 0;
    let passes = 0;
    // Every round of ten passes adds a different amount: 0 in the settling rounds, then a growing
    // ramp, so the fit over the last 24 rounds differs from a fit over all 30.
    const report = measureLongRun(
      () => {
        clock.advance(10);
        if (++passes % 10 === 0) {
          rounds++;
          if (rounds > BENCH_CONTRACT.LONG_RUN_SETTLE_ROUNDS) state.heap += rounds * rounds;
        }
      },
      1,
      probe,
      clock.now,
    );
    if (report.status !== "measured") throw new Error("measured");
    const ops = report.settledHeap.map((_h, i) => (i + 1) * 10);
    const skip = BENCH_CONTRACT.LONG_RUN_SETTLE_ROUNDS;
    expect(report.slopeBytesPerOp).toBe(
      Math.round(theilSenSlope(ops.slice(skip), report.settledHeap.slice(skip)) * 1e4) / 1e4,
    );
    expect(report.slopeBytesPerOp).not.toBe(
      Math.round(theilSenSlope(ops, report.settledHeap) * 1e4) / 1e4,
    );
  });

  it("leaves the settling rounds out of the slope", () => {
    const clock = fakeClock();
    const { state, probe } = scripted();
    let passes = 0;
    const report = measureLongRun(
      () => {
        clock.advance(10);
        // Growth only while the first rounds run: caches filling, code compiling.
        if (passes++ < 10 * BENCH_CONTRACT.LONG_RUN_SETTLE_ROUNDS) state.heap += 1_000;
      },
      1,
      probe,
      clock.now,
    );
    expect(report).toMatchObject({ verdict: "flat", slopeBytesPerOp: 0 });
  });

  it("skips, typed, when the heap will not settle", () => {
    const clock = fakeClock();
    const { probe } = scripted({ reclaim: () => 100_000 });
    expect(measureLongRun(() => clock.advance(10), 1, probe, clock.now)).toEqual({
      status: "skipped",
      reason: "gc-unsettled",
    });
  });
});

describe("realProbe", () => {
  const original = (globalThis as { gc?: unknown }).gc;
  afterEach(() => {
    (globalThis as { gc?: unknown }).gc = original;
  });

  it("is null without --expose-gc", () => {
    (globalThis as { gc?: unknown }).gc = undefined;
    expect(realProbe()).toBeNull();
  });

  it("calls gc with no argument, and reads the real heap", () => {
    const calls: unknown[][] = [];
    (globalThis as { gc?: unknown }).gc = (...args: unknown[]) => {
      calls.push(args);
    };
    const probe = realProbe();
    expect(probe).not.toBeNull();
    probe?.gc();
    expect(calls).toEqual([[]]);
    expect(probe?.usedHeap()).toBeGreaterThan(0);
    expect(probe?.external()).toBeGreaterThanOrEqual(0);
    const quiet = probe?.profile(() => undefined);
    expect(quiet).toEqual({
      gcs: 0,
      peakBeforeGc: 0,
      peakExternalBeforeGc: 0,
      peakTotalBeforeGc: 0,
      reclaimedHeap: 0,
      reclaimedExternal: 0,
    });
    let kept: unknown[] = [];
    const busy = probe?.profile(() => {
      for (let i = 0; i < 200_000; i++) kept.push({ i, s: `x${String(i)}` });
    });
    kept = [];
    expect(busy?.gcs).toBeGreaterThan(0);
    expect(busy?.peakBeforeGc).toBeGreaterThan(0);
    expect(busy?.peakTotalBeforeGc).toBeGreaterThan(busy?.peakBeforeGc ?? 0);
    expect(busy?.reclaimedHeap).toBeGreaterThan(0);
    expect(kept).toEqual([]);
  });
});
