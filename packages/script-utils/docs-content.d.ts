/**
 * Types for `@cosyte/script-utils/docs-content`: the structure check for a library's
 * `docs-content/` folder, the pages docs.cosyte.com renders. The standard it checks is decision
 * record 0006 in cosyte/config.
 */

/** The folder this check reads, at the repository root. */
export declare const DOCS_DIR: "docs-content";

/** The sidebar file inside it. */
export declare const SIDEBARS_FILE: "sidebars.json";

/** The folder the reference generator owns. Nothing under it is read by this check. */
export declare const GENERATED_DIR: "api";

/** The pages every library has, by id. */
export declare const REQUIRED_PAGES: readonly string[];

/** One top-level category of the sidebar. */
export interface DocsCategory {
  /** The label, exactly as the sidebar writes it. */
  readonly label: string;
  /** Whether every library has this category. */
  readonly required: boolean;
  /** The page the category must open with, or null when any page may. */
  readonly first: string | null;
}

/** The top-level categories, in the only order they may appear. */
export declare const CATEGORIES: readonly DocsCategory[];

/** The two fixed pages, listed last at the top level of the sidebar, in this order. */
export declare const QUALITY_PAGES: readonly ["testing-and-quality", "performance"];

/** The heading of the section each quality page's generated numbers go in. */
export declare const NUMBERS_HEADING: "## Current numbers";

/** The label the docs site gives the generated reference. A sidebar never writes it. */
export declare const RESERVED_LABEL: "API Reference";

/** The front matter keys every page carries. */
export declare const FRONT_MATTER_KEYS: readonly string[];

/** The front matter keys a page must not carry. */
export declare const FORBIDDEN_KEYS: readonly string[];

/** The longest description, in characters. */
export declare const DESCRIPTION_LIMIT: 160;

/** A page's file name, without `.md`: lower-case words joined by single hyphens. */
export declare const PAGE_NAME: RegExp;

/** A rule a finding can carry. */
export type DocsContentRule =
  "sidebar" | "listing" | "required-page" | "front-matter" | "file-name" | "numbers";

/** Every rule, with what it requires. */
export declare const DOCS_CONTENT_RULES: Readonly<Record<DocsContentRule, string>>;

/** Raised when the check cannot read its input; the command line turns it into exit 2. */
export declare class DocsContentRefusal extends Error {}

/** One front matter value and the line it is on. */
export interface FrontMatterField {
  /** The value, unquoted. */
  value: string;
  /** Its 1-based line in the page. */
  line: number;
}

/** What {@link parseFrontMatter} read. */
export interface FrontMatter {
  /** Every key read, with its value. */
  fields: Map<string, FrontMatterField>;
  /** Each line it could not read, with why. */
  errors: { line: number; message: string }[];
  /** Whether the page opens with front matter at all. */
  present: boolean;
}

/**
 * Read a page's front matter: one `key: value` per line between a first line `---` and the next.
 *
 * @param text - The page.
 * @returns The fields, the errors and whether a block was there.
 */
export declare function parseFrontMatter(text: string): FrontMatter;

/** A docs-content tree, read. */
export interface DocsContentInput {
  /** The `.md` files at the top of docs-content/, by file name without `.md`. */
  pages: { name: string; text: string }[];
  /** The text of sidebars.json, or null when there is none. */
  sidebars: string | null;
  /** Markdown that is not a top-level `.md` page and is not under api/, relative to docs-content/. */
  misplaced?: string[];
}

/** One finding. */
export interface DocsContentFinding {
  /** The file, relative to docs-content/. */
  file: string;
  /** The 1-based line, or 0 when the finding is about the whole file. */
  line: number;
  /** The rule it breaks. */
  rule: DocsContentRule;
  /** What is wrong, in plain words. */
  message: string;
}

/**
 * Check a docs-content tree that has already been read.
 *
 * @param input - The pages, the sidebar text and any misplaced markdown.
 * @returns Every finding; empty when the tree keeps the standard.
 */
export declare function checkDocsContent(input: DocsContentInput): DocsContentFinding[];

/**
 * Read docs-content/ under a repository root, skipping api/.
 *
 * @param root - The repository root.
 * @returns The tree, read.
 * @throws {@link DocsContentRefusal} When the folder is missing or a file in it cannot be read.
 */
export declare function readDocsContent(root: string): Required<DocsContentInput>;

/** A stream the command line writes to. */
export interface DocsContentStream {
  write(text: string): unknown;
}

/** What {@link runDocsContentCheck} takes. */
export interface DocsContentCheckOptions {
  /** CLI arguments; only `--dir <path>` is accepted. */
  argv?: string[];
  /** The repository root. Default: the working directory. */
  dir?: string;
  /** Where the clean report goes. Default: the process's stdout. */
  stdout?: DocsContentStream;
  /** Where findings and refusals go. Default: the process's stderr. */
  stderr?: DocsContentStream;
}

/**
 * Check docs-content/ in a repository and report.
 *
 * @param options - Arguments, the root and the streams.
 * @returns 0 clean, 1 a finding, 2 the check could not run.
 */
export declare function runDocsContentCheck(options?: DocsContentCheckOptions): 0 | 1 | 2;
