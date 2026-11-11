import { describe, expect, it } from "vitest";

import type { AnyJob, Job, TimingResult } from "../src/child.js";
import { BENCH_CONTRACT } from "../src/contract.js";
import type { PeakReport } from "../src/memory.js";
import {
  budgetPeakBytes,
  readBuild,
  summarizeThroughput,
  type CaseReading,
} from "../src/reading.js";
import { checkSuite } from "../src/suite.js";
import { FLOOR_PEAK, fixedRunner, importCost, warmup } from "./support/bodies.js";

const suite = checkSuite({
  name: "s",
  benchmarks: [
    {
      name: "scan",
      sizes: [
        { label: "small", build: () => ({ inputs: [1] }) },
        { label: "large", build: () => ({ inputs: [1] }), compare: false },
      ],
      bind: () => (x: unknown) => x,
    },
    {
      name: "decode",
      sizes: [
        { label: "small", build: () => ({ inputs: [1] }) },
        { label: "large", build: () => ({ inputs: [1] }) },
      ],
      bind: () => (x: unknown) => x,
      longRun: "large",
    },
  ],
});

const options = {
  suiteFile: "/s.mjs",
  suite,
  target: "/t.mjs",
  measureImport: () => Promise.resolve(importCost),
};

describe("readBuild", () => {
  it("times each size of a benchmark in fresh processes, latency from the first, then its memory, then the import", async () => {
    const { jobs, runJob } = fixedRunner();
    const progress: string[] = [];
    const body = await readBuild({ ...options, runJob, onProgress: (l) => progress.push(l) });
    expect(body.processes).toBe(3);
    expect(body.importCost).toBe(importCost);
    expect(body.cases.map((c) => `${c.benchmark} @ ${c.size}`)).toEqual([
      "scan @ small",
      "scan @ large",
      "decode @ small",
      "decode @ large",
    ]);
    expect(
      jobs
        .slice(0, 10)
        .map(
          (j) =>
            `${j.case.size} ${j.mode === "timing" ? `timing ${String(j.latency)} ${String(j.inject)}` : j.mode}`,
        ),
    ).toEqual([
      "small timing true 0",
      "small timing false 0",
      "small timing false 0",
      "large timing true 0",
      "large timing false 0",
      "large timing false 0",
      "small alloc",
      "small heap",
      "large alloc",
      "large heap",
    ]);
    expect(jobs.every((j) => j.suite === "/s.mjs" && j.target === "/t.mjs")).toBe(true);
    expect(progress).toEqual([
      "read scan @ small",
      "read scan @ large",
      "read decode @ small",
      "read decode @ large",
    ]);
    const first = body.cases[0];
    expect(first).toMatchObject({
      inputsPerPass: 4,
      bytesPerPass: 4096,
      latency: { status: "measured", p50Ns: 500_000 },
      allocations: { status: "measured", heapBytesPerOp: 2048 },
      peak: { status: "measured" },
      throughput: {
        status: "measured",
        medianMsPerOp: 0.501,
        opsPerSecond: 1996.01,
        bytesPerSecond: 2043912,
      },
    });
    if (first?.throughput.status !== "measured") throw new Error("measured");
    expect(first.throughput.processes.map((p) => p.medianMsPerOp)).toEqual([0.5, 0.501, 0.502]);
  });

  const longRuns = (jobs: readonly Job[]) =>
    jobs
      .filter((j) => j.mode === "heap" && j.longRun)
      .map((j) => `${j.case.benchmark} @ ${j.case.size}`);

  it("runs the long run on the size the benchmark names, or its first size, and on its largest size that fits", async () => {
    const { jobs, runJob } = fixedRunner();
    const body = await readBuild({ ...options, runJob, processes: 1 });
    expect(longRuns(jobs)).toEqual(["scan @ small", "scan @ large", "decode @ large"]);
    expect(body.cases.map((c) => c.longRun?.status ?? null)).toEqual([
      "measured",
      "measured",
      null,
      "measured",
    ]);
  });

  it("leaves the long run off a large size whose rounds would not fit in 60 s", async () => {
    // Four inputs a pass: 500 ms an operation is a 2 s pass, 30 rounds of it exactly 60 s.
    const at = (ms: number) =>
      fixedRunner({ msPerOp: (job) => (job.case.size === "large" ? ms : 0.5) });
    const fits = at(500);
    await readBuild({ ...options, runJob: fits.runJob, processes: 1, only: ["scan"] });
    expect(longRuns(fits.jobs)).toEqual(["scan @ small", "scan @ large"]);
    const over = at(500.01);
    await readBuild({ ...options, runJob: over.runJob, processes: 1, only: ["scan"] });
    expect(longRuns(over.jobs)).toEqual(["scan @ small"]);
  });

  it("takes the next largest size that fits, and never a size whose throughput was skipped", async () => {
    const threeSizes = checkSuite({
      name: "three",
      benchmarks: [
        {
          name: "parse",
          sizes: ["a", "b", "c"].map((label) => ({ label, build: () => ({ inputs: [1] }) })),
          bind: () => (x: unknown) => x,
        },
      ],
    });
    const slowC = fixedRunner({ msPerOp: (job) => (job.case.size === "c" ? 1_000 : 0.5) });
    await readBuild({ ...options, suite: threeSizes, runJob: slowC.runJob, processes: 1 });
    expect(longRuns(slowC.jobs)).toEqual(["parse @ a", "parse @ b"]);
    // Calls 1 and 2 are the timing processes of sizes b and c: neither is measured.
    const skipped = fixedRunner({ skipTiming: (call) => call > 0 });
    await readBuild({ ...options, suite: threeSizes, runJob: skipped.runJob, processes: 1 });
    expect(longRuns(skipped.jobs)).toEqual(["parse @ a"]);
  });

  it("records the warmup plan each timing process ran", async () => {
    const { runJob } = fixedRunner({
      plan: (job) => (job.case.size === "large" ? "large" : "standard"),
    });
    const body = await readBuild({ ...options, runJob, only: ["scan"], memory: false });
    const plans = body.cases.map((c) =>
      c.throughput.status === "measured" ? c.throughput.processes.map((p) => p.plan) : [],
    );
    expect(plans).toEqual([
      ["standard", "standard", "standard"],
      ["large", "large", "large"],
    ]);
  });

  it("measures no memory and no import when asked not to", async () => {
    const { jobs, runJob } = fixedRunner();
    const body = await readBuild({
      ...options,
      runJob,
      processes: 1,
      memory: false,
      importCost: false,
      only: ["decode @ small"],
    });
    expect(jobs.map((j) => j.mode)).toEqual(["timing"]);
    expect(body.importCost).toBeNull();
    expect(body.cases[0]).toMatchObject({ allocations: null, peak: null, longRun: null });
  });

  it("reports a case with any skipped process as skipped, and keeps the first process's latency", async () => {
    const { runJob } = fixedRunner({ skipTiming: (call) => call === 1 });
    const body = await readBuild({
      ...options,
      runJob,
      only: ["scan @ small"],
      memory: false,
      importCost: false,
    });
    expect(body.cases[0]?.throughput).toEqual({ status: "skipped", reason: "warmup-unstable" });
    expect(body.cases[0]?.latency).toMatchObject({ status: "measured" });
  });

  it("has no latency when the first process skipped", async () => {
    const { runJob } = fixedRunner({ skipTiming: (call) => call === 0 });
    const body = await readBuild({
      ...options,
      runJob,
      processes: 1,
      only: ["scan @ small"],
      memory: false,
      importCost: false,
    });
    expect(body.cases[0]?.latency).toBeNull();
  });

  it("refuses a process count that is not a positive integer", async () => {
    const { runJob } = fixedRunner();
    await expect(readBuild({ ...options, runJob, processes: 0 })).rejects.toThrow(
      "@cosyte/bench: processes must be a positive integer",
    );
    await expect(readBuild({ ...options, runJob, processes: 1.5 })).rejects.toThrow(TypeError);
  });

  it("refuses a runner that answers with the wrong kind", async () => {
    const { runJob } = fixedRunner();
    const swapped = (job: AnyJob) =>
      job.mode === "floor"
        ? runJob(job)
        : runJob(
            job.mode === "timing"
              ? { mode: "alloc", suite: job.suite, target: job.target, case: job.case }
              : { ...job, mode: "timing", latency: false, inject: 0 },
          );
    await expect(readBuild({ ...options, runJob: swapped })).rejects.toThrow(
      "@cosyte/bench: a timing job returned another kind",
    );
    const memorySwapped = (job: AnyJob) =>
      runJob(
        job.mode === "timing" || job.mode === "floor"
          ? job
          : { ...job, mode: "timing", latency: false, inject: 0 },
      );
    await expect(readBuild({ ...options, runJob: memorySwapped })).rejects.toThrow(
      "@cosyte/bench: a memory job returned another kind",
    );
    const floorSwapped = (job: AnyJob) =>
      runJob(job.mode === "floor" ? { mode: "alloc", ...base0, case: c0 } : job);
    await expect(readBuild({ ...options, runJob: floorSwapped })).rejects.toThrow(
      "@cosyte/bench: a floor job returned another kind",
    );
    const floorForMemory = (job: AnyJob) => runJob(job.mode === "alloc" ? { mode: "floor" } : job);
    await expect(readBuild({ ...options, runJob: floorForMemory })).rejects.toThrow(
      "@cosyte/bench: a memory job returned another kind",
    );
  });

  it("measures the empty-call floor once per run, after the cases, and gives every peak above it", async () => {
    const order: string[] = [];
    const { counts, runJob } = fixedRunner();
    const body = await readBuild({
      ...options,
      runJob: (job) => {
        order.push(job.mode);
        return runJob(job);
      },
      processes: 1,
    });
    expect(counts.floors).toBe(1);
    expect(order.at(-1)).toBe("floor");
    expect(order.filter((m) => m === "floor")).toHaveLength(1);
    expect(body.memoryFloor).toEqual(FLOOR_PEAK);
    // 3 MiB raw, less the floor's median of 24 KiB; a median of 1 KiB under the floor reads 0.
    expect(body.cases[0]?.peak).toMatchObject({
      peakTotalBytes: 3 * 1024 * 1024,
      peakTotalAboveFloorBytes: 3 * 1024 * 1024 - 24_576,
      medianPeakTotalAboveFloorBytes: 0,
      peakHeapAboveFloorBytes: 3 * 1024 * 1024 - 24_576,
      peakExternalAboveFloorBytes: 0,
    });
    expect(body.failures).toEqual([]);
  });

  it("measures no floor when memory is off", async () => {
    const { counts, runJob } = fixedRunner();
    const body = await readBuild({ ...options, runJob, processes: 1, memory: false });
    expect(counts.floors).toBe(0);
    expect(body.memoryFloor).toBeNull();
  });

  it("lists a case whose timing failed, leaves it out, and writes every other case", async () => {
    const { runJob } = fixedRunner({
      fail: (j) => j.mode === "timing" && j.case.benchmark === "scan" && j.case.size === "large",
    });
    const progress: string[] = [];
    const body = await readBuild({
      ...options,
      runJob,
      processes: 1,
      onProgress: (l) => progress.push(l),
    });
    expect(body.cases.map((c) => `${c.benchmark} @ ${c.size}`)).toEqual([
      "scan @ small",
      "decode @ small",
      "decode @ large",
    ]);
    expect(body.failures).toEqual([
      {
        phase: "timing",
        benchmark: "scan",
        size: "large",
        message: "the timing job could not measure: synthetic",
      },
    ]);
    // The whole error, stderr and all, goes to the progress stream; the document keeps one line.
    expect(progress).toContain(
      "could not measure timing of scan @ large: the timing job could not measure: synthetic\nstderr line two",
    );
    expect(body.importCost).toBe(importCost);
  });

  it("keeps a case whose memory failed, with its timing and no memory, and goes on", async () => {
    const { runJob } = fixedRunner({
      fail: (j) => j.mode === "heap" && j.case.benchmark === "decode" && j.case.size === "small",
    });
    const body = await readBuild({ ...options, runJob, processes: 1 });
    expect(body.cases).toHaveLength(4);
    expect(body.cases[2]).toMatchObject({
      benchmark: "decode",
      size: "small",
      throughput: { status: "measured" },
      allocations: { status: "measured" },
      peak: null,
      longRun: null,
    });
    expect(body.cases[3]?.peak).toMatchObject({ status: "measured" });
    expect(body.failures).toEqual([
      {
        phase: "memory",
        benchmark: "decode",
        size: "small",
        message: "the heap job could not measure: synthetic",
      },
    ]);
  });

  it("lists a floor that failed, and leaves the peaks raw", async () => {
    const { runJob } = fixedRunner({ fail: (j) => j.mode === "floor" });
    const progress: string[] = [];
    const body = await readBuild({
      ...options,
      runJob,
      processes: 1,
      only: ["scan @ small"],
      onProgress: (l) => progress.push(l),
    });
    expect(body.memoryFloor).toBeNull();
    expect(body.failures).toEqual([
      {
        phase: "floor",
        benchmark: null,
        size: null,
        message: "the floor job could not measure: synthetic",
      },
    ]);
    expect(progress).toContain(
      "could not measure the memory floor: the floor job could not measure: synthetic\nstderr line two",
    );
    expect(body.cases[0]?.peak).not.toHaveProperty("peakTotalAboveFloorBytes");
  });

  it("records a thrown value that is not an Error by its text", async () => {
    const runJob = (job: AnyJob) => {
      if (job.mode === "floor") return Promise.reject(new Error("first\nsecond"));
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the branch under test is a thrown non-Error
      return Promise.reject("plain");
    };
    const progress: string[] = [];
    const body = await readBuild({
      ...options,
      runJob,
      processes: 1,
      only: ["scan @ small"],
      importCost: false,
      onProgress: (l) => progress.push(l),
    });
    expect(body.cases).toEqual([]);
    expect(body.failures?.map((f) => f.message)).toEqual(["plain", "first"]);
    expect(progress).toEqual([
      "could not measure timing of scan @ small: plain",
      "could not measure the memory floor: first\nsecond",
    ]);
  });
});

const c0 = { benchmark: "scan", size: "small" };
const base0 = { suite: "/s.mjs", target: "/t.mjs" };

describe("budgetPeakBytes", () => {
  const peak = (over: Partial<Extract<PeakReport, { status: "measured" }>> = {}): PeakReport => ({
    status: "measured",
    calls: 20,
    peakHeapBytes: 30_000,
    medianPeakHeapBytes: 29_000,
    peakTotalBytes: 31_000,
    medianPeakTotalBytes: 30_000,
    peakTotalAboveFloorBytes: 6_000,
    ...over,
  });
  const reading = (bytesPerPass: number | null, p: PeakReport | null, inputs = 2): CaseReading => ({
    ...c0,
    inputsPerPass: inputs,
    bytesPerPass,
    throughput: { status: "skipped", reason: "warmup-unstable" },
    latency: null,
    allocations: null,
    peak: p,
    longRun: null,
  });
  const limit = BENCH_CONTRACT.FLOOR_INPUT_BYTES;

  it("reads the total above the floor for an input under the stated size, and the raw total at it", () => {
    expect(limit).toBe(64 * 1024);
    // Two inputs a pass: the size is per input.
    expect(budgetPeakBytes(reading(2 * (limit - 1), peak()))).toBe(6_000);
    expect(budgetPeakBytes(reading(2 * limit, peak()))).toBe(31_000);
    expect(budgetPeakBytes(reading(2 * limit - 1, peak()))).toBe(6_000);
  });

  it("reads raw when the suite gave no bytes, the corpus is empty, or there is no floor figure", () => {
    expect(budgetPeakBytes(reading(null, peak()))).toBe(31_000);
    expect(budgetPeakBytes(reading(100, peak(), 0))).toBe(31_000);
    const { peakTotalAboveFloorBytes: _dropped, ...unfloored } = peak() as Extract<
      PeakReport,
      { status: "measured" }
    >;
    expect(budgetPeakBytes(reading(100, unfloored))).toBe(31_000);
  });

  it("reads the heap of a document written before the total, and nothing without a measured peak", () => {
    const old: PeakReport = {
      status: "measured",
      calls: 20,
      peakHeapBytes: 4096,
      medianPeakHeapBytes: 1024,
    };
    expect(budgetPeakBytes(reading(100, old))).toBe(4096);
    expect(budgetPeakBytes(reading(100, null))).toBeNull();
    expect(budgetPeakBytes(reading(100, { status: "skipped", reason: "gc-unsettled" }))).toBeNull();
  });
});

describe("summarizeThroughput", () => {
  const measured = (ms: number, bytesPerPass: number | null): TimingResult => ({
    mode: "timing",
    case: { benchmark: "a", size: "b" },
    inputsPerPass: 2,
    bytesPerPass,
    warmup,
    status: "measured",
    samplesMsPerOp: [ms],
    medianMsPerOp: ms,
    latency: null,
  });

  it("takes the median of the process medians, and bytes a second from bytes per operation", () => {
    expect(summarizeThroughput(measured(2, 1000), [measured(4, 1000), measured(3, 1000)])).toEqual({
      status: "measured",
      processes: [
        { samplesMsPerOp: [2], medianMsPerOp: 2, plan: "standard" },
        { samplesMsPerOp: [4], medianMsPerOp: 4, plan: "standard" },
        { samplesMsPerOp: [3], medianMsPerOp: 3, plan: "standard" },
      ],
      medianMsPerOp: 3,
      opsPerSecond: 333.33,
      bytesPerSecond: 166667,
    });
  });

  it("reports no bytes a second when the suite gave no bytes", () => {
    expect(summarizeThroughput(measured(2, null), [])).toMatchObject({
      bytesPerSecond: null,
      opsPerSecond: 500,
    });
  });
});
