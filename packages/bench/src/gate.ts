/**
 * What the budgets check and the floor check share: the findings they report, the exit code those
 * earn, the rule that a reading comes from a GitHub-hosted runner, a case's size class, and the
 * Markdown a person reads.
 *
 * @packageDocumentation
 */

import { BENCH_CONTRACT } from "./contract.js";
import type { CaseReading } from "./reading.js";
import type { ResultsDocument } from "./results.js";
import { validate, type Schema } from "./results.js";

/**
 * One thing a check found.
 *
 * - `breach`: a reading is over a budget.
 * - `regression`: a reading is worse than the floor by more than the noise its readings measured.
 * - `loosened`: a floor file is looser than the base branch's floor.
 * - `unjudged`: a budget or a floor names something the reading did not measure, or the reading
 *   cannot be judged at all. A skip is not a pass.
 */
export interface GateFinding {
  readonly kind: "breach" | "regression" | "loosened" | "unjudged";
  /** What was found, in one line a person can act on. */
  readonly message: string;
}

/**
 * The exit code a check earns: 1 when anything is over a budget, worse than the floor or loosened,
 * else 2 when anything could not be judged, else 0.
 *
 * @internal
 */
export function gateExitCode(findings: readonly GateFinding[]): number {
  if (findings.some((f) => f.kind !== "unjudged")) return 1;
  if (findings.length > 0) return 2;
  return 0;
}

/** A results document that is a reading. */
export type ReadingDocument = Extract<ResultsDocument, { kind: "reading" }>;

/**
 * Why a document cannot be judged against a budget or a floor, or `null` when it can: it must be a
 * reading, taken on a GitHub-hosted runner. A developer machine's numbers describe that machine, and
 * a self-hosted runner is not the runner class the standard was measured on.
 *
 * @internal
 */
export function notJudgeable(doc: ResultsDocument): string | null {
  if (doc.kind !== "reading") return `a ${doc.kind} is not a reading`;
  const runner = doc.environment.runner;
  if (runner.provider !== "github-actions" || runner.environment !== "github-hosted") {
    return `the reading was taken on ${runner.class}, not a GitHub-hosted runner; budgets and floors read only those`;
  }
  return null;
}

/** The size classes of a budgets file, by the average bytes of one input. */
export type SizeClass = "small" | "medium" | "large";

/**
 * A case's average bytes an input, or `null` when its suite gave no byte count.
 *
 * @internal
 */
export function bytesPerInput(
  c: Pick<CaseReading, "bytesPerPass" | "inputsPerPass">,
): number | null {
  return c.bytesPerPass === null ? null : c.bytesPerPass / c.inputsPerPass;
}

/**
 * The size class of an input of `bytes` bytes: `small` under `FLOOR_INPUT_BYTES` (where a memory
 * budget reads the median call above the empty-call floor), `large` at `LARGE_INPUT_BYTES` and over,
 * `medium` between.
 *
 * @internal
 */
export function sizeClass(bytes: number): SizeClass {
  if (bytes < BENCH_CONTRACT.FLOOR_INPUT_BYTES) return "small";
  if (bytes < BENCH_CONTRACT.LARGE_INPUT_BYTES) return "medium";
  return "large";
}

/**
 * A case's name as findings print it.
 *
 * @internal
 */
export function caseName(c: { readonly benchmark: string; readonly size: string }): string {
  return `${c.benchmark} @ ${c.size}`;
}

/**
 * Parse JSON text and check it against a schema; throws a `TypeError` naming every problem.
 *
 * @internal
 */
export function readChecked(text: string, schema: Schema, what: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError(`@cosyte/bench: the ${what} is not JSON`);
  }
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== 1) {
    throw new TypeError(
      `@cosyte/bench: ${what} version ${String(version)} is not one this package reads (1)`,
    );
  }
  const problems = validate(value, schema);
  if (problems.length > 0) {
    throw new TypeError(
      `@cosyte/bench: the ${what} does not match its schema:\n${problems.join("\n")}`,
    );
  }
  return value;
}

/**
 * The Markdown a check prints and writes to a job summary.
 *
 * @internal
 */
export function renderFindings(
  title: string,
  findings: readonly GateFinding[],
  checked: number,
): string {
  const lines = [`### ${title}`, ""];
  const exit = gateExitCode(findings);
  if (exit === 0) {
    lines.push(`Every one of ${String(checked)} limit(s) held.`);
  } else {
    lines.push(
      exit === 1
        ? "**Failed.** At least one limit was not held."
        : "**Could not judge.** Something a limit names was not measured, and a skip is not a pass.",
      "",
      "| Finding | What |",
      "| --- | --- |",
      ...findings.map((f) => `| ${f.kind} | ${f.message.replaceAll("|", "\\|")} |`),
    );
  }
  return `${lines.join("\n")}\n`;
}
