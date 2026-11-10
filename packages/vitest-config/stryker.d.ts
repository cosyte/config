/** The directory every run writes its reports under, relative to the directory Stryker runs in. */
export declare const REPORT_DIR: "reports/mutation";

/** The full run's JSON report: the mutation score the floor file holds is read from here. */
export declare const FULL_REPORT: "reports/mutation/mutation.json";

/** The changed-files run's JSON report, separate so a partial run is never read as the score. */
export declare const CHANGED_REPORT: "reports/mutation/changed.json";

/** The files a run mutates by default: `src/**\/*.ts` without tests, barrels, declarations, fixtures and generated code. */
export declare const DEFAULT_MUTATE: readonly string[];

/**
 * The HTML report that sits beside a JSON report.
 *
 * @param jsonReport A report path ending in `.json`.
 * @returns The same path ending in `.html`.
 */
export declare function htmlReportFor(jsonReport: string): string;

/**
 * The absolute path of the Vitest runner plugin, resolved from this package so the run works
 * under pnpm.
 *
 * @param resolve Resolves a specifier to a module URL.
 * @returns The plugin's entry file.
 * @throws {Error} When `@stryker-mutator/vitest-runner` is not installed.
 */
export declare function resolveVitestRunner(resolve?: (specifier: string) => string): string;

/** Options for {@link cosyteStryker}. */
export interface CosyteStrykerOptions {
  /** The files to mutate, in Stryker's glob form. Defaults to {@link DEFAULT_MUTATE}. */
  mutate?: readonly string[];
  /** The Vitest config file the runner loads. */
  vitestConfig?: string;
  /** Any other Stryker option, merged last. */
  stryker?: Record<string, unknown>;
}

/**
 * The shared StrykerJS config: the Vitest runner with per-test coverage, static mutants kept,
 * the JSON report at {@link FULL_REPORT}, and no score threshold of its own.
 *
 * @param opts Options.
 * @returns The Stryker config.
 * @example
 * ```js
 * // stryker.config.mjs
 * import { cosyteStryker } from "@cosyte/vitest-config/stryker";
 * export default cosyteStryker();
 * ```
 */
export declare function cosyteStryker(
  opts?: CosyteStrykerOptions,
): Record<string, unknown> & { mutate: string[]; plugins: string[] };
