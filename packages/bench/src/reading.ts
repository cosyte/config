/**
 * A reading: how fast, how much memory and how heavy one build is, on this machine.
 *
 * A reading is not a guarantee and travels with its machine: it is what the results repository keeps
 * over time, compared only within one runner class.
 *
 * @packageDocumentation
 */

import type { JobResult, MemoryResult, TimingResult } from "./child.js";
import type { JobRunner } from "./compare.js";
import type { ImportCostReport } from "./import-cost.js";
import type { LatencyReport } from "./measure.js";
import type { AllocationReport, LongRunReport, PeakReport } from "./memory.js";
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
      }[];
      /** The median of the process medians. */
      readonly medianMsPerOp: number;
      readonly opsPerSecond: number;
      /** `null` when the suite gave no byte count for the corpus. */
      readonly bytesPerSecond: number | null;
    }
  | { readonly status: "skipped"; readonly reason: string };

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
  /** `null` when import cost was not asked for. */
  readonly importCost: ImportCostReport | null;
}

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
  readonly runJob: JobRunner;
  /** Measures cold import cost: `measureImportCost` for real. */
  readonly measureImport: (target: string) => Promise<ImportCostReport>;
}

function expectTiming(result: JobResult): TimingResult {
  if (result.mode !== "timing")
    throw new Error("@cosyte/bench: a timing job returned another kind");
  return result;
}

function expectMemory(result: JobResult): MemoryResult {
  if (result.mode === "timing")
    throw new Error("@cosyte/bench: a memory job returned a timing result");
  return result;
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

/**
 * Take a reading of one build: per case, throughput from `processes` fresh processes (latency from
 * the first), allocations from one more, peak heap and (for the benchmark's long-run size) the long
 * run from another; then the build's cold import cost.
 *
 * @internal
 */
export async function readBuild(options: ReadOptions): Promise<ReadingBody> {
  const runJob = options.runJob;
  const processes = options.processes ?? 3;
  if (!Number.isInteger(processes) || processes < 1) {
    throw new TypeError("@cosyte/bench: processes must be a positive integer");
  }
  const base = { suite: options.suiteFile, target: options.target };
  const cases: CaseReading[] = [];
  for (const c of listCases(options.suite, options.only)) {
    const timing = async (latency: boolean) =>
      expectTiming(await runJob({ mode: "timing", ...base, case: c, latency, inject: 0 }));
    const first = await timing(true);
    const rest: TimingResult[] = [];
    for (let p = 1; p < processes; p++) rest.push(await timing(false));
    const throughput = summarizeThroughput(first, rest);
    const latency = first.status === "measured" ? first.latency : null;
    let allocations: AllocationReport | null = null;
    let peak: PeakReport | null = null;
    let longRun: LongRunReport | null = null;
    if (options.memory ?? true) {
      allocations = expectMemory(await runJob({ mode: "alloc", ...base, case: c })).allocations;
      const { benchmark } = findCase(options.suite, c);
      // A suite has at least one size per benchmark (checkSuite), so the first one exists.
      const longRunSize = benchmark.longRun ?? (benchmark.sizes[0] as BenchSize<unknown>).label;
      const heap = expectMemory(
        await runJob({ mode: "heap", ...base, case: c, longRun: c.size === longRunSize }),
      );
      peak = heap.peak;
      longRun = heap.longRun;
    }
    cases.push({
      ...c,
      inputsPerPass: first.inputsPerPass,
      bytesPerPass: first.bytesPerPass,
      throughput,
      latency,
      allocations,
      peak,
      longRun,
    });
    options.onProgress?.(`read ${c.benchmark} @ ${c.size}`);
  }
  const importCost =
    (options.importCost ?? true) ? await options.measureImport(options.target) : null;
  return { processes, cases, importCost };
}
