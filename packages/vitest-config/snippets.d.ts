/**
 * The doc/code-agreement harness: the documentation analog of the parser conformance runners.
 *
 * Every fenced block a `docs-content` page opts in (```` ```ts runnable ````) is extracted, its
 * inline `// => value` assertions compiled to real `expect(...)` checks, and the whole block executed
 * against the built package inside the running Vitest process. A green docs build carrying a wrong
 * snippet is the exact failure this prevents.
 */

/** One extracted runnable snippet, in document order. */
export interface RunnableSnippet {
  /** The fence language (`ts` / `typescript` / `tsx`; a sample may also be `js` / `javascript` / `mjs`). */
  lang: string;
  /** Fence info-string tokens after the language (e.g. `["runnable", "throws"]`). */
  meta: string[];
  /** The snippet source (dedented to the fence's own indentation). */
  code: string;
  /** 1-based line of the snippet's first code line, for failure attribution. */
  line: number;
  /** Whether the block is tagged `throws` (expected to throw rather than run clean). */
  throws: boolean;
  /**
   * The extension of the module {@link runSnippet} writes the snippet to. Absent, it is `.ts`, which
   * is what every snippet {@link extractRunnableSnippets} returns runs as.
   */
  extension?: string;
}

/** One extracted code sample, in document order: a TypeScript or JavaScript block, tagged or not. */
export interface Sample extends RunnableSnippet {
  /**
   * The reason the block is not run: the words after its `no-run` tag (empty when the tag has no
   * reason, which the suite reports as an error), or `null` for a block that runs.
   */
  skip: string | null;
  /**
   * The reason the sample is run but not type-checked: the words after its `no-typecheck` tag
   * (empty when the tag has no reason, which the suite reports as an error), or `null` otherwise.
   * Of `no-run` and `no-typecheck`, the first in the fence counts, and what follows it is its reason.
   */
  noTypecheck: string | null;
  /** The module it runs as: `.mjs` for a `js`, `javascript` or `mjs` sample, `.tsx` for `tsx`, else `.ts`. */
  extension: ".ts" | ".tsx" | ".mjs";
}

/** One type error in a sample. */
export interface SampleTypeError {
  /** The markdown line it is on. */
  line: number;
  /** TypeScript's error code, as in `TS2322`. */
  code: number;
  /** TypeScript's message, on one line. */
  message: string;
}

/** Options for {@link typecheckSamples}. */
export interface TypecheckSamplesOptions {
  /** The `tsconfig.json` to compile under. Default: the one in the working directory, if any. */
  tsconfig?: string;
  /**
   * Where each sample is written to be compiled; it must sit inside the project, so the package's
   * name resolves. Default `.cosyte-doc-snippets/typecheck` in the working directory.
   */
  dir?: string;
}

/** The fence languages that make a block a code sample: TypeScript and JavaScript. */
export declare const SAMPLE_LANGS: ReadonlySet<string>;

/** What a suite does with one sample. */
export interface SamplePlanStep {
  /** The test name: the file, relative to the root, and the sample's first code line. */
  label: string;
  /** Run it, skip it with its reason, or report a `no-run` or `no-typecheck` that gives no reason. */
  kind: "run" | "skip" | "invalid";
  /**
   * Why it is skipped or invalid; for a run, why it is not type-checked, or `null` when nothing is
   * left out.
   */
  reason: string | null;
  /** Whether the sample is type-checked before it runs: a TypeScript sample, in every-sample mode. */
  typecheck: boolean;
  /** The sample. */
  snippet: Sample;
}

/** Options for {@link planSamples}. */
export interface PlanSamplesOptions {
  /** Take every sample rather than only the `runnable` ones. Default `false`. */
  every?: boolean;
  /** What labels are relative to. Default: the working directory. */
  root?: string;
  /** Fence opt-in tag when `every` is off. Default `"runnable"`. */
  runnableTag?: string;
}

/** Options for {@link extractRunnableSnippets}. */
export interface ExtractOptions {
  /** Fence opt-in tag. Default `"runnable"`. */
  runnableTag?: string;
}

/** Options for {@link runSnippet}. */
export interface RunSnippetOptions {
  /** Import-specifier remapper (e.g. package name → its built `dist`). */
  resolve?: (specifier: string) => string | undefined;
  /** Temp directory for the emitted module (must live inside the project root). */
  tmpDir?: string;
  /** Force the expected-to-throw expectation even for a raw-string snippet. */
  throws?: boolean;
  /** The snippet's type errors, from {@link typecheckSamples}: when any, it fails before it runs. */
  typeErrors?: SampleTypeError[];
}

/** Options for {@link docSnippetSuite}. */
export interface DocSnippetSuiteOptions {
  /** Directory to walk for markdown (recursively). Ignored when `files` is given. */
  docsDir?: string;
  /** Explicit markdown file paths, overriding `docsDir`. */
  files?: string[];
  /** Filename filter for `docsDir` walking. Default: `.md` / `.mdx`. */
  include?: RegExp;
  /** Import-specifier remapper (e.g. package name → its built `dist`). */
  resolve?: (specifier: string) => string | undefined;
  /** Fence opt-in tag. Default `"runnable"`. */
  runnableTag?: string;
  /** Suite label. Default `"doc/code agreement"`. */
  name?: string;
  /** Assert at least one runnable snippet exists. Default `false`. */
  requireSnippet?: boolean;
  /** Where temp modules are written (must be inside the project root). */
  tmpDir?: string;
  /**
   * Run every TypeScript and JavaScript sample, not only the `runnable` ones; a `no-run <reason>`
   * sample is listed as skipped with its reason, and a `no-run` with no reason fails. Each
   * TypeScript sample is type-checked before it runs, unless it carries `no-typecheck <reason>`.
   * Walking `docsDir`, the generated `api/` folder is left out. Default `false`.
   */
  every?: boolean;
  /** In every-sample mode, walk the generated `api/` folder of `docsDir` too. Default `false`. */
  includeGenerated?: boolean;
  /** The `tsconfig.json` samples are type-checked under. Default: the one in the working directory. */
  tsconfig?: string;
}

/**
 * Extract every code sample from a markdown string: each `ts`, `typescript`, `tsx`, `js`,
 * `javascript` or `mjs` block, tagged or not, in document order.
 *
 * @param markdown - The markdown source.
 * @returns One entry per sample.
 */
export declare function extractSamples(markdown: string): Sample[];

/**
 * Decide what a suite does with each sample in a set of markdown files.
 *
 * @param files - Markdown file paths.
 * @param options - Options.
 * @returns One step per sample, in file and document order.
 */
export declare function planSamples(
  files: string[],
  options?: PlanSamplesOptions,
): SamplePlanStep[];

/**
 * Type-check TypeScript samples against the package's types, each as its own module, under the
 * project's `tsconfig.json` with emit and the unused-name checks off. Needs `typescript`.
 *
 * @param samples - The samples: their code, the markdown line of their first code line, and the
 *   extension they compile as (`.ts` when absent).
 * @param options - Options.
 * @returns For each sample, in order, its errors; empty for one that compiles.
 * @throws When the config cannot be read or the program as a whole has an error.
 */
export declare function typecheckSamples(
  samples: Array<Pick<RunnableSnippet, "code" | "line" | "extension">>,
  options?: TypecheckSamplesOptions,
): Promise<SampleTypeError[][]>;

/**
 * Extract the opt-in runnable snippets from a markdown string, in document order.
 *
 * @param markdown - The markdown source.
 * @param opts - Options.
 * @returns One entry per ```` ```ts runnable ```` block.
 */
export declare function extractRunnableSnippets(
  markdown: string,
  opts?: ExtractOptions,
): RunnableSnippet[];

/**
 * Rewrite inline `<expr>; // => <value>` doctest lines into `expect(<expr>).toStrictEqual(<value>)`.
 *
 * @param code - The snippet source.
 * @returns The rewritten source and the number of assertions added.
 */
export declare function rewriteAssertions(code: string): { code: string; assertions: number };

/**
 * Rewrite the module specifiers in a snippet's `import ... from "<spec>"` clauses.
 *
 * @param code - The snippet source.
 * @param resolveFn - Specifier mapper; `undefined`/same-spec returns are no-ops.
 * @returns The source with remapped `from "..."` clauses.
 */
export declare function remapImports(
  code: string,
  resolveFn: ((specifier: string) => string | undefined) | undefined,
): string;

/**
 * Compile and execute one snippet as an ES module in the running Vitest process. Resolves on success;
 * rejects (AssertionError or the thrown error) on failure. A block tagged `throws` must throw.
 *
 * @param snippet - A snippet object or its raw source.
 * @param opts - Options.
 */
export declare function runSnippet(
  snippet: RunnableSnippet | string,
  opts?: RunSnippetOptions,
): Promise<void>;

/**
 * Register a Vitest suite that proves every runnable `docs-content` snippet agrees with the code.
 * A package with no `docs-content` (or no runnable blocks) yields an empty, passing suite.
 *
 * @param options - Options.
 */
export declare function docSnippetSuite(options?: DocSnippetSuiteOptions): void;
