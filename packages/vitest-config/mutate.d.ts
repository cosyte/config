/**
 * Reads what a change touched: `readChanges` from `@cosyte/script-utils/changes`, an optional peer
 * dependency. Declared here so these types do not need that package installed.
 */
export type ChangeReader = (opts: { base: string; cwd: string }) => {
  root: string;
  files: Map<string, Set<number>>;
};

/** The config file a run reads when `--config` names none. */
export declare const DEFAULT_CONFIG: "stryker.config.mjs";

/** The variable a sharded full run reads its share from: `<k>/<n>`. */
export declare const SHARD_VARIABLE: "COSYTE_MUTATE_SHARD";

/** The variable naming the file Stryker reads and writes its incremental results in. */
export declare const INCREMENTAL_VARIABLE: "COSYTE_MUTATE_INCREMENTAL_FILE";

/** One shard of a full run: shard `k` of `n`, from 1. */
export interface Shard {
  k: number;
  n: number;
}

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

/**
 * Read `<k>/<n>`, two whole numbers with 1 <= k <= n; null when unset or empty. Throws
 * `MutateUnreadable` on any other value.
 */
export declare function parseShard(value: string | undefined): Shard | null;

/** 32-bit FNV-1a over the UTF-8 bytes of a text: the hash a file's shard is read from. */
export declare function fnv1a32(text: string): number;

/** The files of one shard: those whose `fnv1a32` hash mod `n` is `k - 1`. */
export declare function filesInShard(files: readonly string[], shard: Shard): string[];

/**
 * List the files under `cwd` that the `mutate` patterns name, relative to it, sorted; never inside a
 * `node_modules` or `.git` directory or Stryker's temp directory (default `.stryker-tmp`).
 */
export declare function expandMutate(input: {
  cwd: string;
  patterns: readonly string[];
  tempDirName?: string;
}): string[];

/** Where a sharded full run writes its JSON report: `shard-<k>-of-<n>.json` beside the full report. */
export declare function shardReportPath(config: Record<string, unknown>, shard: Shard): string;

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

/**
 * Load `readChanges` from `@cosyte/script-utils/changes`, the optional peer dependency a changed run
 * needs; rejects, naming the package, when it is not installed.
 */
export declare function loadChangeReader(
  load?: (specifier: string) => Promise<unknown>,
): Promise<ChangeReader>;

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
  /** Where a full run reads `COSYTE_MUTATE_SHARD` and `COSYTE_MUTATE_INCREMENTAL_FILE`; default `process.env`. */
  env?: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  changes?: ChangeReader;
  stryker?: (options: Record<string, unknown>) => Promise<void>;
}): Promise<number>;
