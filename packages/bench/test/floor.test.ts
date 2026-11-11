import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FLOOR_SCHEMA,
  checkFloor,
  loosenedFloor,
  readFloor,
  recordFloor,
  type Floor,
  type FloorCase,
} from "../src/floor.js";
import { importCost } from "./support/bodies.js";
import { here } from "./support/paths.js";
import { caseReading, readingDoc } from "./support/readings.js";

/** A case at `ms` milliseconds an operation, with `alloc` heap bytes allocated an operation. */
const at = (ms: number, alloc = 2000, over: Parameters<typeof caseReading>[0] = {}) =>
  caseReading({
    throughput: {
      status: "measured",
      processes: [{ samplesMsPerOp: [ms], medianMsPerOp: ms }],
      medianMsPerOp: ms,
      opsPerSecond: 1000 / ms,
      bytesPerSecond: null,
    },
    allocations: {
      status: "measured",
      windowOps: 64,
      heapBytesPerOp: alloc,
      externalBytesPerOp: 0,
    },
    ...over,
  });

const withImport = (medianMs: number, gzip = 900) => ({
  ...importCost,
  medianMs,
  totalGzipBytes: gzip,
});

/** An A/A set: three readings of one commit, 0.50, 0.55 and 0.52 ms an operation. */
const aa = () => [
  readingDoc([at(0.5, 2000)], { importCost: withImport(2.5) }),
  readingDoc([at(0.55, 2100)], { importCost: withImport(3) }),
  readingDoc([at(0.52, 2050)], { importCost: withImport(2.7) }),
];

const floor = (): Floor => recordFloor(aa());

describe("the floor schema", () => {
  it("is the file the package ships", () => {
    const shipped = JSON.parse(
      readFileSync(here("../schema/floor-v1.schema.json"), "utf8"),
    ) as unknown;
    expect(shipped).toEqual(JSON.parse(JSON.stringify(FLOOR_SCHEMA)));
  });

  it("reads a recorded floor back, through JSON", () => {
    const f = floor();
    expect(readFloor(JSON.stringify(f))).toEqual(f);
    expect(readFloor(JSON.stringify({ ...f, import: null })).import).toBeNull();
  });

  it("refuses a field it does not know, a negative noise, and another version", () => {
    const f = floor();
    expect(() => readFloor(JSON.stringify({ ...f, tolerance: 1 }))).toThrow(
      '/: has "tolerance", which is not a known field',
    );
    const bad = { ...f, cases: [{ ...f.cases[0], msPerOp: { value: 1, noise: -1 } }] };
    expect(() => readFloor(JSON.stringify(bad))).toThrow(
      "/cases/0/msPerOp: must match exactly one of 2 shapes, matches 0",
    );
    expect(() => readFloor('{"schemaVersion": 3}')).toThrow(
      "floor file version 3 is not one this package reads (1)",
    );
  });
});

describe("recordFloor", () => {
  it("keeps the highest of an A/A set and the spread between its highest and lowest", () => {
    expect(floor()).toEqual({
      schemaVersion: 1,
      kind: "floor",
      suite: "@cosyte/example parse",
      runnerClass: "github-actions-github-hosted-ubuntu24-x64",
      nodeMajor: 24,
      commit: "abc123",
      readings: 3,
      cases: [
        {
          benchmark: "parse",
          size: "1 KiB",
          msPerOp: { value: 0.55, noise: 0.05 },
          // The peak a budget reads: the median call above the empty-call floor, the same in each.
          peakBytes: { value: 6144, noise: 0 },
          allocBytesPerOp: { value: 2100, noise: 100 },
        },
      ],
      import: { medianMs: { value: 3, noise: 0.5 }, gzipBytes: { value: 900, noise: 0 } },
    });
  });

  it("keeps no floor for a measure any reading of the set did not measure", () => {
    const docs = aa();
    docs[1] = readingDoc(
      [
        at(0.55, 2100, { allocations: null, peak: { status: "skipped", reason: "gc-unsettled" } }),
        caseReading({ size: "32 KiB" }),
      ],
      { importCost: null },
    );
    const f = recordFloor(docs);
    expect(f.cases).toEqual([
      {
        benchmark: "parse",
        size: "1 KiB",
        msPerOp: { value: 0.55, noise: 0.05 },
        peakBytes: null,
        allocBytesPerOp: null,
      },
      // In one reading only: the other two did not measure it at all.
      { benchmark: "parse", size: "32 KiB", msPerOp: null, peakBytes: null, allocBytesPerOp: null },
    ]);
    expect(f.import).toBeNull();
    const skippedTiming = aa();
    skippedTiming[0] = readingDoc([
      at(0.5, 2000, { throughput: { status: "skipped", reason: "warmup-unstable" } }),
    ]);
    expect(recordFloor(skippedTiming).cases[0]?.msPerOp).toBeNull();
  });

  it("refuses fewer readings than the standard's minimum", () => {
    expect(() => recordFloor(aa().slice(0, 2))).toThrow(
      "a floor is recorded from at least 3 readings of one commit, and 2 were given",
    );
  });

  it("refuses a reading from anywhere but a GitHub-hosted runner", () => {
    const docs = aa();
    docs[2] = readingDoc([at(0.5)], {
      runner: { ci: false, provider: null, environment: null, class: "local-linux-x64" },
    });
    expect(() => recordFloor(docs)).toThrow(
      "the reading was taken on local-linux-x64, not a GitHub-hosted runner",
    );
    docs[2] = readingDoc([at(0.5)], {
      runner: { environment: "self-hosted", class: "github-actions-self-hosted-ubuntu24-x64" },
    });
    expect(() => recordFloor(docs)).toThrow("not a GitHub-hosted runner");
  });

  it("refuses readings of different commits, suites, runner classes or Node lines", () => {
    const differ = (over: Parameters<typeof readingDoc>[1], field: string) => {
      const docs = aa();
      docs[1] = readingDoc([at(0.5)], over);
      expect(() => recordFloor(docs)).toThrow(`the readings differ in ${field}`);
    };
    differ({ commit: "def456" }, "commit");
    differ({ suite: "@cosyte/example build" }, "suite");
    differ({ runner: { class: "github-actions-github-hosted-ubuntu26-x64" } }, "runnerClass");
    differ({ node: "v22.15.0" }, "nodeMajor");
  });

  it("tightens an existing floor and never loosens it", () => {
    const old = floor();
    const faster = [
      readingDoc([at(0.4, 2500), caseReading({ size: "32 KiB" })], {
        importCost: withImport(4, 800),
      }),
      readingDoc([at(0.45, 2600), caseReading({ size: "32 KiB" })], {
        importCost: withImport(4, 800),
      }),
      readingDoc([at(0.42, 2550), caseReading({ size: "32 KiB" })], {
        importCost: withImport(4, 800),
      }),
    ];
    const next = recordFloor(faster, old);
    expect(next.cases).toEqual([
      {
        benchmark: "parse",
        size: "1 KiB",
        // Faster: the value falls to the new set's highest; the noise stays the floor's own.
        msPerOp: { value: 0.45, noise: 0.05 },
        peakBytes: { value: 6144, noise: 0 },
        // More allocation: the floor keeps its lower value.
        allocBytesPerOp: { value: 2100, noise: 100 },
      },
      {
        benchmark: "parse",
        size: "32 KiB",
        msPerOp: { value: 0.5, noise: 0 },
        peakBytes: { value: 6144, noise: 0 },
        allocBytesPerOp: { value: 2048, noise: 0 },
      },
    ]);
    expect(next.import).toEqual({
      medianMs: { value: 3, noise: 0.5 },
      gzipBytes: { value: 800, noise: 0 },
    });
    expect(loosenedFloor(old, next)).toEqual([]);
  });

  it("keeps an old case, an old measure and the old import the new set did not measure", () => {
    const old = floor();
    const docs = [0, 1, 2].map(() =>
      readingDoc([caseReading({ size: "32 KiB", allocations: null })], { importCost: null }),
    );
    const next = recordFloor(docs, old);
    expect(next.cases[0]).toEqual(old.cases[0]);
    expect(next.cases[1]?.allocBytesPerOp).toBeNull();
    expect(next.import).toEqual(old.import);
    const unmeasured = recordFloor(
      [0, 1, 2].map(() => readingDoc([at(0.5, 2000, { allocations: null })])),
      old,
    );
    expect(unmeasured.cases[0]?.allocBytesPerOp).toEqual({ value: 2100, noise: 100 });
    const gained = recordFloor(aa(), {
      ...old,
      import: null,
      cases: [{ ...(old.cases[0] as FloorCase), peakBytes: null }],
    });
    expect(gained.import).toEqual(old.import);
    expect(gained.cases[0]?.peakBytes).toEqual({ value: 6144, noise: 0 });
  });

  it("refuses to tighten a floor of another suite, runner class or Node line", () => {
    const old = floor();
    for (const field of ["suite", "runnerClass", "nodeMajor"] as const) {
      const other = { ...old, [field]: field === "nodeMajor" ? 22 : "other" };
      expect(() => recordFloor(aa(), other)).toThrow(`the floor's ${field} is`);
    }
  });
});

describe("checkFloor", () => {
  it("passes a reading at the floor's value plus its noise, and counts each measure", () => {
    const doc = readingDoc([at(0.6, 2200)], { importCost: withImport(3.5) });
    expect(checkFloor(doc, floor())).toEqual({ findings: [], checked: 5 });
  });

  it("finds a measure above the floor's value plus its noise a regression", () => {
    const doc = readingDoc(
      [
        at(0.61, 2201, {
          peak: {
            status: "measured",
            calls: 20,
            peakHeapBytes: 1,
            medianPeakHeapBytes: 1,
            medianPeakTotalAboveFloorBytes: 6145,
          },
        }),
      ],
      { importCost: withImport(3.51, 901) },
    );
    expect(checkFloor(doc, floor()).findings).toEqual([
      {
        kind: "regression",
        message:
          "parse @ 1 KiB: ms an operation 0.61, above the floor's 0.55 and its measured noise of 0.05",
      },
      {
        kind: "regression",
        message:
          "parse @ 1 KiB: peak bytes 6145, above the floor's 6144 and its measured noise of 0",
      },
      {
        kind: "regression",
        message:
          "parse @ 1 KiB: bytes allocated an operation 2201, above the floor's 2100 and its measured noise of 100",
      },
      {
        kind: "regression",
        message:
          "import: median cold import, ms 3.51, above the floor's 3 and its measured noise of 0.5",
      },
      {
        kind: "regression",
        message:
          "import: gzipped bytes loaded 901, above the floor's 900 and its measured noise of 0",
      },
    ]);
  });

  it("calls a case or a measure the floor keeps and the reading lacks unjudged", () => {
    expect(checkFloor(readingDoc([], { importCost: null }), floor()).findings).toEqual([
      {
        kind: "unjudged",
        message: "parse @ 1 KiB: the floor keeps it and the reading has no such case",
      },
      { kind: "unjudged", message: "import: median cold import, ms was not measured" },
      { kind: "unjudged", message: "import: gzipped bytes loaded was not measured" },
    ]);
    const skipped = at(0.5, 2000, { throughput: { status: "skipped", reason: "warmup-unstable" } });
    expect(checkFloor(readingDoc([skipped]), floor()).findings).toEqual([
      { kind: "unjudged", message: "parse @ 1 KiB: ms an operation was not measured" },
    ]);
  });

  it("judges nothing it keeps no floor for: a new case, a measure without a floor, no import", () => {
    const f: Floor = {
      ...floor(),
      import: null,
      cases: [
        {
          benchmark: "parse",
          size: "1 KiB",
          msPerOp: null,
          peakBytes: null,
          allocBytesPerOp: null,
        },
      ],
    };
    const doc = readingDoc([at(9), caseReading({ size: "1 MiB" })], { importCost: null });
    expect(checkFloor(doc, f)).toEqual({ findings: [], checked: 0 });
  });

  it("compares no reading of another suite, runner class or Node line", () => {
    const doc = readingDoc([at(0.5)], {
      suite: "@cosyte/example build",
      node: "v26.1.0",
      runner: { class: "github-actions-github-hosted-ubuntu26-x64" },
    });
    expect(checkFloor(doc, floor())).toEqual({
      findings: [
        {
          kind: "unjudged",
          message:
            "the reading's suite is @cosyte/example build and the floor's is @cosyte/example parse: they are not compared",
        },
        {
          kind: "unjudged",
          message:
            "the reading's runnerClass is github-actions-github-hosted-ubuntu26-x64 and the floor's is github-actions-github-hosted-ubuntu24-x64: they are not compared",
        },
        {
          kind: "unjudged",
          message: "the reading's nodeMajor is 26 and the floor's is 24: they are not compared",
        },
      ],
      checked: 0,
    });
  });
});

describe("loosenedFloor", () => {
  it("finds nothing in the same floor or a tighter one", () => {
    const f = floor();
    expect(loosenedFloor(f, f)).toEqual([]);
    const tighter = {
      ...f,
      cases: [{ ...(f.cases[0] as FloorCase), msPerOp: { value: 0.5, noise: 0.01 } }],
    };
    expect(loosenedFloor(f, tighter)).toEqual([]);
    // A measure the base kept no floor for may gain one.
    const unkept = {
      ...f,
      cases: [{ ...(f.cases[0] as FloorCase), allocBytesPerOp: null }],
    };
    expect(loosenedFloor(unkept, f)).toEqual([]);
  });

  it("finds a value or a noise raised, a measure or a case gone, and the import gone", () => {
    const f = floor();
    const first = f.cases[0] as FloorCase;
    expect(
      loosenedFloor(f, {
        ...f,
        cases: [
          {
            ...first,
            msPerOp: { value: 0.56, noise: 0.05 },
            peakBytes: { value: 6144, noise: 1 },
            allocBytesPerOp: null,
          },
        ],
        import: null,
      }).map((x) => x.message),
    ).toEqual([
      "parse @ 1 KiB: ms an operation rose from 0.55 (noise 0.05) to 0.56 (noise 0.05)",
      "parse @ 1 KiB: peak bytes rose from 6144 (noise 0) to 6144 (noise 1)",
      "parse @ 1 KiB: bytes allocated an operation has no floor any more",
      "import: median cold import, ms has no floor any more",
      "import: gzipped bytes loaded has no floor any more",
    ]);
    expect(loosenedFloor(f, { ...f, cases: [] })).toEqual([
      { kind: "loosened", message: "parse @ 1 KiB: the floor no longer keeps it" },
    ]);
    expect(loosenedFloor({ ...f, import: null }, { ...f, import: null })).toEqual([]);
  });

  it("finds a floor recorded for another suite, runner class or Node line", () => {
    const f = floor();
    expect(
      loosenedFloor(f, { ...f, suite: "other", runnerClass: "other", nodeMajor: 26 }).map(
        (x) => x.message,
      ),
    ).toEqual([
      "the floor's suite changed from @cosyte/example parse to other: a floor recorded afresh is not compared with its base",
      "the floor's runnerClass changed from github-actions-github-hosted-ubuntu24-x64 to other: a floor recorded afresh is not compared with its base",
      "the floor's nodeMajor changed from 24 to 26: a floor recorded afresh is not compared with its base",
    ]);
  });
});
