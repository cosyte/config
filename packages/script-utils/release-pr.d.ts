/**
 * Types for `@cosyte/script-utils/release-pr`: the release pull request check, which fails a
 * library tree whose Version Packages pull request would fail its own checks, and a changeset whose
 * opening sentence the release would refuse.
 */

/** The longest release bullet the shared release workflow publishes, in characters. */
export declare const RELEASE_BULLET_LIMIT: 400;

/** A rule id a finding can carry. */
export type ReleasePrRule =
  "version-script" | "version-test" | "changeset-bullet" | "changeset-shape";

/** Every rule id, with what it requires. */
export declare const RELEASE_PR_RULES: Readonly<Record<ReleasePrRule, string>>;

/** One place a tree would fail its release pull request. */
export interface ReleasePrFinding {
  rule: ReleasePrRule;
  /** The file, or `test/` for the test files as a whole, relative to the package root. */
  file: string;
  message: string;
}

/** A file the check read, relative to the package root, with `/` separators. */
export interface ReleasePrFile {
  path: string;
  text: string;
}

/** What the check reads from a package root. */
export interface ReleasePrInput {
  /** The package's scripts. */
  scripts: Record<string, unknown>;
  /** Whether a source file under `src/` declares an exported `VERSION` at the start of a line. */
  declaresVersion: boolean;
  /** The test files under `test/` and `src/` (`*.test.*` and `*.spec.*`). */
  tests: ReleasePrFile[];
  /** The pending changesets under `.changeset/`, its README left out. */
  changesets: ReleasePrFile[];
}

/**
 * The steps of a package script, split on `&&`, with a step that runs another script of the same
 * package (`pnpm <name>`, `pnpm run <name>`, `npm run <name>`) replaced by that script's steps.
 */
export declare function scriptSteps(body: string, scripts: Record<string, unknown>): string[];

/** The `version-script` rule: `changeset version`, then the VERSION sync, then the API reference. */
export declare function checkVersionScript(scripts: Record<string, unknown>): ReleasePrFinding[];

/** Whether a module's text declares an exported `VERSION` constant at the start of a line. */
export declare function declaresVersion(text: string): boolean;

/** What one test file lacks to pin VERSION through a fresh import. Empty when it does. */
export declare function freshVersionTestGaps(path: string, text: string): string[];

/** The `version-test` rule: at least one test file pins VERSION through a fresh import. */
export declare function checkVersionTests(tests: readonly ReleasePrFile[]): ReleasePrFinding[];

/** The first sentence of a changeset's summary, read the way the release workflow reads it. */
export declare function openingSentence(summary: string): string;

/** The most characters the release workflow's bullet for this sentence can have. */
export declare function bulletLengthBound(sentence: string): number;

/** The `changeset-bullet` and `changeset-shape` rules over one changeset. */
export declare function checkChangeset(path: string, text: string): ReleasePrFinding[];

/** Every rule over a package's input. */
export declare function checkReleasePr(input: ReleasePrInput): ReleasePrFinding[];

/**
 * Read what the check needs from a package root.
 *
 * @throws {Error} When package.json cannot be read or parsed, or a file cannot be read.
 */
export declare function readReleasePrInput(root: string): ReleasePrInput;

/** A stream the check writes to. */
export interface ReleasePrStream {
  write(text: string): unknown;
}

/**
 * Run the check: `--dir <package root>`, the working directory by default. Returns the exit code:
 * 0 clean, 1 a finding, 2 the package could not be read.
 */
export declare function runReleasePrCheck(options?: {
  argv?: readonly string[];
  dir?: string;
  stdout?: ReleasePrStream;
  stderr?: ReleasePrStream;
}): number;
