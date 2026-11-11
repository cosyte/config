import type { AnyJob, AnyJobResult, Job } from "../../src/child.js";
import type { CaseComparison } from "../../src/compare.js";
import type { Environment } from "../../src/environment.js";
import type { ImportCostReport } from "../../src/import-cost.js";
import type { PeakReport } from "../../src/memory.js";
import { BenchError } from "../../src/spawn.js";

export const warmup = {
  stable: true,
  elapsedMs: 500,
  passes: 50,
  batches: [10, 10, 10],
  plan: "standard",
} as const;

export const env: Environment = {
  node: "v24.0.0",
  v8: "13.0",
  platform: "linux",
  arch: "x64",
  osRelease: "6.0",
  cpuModel: "Synthetic CPU",
  logicalCpus: 4,
  totalMemoryBytes: 16 * 1024 ** 3,
  cgroupCpuMax: null,
  nodeOptionsSet: false,
  loadAverage: [0.5, 0.4, 0.3],
  runner: {
    ci: true,
    provider: "github-actions",
    environment: "github-hosted",
    imageOS: "ubuntu24",
    imageVersion: "1",
    class: "github-actions-github-hosted-ubuntu24-x64",
  },
};

export const importCost: ImportCostReport = {
  runs: 2,
  coldImportMs: [2, 3],
  medianMs: 2.5,
  p95Ms: 3,
  emptyImportMs: [0.2, 0.3],
  emptyMedianMs: 0.25,
  files: [{ path: "dist/index.mjs", bytes: 2048, gzipBytes: 900 }],
  totalBytes: 2048,
  totalGzipBytes: 900,
};

/** The empty-call floor the fixed runner reports: 24 KiB of probe, all of it heap. */
export const FLOOR_PEAK: PeakReport = {
  status: "measured",
  calls: 20,
  peakHeapBytes: 26_000,
  medianPeakHeapBytes: 24_576,
  peakExternalBytes: 0,
  medianPeakExternalBytes: 0,
  peakTotalBytes: 26_000,
  medianPeakTotalBytes: 24_576,
};

/** A runner that answers every job with fixed, plausible numbers, and records the jobs. */
export function fixedRunner(
  options: {
    skipTiming?: (call: number) => boolean;
    /** Milliseconds per operation for a timing job; 0.5, a little more each call, by default. */
    msPerOp?: (job: Job, call: number) => number;
    /** The warmup plan a timing job reports. */
    plan?: (job: Job) => "standard" | "large";
    /** Fail a job the way a measuring process that could not measure does. */
    fail?: (job: AnyJob) => boolean;
  } = {},
) {
  /** The case jobs, in order. The floor jobs are counted in `floors`. */
  const jobs: Job[] = [];
  const counts = { floors: 0 };
  const runJob = (job: AnyJob): Promise<AnyJobResult> => {
    const failed = options.fail?.(job) === true;
    const reject = () =>
      Promise.reject(
        new BenchError(`the ${job.mode} job could not measure: synthetic\nstderr line two`),
      );
    if (job.mode === "floor") {
      counts.floors++;
      return failed ? reject() : Promise.resolve({ mode: "floor", peak: FLOOR_PEAK });
    }
    const call = jobs.length;
    jobs.push(job);
    if (failed) return reject();
    const shape = { case: job.case, inputsPerPass: 4, bytesPerPass: 4096 };
    if (job.mode === "timing") {
      if (options.skipTiming?.(call) === true) {
        return Promise.resolve({
          mode: "timing",
          ...shape,
          warmup,
          status: "skipped",
          reason: "warmup-unstable",
        });
      }
      return Promise.resolve({
        mode: "timing",
        ...shape,
        warmup: { ...warmup, plan: options.plan?.(job) ?? "standard" },
        status: "measured",
        samplesMsPerOp: [0.5, 0.5, 0.5],
        medianMsPerOp: options.msPerOp?.(job, call) ?? 0.5 + call / 1000,
        latency: job.latency
          ? {
              status: "measured",
              calls: 1000,
              timerOverheadNs: 40,
              p50Ns: 500_000,
              p95Ns: 600_000,
              p99Ns: null,
              maxNs: 900_000,
            }
          : null,
      });
    }
    if (job.mode === "alloc") {
      return Promise.resolve({
        mode: "alloc",
        ...shape,
        allocations: {
          status: "measured",
          windowOps: 64,
          heapBytesPerOp: 2048,
          externalBytesPerOp: 0,
        },
        peak: null,
        longRun: null,
      });
    }
    return Promise.resolve({
      mode: "heap",
      ...shape,
      allocations: null,
      peak: {
        status: "measured",
        calls: 20,
        peakHeapBytes: 3 * 1024 * 1024,
        medianPeakHeapBytes: 1024,
        peakExternalBytes: 0,
        medianPeakExternalBytes: 0,
        peakTotalBytes: 3 * 1024 * 1024,
        medianPeakTotalBytes: 1024,
      },
      longRun: job.longRun
        ? {
            status: "measured",
            verdict: "flat",
            ops: 3000,
            opsPerRound: 100,
            settledHeap: [1, 1],
            slopeBytesPerOp: 0.01,
            growthBytes: 24,
            detectableBytesPerOp: 27.3,
          }
        : null,
    });
  };
  return { jobs, counts, runJob };
}

export const caseComparison = (over: Partial<CaseComparison> = {}): CaseComparison => ({
  benchmark: "scan",
  size: "1 KiB",
  baseMsPerOp: [1, 1],
  headMsPerOp: [1.1, 1.1],
  baseSamples: [[1], [1]],
  headSamples: [[1.1], [1.1]],
  ratios: [1.1, 1.1],
  medianRatio: 1.1,
  interval: { low: 1.08, high: 1.12, rank: 3, tail: 0.0193 },
  verdict: "regression",
  skipReason: null,
  ...over,
});
