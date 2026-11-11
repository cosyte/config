/**
 * The `cosyte-bench` command line. Exit codes follow the repository's gate rule: 0 clean, 1 a
 * finding (a regression, or a results file that does not match the schema), 2 could not measure or
 * could not read its input.
 *
 * @packageDocumentation
 */

import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { checkBudgets, readBudgets } from "./budgets.js";
import { calibrateComparison, compareBuilds, comparisonExitCode } from "./compare.js";
import type { Environment } from "./environment.js";
import { checkFloor, loosenedFloor, readFloor, recordFloor } from "./floor.js";
import {
  gateExitCode,
  notJudgeable,
  renderFindings,
  type GateFinding,
  type ReadingDocument,
} from "./gate.js";
import type { ImportCostReport } from "./import-cost.js";
import { readBuild, type ReadRunner } from "./reading.js";
import { renderMarkdown } from "./report.js";
import { documentBase, readResults, type ResultsDocument } from "./results.js";
import { checkSuite, type BenchSuite } from "./suite.js";

/** What `main` writes to and reads from. Real streams in the bin; buffers in tests. */
export interface MainIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Runs one measuring job: `runInChild` in the bin. */
  readonly runJob: ReadRunner;
  /** Measures cold import cost: `measureImportCost` in the bin. */
  readonly measureImport: (target: string) => Promise<ImportCostReport>;
  /** Describes the machine: `environment` in the bin. */
  readonly environment: () => Environment;
  readonly now: () => Date;
}

/**
 * The usage text.
 *
 * @internal
 */
export const USAGE = `Usage:
  cosyte-bench run --suite <file> --target <file> [--processes <n>] [--no-memory] [--no-import]
                   [--commit <sha>] [--only <name>]... [--out <file.json>] [--summary <file.md>]
  cosyte-bench compare --suite <file> --base <file> --head <file> [--base-commit <sha>]
                   [--head-commit <sha>] [--only <name>]... [--out <file.json>] [--summary <file.md>]
  cosyte-bench calibrate --suite <file> --base <file> --head <file> --comparisons <n>
                   [--inject <fraction>] [--only <name>]... [--out <file.json>] [--summary <file.md>]
  cosyte-bench check <results.json>
  cosyte-bench gate <reading.json> [--budgets <file>]
                   [--floor <file> (--base-floor <file> | --no-base-floor)] [--summary <file.md>]
  cosyte-bench floor <reading.json>... --out <floor.json> [--from <floor.json>]

Exit codes: 0 clean, 1 a finding (a regression, results that do not match the schema, a budget
broken, a measure worse than the floor beyond its noise, or a floor loosened), 2 could not measure,
could not read its input, or could not judge it. A run that could not measure a case still
writes every other case, lists what failed, and exits 2. gate and floor read only readings taken
on a GitHub-hosted runner.
`;

/** A bad command line. */
class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  "--suite",
  "--target",
  "--base",
  "--head",
  "--out",
  "--summary",
  "--commit",
  "--base-commit",
  "--head-commit",
  "--processes",
  "--comparisons",
  "--inject",
  "--only",
  "--budgets",
  "--floor",
  "--base-floor",
  "--from",
]);
const BOOLEAN_FLAGS = new Set(["--no-memory", "--no-import", "--no-base-floor"]);

/** The flags each command takes. Any other is refused rather than quietly ignored. */
const FLAGS_FOR: Readonly<
  Record<"run" | "compare" | "calibrate" | "gate" | "floor", readonly string[]>
> = {
  run: [
    "--suite",
    "--target",
    "--processes",
    "--no-memory",
    "--no-import",
    "--commit",
    "--only",
    "--out",
    "--summary",
  ],
  compare: [
    "--suite",
    "--base",
    "--head",
    "--base-commit",
    "--head-commit",
    "--only",
    "--out",
    "--summary",
  ],
  calibrate: [
    "--suite",
    "--base",
    "--head",
    "--comparisons",
    "--inject",
    "--only",
    "--out",
    "--summary",
  ],
  gate: ["--budgets", "--floor", "--base-floor", "--no-base-floor", "--summary"],
  floor: ["--out", "--from"],
};

/**
 * Parsed flags: each value flag's values in order, each boolean flag present or not, and the
 * positional arguments.
 *
 * @internal
 */
export interface ParsedArgs {
  readonly values: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
  readonly positional: readonly string[];
}

/**
 * Parse flags. Unknown flags and a value flag with no value are refused.
 *
 * @internal
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${arg} needs a value`);
      values.set(arg, [...(values.get(arg) ?? []), value]);
      i++;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg);
    } else if (arg.startsWith("--")) {
      throw new UsageError(`unknown flag ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { values, flags, positional };
}

function one(args: ParsedArgs, flag: string): string | undefined {
  const all = args.values.get(flag);
  if (all !== undefined && all.length > 1) throw new UsageError(`${flag} given more than once`);
  return all?.[0];
}

function required(args: ParsedArgs, flag: string): string {
  const value = one(args, flag);
  if (value === undefined) throw new UsageError(`${flag} is required`);
  return value;
}

function count(args: ParsedArgs, flag: string, fallback: number): number {
  const raw = one(args, flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} must be a positive integer`);
  return n;
}

function fraction(args: ParsedArgs, flag: string): number {
  const raw = one(args, flag);
  if (raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1)
    throw new UsageError(`${flag} must be a fraction from 0 to 1`);
  return n;
}

async function loadSuite(file: string): Promise<BenchSuite<unknown>> {
  const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
  return checkSuite(module.default);
}

/** An input `gate` or `floor` could not read: the message names the file, and the exit is 2. */
class Unreadable extends Error {}

function readText(file: string, abs: (p: string) => string, rel: (p: string) => string): string {
  try {
    return String(readFileSync(abs(file)));
  } catch {
    throw new Unreadable(`cannot read ${rel(file)}`);
  }
}

function parsed<T>(
  file: string,
  text: string,
  read: (text: string) => T,
  rel: (p: string) => string,
): T {
  try {
    return read(text);
  } catch (error) {
    throw new Unreadable(`${rel(file)}: ${(error as Error).message}`);
  }
}

/**
 * `gate`: judge one reading against a budgets file, a floor, and the base branch's floor. `floor`:
 * record a floor from an A/A set of readings, or tighten one.
 */
function judgeOrRecord(
  command: "gate" | "floor",
  args: ParsedArgs,
  io: MainIo,
  abs: (p: string) => string,
  rel: (p: string) => string,
): number {
  try {
    if (args.positional.length === 0) throw new UsageError(`${command} needs a reading`);
    const readings = args.positional.map((file) =>
      parsed(file, readText(file, abs, rel), readResults, rel),
    );
    if (command === "floor") {
      const out = required(args, "--out");
      const fromFile = one(args, "--from");
      const from =
        fromFile === undefined
          ? undefined
          : parsed(fromFile, readText(fromFile, abs, rel), readFloor, rel);
      for (const [i, doc] of readings.entries()) {
        const why = notJudgeable(doc);
        if (why !== null) throw new Unreadable(`${rel(args.positional[i] as string)}: ${why}`);
      }
      const floor = parsed(
        out,
        "",
        () => recordFloor(readings as ReadingDocument[], from),
        () => "the readings",
      );
      writeFileSync(abs(out), `${JSON.stringify(floor, null, 2)}\n`);
      io.stdout(
        `${rel(out)}: a floor of ${String(floor.cases.length)} case(s) from ${String(floor.readings)} readings on ${floor.runnerClass}, Node ${String(floor.nodeMajor)}\n`,
      );
      return 0;
    }
    if (args.positional.length > 1) throw new UsageError("gate judges one reading");
    const budgetsFile = one(args, "--budgets");
    const floorFile = one(args, "--floor");
    const baseFloorFile = one(args, "--base-floor");
    if (budgetsFile === undefined && floorFile === undefined)
      throw new UsageError("gate needs --budgets, --floor or both");
    const noBaseFloor = args.flags.has("--no-base-floor");
    if ((baseFloorFile !== undefined || noBaseFloor) && floorFile === undefined)
      throw new UsageError("--base-floor and --no-base-floor need --floor");
    if (floorFile !== undefined && (baseFloorFile === undefined) === !noBaseFloor)
      throw new UsageError(
        "--floor needs exactly one of --base-floor <the base branch's floor> and --no-base-floor (the base branch has no floor file yet)",
      );
    const file = args.positional[0] as string;
    const doc = readings[0] as ResultsDocument;
    const why = notJudgeable(doc);
    if (why !== null) throw new Unreadable(`${rel(file)}: ${why}`);
    const reading = doc as ReadingDocument;
    const budgets =
      budgetsFile === undefined
        ? undefined
        : parsed(budgetsFile, readText(budgetsFile, abs, rel), readBudgets, rel);
    const floor =
      floorFile === undefined
        ? undefined
        : parsed(floorFile, readText(floorFile, abs, rel), readFloor, rel);
    const baseFloor =
      baseFloorFile === undefined
        ? undefined
        : parsed(baseFloorFile, readText(baseFloorFile, abs, rel), readFloor, rel);
    const all: GateFinding[] = [];
    const parts: string[] = [];
    if (budgets !== undefined) {
      const r = checkBudgets(reading, budgets);
      all.push(...r.findings);
      parts.push(renderFindings(`Budgets (${rel(budgetsFile as string)})`, r.findings, r.checked));
    }
    if (floor !== undefined) {
      const r = checkFloor(reading, floor);
      all.push(...r.findings);
      parts.push(renderFindings(`Floor (${rel(floorFile as string)})`, r.findings, r.checked));
    }
    if (floor !== undefined && baseFloor !== undefined) {
      const loosened = loosenedFloor(baseFloor, floor);
      all.push(...loosened);
      parts.push(
        renderFindings(
          `The floor against the base branch's (${rel(baseFloorFile as string)})`,
          loosened,
          1,
        ),
      );
    }
    if (noBaseFloor) {
      parts.push(
        "### The floor against the base branch's\n\nNot compared: `--no-base-floor` says the base branch has no floor file, so this is a first floor, approved in review.\n",
      );
    }
    const markdown = parts.join("\n");
    const summary = one(args, "--summary");
    if (summary !== undefined) writeFileSync(abs(summary), markdown);
    io.stdout(markdown);
    return gateExitCode(all);
  } catch (error) {
    if (error instanceof Unreadable) {
      io.stderr(`[cosyte-bench] ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/**
 * Run the command line. Returns the exit code.
 *
 * @internal
 */
export async function main(argv: readonly string[], io: MainIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "--help" || command === "help") {
      io.stdout(USAGE);
      return command === undefined ? 2 : 0;
    }
    const args = parseArgs(rest);
    const abs = (p: string) => resolve(io.cwd, p);
    const rel = (p: string) => relative(io.cwd, abs(p));
    const progress = (line: string) => {
      io.stderr(`[cosyte-bench] ${line}\n`);
    };
    const finish = (doc: ResultsDocument, code: number): number => {
      const out = one(args, "--out");
      const summary = one(args, "--summary");
      const markdown = renderMarkdown(doc);
      if (out !== undefined) writeFileSync(abs(out), `${JSON.stringify(doc, null, 2)}\n`);
      if (summary !== undefined) writeFileSync(abs(summary), markdown);
      io.stdout(markdown);
      return code;
    };
    const overrides = { runJob: io.runJob, onProgress: progress };

    if (command === "check") {
      if (args.values.size > 0 || args.flags.size > 0) throw new UsageError("check takes no flags");
      const file = args.positional[0];
      if (file === undefined) throw new UsageError("check needs a results file");
      let text: string;
      try {
        text = String(readFileSync(abs(file)));
      } catch {
        io.stderr(`[cosyte-bench] cannot read ${rel(file)}\n`);
        return 2;
      }
      try {
        const doc = readResults(text);
        io.stdout(
          `${rel(file)}: a valid ${doc.kind} document, schema version ${String(doc.schemaVersion)}\n`,
        );
        return 0;
      } catch (error) {
        io.stderr(`[cosyte-bench] ${rel(file)}: ${(error as Error).message}\n`);
        return 1;
      }
    }

    if (
      command !== "run" &&
      command !== "compare" &&
      command !== "calibrate" &&
      command !== "gate" &&
      command !== "floor"
    ) {
      throw new UsageError(`unknown command ${command}`);
    }
    for (const flag of [...args.values.keys(), ...args.flags]) {
      if (!FLAGS_FOR[command].includes(flag))
        throw new UsageError(`${flag} does not apply to ${command}`);
    }
    if (command === "gate" || command === "floor") {
      return judgeOrRecord(command, args, io, abs, rel);
    }
    if (args.positional.length > 0)
      throw new UsageError(`unexpected argument ${String(args.positional[0])}`);
    const suiteFile = abs(required(args, "--suite"));
    const only = args.values.get("--only") ?? [];

    if (command === "run") {
      const target = required(args, "--target");
      const processes = count(args, "--processes", 3);
      const suite = await loadSuite(suiteFile);
      const reading = await readBuild({
        suiteFile,
        suite,
        target: abs(target),
        only,
        processes,
        memory: !args.flags.has("--no-memory"),
        importCost: !args.flags.has("--no-import"),
        ...overrides,
        measureImport: io.measureImport,
      });
      const commit = one(args, "--commit") ?? io.env["GITHUB_SHA"] ?? null;
      return finish(
        {
          ...documentBase({ name: suite.name, file: rel(suiteFile) }, io.environment(), io.now()),
          kind: "reading",
          subject: { target: rel(target), commit },
          reading,
        },
        // Whatever measured is written; a part that could not be is still exit 2.
        reading.failures.length > 0 ? 2 : 0,
      );
    }

    {
      const base = required(args, "--base");
      const head = required(args, "--head");
      // `--comparisons` and `--inject` belong to `calibrate` only (see FLAGS_FOR), so on `compare`
      // they read as absent: no comparisons and no slowdown.
      const comparisons = count(args, "--comparisons", 0);
      if (command === "calibrate" && comparisons === 0)
        throw new UsageError("--comparisons is required");
      const inject = fraction(args, "--inject");
      const suite = await loadSuite(suiteFile);
      const common = {
        suiteFile,
        suite,
        base: abs(base),
        head: abs(head),
        only,
        inject,
        ...overrides,
      };
      const sides = {
        base: { target: rel(base), commit: one(args, "--base-commit") ?? null },
        head: { target: rel(head), commit: one(args, "--head-commit") ?? null },
      };
      const docBase = documentBase(
        { name: suite.name, file: rel(suiteFile) },
        io.environment(),
        io.now(),
      );
      if (command === "compare") {
        const comparison = await compareBuilds(common);
        return finish(
          { ...docBase, kind: "comparison", ...sides, comparison },
          comparisonExitCode(comparison),
        );
      }
      const calibration = await calibrateComparison({ ...common, comparisons });
      return finish({ ...docBase, kind: "calibration", ...sides, calibration }, 0);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`[cosyte-bench] ${error.message}\n\n${USAGE}`);
      return 2;
    }
    io.stderr(`[cosyte-bench] ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
