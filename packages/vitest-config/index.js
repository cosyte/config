import { defineConfig } from "vitest/config";

import { findBarrels } from "./stryker.js";

const GATE = { lines: 90, branches: 90, functions: 90, statements: 90 };

/**
 * Standard Vitest config for `@cosyte/*` packages: v8 coverage with `text`/`html`/`lcov`/`json-summary` reporters,
 * the standard excludes (tests, declarations, fixtures, generated code, and the barrels under `src/`),
 * and **enabled, gating** per-directory thresholds at >= 90. List your source subdirectories in
 * `coverageDirs` to get a per-directory gate on each (on top of the global gate).
 *
 * A barrel is a file that holds nothing but re-exports, decided by reading each file under `src/`
 * (see `findBarrels` in `stryker.js`), never by its name: an `index.ts` that holds code is measured.
 *
 * @param {object} [opts] - Options.
 * @param {string[]} [opts.coverageDirs] - `src/<dir>` subdirs to gate per-directory (e.g. `["parser"]`).
 * @param {Record<string, unknown>} [opts.coverageThresholds] - Extra/override `coverage.thresholds` keys.
 * @param {Record<string, unknown>} [opts.test] - Extra Vitest `test` options, merged last.
 * @param {string} [opts.root] - The project root whose `src/` is read for barrels; the working directory by default.
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
        // lcov and json-summary are what `cosyte-ratchet` (@cosyte/script-utils) reads: the
        // changed lines that ran, and the totals the floor file holds.
        reporter: ["text", "html", "lcov", "json-summary"],
        reportsDirectory: "./coverage",
        include: ["src/**/*.ts"],
        exclude: [
          "**/*.test.ts",
          "**/*.spec.ts",
          "**/*.d.ts",
          "**/__fixtures__/**",
          "**/generated/**",
          ...findBarrels(opts.root),
        ],
        thresholds: { ...GATE, ...perDir, ...(opts.coverageThresholds ?? {}) },
      },
      ...(opts.test ?? {}),
    },
  });
}
