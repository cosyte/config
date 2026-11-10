import type { GitRunner } from "./changes.js";

/** The floor file's name, at a repository's root. */
export declare const FLOOR_FILE: "quality-floor.json";

/** The four coverage metrics, in the order they print. */
export declare const COVERAGE_METRICS: readonly ["lines", "branches", "functions", "statements"];

/** Where each report is read from, relative to a package's directory. */
export declare const REPORTS: Readonly<{
  summary: "coverage/coverage-summary.json";
  lcov: "coverage/lcov.info";
  mutation: "reports/mutation/mutation.json";
  changed: "reports/mutation/changed.json";
}>;

/** One package's floors. */
export interface FloorEntry {
  coverage?: Partial<Record<"lines" | "branches" | "functions" | "statements", number>>;
  mutation?: number;
}

/** A floor file: each package directory, relative to the file, with its floors. */
export interface Floor {
  $comment?: string;
  packages: Record<string, FloorEntry>;
}

/** An inline exception found in a source file. */
export interface ExceptionComment {
  line: number;
  tool: "coverage" | "mutation";
  directive: string;
  reason: string | null;
}

/** What {@link judgeChangedCode} found in a change's own code. */
export interface ChangedCodeVerdict {
  uncovered: { file: string; line: number }[];
  survived: { file: string; line: number; mutator: string; status: string }[];
  exceptions: { file: string; line: number; tool: string; what: string; reason: string | null }[];
  unmutated: string[];
}

/** Thrown when an input cannot be read or is not what it must be. */
export declare class RatchetUnreadable extends Error {
  constructor(message: string);
}

/** Check a parsed floor file's shape; every key must be known. */
export declare function parseFloor(value: unknown): Floor;

/**
 * Compare a floor file with the one it replaces: each floor the earlier one held that is now lower
 * (`after` the lower value) or gone (`after` null). Raised and new floors are not listed.
 */
export declare function compareFloors(
  before: Floor,
  after: Floor,
): { dir: string; metric: string; before: number; after: number | null }[];

/** Cut a percentage to two decimals, toward zero. */
export declare function toFloor(value: number): number;

/** Read the four coverage percentages from Istanbul's `json-summary` report. */
export declare function readCoverageSummary(path: string): Record<string, number>;

/** Count a Stryker JSON report's mutants by status and work out its mutation score. */
export declare function mutationScore(
  report: unknown,
  path: string,
): { score: number; counts: Record<string, number> };

/** Read lcov's line records: absolute file path to line to hits. */
export declare function parseLcov(text: string, baseDir: string): Map<string, Map<number, number>>;

/** Find the inline coverage hints and Stryker directives in a source file. */
export declare function findExceptionComments(text: string): ExceptionComment[];

/** The first and last line a coverage hint takes out of the count. */
export declare function hintRange(
  hint: { line: number; directive: string },
  lines: string[],
  counted: Map<number, number> | undefined,
): [number, number];

/** Judge a change's own code: its changed lines coverage counts, and the mutants in them. */
export declare function judgeChangedCode(input: {
  changed: Map<string, Set<number>>;
  lines: Map<string, Map<number, number>>;
  mutants: Map<string, unknown[]> | null;
  read: (file: string) => string;
}): ChangedCodeVerdict;

/** Read a changed-files mutation report into absolute file path to mutants. */
export declare function readMutants(path: string, packageDir: string): Map<string, unknown[]>;

/** Parse the ratchet's command line. */
export declare function parseArgs(argv: string[]): {
  command: "check" | "raise";
  floor: string;
  base: string | null;
  skip: Set<"coverage" | "mutation">;
};

/**
 * Run the ratchet and return its exit code: 0 nothing dropped and changed code is reached, 1 a
 * drop or unreached changed code, 2 an input could not be read.
 *
 * @example
 * ```js
 * import { runRatchet } from "@cosyte/script-utils/ratchet";
 * process.exitCode = runRatchet({
 *   argv: ["check", "--base", "origin/main"],
 *   cwd: process.cwd(),
 *   out: (text) => process.stdout.write(text),
 *   err: (text) => process.stderr.write(text),
 * });
 * ```
 */
export declare function runRatchet(opts: {
  argv: string[];
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  git?: GitRunner;
}): number;
