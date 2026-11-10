import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  childMain,
  guard,
  measuredSomething,
  msPerOp,
  runJob,
  type Job,
  type JobDeps,
} from "../src/child.js";
import { BENCH_CONTRACT } from "../src/contract.js";
import type { HeapProbe } from "../src/memory.js";
import { fakeClock, fakeNs } from "./support/clock.js";
import { FIXTURES } from "./support/paths.js";

/** A heap that never moves: every collection reclaims nothing, nothing ever collects. */
const stillHeap: HeapProbe = {
  gc: () => undefined,
  usedHeap: () => 1_000_000,
  external: () => 0,
  profile: (fn) => {
    fn();
    return { gcs: 0, peakBeforeGc: 0 };
  },
};

const deps = (probe: HeapProbe | null = stillHeap): JobDeps => ({
  clock: fakeClock(10).now,
  ns: fakeNs(10n).ns,
  probe,
});

const base = { suite: FIXTURES.suite, target: FIXTURES.target };
const timing = (
  benchmark: string,
  size = "one",
  extra: { latency?: boolean; inject?: number } = {},
): Job => {
  const job: Job = {
    mode: "timing",
    ...base,
    case: { benchmark, size },
    latency: extra.latency ?? true,
    inject: extra.inject ?? 0,
  };
  return job;
};

const teardowns = () => (globalThis as { benchTeardowns?: number }).benchTeardowns ?? 0;

beforeEach(() => {
  (globalThis as { benchTeardowns?: number }).benchTeardowns = 0;
});

describe("runJob: timing", () => {
  it("warms up, samples, times single calls, and tears down", async () => {
    const result = await runJob(timing("length", "small"), deps());
    expect(result).toMatchObject({
      mode: "timing",
      case: { benchmark: "length", size: "small" },
      inputsPerPass: 2,
      bytesPerPass: 5,
      status: "measured",
      warmup: { stable: true },
    });
    if (result.mode !== "timing" || result.status !== "measured") throw new Error("measured");
    // Each pass reads the clock once, 10 ms a read, over 2 inputs.
    expect(result.samplesMsPerOp).toEqual(Array.from({ length: BENCH_CONTRACT.SAMPLES }, () => 5));
    expect(result.medianMsPerOp).toBe(5);
    expect(result.latency).toMatchObject({
      status: "skipped",
      reason: "latency-below-timer-resolution",
    });
    expect(teardowns()).toBe(1);
  });

  it("leaves latency out when not asked, and reports no bytes when the suite gave none", async () => {
    const result = await runJob(timing("length", "large", { latency: false }), deps());
    expect(result).toMatchObject({
      status: "measured",
      latency: null,
      bytesPerPass: null,
      inputsPerPass: 1,
    });
  });

  it("injects the slowdown it is given", async () => {
    const plain = await runJob(timing("length", "large", { latency: false }), deps());
    const slowed = await runJob(timing("length", "large", { latency: false, inject: 1 }), deps());
    if (plain.mode !== "timing" || plain.status !== "measured") throw new Error("measured");
    if (slowed.mode !== "timing" || slowed.status !== "measured") throw new Error("measured");
    expect(slowed.medianMsPerOp).toBeGreaterThan(plain.medianMsPerOp * 1.5);
  });

  it("skips, typed, when the warmup never settles, and still tears down", async () => {
    // Every read of the clock is 10% further on than the last: the code never settles.
    let t = 0;
    let step = 10;
    const jumpy: JobDeps = { ...deps(), clock: () => (t += step *= 1.1) };
    const result = await runJob(timing("length", "small"), jumpy);
    expect(result).toMatchObject({
      mode: "timing",
      status: "skipped",
      reason: "warmup-unstable",
      warmup: { stable: false },
    });
    expect(teardowns()).toBe(1);
  });
});

describe("runJob: memory", () => {
  it("measures allocations in the alloc mode", async () => {
    const result = await runJob(
      { mode: "alloc", ...base, case: { benchmark: "length", size: "small" } },
      deps(),
    );
    expect(result).toMatchObject({
      mode: "alloc",
      allocations: { status: "measured", heapBytesPerOp: 0, externalBytesPerOp: 0, windowOps: 20 },
      peak: null,
      longRun: null,
    });
  });

  it("measures the peak, and the long run when asked, in the heap mode", async () => {
    const withLong = await runJob(
      { mode: "heap", ...base, case: { benchmark: "length", size: "large" }, longRun: true },
      deps(),
    );
    expect(withLong).toMatchObject({
      mode: "heap",
      allocations: null,
      peak: { status: "measured", peakHeapBytes: 0 },
      longRun: { status: "measured", verdict: "flat" },
    });
    const without = await runJob(
      { mode: "heap", ...base, case: { benchmark: "length", size: "large" }, longRun: false },
      deps(),
    );
    expect(without).toMatchObject({ longRun: null, peak: { status: "measured" } });
  });

  it("skips every memory measurement, typed, without gc", async () => {
    const skipped = { status: "skipped", reason: "gc-unavailable" };
    expect(
      await runJob(
        { mode: "alloc", ...base, case: { benchmark: "length", size: "small" } },
        deps(null),
      ),
    ).toMatchObject({ allocations: skipped });
    expect(
      await runJob(
        { mode: "heap", ...base, case: { benchmark: "length", size: "small" }, longRun: true },
        deps(null),
      ),
    ).toMatchObject({
      peak: skipped,
      longRun: skipped,
    });
  });
});

describe("runJob: refusals", () => {
  it("refuses a loop whose sink did not grow", async () => {
    await expect(runJob(timing("nothing"), deps())).rejects.toThrow(
      '@cosyte/bench: case "nothing @ one": the sink did not grow, so the measured loop may have been deleted by the compiler, or `weigh` gave nothing positive. Supply a `weigh` that returns a positive number for a result.',
    );
    await expect(runJob(timing("null"), deps())).rejects.toThrow(
      /case "null @ one": the sink did not grow/,
    );
    await expect(
      runJob({ mode: "alloc", ...base, case: { benchmark: "nothing", size: "one" } }, deps()),
    ).rejects.toThrow(/the sink did not grow/);
  });

  it("refuses an empty corpus, or one that is not a list", async () => {
    await expect(runJob(timing("empty"), deps())).rejects.toThrow(
      /case "empty @ one" built an empty corpus/,
    );
    await expect(runJob(timing("not an array"), deps())).rejects.toThrow(/built an empty corpus/);
  });

  it("refuses a module that is not a suite, and a case the suite lacks", async () => {
    await expect(
      runJob({ ...timing("length"), suite: FIXTURES.notASuite }, deps()),
    ).rejects.toThrow(TypeError);
    await expect(runJob(timing("length", "medium"), deps())).rejects.toThrow(
      /has no case "length @ medium"/,
    );
  });

  it("never repeats what the measured function threw, and still tears down", async () => {
    const error = await runJob(timing("boom"), deps()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe(
      '@cosyte/bench: case "boom @ one": the suite\'s measured function threw (RangeError). Its message is not printed, because it may quote an input; run the case directly to read it.',
    );
    expect(message).not.toContain("QUOTED-INPUT-VALUE");
    expect(((error as Error).cause as Error).message).toContain("QUOTED-INPUT-VALUE");
    expect(teardowns()).toBe(1);
  });

  it("guards the measurement after the warmup too", async () => {
    const message = await runJob(timing("boom later"), deps()).catch(
      (e: unknown) => (e as Error).message,
    );
    expect(message).toMatch(
      /case "boom later @ one": the suite's measured function threw \(RangeError\)/,
    );
  });

  it("never repeats what a build threw, or a thrown string", async () => {
    const build = await runJob(timing("bad build"), deps()).catch(
      (e: unknown) => (e as Error).message,
    );
    expect(build).toMatch(/the suite's build threw \(TypeError\)/);
    expect(build).not.toContain("QUOTED-INPUT-VALUE");
    const thrown = await runJob(timing("throws a string"), deps()).catch(
      (e: unknown) => (e as Error).message,
    );
    expect(thrown).toMatch(/the suite's measured function threw \(string\)/);
    expect(thrown).not.toContain("QUOTED-INPUT-VALUE");
  });

  it("guards bind too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-bind-"));
    const suite = join(dir, "suite.mjs");
    writeFileSync(
      suite,
      `export default { name: "s", benchmarks: [{ name: "b", sizes: [{ label: "one", build: () => ({ inputs: [1] }) }], bind: () => { throw new Error("QUOTED-INPUT-VALUE"); } }] };\n`,
    );
    const message = await runJob({ ...timing("b"), suite }, deps()).catch(
      (e: unknown) => (e as Error).message,
    );
    expect(message).toMatch(/the suite's bind threw \(Error\)/);
  });
});

describe("guard, msPerOp and measuredSomething", () => {
  const shape = { case: { benchmark: "a", size: "b" }, inputsPerPass: 1, bytesPerPass: null };
  const warm = { stable: true, elapsedMs: 0, passes: 0, batches: [] };

  it("says whether a job measured anything", () => {
    expect(
      measuredSomething({
        mode: "timing",
        ...shape,
        warmup: warm,
        status: "skipped",
        reason: "warmup-unstable",
      }),
    ).toBe(false);
    expect(
      measuredSomething({
        mode: "timing",
        ...shape,
        warmup: warm,
        status: "measured",
        samplesMsPerOp: [],
        medianMsPerOp: 0,
        latency: null,
      }),
    ).toBe(true);
    const skipped = { status: "skipped", reason: "gc-unavailable" } as const;
    expect(
      measuredSomething({
        mode: "heap",
        ...shape,
        allocations: null,
        peak: skipped,
        longRun: null,
      }),
    ).toBe(false);
    expect(
      measuredSomething({
        mode: "heap",
        ...shape,
        allocations: null,
        peak: skipped,
        longRun: {
          status: "measured",
          verdict: "flat",
          ops: 1,
          opsPerRound: 1,
          settledHeap: [],
          slopeBytesPerOp: 0,
          growthBytes: 0,
          detectableBytesPerOp: 0,
        },
      }),
    ).toBe(true);
    expect(
      measuredSomething({
        mode: "alloc",
        ...shape,
        allocations: { status: "measured", windowOps: 1, heapBytesPerOp: 0, externalBytesPerOp: 0 },
        peak: null,
        longRun: null,
      }),
    ).toBe(true);
    expect(
      measuredSomething({
        mode: "heap",
        ...shape,
        allocations: null,
        peak: { status: "measured", calls: 1, peakHeapBytes: 0, medianPeakHeapBytes: 0 },
        longRun: null,
      }),
    ).toBe(true);
  });

  it("passes a value through", () => {
    expect(guard({ benchmark: "a", size: "b" }, "build", () => 7)).toBe(7);
  });

  it("reads the warmup's last pace per operation", () => {
    expect(
      msPerOp(
        { stable: true, elapsedMs: 0, passes: 0, batches: [9, 8, 6] },
        { inputsPerPass: 3, bytesPerPass: null },
      ),
    ).toBe(2);
    expect(
      msPerOp(
        { stable: true, elapsedMs: 0, passes: 0, batches: [] },
        { inputsPerPass: 3, bytesPerPass: null },
      ),
    ).toBe(0);
  });
});

describe("childMain", () => {
  const files = (job: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "bench-child-"));
    const jobFile = join(dir, "job.json");
    const outFile = join(dir, "out.json");
    if (job !== undefined) writeFileSync(jobFile, JSON.stringify(job));
    return { jobFile, outFile, out: () => JSON.parse(readFileSync(outFile, "utf8")) as unknown };
  };

  it("writes what it measured and exits 0", async () => {
    const f = files(timing("length", "small", { latency: false }));
    expect(await childMain(f.jobFile, f.outFile, deps())).toBe(0);
    expect(f.out()).toMatchObject({ ok: true, result: { status: "measured" } });
  });

  it("writes why it could not and exits 2", async () => {
    const f = files(timing("nothing"));
    expect(await childMain(f.jobFile, f.outFile, deps())).toBe(2);
    expect(f.out()).toEqual({
      ok: false,
      error: expect.stringMatching(/the sink did not grow/) as string,
    });
  });

  it("measures on the real clocks and heap when given none", async () => {
    const f = files(timing("length", "small", { latency: true }));
    expect(await childMain(f.jobFile, f.outFile)).toBe(0);
    expect(f.out()).toMatchObject({
      ok: true,
      result: { status: "measured", warmup: { stable: true } },
    });
    const out = f.out() as { result: { latency: { p50Ns: number } } };
    expect(out.result.latency.p50Ns).toBeGreaterThan(0);
  });

  it("exits 2 on a job file it cannot read", async () => {
    const f = files(undefined);
    expect(await childMain(f.jobFile, f.outFile, deps())).toBe(2);
    expect(f.out()).toMatchObject({ ok: false });
  });

  it("reports a module that throws something that is not an Error as it loads", async () => {
    const f = files({ ...timing("length", "small"), suite: FIXTURES.throwsOnImport });
    expect(await childMain(f.jobFile, f.outFile, deps())).toBe(2);
    expect(f.out()).toEqual({ ok: false, error: "a suite that would not load" });
  });

  it("reports something thrown that is not an Error", async () => {
    const f = files(timing("length", "small"));
    const throwing: JobDeps = {
      ...deps(),
      clock: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the branch under test is a thrown non-Error
        throw "plain";
      },
    };
    expect(await childMain(f.jobFile, f.outFile, throwing)).toBe(2);
    expect(f.out()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/threw \(string\)/) as string,
    });
  });
});
