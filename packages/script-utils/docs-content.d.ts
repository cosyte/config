/**
 * Types for `@cosyte/script-utils/docs-content`: the structure check for a library's
 * `docs-content/` folder, the pages docs.cosyte.com renders. The standard it checks is decision
 * record 0006 in cosyte/config.
 */

/** The folder this check reads, at the repository root. */
export declare const DOCS_DIR: "docs-content";

/** The sidebar file inside it. */
export declare const SIDEBARS_FILE: "sidebars.json";

/** The folder the reference generator owns. Its pages are read only for their headings. */
export declare const GENERATED_DIR: "api";

/** How a link into the generated reference starts. */
export declare const REFERENCE_LINK_PREFIX: "./api/";

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

/**
 * What the "Current numbers" section holds in the repository: this text and nothing else, however
 * its lines wrap. The release replaces the section with the numbers it measured.
 */
export declare const NUMBERS_PLACEHOLDER: string;

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

/**
 * A rule that reads whether a page holds what its kind asks, the kind being the sidebar category it
 * is listed in. A library's findings under these are held by the ratchet up to its recorded counts.
 */
export type DocsContentRatchetedRule =
  | "howto-title"
  | "howto-steps"
  | "explanation-content"
  | "limitations"
  | "tutorial-steps"
  | "page-id"
  | "reference-source";

/**
 * A rule on example pages: every runnable example has its page, and the page's Code section is the
 * example's file. Not ratcheted.
 */
export type DocsContentExampleRule = "example-page" | "example-code";

/** A rule that only warns: a measured number outside a "Current numbers" section. */
export type DocsContentWarningRule = "measured-number";

/** A rule a finding can carry. */
export type DocsContentRule =
  | "sidebar"
  | "listing"
  | "required-page"
  | "front-matter"
  | "file-name"
  | "numbers"
  | "reference-link"
  | DocsContentExampleRule
  | DocsContentRatchetedRule
  | DocsContentWarningRule;

/** Every rule, with what it requires. */
export declare const DOCS_CONTENT_RULES: Readonly<Record<DocsContentRule, string>>;

/** The rules on example pages, which the ratchet does not hold. */
export declare const EXAMPLE_RULES: readonly DocsContentExampleRule[];

/** The folder at the repository root whose top-level scripts are the library's runnable examples. */
export declare const EXAMPLES_DIR: "examples";

/** The sidebar category that lists the example pages, after How-to guides. */
export declare const EXAMPLES_CATEGORY: "Examples";

/** How an example page's id starts: `example-<name>`, the name being the file's without extension. */
export declare const EXAMPLE_PAGE_PREFIX: "example-";

/** The H2 headings every example page has, in this order. The last one's section is generated. */
export declare const EXAMPLE_HEADINGS: readonly [
  "What it shows",
  "Run it",
  "Expected output",
  "Code",
];

/** The heading the generated part of an example page starts at; it runs to the end of the page. */
export declare const CODE_HEADING: "## Code";

/**
 * Whether a file at the top of examples/ is a runnable example: a `.ts`, `.mts`, `.js` or `.mjs`
 * script whose name does not begin with `_` or `.`, and that is not a declaration file, a test or a
 * tool's configuration.
 *
 * @param name - The file name.
 * @returns True for a runnable example.
 */
export declare function isExampleFile(name: string): boolean;

/**
 * An example's name: its file name without the extension. Its page is `example-<name>.md`.
 *
 * @param file - The example's file name.
 * @returns The name.
 */
export declare function exampleStem(file: string): string;

/**
 * The fence language an example's code is shown in.
 *
 * @param file - The example's file name.
 * @returns `ts` for `.ts` and `.mts`, else `js`.
 */
export declare function exampleLanguage(file: string): "ts" | "js";

/**
 * The generated Code section of an example page: the whole file in a fence titled with its path and
 * marked `no-run`, from the "## Code" heading to the end of the page.
 *
 * @param file - The example's file name, under examples/.
 * @param text - The file's text.
 * @returns The section, ending in one newline.
 */
export declare function exampleCodeSection(file: string, text: string): string;

/**
 * Write the Code section of every example page from its example, replacing the page from its
 * "## Code" heading to the end, or adding the section when the page has none. A page that does not
 * exist is never written.
 *
 * @param root - The repository root.
 * @returns The pages written, relative to docs-content/.
 * @throws {@link DocsContentRefusal} When docs-content/ or examples/ cannot be read, or a page cannot be written.
 */
export declare function writeExamplePages(root: string): string[];

/** The rules the ratchet holds, in the order the check reports them. */
export declare const RATCHETED_RULES: readonly DocsContentRatchetedRule[];

/** The rules that only warn. */
export declare const WARNING_RULES: readonly DocsContentWarningRule[];

/**
 * The front matter key a configuration or command reference names its generator or test in: a path
 * from the repository root to a file that names the page's file as a whole path segment. It never
 * names a page: a Markdown or MDX file, or any file under docs-content/, is a finding.
 */
export declare const HELD_BY_KEY: "held_by";

/** The page every library keeps its limitations on, listed in Reference. */
export declare const LIMITATIONS_PAGE: "limitations";

/** The two sections a tutorial ends with, in this order. */
export declare const TUTORIAL_ENDING: readonly ["What you built", "Next"];

/** The id prefixes that name a page's kind, not its subject. */
export declare const KIND_PREFIXES: readonly string[];

/**
 * The verbs a how-to guide's title may begin with, lower-case. A title that begins with any other
 * word is a finding; a verb a guide needs and this lacks is added here. Words read first as nouns
 * (release, support, report, list and the like) are left out, so "Release notes" is a finding.
 */
export declare const IMPERATIVE_VERBS: readonly string[];

/** A library's recorded counts, by rule. A rule not named may have no findings. */
export type DocsContentAllowance = Readonly<Partial<Record<DocsContentRatchetedRule, number>>>;

/**
 * The counts the ratchet holds each library to, by package name: the findings each had under the
 * ratcheted rules when they landed, which a library may only lower. Read from
 * docs-content-ratchet.json, which ships beside this module.
 */
export declare const DOCS_CONTENT_RATCHET: Readonly<Record<string, DocsContentAllowance>>;

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

/**
 * Every anchor the headings of a page get on the docs site: each heading's text lower-cased, with
 * what the site's slugger drops dropped and each space turned into a hyphen; a repeated slug is
 * numbered `-1`, `-2` and so on in page order. Headings in fenced code are not read.
 *
 * @param text - A page.
 * @returns Its anchors.
 */
export declare function headingAnchors(text: string): Set<string>;

/** A docs-content tree, read. */
export interface DocsContentInput {
  /** The `.md` files at the top of docs-content/, by file name without `.md`. */
  pages: { name: string; text: string }[];
  /** The text of sidebars.json, or null when there is none. */
  sidebars: string | null;
  /** Markdown that is not a top-level `.md` page and is not under api/, relative to docs-content/. */
  misplaced?: string[];
  /**
   * The generated `.md` pages, by their path under api/, read for the headings a link into the
   * reference names. Without it, every such link names a page that is not there.
   */
  reference?: Map<string, string>;
  /**
   * The files the front matter key `held_by` names, by their path from the repository root, as
   * read. A path missing here is reported as not a file in the repository.
   */
  sources?: Map<string, string>;
  /** The name in the repository's package.json, which the ratchet records counts under. */
  library?: string | null;
  /**
   * The runnable examples at the top of examples/, by file name, as read. Without it, the check
   * sees no examples, and any example page is one whose example is gone.
   */
  examples?: { file: string; text: string }[];
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
 * Check a docs-content tree that has already been read: its structure and, once the sidebar parses,
 * whether each page holds what its kind asks. Every finding is returned, ratcheted rules included;
 * {@link applyDocsContentRatchet} sorts out which fail for a library.
 *
 * @param input - The pages, the sidebar text, any misplaced markdown, and the files `held_by` names.
 * @returns Every finding; empty when the tree keeps the standard.
 */
export declare function checkDocsContent(input: DocsContentInput): DocsContentFinding[];

/**
 * The top-level sidebar category each listed page is in, by id: the page's kind. A page in a
 * category one level down takes its parent's label.
 *
 * @param sidebars - The parsed sidebars.json.
 * @returns Each listed page's category label; empty for a sidebar of the wrong shape.
 */
export declare function pageKinds(sidebars: unknown): Map<string, string>;

/**
 * Whether a `held_by` path stays inside the repository: relative, with forward slashes, and no
 * empty, `.` or `..` segment.
 *
 * @param path - The front matter value.
 * @returns True when the path may be read.
 */
export declare function isHeldByPath(path: string): boolean;

/** One warning: a line that reads as a measured number. */
export interface DocsContentWarning extends DocsContentFinding {
  rule: DocsContentWarningRule;
}

/**
 * Every prose line, outside code and outside a "Current numbers" section, that carries a number
 * with a measured unit (a percentage, ms, µs, ns, a size in bytes, a rate a second, "times faster"),
 * on every page not listed in Reference. A warning never fails the check.
 *
 * @param input - The pages and the sidebar text.
 * @returns Each warning, in page order.
 */
export declare function docsContentWarnings(
  input: Pick<DocsContentInput, "pages" | "sidebars">,
): DocsContentWarning[];

/** A ratcheted rule and its count, against what the library's record allows. */
export interface DocsContentRatchetCount {
  rule: DocsContentRatchetedRule;
  count: number;
  allowed: number;
}

/** What {@link applyDocsContentRatchet} sorted. */
export interface DocsContentRatchetResult {
  /** The findings that fail: every rule not ratcheted, and every ratcheted rule over its count. */
  failing: DocsContentFinding[];
  /** The findings of ratcheted rules at or under their counts. */
  held: DocsContentFinding[];
  /** The ratcheted rules over their counts. */
  over: DocsContentRatchetCount[];
  /** The ratcheted rules under their counts, whose counts can be lowered. */
  loose: DocsContentRatchetCount[];
}

/**
 * Hold a library's findings under the ratcheted rules to its recorded counts.
 *
 * @param findings - Every finding of {@link checkDocsContent}.
 * @param allowance - The library's counts. Default: none, so every finding fails.
 * @returns The findings that fail, the ones held, and the rules over or under their counts.
 */
export declare function applyDocsContentRatchet(
  findings: DocsContentFinding[],
  allowance?: DocsContentAllowance,
): DocsContentRatchetResult;

/**
 * Read docs-content/ under a repository root: the pages, the sidebar, the generated pages under
 * api/ for their headings, the files each `held_by` names, the runnable examples at the top of
 * examples/, and the library's name from package.json.
 *
 * @param root - The repository root.
 * @returns The tree, read.
 * @throws {@link DocsContentRefusal} When the folder is missing, a file in it cannot be read, or
 *   examples/ is there and is not a directory.
 */
export declare function readDocsContent(root: string): Required<DocsContentInput>;

/** A stream the command line writes to. */
export interface DocsContentStream {
  write(text: string): unknown;
}

/** What {@link runDocsContentCheck} takes. */
export interface DocsContentCheckOptions {
  /**
   * CLI arguments: `--dir <path>`, and `--write`, which writes each example page's Code section from
   * its example before the check reads the tree.
   */
  argv?: string[];
  /** The repository root. Default: the working directory. */
  dir?: string;
  /** Where the clean report goes. Default: the process's stdout. */
  stdout?: DocsContentStream;
  /** Where findings and refusals go. Default: the process's stderr. */
  stderr?: DocsContentStream;
  /** The counts to hold each library to, by package name. Default: {@link DOCS_CONTENT_RATCHET}. */
  ratchet?: Readonly<Record<string, DocsContentAllowance>>;
}

/**
 * Check docs-content/ in a repository and report. Findings of the ratcheted rules are held to the
 * counts the ratchet records for the library; warnings, held findings and counts that can be
 * lowered go to stdout and never change the exit code.
 *
 * @param options - Arguments, the root and the streams.
 * @returns 0 clean, 1 a finding, 2 the check could not run.
 */
export declare function runDocsContentCheck(options?: DocsContentCheckOptions): 0 | 1 | 2;
