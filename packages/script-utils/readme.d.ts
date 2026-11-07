/**
 * Types for `@cosyte/script-utils/readme`: the README gate for every `@cosyte/*` library, which
 * checks the house skeleton and a size limit under npm's.
 */

/** The tile's alt text, as assets `alt-text.json` declares it for the light tile. */
export declare const TILE_ALT: string;

/** The shared lockup tile every library README opens with, byte for byte. */
export declare const TILE: string;

/** npm's own cut: the registry keeps this many characters of a README. */
export declare const NPM_README_LIMIT: 65536;

/** This gate's limit, in characters (UTF-16 code units). */
export declare const README_CHARACTER_LIMIT: 60000;

/** The longest tagline the gate accepts, in characters. */
export declare const TAGLINE_LIMIT: 120;

/** The `##` sections every library README carries, in order, with License last. */
export declare const REQUIRED_SECTIONS: readonly string[];

/** A rule id a finding can carry. */
export type ReadmeRule =
  | "tile"
  | "tile-alt"
  | "title"
  | "tagline"
  | "badges"
  | "section-missing"
  | "section-order"
  | "section-empty"
  | "docs-link"
  | "license-last"
  | "license-link"
  | "size";

/** Every rule id, with what it requires. */
export declare const README_RULES: Readonly<Record<ReadmeRule, string>>;

/** One place a README departs from the skeleton. */
export interface ReadmeFinding {
  rule: ReadmeRule;
  /** 1-based line, or 0 when the finding is about the whole file. */
  line: number;
  message: string;
}

/**
 * The badge row a library README carries (npm version, CI, license, Node), one badge per line,
 * derived from its package.json.
 *
 * @throws {TypeError} When the manifest has no `@cosyte/*` name, no github.com/cosyte repository
 *   URL, or no `engines.node`.
 */
export declare function badgeRow(manifest: Record<string, unknown>): string[];

/**
 * Check a library README against the house skeleton. Returns no findings when it follows it.
 *
 * @throws {TypeError} When the manifest cannot supply what the skeleton is derived from.
 */
export declare function checkReadme(
  text: string,
  manifest: Record<string, unknown>,
): ReadmeFinding[];

export interface ReadmeGateOptions {
  /** The package directory holding README.md and package.json. Default: the working directory. */
  dir?: string;
  /** CLI arguments; only `--dir <path>` is accepted. */
  argv?: string[];
}

/**
 * Run the gate over one package directory and return the exit code: 0 the README follows the
 * skeleton, 1 at least one finding, 2 the input could not be read. It reports on stdout or stderr
 * and never exits the process.
 */
export declare function runReadmeGate(options?: ReadmeGateOptions): 0 | 1 | 2;
