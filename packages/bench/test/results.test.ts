import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { summarizeCalibration, type ComparisonBody } from "../src/compare.js";
import type { ReadingBody } from "../src/reading.js";
import {
  RESULTS_SCHEMA,
  SCHEMA_VERSION,
  documentBase,
  readResults,
  toolVersion,
  validate,
  type ResultsDocument,
} from "../src/results.js";
import { caseComparison, env, importCost } from "./support/bodies.js";
import { here } from "./support/paths.js";

const base = documentBase(
  { name: "suite", file: "bench/suite.mjs" },
  env,
  new Date("2026-11-10T00:00:00Z"),
);

const reading: ReadingBody = {
  processes: 3,
  importCost,
  cases: [
    {
      benchmark: "scan",
      size: "1 KiB",
      inputsPerPass: 4,
      bytesPerPass: 4096,
      throughput: {
        status: "measured",
        processes: [{ samplesMsPerOp: [1, 1], medianMsPerOp: 1 }],
        medianMsPerOp: 1,
        opsPerSecond: 1000,
        bytesPerSecond: 1_024_000,
      },
      latency: {
        status: "measured",
        calls: 1000,
        timerOverheadNs: 40,
        p50Ns: 1000,
        p95Ns: 1200,
        p99Ns: null,
        maxNs: 3000,
      },
      allocations: {
        status: "measured",
        windowOps: 64,
        heapBytesPerOp: 100,
        externalBytesPerOp: 0,
      },
      peak: { status: "skipped", reason: "gc-unsettled" },
      longRun: null,
    },
    {
      benchmark: "scan",
      size: "4 MiB",
      inputsPerPass: 1,
      bytesPerPass: null,
      throughput: { status: "skipped", reason: "warmup-unstable" },
      latency: {
        status: "skipped",
        reason: "latency-below-timer-resolution",
        calls: 20,
        timerOverheadNs: 40,
        p50Ns: 100,
      },
      allocations: null,
      peak: null,
      longRun: {
        status: "measured",
        verdict: "flat",
        ops: 10,
        opsPerRound: 1,
        settledHeap: [1],
        slopeBytesPerOp: 0,
        growthBytes: 0,
        detectableBytesPerOp: 1,
      },
    },
  ],
};

const comparison: ComparisonBody = {
  rounds: 12,
  threshold: 0.03,
  alpha: 0.05,
  inject: 0,
  cases: [
    caseComparison(),
    caseComparison({
      interval: null,
      medianRatio: null,
      verdict: "skipped",
      skipReason: "base: warmup-unstable",
    }),
  ],
};

const docs: ResultsDocument[] = [
  { ...base, kind: "reading", subject: { target: "dist/index.mjs", commit: "abc123" }, reading },
  {
    ...base,
    kind: "comparison",
    base: { target: "base/index.mjs", commit: null },
    head: { target: "dist/index.mjs", commit: "abc" },
    comparison,
  },
  {
    ...base,
    kind: "calibration",
    base: { target: "a.mjs", commit: null },
    head: { target: "b.mjs", commit: null },
    calibration: summarizeCalibration(0, [[caseComparison({ verdict: "no-regression" })]]),
  },
];

describe("the results schema", () => {
  it("is the file the package ships, byte for byte in content", () => {
    const shipped = JSON.parse(
      readFileSync(here("../schema/results-v1.schema.json"), "utf8"),
    ) as unknown;
    expect(shipped).toEqual(JSON.parse(JSON.stringify(RESULTS_SCHEMA)));
  });

  it.each(docs.map((d) => [d.kind, d] as const))(
    "accepts a %s document, through JSON and back",
    (_kind, doc) => {
      expect(validate(JSON.parse(JSON.stringify(doc)), RESULTS_SCHEMA)).toEqual([]);
      expect(readResults(JSON.stringify(doc))).toEqual(JSON.parse(JSON.stringify(doc)));
    },
  );

  it("accepts the fields added within version 1, and checks their types", () => {
    const first = reading.cases[0];
    if (first === undefined) throw new Error("a case");
    const added = {
      ...first,
      throughput: {
        status: "measured",
        processes: [{ samplesMsPerOp: [1, 1], medianMsPerOp: 1, plan: "large" }],
        medianMsPerOp: 1,
        opsPerSecond: 1000,
        bytesPerSecond: 1_024_000,
      },
      allocations: {
        status: "measured",
        method: "gc-accounted",
        collections: 2,
        windowOps: 1,
        heapBytesPerOp: 100,
        externalBytesPerOp: 0,
      },
      peak: {
        status: "measured",
        calls: 20,
        peakHeapBytes: 10,
        medianPeakHeapBytes: 5,
        peakExternalBytes: 20,
        medianPeakExternalBytes: 10,
        peakTotalBytes: 30,
        medianPeakTotalBytes: 15,
      },
    };
    const doc = { ...docs[0], reading: { ...reading, cases: [added] } };
    expect(validate(JSON.parse(JSON.stringify(doc)), RESULTS_SCHEMA)).toEqual([]);
    const compared = {
      ...docs[1],
      comparison: {
        ...comparison,
        cases: [{ ...caseComparison(), basePlans: ["standard"], headPlans: ["large"] }],
      },
    };
    expect(validate(JSON.parse(JSON.stringify(compared)), RESULTS_SCHEMA)).toEqual([]);
    const wrong = (field: "peak" | "allocations", change: Record<string, unknown>) =>
      validate(
        JSON.parse(
          JSON.stringify({
            ...doc,
            reading: { ...reading, cases: [{ ...added, [field]: { ...added[field], ...change } }] },
          }),
        ),
        RESULTS_SCHEMA,
      );
    const shapes = (field: string) =>
      `/reading/cases/0/${field}: must match exactly one of 2 shapes, matches 0`;
    expect(wrong("peak", { peakTotalBytes: "30" })).toContain(shapes("peak"));
    expect(wrong("peak", { medianPeakExternalBytes: null })).toContain(shapes("peak"));
    expect(wrong("allocations", { method: "guessed" })).toContain(shapes("allocations"));
    expect(wrong("allocations", { collections: -1 })).toContain(shapes("allocations"));
    const badProcess = {
      ...doc,
      reading: {
        ...reading,
        cases: [
          {
            ...added,
            throughput: {
              ...added.throughput,
              processes: [{ ...added.throughput.processes[0], plan: "fast" }],
            },
          },
        ],
      },
    };
    expect(validate(JSON.parse(JSON.stringify(badProcess)), RESULTS_SCHEMA)).toContain(
      '/reading/cases/0/throughput/processes/0/plan: must be one of "standard", "large"',
    );
    const badPlan = {
      ...compared,
      comparison: { ...comparison, cases: [{ ...caseComparison(), headPlans: ["fast"] }] },
    };
    expect(validate(JSON.parse(JSON.stringify(badPlan)), RESULTS_SCHEMA)).toContain(
      '/comparison/cases/0/headPlans/0: must be one of "standard", "large"',
    );
  });

  it("records the tool, its version, the time and the constants", () => {
    expect(base).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      tool: { name: "@cosyte/bench", version: toolVersion() },
      createdAt: "2026-11-10T00:00:00.000Z",
    });
    expect(toolVersion()).toBe(
      (JSON.parse(readFileSync(here("../package.json"), "utf8")) as { version: string }).version,
    );
    expect(base.contract.bench.ROUNDS).toBe(12);
    expect(base.contract.warmup.MIN_MS).toBe(500);
    expect(documentBase({ name: "s", file: "f" }, env).createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

describe("validate", () => {
  it("names each problem with its pointer", () => {
    const doc = JSON.parse(JSON.stringify(docs[0])) as Record<string, unknown>;
    delete doc["environment"];
    (doc["tool"] as Record<string, unknown>)["name"] = "other";
    expect(validate(doc, RESULTS_SCHEMA)).toEqual([
      '/: is missing "environment"',
      '/tool/name: must be "@cosyte/bench"',
    ]);
  });

  it("checks types, integers, minimums, enums, items and nested references", () => {
    const schema = {
      type: "object",
      properties: {
        n: { type: "integer", minimum: 0 },
        x: { type: "number" },
        s: { type: ["string", "null"] },
        e: { enum: ["a", "b"] },
        list: { type: "array", items: { $ref: "#/$defs/item" } },
      },
      $defs: { item: { type: "boolean" } },
    } as const;
    expect(validate({ n: 1, x: 1, s: null, e: "a", list: [true] }, schema)).toEqual([]);
    expect(validate({ n: 1.5, x: "1", s: 3, e: "c", list: [true, 1] }, schema)).toEqual([
      "/n: must be integer, is number",
      "/x: must be number, is string",
      "/s: must be string or null, is integer",
      '/e: must be one of "a", "b"',
      "/list/1: must be boolean, is integer",
    ]);
    expect(validate({ n: -1 }, schema)).toEqual(["/n: must be at least 0"]);
    expect(validate([], schema)).toEqual(["/: must be object, is array"]);
    expect(validate({ x: 2 }, { properties: { x: { minimum: 3 } } })).toEqual([
      "/x: must be at least 3",
    ]);
    expect(validate("a", { minimum: 3 })).toEqual([]);
  });

  it("applies object and array keywords only to objects and arrays", () => {
    const objectish = { required: ["a"], properties: { a: { type: "string" } } } as const;
    expect(validate("x", objectish)).toEqual([]);
    expect(validate(null, objectish)).toEqual([]);
    expect(validate([], objectish)).toEqual([]);
    expect(validate({}, { items: { type: "string" } })).toEqual([]);
    expect(validate([1], {})).toEqual([]);
    expect(validate(["a", 1], { items: { type: "string" } })).toEqual([
      "/1: must be string, is integer",
    ]);
  });

  it("applies minimum to numbers only", () => {
    expect(validate("1", { minimum: 3 })).toEqual([]);
    expect(validate(null, { minimum: 3 })).toEqual([]);
    expect(validate(2.5, { minimum: 3 })).toEqual(["/: must be at least 3"]);
    expect(validate(3, { minimum: 3 })).toEqual([]);
    expect(validate(-5, {})).toEqual([]);
  });

  it("needs exactly one oneOf shape, and shows the nearest one's problems when none fits", () => {
    const schema = {
      oneOf: [
        { type: "object", required: ["a", "b", "c"] },
        { type: "object", required: ["a", "b"] },
        { type: "string" },
      ],
    } as const;
    expect(validate("x", schema)).toEqual([]);
    expect(validate({ a: 1 }, schema)).toEqual([
      "/: must match exactly one of 3 shapes, matches 0",
      '/: is missing "b"',
    ]);
    expect(validate({ a: 1, b: 2, c: 3 }, schema)).toEqual([
      "/: must match exactly one of 3 shapes, matches 2",
    ]);
  });

  it("refuses a reference to a definition that does not exist", () => {
    expect(() => validate(1, { $ref: "#/$defs/missing" })).toThrow(
      "schema has no definition #/$defs/missing",
    );
  });
});

describe("readResults", () => {
  it("refuses text that is not JSON", () => {
    expect(() => readResults("{")).toThrow("@cosyte/bench: the results are not JSON");
  });

  it("refuses another version, naming it", () => {
    expect(() => readResults('{"schemaVersion": 2}')).toThrow(
      "@cosyte/bench: results version 2 is not one this package reads (1)",
    );
    expect(() => readResults("null")).toThrow("results version undefined");
  });

  it("refuses a document that does not match, listing every problem", () => {
    const doc = JSON.parse(JSON.stringify(docs[1])) as Record<string, unknown>;
    delete doc["comparison"];
    expect(() => readResults(JSON.stringify(doc))).toThrow(
      /^@cosyte\/bench: the results do not match the schema:\n\/: must match exactly one of 3 shapes, matches 0\n\/: is missing "comparison"$/,
    );
  });
});
