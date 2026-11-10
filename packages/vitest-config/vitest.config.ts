import { defineConfig } from "vitest/config";

/**
 * Vitest config for this package's own suite: the Stryker config and `cosyte-mutate`. The coverage
 * factory and the snippet harness are tested from the repository's root suite (test/configs.test.ts,
 * test/doc-snippets.test.ts), so coverage here counts the two modules whose tests live here, and
 * writes the json-summary and lcov reports the repository's floor file is checked against.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["stryker.js", "mutate.js"],
      reporter: ["text-summary", "json-summary", "lcov"],
    },
  },
});
