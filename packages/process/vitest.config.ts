import { defineConfig } from "vitest/config";

/**
 * Vitest config for @cosyte/process.
 *
 * A plain config rather than the shared `cosyteVitest`, matching @cosyte/test-utils: this package
 * ships the toolchain, so taking a dependency on another piece of it to test itself buys nothing.
 *
 * `test/fixtures/**` holds fixture-consumer trees (data), and `test/floor/**` holds the term-9
 * compatibility-floor test, which provisions node 22.22.2 and pnpm 10.0.0 from the registry and runs
 * under `pnpm test:floor` instead of on every run.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**", "test/floor/**"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Coverage runs with every `pnpm test` and writes the json-summary and lcov reports the
    // repository's floor file (`quality-floor.json`) is checked against.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
    },
  },
});
