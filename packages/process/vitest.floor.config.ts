import { defineConfig } from "vitest/config";

/**
 * Vitest config for the term-9 compatibility-floor test only.
 *
 * It is a separate invocation because it is the one test here that provisions a toolchain from the
 * npm registry (node 22.0.x and pnpm 10.0.0) and installs a packed tarball into an out-of-tree
 * fixture. That takes minutes and needs a network, so putting it in the default run would make every
 * `pnpm test` a network gate. Run it with `pnpm test:floor`.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/floor/**/*.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
