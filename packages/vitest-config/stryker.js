// @cosyte/vitest-config/stryker
//
// THE SHARED STRYKERJS CONFIG, for mutation testing with the Vitest runner. It sits in this package
// because it runs the same Vitest suites over the same source files this package's coverage config
// measures, and every package that would use it already depends on this one. StrykerJS itself is an
// optional peer: a package that does not run mutation testing never installs it.

import { fileURLToPath } from "node:url";

/** The directory every run writes its reports under, relative to the directory Stryker runs in. */
export const REPORT_DIR = "reports/mutation";

/** The full run's JSON report: the mutation score the floor file holds is read from here. */
export const FULL_REPORT = `${REPORT_DIR}/mutation.json`;

/**
 * The changed-files run's JSON report. It is a separate file so that a run over a few files can
 * never be read as the whole package's score.
 */
export const CHANGED_REPORT = `${REPORT_DIR}/changed.json`;

/**
 * The files a run mutates by default: the source `@cosyte/vitest-config` measures coverage over,
 * without the files it leaves out (tests, barrels, declarations, fixtures, generated code).
 */
export const DEFAULT_MUTATE = Object.freeze([
  "src/**/*.ts",
  "!src/**/*.test.ts",
  "!src/**/*.spec.ts",
  "!src/**/*.d.ts",
  "!src/**/index.ts",
  "!src/**/__fixtures__/**",
  "!src/**/generated/**",
]);

/**
 * The HTML report that sits beside a JSON report, for a person reading the surviving mutants.
 *
 * @param {string} jsonReport A report path ending in `.json`.
 * @returns {string} The same path ending in `.html`.
 */
export function htmlReportFor(jsonReport) {
  return jsonReport.replace(/\.json$/, ".html");
}

/**
 * The absolute path of the Vitest runner plugin. Stryker loads plugins named by a bare specifier
 * from its own install, and under pnpm that install cannot see a sibling package, so a run would
 * start with no test runner. A path resolved from this package works under pnpm, npm and Yarn.
 *
 * @param {(specifier: string) => string} [resolve] Resolves a specifier to a module URL.
 * @returns {string} The plugin's entry file.
 */
export function resolveVitestRunner(resolve = (specifier) => import.meta.resolve(specifier)) {
  try {
    return fileURLToPath(resolve("@stryker-mutator/vitest-runner"));
  } catch (cause) {
    throw new Error(
      "@cosyte/vitest-config/stryker: @stryker-mutator/vitest-runner is not installed. Add it and " +
        "@stryker-mutator/core as devDependencies.",
      { cause },
    );
  }
}

/**
 * The shared StrykerJS config for `@cosyte/*` packages: the Vitest runner with per-test coverage
 * in Vitest's forks pool, static mutants kept, and the JSON report written to {@link FULL_REPORT}. A run never fails on
 * its score (`break: null`): the floor file and `cosyte-ratchet` hold that rule, so there is one
 * place that decides whether a score dropped.
 *
 * @param {object} [opts] Options.
 * @param {readonly string[]} [opts.mutate] The files to mutate, in Stryker's glob form. Defaults to {@link DEFAULT_MUTATE}.
 * @param {string} [opts.vitestConfig] The Vitest config file the runner loads.
 * @param {Record<string, unknown>} [opts.stryker] Any other Stryker option, merged last.
 * @returns {Record<string, unknown> & { mutate: string[], plugins: string[] }} The Stryker config.
 * @example
 * // stryker.config.mjs
 * import { cosyteStryker } from "@cosyte/vitest-config/stryker";
 * export default cosyteStryker();
 */
export function cosyteStryker(opts = {}) {
  const { mutate = DEFAULT_MUTATE, vitestConfig, stryker = {} } = opts;
  return {
    testRunner: "vitest",
    plugins: [resolveVitestRunner()],
    coverageAnalysis: "perTest",
    mutate: [...mutate],
    ignoreStatic: false,
    reporters: ["clear-text", "progress-append-only", "html", "json"],
    jsonReporter: { fileName: FULL_REPORT },
    htmlReporter: { fileName: htmlReportFor(FULL_REPORT) },
    thresholds: { high: 100, low: 90, break: null },
    tempDirName: ".stryker-tmp",
    ignorePatterns: ["coverage", "reports", "dist"],
    // Vitest's own default pool, which Stryker's runner does not use unless told: under its
    // default, worker threads, a test that calls process.chdir() fails before any mutant runs.
    vitest:
      vitestConfig === undefined ? { pool: "forks" } : { pool: "forks", configFile: vitestConfig },
    ...stryker,
  };
}
