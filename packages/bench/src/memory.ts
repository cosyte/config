/**
 * The memory measurements: allocations per operation, peak heap per call, and whether the heap stays
 * flat over a long run. Each runs in a measuring process started with `--expose-gc`, one case per
 * process.
 *
 * They read the heap through a {@link HeapProbe}, so their tests can drive them with a scripted heap.
 * The real probe follows ADR 0001 section 8: a zero-argument `gc()` only, settled by rule rather than
 * by a count.
 *
 * @packageDocumentation
 */

import { getHeapStatistics, GCProfiler } from "node:v8";

import { BENCH_CONTRACT } from "./contract.js";
import type { Clock } from "./measure.js";
import { median, round, theilSenSlope } from "./stats.js";

/**
 * What the memory measurements read the heap with.
 *
 * @internal
 */
export interface HeapProbe {
  /** A full collection. The real probe calls `gc()` with no argument, the only form ADR 0001 allows. */
  readonly gc: () => void;
  /** Bytes in use on the V8 heap. */
  readonly usedHeap: () => number;
  /** Bytes held outside the V8 heap by JavaScript objects (Buffers, ArrayBuffers). */
  readonly external: () => number;
  /**
   * Run `fn` and report the collections that ran during it, and the most heap in use just before any
   * of them. The heap only shrinks at a collection, so its high point is either there or at the end.
   */
  readonly profile: (fn: () => void) => { readonly gcs: number; readonly peakBeforeGc: number };
}

/**
 * The real probe, or `null` when the process was not started with `--expose-gc`.
 *
 * @internal
 */
export function realProbe(): HeapProbe | null {
  const gc: unknown = (globalThis as { gc?: unknown }).gc;
  if (typeof gc !== "function") return null;
  return {
    gc: () => {
      (gc as () => void)();
    },
    usedHeap: () => getHeapStatistics().used_heap_size,
    external: () => process.memoryUsage().external,
    profile: (fn) => {
      const profiler = new GCProfiler();
      profiler.start();
      fn();
      const stats = profiler.stop().statistics;
      let peak = 0;
      for (const s of stats) peak = Math.max(peak, s.beforeGC.heapStatistics.usedHeapSize);
      return { gcs: stats.length, peakBeforeGc: peak };
    },
  };
}

/** The settled heap, or the news that it would not settle. */
export interface SettleResult {
  readonly settled: boolean;
  readonly rounds: number;
  readonly heap: number;
}

/**
 * Collect until two rounds in a row each reclaim under `GC_SETTLE_BYTES`, at most `GC_MAX_ROUNDS`
 * rounds (ADR 0001 section 8).
 *
 * @internal
 */
export function settle(probe: HeapProbe): SettleResult {
  let quiet = 0;
  let before = probe.usedHeap();
  for (let round = 1; round <= BENCH_CONTRACT.GC_MAX_ROUNDS; round++) {
    probe.gc();
    const after = probe.usedHeap();
    quiet = before - after < BENCH_CONTRACT.GC_SETTLE_BYTES ? quiet + 1 : 0;
    before = after;
    if (quiet >= BENCH_CONTRACT.GC_SETTLE_ROUNDS)
      return { settled: true, rounds: round, heap: after };
  }
  return { settled: false, rounds: BENCH_CONTRACT.GC_MAX_ROUNDS, heap: before };
}

/** Why a memory measurement has no number. */
export type MemorySkipReason = "gc-unavailable" | "gc-unsettled" | "allocation-window-gc";

/** Allocations per operation. */
export type AllocationReport =
  | {
      readonly status: "measured";
      /** The smaller of the two windows, in operations. */
      readonly windowOps: number;
      /** Bytes allocated on the V8 heap per operation. */
      readonly heapBytesPerOp: number;
      /** Bytes allocated outside it (Buffers, ArrayBuffers) per operation. */
      readonly externalBytesPerOp: number;
    }
  | { readonly status: "skipped"; readonly reason: MemorySkipReason };

/**
 * Allocations per operation, from the heap's growth across two windows of `n` and `2n` operations
 * in which no collection ran: `(growth(2n) - growth(n)) / n`, so the fixed cost of reading the heap
 * cancels. The first `n` is about `ALLOC_WINDOW_MS` of operations at `msPerOp`, at most
 * `ALLOC_WINDOW_OPS`. A collection in either window halves `n` and tries again. The process runs with a large
 * young generation (`ALLOC_SEMI_SPACE_MIB`) so that a window rarely collects.
 *
 * @internal
 */
export function measureAllocations(
  call: (i: number) => void,
  probe: HeapProbe,
  msPerOp: number,
): AllocationReport {
  const window = (ops: number) => {
    const s = settle(probe);
    const h0 = probe.usedHeap();
    const e0 = probe.external();
    const { gcs } = probe.profile(() => {
      for (let i = 0; i < ops; i++) call(i);
    });
    return { settled: s.settled, gcs, heap: probe.usedHeap() - h0, ext: probe.external() - e0 };
  };
  const paced = Math.floor(BENCH_CONTRACT.ALLOC_WINDOW_MS / msPerOp);
  const first = Math.max(1, Math.min(BENCH_CONTRACT.ALLOC_WINDOW_OPS, paced));
  for (let n = first; n >= 1; n = Math.floor(n / 2)) {
    const a = window(n);
    const b = window(2 * n);
    if (!a.settled || !b.settled) return { status: "skipped", reason: "gc-unsettled" };
    if (a.gcs === 0 && b.gcs === 0) {
      return {
        status: "measured",
        windowOps: n,
        heapBytesPerOp: round((b.heap - a.heap) / n, 1),
        externalBytesPerOp: round((b.ext - a.ext) / n, 1),
      };
    }
  }
  return { status: "skipped", reason: "allocation-window-gc" };
}

/** Peak heap per call. */
export type PeakReport =
  | {
      readonly status: "measured";
      readonly calls: number;
      /** The highest peak of any call, in bytes above the settled heap before it. */
      readonly peakHeapBytes: number;
      /** The median call's peak. */
      readonly medianPeakHeapBytes: number;
    }
  | { readonly status: "skipped"; readonly reason: MemorySkipReason };

/**
 * The peak heap of single calls: settle, call once, and take the higher of the heap just before any
 * collection during the call and the heap at its end, less the settled heap before it. Run with
 * V8's default heap sizing, so the collections that shape the peak are the ones a user's process has.
 *
 * @internal
 */
export function measurePeak(call: (i: number) => void, probe: HeapProbe): PeakReport {
  const peaks: number[] = [];
  for (let i = 0; i < BENCH_CONTRACT.PEAK_CALLS; i++) {
    const s = settle(probe);
    if (!s.settled) return { status: "skipped", reason: "gc-unsettled" };
    const { peakBeforeGc } = probe.profile(() => {
      call(i);
    });
    peaks.push(Math.max(peakBeforeGc, probe.usedHeap()) - s.heap);
  }
  return {
    status: "measured",
    calls: peaks.length,
    peakHeapBytes: Math.max(...peaks),
    medianPeakHeapBytes: median(peaks),
  };
}

/** Whether the heap stayed flat over a long run. */
export type LongRunReport =
  | {
      readonly status: "measured";
      /** `growing` when the fitted growth reaches `LONG_RUN_GROWTH_BYTES`. */
      readonly verdict: "flat" | "growing";
      /** Operations in all. */
      readonly ops: number;
      /** Operations per round, fixed by the first round. */
      readonly opsPerRound: number;
      /** The settled heap after each round, in bytes. */
      readonly settledHeap: readonly number[];
      /** Theil-Sen slope of the settled heap against operations, after the settling rounds. */
      readonly slopeBytesPerOp: number;
      /** The slope times the operations it was fitted over: the growth the verdict reads. */
      readonly growthBytes: number;
      /** The smallest leak, in bytes per operation, this run could call growing: the bound over the span. */
      readonly detectableBytesPerOp: number;
    }
  | { readonly status: "skipped"; readonly reason: MemorySkipReason };

/**
 * Run the case for `LONG_RUN_ROUNDS` rounds, settle the heap after each, and fit the settled heap
 * against the operations run so far. A leak of `b` bytes an operation shows as a slope near `b`;
 * a heap that only grows while caches and compiled code settle is left out by
 * `LONG_RUN_SETTLE_ROUNDS`. The verdict reads the growth the slope implies over the fitted rounds,
 * not the slope alone: a settled heap reading moves by about a kilobyte with nothing running
 * (ADR 0001 section 8), so a run of few operations cannot tell a small slope from that.
 *
 * @internal
 */
export function measureLongRun(
  pass: () => void,
  opsPerPass: number,
  probe: HeapProbe,
  clock: Clock,
): LongRunReport {
  const t0 = clock();
  let passesPerRound = 0;
  do {
    pass();
    passesPerRound++;
  } while (clock() - t0 < BENCH_CONTRACT.LONG_RUN_ROUND_MS);
  const opsPerRound = passesPerRound * opsPerPass;
  // Each round is the operations run so far and the heap settled after them. The sizing round
  // above is the first.
  const rounds: { ops: number; heap: number }[] = [];
  let ops = opsPerRound;
  for (;;) {
    const s = settle(probe);
    if (!s.settled) return { status: "skipped", reason: "gc-unsettled" };
    rounds.push({ ops, heap: s.heap });
    if (rounds.length === BENCH_CONTRACT.LONG_RUN_ROUNDS) break;
    for (let p = 0; p < passesPerRound; p++) pass();
    ops += opsPerRound;
  }
  const skip = BENCH_CONTRACT.LONG_RUN_SETTLE_ROUNDS;
  const fitted = rounds.slice(skip);
  const slope = theilSenSlope(
    fitted.map((r) => r.ops),
    fitted.map((r) => r.heap),
  );
  const span = (BENCH_CONTRACT.LONG_RUN_ROUNDS - 1 - skip) * opsPerRound;
  const growth = slope * span;
  return {
    status: "measured",
    // Stryker disable next-line EqualityOperator: growth is a fitted slope times 24 rounds, so exactly 65,536 bytes is not reached in floating point (tried in memory.test.ts history).
    verdict: growth >= BENCH_CONTRACT.LONG_RUN_GROWTH_BYTES ? "growing" : "flat",
    ops: BENCH_CONTRACT.LONG_RUN_ROUNDS * opsPerRound,
    opsPerRound,
    settledHeap: rounds.map((r) => r.heap),
    slopeBytesPerOp: round(slope, 4),
    growthBytes: Math.round(growth),
    detectableBytesPerOp: round(BENCH_CONTRACT.LONG_RUN_GROWTH_BYTES / span, 4),
  };
}
