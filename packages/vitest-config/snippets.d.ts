/**
 * The doc/code-agreement harness — the documentation analog of the parser conformance runners.
 *
 * Every fenced block a `docs-content` page opts in (```` ```ts runnable ````) is extracted, its
 * inline `// => value` assertions compiled to real `expect(...)` checks, and the whole block executed
 * against the built package inside the running Vitest process. A green docs build carrying a wrong
 * snippet is the exact failure this prevents.
 */

/** One extracted runnable snippet, in document order. */
export interface RunnableSnippet {
  /** The fence language (`ts` / `typescript` / `tsx`). */
  lang: string;
  /** Fence info-string tokens after the language (e.g. `["runnable", "throws"]`). */
  meta: string[];
  /** The snippet source (dedented to the fence's own indentation). */
  code: string;
  /** 1-based line of the snippet's first code line, for failure attribution. */
  line: number;
  /** Whether the block is tagged `throws` (expected to throw rather than run clean). */
  throws: boolean;
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
}

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
