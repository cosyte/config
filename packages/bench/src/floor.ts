/**
 * A package's performance floor: what its default branch measured, case by case, kept in a
 * versioned file (`bench/floor.json` by convention) that only ever tightens.
 *
 * A floor is recorded from an A/A set: at least `FLOOR_MIN_READINGS` readings of one commit, each on
 * a GitHub-hosted runner. For every measure it keeps the highest of them (`value`) and the spread
 * between the highest and the lowest (`noise`): the noise that set measured with nothing changed. A
 * later reading is a regression only when it is above the measure's limit, `value` plus
 * `FLOOR_NOISE_MULTIPLE` times `noise`.
 *
 * Recording again from an existing floor replaces a measure only when the new set's whole limit is
 * below the old set's lowest reading (`value - noise`): an improvement the old noise cannot explain.
 * Anything less keeps the old measure as it was, value and noise. Taking the lower of two sets of
 * unchanged code would ratchet the limit down on luck alone, so unchanged code would fail more
 * often with every recording; this rule almost never fires on unchanged code, so the limit does
 * not drift, and it never rises. A floor file that is looser than its base branch's is a finding of
 * its own.
 *
 * Every measure is one where lower is better: milliseconds an operation, the peak a memory budget
 * reads (`budgetPeakBytes`), bytes allocated an operation, the median cold import and the gzipped
 * bytes the import loads.
 *
 * @packageDocumentation
 */

import { BENCH_CONTRACT } from "./contract.js";
import {
  caseName,
  notJudgeable,
  readChecked,
  type GateFinding,
  type ReadingDocument,
} from "./gate.js";
import type { ImportCostReport } from "./import-cost.js";
import { budgetPeakBytes, type CaseReading } from "./reading.js";
import { round } from "./stats.js";

/** One measure's floor: a reading above `value + FLOOR_NOISE_MULTIPLE * noise` is a regression. */
export interface FloorValue {
  /** The highest the A/A readings measured, or lower once the floor has improved. */
  readonly value: number;
  /** The highest less the lowest of the A/A readings: the spread with nothing changed. */
  readonly noise: number;
}

/** The measures of a case a floor keeps. `null` where the A/A readings did not all measure it. */
export interface FloorCase {
  readonly benchmark: string;
  readonly size: string;
  /** The median of the timing processes' medians, milliseconds an operation. */
  readonly msPerOp: FloorValue | null;
  /** The peak a memory budget reads, `budgetPeakBytes`. */
  readonly peakBytes: FloorValue | null;
  /** Heap and external bytes allocated an operation. */
  readonly allocBytesPerOp: FloorValue | null;
}

/** A floor file. */
export interface Floor {
  readonly schemaVersion: 1;
  readonly kind: "floor";
  /** The suite's name, as its readings carry it. */
  readonly suite: string;
  /** The runner class the readings were taken on; a reading of another class is not compared. */
  readonly runnerClass: string;
  /** Node's major version the readings ran on; a reading on another is not compared. */
  readonly nodeMajor: number;
  /** The commit of the readings it was last recorded from, when they named one. */
  readonly commit: string | null;
  /** How many readings it was last recorded from. */
  readonly readings: number;
  readonly cases: readonly FloorCase[];
  /** The median cold import, milliseconds, and the gzipped bytes the import loads. */
  readonly import: { readonly medianMs: FloorValue; readonly gzipBytes: FloorValue } | null;
}

const measure = {
  type: "object",
  required: ["value", "noise"],
  additionalProperties: false,
  properties: {
    value: { type: "number", minimum: 0 },
    noise: { type: "number", minimum: 0 },
  },
} as const;
const value = { oneOf: [{ type: "null" }, measure] } as const;

/**
 * The floor schema, version 1, as JSON Schema (draft 2020-12), also shipped as
 * `schema/floor-v1.schema.json`.
 *
 * @example
 * ```ts
 * import { FLOOR_SCHEMA } from "@cosyte/bench";
 *
 * FLOOR_SCHEMA.properties.kind.const; // => "floor"
 * ```
 */
export const FLOOR_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/cosyte/config/blob/main/packages/bench/schema/floor-v1.schema.json",
  title: "@cosyte/bench floor, version 1",
  type: "object",
  required: [
    "schemaVersion",
    "kind",
    "suite",
    "runnerClass",
    "nodeMajor",
    "commit",
    "readings",
    "cases",
    "import",
  ],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    schemaVersion: { const: 1 },
    kind: { const: "floor" },
    suite: { type: "string" },
    runnerClass: { type: "string" },
    nodeMajor: { type: "integer", minimum: 0 },
    commit: { type: ["string", "null"] },
    readings: { type: "integer", minimum: 0 },
    cases: {
      type: "array",
      items: {
        type: "object",
        required: ["benchmark", "size", "msPerOp", "peakBytes", "allocBytesPerOp"],
        additionalProperties: false,
        properties: {
          benchmark: { type: "string" },
          size: { type: "string" },
          msPerOp: value,
          peakBytes: value,
          allocBytesPerOp: value,
        },
      },
    },
    import: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          required: ["medianMs", "gzipBytes"],
          additionalProperties: false,
          properties: { medianMs: measure, gzipBytes: measure },
        },
      ],
    },
  },
} as const;

/**
 * Parse and check a floor file. Throws a `TypeError` listing every problem.
 *
 * @example
 * ```ts
 * import { readFloor } from "@cosyte/bench";
 *
 * const text = JSON.stringify({
 *   schemaVersion: 1,
 *   kind: "floor",
 *   suite: "@cosyte/example parse",
 *   runnerClass: "github-actions-github-hosted-ubuntu24-x64",
 *   nodeMajor: 24,
 *   commit: null,
 *   readings: 3,
 *   cases: [],
 *   import: null,
 * });
 * readFloor(text).nodeMajor; // => 24
 * ```
 */
export function readFloor(text: string): Floor {
  return readChecked(text, FLOOR_SCHEMA, "floor file") as Floor;
}

/** The case measures a floor keeps, read from a case of a reading. */
const CASE_MEASURES = {
  msPerOp: (c: CaseReading) =>
    c.throughput.status === "measured" ? c.throughput.medianMsPerOp : null,
  peakBytes: (c: CaseReading) => budgetPeakBytes(c),
  allocBytesPerOp: (c: CaseReading) =>
    c.allocations === null || c.allocations.status !== "measured"
      ? null
      : c.allocations.heapBytesPerOp + c.allocations.externalBytesPerOp,
} as const;

type CaseMeasure = keyof typeof CASE_MEASURES;
const CASE_MEASURE_NAMES = Object.keys(CASE_MEASURES) as CaseMeasure[];

/** The import measures a floor keeps. */
const IMPORT_MEASURES = {
  medianMs: (k: ImportCostReport) => k.medianMs,
  gzipBytes: (k: ImportCostReport) => k.totalGzipBytes,
} as const;

type ImportMeasure = keyof typeof IMPORT_MEASURES;
const IMPORT_MEASURE_NAMES = Object.keys(IMPORT_MEASURES) as ImportMeasure[];

/** How a finding names each measure. */
const LABEL: Readonly<Record<CaseMeasure | ImportMeasure, string>> = {
  msPerOp: "ms an operation",
  peakBytes: "peak bytes",
  allocBytesPerOp: "bytes allocated an operation",
  medianMs: "median cold import, ms",
  gzipBytes: "gzipped bytes loaded",
};

/** Node's major version from a version string such as `v24.1.0`. */
function nodeMajorOf(doc: ReadingDocument): number {
  return Number.parseInt(doc.environment.node.replace(/^v/, ""), 10);
}

const key = (c: { readonly benchmark: string; readonly size: string }) =>
  `${c.benchmark}\u0000${c.size}`;

/** The floor of one measure from the A/A set's values: `null` unless every reading measured it. */
function fromSet(values: readonly (number | null)[]): FloorValue | null {
  if (values.some((v) => v === null)) return null;
  const xs = values as readonly number[];
  const high = Math.max(...xs);
  return { value: high, noise: round(high - Math.min(...xs), 6) };
}

/**
 * The most a reading may measure before it is a regression.
 *
 * @internal
 */
export function floorLimit(f: FloorValue): number {
  return f.value + BENCH_CONTRACT.FLOOR_NOISE_MULTIPLE * f.noise;
}

/**
 * One measure of an old floor and a new set: the new set only when its whole limit is below the
 * old set's lowest reading, else the old measure unchanged. Never gone, never looser.
 *
 * @internal
 */
export function tighter(old: FloorValue | null, next: FloorValue | null): FloorValue | null {
  if (old === null) return next;
  if (next === null) return old;
  return floorLimit(next) < old.value - old.noise ? next : old;
}

/**
 * Record a floor from an A/A set of readings of one commit, or tighten an existing floor with one.
 *
 * Throws a `TypeError` when there are fewer than `FLOOR_MIN_READINGS` readings, when any is not
 * from a GitHub-hosted runner, or when they (or the existing floor) differ in suite, runner class,
 * Node major version or commit: a floor compares like with like or not at all.
 *
 * With `from`, a measure takes the new set's value and noise only when the new limit is below the
 * old set's lowest reading, and keeps the old ones otherwise; no case or measure is dropped, and a
 * new case or measure is added: the floor only tightens, and does not tighten on luck.
 *
 * @internal
 */
export function recordFloor(docs: readonly ReadingDocument[], from?: Floor): Floor {
  if (docs.length < BENCH_CONTRACT.FLOOR_MIN_READINGS) {
    throw new TypeError(
      `@cosyte/bench: a floor is recorded from at least ${String(BENCH_CONTRACT.FLOOR_MIN_READINGS)} readings of one commit, and ${String(docs.length)} were given`,
    );
  }
  for (const doc of docs) {
    const why = notJudgeable(doc);
    if (why !== null) throw new TypeError(`@cosyte/bench: ${why}`);
  }
  const first = docs[0] as ReadingDocument;
  const same = {
    suite: first.suite.name,
    runnerClass: first.environment.runner.class,
    nodeMajor: nodeMajorOf(first),
    commit: first.subject.commit,
  };
  for (const doc of docs) {
    const theirs = {
      suite: doc.suite.name,
      runnerClass: doc.environment.runner.class,
      nodeMajor: nodeMajorOf(doc),
      commit: doc.subject.commit,
    };
    for (const field of Object.keys(same) as (keyof typeof same)[]) {
      if (theirs[field] !== same[field]) {
        throw new TypeError(
          `@cosyte/bench: the readings differ in ${field} (${String(same[field])} and ${String(theirs[field])}); a floor is recorded from readings of one commit, suite, runner class and Node line`,
        );
      }
    }
  }
  if (from !== undefined) {
    for (const field of ["suite", "runnerClass", "nodeMajor"] as const) {
      if (from[field] !== same[field]) {
        throw new TypeError(
          `@cosyte/bench: the floor's ${field} is ${String(from[field])} and the readings' is ${String(same[field])}; a floor for another one is recorded afresh, without --from`,
        );
      }
    }
  }

  const order: string[] = [];
  const refs = new Map<string, { benchmark: string; size: string }>();
  for (const doc of docs) {
    for (const c of doc.reading.cases) {
      if (!refs.has(key(c))) {
        refs.set(key(c), { benchmark: c.benchmark, size: c.size });
        order.push(key(c));
      }
    }
  }
  const measured = new Map<string, FloorCase>();
  for (const k of order) {
    const ref = refs.get(k) as { benchmark: string; size: string };
    const inEach = docs.map((d) => d.reading.cases.find((c) => key(c) === k) ?? null);
    const entry: Record<string, unknown> = { ...ref };
    for (const m of CASE_MEASURE_NAMES) {
      entry[m] = fromSet(inEach.map((c) => (c === null ? null : CASE_MEASURES[m](c))));
    }
    measured.set(k, entry as unknown as FloorCase);
  }
  const imports = docs.map((d) => d.reading.importCost);
  const freshImport = imports.some((k) => k === null)
    ? null
    : {
        medianMs: fromSet(imports.map((k) => IMPORT_MEASURES.medianMs(k as ImportCostReport))),
        gzipBytes: fromSet(imports.map((k) => IMPORT_MEASURES.gzipBytes(k as ImportCostReport))),
      };

  let cases: FloorCase[] = [...measured.values()];
  let imported = freshImport as Floor["import"];
  if (from !== undefined) {
    const old = new Map(from.cases.map((c) => [key(c), c]));
    cases = [
      ...from.cases.map((o) => {
        const n = measured.get(key(o));
        if (n === undefined) return o;
        return {
          benchmark: o.benchmark,
          size: o.size,
          msPerOp: tighter(o.msPerOp, n.msPerOp),
          peakBytes: tighter(o.peakBytes, n.peakBytes),
          allocBytesPerOp: tighter(o.allocBytesPerOp, n.allocBytesPerOp),
        };
      }),
      ...cases.filter((c) => !old.has(key(c))),
    ];
    if (from.import !== null) {
      imported =
        freshImport === null
          ? from.import
          : {
              medianMs: tighter(from.import.medianMs, freshImport.medianMs) as FloorValue,
              gzipBytes: tighter(from.import.gzipBytes, freshImport.gzipBytes) as FloorValue,
            };
    }
  }
  return {
    schemaVersion: 1,
    kind: "floor",
    ...same,
    readings: docs.length,
    cases,
    import: imported,
  };
}

/** Numbers as a finding prints them. */
const show = (n: number) => String(round(n, 4));

/**
 * Check a reading against a floor: each measure the floor keeps must be at or below its limit
 * (`floorLimit`). A case or a measure the floor keeps and the reading did not measure is
 * `unjudged`, and so is a reading of another suite, runner class or Node line, and a floor that
 * keeps no measure at all. A case the floor does not keep yet has no floor and is not judged. The
 * reading's runner is checked by the caller.
 *
 * @internal
 */
export function checkFloor(
  doc: ReadingDocument,
  floor: Floor,
): { readonly findings: readonly GateFinding[]; readonly checked: number } {
  const findings: GateFinding[] = [];
  const theirs = {
    suite: doc.suite.name,
    runnerClass: doc.environment.runner.class,
    nodeMajor: nodeMajorOf(doc),
  };
  for (const field of ["suite", "runnerClass", "nodeMajor"] as const) {
    if (theirs[field] !== floor[field]) {
      findings.push({
        kind: "unjudged",
        message: `the reading's ${field} is ${String(theirs[field])} and the floor's is ${String(floor[field])}: they are not compared`,
      });
    }
  }
  if (findings.length > 0) return { findings, checked: 0 };
  let checked = 0;
  const judge = (
    where: string,
    label: string,
    floorValue: FloorValue | null,
    got: number | null,
  ) => {
    if (floorValue === null) return;
    checked++;
    if (got === null) {
      findings.push({ kind: "unjudged", message: `${where}: ${label} was not measured` });
      return;
    }
    const most = floorLimit(floorValue);
    if (got > most) {
      findings.push({
        kind: "regression",
        message: `${where}: ${label} ${show(got)}, above the floor's limit of ${show(most)} (its highest A/A reading ${show(floorValue.value)} plus ${String(BENCH_CONTRACT.FLOOR_NOISE_MULTIPLE)} times its spread of ${show(floorValue.noise)})`,
      });
    }
  };
  for (const f of floor.cases) {
    const c = doc.reading.cases.find((x) => key(x) === key(f));
    if (c === undefined) {
      checked++;
      findings.push({
        kind: "unjudged",
        message: `${caseName(f)}: the floor keeps it and the reading has no such case`,
      });
      continue;
    }
    for (const m of CASE_MEASURE_NAMES) judge(caseName(f), LABEL[m], f[m], CASE_MEASURES[m](c));
  }
  if (floor.import !== null) {
    const cost = doc.reading.importCost;
    for (const m of IMPORT_MEASURE_NAMES) {
      judge("import", LABEL[m], floor.import[m], cost === null ? null : IMPORT_MEASURES[m](cost));
    }
  }
  if (checked === 0) {
    findings.push({
      kind: "unjudged",
      message: "the floor keeps no measure, so it judged nothing",
    });
  }
  return { findings, checked };
}

/**
 * The ways a pull request's floor is looser than its base branch's: a case or a measure gone, a
 * measure's limit raised, or a floor for another suite, runner class or Node line. Each is a
 * `loosened` finding; an empty list means the floor held or tightened.
 *
 * @internal
 */
export function loosenedFloor(base: Floor, head: Floor): readonly GateFinding[] {
  const findings: GateFinding[] = [];
  const loosened = (message: string) => findings.push({ kind: "loosened", message });
  for (const field of ["suite", "runnerClass", "nodeMajor"] as const) {
    if (base[field] !== head[field]) {
      loosened(
        `the floor's ${field} changed from ${String(base[field])} to ${String(head[field])}: a floor recorded afresh is not compared with its base`,
      );
    }
  }
  const compare = (where: string, label: string, b: FloorValue | null, h: FloorValue | null) => {
    if (b === null) return;
    if (h === null) loosened(`${where}: ${label} has no floor any more`);
    else if (floorLimit(h) > floorLimit(b)) {
      loosened(
        `${where}: ${label}'s limit rose from ${show(floorLimit(b))} to ${show(floorLimit(h))}`,
      );
    }
  };
  for (const b of base.cases) {
    const h = head.cases.find((x) => key(x) === key(b));
    if (h === undefined) {
      loosened(`${caseName(b)}: the floor no longer keeps it`);
      continue;
    }
    for (const m of CASE_MEASURE_NAMES) compare(caseName(b), LABEL[m], b[m], h[m]);
  }
  if (base.import !== null) {
    for (const m of IMPORT_MEASURE_NAMES) {
      compare("import", LABEL[m], base.import[m], head.import === null ? null : head.import[m]);
    }
  }
  return findings;
}
