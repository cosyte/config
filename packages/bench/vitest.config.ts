import { defineConfig } from "vitest/config";

/**
 * Vitest config for @cosyte/bench.
 *
 * A plain config rather than the shared `cosyteVitest`, matching @cosyte/test-utils and
 * @cosyte/process. Coverage runs on every `pnpm test` and is held at 100% on every metric: this
 * package decides whether a pull request is called slower, so a branch no test reaches is a verdict
 * nobody has seen.
 *
 * No assertion reads a real clock for a number: the measuring code runs on scripted clocks and a
 * scripted heap (`test/support/clock.ts`, `memory.test.ts`), so coverage instrumentation, which
 * slows real code, cannot change a result. The end-to-end tests start real measuring processes and
 * check only what they report, never how fast.
 *
 * The three process entry files are left out of coverage: each is the lines around a function that
 * is covered in-process (`childMain`, `importMain`, `main`), and their own statements only ever run
 * in a child, which V8 coverage of this process does not see.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/child-entry.ts", "src/import-entry.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
