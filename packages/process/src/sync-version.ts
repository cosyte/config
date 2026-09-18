import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `cosyte-process sync-version`: the canonical version sync, published here so a repo executes it
 * instead of carrying a copy of it.
 *
 * The behaviour contract is five numbered conditions, and the numbers are part of the surface: every
 * refusal names the condition it failed, so a diagnostic points at documented text rather than at
 * whatever this implementation happens to do. They are documented in this package's README.
 *
 *   1. The invoking package's `package.json` `version` is read. Missing, non-string or empty is a
 *      refusal.
 *   2. Exactly one exported `VERSION` declaration is found in the source entry point. Zero is a
 *      refusal naming the rename; two or more is a refusal naming the ambiguity, because a decoy
 *      declaration must never be rewritten ahead of the real one.
 *   3. The declared value is replaced literally: the manifest string is spliced in character for
 *      character and is never interpreted as a replacement pattern.
 *   4. The run is idempotent: a tree already at the manifest version is not written to, and the run
 *      says so.
 *   5. The exit vocabulary is closed: 0 for a write and for an already-synced tree, 1 for every
 *      refusal under conditions 1 and 2.
 */

/** The source entry point the declaration is read from, relative to the package root. */
export const SOURCE_ENTRY_POINT = "src/index.ts";

/**
 * The text that opens the declaration form, at column 0.
 *
 * A floor, not a ceiling: another form may be added beside it, and this one is never narrowed.
 *
 * @internal
 */
const DECLARATION_PREFIX = 'export const VERSION: string = "';

/** The text that closes the declaration form. @internal */
const DECLARATION_SUFFIX = '";';

/**
 * The declaration form, anchored at column 0 and searched over the whole file.
 *
 * Built fresh per search rather than shared, because a global regular expression carries its own
 * `lastIndex` between calls.
 *
 * @internal
 */
function declarationPattern(): RegExp {
  return /^export const VERSION: string = "(.*)";$/gm;
}

/** One exported `VERSION` declaration found in a source text. */
export interface VersionDeclaration {
  /** The declared version value, without its quotes. */
  readonly value: string;
  /** The 1-based line the declaration sits on. */
  readonly line: number;
  /** Index of the value's first character in the source text. */
  readonly start: number;
  /** Index one past the value's last character in the source text. */
  readonly end: number;
}

/**
 * Every exported `VERSION` declaration in a source text, in the order they appear.
 *
 * The value span is returned rather than a rewritten string so the caller can splice, which is what
 * makes condition 3 structural: nothing here ever passes a version string to a replacement routine.
 *
 * @param source - The whole source entry point.
 * @returns One entry per matching declaration; empty when none matches.
 * @example
 * findVersionDeclarations('export const VERSION: string = "1.0.0";\n')[0].value; // => "1.0.0"
 */
export function findVersionDeclarations(source: string): VersionDeclaration[] {
  const found: VersionDeclaration[] = [];
  const pattern = declarationPattern();
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const start = match.index + DECLARATION_PREFIX.length;
    const end = match.index + match[0].length - DECLARATION_SUFFIX.length;
    found.push({
      value: source.slice(start, end),
      line: source.slice(0, match.index).split("\n").length,
      start,
      end,
    });
  }
  return found;
}

/** What a completed `sync-version` run did. */
export type SyncVersionOutcome = "written" | "already-synced";

/** The result of a `sync-version` run that did not refuse. */
export interface SyncVersionResult {
  /** Whether the declaration was rewritten or was already at the manifest version. */
  readonly outcome: SyncVersionOutcome;
  /** The version the declaration now carries, which is the manifest's. */
  readonly version: string;
  /** Absolute path of the source entry point. */
  readonly file: string;
}

/**
 * A refusal under condition 1 or condition 2, carrying the number it failed.
 *
 * Its message names the file, the condition and the action available, which is what the caller
 * writes to stderr before exiting non-zero.
 *
 * @example
 * new SyncVersionError(1, "/repo/package.json", "no usable version", "set one").condition; // => 1
 */
export class SyncVersionError extends Error {
  /** The numbered condition of the behaviour contract that failed. */
  readonly condition: number;

  /** Absolute path of the file the condition was evaluated against. */
  readonly file: string;

  /**
   * @param condition - The numbered condition that failed.
   * @param file - Absolute path of the file it was evaluated against.
   * @param problem - What the file failed, in structural terms.
   * @param action - What the caller can do about it.
   */
  constructor(condition: number, file: string, problem: string, action: string) {
    super(`sync-version: ${file}: ${problem} (condition ${String(condition)}): ${action}`);
    this.name = "SyncVersionError";
    this.condition = condition;
    this.file = file;
  }
}

/** The one field of a consumer manifest this module reads. @internal */
interface ConsumerManifest {
  version?: unknown;
}

/** Read the manifest version under condition 1, or refuse. @internal */
function readManifestVersion(manifestPath: string): string {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    throw new SyncVersionError(
      1,
      manifestPath,
      "cannot be read",
      "run cosyte-process sync-version from the package root, where package.json is",
    );
  }
  let manifest: ConsumerManifest;
  try {
    manifest = JSON.parse(text) as ConsumerManifest;
  } catch {
    throw new SyncVersionError(
      1,
      manifestPath,
      "is not valid JSON",
      "repair the manifest, then run cosyte-process sync-version again",
    );
  }
  const version: unknown = manifest.version;
  if (typeof version !== "string" || version === "") {
    throw new SyncVersionError(
      1,
      manifestPath,
      `has no usable "version" (found ${typeof version === "string" ? "an empty string" : typeof version})`,
      'give "version" a non-empty string, then run cosyte-process sync-version again',
    );
  }
  return version;
}

/** Read the source entry point under condition 2, or refuse. @internal */
function readSource(sourcePath: string): string {
  try {
    return readFileSync(sourcePath, "utf8");
  } catch {
    throw new SyncVersionError(
      2,
      sourcePath,
      "cannot be read",
      `the exported VERSION declaration lives in ${SOURCE_ENTRY_POINT}; restore that file, then run cosyte-process sync-version again`,
    );
  }
}

/** The single declaration condition 2 requires, or a refusal naming which half failed. @internal */
function soleDeclaration(sourcePath: string, source: string): VersionDeclaration {
  const found = findVersionDeclarations(source);
  const form = `${DECLARATION_PREFIX}<value>${DECLARATION_SUFFIX}`;
  const [first, ...rest] = found;
  if (first === undefined) {
    throw new SyncVersionError(
      2,
      sourcePath,
      "carries no exported VERSION declaration",
      `one line of the form ${form} must start at column 0; the constant has been renamed or moved, so restore it, then run cosyte-process sync-version again`,
    );
  }
  if (rest.length > 0) {
    const lines = found.map((declaration) => String(declaration.line)).join(", ");
    throw new SyncVersionError(
      2,
      sourcePath,
      `carries ${String(found.length)} exported VERSION declarations, on lines ${lines}`,
      "exactly one must match, so remove or rename the others, then run cosyte-process sync-version again",
    );
  }
  return first;
}

/**
 * Sync a package's exported `VERSION` declaration to its manifest version.
 *
 * @param cwd - The invoking package's root.
 * @returns What the run did, and the version the declaration now carries.
 * @throws SyncVersionError Under condition 1 or condition 2, naming which one failed.
 * @example
 * syncVersion("/repo/already/synced").outcome; // => "already-synced"
 */
export function syncVersion(cwd: string): SyncVersionResult {
  const manifestPath = join(cwd, "package.json");
  const version = readManifestVersion(manifestPath);
  const sourcePath = join(cwd, ...SOURCE_ENTRY_POINT.split("/"));
  const source = readSource(sourcePath);
  const declaration = soleDeclaration(sourcePath, source);

  // Condition 4: an already-synced tree is not written to at all.
  if (declaration.value === version) {
    return { outcome: "already-synced", version, file: sourcePath };
  }

  // Condition 3: the value span is spliced out and the manifest string put in its place, so `$&`,
  // `$1` and a backtick sequence are written exactly as the manifest carries them. Nothing here
  // reaches a replacement routine that could interpret them.
  const updated = source.slice(0, declaration.start) + version + source.slice(declaration.end);
  writeFileSync(sourcePath, updated);
  return { outcome: "written", version, file: sourcePath };
}
