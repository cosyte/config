import { configDefaults } from "vitest/config";

import config from "./vitest.config.js";

/**
 * The Vitest run StrykerJS uses for mutation testing (`stryker.config.mjs`): the suite of
 * `vitest.config.ts`, without two folders.
 *
 * - `test/perf/`: those tests read a clock and assert on ratios of time. Under Stryker's
 *   instrumentation every measured call pays for a mutant switch, so they measure the
 *   instrumentation, not the code.
 * - `test/scripts/`: those test this repository's own tooling in `scripts/`, not the library, and
 *   a mutant runs every test that reaches its line.
 */
export default {
  ...config,
  test: {
    ...config.test,
    exclude: [...configDefaults.exclude, "test/perf/**", "test/scripts/**"],
  },
};
