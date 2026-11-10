import type { readChanges } from "@cosyte/script-utils/changes";

/** The config file a run reads when `--config` names none. */
export declare const DEFAULT_CONFIG: "stryker.config.mjs";

/** Thrown for anything that stops a run before Stryker starts. */
export declare class MutateUnreadable extends Error {
  constructor(message: string);
}

/** Parse `cosyte-mutate`'s command line. */
export declare function parseMutateArgs(argv: string[]): {
  mode: "full" | "changed";
  base: string | null;
  config: string;
};

/** Pick the changed files a config mutates, relative to the working directory, sorted. */
export declare function selectChangedFiles(input: {
  changed: Iterable<string>;
  root: string;
  cwd: string;
  patterns: readonly string[];
}): string[];

/** Where a full run writes its JSON report. */
export declare function fullReportPath(config: Record<string, unknown>): string;

/** Where a changed run writes its JSON report: `changed.json` beside the full report. */
export declare function changedReportPath(config: Record<string, unknown>): string;

/** An empty report in the mutation-testing-report-schema shape. */
export declare function emptyReport(projectRoot: string): string;

/** Load a Stryker config module and return its default export. */
export declare function loadConfig(
  path: string,
): Promise<Record<string, unknown> & { mutate: string[] }>;

/** Start StrykerJS with these options and wait for it to finish. */
export declare function runStryker(options: Record<string, unknown>): Promise<void>;

/**
 * Run `cosyte-mutate` and resolve to its exit code: 0 the run finished, 2 it could not run.
 *
 * @example
 * ```js
 * import { runMutate } from "@cosyte/vitest-config/mutate";
 * process.exitCode = await runMutate({
 *   argv: ["changed", "--base", "origin/main"],
 *   cwd: process.cwd(),
 *   out: (text) => process.stdout.write(text),
 *   err: (text) => process.stderr.write(text),
 * });
 * ```
 */
export declare function runMutate(opts: {
  argv: string[];
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  changes?: typeof readChanges;
  stryker?: (options: Record<string, unknown>) => Promise<void>;
}): Promise<number>;
