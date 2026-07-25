import { defineConfig } from "vitest/config";

/**
 * Config for the PERF-P0 calibration only. Deliberately separate from the repo's root config: the
 * root `pnpm test` must never pick this up (it takes tens of minutes and asserts nothing), and the
 * `--coverage` leg needs coverage wired to a target the calibration workload actually is.
 *
 * Everything else is left at Vitest's defaults ON PURPOSE — pool `forks`, `isolate: true`, default
 * concurrency (V3). A calibration that tuned the host would calibrate a host no gate will run under.
 * The one exception is `fileParallelism: false`: the sweep launches one file at a time anyway, and
 * concurrent forks contending for CPU is an artifact we want measured, not injected here.
 */
export default defineConfig({
  // Pin the root to this directory so the sweep can be driven from anywhere without the include
  // globs or the coverage target silently resolving against the caller's cwd.
  root: import.meta.dirname,
  test: {
    include: ["ratio-calibration.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["workload.ts"],
      reporter: ["text-summary"],
      reportsDirectory: "./coverage",
      thresholds: undefined,
    },
  },
});
