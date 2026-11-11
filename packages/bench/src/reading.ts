/**
 * A reading: how fast, how much memory and how heavy one build is, on this machine.
 *
 * A reading is not a guarantee and travels with its machine: it is what the results repository keeps
 * over time, compared only within one runner class.
 *
 * @packageDocumentation
 */

import type { AnyJob, AnyJobResult, MemoryResult, TimingResult } from "./child.js";
import type { ImportCostReport } from "./import-cost.js";
import { BENCH_CONTRACT } from "./contract.js";
import type { LatencyReport, WarmupPlan } from "./measure.js";
import {
  aboveFloor,
  type AllocationReport,
  type LongRunReport,
  type PeakReport,
} from "./memory.js";
import { median, round } from "./stats.js";
import { findCase, listCases, type BenchSize, type BenchSuite, type CaseRef } from "./suite.js";

/** Throughput of one case. */
export type Throughput =
  | {
      readonly status: "measured";
      /** One entry per process: its samples and their median, milliseconds per operation. */
      readonly processes: readonly {
        readonly samplesMsPerOp: readonly number[];
        readonly medianMsPerOp: number;
        /** The warmup rule the process ended on. Absent in a document written before it was recorded. */
        readonly plan?: WarmupPlan;
      }[];
      /** The median of the process medians. */
      readonly medianMsPerOp: number;
      readonly opsPerSecond: number;
      /** `null` when the suite gave no byte count for the corpus. */
      readonly bytesPerSecond: number | null;
    }
  | { readonly status: "skipped"; readonly reason: string };

/**
 * A part of a run that could not be measured: a case's timing or memory, or the empty-call floor.
 * The message is the first line of what went wrong. Only the first line is kept, because the lines
 * after it may be a measuring process's stderr, which may quote an input; the command line prints
 * the whole of it to its own stderr.
 */
export interface RunFailure {
  readonly phase: "timing" | "memory" | "floor";
  /** The case, or `null` for the floor. */
  readonly benchmark: string | null;
  readonly size: string | null;
  readonly message: string;
}

/** Everything a reading measured for one case. */
export interface CaseReading extends CaseRef {
  readonly inputsPerPass: number;
  readonly bytesPerPass: number | null;
  readonly throughput: Throughput;
  readonly latency: LatencyReport | null;
  readonly allocations: AllocationReport | null;
  readonly peak: PeakReport | null;
  readonly longRun: LongRunReport | null;
}

/** A whole reading. */
export interface ReadingBody {
  /** Fresh processes timed per case. */
  readonly processes: number;
  readonly cases: readonly CaseReading[];
  /**
   * The peak of an empty call, measured once per run through the same probe as the cases: what the
   * probe itself costs. Each case's peak also gives its figures above this one. `null` when memory
   * was not measured or the floor could not be. Absent in a document written before it.
   */
  readonly memoryFloor?: PeakReport | null;
  /**
   * What could not be measured. A case whose timing failed is here and not in `cases`; one whose
   * memory failed is in both, with the memory it could not read as `null`. Every other case is
   * written as usual. Empty when everything measured; absent in a document written before it.
   */
  readonly failures?: readonly RunFailure[];
  /** `null` when import cost was not asked for. */
  readonly importCost: ImportCostReport | null;
}

/**
 * Runs one measuring job of a reading, the empty-call floor included: `runInChild` for real.
 *
 * @internal
 */
export type ReadRunner = (job: AnyJob) => Promise<AnyJobResult>;

/** What {@link readBuild} needs. */
export interface ReadOptions {
  readonly suiteFile: string;
  readonly suite: BenchSuite<unknown>;
  /** The build's entry, an absolute path. */
  readonly target: string;
  readonly only?: readonly string[];
  /** Fresh timing processes per case. At least 1. */
  readonly processes?: number;
  /** Measure memory (two more processes per case). */
  readonly memory?: boolean;
  /** Measure cold import time and loaded bytes. */
  readonly importCost?: boolean;
  readonly onProgress?: (line: string) => void;
  /** Runs one measuring job: `runInChild` for real. */
  readonly runJob: ReadRunner;
  /** Measures cold import cost: `measureImportCost` for real. */
  readonly measureImport: (target: string) => Promise<ImportCostReport>;
}

/** A runner that answered a job with another kind of result: a defect in the runner, not a case. */
class WrongKind extends Error {}

function expectTiming(result: AnyJobResult): TimingResult {
  if (result.mode !== "timing")
    throw new WrongKind("@cosyte/bench: a timing job returned another kind");
  return result;
}

function expectMemory(result: AnyJobResult): MemoryResult {
  if (result.mode === "timing" || result.mode === "floor")
    throw new WrongKind("@cosyte/bench: a memory job returned another kind");
  return result;
}

function expectFloor(result: AnyJobResult): PeakReport {
  if (result.mode !== "floor")
    throw new WrongKind("@cosyte/bench: a floor job returned another kind");
  return result.peak;
}

/** The first line of an error's message: what failed, without any process output after it. */
function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] as string;
}

/**
 * The peak, in bytes, a memory budget reads for a case, or `null` when the case has none. A case
 * whose inputs average under `FLOOR_INPUT_BYTES` (its bytes a pass over its inputs a pass) reads
 * its highest total peak above the run's empty-call floor; any other case, and one whose suite gave
 * no byte count, reads the raw total peak (the V8 heap and external memory together). The probe
 * costs a fixed 21 to 24 KiB, which is most of the budget of a small input and nothing the code
 * under test did, and a rounding error on a large one. A document without a floor reads raw.
 *
 * @example
 * ```ts
 * import { budgetPeakBytes } from "@cosyte/bench";
 *
 * // 300 bytes an input: 30,000 bytes raw, 24,000 of them the probe's own floor.
 * budgetPeakBytes({
 *   benchmark: "parse",
 *   size: "300 B",
 *   inputsPerPass: 1,
 *   bytesPerPass: 300,
 *   throughput: { status: "skipped", reason: "warmup-unstable" },
 *   latency: null,
 *   allocations: null,
 *   peak: {
 *     status: "measured",
 *     calls: 20,
 *     peakHeapBytes: 30_000,
 *     medianPeakHeapBytes: 29_000,
 *     peakTotalBytes: 30_000,
 *     medianPeakTotalBytes: 29_000,
 *     peakTotalAboveFloorBytes: 6_000,
 *   },
 *   longRun: null,
 * }); // => 6000
 * ```
 */
export function budgetPeakBytes(c: CaseReading): number | null {
  const p = c.peak;
  if (p === null || p.status !== "measured") return null;
  const raw = p.peakTotalBytes ?? p.peakHeapBytes;
  if (c.bytesPerPass === null) return raw;
  // A corpus is never empty (the measuring process refuses one); were it, the size reads infinite.
  const perInput = c.bytesPerPass / c.inputsPerPass;
  if (perInput >= BENCH_CONTRACT.FLOOR_INPUT_BYTES) return raw;
  return p.peakTotalAboveFloorBytes ?? raw;
}

type Measured = Extract<TimingResult, { status: "measured" }>;

/**
 * Pool one case's timing processes: the median of their medians, or the first skip.
 *
 * @internal
 */
export function summarizeThroughput(
  first: TimingResult,
  rest: readonly TimingResult[],
): Throughput {
  const measured: Measured[] = [];
  for (const t of [first, ...rest]) {
    if (t.status === "skipped") return { status: "skipped", reason: t.reason };
    measured.push(t);
  }
  const per = measured.map((t) => ({
    samplesMsPerOp: t.samplesMsPerOp,
    medianMsPerOp: t.medianMsPerOp,
    plan: t.warmup.plan,
  }));
  const mid = median(per.map((x) => x.medianMsPerOp));
  const perOpBytes = first.bytesPerPass === null ? null : first.bytesPerPass / first.inputsPerPass;
  return {
    status: "measured",
    processes: per,
    medianMsPerOp: mid,
    opsPerSecond: round(1000 / mid, 2),
    bytesPerSecond: perOpBytes === null ? null : round(perOpBytes * (1000 / mid), 0),
  };
}

/** One case's timing, before its memory is read. */
interface Timed {
  readonly c: CaseRef;
  readonly first: TimingResult;
  readonly throughput: Throughput;
}

/**
 * Whether a case's long run fits `LONG_RUN_MAX_MS`: `LONG_RUN_ROUNDS` rounds, each at least
 * `LONG_RUN_ROUND_MS` and at least one pass, at the pass time its throughput measured. A case whose
 * throughput was skipped has no pass time, so it does not fit.
 *
 * @internal
 */
export function longRunFits(throughput: Throughput, inputsPerPass: number): boolean {
  if (throughput.status !== "measured") return false;
  const roundMs = Math.max(
    BENCH_CONTRACT.LONG_RUN_ROUND_MS,
    throughput.medianMsPerOp * inputsPerPass,
  );
  return BENCH_CONTRACT.LONG_RUN_ROUNDS * roundMs <= BENCH_CONTRACT.LONG_RUN_MAX_MS;
}

/**
 * Take a reading of one build, a benchmark at a time: each of its sizes timed in `processes` fresh
 * processes (latency from the first); then per size, allocations from one more process, and the
 * peak from another, which also runs the long run on the benchmark's long-run size (the one it
 * names, or its first) and on its largest size whose long run fits `LONG_RUN_MAX_MS`; then the
 * empty-call floor in one more process, which every peak is also given above; then the build's
 * cold import cost. Timing every size first is what lets the long run pick its largest size from
 * measured pass times.
 *
 * A measuring process that fails is a failure of its own case and phase, listed in `failures`: the
 * run goes on and every other case is written.
 *
 * @internal
 */
export async function readBuild(options: ReadOptions): Promise<ReadingBody> {
  const runJob = options.runJob;
  const processes = options.processes ?? 3;
  if (!Number.isInteger(processes) || processes < 1) {
    throw new TypeError("@cosyte/bench: processes must be a positive integer");
  }
  const memory = options.memory ?? true;
  const base = { suite: options.suiteFile, target: options.target };
  const listed = listCases(options.suite, options.only);
  const cases: CaseReading[] = [];
  const failures: RunFailure[] = [];
  const fail = (phase: RunFailure["phase"], c: CaseRef | null, error: unknown) => {
    if (error instanceof WrongKind) throw error;
    const message = firstLine(error);
    failures.push({ phase, benchmark: c?.benchmark ?? null, size: c?.size ?? null, message });
    const what = c === null ? "the memory floor" : `${phase} of ${c.benchmark} @ ${c.size}`;
    options.onProgress?.(
      `could not measure ${what}: ${error instanceof Error ? error.message : String(error)}`,
    );
  };
  for (const name of new Set(listed.map((c) => c.benchmark))) {
    const timed: Timed[] = [];
    for (const c of listed.filter((l) => l.benchmark === name)) {
      const timing = async (latency: boolean) =>
        expectTiming(await runJob({ mode: "timing", ...base, case: c, latency, inject: 0 }));
      try {
        const first = await timing(true);
        const rest: TimingResult[] = [];
        for (let p = 1; p < processes; p++) rest.push(await timing(false));
        timed.push({ c, first, throughput: summarizeThroughput(first, rest) });
      } catch (error) {
        fail("timing", c, error);
      }
    }
    // Sizes run smallest first, so the last that fits is the largest.
    const largest = timed.filter((t) => longRunFits(t.throughput, t.first.inputsPerPass)).pop();
    for (const { c, first, throughput } of timed) {
      let allocations: AllocationReport | null = null;
      let peak: PeakReport | null = null;
      let longRun: LongRunReport | null = null;
      if (memory) {
        try {
          allocations = expectMemory(await runJob({ mode: "alloc", ...base, case: c })).allocations;
          const { benchmark } = findCase(options.suite, c);
          // A suite has at least one size per benchmark (checkSuite), so the first one exists.
          const longRunSize = benchmark.longRun ?? (benchmark.sizes[0] as BenchSize<unknown>).label;
          const heap = expectMemory(
            await runJob({
              mode: "heap",
              ...base,
              case: c,
              longRun: c.size === longRunSize || c.size === largest?.c.size,
            }),
          );
          peak = heap.peak;
          longRun = heap.longRun;
        } catch (error) {
          fail("memory", c, error);
        }
      }
      cases.push({
        ...c,
        inputsPerPass: first.inputsPerPass,
        bytesPerPass: first.bytesPerPass,
        throughput,
        latency: first.status === "measured" ? first.latency : null,
        allocations,
        peak,
        longRun,
      });
      options.onProgress?.(`read ${c.benchmark} @ ${c.size}`);
    }
  }
  let memoryFloor: PeakReport | null = null;
  if (memory) {
    try {
      memoryFloor = expectFloor(await runJob({ mode: "floor" }));
    } catch (error) {
      fail("floor", null, error);
    }
  }
  const importCost =
    (options.importCost ?? true) ? await options.measureImport(options.target) : null;
  return {
    processes,
    cases: cases.map((c) =>
      c.peak === null ? c : { ...c, peak: aboveFloor(c.peak, memoryFloor) },
    ),
    memoryFloor,
    failures,
    importCost,
  };
}
