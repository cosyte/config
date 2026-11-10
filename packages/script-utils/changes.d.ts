/** The result of running git: its exit status (`null` when it could not start) and its output. */
export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs git with array arguments in a directory. */
export type GitRunner = (args: string[], cwd: string) => GitResult;

/** What a change touched against a base ref. */
export interface Changes {
  /** The repository root. */
  root: string;
  /** The base ref, as given. */
  base: string;
  /** The merge base of the base ref and HEAD. */
  mergeBase: string;
  /** Each changed file, relative to the root, with the 1-based lines its new version added or changed. */
  files: Map<string, Set<number>>;
}

/** Thrown when git cannot answer: no repository, an unknown base, a failed diff. */
export declare class ChangesUnreadable extends Error {
  constructor(message: string);
}

/**
 * Run git with array arguments, never through a shell.
 *
 * @param args The arguments.
 * @param cwd The directory to run in.
 * @returns The result.
 */
export declare function runGit(args: string[], cwd: string): GitResult;

/**
 * Undo git's C-style quoting of a path. A path git did not quote is returned as it is.
 *
 * @param path A path as git printed it.
 * @returns The path.
 */
export declare function unquoteGitPath(path: string): string;

/**
 * Read the changed lines out of a zero-context unified diff.
 *
 * @param text The diff.
 * @returns Each changed file with its changed lines.
 */
export declare function parseUnifiedDiff(text: string): Map<string, Set<number>>;

/**
 * The lines a change touched against a base ref: the diff from the merge base to the working tree,
 * plus every untracked file git does not ignore.
 *
 * @param opts The base ref, a directory inside the repository, and the git runner.
 * @returns What changed.
 * @throws {ChangesUnreadable} When git cannot answer.
 * @example
 * ```js
 * import { readChanges } from "@cosyte/script-utils/changes";
 * const { files } = readChanges({ base: "origin/main" });
 * ```
 */
export declare function readChanges(opts: { base: string; cwd?: string; git?: GitRunner }): Changes;
