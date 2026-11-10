/**
 * The results document: one JSON file per reading, comparison or calibration, in a versioned shape a
 * results repository can keep for years and read back.
 *
 * The shape is fixed by a JSON Schema ({@link RESULTS_SCHEMA}, also shipped as
 * `schema/results-v1.schema.json`). Version 1 only grows: a new field may appear, no field changes
 * meaning or goes away, and readers ignore fields they do not know. Anything else is version 2.
 *
 * @packageDocumentation
 */

import { createRequire } from "node:module";

import type { CalibrationBody, ComparisonBody } from "./compare.js";
import { BENCH_CONTRACT, type BenchContractShape } from "./contract.js";
import type { Environment } from "./environment.js";
import { WARMUP } from "./measure.js";
import type { ReadingBody } from "./reading.js";

/** The version this package writes and reads. */
export const SCHEMA_VERSION = 1;

/** Which build a document describes. */
export interface BuildRef {
  /** The entry measured, relative to the working directory. */
  readonly target: string;
  /** The commit it was built from, when known. */
  readonly commit: string | null;
}

interface DocumentBase {
  readonly schemaVersion: 1;
  readonly tool: { readonly name: "@cosyte/bench"; readonly version: string };
  /** When the document was written, ISO 8601 UTC. */
  readonly createdAt: string;
  readonly suite: { readonly name: string; readonly file: string };
  readonly environment: Environment;
  /** The constants in force, so a document can be judged against the method that made it. */
  readonly contract: { readonly bench: BenchContractShape; readonly warmup: typeof WARMUP };
}

/** A results document. */
export type ResultsDocument = DocumentBase &
  (
    | { readonly kind: "reading"; readonly subject: BuildRef; readonly reading: ReadingBody }
    | {
        readonly kind: "comparison";
        readonly base: BuildRef;
        readonly head: BuildRef;
        readonly comparison: ComparisonBody;
      }
    | {
        readonly kind: "calibration";
        readonly base: BuildRef;
        readonly head: BuildRef;
        readonly calibration: CalibrationBody;
      }
  );

/**
 * This package's version, read from its own manifest.
 *
 * @internal
 */
export function toolVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}

/**
 * The parts every document shares.
 *
 * @internal
 */
export function documentBase(
  suite: { name: string; file: string },
  environment: Environment,
  now: Date = new Date(),
): DocumentBase {
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: "@cosyte/bench", version: toolVersion() },
    createdAt: now.toISOString(),
    suite,
    environment,
    contract: { bench: BENCH_CONTRACT, warmup: WARMUP },
  };
}

/** The JSON Schema keywords the results schema uses. */
interface Schema {
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, Schema>>;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly type?: string | readonly string[];
  readonly minimum?: number;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly items?: Schema;
  readonly oneOf?: readonly Schema[];
}

const num = { type: "number" } as const;
const int = { type: "integer", minimum: 0 } as const;
const str = { type: "string" } as const;
const strOrNull = { type: ["string", "null"] } as const;
const numOrNull = { type: ["number", "null"] } as const;
const nums = { type: "array", items: num } as const;
const skipped = {
  type: "object",
  required: ["status", "reason"],
  properties: { status: { const: "skipped" }, reason: str },
} as const;
const measuredOrSkipped = (measured: Schema): Schema => ({ oneOf: [measured, skipped] });
const orNull = (s: Schema): Schema => ({ oneOf: [{ type: "null" }, s] });

/**
 * The results schema, version 1, as JSON Schema (draft 2020-12). It holds what every reader relies
 * on; a document may carry more.
 *
 * @example
 * ```ts
 * import { RESULTS_SCHEMA } from "@cosyte/bench";
 *
 * RESULTS_SCHEMA.$id; // => "https://github.com/cosyte/config/blob/main/packages/bench/schema/results-v1.schema.json"
 * ```
 */
export const RESULTS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/cosyte/config/blob/main/packages/bench/schema/results-v1.schema.json",
  title: "@cosyte/bench results, version 1",
  type: "object",
  required: ["schemaVersion", "kind", "tool", "createdAt", "suite", "environment", "contract"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { enum: ["reading", "comparison", "calibration"] },
    tool: {
      type: "object",
      required: ["name", "version"],
      properties: { name: { const: "@cosyte/bench" }, version: str },
    },
    createdAt: str,
    suite: { type: "object", required: ["name", "file"], properties: { name: str, file: str } },
    environment: { $ref: "#/$defs/environment" },
    contract: {
      type: "object",
      required: ["bench", "warmup"],
      properties: { bench: { type: "object" }, warmup: { type: "object" } },
    },
  },
  oneOf: [
    {
      required: ["subject", "reading"],
      properties: {
        kind: { const: "reading" },
        subject: { $ref: "#/$defs/build" },
        reading: { $ref: "#/$defs/reading" },
      },
    },
    {
      required: ["base", "head", "comparison"],
      properties: {
        kind: { const: "comparison" },
        base: { $ref: "#/$defs/build" },
        head: { $ref: "#/$defs/build" },
        comparison: { $ref: "#/$defs/comparison" },
      },
    },
    {
      required: ["base", "head", "calibration"],
      properties: {
        kind: { const: "calibration" },
        base: { $ref: "#/$defs/build" },
        head: { $ref: "#/$defs/build" },
        calibration: { $ref: "#/$defs/calibration" },
      },
    },
  ],
  $defs: {
    build: {
      type: "object",
      required: ["target", "commit"],
      properties: { target: str, commit: strOrNull },
    },
    environment: {
      type: "object",
      required: [
        "node",
        "v8",
        "platform",
        "arch",
        "osRelease",
        "cpuModel",
        "logicalCpus",
        "totalMemoryBytes",
        "cgroupCpuMax",
        "runner",
      ],
      properties: {
        node: str,
        v8: str,
        platform: str,
        arch: str,
        osRelease: str,
        cpuModel: strOrNull,
        logicalCpus: int,
        totalMemoryBytes: int,
        cgroupCpuMax: strOrNull,
        // Added within version 1, so not required: a document written before it is still valid.
        loadAverage: nums,
        runner: {
          type: "object",
          required: ["ci", "provider", "class"],
          properties: { ci: { type: "boolean" }, provider: strOrNull, class: str },
        },
      },
    },
    interval: orNull({
      type: "object",
      required: ["low", "high", "rank", "tail"],
      properties: { low: num, high: num, rank: int, tail: num },
    }),
    caseComparison: {
      type: "object",
      required: [
        "benchmark",
        "size",
        "baseMsPerOp",
        "headMsPerOp",
        "ratios",
        "medianRatio",
        "interval",
        "verdict",
        "skipReason",
      ],
      properties: {
        benchmark: str,
        size: str,
        baseMsPerOp: nums,
        headMsPerOp: nums,
        ratios: nums,
        medianRatio: numOrNull,
        interval: { $ref: "#/$defs/interval" },
        verdict: {
          enum: ["regression", "improvement", "no-regression", "inconclusive", "skipped"],
        },
        skipReason: strOrNull,
      },
    },
    comparison: {
      type: "object",
      required: ["rounds", "threshold", "alpha", "inject", "cases"],
      properties: {
        rounds: int,
        threshold: num,
        alpha: num,
        inject: num,
        cases: { type: "array", items: { $ref: "#/$defs/caseComparison" } },
      },
    },
    rate: {
      type: "object",
      required: ["events", "trials", "rate", "upperBound"],
      properties: { events: int, trials: int, rate: num, upperBound: num },
    },
    calibration: {
      type: "object",
      required: [
        "inject",
        "comparisons",
        "runs",
        "perCase",
        "perComparison",
        "verdicts",
        "requiredRule",
      ],
      properties: {
        inject: num,
        comparisons: int,
        runs: {
          type: "array",
          items: { type: "array", items: { $ref: "#/$defs/caseComparison" } },
        },
        perCase: { $ref: "#/$defs/rate" },
        perComparison: { $ref: "#/$defs/rate" },
        verdicts: { type: "object" },
        requiredRule: {
          type: "object",
          required: ["applies", "met", "reason"],
          properties: { applies: { type: "boolean" }, met: { type: "boolean" }, reason: str },
        },
      },
    },
    reading: {
      type: "object",
      required: ["processes", "cases", "importCost"],
      properties: {
        processes: int,
        cases: { type: "array", items: { $ref: "#/$defs/caseReading" } },
        importCost: orNull({
          type: "object",
          required: [
            "runs",
            "coldImportMs",
            "medianMs",
            "p95Ms",
            "emptyImportMs",
            "emptyMedianMs",
            "files",
            "totalBytes",
            "totalGzipBytes",
          ],
          properties: {
            runs: int,
            coldImportMs: nums,
            medianMs: num,
            p95Ms: num,
            emptyImportMs: nums,
            emptyMedianMs: num,
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "bytes", "gzipBytes"],
                properties: { path: str, bytes: int, gzipBytes: int },
              },
            },
            totalBytes: int,
            totalGzipBytes: int,
          },
        }),
      },
    },
    caseReading: {
      type: "object",
      required: [
        "benchmark",
        "size",
        "inputsPerPass",
        "bytesPerPass",
        "throughput",
        "latency",
        "allocations",
        "peak",
        "longRun",
      ],
      properties: {
        benchmark: str,
        size: str,
        inputsPerPass: int,
        bytesPerPass: numOrNull,
        throughput: measuredOrSkipped({
          type: "object",
          required: ["status", "processes", "medianMsPerOp", "opsPerSecond", "bytesPerSecond"],
          properties: {
            status: { const: "measured" },
            processes: {
              type: "array",
              items: {
                type: "object",
                required: ["samplesMsPerOp", "medianMsPerOp"],
                properties: { samplesMsPerOp: nums, medianMsPerOp: num },
              },
            },
            medianMsPerOp: num,
            opsPerSecond: num,
            bytesPerSecond: numOrNull,
          },
        }),
        latency: orNull({
          type: "object",
          required: ["status", "calls", "timerOverheadNs", "p50Ns"],
          properties: {
            status: { enum: ["measured", "skipped"] },
            calls: int,
            timerOverheadNs: num,
            p50Ns: numOrNull,
            p95Ns: numOrNull,
            p99Ns: numOrNull,
            maxNs: num,
          },
        }),
        allocations: orNull(
          measuredOrSkipped({
            type: "object",
            required: ["status", "windowOps", "heapBytesPerOp", "externalBytesPerOp"],
            properties: {
              status: { const: "measured" },
              windowOps: int,
              heapBytesPerOp: num,
              externalBytesPerOp: num,
            },
          }),
        ),
        peak: orNull(
          measuredOrSkipped({
            type: "object",
            required: ["status", "calls", "peakHeapBytes", "medianPeakHeapBytes"],
            properties: {
              status: { const: "measured" },
              calls: int,
              peakHeapBytes: num,
              medianPeakHeapBytes: num,
            },
          }),
        ),
        longRun: orNull(
          measuredOrSkipped({
            type: "object",
            required: ["status", "verdict", "ops", "opsPerRound", "settledHeap", "slopeBytesPerOp"],
            properties: {
              status: { const: "measured" },
              verdict: { enum: ["flat", "growing"] },
              ops: int,
              opsPerRound: int,
              settledHeap: nums,
              slopeBytesPerOp: num,
            },
          }),
        ),
      },
    },
  },
} as const;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

function resolveRef(ref: string, root: Schema): Schema {
  const target = root.$defs?.[ref.replace("#/$defs/", "")];
  if (target === undefined) throw new Error(`schema has no definition ${ref}`);
  return target;
}

/**
 * Check a value against the subset of JSON Schema the results schema uses (`type`, `const`, `enum`,
 * `required`, `properties`, `items`, `minimum`, `oneOf`, `$ref` into `$defs`) and return every
 * problem, each with its JSON pointer. An empty list means the value conforms.
 *
 * @internal
 */
export function validate(value: unknown, schema: Schema, root: Schema = schema, at = ""): string[] {
  const problems: string[] = [];
  const here = at === "" ? "/" : at;
  if (typeof schema.$ref === "string")
    return validate(value, resolveRef(schema.$ref, root), root, at);
  if ("const" in schema && value !== schema.const)
    problems.push(`${here}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    problems.push(
      `${here}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`,
    );
  }
  if (schema.type !== undefined) {
    const types: readonly string[] = typeof schema.type === "string" ? [schema.type] : schema.type;
    if (!types.some((t) => typeMatches(value, t))) {
      problems.push(`${here}: must be ${types.join(" or ")}, is ${typeOf(value)}`);
      return problems;
    }
  }
  if (typeof value === "number" && value < (schema.minimum ?? -Infinity)) {
    problems.push(`${here}: must be at least ${String(schema.minimum)}`);
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) problems.push(`${here}: is missing "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in record) problems.push(...validate(record[key], sub, root, `${at}/${key}`));
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;
    value.forEach((item, i) => problems.push(...validate(item, items, root, `${at}/${String(i)}`)));
  }
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((s) => validate(value, s, root, at));
    const passing = results.filter((r) => r.length === 0).length;
    if (passing !== 1) {
      problems.push(
        `${here}: must match exactly one of ${String(results.length)} shapes, matches ${String(passing)}`,
      );
      // The nearest shape's problems say what to fix. With two or more matching, the nearest has
      // none, so this adds nothing.
      problems.push(...results.reduce((a, b) => (b.length < a.length ? b : a)));
    }
  }
  return problems;
}

/**
 * Parse and check a results document. Throws a `TypeError` listing every problem when the text is
 * not JSON, is a version this package does not read, or does not match the schema.
 *
 * @example
 * ```ts
 * import { readResults } from "@cosyte/bench";
 *
 * try {
 *   readResults('{"schemaVersion": 2}');
 * } catch (error) {
 *   String(error).includes("version 2"); // => true
 * }
 * ```
 */
export function readResults(text: string): ResultsDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("@cosyte/bench: the results are not JSON");
  }
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== SCHEMA_VERSION) {
    throw new TypeError(
      `@cosyte/bench: results version ${String(version)} is not one this package reads (${String(SCHEMA_VERSION)})`,
    );
  }
  const problems = validate(value, RESULTS_SCHEMA);
  if (problems.length > 0)
    throw new TypeError(
      `@cosyte/bench: the results do not match the schema:\n${problems.join("\n")}`,
    );
  return value as ResultsDocument;
}
