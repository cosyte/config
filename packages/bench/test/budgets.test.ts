import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BUDGETS_SCHEMA, checkBudgets, readBudgets, type Budgets } from "../src/budgets.js";
import { validate } from "../src/results.js";
import { importCost } from "./support/bodies.js";
import { here } from "./support/paths.js";
import { caseReading, readingDoc } from "./support/readings.js";

const budgets = (over: Partial<Budgets> = {}): Budgets => ({
  schemaVersion: 1,
  kind: "budgets",
  rules: [],
  ...over,
});

/** A 2 MiB input, one a pass, whose highest raw peak is 6 MiB: 3 times its input. */
const large = caseReading({
  size: "2 MiB",
  inputsPerPass: 1,
  bytesPerPass: 2 * 1024 * 1024,
  peak: {
    status: "measured",
    calls: 20,
    peakHeapBytes: 6 * 1024 * 1024,
    medianPeakHeapBytes: 5 * 1024 * 1024,
    peakTotalBytes: 6 * 1024 * 1024,
    medianPeakTotalBytes: 5 * 1024 * 1024,
    medianPeakTotalAboveFloorBytes: 1024,
  },
});

/** A 256 KiB input: the medium class. */
const medium = caseReading({ size: "256 KiB", inputsPerPass: 1, bytesPerPass: 256 * 1024 });

describe("the budgets schema", () => {
  it("is the file the package ships", () => {
    const shipped = JSON.parse(
      readFileSync(here("../schema/budgets-v1.schema.json"), "utf8"),
    ) as unknown;
    expect(shipped).toEqual(JSON.parse(JSON.stringify(BUDGETS_SCHEMA)));
  });

  it("reads a whole budgets file", () => {
    const text = JSON.stringify({
      $schema:
        "https://github.com/cosyte/config/blob/main/packages/bench/schema/budgets-v1.schema.json",
      schemaVersion: 1,
      kind: "budgets",
      description: "Proposed; approved in review.",
      rules: [
        {
          benchmark: "parse",
          size: "1 KiB",
          peakMultiple: { small: 20, medium: 20, large: 3 },
          allocBytesPerOp: 4096,
          minBytesPerSecond: 1_000_000,
          minOpsPerSecond: 100,
        },
      ],
      import: { maxColdImportMs: 15, maxGzipBytes: 40_000 },
    });
    expect(readBudgets(text).rules[0]?.peakMultiple?.large).toBe(3);
  });

  it("refuses a key it does not know, so a mistyped budget is never a limit nobody checks", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      kind: "budgets",
      rules: [{ peakMultipel: { small: 20 } }],
    });
    expect(() => readBudgets(text)).toThrow(
      '/rules/0: has "peakMultipel", which is not a known field',
    );
    expect(() =>
      readBudgets(JSON.stringify({ schemaVersion: 1, kind: "budgets", rules: [], extra: 1 })),
    ).toThrow('/: has "extra", which is not a known field');
  });

  it("refuses every key of an object whose schema allows none", () => {
    expect(validate({ a: 1 }, { type: "object", additionalProperties: false })).toEqual([
      '/: has "a", which is not a known field',
    ]);
  });

  it("refuses text that is not JSON, another version, and a negative limit", () => {
    expect(() => readBudgets("{")).toThrow("@cosyte/bench: the budgets file is not JSON");
    expect(() => readBudgets('{"schemaVersion": 2}')).toThrow(
      "budgets file version 2 is not one this package reads (1)",
    );
    expect(() => readBudgets("null")).toThrow("budgets file version undefined");
    expect(() =>
      readBudgets(
        JSON.stringify({ schemaVersion: 1, kind: "budgets", rules: [{ allocBytesPerOp: -1 }] }),
      ),
    ).toThrow("/rules/0/allocBytesPerOp: must be at least 0");
  });
});

describe("checkBudgets", () => {
  it("holds a reading within every limit, counting each limit it checked", () => {
    const result = checkBudgets(
      readingDoc(),
      budgets({
        rules: [
          {
            peakMultiple: { small: 6 },
            allocBytesPerOp: 2048,
            minBytesPerSecond: 2_048_000,
            minOpsPerSecond: 2000,
          },
        ],
        import: { maxColdImportMs: 2.5, maxGzipBytes: 900 },
      }),
    );
    // Each limit holds at exactly its value: 6 times, 2,048 bytes, the throughputs and the import.
    expect(result).toEqual({ findings: [], checked: 6 });
  });

  it("finds each limit broken past its value", () => {
    const { findings } = checkBudgets(
      readingDoc(),
      budgets({
        rules: [
          {
            peakMultiple: { small: 5.99 },
            allocBytesPerOp: 2047,
            minBytesPerSecond: 2_048_001,
            minOpsPerSecond: 2001,
          },
        ],
        import: { maxColdImportMs: 2.49, maxGzipBytes: 899 },
      }),
    );
    expect(findings).toEqual([
      {
        kind: "breach",
        message:
          "parse @ 1 KiB: peak 6.0 KiB is 6.00 times its 1.0 KiB input, over the small budget of 5.99 times",
      },
      {
        kind: "breach",
        message: "parse @ 1 KiB: allocates 2048 bytes an operation, over the budget of 2047",
      },
      {
        kind: "breach",
        message: "parse @ 1 KiB: 2048000 bytes a second, under the budget of 2048001",
      },
      {
        kind: "breach",
        message: "parse @ 1 KiB: 2000 operations a second, under the budget of 2001",
      },
      {
        kind: "breach",
        message: "the median cold import took 2.50 ms, over the budget of 2.49 ms",
      },
      { kind: "breach", message: "the import loads 900 B gzipped, over the budget of 899 B" },
    ]);
  });

  it("reads the peak budget by size class: small, medium and large", () => {
    const doc = readingDoc([caseReading(), medium, large]);
    // The small case reads 6 times, the medium its raw 40,000 bytes over 256 KiB (0.15 times), and
    // the large its raw 6 MiB over 2 MiB, 3 times.
    expect(checkBudgets(doc, budgets({ rules: [{ peakMultiple: { large: 2.5 } }] }))).toEqual({
      findings: [
        {
          kind: "breach",
          message:
            "parse @ 2 MiB: peak 6.00 MiB is 3.00 times its 2.00 MiB input, over the large budget of 2.5 times",
        },
      ],
      checked: 1,
    });
    expect(checkBudgets(doc, budgets({ rules: [{ peakMultiple: { medium: 0.1 } }] }))).toEqual({
      findings: [
        {
          kind: "breach",
          message:
            "parse @ 256 KiB: peak 39.1 KiB is 0.15 times its 256.0 KiB input, over the medium budget of 0.1 times",
        },
      ],
      checked: 1,
    });
    expect(
      checkBudgets(doc, budgets({ rules: [{ peakMultiple: { small: 6, medium: 1, large: 3 } }] })),
    ).toEqual({ findings: [], checked: 3 });
  });

  it("applies a rule only to the benchmark and size it names, and every rule that matches", () => {
    const doc = readingDoc([caseReading(), caseReading({ benchmark: "build" }), large]);
    const { findings, checked } = checkBudgets(
      doc,
      budgets({
        rules: [
          { minOpsPerSecond: 1 },
          { benchmark: "build", minOpsPerSecond: 3000 },
          { benchmark: "parse", size: "2 MiB", minOpsPerSecond: 3000 },
        ],
      }),
    );
    expect(checked).toBe(5);
    expect(findings.map((f) => f.message)).toEqual([
      "build @ 1 KiB: 2000 operations a second, under the budget of 3000",
      "parse @ 2 MiB: 2000 operations a second, under the budget of 3000",
    ]);
  });

  it("calls a rule that matches no case unjudged, never a quiet pass", () => {
    expect(
      checkBudgets(readingDoc(), budgets({ rules: [{ benchmark: "gone", size: "1 MiB" }] })),
    ).toEqual({
      findings: [
        {
          kind: "unjudged",
          message: "rule 1 (benchmark gone, size 1 MiB) matches no case in the reading",
        },
      ],
      checked: 1,
    });
    expect(checkBudgets(readingDoc([]), budgets({ rules: [{}] })).findings[0]?.message).toBe(
      "rule 1 (benchmark any, size any) matches no case in the reading",
    );
  });

  it("calls every limit whose measure was skipped or absent unjudged", () => {
    const skipped = caseReading({
      bytesPerPass: null,
      throughput: { status: "skipped", reason: "warmup-unstable" },
      allocations: { status: "skipped", reason: "allocation-window-gc" },
      peak: null,
    });
    const rule = {
      peakMultiple: { small: 20 },
      allocBytesPerOp: 1,
      minBytesPerSecond: 1,
      minOpsPerSecond: 1,
    };
    expect(checkBudgets(readingDoc([skipped]), budgets({ rules: [rule] })).findings).toEqual([
      {
        kind: "unjudged",
        message:
          "parse @ 1 KiB: its suite gave no byte count, so its peak cannot be read as a multiple of its input",
      },
      {
        kind: "unjudged",
        message: "parse @ 1 KiB: its allocations were not measured (allocation-window-gc)",
      },
      {
        kind: "unjudged",
        message: "parse @ 1 KiB: its throughput was not measured (warmup-unstable)",
      },
      {
        kind: "unjudged",
        message: "parse @ 1 KiB: its throughput was not measured (warmup-unstable)",
      },
    ]);
    const unmeasured = caseReading({
      allocations: null,
      peak: null,
      throughput: {
        status: "measured",
        processes: [],
        medianMsPerOp: 1,
        opsPerSecond: 1000,
        bytesPerSecond: null,
      },
    });
    expect(
      checkBudgets(readingDoc([unmeasured]), budgets({ rules: [rule] })).findings.map(
        (f) => f.message,
      ),
    ).toEqual([
      "parse @ 1 KiB: its peak was not measured",
      "parse @ 1 KiB: its allocations were not measured",
      "parse @ 1 KiB: its suite gave no byte count, so it has no bytes a second",
    ]);
  });

  it("checks no peak for a size class the rule leaves out", () => {
    expect(
      checkBudgets(readingDoc([large]), budgets({ rules: [{ peakMultiple: { small: 1 } }] })),
    ).toEqual({ findings: [], checked: 0 });
  });

  it("calls an import budget unjudged when the import was not measured", () => {
    const doc = readingDoc([caseReading()], { importCost: null });
    expect(
      checkBudgets(doc, budgets({ import: { maxColdImportMs: 15, maxGzipBytes: 1 } })),
    ).toEqual({
      findings: [
        { kind: "unjudged", message: "the cold import was not measured" },
        { kind: "unjudged", message: "the gzipped size was not measured" },
      ],
      checked: 2,
    });
    expect(checkBudgets(doc, budgets({ import: {} }))).toEqual({ findings: [], checked: 0 });
    expect(importCost.totalGzipBytes).toBe(900);
  });
});
