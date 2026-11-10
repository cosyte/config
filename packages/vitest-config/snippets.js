import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

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

/**
 * The module extension each sample language is written with in every-sample mode, so a JavaScript
 * sample runs as JavaScript and a `tsx` one as TSX. Any other language is written as `.ts`. A snippet
 * taken without `every` carries no extension and is written as `.ts`, as it always has been.
 */
const EXTENSIONS = new Map([
  ["tsx", ".tsx"],
  ["js", ".mjs"],
  ["javascript", ".mjs"],
  ["mjs", ".mjs"],
]);

/** The fence tag that marks a sample as not run; the words after it are the reason. */
const NO_RUN = "no-run";

/**
 * The fence tag that marks a TypeScript sample as run but not type-checked; the words after it are
 * the reason. It is the only way to leave a sample's types unchecked in every-sample mode.
 */
const NO_TYPECHECK = "no-typecheck";

/** The module extensions of the samples that are type-checked: the TypeScript ones. */
const TYPED_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * The folder under a docs directory that the reference generator owns. Its pages are generated
 * from TSDoc, and their examples are fragments of a signature's documentation, not samples a reader
 * runs, so a suite walking `docsDir` in every-sample mode leaves the folder out unless asked.
 */
const GENERATED_DIR = "api";

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
 * after `no-run`, which may be empty, and an empty reason is an error the suite reports). A sample
 * that runs but whose types cannot be checked carries `no-typecheck` and its reason the same way,
 * and `noTypecheck` is then the reason. `throws` is read from the tags before either tag only, since
 * the words after it are prose.
 *
 * @param {string} markdown - The markdown source.
 * @returns {Array<{ lang: string, meta: string[], code: string, line: number, throws: boolean, skip: string | null, noTypecheck: string | null, extension: string }>}
 *   One entry per sample, in document order. `extension` is the module it runs as: `.mjs` for a
 *   JavaScript sample, `.tsx` for a `tsx` one, `.ts` for the rest.
 */
export function extractSamples(markdown) {
  return scanFences(markdown)
    .filter((block) => SAMPLE_LANGS.has(block.lang))
    .map((block) => {
      // The first of the two tags that take a reason wins; the words after it are its reason, so a
      // tag written inside a reason is prose.
      const at = block.meta.findIndex((tag) => tag === NO_RUN || tag === NO_TYPECHECK);
      const tags = at === -1 ? block.meta : block.meta.slice(0, at);
      const reason = block.meta.slice(at + 1).join(" ");
      return {
        ...block,
        throws: tags.includes("throws"),
        skip: block.meta[at] === NO_RUN ? reason : null,
        noTypecheck: block.meta[at] === NO_TYPECHECK ? reason : null,
        extension: EXTENSIONS.get(block.lang) ?? ".ts",
      };
    });
}

/**
 * Decide what the suite does with each sample in a set of markdown files: run it, skip it with its
 * reason, or report it as invalid (a `no-run` or a `no-typecheck` with no reason). A sample that runs
 * is also type-checked when `every` is on, it is TypeScript, and it carries no `no-typecheck`; its
 * `reason` is then null, and for a `no-typecheck` sample it is that tag's reason.
 *
 * @param {string[]} files - Markdown file paths.
 * @param {{ every?: boolean, root?: string, runnableTag?: string }} [options] - `every` takes every
 *   sample rather than only the `runnable` ones; `root` is what labels are relative to (default the
 *   working directory).
 * @returns {Array<{ label: string, kind: "run" | "skip" | "invalid", reason: string | null, typecheck: boolean, snippet: object }>}
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
          noTypecheck: null,
        }));
    for (const snippet of samples) {
      const label = `${relative(root, filePath)}:${snippet.line}`;
      if (snippet.noTypecheck === "") {
        plan.push({
          label,
          kind: "invalid",
          reason:
            "a no-typecheck sample names its reason after no-typecheck, as in: ts no-typecheck <why>",
          typecheck: false,
          snippet,
        });
      } else if (snippet.skip === null) {
        plan.push({
          label,
          kind: "run",
          reason: snippet.noTypecheck,
          typecheck:
            options.every === true &&
            snippet.noTypecheck === null &&
            TYPED_EXTENSIONS.has(snippet.extension),
          snippet,
        });
      } else if (snippet.skip === "") {
        plan.push({
          label,
          kind: "invalid",
          reason: "a no-run sample names its reason after no-run, as in: ts no-run <why>",
          typecheck: false,
          snippet,
        });
      } else {
        plan.push({ label, kind: "skip", reason: snippet.skip, typecheck: false, snippet });
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
 * written to a unique temp module under `tmpDir` (which MUST live inside the project root so Vitest
 * transforms it: files under `node_modules` are treated as external and would reach Node as raw
 * TypeScript). The module is a `.ts` file unless the snippet names another `extension`, as each
 * sample from {@link extractSamples} does. It is then dynamically imported: Vitest's module runner transforms the TypeScript
 * and runs it. A block tagged `throws` must throw; any other block must run clean. The temp file is
 * always removed afterwards.
 *
 * Exported directly (not only via {@link docSnippetSuite}) so the harness can be unit-tested: a
 * deliberately-wrong snippet must make this reject.
 *
 * @param {{ code: string, throws?: boolean, extension?: string } | string} snippet - A snippet
 *   object or its raw source.
 * @param {{ resolve?: (specifier: string) => string | undefined, tmpDir?: string, throws?: boolean, typeErrors?: Array<{ line: number, code: number, message: string }> }} [opts]
 *   Options. `typeErrors` are what {@link typecheckSamples} found in this snippet: when there are
 *   any, the snippet fails with them before it runs.
 * @returns {Promise<void>} Resolves on success; rejects (AssertionError or the thrown error) on failure.
 */
export async function runSnippet(snippet, opts = {}) {
  const typeErrors = opts.typeErrors ?? [];
  if (typeErrors.length > 0) {
    throw new Error(
      "the sample does not type-check against the package's types:\n" +
        typeErrors.map((e) => `  line ${e.line}: TS${e.code}: ${e.message}`).join("\n"),
    );
  }
  const code = typeof snippet === "string" ? snippet : snippet.code;
  const throwsExpected =
    (typeof snippet === "string" ? false : snippet.throws) || opts.throws || false;
  const tmpDir = opts.tmpDir ?? defaultTmpDir();

  const remapped = remapImports(code, opts.resolve);
  const { code: asserted } = rewriteAssertions(remapped);
  const moduleSource = `import { expect } from "vitest";\n${asserted}\n`;

  // A raw string has no `extension` property, so it is a `.ts` module too.
  const extension = snippet.extension ?? ".ts";
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
 * Compiler options a sample is checked under when no `tsconfig.json` is found: what our libraries'
 * shared TypeScript config sets for module resolution and strictness. `skipLibCheck` keeps the
 * check on the samples, not on the declarations they import.
 */
const DEFAULT_COMPILER_OPTIONS = {
  target: "es2023",
  module: "nodenext",
  moduleResolution: "nodenext",
  strict: true,
  skipLibCheck: true,
};

/**
 * Type-check TypeScript samples against the package's types, as a reader who copies one into a
 * project would compile it: each sample is its own module, importing the package by the name it is
 * published under, which TypeScript resolves the way the project does (for a library, to its own
 * built declarations through its `exports`).
 *
 * The compiler options are the project's `tsconfig.json` (the one named, or the one in the working
 * directory when none is named; without either, {@link DEFAULT_COMPILER_OPTIONS}), with what does
 * not fit a sample turned off: emit and its folders, and the unused-name checks, since a sample may
 * declare a name only to show it. The samples are compiled together, as one program, for speed; every sample is a
 * module, so none sees another's names.
 *
 * Needs the `typescript` package, which every TypeScript project has.
 *
 * @param {Array<{ code: string, line: number, extension?: string }>} samples - The samples, as
 *   {@link extractSamples} returns them: `line` is the markdown line of the first code line, and an
 *   `extension` of `.tsx` compiles a sample as TSX.
 * @param {{ tsconfig?: string, dir?: string }} [options] - `tsconfig` names the config file; `dir`
 *   is where each sample is written to be compiled (default `.cosyte-doc-snippets/typecheck` in the
 *   working directory), which must sit inside the project so its packages resolve.
 * @returns {Promise<Array<Array<{ line: number, code: number, message: string }>>>} For each sample,
 *   in order, its errors, each with the markdown line it is on; empty for a sample that compiles.
 * @throws {Error} When the config cannot be read, or the program as a whole has an error (an option
 *   or a missing type library), which would fail every sample alike.
 */
export async function typecheckSamples(samples, options = {}) {
  const { default: ts } = await import("typescript");
  const dir = options.dir ?? join(defaultTmpDir(), "typecheck");
  const local = join(process.cwd(), "tsconfig.json");
  const tsconfig = options.tsconfig ?? (existsSync(local) ? local : undefined);
  const fail = (diagnostics) => {
    throw new Error(
      `the samples could not be type-checked: ${diagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
        .join("; ")}`,
    );
  };
  let base = ts.convertCompilerOptionsFromJson(DEFAULT_COMPILER_OPTIONS, dir).options;
  if (tsconfig !== undefined) {
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => fail([d]),
    });
    // TS18003, "no inputs were found", only says the project's own `include` matched no file; the
    // samples are the inputs here.
    const errors = parsed.errors.filter((d) => d.code !== 18003);
    if (errors.length > 0) fail(errors);
    base = parsed.options;
  }
  const compilerOptions = {
    ...base,
    noEmit: true,
    moduleDetection: ts.ModuleDetectionKind.Force,
    jsx: base.jsx ?? ts.JsxEmit.Preserve,
    noUnusedLocals: false,
    noUnusedParameters: false,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    composite: false,
    incremental: false,
    // With an output folder set, TypeScript reads a package's `exports` into that folder as a
    // pointer back to its source, and asks for a root folder to map it by. A sample imports what
    // the package publishes, the built declarations, so neither folder applies.
    outDir: undefined,
    rootDir: undefined,
    declarationDir: undefined,
  };
  mkdirSync(dir, { recursive: true });
  const files = samples.map((sample, index) => {
    const file = join(dir, `sample-${process.pid}-${index}${sample.extension ?? ".ts"}`);
    writeFileSync(file, sample.code, "utf8");
    return file;
  });
  try {
    const program = ts.createProgram({ rootNames: files, options: compilerOptions });
    const whole = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    if (whole.length > 0) fail(whole);
    return files.map((file, index) => {
      const source = program.getSourceFile(file);
      return [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ].map((d) => ({
        line: samples[index].line + source.getLineAndCharacterOfPosition(d.start).line,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      }));
    });
  } finally {
    for (const file of files) rmSync(file, { force: true });
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
 *   `runnable` ones; a `no-run <reason>` sample is listed as skipped with its reason. Each TypeScript
 *   sample is also type-checked against the package's types before it runs (see
 *   {@link typecheckSamples}), unless it carries `no-typecheck <reason>`, which the test's name then
 *   shows. Walking `docsDir`, it leaves out the generated reference under `api/`. Default `false`.
 * @param {boolean} [options.includeGenerated] - In every-sample mode, walk the generated `api/`
 *   folder of `docsDir` too. Default `false`.
 * @param {string} [options.tsconfig] - The `tsconfig.json` the samples are type-checked under.
 *   Default: the one in the working directory, when there is one.
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
    includeGenerated = false,
    tsconfig,
  } = options;

  // In every-sample mode the generated reference is left out of a walk: its examples are parts of
  // a signature's documentation, which `cosyte-docs-reference` writes and checks.
  const generated = every && !includeGenerated && docsDir ? join(docsDir, GENERATED_DIR) : null;
  const mdFiles = files ?? (docsDir ? collectMarkdown(docsDir, include, generated) : []);

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
    // The TypeScript samples are type-checked together before any runs, and each sample's test
    // fails on its own errors.
    const checked = plan.filter((step) => step.typecheck);
    const typeErrors = new Map();
    if (checked.length > 0) {
      beforeAll(async () => {
        const found = await typecheckSamples(
          checked.map((step) => step.snippet),
          { tsconfig, dir: join(tmpDir, "typecheck") },
        );
        checked.forEach((step, index) => typeErrors.set(step, found[index]));
      }, 120_000);
    }
    let total = 0;
    for (const step of plan) {
      if (step.kind === "run") {
        total++;
        const name =
          step.reason === null ? step.label : `${step.label} (not type-checked: ${step.reason})`;
        test(name, async () => {
          await runSnippet(step.snippet, {
            resolve: resolveFn,
            tmpDir,
            typeErrors: typeErrors.get(step),
          });
        });
        continue;
      }
      if (step.kind === "skip") {
        test.skip(`${step.label} (not run: ${step.reason})`, () => {});
        continue;
      }
      // An invalid sample: a no-run or a no-typecheck with no reason. This test only ever fails, so
      // its lines are proven by separate Vitest runs (test/doc-samples-every.test.ts, "a no-run
      // sample with no reason fails the suite" and "a sample with a type error fails the suite"),
      // whose coverage this run cannot collect.
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
 * @param {string | null} skip - A directory left out of the walk, or null.
 * @returns {string[]} Absolute-or-relative file paths, sorted for stable test ordering.
 */
function collectMarkdown(dir, include, skip) {
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
    if (s.isDirectory()) {
      if (full !== skip) out.push(...collectMarkdown(full, include, skip));
    } else if (include.test(entry)) out.push(full);
  }
  return out;
}
