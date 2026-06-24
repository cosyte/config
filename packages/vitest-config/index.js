import { defineConfig } from "vitest/config";

const GATE = { lines: 90, branches: 90, functions: 90, statements: 90 };

/**
 * Standard Vitest config for `@cosyte/*` packages: v8 coverage with `text`/`html`/`lcov` reporters,
 * the standard excludes (barrels, fixtures, generated, declarations), and **enabled, gating**
 * per-directory thresholds at >= 90. List your source subdirectories in `coverageDirs` to get a
 * per-directory gate on each (on top of the global gate).
 *
 * @param {object} [opts] - Options.
 * @param {string[]} [opts.coverageDirs] - `src/<dir>` subdirs to gate per-directory (e.g. `["parser"]`).
 * @param {Record<string, unknown>} [opts.coverageThresholds] - Extra/override `coverage.thresholds` keys.
 * @param {Record<string, unknown>} [opts.test] - Extra Vitest `test` options, merged last.
 * @returns {import("vitest/config").UserConfig} The Vitest config.
 * @example
 * // vitest.config.ts
 * import { cosyteVitest } from "@cosyte/vitest-config";
 * export default cosyteVitest({ coverageDirs: ["parser", "model", "serialize", "helpers"] });
 */
export function cosyteVitest(opts = {}) {
  const perDir = Object.fromEntries(
    (opts.coverageDirs ?? []).map((dir) => [`src/${dir}/**`, { ...GATE }]),
  );
  return defineConfig({
    test: {
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "lcov"],
        reportsDirectory: "./coverage",
        include: ["src/**/*.ts"],
        exclude: [
          "**/*.test.ts",
          "**/*.spec.ts",
          "**/index.ts",
          "**/*.d.ts",
          "**/__fixtures__/**",
          "**/generated/**",
        ],
        thresholds: { ...GATE, ...perDir, ...(opts.coverageThresholds ?? {}) },
      },
      ...(opts.test ?? {}),
    },
  });
}
