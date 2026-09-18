import { defineConfig } from "vitest/config";

/**
 * Vitest config for @cosyte/script-utils.
 *
 * THIS PACKAGE HAD NO RUNNER AT ALL, and a test placed in a package without one does not run:
 * the repository's `test:packages` script is `pnpm --filter "./packages/*" run test`, so a package
 * with no `test` script is silently skipped. The shared `attw` gate is graded here rather than from
 * the repository root because it is this package's own published surface.
 *
 * A plain config rather than the shared `cosyteVitest`, for the same reason `@cosyte/test-utils`
 * gives: this package is zero-dependency by design and takes no dependency on
 * `@cosyte/vitest-config` for its own tests.
 *
 * The timeout is the gate's, not the harness's: every live case here shells out to a real
 * `npm pack` or `pnpm pack` through the gate, which is far past vitest's default.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
