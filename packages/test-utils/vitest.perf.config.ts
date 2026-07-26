import { defineConfig } from "vitest/config";

/**
 * The perf gate's own, separate, **non-instrumented** invocation — `pnpm test:perf`.
 *
 * ADR 0001 §6 takes `test/perf/timed/**` out of the coverage-enabled run and puts it here.
 * `@vitest/coverage-v8` drives V8's most expensive precise-coverage mode (`kBlockCount`), which
 * lowers an effectful `Builtin::kIncBlockCounter` call into the measured function body in *every*
 * tier. Because it is effectful, TurboFan cannot hoist or sink it out of the timed loop, and its
 * cost scales with executed-block count and block density — which differ between the two phases a
 * ratio compares, so it does not cleanly cancel. P0 measured the consequence at Δ p95 44.1% on one
 * cell, tripping the pre-registered 15% decision rule.
 *
 * `fileParallelism` is off and `maxWorkers` is 1 because these tests measure wall-clock durations:
 * Vitest's default pool runs several test files concurrently (V3), and CPU/HT contention between
 * them is an unmodelled artifact that would land straight in the timings. Isolation stays on, so
 * each file still gets a fresh process and no JIT state crosses between them — which is the shape a
 * real gate runs in, one fresh fork per CI job.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/perf/timed/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
