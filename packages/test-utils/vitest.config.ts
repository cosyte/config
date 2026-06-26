import { defineConfig } from "vitest/config";

/**
 * Vitest config for @cosyte/test-utils.
 *
 * This package ships generic, framework-agnostic runners that throw on failure; its own tests
 * (in `test/`) exercise each runner against a tiny in-file fake parser. A plain config is used
 * here rather than the shared `cosyteVitest` so the kit does not take a dependency on
 * `@cosyte/vitest-config` (a parser would; the test kit itself need not).
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
