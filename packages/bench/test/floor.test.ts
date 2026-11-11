import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BENCH_CONTRACT } from "../src/contract.js";
import {
  FLOOR_SCHEMA,
  checkFloor,
  floorLimit,
  loosenedFloor,
  readFloor,
  recordFloor,
  type Floor,
  type FloorCase,
  type FloorValue,
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

/**
 * An A/A set: seven readings of one commit. Milliseconds an operation 0.50 to 0.55, allocations
 * 2,000 to 2,100 bytes, the cold import 2.5 to 3 ms, the gzipped bytes 900 in each.
 */
const MS = [0.5, 0.55, 0.52, 0.51, 0.53, 0.54, 0.5];
const ALLOC = [2000, 2100, 2050, 2000, 2000, 2000, 2000];
const IMPORT_MS = [2.5, 3, 2.7, 2.5, 2.5, 2.5, 2.5];
const aa = () =>
  MS.map((ms, i) =>
    readingDoc([at(ms, ALLOC[i])], { importCost: withImport(IMPORT_MS[i] as number) }),
  );

/** Seven readings, each built by `make`. */
const seven = (make: (i: number) => ReturnType<typeof readingDoc>) =>
  Array.from({ length: 7 }, (_, i) => make(i));

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
      readings: 7,
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
    expect(() => recordFloor(aa().slice(0, 6))).toThrow(
      "a floor is recorded from at least 7 readings of one commit, and 6 were given",
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

  it("takes a new set only where its whole limit is below the old set's lowest reading", () => {
    const old = floor();
    // Old limits: 0.55 + 3 x 0.05 = 0.70 ms, lowest 0.50; allocations 2,100 + 300, lowest 2,000;
    // the import 3 + 1.5 ms, lowest 2.5; the gzipped bytes 900 exactly.
    const faster = seven((i) =>
      readingDoc([at(0.3 + (i % 3) / 100, 2500), caseReading({ size: "32 KiB" })], {
        importCost: withImport(4, 800),
      }),
    );
    const next = recordFloor(faster, old);
    expect(next.cases).toEqual([
      {
        benchmark: "parse",
        size: "1 KiB",
        // Much faster: 0.32 + 3 x 0.02 = 0.38 is below 0.50, so the new set replaces the old.
        msPerOp: { value: 0.32, noise: 0.02 },
        peakBytes: { value: 6144, noise: 0 },
        // More allocation: the old measure stays.
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

  it("keeps the old measure, value and noise, when a new set reads lower only by luck", () => {
    const old = floor();
    // 0.45 to 0.48: every reading lower than the old highest, but 0.48 + 3 x 0.03 = 0.57 is not
    // below the old lowest 0.50. The old rule took 0.48 and kept the old noise: a tighter limit
    // bought by a lucky set.
    const lucky = seven((i) => readingDoc([at(0.45 + (i % 4) / 100, 2010)]));
    const next = recordFloor(lucky, old);
    expect(next.cases[0]?.msPerOp).toEqual({ value: 0.55, noise: 0.05 });
    expect(next.cases[0]?.allocBytesPerOp).toEqual({ value: 2100, noise: 100 });
  });

  it("does not drift on unchanged code: the false-failure rate of one measure stays under 1%", () => {
    // Unchanged code read many times: each reading is 1 ms times (1 + 0.05 E), E exponential, a
    // heavy right tail like a shared runner's. Each trial records a floor, then records into it
    // again 30 times from fresh sets of the same code. The chance that one more reading of the
    // same code fails the floor is exact for this noise, exp(-(limit - 1) / 0.05), so the rate is
    // its mean over the trials, after each recording.
    let seed = 0x5eed;
    const random = () => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const template = readingDoc([at(1)], { importCost: null });
    const reading = () => {
      const ms = 1 + 0.05 * -Math.log(1 - random());
      return { ...template, reading: { ...template.reading, cases: [at(ms)] } };
    };
    const set = () => Array.from({ length: BENCH_CONTRACT.FLOOR_MIN_READINGS }, () => reading());
    const failRate = (f: Floor) => {
      const limit = floorLimit(f.cases[0]?.msPerOp as FloorValue);
      return Math.exp(-(limit - 1) / 0.05);
    };
    const TRIALS = 300;
    const RECORDINGS = 30;
    const rate = Array.from({ length: RECORDINGS + 1 }, () => 0);
    for (let t = 0; t < TRIALS; t++) {
      let f = recordFloor(set());
      rate[0] = (rate[0] as number) + failRate(f) / TRIALS;
      for (let r = 1; r <= RECORDINGS; r++) {
        f = recordFloor(set(), f);
        rate[r] = (rate[r] as number) + failRate(f) / TRIALS;
      }
    }
    const first = rate[0] as number;
    const last = rate[RECORDINGS] as number;
    expect(first).toBeLessThan(0.01);
    expect(last).toBeLessThan(0.01);
    // No drift: thirty recordings later the rate is where it started, give or take a few trials.
    expect(last).toBeLessThan(first * 1.25);
  });

  it("keeps an old case, an old measure and the old import the new set did not measure", () => {
    const old = floor();
    const docs = seven(() =>
      readingDoc([caseReading({ size: "32 KiB", allocations: null })], { importCost: null }),
    );
    const next = recordFloor(docs, old);
    expect(next.cases[0]).toEqual(old.cases[0]);
    expect(next.cases[1]?.allocBytesPerOp).toBeNull();
    expect(next.import).toEqual(old.import);
    const unmeasured = recordFloor(
      seven(() => readingDoc([at(0.5, 2000, { allocations: null })])),
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
  it("passes a reading at the floor's limit, and counts each measure", () => {
    // The limits: 0.55 + 3 x 0.05 ms, 2,100 + 3 x 100 bytes, 3 + 3 x 0.5 ms, 900 bytes.
    const doc = readingDoc([at(0.7, 2400)], { importCost: withImport(4.5) });
    expect(checkFloor(doc, floor())).toEqual({ findings: [], checked: 5 });
  });

  it("finds a measure above the floor's limit a regression", () => {
    const doc = readingDoc(
      [
        at(0.71, 2401, {
          peak: {
            status: "measured",
            calls: 20,
            peakHeapBytes: 1,
            medianPeakHeapBytes: 1,
            medianPeakTotalAboveFloorBytes: 6145,
          },
        }),
      ],
      { importCost: withImport(4.51, 901) },
    );
    expect(checkFloor(doc, floor()).findings.map((f) => [f.kind, f.message])).toEqual([
      [
        "regression",
        "parse @ 1 KiB: ms an operation 0.71, above the floor's limit of 0.7 (its highest A/A reading 0.55 plus 3 times its spread of 0.05)",
      ],
      [
        "regression",
        "parse @ 1 KiB: peak bytes 6145, above the floor's limit of 6144 (its highest A/A reading 6144 plus 3 times its spread of 0)",
      ],
      [
        "regression",
        "parse @ 1 KiB: bytes allocated an operation 2401, above the floor's limit of 2400 (its highest A/A reading 2100 plus 3 times its spread of 100)",
      ],
      [
        "regression",
        "import: median cold import, ms 4.51, above the floor's limit of 4.5 (its highest A/A reading 3 plus 3 times its spread of 0.5)",
      ],
      [
        "regression",
        "import: gzipped bytes loaded 901, above the floor's limit of 900 (its highest A/A reading 900 plus 3 times its spread of 0)",
      ],
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

  it("judges no new case, and calls a floor that keeps no measure unjudged rather than a pass", () => {
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
    expect(checkFloor(doc, f)).toEqual({
      findings: [{ kind: "unjudged", message: "the floor keeps no measure, so it judged nothing" }],
      checked: 0,
    });
    // A new case beside a kept one is not judged, and does not count.
    expect(checkFloor(readingDoc([at(0.5), caseReading({ size: "1 MiB" })]), floor())).toEqual({
      findings: [],
      checked: 5,
    });
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

  it("finds a limit raised, a measure or a case gone, and the import gone", () => {
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
      "parse @ 1 KiB: ms an operation's limit rose from 0.7 to 0.71",
      "parse @ 1 KiB: peak bytes's limit rose from 6144 to 6147",
      "parse @ 1 KiB: bytes allocated an operation has no floor any more",
      "import: median cold import, ms has no floor any more",
      "import: gzipped bytes loaded has no floor any more",
    ]);
    expect(loosenedFloor(f, { ...f, cases: [] })).toEqual([
      { kind: "loosened", message: "parse @ 1 KiB: the floor no longer keeps it" },
    ]);
    expect(loosenedFloor({ ...f, import: null }, { ...f, import: null })).toEqual([]);
    // A lower value with a wider noise is looser only when the limit rises.
    const alloc = (value: number, noise: number) => ({
      ...f,
      cases: [{ ...first, allocBytesPerOp: { value, noise } }],
    });
    expect(loosenedFloor(f, alloc(2000, 200)).map((x) => x.message)).toEqual([
      "parse @ 1 KiB: bytes allocated an operation's limit rose from 2400 to 2600",
    ]);
    expect(loosenedFloor(f, alloc(2000, 130))).toEqual([]);
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
