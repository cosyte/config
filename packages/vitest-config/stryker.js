// @cosyte/vitest-config/stryker
//
// THE SHARED STRYKERJS CONFIG, for mutation testing with the Vitest runner. It sits in this package
// because it runs the same Vitest suites over the same source files this package's coverage config
// measures, and every package that would use it already depends on this one. StrykerJS itself is an
// optional peer: a package that does not run mutation testing never installs it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// WHICH SOURCE FILES ARE BARRELS. Coverage and mutation testing leave a barrel out: a file that
// holds nothing but re-exports has
// no code of its own to test, and its export lines would only count against a package whose tests
// import the modules directly. A file is a barrel because of what it holds, never because of its
// name: an index.ts can hold a whole parser. So each file is read, and it is a barrel only when
// every statement in it is an import with bindings or an export of names, with at least one
// export. Anything else, or anything this reading does not understand, is measured: a file
// wrongly called a barrel hides real code, and a barrel wrongly measured costs one line. The
// coverage config in index.js reads barrels with the same function.

// Whitespace and comments, each read one way only, so a token that fails after them is retried in
// linear time. A line comment runs to the end of its line: the lookahead stops backtracking from
// ending it early, where the next repetition would start a new `//` and every split of a run of
// slashes would be tried. A block comment ends at its first `*/`, so it can neither stretch over
// the code between two comments nor end anywhere else.
const GAP = String.raw`(?:\s|//[^\n]*(?![^\n])|/\*(?:[^*]|\*(?!/))*\*/)*`;
const STRING = String.raw`(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const NAME = `(?:${IDENT}|${STRING})`;
// `a`, `type a`, `a as b`, `default as b`, `"a-b" as c`.
const SPECIFIER = String.raw`(?:type\b${GAP})?${NAME}(?:${GAP}as\b${GAP}${NAME})?`;
const LIST = String.raw`\{${GAP}(?:${SPECIFIER}${GAP}(?:,${GAP}${SPECIFIER}${GAP})*(?:,${GAP})?)?\}`;
const ATTRIBUTE = `${NAME}${GAP}:${GAP}${STRING}${GAP}`;
const ATTRIBUTES = String.raw`${GAP}(?:with|assert)${GAP}\{${GAP}(?:${ATTRIBUTE}(?:,${GAP}${ATTRIBUTE})*(?:,${GAP})?)?\}`;
const FROM = String.raw`${GAP}\bfrom${GAP}${STRING}(?:${ATTRIBUTES})?`;
const NAMESPACE = String.raw`\*${GAP}as\b${GAP}`;
// `export * from`, `export * as a from`, `export { a } from`, `export { a }`, each with `type`.
const EXPORT = String.raw`export(?:${GAP}\btype\b)?${GAP}(?:\*(?:${GAP}as\b${GAP}${NAME})?${FROM}|${LIST}(?:${FROM})?)`;
// An import that binds a name: `import a from`, `import a, { b } from`, `import * as a from`.
const IMPORT = String.raw`import\b(?:${GAP}type\b)?${GAP}(?:${IDENT}(?:${GAP},${GAP}(?:${NAMESPACE}${IDENT}|${LIST}))?|${NAMESPACE}${IDENT}|${LIST})${FROM}`;

/**
 * Whether a TypeScript or JavaScript source holds nothing but re-exports: every statement is an
 * import that binds names or an export of names (from a module or from those imports), and at
 * least one is an export. A side-effect import, a declaration, a type alias or any other statement
 * makes the file real code.
 *
 * @param {string} source The file's text.
 * @returns {boolean} True for a barrel.
 * @example
 * isBarrel('export * from "./parse.js";\nexport type { Options } from "./types.js";\n'); // true
 * isBarrel('export * from "./parse.js";\nexport const version = "1";\n'); // false
 */
export function isBarrel(source) {
  const statement = new RegExp(`(?:(${EXPORT})|${IMPORT})${GAP}(?:;${GAP})?`, "y");
  // The leading whitespace and comments; GAP matches at any position, if only the empty string.
  statement.lastIndex = new RegExp(GAP).exec(source)[0].length;
  let exports = 0;
  while (statement.lastIndex < source.length) {
    const match = statement.exec(source);
    if (match === null) return false;
    if (match[1] !== undefined) exports += 1;
  }
  return exports > 0;
}

/**
 * The barrels under `<root>/src`, by {@link isBarrel}: each `.ts` file but a declaration file,
 * relative to `root` with forward slashes, sorted, ready for a coverage `exclude` or, after a `!`,
 * a Stryker `mutate` list. A path with a character a glob reads specially is left out, so it is
 * measured rather than misread. A project without `src/` has none.
 *
 * @param {string} [root] The project root: the directory Vitest or Stryker runs in.
 * @returns {string[]} The barrels.
 */
export function findBarrels(root = process.cwd()) {
  const src = join(root, "src");
  if (!existsSync(src)) return [];
  return readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /(?<!\.d)\.ts$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => isBarrel(String(readFileSync(path))))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => /^[\w./-]+$/.test(path))
    .sort();
}

/** The directory every run writes its reports under, relative to the directory Stryker runs in. */
export const REPORT_DIR = "reports/mutation";

/** The full run's JSON report: the mutation score the floor file holds is read from here. */
export const FULL_REPORT = `${REPORT_DIR}/mutation.json`;

/**
 * The changed-files run's JSON report. It is a separate file so that a run over a few files can
 * never be read as the whole package's score.
 */
export const CHANGED_REPORT = `${REPORT_DIR}/changed.json`;

/**
 * The files a run mutates by default, by name: the source `@cosyte/vitest-config` measures coverage
 * over, without the files it leaves out by name (tests, declarations, fixtures, generated code).
 * {@link cosyteStryker} also leaves out the barrels it finds by reading `src/`, as coverage does.
 */
export const DEFAULT_MUTATE = Object.freeze([
  "src/**/*.ts",
  "!src/**/*.test.ts",
  "!src/**/*.spec.ts",
  "!src/**/*.d.ts",
  "!src/**/__fixtures__/**",
  "!src/**/generated/**",
]);

/**
 * The HTML report that sits beside a JSON report, for a person reading the surviving mutants.
 *
 * @param {string} jsonReport A report path ending in `.json`.
 * @returns {string} The same path ending in `.html`.
 */
export function htmlReportFor(jsonReport) {
  return jsonReport.replace(/\.json$/, ".html");
}

/**
 * The absolute path of the Vitest runner plugin. Stryker loads plugins named by a bare specifier
 * from its own install, and under pnpm that install cannot see a sibling package, so a run would
 * start with no test runner. A path resolved from this package works under pnpm, npm and Yarn.
 *
 * @param {(specifier: string) => string} [resolve] Resolves a specifier to a module URL.
 * @returns {string} The plugin's entry file.
 */
export function resolveVitestRunner(resolve = (specifier) => import.meta.resolve(specifier)) {
  try {
    return fileURLToPath(resolve("@stryker-mutator/vitest-runner"));
  } catch (cause) {
    throw new Error(
      "@cosyte/vitest-config/stryker: @stryker-mutator/vitest-runner is not installed. Add it and " +
        "@stryker-mutator/core as devDependencies.",
      { cause },
    );
  }
}

/**
 * The shared StrykerJS config for `@cosyte/*` packages: the Vitest runner with per-test coverage
 * in Vitest's forks pool, static mutants ignored, and the JSON report written to {@link FULL_REPORT}. A run never fails on
 * its score (`break: null`): the floor file and `cosyte-ratchet` hold that rule, so there is one
 * place that decides whether a score dropped.
 *
 * A static mutant is one in code that runs once, when a module loads (a table of patterns, a
 * frozen map). Stryker can only test one by reloading every test, so on a library such mutants
 * take most of a run's time; they are ignored here, and the coverage gate still holds every such
 * line to having run. A package whose module-level tables are the thing it checks, such as a PHI
 * scanner's patterns, passes `stryker: { ignoreStatic: false }`.
 *
 * @param {object} [opts] Options.
 * @param {readonly string[]} [opts.mutate] The files to mutate, in Stryker's glob form. Defaults to
 *   {@link DEFAULT_MUTATE} without the barrels under `<root>/src`.
 * @param {string} [opts.root] The directory Stryker runs in, read for barrels when `mutate` is left
 *   out. Defaults to the working directory.
 * @param {string} [opts.vitestConfig] The Vitest config file the runner loads.
 * @param {Record<string, unknown>} [opts.stryker] Any other Stryker option, merged last.
 * @returns {Record<string, unknown> & { mutate: string[], plugins: string[] }} The Stryker config.
 * @example
 * // stryker.config.mjs
 * import { cosyteStryker } from "@cosyte/vitest-config/stryker";
 * export default cosyteStryker();
 */
export function cosyteStryker(opts = {}) {
  const {
    root,
    mutate = [...DEFAULT_MUTATE, ...findBarrels(root).map((path) => `!${path}`)],
    vitestConfig,
    stryker = {},
  } = opts;
  return {
    testRunner: "vitest",
    plugins: [resolveVitestRunner()],
    coverageAnalysis: "perTest",
    mutate: [...mutate],
    ignoreStatic: true,
    reporters: ["clear-text", "progress-append-only", "html", "json"],
    jsonReporter: { fileName: FULL_REPORT },
    htmlReporter: { fileName: htmlReportFor(FULL_REPORT) },
    thresholds: { high: 100, low: 90, break: null },
    tempDirName: ".stryker-tmp",
    ignorePatterns: ["coverage", "reports", "dist"],
    // Vitest's own default pool, which Stryker's runner does not use unless told: under its
    // default, worker threads, a test that calls process.chdir() fails before any mutant runs.
    vitest:
      vitestConfig === undefined ? { pool: "forks" } : { pool: "forks", configFile: vitestConfig },
    ...stryker,
  };
}
