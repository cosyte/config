import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, test } from "vitest";

/**
 * The doc/code-agreement harness: the documentation analog of the parser conformance runners.
 *
 * A `docs-content` example a developer can copy into a production integration is only safe if it
 * still does what the prose claims *against the built package*. A snippet that silently mis-reads a
 * dose, an allergy, a code system, or a patient identifier is the clinical-harm failure mode wearing
 * a documentation costume, so a green docs build carrying a wrong snippet is the exact thing this
 * catches. Every fenced block a package opts in (```` ```ts runnable ````) is extracted, its inline
 * `// => value` assertions are compiled to real `expect(...)` checks, and the whole block is executed
 * as an ES module in the running Vitest process. If it throws, or an assertion fails, the docs
 * build fails, loudly, next to the file and line.
 *
 * Lives in `@cosyte/vitest-config` (not the framework-agnostic `@cosyte/test-utils`) on purpose:
 * {@link docSnippetSuite} registers Vitest `describe`/`test` blocks, so it belongs with the Vitest
 * config every parser already depends on: zero new devDep, one versioned implementation on the
 * Changesets train, devDep-only.
 *
 * @packageDocumentation
 */

/** Fence languages treated as executable TypeScript. */
const RUNNABLE_LANGS = new Set(["ts", "typescript", "tsx"]);

/**
 * The fence languages that make a block a code sample in every-sample mode: TypeScript and
 * JavaScript. A shell, JSON or text block is not a sample and is never run.
 */
export const SAMPLE_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "mjs"]);

/** The module extension each sample language is written with, so a JavaScript sample runs as one. */
const EXTENSIONS = new Map([
  ["tsx", ".tsx"],
  ["js", ".mjs"],
  ["javascript", ".mjs"],
  ["mjs", ".mjs"],
]);

/** The fence tag that marks a sample as not run; the words after it are the reason. */
const NO_RUN = "no-run";

/** Monotonic counter so every emitted temp module gets a unique, cache-busting filename. */
let moduleCounter = 0;

/**
 * A fence opener's indentation and its run of three or more backticks or tildes.
 *
 * Nothing follows the run in the pattern: the info string is the rest of the line, cut off by hand.
 * The earlier form, `\s*(.*)$` after the run, had two quantifiers that could both take the same
 * spaces, so a long line that failed to match cost time quadratic in its length (CodeQL
 * js/polynomial-redos). These docs come from the package being tested, and a markdown file is
 * still input this harness should read in linear time.
 */
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})/;

/**
 * The characters `.` does not match in a JavaScript regular expression. A fence's info string, a
 * doctest expression and its expected value were each `.+` or `.*` in the earlier patterns, so none
 * of them may hold one; the hand-written parsing below keeps that rule.
 */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * The `; // =>` marker of a doctest assertion. Each quantifier is followed by a character it cannot
 * match, so a scan of a line is linear in its length.
 */
const ASSERTION_MARKER = /;\s*\/\/\s*=>/g;

/**
 * Every fenced block in a markdown string, in document order.
 *
 * @param {string} markdown - The markdown source.
 * @returns {Array<{ lang: string | undefined, meta: string[], code: string, line: number }>}
 *   `lang` is the first word of the info string, lower-cased; `line` is the 1-based line of the
 *   block's first code line.
 */
function scanFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  // Stryker disable next-line ArrayDeclaration: equivalent, every caller keeps blocks by language.
  const out = [];
  let i = 0;
  // Stryker disable next-line EqualityOperator: equivalent, the line past the end matches no fence.
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]);
    // Stryker disable next-line StringLiteral,MethodExpression: equivalent, a line that opens no fence
    // never reads it, and the words are trimmed on both sides below.
    const info = open ? lines[i].slice(open[0].length).trimStart() : "";
    if (!open || LINE_TERMINATOR.test(info)) {
      i++;
      continue;
    }
    const [, indent, fence] = open;
    const firstCodeLine = i + 2; // 1-based line of the first body line
    const body = [];
    let j = i + 1;
    // Stryker disable next-line BooleanLiteral: equivalent, an unclosed block runs to the last line.
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
    // Stryker disable next-line MethodExpression,Regex: equivalent, every empty word is filtered.
    const tokens = info.trim().split(/\s+/).filter(Boolean);
    out.push({
      lang: tokens[0]?.toLowerCase(),
      meta: tokens.slice(1),
      code: body.join("\n"),
      line: firstCodeLine,
    });
    i = closed ? j + 1 : j;
  }
  return out;
}

/**
 * Extract the opt-in runnable snippets from a markdown string.
 *
 * A block is runnable when its fence info string names a TypeScript language *and* carries the
 * opt-in tag, e.g. ```` ```ts runnable ````. Everything else (prose, shell, un-tagged `ts` blocks)
 * is ignored: opt-in, never opt-out, so documenting non-executable pseudocode stays possible.
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
  return scanFences(markdown)
    .filter((block) => RUNNABLE_LANGS.has(block.lang) && block.meta.includes(runnableTag))
    .map((block) => ({ ...block, throws: block.meta.includes("throws") }));
}

/**
 * Extract every code sample from a markdown string: each TypeScript or JavaScript block, tagged or
 * not.
 *
 * A sample that cannot run carries `no-run` and its reason in the fence, as in
 * ```` ```ts no-run starts a listener that never closes ````: `skip` is then the reason (the words
 * after `no-run`, which may be empty, and an empty reason is an error the suite reports). `throws`
 * is read from the tags before `no-run` only, since the words after it are prose.
 *
 * @param {string} markdown - The markdown source.
 * @returns {Array<{ lang: string, meta: string[], code: string, line: number, throws: boolean, skip: string | null }>}
 *   One entry per sample, in document order.
 */
export function extractSamples(markdown) {
  return scanFences(markdown)
    .filter((block) => SAMPLE_LANGS.has(block.lang))
    .map((block) => {
      const at = block.meta.indexOf(NO_RUN);
      const tags = at === -1 ? block.meta : block.meta.slice(0, at);
      return {
        ...block,
        throws: tags.includes("throws"),
        skip: at === -1 ? null : block.meta.slice(at + 1).join(" "),
      };
    });
}

/**
 * Decide what the suite does with each sample in a set of markdown files: run it, skip it with its
 * reason, or report it as invalid (a `no-run` with no reason).
 *
 * @param {string[]} files - Markdown file paths.
 * @param {{ every?: boolean, root?: string, runnableTag?: string }} [options] - `every` takes every
 *   sample rather than only the `runnable` ones; `root` is what labels are relative to (default the
 *   working directory).
 * @returns {Array<{ label: string, kind: "run" | "skip" | "invalid", reason: string | null, snippet: object }>}
 */
export function planSamples(files, options = {}) {
  const root = options.root ?? process.cwd();
  const plan = [];
  for (const filePath of files) {
    const markdown = readFileSync(filePath, "utf8");
    const samples = options.every
      ? extractSamples(markdown)
      : extractRunnableSnippets(markdown, { runnableTag: options.runnableTag }).map((s) => ({
          ...s,
          skip: null,
        }));
    for (const snippet of samples) {
      const label = `${relative(root, filePath)}:${snippet.line}`;
      if (snippet.skip === null) {
        plan.push({ label, kind: "run", reason: null, snippet });
      } else if (snippet.skip === "") {
        plan.push({
          label,
          kind: "invalid",
          reason: "a no-run sample names its reason after no-run, as in: ts no-run <why>",
          snippet,
        });
      } else {
        plan.push({ label, kind: "skip", reason: snippet.skip, snippet });
      }
    }
  }
  return plan;
}

/**
 * Rewrite inline doctest assertions into real `expect(...)` calls.
 *
 * A line of the form `<expression>; // => <value>` becomes `expect(<expression>).toStrictEqual(<value>)`.
 * The right-hand side is any JavaScript expression (a literal, `[]`, an object, another call). It is
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
      const m = splitAssertion(line);
      if (!m) return line;
      assertions++;
      return `${m.ws}expect(${m.expr}).toStrictEqual(${m.expected});`;
    })
    .join("\n");
  return { code: rewritten, assertions };
}

/**
 * Split a doctest line into its indentation, its expression and its expected value.
 *
 * The first `; // =>` with anything after it splits the line: the expression is what lies between
 * the indentation and that marker, the expected value is the rest, trimmed. A line with no such
 * marker, or whose expression or value holds a line terminator, is not an assertion.
 *
 * Parsed by hand rather than by one pattern: `^(\s*)(.+?);\s*\/\/\s*=>\s*(.+?)\s*$` let several
 * quantifiers take the same spaces, so a long line that failed to match cost time quadratic in its
 * length (CodeQL js/polynomial-redos). This is linear. It agrees with that pattern on every line
 * with an expression and a value. Where the expression is empty (`; // => 1`), it emits `expect()`,
 * which fails the snippet; the pattern emitted `expect( )` for an indented line and left an
 * unindented one as it was, a line that asserts nothing.
 *
 * @param {string} line - One source line.
 * @returns {{ ws: string, expr: string, expected: string } | null} The parts, or `null`.
 */
function splitAssertion(line) {
  for (const marker of line.matchAll(ASSERTION_MARKER)) {
    const end = marker.index + marker[0].length;
    // Only the last marker can end the line, so this skips at most once.
    if (end === line.length) continue;
    const ws = line.slice(0, line.length - line.trimStart().length);
    const expr = line.slice(ws.length, marker.index);
    const expected = line.slice(end).trim();
    if (LINE_TERMINATOR.test(expr) || LINE_TERMINATOR.test(expected)) return null;
    return { ws, expr, expected };
  }
  return null;
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
 * Vitest transforms it: files under `node_modules` are treated as external and would reach Node as
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

  const extension =
    (typeof snippet === "string" ? undefined : EXTENSIONS.get(snippet.lang)) ?? ".ts";
  mkdirSync(tmpDir, { recursive: true });
  const file = join(tmpDir, `snippet-${process.pid}-${moduleCounter++}${extension}`);
  writeFileSync(file, moduleSource, "utf8");
  try {
    if (throwsExpected) {
      // Weaker guarantee, by design: a `throws` block is green if the import rejects for ANY reason:
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
 * A package with no `docs-content` (or no runnable blocks) yields an empty, passing suite: the docs
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
 * @param {boolean} [options.every] - Run every TypeScript and JavaScript sample, not only the
 *   `runnable` ones; a `no-run <reason>` sample is listed as skipped with its reason. Default `false`.
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
    // Stryker disable next-line BooleanLiteral: read while Vitest collects the suite, which Stryker's
    // Vitest runner cannot reach (see below); applied by hand, it fails test/doc-samples-every.test.ts.
    every = false,
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

    // From here to the end of the loop the code runs while Vitest collects the suite, and Stryker's
    // Vitest runner switches a mutant on only once the tests run, so none of its mutants reach this
    // region. Each mutant of it was applied by hand instead, and each fails
    // test/doc-samples-every.test.ts.
    // Stryker disable all
    const plan = planSamples(mdFiles, { every, runnableTag });
    let total = 0;
    for (const step of plan) {
      if (step.kind === "run") {
        total++;
        test(step.label, async () => {
          await runSnippet(step.snippet, { resolve: resolveFn, tmpDir });
        });
        continue;
      }
      if (step.kind === "skip") {
        test.skip(`${step.label} (not run: ${step.reason})`, () => {});
        continue;
      }
      // An invalid sample: a no-run with no reason. This test only ever fails, so its lines are
      // proven by a separate Vitest run (test/doc-samples-every.test.ts, "a no-run sample with no
      // reason fails the suite"), whose coverage this run cannot collect.
      /* v8 ignore next 3 */
      test(step.label, () => {
        throw new Error(`${step.label}: ${step.reason}`);
      });
    }
    // Stryker restore all

    if (requireSnippet) {
      test("carries at least one runnable snippet", () => {
        expect(total, "no `ts runnable` blocks found in docs-content").toBeGreaterThan(0);
      });
    } else if (total === 0) {
      // A package with docs but no runnable examples yet (the common scaffold state) would otherwise
      // leave this an empty suite, which Vitest reports as a "no test found in file" failure. A
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
 * Recursively collect markdown files under a directory. A missing directory yields `[]`: a package
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
