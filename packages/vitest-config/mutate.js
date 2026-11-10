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
// A SHARDED FULL RUN. A full run of a large library takes hours on one machine, so a CI workflow can
// split it across parallel jobs. Each job sets COSYTE_MUTATE_SHARD=<k>/<n>: the run lists the files
// the config names, keeps those whose FNV-1a hash of the path mod n is k - 1, mutates just those,
// and writes shard-<k>-of-<n>.json beside the full report in place of it, for the workflow to merge.
// The hash, not a position in a sorted list, decides a file's shard, so a file added elsewhere does
// not move every other file to another shard. COSYTE_MUTATE_INCREMENTAL_FILE names the file where
// Stryker keeps its incremental results, so a later run retests only what changed. A changed run
// reads neither variable, and a full run with neither set runs exactly as it always has.
//
// Exit codes: 0 the run finished (the score is judged by cosyte-ratchet, not here); 2 it could not
// run (bad arguments, no config, git could not answer, Stryker failed).

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { FULL_REPORT, htmlReportFor } from "./stryker.js";

/** The config file a run reads when `--config` names none, relative to the working directory. */
export const DEFAULT_CONFIG = "stryker.config.mjs";

/** The variable a sharded full run reads its share from: `<k>/<n>`. */
export const SHARD_VARIABLE = "COSYTE_MUTATE_SHARD";

/** The variable naming the file Stryker reads and writes its incremental results in. */
export const INCREMENTAL_VARIABLE = "COSYTE_MUTATE_INCREMENTAL_FILE";

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

A full run reads two variables; with neither set it runs as above:
${SHARD_VARIABLE}=<k>/<n>
         mutate only shard k of n of the files the config names, and write
         shard-<k>-of-<n>.json beside the full report in place of it (an empty report when the
         shard holds no file). A value that is not <k>/<n> with 1 <= k <= n exits 2.
${INCREMENTAL_VARIABLE}=<file>
         where Stryker reads and writes its incremental results, relative to the working
         directory, so a later run retests only what changed.

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
 * Read the shard a full run mutates from the value of {@link SHARD_VARIABLE}.
 *
 * @param {string | undefined} value `<k>/<n>`, two whole numbers with 1 <= k <= n.
 * @returns {{ k: number, n: number } | null} The shard, or null when the value is unset or empty.
 */
export function parseShard(value) {
  if (value === undefined || value === "") return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const k = match === null ? 0 : Number(match[1]);
  const n = match === null ? 0 : Number(match[2]);
  if (k < 1 || k > n) {
    throw new MutateUnreadable(
      `${SHARD_VARIABLE} must be <k>/<n>, two whole numbers with 1 <= k <= n, not ${JSON.stringify(value)}`,
    );
  }
  return { k, n };
}

/**
 * 32-bit FNV-1a over the UTF-8 bytes of a text: the hash a file's shard is read from.
 *
 * @param {string} text The text, here a path relative to the working directory with forward slashes.
 * @returns {number} The hash, an unsigned 32-bit integer.
 */
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  // Buffer.from encodes a string as UTF-8 when it is given no encoding.
  for (const byte of Buffer.from(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The files of one shard: those whose {@link fnv1a32} hash mod `n` is `k - 1`. Over the shards
 * 1 to `n`, every file is in exactly one.
 *
 * @param {readonly string[]} files Paths relative to the working directory, with forward slashes.
 * @param {{ k: number, n: number }} shard The shard.
 * @returns {string[]} The shard's files, in their given order.
 */
export function filesInShard(files, { k, n }) {
  return files.filter((file) => fnv1a32(file) % n === k - 1);
}

/**
 * List the files under the working directory that a config's `mutate` patterns name, picked by the
 * same rule as {@link selectChangedFiles}. It never enters a `node_modules` or `.git` directory, or
 * Stryker's temp directory.
 *
 * @param {object} input The inputs.
 * @param {string} input.cwd The directory Stryker runs in.
 * @param {readonly string[]} input.patterns The config's `mutate` patterns.
 * @param {string} [input.tempDirName] The config's `tempDirName`, relative to `cwd`.
 * @returns {string[]} The files, relative to `cwd` with forward slashes, sorted.
 */
export function expandMutate({ cwd, patterns, tempDirName = ".stryker-tmp" }) {
  const root = resolve(cwd);
  const temp = resolve(root, tempDirName);
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isFile()) found.push(relative(root, path));
      else if (
        entry.isDirectory() &&
        entry.name !== "node_modules" &&
        entry.name !== ".git" &&
        path !== temp
      ) {
        walk(path);
      }
    }
  };
  walk(root);
  return selectChangedFiles({ changed: found, root, cwd: root, patterns });
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
 * Where a sharded full run writes its report: `shard-<k>-of-<n>.json` beside the full report.
 *
 * @param {Record<string, any>} config The loaded Stryker config.
 * @param {{ k: number, n: number }} shard The shard.
 * @returns {string} The path, relative to the working directory.
 */
export function shardReportPath(config, { k, n }) {
  return join(dirname(fullReportPath(config)), `shard-${k}-of-${n}.json`);
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
 * The full run, whole or one shard of it, with Stryker's incremental results or without.
 *
 * @param {object} opts Options.
 * @param {string} opts.cwd The directory Stryker runs in.
 * @param {Record<string, string | undefined>} opts.env Where the two variables are read.
 * @param {(text: string) => void} opts.out Writes to stdout.
 * @param {typeof runStryker} opts.stryker Starts Stryker.
 * @param {string} opts.configFile The config file, absolute.
 * @param {Record<string, any>} opts.config The loaded config.
 * @param {string} opts.name The config file as the command line named it.
 * @returns {Promise<number>} The exit code.
 */
async function runFull({ cwd, env, out, stryker, configFile, config, name }) {
  const shard = parseShard(env[SHARD_VARIABLE]);
  const incrementalFile = env[INCREMENTAL_VARIABLE];
  const incremental =
    incrementalFile === undefined || incrementalFile === ""
      ? {}
      : { incremental: true, incrementalFile: resolve(cwd, incrementalFile) };
  const sayIncremental = () => {
    if (incrementalFile)
      out(`cosyte-mutate: incremental results read from and written to ${incrementalFile}\n`);
  };
  if (shard === null) {
    // A report left from an earlier run must not outlive a run that failed.
    rmSync(resolve(cwd, fullReportPath(config)), { force: true });
    out(`cosyte-mutate: mutating everything ${name} names\n`);
    sayIncremental();
    await stryker({ configFile, ...incremental });
    return 0;
  }
  const report = shardReportPath(config, shard);
  rmSync(resolve(cwd, report), { force: true });
  const all = expandMutate({ cwd, patterns: config.mutate, tempDirName: config.tempDirName });
  const files = filesInShard(all, shard);
  const which = `shard ${shard.k} of ${shard.n}`;
  if (files.length === 0) {
    mkdirSync(dirname(resolve(cwd, report)), { recursive: true });
    writeFileSync(resolve(cwd, report), emptyReport(cwd));
    out(
      `cosyte-mutate: ${which} holds none of the ${all.length} file(s) ${name} names; nothing to mutate. Wrote an empty ${report}.\n`,
    );
    return 0;
  }
  out(
    `cosyte-mutate: ${which}: mutating ${files.length} of the ${all.length} file(s) ${name} names:\n`,
  );
  for (const file of files) out(`  ${file}\n`);
  sayIncremental();
  await stryker({
    configFile,
    mutate: files,
    jsonReporter: { fileName: report },
    htmlReporter: { fileName: htmlReportFor(report) },
    ...incremental,
  });
  return 0;
}

/**
 * Run `cosyte-mutate`.
 *
 * @param {object} opts Options.
 * @param {string[]} opts.argv The arguments after the bin's name.
 * @param {string} opts.cwd The directory Stryker runs in.
 * @param {Record<string, string | undefined>} [opts.env] Where a full run reads
 *   {@link SHARD_VARIABLE} and {@link INCREMENTAL_VARIABLE}; the process's environment when left out.
 * @param {(text: string) => void} opts.out Writes to stdout.
 * @param {(text: string) => void} opts.err Writes to stderr.
 * @param {(opts: { base: string, cwd: string }) => { root: string, files: Map<string, Set<number>> }} [opts.changes]
 *   Reads what a change touched; replaced in tests. Left out, a changed run loads it from
 *   @cosyte/script-utils.
 * @param {typeof runStryker} [opts.stryker] Starts Stryker; replaced in tests.
 * @returns {Promise<number>} The exit code.
 */
export async function runMutate({
  argv,
  cwd,
  env = process.env,
  out,
  err,
  changes,
  stryker = runStryker,
}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(HELP);
    return 0;
  }
  try {
    const options = parseMutateArgs(argv);
    const configFile = resolve(cwd, options.config);
    const config = await loadConfig(configFile);
    if (options.mode === "full") {
      return await runFull({ cwd, env, out, stryker, configFile, config, name: options.config });
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
