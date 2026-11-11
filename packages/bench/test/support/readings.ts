import type { CaseReading } from "../../src/reading.js";
import type { ReadingDocument } from "../../src/gate.js";
import { documentBase } from "../../src/results.js";
import { env, importCost } from "./bodies.js";

/**
 * One case of a reading, with plain synthetic numbers: 4 inputs of 1 KiB a pass, 0.5 ms an
 * operation, 2 KiB allocated an operation and a median peak of 6 KiB above the empty-call floor.
 */
export function caseReading(over: Partial<CaseReading> = {}): CaseReading {
  return {
    benchmark: "parse",
    size: "1 KiB",
    inputsPerPass: 4,
    bytesPerPass: 4096,
    throughput: {
      status: "measured",
      processes: [{ samplesMsPerOp: [0.5], medianMsPerOp: 0.5 }],
      medianMsPerOp: 0.5,
      opsPerSecond: 2000,
      bytesPerSecond: 2_048_000,
    },
    latency: null,
    allocations: {
      status: "measured",
      windowOps: 64,
      heapBytesPerOp: 2000,
      externalBytesPerOp: 48,
    },
    peak: {
      status: "measured",
      calls: 20,
      peakHeapBytes: 40_000,
      medianPeakHeapBytes: 9_000,
      peakTotalBytes: 40_000,
      medianPeakTotalBytes: 9_000,
      medianPeakTotalAboveFloorBytes: 6_144,
    },
    longRun: null,
    ...over,
  };
}

/** A reading document from a GitHub-hosted runner, of the given cases. */
export function readingDoc(
  cases: readonly CaseReading[] = [caseReading()],
  over: {
    readonly commit?: string | null;
    readonly suite?: string;
    readonly node?: string;
    readonly runner?: Partial<(typeof env)["runner"]>;
    readonly importCost?: typeof importCost | null;
  } = {},
): ReadingDocument {
  const environment = {
    ...env,
    node: over.node ?? env.node,
    runner: { ...env.runner, ...over.runner },
  };
  return {
    ...documentBase(
      { name: over.suite ?? "@cosyte/example parse", file: "bench/parse.bench.mjs" },
      environment,
      new Date("2026-11-11T00:00:00Z"),
    ),
    kind: "reading",
    subject: {
      target: "dist/index.mjs",
      commit: over.commit === undefined ? "abc123" : over.commit,
    },
    reading: {
      processes: 3,
      cases,
      importCost: over.importCost === undefined ? importCost : over.importCost,
    },
  };
}
