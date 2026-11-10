// @cosyte/script-utils/ratchet
//
// THE COVERAGE AND MUTATION RATCHET. A repository keeps a floor file at its root,
// `quality-floor.json`, with each package's coverage (lines, branches, functions, statements) and
// mutation score. `check` fails when a measured score is below its floor and prints every metric's
// gap to 100; `raise` moves a floor up to what was measured and never moves one down.
//
// With `--base <ref>`, `check` also holds a pull request's own code to 100: every changed line that
// coverage counts must have run, and every mutant in changed code must be killed, unless an inline
// comment names a reason for the exception. `check` lists each exception it finds in changed code,
// so the pull request can carry the list.
//
// Exit codes, asserted by its tests: 0 nothing dropped and nothing in changed code is unreached;
// 1 a drop, an uncovered changed line, a surviving mutant in changed code, or an exception with no
// reason; 2 an input could not be read (the floor file, a report the floor needs, git), which is
// never a pass. Zero dependencies, like the rest of this package.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { ChangesUnreadable, readChanges, runGit } from "./changes.js";

/** The floor file's name, at a repository's root. */
export const FLOOR_FILE = "quality-floor.json";

/** The four coverage metrics, in the order they print. */
export const COVERAGE_METRICS = Object.freeze(["lines", "branches", "functions", "statements"]);

/** Where each report is read from, relative to a package's directory. */
export const REPORTS = Object.freeze({
  summary: "coverage/coverage-summary.json",
  lcov: "coverage/lcov.info",
  mutation: "reports/mutation/mutation.json",
  changed: "reports/mutation/changed.json",
});

/** The reason Stryker records for a mutant a comment disabled without naming one. */
const STRYKER_DEFAULT_REASON = "Ignored using a comment";

/** Thrown when an input cannot be read or is not what it must be. Exit 2. */
export class RatchetUnreadable extends Error {
  /**
   * @param {string} message What could not be read.
   */
  constructor(message) {
    super(message);
    this.name = "RatchetUnreadable";
  }
}

/**
 * Is this a score: a finite number from 0 to 100?
 *
 * @param {unknown} value The value.
 * @returns {boolean} Whether it is.
 */
function isScore(value) {
  return typeof value === "number" && value >= 0 && value <= 100;
}

/**
 * Read a JSON file, refusing a missing or malformed one.
 *
 * @param {string} path The file.
 * @param {string} what What it is, for the message.
 * @returns {unknown} The parsed value.
 */
function readJson(path, what) {
  let text;
  try {
    text = String(readFileSync(path));
  } catch {
    throw new RatchetUnreadable(`${what} ${path} could not be read`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RatchetUnreadable(`${what} ${path} is not JSON`);
  }
}

/**
 * Check a floor file's shape. Every key is known: a misspelled metric would otherwise be a floor
 * nobody checks.
 *
 * @param {unknown} value The parsed floor file.
 * @returns {{ packages: Record<string, { coverage?: Record<string, number>, mutation?: number }> }}
 *   The floor.
 */
export function parseFloor(value) {
  const fail = (why) => {
    throw new RatchetUnreadable(`the floor file ${why}`);
  };
  const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObject(value) || !isObject(value.packages)) fail("has no `packages` object");
  for (const key of Object.keys(value)) {
    if (key !== "packages" && key !== "$comment") fail(`has an unknown key ${JSON.stringify(key)}`);
  }
  for (const [dir, entry] of Object.entries(value.packages)) {
    if (!isObject(entry)) fail(`entry ${JSON.stringify(dir)} is not an object`);
    for (const key of Object.keys(entry)) {
      if (key !== "coverage" && key !== "mutation") {
        fail(`entry ${JSON.stringify(dir)} has an unknown key ${JSON.stringify(key)}`);
      }
    }
    if ("mutation" in entry && !isScore(entry.mutation)) {
      fail(`entry ${JSON.stringify(dir)} has a mutation floor that is not a score from 0 to 100`);
    }
    if ("coverage" in entry) {
      if (!isObject(entry.coverage)) fail(`entry ${JSON.stringify(dir)} coverage is not an object`);
      for (const [metric, floor] of Object.entries(entry.coverage)) {
        if (!COVERAGE_METRICS.includes(metric) || !isScore(floor)) {
          fail(`entry ${JSON.stringify(dir)} has a bad coverage floor ${JSON.stringify(metric)}`);
        }
      }
    }
  }
  return value;
}

/**
 * Cut a percentage to two decimals, toward zero, so a floor raised from it is never above what was
 * measured.
 *
 * @param {number} value A percentage.
 * @returns {number} The same, to two decimals.
 */
export function toFloor(value) {
  return Math.floor(Math.round(value * 1e6) / 1e4) / 100;
}

/**
 * Read the four coverage percentages from Istanbul's `json-summary` report.
 *
 * @param {string} path The report.
 * @returns {Record<string, number>} Each metric's percentage.
 */
export function readCoverageSummary(path) {
  const report = /** @type {any} */ (readJson(path, "the coverage summary"));
  /** @type {Record<string, number>} */
  const out = {};
  for (const metric of COVERAGE_METRICS) {
    const pct = report?.total?.[metric]?.pct;
    if (!isScore(pct)) {
      throw new RatchetUnreadable(`the coverage summary ${path} has no total ${metric} percentage`);
    }
    out[metric] = pct;
  }
  return out;
}

/**
 * Count a Stryker JSON report's mutants by status and work out the mutation score the way Stryker
 * does: killed and timed-out mutants over every mutant that ran or had no test (compile and runtime
 * errors and ignored mutants are not counted).
 *
 * @param {any} report The parsed report.
 * @param {string} path Where it came from, for the message.
 * @returns {{ score: number, counts: Record<string, number> }} The score, cut to two decimals, and
 *   the counts.
 */
export function mutationScore(report, path) {
  if (typeof report?.files !== "object" || report.files === null) {
    throw new RatchetUnreadable(`the mutation report ${path} has no files`);
  }
  /** @type {Record<string, number>} */
  const counts = {};
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants ?? []) {
      counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
    }
  }
  const detected = (counts.Killed ?? 0) + (counts.Timeout ?? 0);
  const valid = detected + (counts.Survived ?? 0) + (counts.NoCoverage ?? 0);
  if (valid === 0) {
    throw new RatchetUnreadable(`the mutation report ${path} has no mutant to score`);
  }
  return { score: toFloor((detected / valid) * 100), counts };
}

/**
 * Read lcov's line records: for each source file, how often each line ran.
 *
 * @param {string} text The lcov file.
 * @param {string} baseDir The directory relative `SF:` paths are read from.
 * @returns {Map<string, Map<number, number>>} Absolute file path to line to hits.
 */
export function parseLcov(text, baseDir) {
  /** @type {Map<string, Map<number, number>>} */
  const files = new Map();
  /** @type {Map<number, number> | null} */
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const file = resolve(baseDir, line.slice(3));
      current = files.get(file) ?? new Map();
      files.set(file, current);
    } else if (line.startsWith("DA:") && current !== null) {
      const [n, hits] = line.slice(3).split(",").map(Number);
      current.set(n, Math.max(current.get(n) ?? 0, hits));
    }
  }
  return files;
}

/**
 * Find the inline exceptions in a source file: coverage hints (`v8 ignore`, and its `c8` and
 * `istanbul` spellings) and Stryker directives (`Stryker disable`). A reason is the text after
 * ` -- ` in a coverage hint and after `:` in a Stryker directive.
 *
 * @param {string} text The source.
 * @returns {{ line: number, tool: "coverage" | "mutation", directive: string, reason: string | null }[]}
 *   Each exception, with its 1-based line.
 */
export function findExceptionComments(text) {
  const found = [];
  const lines = text.split("\n");
  for (const [i, source] of lines.entries()) {
    const coverage =
      /(?:\/\*|\/\/)\s*(?:v8|c8|istanbul)\s+ignore\s+(next|if|else|start|file)\b(.*?)(?:\*\/|$)/.exec(
        source,
      );
    if (coverage !== null) {
      const reason = /^\s*--\s*(.*?)\s*$/.exec(coverage[2])?.[1] ?? "";
      found.push({
        line: i + 1,
        tool: "coverage",
        directive: `ignore ${coverage[1]}`,
        reason: reason === "" ? null : reason,
      });
    }
    const stryker = /\/\/\s?Stryker disable(?: next-line)? ([a-zA-Z, ]+?)(?::(.*))?$/.exec(source);
    if (stryker !== null) {
      const reason = (stryker[2] ?? "").trim();
      found.push({
        line: i + 1,
        tool: "mutation",
        directive: `disable ${stryker[1].trim()}`,
        reason: reason === "" ? null : reason,
      });
    }
  }
  return found;
}

/**
 * The lines a coverage hint takes out of the count: for `start`, up to its `stop`; for `file`, all
 * of it; for `next`, `if` and `else`, up to the next line coverage still counts, because the hint
 * covers the whole statement after it and lcov does not say where that ends.
 *
 * @param {{ line: number, directive: string }} hint The hint.
 * @param {string[]} lines The file's lines.
 * @param {Map<number, number> | undefined} counted The lines coverage counts in this file.
 * @returns {[number, number]} The first and last line it reaches.
 */
export function hintRange(hint, lines, counted) {
  if (hint.directive === "ignore file") return [1, lines.length];
  if (hint.directive === "ignore start") {
    const stop = lines.findIndex(
      (text, i) => i >= hint.line && /(?:v8|c8|istanbul)\s+ignore\s+stop\b/.test(text),
    );
    return [hint.line, stop === -1 ? lines.length : stop + 1];
  }
  if (counted === undefined) return [hint.line, lines.length];
  const after = [...counted.keys()].filter((n) => n > hint.line);
  return [hint.line, after.length === 0 ? lines.length : Math.min(...after) - 1];
}

/**
 * Judge a change's own code: its changed lines that coverage counts, and the mutants in them.
 *
 * @param {object} input The inputs.
 * @param {Map<string, Set<number>>} input.changed Absolute file path to its changed lines.
 * @param {Map<string, Map<number, number>>} input.lines Absolute file path to line to hits, from
 *   every package's lcov together (a line any suite ran counts as run); empty when coverage is
 *   skipped.
 * @param {Map<string, any[]> | null} input.mutants Absolute file path to the mutants of the
 *   changed-files runs, or `null` when mutation is skipped.
 * @param {(file: string) => string} input.read Reads a source file.
 * @returns {{ uncovered: { file: string, line: number }[], survived: { file: string, line: number, mutator: string, status: string }[], exceptions: { file: string, line: number, tool: string, what: string, reason: string | null }[], unmutated: string[] }}
 *   What failed, and every exception found.
 */
export function judgeChangedCode({ changed, lines, mutants, read }) {
  const result = { uncovered: [], survived: [], exceptions: [], unmutated: [] };
  for (const [file, changedLines] of [...changed].sort(([a], [b]) => a.localeCompare(b))) {
    const counted = lines.get(file);
    const fileMutants = mutants?.get(file);
    if (counted === undefined && fileMutants === undefined) continue;
    const touched = (first, last) => [...changedLines].some((n) => n >= first && n <= last);
    for (const n of [...changedLines].sort((a, b) => a - b)) {
      if (counted?.get(n) === 0) result.uncovered.push({ file, line: n });
    }
    const text = read(file).split("\n");
    for (const hint of findExceptionComments(text.join("\n"))) {
      const [first, last] =
        hint.tool === "coverage" ? hintRange(hint, text, counted) : [hint.line, hint.line];
      if (!touched(first, last)) continue;
      result.exceptions.push({
        file,
        line: hint.line,
        tool: hint.tool,
        what: hint.directive,
        reason: hint.reason,
      });
    }
    if (mutants === null) continue;
    if (fileMutants === undefined) {
      if ([...changedLines].some((n) => counted.has(n))) result.unmutated.push(file);
      continue;
    }
    for (const mutant of fileMutants) {
      const { start, end } = mutant.location;
      if (!touched(start.line, end.line)) continue;
      if (mutant.status === "Survived" || mutant.status === "NoCoverage") {
        result.survived.push({
          file,
          line: start.line,
          mutator: mutant.mutatorName,
          status: mutant.status,
        });
      } else if (mutant.status === "Ignored") {
        const reason = (mutant.statusReason ?? "").trim();
        result.exceptions.push({
          file,
          line: start.line,
          tool: "mutation",
          what: `${mutant.mutatorName} mutant ignored`,
          reason: reason === "" || reason === STRYKER_DEFAULT_REASON ? null : reason,
        });
      }
    }
  }
  return result;
}

/**
 * Read a changed-files mutation report into absolute file path to mutants.
 *
 * @param {string} path The report.
 * @param {string} packageDir Where relative paths in it are read from when it names no project root.
 * @returns {Map<string, any[]>} The mutants of each file.
 */
export function readMutants(path, packageDir) {
  const report = /** @type {any} */ (readJson(path, "the changed-files mutation report"));
  if (typeof report?.files !== "object" || report.files === null) {
    throw new RatchetUnreadable(`the changed-files mutation report ${path} has no files`);
  }
  const base = typeof report.projectRoot === "string" ? report.projectRoot : packageDir;
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const [file, entry] of Object.entries(report.files)) {
    out.set(resolve(base, file), entry.mutants ?? []);
  }
  return out;
}

const HELP = `cosyte-ratchet: hold coverage and mutation score to a floor that only rises.

  cosyte-ratchet check [--floor <file>] [--base <ref>] [--skip coverage|mutation]...
  cosyte-ratchet raise [--floor <file>] [--skip coverage|mutation]...

The floor file (default ${FLOOR_FILE}) names each package directory, relative to the file, with
its coverage floors (lines, branches, functions, statements) and its mutation score floor. Reports
are read from each package directory: ${REPORTS.summary}, ${REPORTS.lcov},
${REPORTS.mutation} (a full run) and ${REPORTS.changed} (a changed-files run).

check   compares each measured metric with its floor and prints the gap to 100. With --base it
        also requires every changed line coverage counts to have run and every mutant in changed
        code to be killed, and lists each inline exception in changed code with its reason; a
        full mutation report is then compared only when one is there.
raise   moves each floor up to what was measured. It never moves one down.
--skip  leaves a kind of metric out of this run, saying so; use it where that report is not made.

Exit 0 when nothing dropped and changed code is reached, 1 on a drop or unreached changed code, 2
when an input could not be read.
`;

/**
 * Parse the command line.
 *
 * @param {string[]} argv The arguments after the bin's name.
 * @returns {{ command: string, floor: string, base: string | null, skip: Set<string> }} The options.
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "raise") {
    throw new RatchetUnreadable(
      `the command must be check or raise, not ${JSON.stringify(command)}`,
    );
  }
  const options = { command, floor: FLOOR_FILE, base: null, skip: new Set() };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!["--floor", "--base", "--skip"].includes(flag)) {
      throw new RatchetUnreadable(`unknown argument ${JSON.stringify(flag)}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new RatchetUnreadable(`${flag} needs a value`);
    }
    i += 1;
    if (flag === "--floor") options.floor = value;
    if (flag === "--base") options.base = value;
    if (flag === "--skip") {
      if (value !== "coverage" && value !== "mutation") {
        throw new RatchetUnreadable(
          `--skip takes coverage or mutation, not ${JSON.stringify(value)}`,
        );
      }
      options.skip.add(value);
    }
  }
  if (options.command === "raise" && options.base !== null) {
    throw new RatchetUnreadable(
      "raise takes no --base: it moves floors, it does not judge a change",
    );
  }
  return options;
}

/**
 * Format a percentage for the table.
 *
 * @param {number} value The percentage.
 * @returns {string} It, to two decimals, right-aligned.
 */
function pct(value) {
  return value.toFixed(2).padStart(8);
}

/**
 * Run the ratchet. Every option but `git` is given by the caller: the bin passes the process's own
 * arguments, directory and streams, and a test passes its own.
 *
 * @param {object} opts Options.
 * @param {string[]} opts.argv The arguments after the bin's name.
 * @param {string} opts.cwd The directory the floor path is read from.
 * @param {(text: string) => void} opts.out Writes to stdout.
 * @param {(text: string) => void} opts.err Writes to stderr.
 * @param {typeof runGit} [opts.git] Runs git; replaced in tests.
 * @returns {number} The exit code.
 */
export function runRatchet({ argv, cwd, out, err, git = runGit }) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(HELP);
    return 0;
  }
  try {
    return ratchet(parseArgs(argv), { cwd, out, git });
  } catch (error) {
    if (error instanceof RatchetUnreadable || error instanceof ChangesUnreadable) {
      err(`cosyte-ratchet: could not run: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/**
 * The body of {@link runRatchet}, once the arguments are parsed.
 *
 * @param {ReturnType<typeof parseArgs>} options The options.
 * @param {{ cwd: string, out: (text: string) => void, git: typeof runGit }} io Where it runs.
 * @returns {number} The exit code.
 */
function ratchet(options, { cwd, out, git }) {
  const floorPath = resolve(cwd, options.floor);
  const floor = parseFloor(readJson(floorPath, "the floor file"));
  const root = dirname(floorPath);
  const show = (file) => relative(root, file);
  const skipped = (kind) => options.skip.has(kind);
  const dirs = Object.keys(floor.packages).sort();
  let drops = 0;
  let raised = 0;
  // What `raise` would write. Worked out on every run, so a check and a raise read the same.
  const next = structuredClone(floor);
  /** @type {Map<string, Map<number, number>>} Line hits from every package; empty when skipped. */
  const lines = new Map();
  out(`cosyte-ratchet ${options.command}: ${show(floorPath)}, ${dirs.length} package(s)\n`);

  for (const dir of dirs) {
    const entry = floor.packages[dir];
    const pkg = resolve(root, dir);
    out(`\n${dir}\n  metric      measured     floor  gap to 100\n`);
    /** @type {Record<string, number>} */
    const measured = {};
    if (skipped("coverage")) {
      out("  coverage      skipped (--skip coverage)\n");
    } else {
      Object.assign(measured, readCoverageSummary(join(pkg, REPORTS.summary)));
      const lcovPath = join(pkg, REPORTS.lcov);
      if (options.base !== null) {
        if (!existsSync(lcovPath))
          throw new RatchetUnreadable(`the lcov report ${lcovPath} is missing`);
        for (const [file, hits] of parseLcov(String(readFileSync(lcovPath)), pkg)) {
          const merged = lines.get(file) ?? new Map();
          for (const [n, h] of hits) merged.set(n, Math.max(merged.get(n) ?? 0, h));
          lines.set(file, merged);
        }
      }
    }
    const fullReport = join(pkg, REPORTS.mutation);
    if (skipped("mutation")) {
      out("  mutation      skipped (--skip mutation)\n");
    } else if (options.base !== null && !existsSync(fullReport)) {
      // A pull request runs mutation over its changed files only; its mutants are judged below.
      out("  mutation      no full run here (a change is judged on its own mutants below)\n");
    } else if ("mutation" in entry || existsSync(fullReport)) {
      measured.mutation = mutationScore(
        readJson(fullReport, "the mutation report"),
        fullReport,
      ).score;
    }
    for (const metric of [...COVERAGE_METRICS, "mutation"]) {
      if (!(metric in measured)) continue;
      const value = measured[metric];
      const held = metric === "mutation" ? entry.mutation : entry.coverage?.[metric];
      const gap = pct(100 - value);
      if (held === undefined) {
        out(`  ${metric.padEnd(12)}${pct(value)}      none  ${gap}  (no floor yet)\n`);
      } else if (value < held) {
        drops += 1;
        out(
          `  ${metric.padEnd(12)}${pct(value)}  ${pct(held)}  ${gap}  DROPPED ${(held - value).toFixed(2)} below the floor\n`,
        );
      } else {
        out(`  ${metric.padEnd(12)}${pct(value)}  ${pct(held)}  ${gap}\n`);
      }
      if (held === undefined || value > held) {
        raised += 1;
        const target = next.packages[dir];
        if (metric === "mutation") target.mutation = value;
        else target.coverage = { ...target.coverage, [metric]: value };
      }
    }
  }

  if (options.command === "raise") {
    writeFileSync(floorPath, `${JSON.stringify(next, null, 2)}\n`);
    out(`\ncosyte-ratchet: raised ${raised} floor(s); none was lowered.\n`);
    if (drops > 0)
      out(`cosyte-ratchet: FAIL, ${drops} metric(s) below the floor, left where they were.\n`);
    return drops === 0 ? 0 : 1;
  }

  let failures = drops;
  if (options.base !== null) {
    const changes = readChanges({ base: options.base, cwd: root, git });
    const changed = new Map(
      [...changes.files].map(([file, set]) => [resolve(changes.root, file), set]),
    );
    /** @type {Map<string, any[]> | null} */
    let mutants = null;
    if (!skipped("mutation")) {
      mutants = new Map();
      for (const dir of dirs) {
        const pkg = resolve(root, dir);
        const path = join(pkg, REPORTS.changed);
        if (!existsSync(path)) {
          if ([...changed.keys()].some((file) => file.startsWith(`${pkg}${sep}`))) {
            throw new RatchetUnreadable(
              `${dir} has changes but no changed-files mutation report at ${path}; run cosyte-mutate changed`,
            );
          }
          continue;
        }
        for (const [file, list] of readMutants(path, pkg)) mutants.set(file, list);
      }
    }
    const judged = judgeChangedCode({
      changed,
      lines,
      mutants,
      read: (file) => readFileSync(file, "utf8"),
    });
    const unreasoned = judged.exceptions.filter((e) => e.reason === null);
    out(`\nChanged code against ${options.base} (merge base ${changes.mergeBase.slice(0, 12)}):\n`);
    if (skipped("coverage")) out("  changed lines: not judged (--skip coverage)\n");
    else out(`  uncovered changed lines: ${judged.uncovered.length}\n`);
    for (const u of judged.uncovered) out(`    ${show(u.file)}:${u.line} did not run\n`);
    if (mutants === null) {
      out("  mutants in changed code: not judged (--skip mutation)\n");
    } else {
      out(`  surviving mutants in changed code: ${judged.survived.length}\n`);
      for (const s of judged.survived) {
        out(`    ${show(s.file)}:${s.line} ${s.mutator} (${s.status})\n`);
      }
      for (const file of judged.unmutated) {
        out(`  not mutated (outside the package's mutate patterns): ${show(file)}\n`);
      }
    }
    out("\nExceptions in changed code (list each one in the pull request):\n");
    if (judged.exceptions.length === 0) out("  none\n");
    for (const e of judged.exceptions) {
      out(
        `  - ${show(e.file)}:${e.line} ${e.tool}, ${e.what}: ${e.reason ?? "NO REASON GIVEN (name one after the directive)"}\n`,
      );
    }
    failures += judged.uncovered.length + judged.survived.length + unreasoned.length;
  }

  out(
    failures === 0
      ? "\ncosyte-ratchet: OK, nothing dropped below its floor.\n"
      : `\ncosyte-ratchet: FAIL, ${failures} finding(s) above.\n`,
  );
  return failures === 0 ? 0 : 1;
}
