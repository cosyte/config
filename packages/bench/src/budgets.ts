/**
 * A package's performance budgets: the limits a reading of its build must stay within, written in a
 * versioned file (`bench/budgets.json` by convention) and checked by `cosyte-bench gate`.
 *
 * A budget is a number a package commits to, and the first ones a package writes are approved by a
 * person, not derived by a tool: this module only reads them and says whether a reading holds them.
 * The standard and its proposed defaults are ADR 0007 in the `config` repository.
 *
 * @packageDocumentation
 */

import {
  bytesPerInput,
  caseName,
  readChecked,
  sizeClass,
  type GateFinding,
  type ReadingDocument,
  type SizeClass,
} from "./gate.js";
import type { ImportCostReport } from "./import-cost.js";
import { budgetPeakBytes, type CaseReading } from "./reading.js";

/** One budget rule: which cases it covers, and the limits each of them must hold. */
export interface BudgetRule {
  /** The benchmark it covers, by its exact name. Absent: every benchmark. */
  readonly benchmark?: string;
  /** The size it covers, by its exact label. Absent: every size. */
  readonly size?: string;
  /**
   * The most a case's peak (`budgetPeakBytes`) may be, as a multiple of the average bytes of one
   * input, by the input's size class. A class not named here has no peak budget.
   */
  readonly peakMultiple?: Readonly<Partial<Record<SizeClass, number>>>;
  /** The most one operation (one input) may allocate, heap and external memory together, in bytes. */
  readonly allocBytesPerOp?: number;
  /** The least throughput, in bytes of input a second. */
  readonly minBytesPerSecond?: number;
  /** The least throughput, in operations (inputs) a second. */
  readonly minOpsPerSecond?: number;
}

/** A budgets file. */
export interface Budgets {
  readonly schemaVersion: 1;
  readonly kind: "budgets";
  /** Free text for a reader: where the numbers came from and who approved them. */
  readonly description?: string;
  /** Every rule that matches a case applies to it, so a narrower rule can only add a limit. */
  readonly rules: readonly BudgetRule[];
  /** The build's import, from the reading's `importCost`. */
  readonly import?: {
    /** The most the median cold import may take, in milliseconds. */
    readonly maxColdImportMs?: number;
    /** The most every file the import loads may weigh, gzipped, in bytes. */
    readonly maxGzipBytes?: number;
  };
}

const limit = { type: "number", minimum: 0 } as const;

/**
 * The budgets schema, version 1, as JSON Schema (draft 2020-12), also shipped as
 * `schema/budgets-v1.schema.json`. A key it does not know is refused, so a mistyped budget is an
 * error rather than a limit nobody checks.
 *
 * @example
 * ```ts
 * import { BUDGETS_SCHEMA } from "@cosyte/bench";
 *
 * BUDGETS_SCHEMA.properties.kind.const; // => "budgets"
 * ```
 */
export const BUDGETS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/cosyte/config/blob/main/packages/bench/schema/budgets-v1.schema.json",
  title: "@cosyte/bench budgets, version 1",
  type: "object",
  required: ["schemaVersion", "kind", "rules"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    schemaVersion: { const: 1 },
    kind: { const: "budgets" },
    description: { type: "string" },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          benchmark: { type: "string" },
          size: { type: "string" },
          peakMultiple: {
            type: "object",
            additionalProperties: false,
            properties: { small: limit, medium: limit, large: limit },
          },
          allocBytesPerOp: limit,
          minBytesPerSecond: limit,
          minOpsPerSecond: limit,
        },
      },
    },
    import: {
      type: "object",
      additionalProperties: false,
      properties: { maxColdImportMs: limit, maxGzipBytes: limit },
    },
  },
} as const;

/**
 * Parse and check a budgets file. Throws a `TypeError` listing every problem.
 *
 * @example
 * ```ts
 * import { readBudgets } from "@cosyte/bench";
 *
 * readBudgets('{"schemaVersion": 1, "kind": "budgets", "rules": []}').rules.length; // => 0
 * ```
 */
export function readBudgets(text: string): Budgets {
  return readChecked(text, BUDGETS_SCHEMA, "budgets file") as Budgets;
}

/** How a rule names the cases it covers, for a finding. */
function ruleName(rule: BudgetRule, index: number): string {
  return `rule ${String(index + 1)} (benchmark ${rule.benchmark ?? "any"}, size ${rule.size ?? "any"})`;
}

/** Bytes with a unit, for a finding. */
function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${String(Math.round(n))} B`;
}

/** One rule's limits on one case. Pushes a finding for each it breaks or cannot judge. */
function checkCase(rule: BudgetRule, c: CaseReading, out: GateFinding[]): number {
  const name = caseName(c);
  let checked = 0;
  const unjudged = (message: string) =>
    out.push({ kind: "unjudged", message: `${name}: ${message}` });
  const breach = (message: string) => out.push({ kind: "breach", message: `${name}: ${message}` });
  if (rule.peakMultiple !== undefined) {
    const perInput = bytesPerInput(c);
    if (perInput === null) {
      checked++;
      unjudged(
        "its suite gave no byte count, so its peak cannot be read as a multiple of its input",
      );
    } else {
      const cls = sizeClass(perInput);
      const most = rule.peakMultiple[cls];
      checked++;
      const peak = budgetPeakBytes(c);
      if (most === undefined) {
        // The rule asks for a peak budget on this case and has none for its class: a skip, not a pass.
        unjudged(
          `its ${bytes(perInput)} input is in the ${cls} class, and the rule's peakMultiple names no ${cls} limit`,
        );
      } else if (peak === null) unjudged("its peak was not measured");
      else if (peak / perInput > most) {
        breach(
          `peak ${bytes(peak)} is ${(peak / perInput).toFixed(2)} times its ${bytes(perInput)} input, over the ${cls} budget of ${String(most)} times`,
        );
      }
    }
  }
  if (rule.allocBytesPerOp !== undefined) {
    checked++;
    const a = c.allocations;
    if (a === null || a.status !== "measured") {
      unjudged(`its allocations were not measured${a === null ? "" : ` (${a.reason})`}`);
    } else {
      const per = a.heapBytesPerOp + a.externalBytesPerOp;
      if (per > rule.allocBytesPerOp) {
        breach(
          `allocates ${String(per)} bytes an operation, over the budget of ${String(rule.allocBytesPerOp)}`,
        );
      }
    }
  }
  const t = c.throughput;
  if (rule.minBytesPerSecond !== undefined) {
    checked++;
    if (t.status !== "measured") unjudged(`its throughput was not measured (${t.reason})`);
    else if (t.bytesPerSecond === null)
      unjudged("its suite gave no byte count, so it has no bytes a second");
    else if (t.bytesPerSecond < rule.minBytesPerSecond) {
      breach(
        `${String(t.bytesPerSecond)} bytes a second, under the budget of ${String(rule.minBytesPerSecond)}`,
      );
    }
  }
  if (rule.minOpsPerSecond !== undefined) {
    checked++;
    if (t.status !== "measured") unjudged(`its throughput was not measured (${t.reason})`);
    else if (t.opsPerSecond < rule.minOpsPerSecond) {
      breach(
        `${String(t.opsPerSecond)} operations a second, under the budget of ${String(rule.minOpsPerSecond)}`,
      );
    }
  }
  return checked;
}

/**
 * Check a reading against a budgets file. Every rule must match at least one case of the reading:
 * a rule that matches none (a renamed case, a size removed) is `unjudged`, never a quiet pass. So is
 * a peak budget on a case whose size class the rule's `peakMultiple` does not name, and a file that
 * holds no limit at all.
 * A limit is held at exactly its value and broken past it.
 *
 * @internal
 */
export function checkBudgets(
  doc: ReadingDocument,
  budgets: Budgets,
): { readonly findings: readonly GateFinding[]; readonly checked: number } {
  const findings: GateFinding[] = [];
  let checked = 0;
  const cases = doc.reading.cases;
  budgets.rules.forEach((rule, index) => {
    const matched = cases.filter(
      (c) =>
        (rule.benchmark === undefined || c.benchmark === rule.benchmark) &&
        (rule.size === undefined || c.size === rule.size),
    );
    if (matched.length === 0) {
      checked++;
      findings.push({
        kind: "unjudged",
        message: `${ruleName(rule, index)} matches no case in the reading`,
      });
    }
    for (const c of matched) checked += checkCase(rule, c, findings);
  });
  const imp = budgets.import ?? {};
  const cost = doc.reading.importCost;
  const importLimits = [
    {
      what: "cold import",
      most: imp.maxColdImportMs,
      read: (k: ImportCostReport) => k.medianMs,
      say: (got: number, most: number) =>
        `the median cold import took ${got.toFixed(2)} ms, over the budget of ${String(most)} ms`,
    },
    {
      what: "gzipped size",
      most: imp.maxGzipBytes,
      read: (k: ImportCostReport) => k.totalGzipBytes,
      say: (got: number, most: number) =>
        `the import loads ${bytes(got)} gzipped, over the budget of ${bytes(most)}`,
    },
  ];
  for (const { what, most, read, say } of importLimits) {
    if (most === undefined) continue;
    checked++;
    if (cost === null) {
      findings.push({ kind: "unjudged", message: `the ${what} was not measured` });
    } else if (read(cost) > most) {
      findings.push({ kind: "breach", message: say(read(cost), most) });
    }
  }
  if (checked === 0) {
    findings.push({
      kind: "unjudged",
      message: "the budgets file holds no limit, so it judged nothing",
    });
  }
  return { findings, checked };
}
