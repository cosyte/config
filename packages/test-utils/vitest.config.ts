import { defineConfig } from "vitest/config";

/**
 * Vitest config for @cosyte/test-utils.
 *
 * This package ships generic, framework-agnostic runners that throw on failure; its own tests
 * (in `test/`) exercise each runner against a tiny in-file fake parser. A plain config is used
 * here rather than the shared `cosyteVitest` so the kit does not take a dependency on
 * `@cosyte/vitest-config` (a parser would; the test kit itself need not).
 *
 * `test/perf/timed/**` is excluded and runs under `vitest.perf.config.ts` via `pnpm test:perf`.
 * Those are the only tests here that read a clock, and ADR 0001 §6 puts clock-reading tests in
 * their own non-instrumented invocation. Everything else about the perf kit — the frozen contract,
 * the two estimators, the warmup stability rule, corpus construction, the fixture-size verdict and
 * the PHI rule on diagnostics — is clock-free and stays in this run, so `scripts/verify.sh config`
 * still exercises it.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/perf/timed/**"],
  },
});
