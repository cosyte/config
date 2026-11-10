import { describe, expect, it } from "vitest";

import { summarizeCalibration } from "../src/compare.js";
import { renderMarkdown } from "../src/report.js";
import { documentBase, type ResultsDocument } from "../src/results.js";
import { caseComparison, env, importCost } from "./support/bodies.js";

const base = {
  ...documentBase({ name: "suite", file: "s.mjs" }, env, new Date("2026-11-10T00:00:00Z")),
  tool: { name: "@cosyte/bench" as const, version: "9.9.9" },
};

describe("renderMarkdown", () => {
  it("formats each unit at its boundary", () => {
    const doc: ResultsDocument = {
      ...base,
      kind: "comparison",
      base: { target: "b", commit: null },
      head: { target: "h", commit: null },
      comparison: {
        rounds: 12,
        threshold: 0.03,
        alpha: 0.05,
        inject: 0,
        cases: [
          caseComparison({
            baseMsPerOp: [0.001],
            headMsPerOp: [1],
            medianRatio: 1,
            interval: { low: 1, high: 1, rank: 3, tail: 0.0193 },
            verdict: "no-regression",
          }),
        ],
      },
    };
    expect(renderMarkdown(doc)).toContain(
      "| scan | 1 KiB | 1 us | 1 ms | 0% | 0% to 0% | no-regression |",
    );
    const reading: ResultsDocument = {
      ...base,
      kind: "reading",
      subject: { target: "t", commit: null },
      reading: {
        processes: 1,
        importCost: null,
        cases: [
          {
            benchmark: "scan",
            size: "1 MiB",
            inputsPerPass: 1,
            bytesPerPass: 1024 * 1024,
            throughput: {
              status: "measured",
              processes: [],
              medianMsPerOp: 1,
              opsPerSecond: 1000,
              bytesPerSecond: 1024 * 1024,
            },
            latency: null,
            allocations: {
              status: "measured",
              windowOps: 1,
              heapBytesPerOp: 1024,
              externalBytesPerOp: 0,
            },
            peak: null,
            longRun: null,
          },
        ],
      },
    };
    expect(renderMarkdown(reading)).toContain(
      "| scan | 1 MiB | 1 ms | 1000 | 1 MiB/s | n/a | n/a | n/a | 1 KiB | n/a |  |",
    );
  });

  it("renders a comparison: each case, its change, its interval and its verdict", () => {
    const doc: ResultsDocument = {
      ...base,
      kind: "comparison",
      base: { target: "b", commit: null },
      head: { target: "h", commit: null },
      comparison: {
        rounds: 12,
        threshold: 0.03,
        alpha: 0.05,
        inject: 0,
        cases: [
          caseComparison(),
          caseComparison({
            benchmark: "decode",
            baseMsPerOp: [0.0004],
            headMsPerOp: [0.0000004],
            medianRatio: 0.98,
            interval: { low: 0.97, high: 0.995, rank: 3, tail: 0.0193 },
            verdict: "no-regression",
          }),
          caseComparison({
            benchmark: "big",
            baseMsPerOp: [],
            headMsPerOp: [],
            medianRatio: null,
            interval: null,
            verdict: "skipped",
            skipReason: "head: warmup-unstable",
          }),
        ],
      },
    };
    expect(renderMarkdown(doc)).toBe(
      [
        "### Base against head: suite",
        "",
        "Node v24.0.0 on github-actions-github-hosted-ubuntu24-x64 (Synthetic CPU, 4 logical CPUs), @cosyte/bench 9.9.9, 2026-11-10T00:00:00.000Z.",
        "",
        "12 interleaved rounds, a fresh process per side per case per round. A regression is a change whose whole interval is above +3%; each end of the interval is wrong at most 5% of the time. Base and head times are means of the per-round fastest samples.",
        "",
        "| Benchmark | Size | Base | Head | Change (median) | Interval | Verdict |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| scan | 1 KiB | 1 ms | 1.1 ms | +10% | +8% to +12% | regression |",
        "| decode | 1 KiB | 400 ns | 0.4 ns | -2% | -3% to -0.5% | no-regression |",
        "| big | 1 KiB | n/a | n/a | n/a | n/a | skipped (head: warmup-unstable) |",
        "",
      ].join("\n"),
    );
  });

  it("renders an A/A calibration with the required check rule, and an injected one without it", () => {
    const run = [
      caseComparison({ verdict: "no-regression" }),
      caseComparison({ verdict: "regression" }),
    ];
    const aa: ResultsDocument = {
      ...base,
      kind: "calibration",
      base: { target: "b", commit: null },
      head: { target: "h", commit: null },
      calibration: summarizeCalibration(0, [run, run.slice(0, 1)]),
    };
    const text = renderMarkdown(aa);
    expect(text).toMatchInlineSnapshot(`
      "### A/A calibration: suite

      Node v24.0.0 on github-actions-github-hosted-ubuntu24-x64 (Synthetic CPU, 4 logical CPUs), @cosyte/bench 9.9.9, 2026-11-10T00:00:00.000Z.

      2 comparisons. Regression verdicts (false alarms): 1 of 3 measured case verdicts (33.33%, upper bound 86.47%); 1 of 2 comparisons that measured every case or called a regression (50%, upper bound 97.47%). Comparisons that skipped a case: 0 of 2 (0%, upper bound 77.64%).

      Verdicts: regression 1, improvement 0, no-regression 2, inconclusive 0, skipped 0.

      The change each case was observed at, the median of every measured round's head / base:

      | Benchmark | Size | Measured rounds | Observed change |
      | --- | --- | --- | --- |
      | scan | 1 KiB | 6 | +10% |

      Required check rule: not met. 1 false alarm(s) in 2 A/A comparisons that measured every case or called a regression: the upper bound 97.4679% is not under 1%, and a clean record needs at least 299 of them; 0 of 2 comparisons skipped a case, and a required check is red on each: the upper bound 77.6393% on that rate is not under 1%.
      "
    `);
    expect(text).toContain("### A/A calibration: suite");
    expect(text).toContain(
      "2 comparisons. Regression verdicts (false alarms): 1 of 3 measured case verdicts (33.33%, upper bound 86.47%); 1 of 2 comparisons that measured every case or called a regression (50%, upper bound 97.47%).",
    );
    expect(text).toContain(
      "Verdicts: regression 1, improvement 0, no-regression 2, inconclusive 0, skipped 0.",
    );
    expect(text).toContain("Required check rule: not met. 1 false alarm(s) in 2 A/A comparisons");
    const clean = renderMarkdown({
      ...aa,
      calibration: summarizeCalibration(
        0,
        Array.from({ length: 299 }, () => [caseComparison({ verdict: "no-regression" })]),
      ),
    });
    expect(clean).toContain("Required check rule: met. 0 false alarm(s) in 299 A/A comparisons");
    const injected: ResultsDocument = {
      ...aa,
      calibration: summarizeCalibration(0.05, [
        [...run, caseComparison({ size: "4 MiB", verdict: "skipped", ratios: [] })],
      ]),
    };
    const other = renderMarkdown(injected);
    expect(other).toContain("| scan | 1 KiB | 4 | +10% |");
    expect(other).toContain("| scan | 4 MiB | 0 | n/a |");
    expect(other).toContain("### Calibration with a 5% slowdown: suite");
    expect(other).toContain("(detections)");
    expect(other).not.toContain("Required check rule");
  });

  it("renders a reading: throughput, latency, memory, long run and the import", () => {
    const doc: ResultsDocument = {
      ...base,
      environment: { ...env, cpuModel: null },
      kind: "reading",
      subject: { target: "t", commit: null },
      reading: {
        processes: 3,
        importCost,
        cases: [
          {
            benchmark: "scan",
            size: "1 KiB",
            inputsPerPass: 1,
            bytesPerPass: 1024,
            throughput: {
              status: "measured",
              processes: [],
              medianMsPerOp: 0.5,
              opsPerSecond: 2000,
              bytesPerSecond: 3 * 1024 * 1024,
            },
            latency: {
              status: "measured",
              calls: 1000,
              timerOverheadNs: 40,
              p50Ns: 500,
              p95Ns: 2_500_000,
              p99Ns: null,
              maxNs: 3_000_000,
            },
            allocations: {
              status: "measured",
              windowOps: 64,
              heapBytesPerOp: 1000,
              externalBytesPerOp: 24,
            },
            peak: { status: "measured", calls: 20, peakHeapBytes: 2048, medianPeakHeapBytes: 1024 },
            longRun: {
              status: "measured",
              verdict: "flat",
              ops: 3000,
              opsPerRound: 100,
              settledHeap: [],
              slopeBytesPerOp: 0.01,
              growthBytes: 512,
              detectableBytesPerOp: 27,
            },
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
            allocations: { status: "skipped", reason: "allocation-window-gc" },
            peak: { status: "skipped", reason: "gc-unsettled" },
            longRun: { status: "skipped", reason: "gc-unavailable" },
          },
          {
            benchmark: "decode",
            size: "1 KiB",
            inputsPerPass: 1,
            bytesPerPass: null,
            throughput: {
              status: "measured",
              processes: [],
              medianMsPerOp: 2,
              opsPerSecond: 500,
              bytesPerSecond: null,
            },
            latency: null,
            allocations: null,
            peak: null,
            longRun: null,
          },
        ],
      },
    };
    const text = renderMarkdown(doc);
    expect(text).toMatchInlineSnapshot(`
      "### Reading: suite

      Node v24.0.0 on github-actions-github-hosted-ubuntu24-x64 (unknown CPU, 4 logical CPUs), @cosyte/bench 9.9.9, 2026-11-10T00:00:00.000Z.

      Throughput is the median of 3 fresh processes. Latency is per call, nearest rank. Memory: allocations per operation, the peak heap of one call above the settled heap, and whether the settled heap stays flat over a long run.

      | Benchmark | Size | Per op | Ops/s | Bytes/s | p50 | p95 | p99 | Alloc/op | Peak heap | Long run |
      | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
      | scan | 1 KiB | 500 us | 2000 | 3 MiB/s | 500 ns | 2.5 ms | n/a | 1 KiB | 2 KiB | flat (512 B over 3000 ops, 0.01 B/op) |
      | scan | 4 MiB | skipped (warmup-unstable) | n/a | n/a | skipped (latency-below-timer-resolution) | n/a | n/a | skipped (allocation-window-gc) | skipped (gc-unsettled) | skipped (gc-unavailable) |
      | decode | 1 KiB | 2 ms | 500 | n/a | n/a | n/a | n/a | n/a | n/a |  |

      Cold import: median 2.5 ms, p95 3 ms over 2 fresh processes (an empty module: median 250 us). Loaded: 1 file(s), 2 KiB, 900 B gzipped.
      "
    `);
    expect(text).toContain(
      "Node v24.0.0 on github-actions-github-hosted-ubuntu24-x64 (unknown CPU, 4 logical CPUs)",
    );
    expect(text).toContain("Throughput is the median of 3 fresh processes.");
    expect(text).toContain(
      "| scan | 1 KiB | 500 us | 2000 | 3 MiB/s | 500 ns | 2.5 ms | n/a | 1 KiB | 2 KiB | flat (512 B over 3000 ops, 0.01 B/op) |",
    );
    expect(text).toContain(
      "| scan | 4 MiB | skipped (warmup-unstable) | n/a | n/a | skipped (latency-below-timer-resolution) | n/a | n/a | skipped (allocation-window-gc) | skipped (gc-unsettled) | skipped (gc-unavailable) |",
    );
    expect(text).toContain(
      "| decode | 1 KiB | 2 ms | 500 | n/a | n/a | n/a | n/a | n/a | n/a |  |",
    );
    expect(text).toContain(
      "Cold import: median 2.5 ms, p95 3 ms over 2 fresh processes (an empty module: median 250 us). Loaded: 1 file(s), 2 KiB, 900 B gzipped.",
    );
    expect(renderMarkdown({ ...doc, reading: { ...doc.reading, importCost: null } })).not.toContain(
      "Cold import",
    );
  });
});
