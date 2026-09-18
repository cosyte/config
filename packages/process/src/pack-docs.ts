import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { createTarGz, type TarMember } from "./tar.js";

/**
 * `cosyte-process pack-docs`: the canonical docs-artifact build, published here so a repo executes
 * it instead of carrying a copy of it.
 *
 * Two tarballs, into an output directory named by the first argument and defaulting to
 * `dist-artifacts`: `docs-content.tar.gz` carrying the contents of `docs-content/` at the tarball
 * root, and `source.tar.gz` carrying `src/`, `package.json` and `tsconfig.json` at the tarball root.
 *
 * It fails fast. Every required input is checked before the output directory is created, so a run
 * that refuses leaves the tree exactly as it found it rather than a half-built artifact set that a
 * release job would pick up.
 */

/** The output directory used when the command is given no positional argument. */
export const DEFAULT_OUTPUT_DIR = "dist-artifacts";

/** The archive carrying the contents of `docs-content/`. */
export const DOCS_ARTIFACT = "docs-content.tar.gz";

/** The archive carrying `src/`, `package.json` and `tsconfig.json`. */
export const SOURCE_ARTIFACT = "source.tar.gz";

/** A path `pack-docs` requires, and what kind of thing it has to be. */
export interface RequiredInput {
  /** The path, relative to the package root, always with forward slashes. */
  readonly path: string;
  /** What the path has to be for the run to proceed. */
  readonly kind: "file" | "directory";
}

/**
 * The five inputs a run requires, checked in this order before anything is written.
 *
 * @example
 * PACK_DOCS_INPUTS.map((input) => input.path).includes("tsconfig.json"); // => true
 */
export const PACK_DOCS_INPUTS: readonly RequiredInput[] = [
  { path: "docs-content/intro.md", kind: "file" },
  { path: "docs-content/sidebars.json", kind: "file" },
  { path: "src", kind: "directory" },
  { path: "package.json", kind: "file" },
  { path: "tsconfig.json", kind: "file" },
];

/**
 * A refusal: a required input is absent, or a tree holds something this command cannot archive.
 *
 * Its message names the paths at issue, the entry point and the action available, and it is raised
 * before the output directory exists.
 *
 * @example
 * new PackDocsError("missing", ["src"]).missing; // => ["src"]
 */
export class PackDocsError extends Error {
  /** The paths, relative to the package root, that the run refused over. */
  readonly missing: readonly string[];

  /**
   * @param message - The full diagnostic, naming the paths, the entry point and the action.
   * @param missing - The paths, relative to the package root, that the run refused over.
   */
  constructor(message: string, missing: readonly string[]) {
    super(message);
    this.name = "PackDocsError";
    this.missing = missing;
  }
}

/** What a completed `pack-docs` run wrote. */
export interface PackDocsResult {
  /** Absolute path of the output directory. */
  readonly outputDir: string;
  /** Absolute paths of the archives written, in the order they were written. */
  readonly artifacts: readonly string[];
}

/** Whether a path is present and is the kind of thing the input declares. @internal */
function isPresent(absolute: string, kind: RequiredInput["kind"]): boolean {
  try {
    const stats = statSync(absolute);
    return kind === "file" ? stats.isFile() : stats.isDirectory();
  } catch {
    return false;
  }
}

/** Every file under a directory, as members named `<prefix><path under the directory>`. @internal */
function membersUnder(root: string, prefix: string): TarMember[] {
  const members: TarMember[] = [];
  const walk = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const name = `${relative}${entry.name}`;
      if (entry.isDirectory()) {
        walk(absolute, `${name}/`);
        continue;
      }
      if (!entry.isFile()) {
        throw new PackDocsError(
          `pack-docs: ${absolute}: is neither a file nor a directory, and this command archives ` +
            `only those: remove it or move it out of the tree, then run cosyte-process pack-docs again. ` +
            `Nothing was written.`,
          [name],
        );
      }
      members.push(member(absolute, name));
    }
  };
  walk(root, prefix);
  return members;
}

/**
 * One archive member, read off disk with its own mode and modification time.
 *
 * Both come from ONE descriptor rather than from the path twice: naming a file to describe it and
 * then naming it again to read it is two files as far as the filesystem is concerned, and the
 * archive would then carry one file's bytes under another's metadata.
 *
 * @internal
 */
function member(absolute: string, name: string): TarMember {
  const handle = openSync(absolute, "r");
  try {
    const stats = fstatSync(handle);
    return {
      name,
      content: readFileSync(handle),
      mode: stats.mode,
      mtime: Math.trunc(stats.mtimeMs / 1000),
    };
  } finally {
    closeSync(handle);
  }
}

/** Members in a stable order, so two runs over the same tree produce the same archive. @internal */
function sorted(members: readonly TarMember[]): TarMember[] {
  return [...members].sort((left, right) => (left.name < right.name ? -1 : 1));
}

/**
 * Build the two docs artifacts for a package.
 *
 * @param cwd - The invoking package's root.
 * @param outputDir - Output directory, relative to `cwd` unless absolute.
 * @returns The output directory and the archives written.
 * @throws PackDocsError When a required input is absent, before anything is written.
 * @example
 * packDocs("/repo", "dist-artifacts").artifacts.length; // => 2
 */
export function packDocs(cwd: string, outputDir: string = DEFAULT_OUTPUT_DIR): PackDocsResult {
  const missing = PACK_DOCS_INPUTS.filter(
    (input) => !isPresent(join(cwd, ...input.path.split("/")), input.kind),
  );
  if (missing.length > 0) {
    const names = missing.map((input) => `${input.path} (${input.kind})`).join(", ");
    const required = PACK_DOCS_INPUTS.map((input) => input.path).join(", ");
    throw new PackDocsError(
      `pack-docs: ${cwd}: missing required input: ${names}: all of ${required} must be present ` +
        `before an artifact can be built, so add what is missing, then run cosyte-process pack-docs ` +
        `again. Nothing was written.`,
      missing.map((input) => input.path),
    );
  }

  const docs = sorted(membersUnder(join(cwd, "docs-content"), ""));
  const source = sorted([
    ...membersUnder(join(cwd, "src"), "src/"),
    member(join(cwd, "package.json"), "package.json"),
    member(join(cwd, "tsconfig.json"), "tsconfig.json"),
  ]);

  const absoluteOutput = resolve(cwd, outputDir);
  mkdirSync(absoluteOutput, { recursive: true });
  const docsArtifact = join(absoluteOutput, DOCS_ARTIFACT);
  const sourceArtifact = join(absoluteOutput, SOURCE_ARTIFACT);
  writeFileSync(docsArtifact, createTarGz(docs));
  writeFileSync(sourceArtifact, createTarGz(source));
  return { outputDir: absoluteOutput, artifacts: [docsArtifact, sourceArtifact] };
}
