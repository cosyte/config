import { describe, expect, it } from "vitest";

import type { Job, JobResult } from "../src/child.js";
import {
  calibrateComparison,
  compareBuilds,
  comparisonExitCode,
  judge,
  summarizeCalibration,
  type CaseComparison,
} from "../src/compare.js";
import { BENCH_CONTRACT } from "../src/contract.js";
import { checkSuite } from "../src/suite.js";

const suite = checkSuite({
  name: "s",
  benchmarks: [
    {
      name: "a",
      sizes: [
        { label: "small", build: () => ({ inputs: [1] }) },
        { label: "huge", build: () => ({ inputs: [1] }), compare: false },
      ],
      bind: () => (x: unknown) => x,
    },
    {
      name: "b",
      sizes: [{ label: "small", build: () => ({ inputs: [1] }) }],
      bind: () => (x: unknown) => x,
    },
  ],
});

const warmup = { stable: true, elapsedMs: 500, passes: 50, batches: [10, 10, 10] };

/** A fake process runner: each side's time comes from `msFor`, and every job is recorded. */
function fakeRunner(msFor: (job: Job, call: number) => number | "skip") {
  const jobs: Job[] = [];
  const runJob = (job: Job): Promise<JobResult> => {
    const call = jobs.length;
    jobs.push(job);
    if (job.mode !== "timing") throw new Error("only timing jobs here");
    const ms = msFor(job, call);
    const shape = {
      mode: "timing" as const,
      case: job.case,
      inputsPerPass: 1,
      bytesPerPass: null,
      warmup,
    };
    if (ms === "skip")
      return Promise.resolve({ ...shape, status: "skipped", reason: "warmup-unstable" });
    // The fastest sample is `ms`; the others are slower, as a stalled sample is.
    return Promise.resolve({
      ...shape,
      status: "measured",
      samplesMsPerOp: [ms * 3, ms, ms * 2],
      medianMsPerOp: ms * 2,
      latency: null,
    });
  };
  return { jobs, runJob };
}

const options = { suiteFile: "/s.mjs", suite, base: "/base.mjs", head: "/head.mjs" };

describe("judge", () => {
  const twelve = (f: (i: number) => number) => Array.from({ length: 12 }, (_, i) => f(i));

  it("calls a regression only when the whole interval is above the threshold", () => {
    expect(judge(twelve((i) => 1.1 + (i % 3) / 100)).verdict).toBe("regression");
    // The 3rd smallest decides: two rounds at or under 1.03 still leave a regression.
    expect(judge([1, 1.03, ...twelve(() => 1.2).slice(2)]).verdict).toBe("regression");
    expect(judge([1, 1.02, 1.03, ...twelve(() => 1.2).slice(3)]).verdict).toBe("inconclusive");
  });

  it("calls an improvement when the whole interval is below 1 / 1.03", () => {
    expect(judge(twelve(() => 0.9)).verdict).toBe("improvement");
    expect(judge(twelve(() => 1 / 1.03)).verdict).toBe("no-regression");
  });

  it("calls no-regression when a slowdown over the threshold is ruled out", () => {
    const j = judge(twelve((i) => 1 + ((i % 5) - 2) / 100));
    expect(j.verdict).toBe("no-regression");
    expect(j.medianRatio).toBe(0.995);
    expect(j.interval).toMatchObject({ low: 0.98, high: 1.01, rank: 3 });
    expect(judge(twelve(() => 1.03)).verdict).toBe("no-regression");
  });

  it("calls a wide interval inconclusive", () => {
    expect(judge(twelve((i) => (i % 2 === 0 ? 0.9 : 1.1))).verdict).toBe("inconclusive");
  });

  it("calls too few rounds inconclusive", () => {
    expect(judge([2, 2, 2, 2])).toEqual({
      verdict: "inconclusive",
      interval: null,
      medianRatio: 2,
    });
  });

  it("takes the threshold and alpha it is given", () => {
    expect(
      judge(
        twelve(() => 1.04),
        0.05,
      ).verdict,
    ).toBe("no-regression");
    expect(
      judge(
        twelve(() => 1.04),
        0.03,
      ).verdict,
    ).toBe("regression");
    expect(
      judge([1, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2], 0.03, 0.001).verdict,
    ).toBe("inconclusive");
  });
});

describe("compareBuilds", () => {
  it("interleaves the sides, base first on even rounds, head first on odd, a case at a time", async () => {
    const { jobs, runJob } = fakeRunner(() => 1);
    const body = await compareBuilds({ ...options, runJob });
    expect(jobs).toHaveLength(BENCH_CONTRACT.ROUNDS * 2 * 2);
    const order = jobs
      .slice(0, 8)
      .map((j) => `${j.case.benchmark}:${j.mode === "timing" ? j.target : ""}`);
    expect(order).toEqual([
      "a:/base.mjs",
      "a:/head.mjs",
      "b:/base.mjs",
      "b:/head.mjs",
      "a:/head.mjs",
      "a:/base.mjs",
      "b:/head.mjs",
      "b:/base.mjs",
    ]);
    // Every round alternates, not only the first two: round r is base first exactly when r is even.
    for (let r = 0; r < BENCH_CONTRACT.ROUNDS; r++) {
      const first = jobs[r * 4];
      expect(first?.mode === "timing" ? first.target : "", `round ${String(r)}`).toBe(
        r % 2 === 0 ? "/base.mjs" : "/head.mjs",
      );
    }
    expect(body.cases.map((c) => c.verdict)).toEqual(["no-regression", "no-regression"]);
    expect(body).toMatchObject({ rounds: 12, threshold: 0.03, alpha: 0.05, inject: 0 });
  });

  it("divides head by base, round by round, and keeps every sample", async () => {
    // The base's fastest sample is 2 ms and the head's 2.2 ms: a ratio of 1.1, whatever the median.
    const { runJob } = fakeRunner((job) =>
      job.mode === "timing" && job.target === "/head.mjs" ? 2.2 : 2,
    );
    const body = await compareBuilds({ ...options, runJob, only: ["b"] });
    const c = body.cases[0];
    expect(c?.ratios).toEqual(Array.from({ length: 12 }, () => 1.1));
    expect(c?.baseMsPerOp).toEqual(Array.from({ length: 12 }, () => 2));
    expect(c?.headMsPerOp).toEqual(Array.from({ length: 12 }, () => 2.2));
    expect(c?.baseSamples).toEqual(Array.from({ length: 12 }, () => [6, 2, 4]));
    expect(c?.headSamples[0]).toEqual([6.6000000000000005, 2.2, 4.4]);
  });

  it("leaves out sizes marked compare: false", async () => {
    const { jobs, runJob } = fakeRunner(() => 1);
    await compareBuilds({ ...options, runJob });
    expect(jobs.some((j) => j.case.size === "huge")).toBe(false);
  });

  it("asks only for throughput, never latency, and injects only on the head side", async () => {
    const { jobs, runJob } = fakeRunner(() => 1);
    await compareBuilds({ ...options, runJob, inject: 0.05 });
    for (const job of jobs) {
      if (job.mode !== "timing") throw new Error("timing only");
      expect(job.latency).toBe(false);
      expect(job.inject).toBe(job.target === "/head.mjs" ? 0.05 : 0);
      expect(job.suite).toBe("/s.mjs");
    }
  });

  it("finds a 10% slowdown on the head as a regression, with its ratios", async () => {
    const { runJob } = fakeRunner((job) =>
      job.mode === "timing" && job.target === "/head.mjs" ? 1.1 : 1,
    );
    const body = await compareBuilds({ ...options, runJob, only: ["a"] });
    expect(body.cases).toHaveLength(1);
    const c = body.cases[0];
    expect(c).toMatchObject({
      benchmark: "a",
      size: "small",
      verdict: "regression",
      medianRatio: 1.1,
      skipReason: null,
    });
    expect(c?.ratios).toEqual(Array.from({ length: 12 }, () => 1.1));
    expect(c?.baseMsPerOp).toEqual(Array.from({ length: 12 }, () => 1));
    expect(c?.headSamples[0]).toEqual([3.3000000000000003, 1.1, 2.2]);
    expect(c?.baseSamples).toHaveLength(12);
    expect(comparisonExitCode(body)).toBe(1);
  });

  it("judges each round on each process's fastest sample, not its median", async () => {
    // The head's median is 30% worse in every round, from one stalled sample; its fastest is not.
    const runJob = (job: Job): Promise<JobResult> => {
      const head = job.mode === "timing" && job.target === "/head.mjs";
      const samples = head ? [1, 1.3, 1.3] : [1, 1, 1];
      return Promise.resolve({
        mode: "timing",
        case: job.case,
        inputsPerPass: 1,
        bytesPerPass: null,
        warmup,
        status: "measured",
        samplesMsPerOp: samples,
        medianMsPerOp: samples[1] ?? 0,
        latency: null,
      });
    };
    const body = await compareBuilds({ ...options, runJob, only: ["b"] });
    expect(body.cases[0]?.verdict).toBe("no-regression");
    expect(body.cases[0]?.medianRatio).toBe(1);
    expect(body.cases[0]?.headMsPerOp).toEqual(Array.from({ length: 12 }, () => 1));
  });

  it("stops measuring a case that skipped, and reports which side", async () => {
    const { jobs, runJob } = fakeRunner((job, call) =>
      job.case.benchmark === "b" && call > 10 && job.mode === "timing" && job.target === "/head.mjs"
        ? "skip"
        : 1,
    );
    const progress: string[] = [];
    const body = await compareBuilds({ ...options, runJob, onProgress: (l) => progress.push(l) });
    const b = body.cases.find((c) => c.benchmark === "b");
    expect(b).toMatchObject({
      verdict: "skipped",
      skipReason: "head: warmup-unstable",
      ratios: [],
      medianRatio: null,
      interval: null,
    });
    // Rounds 0 and 1 ran both sides of b; round 2 skipped on its head; b ran no more after that.
    expect(jobs.filter((j) => j.case.benchmark === "b")).toHaveLength(6);
    expect(b?.baseMsPerOp).toEqual([1, 1]);
    expect(comparisonExitCode(body)).toBe(2);
    expect(progress).toHaveLength(12);
    expect(progress[0]).toBe("round 1 of 12 done");
  });

  it("drops a round whose second side skipped, whichever side went first", async () => {
    // Round 3 runs the head first; its base then skips. The head's half round is not kept.
    const { runJob } = fakeRunner((job, call) =>
      job.case.benchmark === "b" && call > 14 && job.mode === "timing" && job.target === "/base.mjs"
        ? "skip"
        : 1,
    );
    const body = await compareBuilds({ ...options, runJob });
    const b = body.cases.find((c) => c.benchmark === "b");
    expect(b).toMatchObject({ verdict: "skipped", skipReason: "base: warmup-unstable" });
    expect(b?.headMsPerOp).toEqual([1, 1, 1]);
    expect(b?.baseSamples).toHaveLength(3);
  });

  it("refuses a runner that answers a timing job with something else", async () => {
    const runJob = (job: Job): Promise<JobResult> =>
      Promise.resolve({
        mode: "alloc",
        case: job.case,
        inputsPerPass: 1,
        bytesPerPass: null,
        allocations: null,
        peak: null,
        longRun: null,
      });
    await expect(compareBuilds({ ...options, runJob })).rejects.toThrow(
      /a timing job returned another kind/,
    );
  });

  it("exits 0 when nothing regressed or skipped", () => {
    expect(
      comparisonExitCode({ rounds: 12, threshold: 0.03, alpha: 0.05, inject: 0, cases: [] }),
    ).toBe(0);
  });
});

const verdictCase = (verdict: CaseComparison["verdict"]): CaseComparison => ({
  benchmark: "a",
  size: "small",
  baseMsPerOp: [],
  headMsPerOp: [],
  baseSamples: [],
  headSamples: [],
  ratios: [],
  medianRatio: null,
  interval: null,
  verdict,
  skipReason: null,
});

describe("summarizeCalibration", () => {
  it("counts false alarms per case and per comparison", () => {
    const runs = [
      [verdictCase("regression"), verdictCase("regression")],
      [verdictCase("no-regression"), verdictCase("inconclusive")],
      [verdictCase("improvement"), verdictCase("skipped")],
    ];
    const s = summarizeCalibration(0, runs);
    expect(s.perCase).toMatchObject({ events: 2, trials: 6, rate: 0.333333 });
    expect(s.perComparison).toMatchObject({ events: 1, trials: 3, rate: 0.333333 });
    expect(s.verdicts).toEqual({
      regression: 2,
      improvement: 1,
      "no-regression": 1,
      inconclusive: 1,
      skipped: 1,
    });
    expect(s.requiredRule).toEqual({
      applies: true,
      met: false,
      reason: expect.stringMatching(
        /^1 false alarm\(s\) in 3 A\/A comparisons: the upper bound .*% is not under 1%; a clean record needs at least 299 comparisons$/,
      ) as string,
    });
    expect(s.runs).toBe(runs);
    expect(s.comparisons).toBe(3);
  });

  it("meets the rule with 299 clean A/A comparisons, and not with 298", () => {
    const clean = (n: number) => Array.from({ length: n }, () => [verdictCase("no-regression")]);
    expect(summarizeCalibration(0, clean(299)).requiredRule).toEqual({
      applies: true,
      met: true,
      reason:
        "0 false alarm(s) in 299 A/A comparisons: the rate is under 1% with 95% confidence (upper bound 1%)",
    });
    expect(summarizeCalibration(0, clean(298)).requiredRule.met).toBe(false);
    expect(summarizeCalibration(0, clean(299)).perComparison.upperBound).toBeLessThan(0.01);
  });

  it("does not apply the rule to an injected slowdown", () => {
    const s = summarizeCalibration(0.05, [[verdictCase("regression")]]);
    expect(s.requiredRule).toEqual({
      applies: false,
      met: false,
      reason: "a calibration with an injected slowdown measures detection, not false alarms",
    });
    expect(s.inject).toBe(0.05);
  });

  it("reports zero runs as zero, with no confidence at all", () => {
    expect(summarizeCalibration(0, []).perComparison).toEqual({
      events: 0,
      trials: 0,
      rate: 0,
      upperBound: 1,
    });
  });
});

describe("calibrateComparison", () => {
  it("runs whole comparisons, reports each, and summarizes them", async () => {
    const { jobs, runJob } = fakeRunner((job, call) =>
      job.mode === "timing" && job.target === "/head.mjs" && call < 48 ? 1.2 : 1,
    );
    const progress: string[] = [];
    const body = await calibrateComparison({
      ...options,
      runJob,
      comparisons: 2,
      onProgress: (l: string) => progress.push(l),
    });
    expect(jobs).toHaveLength(2 * 48);
    expect(body.comparisons).toBe(2);
    expect(body.perComparison.events).toBe(1);
    expect(progress).toEqual([
      "comparison 1 of 2: regression on a @ small, b @ small",
      "comparison 2 of 2: no regression verdict",
    ]);
  });

  it("defaults to no injection", async () => {
    const { runJob } = fakeRunner(() => 1);
    expect((await calibrateComparison({ ...options, runJob, comparisons: 1 })).inject).toBe(0);
  });
});
