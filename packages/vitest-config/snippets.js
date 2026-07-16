import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, test } from "vitest";

/**
 * The doc/code-agreement harness — the documentation analog of the parser conformance runners.
 *
 * A `docs-content` example a developer can copy into a production integration is only safe if it
 * still does what the prose claims *against the built package*. A snippet that silently mis-reads a
 * dose, an allergy, a code system, or a patient identifier is the clinical-harm failure mode wearing
 * a documentation costume — so a green docs build carrying a wrong snippet is the exact thing this
 * catches. Every fenced block a package opts in (```` ```ts runnable ````) is extracted, its inline
 * `// => value` assertions are compiled to real `expect(...)` checks, and the whole block is executed
 * as an ES module in the running Vitest process. If it throws — or an assertion fails — the docs
 * build fails, loudly, next to the file and line.
 *
 * Lives in `@cosyte/vitest-config` (not the framework-agnostic `@cosyte/test-utils`) on purpose:
 * {@link docSnippetSuite} registers Vitest `describe`/`test` blocks, so it belongs with the Vitest
 * config every parser already depends on — zero new devDep, one versioned implementation on the
 * Changesets train, devDep-only.
 *
 * @packageDocumentation
 */

/** Fence languages treated as executable TypeScript. */
const RUNNABLE_LANGS = new Set(["ts", "typescript", "tsx"]);

/** Monotonic counter so every emitted temp module gets a unique, cache-busting filename. */
let moduleCounter = 0;

/**
 * Extract the opt-in runnable snippets from a markdown string.
 *
 * A block is runnable when its fence info string names a TypeScript language *and* carries the
 * opt-in tag, e.g. ```` ```ts runnable ````. Everything else — prose, shell, un-tagged `ts` blocks
 * — is ignored: opt-in, never opt-out, so documenting non-executable pseudocode stays possible.
 * The `throws` meta tag marks a block expected to throw rather than run clean.
 *
 * @param {string} markdown - The markdown source.
 * @param {{ runnableTag?: string }} [opts] - Options; `runnableTag` overrides the default `"runnable"`.
 * @returns {Array<{ lang: string, meta: string[], code: string, line: number, throws: boolean }>}
 *   One entry per runnable block, in document order. `line` is the 1-based line of the block's first
 *   code line (so a failure points at the snippet, not the fence).
 */
export function extractRunnableSnippets(markdown, opts = {}) {
  const runnableTag = opts.runnableTag ?? "runnable";
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*(.*)$/);
    if (!open) {
      i++;
      continue;
    }
    const [, indent, fence, info] = open;
    const firstCodeLine = i + 2; // 1-based line of the first body line
    const body = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const close = lines[j].match(/^(\s*)(`{3,}|~{3,})\s*$/);
      if (
        close &&
        close[2][0] === fence[0] &&
        close[2].length >= fence.length &&
        close[1].length === indent.length
      ) {
        closed = true;
        break;
      }
      body.push(indent && lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
      j++;
    }
    const tokens = info.trim().split(/\s+/).filter(Boolean);
    const lang = tokens[0]?.toLowerCase();
    const meta = tokens.slice(1);
    if (RUNNABLE_LANGS.has(lang) && meta.includes(runnableTag)) {
      out.push({
        lang,
        meta,
        code: body.join("\n"),
        line: firstCodeLine,
        throws: meta.includes("throws"),
      });
    }
    i = closed ? j + 1 : j;
  }
  return out;
}

/**
 * Rewrite inline doctest assertions into real `expect(...)` calls.
 *
 * A line of the form `<expression>; // => <value>` becomes `expect(<expression>).toStrictEqual(<value>)`.
 * The right-hand side is any JavaScript expression (a literal, `[]`, an object, another call) — it is
 * evaluated in the snippet's own scope, so it can reference values the snippet defined. Lines without
 * the `// =>` marker are left untouched and simply execute for their side effects (and must not throw).
 *
 * @param {string} code - The snippet source.
 * @returns {{ code: string, assertions: number }} The rewritten source and how many assertions it grew.
 */
export function rewriteAssertions(code) {
  let assertions = 0;
  const rewritten = code
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^(\s*)(.+?);\s*\/\/\s*=>\s*(.+?)\s*$/);
      if (!m) return line;
      assertions++;
      const [, ws, expr, expected] = m;
      return `${ws}expect(${expr}).toStrictEqual(${expected});`;
    })
    .join("\n");
  return { code: rewritten, assertions };
}

/**
 * Rewrite the module specifiers in a snippet's `import ... from "<spec>"` clauses.
 *
 * Lets a suite point a snippet's `import { parseHl7 } from "@cosyte/hl7"` at the *built* package
 * (`dist/`) rather than whatever the test-time resolver picks, so the docs are proven against the
 * artifact a consumer actually installs. A `resolve` that returns `undefined`/the same spec is a
 * no-op for that import.
 *
 * @param {string} code - The snippet source.
 * @param {((specifier: string) => string | undefined) | undefined} resolveFn - Specifier mapper.
 * @returns {string} The source with remapped `from "..."` clauses.
 */
export function remapImports(code, resolveFn) {
  if (!resolveFn) return code;
  return code.replace(/(\bfrom\s*)(["'])([^"']+)\2/g, (full, kw, quote, spec) => {
    const mapped = resolveFn(spec);
    return mapped && mapped !== spec ? `${kw}${quote}${mapped}${quote}` : full;
  });
}

/**
 * Compile and execute one snippet as an ES module in the running Vitest process.
 *
 * The snippet is remapped, its assertions rewritten, an `expect` import prepended, and the result
 * written to a unique temp `.ts` file under `tmpDir` (which MUST live inside the project root so
 * Vitest transforms it — files under `node_modules` are treated as external and would reach Node as
 * raw TypeScript). It is then dynamically imported: Vitest's module runner transforms the TypeScript
 * and runs it. A block tagged `throws` must throw; any other block must run clean. The temp file is
 * always removed afterwards.
 *
 * Exported directly (not only via {@link docSnippetSuite}) so the harness can be unit-tested: a
 * deliberately-wrong snippet must make this reject.
 *
 * @param {{ code: string, throws?: boolean } | string} snippet - A snippet object or its raw source.
 * @param {{ resolve?: (specifier: string) => string | undefined, tmpDir?: string, throws?: boolean }} [opts]
 *   Options.
 * @returns {Promise<void>} Resolves on success; rejects (AssertionError or the thrown error) on failure.
 */
export async function runSnippet(snippet, opts = {}) {
  const code = typeof snippet === "string" ? snippet : snippet.code;
  const throwsExpected =
    (typeof snippet === "string" ? false : snippet.throws) || opts.throws || false;
  const tmpDir = opts.tmpDir ?? defaultTmpDir();

  const remapped = remapImports(code, opts.resolve);
  const { code: asserted } = rewriteAssertions(remapped);
  const moduleSource = `import { expect } from "vitest";\n${asserted}\n`;

  mkdirSync(tmpDir, { recursive: true });
  const file = join(tmpDir, `snippet-${process.pid}-${moduleCounter++}.ts`);
  writeFileSync(file, moduleSource, "utf8");
  try {
    if (throwsExpected) {
      // Weaker guarantee, by design: a `throws` block is green if the import rejects for ANY reason —
      // the documented error, but also a compile error or a bad specifier. It proves "this does not
      // run clean," not "this fails the specific way the prose claims." Assert the precise failure
      // inside the snippet (a try/catch with an `// =>` on the caught code/message) when that matters.
      let threw = false;
      try {
        await import(pathToFileURL(file).href);
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("snippet tagged `throws` completed without throwing");
    } else {
      await import(pathToFileURL(file).href);
    }
  } finally {
    try {
      rmSync(file, { force: true });
    } catch {
      // best-effort cleanup; a leaked temp file never fails the run
    }
  }
}

/**
 * Register a Vitest suite that proves every runnable `docs-content` snippet agrees with the code.
 *
 * Point it at a `docsDir` (or an explicit `files` list); it walks the markdown, turns each opt-in
 * runnable block into a `test` labelled by file and line, and executes it against the built package.
 * A package with no `docs-content` (or no runnable blocks) yields an empty, passing suite — the docs
 * site's build-on-missing-content invariant has a testing analog here: absence degrades quietly, a
 * *wrong* snippet fails loudly. Set `requireSnippet` when a repo wants to assert its docs carry at
 * least one executed example.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.docsDir] - Directory to walk for markdown (recursively). Ignored if `files` is given.
 * @param {string[]} [options.files] - Explicit markdown file paths, overriding `docsDir`.
 * @param {RegExp} [options.include] - Filename filter for `docsDir` walking. Default: `.md`/`.mdx`.
 * @param {(specifier: string) => string | undefined} [options.resolve] - Import-specifier remapper (e.g. name → dist).
 * @param {string} [options.runnableTag] - Fence opt-in tag. Default `"runnable"`.
 * @param {string} [options.name] - Suite label. Default `"doc/code agreement"`.
 * @param {boolean} [options.requireSnippet] - Assert at least one runnable snippet exists. Default `false`.
 * @param {string} [options.tmpDir] - Where temp modules are written (must be inside the project root).
 * @returns {void}
 */
export function docSnippetSuite(options = {}) {
  const {
    docsDir,
    files,
    include = /\.mdx?$/i,
    resolve: resolveFn,
    runnableTag = "runnable",
    name = "doc/code agreement",
    requireSnippet = false,
    tmpDir = defaultTmpDir(),
  } = options;

  const mdFiles = files ?? (docsDir ? collectMarkdown(docsDir, include) : []);

  describe(name, () => {
    afterAll(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    });

    let total = 0;
    for (const filePath of mdFiles) {
      const snippets = extractRunnableSnippets(readFileSync(filePath, "utf8"), { runnableTag });
      total += snippets.length;
      for (const snippet of snippets) {
        const label = `${relative(process.cwd(), filePath)}:${snippet.line}`;
        test(label, async () => {
          await runSnippet(snippet, { resolve: resolveFn, tmpDir });
        });
      }
    }

    if (requireSnippet) {
      test("carries at least one runnable snippet", () => {
        expect(total, "no `ts runnable` blocks found in docs-content").toBeGreaterThan(0);
      });
    } else if (total === 0) {
      // A package with docs but no runnable examples yet (the common scaffold state) would otherwise
      // leave this an empty suite — which Vitest reports as a "no test found in file" failure. A
      // passing no-op keeps the wired suite green until the first snippet is tagged `runnable`.
      test("no runnable snippets to check", () => {});
    }
  });
}

/** Default temp directory: inside the project root (never `node_modules`, which Vitest won't transform). */
function defaultTmpDir() {
  return join(process.cwd(), ".cosyte-doc-snippets");
}

/**
 * Recursively collect markdown files under a directory. A missing directory yields `[]` — a package
 * without `docs-content` produces an empty suite rather than a crash.
 *
 * @param {string} dir - Root directory.
 * @param {RegExp} include - Filename filter.
 * @returns {string[]} Absolute-or-relative file paths, sorted for stable test ordering.
 */
function collectMarkdown(dir, include) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries.sort()) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...collectMarkdown(full, include));
    else if (include.test(entry)) out.push(full);
  }
  return out;
}
