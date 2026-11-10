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
import { BENCH_CONTRACT } from "./contract.js";
import type { LatencyReport, WarmupPlan } from "./measure.js";
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
 * build's cold import cost. Timing every size first is what lets the long run pick its largest size
 * from measured pass times.
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
  const listed = listCases(options.suite, options.only);
  const cases: CaseReading[] = [];
  for (const name of new Set(listed.map((c) => c.benchmark))) {
    const timed: Timed[] = [];
    for (const c of listed.filter((l) => l.benchmark === name)) {
      const timing = async (latency: boolean) =>
        expectTiming(await runJob({ mode: "timing", ...base, case: c, latency, inject: 0 }));
      const first = await timing(true);
      const rest: TimingResult[] = [];
      for (let p = 1; p < processes; p++) rest.push(await timing(false));
      timed.push({ c, first, throughput: summarizeThroughput(first, rest) });
    }
    // Sizes run smallest first, so the last that fits is the largest.
    const largest = timed.filter((t) => longRunFits(t.throughput, t.first.inputsPerPass)).pop();
    for (const { c, first, throughput } of timed) {
      let allocations: AllocationReport | null = null;
      let peak: PeakReport | null = null;
      let longRun: LongRunReport | null = null;
      if (options.memory ?? true) {
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
  const importCost =
    (options.importCost ?? true) ? await options.measureImport(options.target) : null;
  return { processes, cases, importCost };
}
