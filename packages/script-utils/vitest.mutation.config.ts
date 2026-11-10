import { join } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * The Vitest config StrykerJS runs for @cosyte/script-utils, from the repository root: the root
 * suite and this package's own suite together, since the PHI-scan engine is tested from both.
 *
 * The root suite imports this package by its name, which resolves through `node_modules` to the
 * checkout, not to the copy Stryker mutates. The alias points every `@cosyte/script-utils` import
 * at the copy beside this file instead, so a mutant is seen by every suite that imports it.
 */
const here = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@cosyte\/script-utils$/, replacement: join(here, "index.js") },
      { find: /^@cosyte\/script-utils\/(.+)$/, replacement: join(here, "$1.js") },
    ],
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "packages/script-utils/test/**/*.test.ts"],
    exclude: [
      "test/phi-scan-superset.test.ts",
      "test/phi-scan-scaffold.test.ts",
      "test/script-utils-entrypoints.test.ts",
    ],
    setupFiles: ["test/no-network.setup.ts"],
    testTimeout: 120_000,
  },
});
