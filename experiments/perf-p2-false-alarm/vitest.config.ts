import { defineConfig } from "vitest/config";

/**
 * Config for the PERF-P2 false-alarm sweep only. Separate from the repo's root config for the same
 * reason P0's is: the root `pnpm test` must never pick this up — it takes tens of minutes and
 * asserts nothing.
 *
 * No coverage leg. ADR 0001 §6 already decided that question with P0's data (`test/perf/**` comes
 * out of the coverage run), so the shipped regime is coverage-off and that is the only regime worth
 * re-measuring the ceiling against.
 *
 * Everything else is left at Vitest's defaults ON PURPOSE, exactly as P0 left them — a sweep that
 * tuned the host would measure a host no gate runs under. `fileParallelism: false` is the one
 * exception, and it is a no-op here: the driver launches one file per process anyway.
 */
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["false-alarm.test.ts"],
    fileParallelism: false,
  },
});
