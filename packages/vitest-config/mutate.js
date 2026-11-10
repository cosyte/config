// @cosyte/vitest-config/mutate
//
// THE TWO RUNS: `full` mutates everything the config names and writes the report the floor file's
// mutation score is read from; `changed` mutates only the source files a change touched against a
// base ref, and writes its report to a separate file, `changed.json` beside the full one, so a run
// over a few files can never be read as the package's score.
//
// What a change touched is read from git by @cosyte/script-utils/changes, the same reading the
// ratchet judges changed lines with, so the two cannot disagree about which files a pull request
// changed. It is an optional peer dependency, imported only when a changed run starts, so a package
// that uses only the Vitest config installs nothing for it. A changed run with no changed source file starts no mutation run: it writes an empty
// report, so the ratchet can tell "ran, nothing to mutate" from "never ran", and exits 0.
//
// Exit codes: 0 the run finished (the score is judged by cosyte-ratchet, not here); 2 it could not
// run (bad arguments, no config, git could not answer, Stryker failed).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { FULL_REPORT, htmlReportFor } from "./stryker.js";

/** The config file a run reads when `--config` names none, relative to the working directory. */
export const DEFAULT_CONFIG = "stryker.config.mjs";

/** Thrown for anything that stops a run before Stryker starts. Exit 2. */
export class MutateUnreadable extends Error {
  /**
   * @param {string} message What stopped the run.
   */
  constructor(message) {
    super(message);
    this.name = "MutateUnreadable";
  }
}

const HELP = `cosyte-mutate: run StrykerJS with the shared config, over everything or over a change.

  cosyte-mutate full [--config <file>]
  cosyte-mutate changed --base <ref> [--config <file>]

full     mutates every file the config names and writes its JSON report where the config says
         (reports/mutation/mutation.json with @cosyte/vitest-config/stryker).
changed  mutates only the source files changed against the merge base of <ref> and HEAD (with
         edits not yet committed and untracked files), and writes changed.json beside the full
         report. With no changed source file it writes an empty report and exits 0.
--config the Stryker config file, default ${DEFAULT_CONFIG}, relative to the working directory.

Exit 0 when the run finished (cosyte-ratchet judges the score), 2 when it could not run.
`;

/**
 * Parse the command line.
 *
 * @param {string[]} argv The arguments after the bin's name.
 * @returns {{ mode: "full" | "changed", base: string | null, config: string }} The options.
 */
export function parseMutateArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode !== "full" && mode !== "changed") {
    throw new MutateUnreadable(`the mode must be full or changed, not ${JSON.stringify(mode)}`);
  }
  const options = { mode, base: null, config: DEFAULT_CONFIG };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag !== "--base" && flag !== "--config") {
      throw new MutateUnreadable(`unknown argument ${JSON.stringify(flag)}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new MutateUnreadable(`${flag} needs a value`);
    }
    if (flag === "--base") options.base = value;
    else options.config = value;
  }
  if (mode === "changed" && options.base === null) {
    throw new MutateUnreadable(
      "changed needs --base <ref>, the ref the change is measured against",
    );
  }
  if (mode === "full" && options.base !== null) {
    throw new MutateUnreadable("full takes no --base: it mutates everything the config names");
  }
  return options;
}

/**
 * Pick the changed files a config mutates: each must match one of its patterns and none of its
 * `!` patterns. Patterns and the result are relative to the working directory, as Stryker reads
 * them; a changed file outside it is never picked.
 *
 * @param {object} input The inputs.
 * @param {Iterable<string>} input.changed Changed files, relative to the repository root.
 * @param {string} input.root The repository root.
 * @param {string} input.cwd The directory Stryker runs in.
 * @param {readonly string[]} input.patterns The config's `mutate` patterns.
 * @returns {string[]} The files to mutate, sorted.
 */
export function selectChangedFiles({ changed, root, cwd, patterns }) {
  const include = patterns.filter((p) => !p.startsWith("!"));
  const exclude = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  const picked = [];
  for (const file of changed) {
    const path = relative(cwd, resolve(root, file)).split(sep).join("/");
    if (path.startsWith("../")) continue;
    if (!include.some((p) => matchesGlob(path, p))) continue;
    if (exclude.some((p) => matchesGlob(path, p))) continue;
    picked.push(path);
  }
  return picked.sort();
}

/**
 * Where a full run writes its JSON report: the config's `jsonReporter.fileName`, or Stryker's own
 * default, which is also this package's.
 *
 * @param {Record<string, any>} config The loaded Stryker config.
 * @returns {string} The path, relative to the working directory.
 */
export function fullReportPath(config) {
  const full = config.jsonReporter?.fileName;
  return typeof full === "string" ? full : FULL_REPORT;
}

/**
 * Where a changed run writes its report: `changed.json` beside the full report.
 *
 * @param {Record<string, any>} config The loaded Stryker config.
 * @returns {string} The path, relative to the working directory.
 */
export function changedReportPath(config) {
  return join(dirname(fullReportPath(config)), "changed.json");
}

/**
 * An empty report in the mutation-testing-report-schema shape: no file, no mutant.
 *
 * @param {string} projectRoot The directory the run would have run in.
 * @returns {string} The JSON text.
 */
export function emptyReport(projectRoot) {
  return `${JSON.stringify({
    schemaVersion: "2",
    thresholds: { high: 100, low: 90 },
    projectRoot,
    files: {},
  })}\n`;
}

/**
 * Load a Stryker config module and return its default export.
 *
 * @param {string} path The config file, absolute.
 * @returns {Promise<Record<string, any>>} The config.
 */
export async function loadConfig(path) {
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (cause) {
    throw new MutateUnreadable(`the Stryker config ${path} could not be loaded: ${cause.message}`);
  }
  const config = mod.default;
  if (typeof config !== "object" || config === null || !Array.isArray(config.mutate)) {
    throw new MutateUnreadable(`the Stryker config ${path} exports no config with a mutate list`);
  }
  return config;
}

/**
 * Load the change reader from @cosyte/script-utils, the optional peer dependency a changed run needs.
 *
 * @param {(specifier: string) => Promise<any>} [load] Imports a module; replaced in tests.
 * @returns {Promise<(opts: { base: string, cwd?: string }) => { root: string, files: Map<string, Set<number>> }>}
 *   Its `readChanges`.
 */
export async function loadChangeReader(load = (specifier) => import(specifier)) {
  try {
    const { readChanges } = await load("@cosyte/script-utils/changes");
    return readChanges;
  } catch (cause) {
    throw new MutateUnreadable(
      "a changed run reads what a change touched with @cosyte/script-utils, an optional peer " +
        `dependency of @cosyte/vitest-config; install it beside this package (${cause.message})`,
    );
  }
}

/**
 * Start StrykerJS with these options and wait for it to finish.
 *
 * @param {Record<string, unknown>} options Stryker options; `configFile` names the config, and
 *   the rest override it.
 * @returns {Promise<void>} Resolves when the run finishes.
 */
export async function runStryker(options) {
  const { Stryker } = await import("@stryker-mutator/core");
  await new Stryker(options).runMutationTest();
}

/**
 * Run `cosyte-mutate`.
 *
 * @param {object} opts Options.
 * @param {string[]} opts.argv The arguments after the bin's name.
 * @param {string} opts.cwd The directory Stryker runs in.
 * @param {(text: string) => void} opts.out Writes to stdout.
 * @param {(text: string) => void} opts.err Writes to stderr.
 * @param {(opts: { base: string, cwd: string }) => { root: string, files: Map<string, Set<number>> }} [opts.changes]
 *   Reads what a change touched; replaced in tests. Left out, a changed run loads it from
 *   @cosyte/script-utils.
 * @param {typeof runStryker} [opts.stryker] Starts Stryker; replaced in tests.
 * @returns {Promise<number>} The exit code.
 */
export async function runMutate({ argv, cwd, out, err, changes, stryker = runStryker }) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(HELP);
    return 0;
  }
  try {
    const options = parseMutateArgs(argv);
    const configFile = resolve(cwd, options.config);
    const config = await loadConfig(configFile);
    if (options.mode === "full") {
      // A report left from an earlier run must not outlive a run that failed.
      rmSync(resolve(cwd, fullReportPath(config)), { force: true });
      out(`cosyte-mutate: mutating everything ${options.config} names\n`);
      await stryker({ configFile });
      return 0;
    }
    const readChanges = changes ?? (await loadChangeReader());
    const change = readChanges({ base: options.base, cwd });
    const files = selectChangedFiles({
      changed: change.files.keys(),
      root: change.root,
      cwd,
      patterns: config.mutate,
    });
    const report = changedReportPath(config);
    rmSync(resolve(cwd, report), { force: true });
    if (files.length === 0) {
      mkdirSync(dirname(resolve(cwd, report)), { recursive: true });
      writeFileSync(resolve(cwd, report), emptyReport(cwd));
      out(
        `cosyte-mutate: no changed source file against ${options.base}; nothing to mutate. Wrote an empty ${report}.\n`,
      );
      return 0;
    }
    out(`cosyte-mutate: mutating ${files.length} changed file(s) against ${options.base}:\n`);
    for (const file of files) out(`  ${file}\n`);
    await stryker({
      configFile,
      mutate: files,
      jsonReporter: { fileName: report },
      htmlReporter: { fileName: htmlReportFor(report) },
    });
    return 0;
  } catch (error) {
    // The change reader's own refusal is known by name: its class lives in the optional peer.
    const known = error instanceof MutateUnreadable || error?.name === "ChangesUnreadable";
    err(`cosyte-mutate: could not run: ${known ? error.message : String(error?.stack ?? error)}\n`);
    return 2;
  }
}
