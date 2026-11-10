/**
 * What runs inside a measuring process: one job, one case, then exit.
 *
 * One case per process is deliberate. A process that measured several functions through one harness
 * loop would make that loop's call site polymorphic, and the cost of the second case would depend on
 * which case ran first. A fresh process also carries no compiled code, heap layout or cache warmth
 * from one side of a comparison to the other, which is what makes the rounds independent.
 *
 * @packageDocumentation
 */

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  measureAllocations,
  measureLongRun,
  measurePeak,
  realProbe,
  type AllocationReport,
  type HeapProbe,
  type LongRunReport,
  type PeakReport,
} from "./memory.js";
import {
  measureLatency,
  sampleThroughput,
  warmUp,
  type Clock,
  type LatencyReport,
  type NsClock,
  type WarmupReport,
} from "./measure.js";
import { median } from "./stats.js";
import { checkSuite, findCase, type CaseRef } from "./suite.js";

/**
 * One job for one measuring process.
 *
 * @internal
 */
export type Job =
  | {
      readonly mode: "timing";
      readonly suite: string;
      readonly target: string;
      readonly case: CaseRef;
      /** Also time single calls for the latency percentiles. */
      readonly latency: boolean;
      /** A known slowdown, for calibration only. Zero in a real measurement. */
      readonly inject: number;
    }
  | {
      readonly mode: "alloc";
      readonly suite: string;
      readonly target: string;
      readonly case: CaseRef;
    }
  | {
      readonly mode: "heap";
      readonly suite: string;
      readonly target: string;
      readonly case: CaseRef;
      /** Also run the long run (is the heap flat?) on this case. */
      readonly longRun: boolean;
    };

/** The shape of one corpus, as reported. Sizes and counts only, never content. */
export interface CorpusShape {
  readonly inputsPerPass: number;
  readonly bytesPerPass: number | null;
}

/**
 * What a timing job measured.
 *
 * @internal
 */
export type TimingResult = CorpusShape & {
  readonly mode: "timing";
  readonly case: CaseRef;
  readonly warmup: WarmupReport;
} & (
    | {
        readonly status: "measured";
        /** Milliseconds per operation, one per sample, in the order taken. */
        readonly samplesMsPerOp: readonly number[];
        readonly medianMsPerOp: number;
        readonly latency: LatencyReport | null;
      }
    | { readonly status: "skipped"; readonly reason: "warmup-unstable" }
  );

/**
 * What a memory job measured.
 *
 * @internal
 */
export type MemoryResult = CorpusShape & {
  readonly mode: "alloc" | "heap";
  readonly case: CaseRef;
  readonly allocations: AllocationReport | null;
  readonly peak: PeakReport | null;
  readonly longRun: LongRunReport | null;
};

/**
 * What any job measured.
 *
 * @internal
 */
export type JobResult = TimingResult | MemoryResult;

/**
 * The clocks and the heap a job reads. Real ones in a measuring process; scripted ones in tests.
 *
 * @internal
 */
export interface JobDeps {
  readonly clock: Clock;
  readonly ns: NsClock;
  readonly probe: HeapProbe | null;
}

const realDeps = (): JobDeps => ({
  clock: () => performance.now(),
  ns: () => process.hrtime.bigint(),
  probe: realProbe(),
});

const defaultWeigh = (result: unknown): number => (result === undefined || result === null ? 0 : 1);

const SKIPPED_NO_GC = { status: "skipped", reason: "gc-unavailable" } as const;

/**
 * Run suite code, and if it throws, throw again without its message. Suite code handles the inputs,
 * and a message may quote one: a report that copied it would put an input in a CI log. The error's
 * class name and the phase are kept, which is enough to know where to look.
 *
 * @internal
 */
export function guard<T>(c: CaseRef, phase: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    throw new Error(
      `@cosyte/bench: case "${c.benchmark} @ ${c.size}": the suite's ${phase} threw (${kind}). ` +
        "Its message is not printed, because it may quote an input; run the case directly to read it.",
      { cause: error },
    );
  }
}

/**
 * The warmup's last pace, in milliseconds per operation.
 *
 * @internal
 */
export function msPerOp(warmup: WarmupReport, shape: CorpusShape): number {
  return (warmup.batches[warmup.batches.length - 1] ?? 0) / shape.inputsPerPass;
}

/**
 * Measure one job once its corpus is built and its code warm.
 *
 * @internal
 */
export function measureJob(
  job: Job,
  shape: CorpusShape,
  warmup: WarmupReport,
  pass: () => void,
  call: (i: number) => void,
  deps: JobDeps,
): JobResult {
  const base = { case: job.case, ...shape };
  if (job.mode === "timing") {
    if (!warmup.stable) {
      return { mode: "timing", ...base, warmup, status: "skipped", reason: "warmup-unstable" };
    }
    const samples = sampleThroughput(pass, shape.inputsPerPass, deps.clock, job.inject);
    return {
      mode: "timing",
      ...base,
      warmup,
      status: "measured",
      samplesMsPerOp: samples,
      medianMsPerOp: median(samples),
      latency: job.latency ? measureLatency(call, deps.ns) : null,
    };
  }
  const probe = deps.probe;
  if (job.mode === "alloc") {
    return {
      mode: "alloc",
      ...base,
      allocations:
        probe === null ? SKIPPED_NO_GC : measureAllocations(call, probe, msPerOp(warmup, shape)),
      peak: null,
      longRun: null,
    };
  }
  let longRun: LongRunReport | null = null;
  if (job.longRun) {
    longRun =
      probe === null ? SKIPPED_NO_GC : measureLongRun(pass, shape.inputsPerPass, probe, deps.clock);
  }
  return {
    mode: "heap",
    ...base,
    allocations: null,
    peak: probe === null ? SKIPPED_NO_GC : measurePeak(call, probe),
    longRun,
  };
}

/**
 * Whether a job measured anything, so its sink should have moved. A job that only skipped ran no
 * measured calls after its warmup.
 *
 * @internal
 */
export function measuredSomething(result: JobResult): boolean {
  if (result.mode === "timing") return result.status === "measured";
  return [result.allocations, result.peak, result.longRun].some((r) => r?.status === "measured");
}

/**
 * Run one job: import the suite and the target, build the case's corpus, measure, tear down.
 *
 * Throws when the suite is not a suite, the case is missing, the corpus is empty, or the measured
 * loop's sink did not grow (a loop the compiler may have deleted measures nothing). Messages name
 * the case, never an input.
 *
 * @internal
 */
export async function runJob(job: Job, deps: JobDeps = realDeps()): Promise<JobResult> {
  const suiteModule = (await import(pathToFileURL(job.suite).href)) as { default?: unknown };
  const suite = checkSuite(suiteModule.default);
  const target: unknown = await import(pathToFileURL(job.target).href);
  const { benchmark, size } = findCase(suite, job.case);
  const corpus = guard(job.case, "build", () => size.build());
  try {
    const inputs = corpus.inputs;
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error(
        `@cosyte/bench: case "${job.case.benchmark} @ ${job.case.size}" built an empty corpus`,
      );
    }
    const fn = guard(job.case, "bind", () => benchmark.bind(target));
    const weigh = benchmark.weigh ?? defaultWeigh;
    const sink = { value: 0 };
    const pass = () => {
      let local = 0;
      for (const input of inputs) local += weigh(fn(input));
      sink.value += local;
    };
    const call = (i: number) => {
      sink.value += weigh(fn(inputs[i % inputs.length]));
    };
    const shape: CorpusShape = {
      inputsPerPass: inputs.length,
      bytesPerPass: typeof corpus.bytes === "number" ? corpus.bytes : null,
    };
    const warmup = guard(job.case, "measured function", () => warmUp(pass, deps.clock));
    const before = sink.value;
    const result = guard(job.case, "measured function", () =>
      measureJob(job, shape, warmup, pass, call, deps),
    );
    if (!(sink.value > before) && measuredSomething(result)) {
      throw new Error(
        `@cosyte/bench: case "${job.case.benchmark} @ ${job.case.size}": the sink did not grow, so ` +
          "the measured loop may have been deleted by the compiler, or `weigh` gave nothing positive. " +
          "Supply a `weigh` that returns a positive number for a result.",
      );
    }
    return result;
  } finally {
    corpus.teardown?.();
  }
}

/**
 * The measuring process's main: read the job file, run it, write `{ ok, result }` or
 * `{ ok, error }` to the out file. Returns the exit code: 0 measured, 2 could not.
 *
 * @internal
 */
export async function childMain(jobFile: string, outFile: string, deps?: JobDeps): Promise<number> {
  try {
    const job = JSON.parse(readFileSync(jobFile, "utf8")) as Job;
    const result = await runJob(job, deps);
    writeFileSync(outFile, JSON.stringify({ ok: true, result }));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(outFile, JSON.stringify({ ok: false, error: message }));
    return 2;
  }
}
