import type { Job, JobResult } from "../../src/child.js";
import type { CaseComparison } from "../../src/compare.js";
import type { Environment } from "../../src/environment.js";
import type { ImportCostReport } from "../../src/import-cost.js";

export const warmup = { stable: true, elapsedMs: 500, passes: 50, batches: [10, 10, 10] };

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

/** A runner that answers every job with fixed, plausible numbers, and records the jobs. */
export function fixedRunner(options: { skipTiming?: (call: number) => boolean } = {}) {
  const jobs: Job[] = [];
  const runJob = (job: Job): Promise<JobResult> => {
    const call = jobs.length;
    jobs.push(job);
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
        warmup,
        status: "measured",
        samplesMsPerOp: [0.5, 0.5, 0.5],
        medianMsPerOp: 0.5 + call / 1000,
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
  return { jobs, runJob };
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
