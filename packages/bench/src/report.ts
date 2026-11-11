/**
 * Markdown for a person: a pull request comment, a job summary, a terminal. The JSON document is the
 * record; this is its reading.
 *
 * @packageDocumentation
 */

import type { CaseComparison } from "./compare.js";
import { BENCH_CONTRACT } from "./contract.js";
import { budgetOf } from "./reading.js";
import type { ResultsDocument } from "./results.js";
import { round } from "./stats.js";

function pct(x: number): string {
  const v = round(x * 100, 1);
  return `${v > 0 ? "+" : ""}${String(v)}%`;
}

function bytes(n: number): string {
  if (Math.abs(n) >= 1024 * 1024) return `${String(round(n / (1024 * 1024), 2))} MiB`;
  if (Math.abs(n) >= 1024) return `${String(round(n / 1024, 1))} KiB`;
  return `${String(round(n, 1))} B`;
}

function share(x: number): string {
  return `${String(round(x * 100, 2))}%`;
}

function time(ms: number): string {
  if (ms >= 1) return `${String(round(ms, 3))} ms`;
  if (ms >= 0.001) return `${String(round(ms * 1000, 2))} us`;
  return `${String(round(ms * 1e6, 1))} ns`;
}

function ns(n: number | null): string {
  return n === null ? "n/a" : time(n / 1e6);
}

function header(doc: ResultsDocument, title: string): string[] {
  const e = doc.environment;
  return [
    `### ${title}: ${doc.suite.name}`,
    "",
    `Node ${e.node} on ${e.runner.class} (${e.cpuModel ?? "unknown CPU"}, ${String(e.logicalCpus)} logical CPUs), @cosyte/bench ${doc.tool.version}, ${doc.createdAt}.`,
    "",
  ];
}

function comparisonRow(c: CaseComparison): string {
  const base =
    c.baseMsPerOp.length === 0
      ? "n/a"
      : time(c.baseMsPerOp.reduce((a, b) => a + b, 0) / c.baseMsPerOp.length);
  const head =
    c.headMsPerOp.length === 0
      ? "n/a"
      : time(c.headMsPerOp.reduce((a, b) => a + b, 0) / c.headMsPerOp.length);
  const change = c.medianRatio === null ? "n/a" : pct(c.medianRatio - 1);
  const interval =
    c.interval === null ? "n/a" : `${pct(c.interval.low - 1)} to ${pct(c.interval.high - 1)}`;
  const verdict = c.verdict === "skipped" ? `skipped (${String(c.skipReason)})` : c.verdict;
  return `| ${c.benchmark} | ${c.size} | ${base} | ${head} | ${change} | ${interval} | ${verdict} |`;
}

/**
 * Render a results document as Markdown.
 *
 * @internal
 */
export function renderMarkdown(doc: ResultsDocument): string {
  const lines: string[] = [];
  if (doc.kind === "comparison") {
    const b = doc.comparison;
    lines.push(...header(doc, "Base against head"));
    lines.push(
      `${String(b.rounds)} interleaved rounds, a fresh process per side per case per round. A regression is a change whose whole interval is above ${pct(b.threshold)}; each end of the interval is wrong at most ${String(round(b.alpha * 100, 1))}% of the time. Base and head times are means of the per-round fastest samples.`,
      "",
      "| Benchmark | Size | Base | Head | Change (median) | Interval | Verdict |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...b.cases.map(comparisonRow),
    );
  } else if (doc.kind === "calibration") {
    const c = doc.calibration;
    lines.push(
      ...header(
        doc,
        c.inject === 0 ? "A/A calibration" : `Calibration with a ${share(c.inject)} slowdown`,
      ),
    );
    const what = c.inject === 0 ? "false alarms" : "detections";
    lines.push(
      `${String(c.comparisons)} comparisons. Regression verdicts (${what}): ${String(c.perCase.events)} of ${String(c.perCase.trials)} measured case verdicts (${share(c.perCase.rate)}, upper bound ${share(c.perCase.upperBound)}); ${String(c.perComparison.events)} of ${String(c.perComparison.trials)} comparisons that measured every case or called a regression (${share(c.perComparison.rate)}, upper bound ${share(c.perComparison.upperBound)}). Comparisons that skipped a case: ${String(c.skippedComparisons.events)} of ${String(c.skippedComparisons.trials)} (${share(c.skippedComparisons.rate)}, upper bound ${share(c.skippedComparisons.upperBound)}).`,
      "",
      `Verdicts: ${Object.entries(c.verdicts)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(", ")}.`,
      "",
      "The change each case was observed at, the median of every measured round's head / base:",
      "",
      "| Benchmark | Size | Measured rounds | Observed change |",
      "| --- | --- | --- | --- |",
      ...c.observed.map(
        (o) =>
          `| ${o.benchmark} | ${o.size} | ${String(o.rounds)} | ${o.medianRatio === null ? "n/a" : pct(o.medianRatio - 1)} |`,
      ),
    );
    if (c.requiredRule.applies) {
      lines.push(
        "",
        `Required check rule: ${c.requiredRule.met ? "met" : "not met"}. ${c.requiredRule.reason}.`,
      );
    }
  } else {
    const r = doc.reading;
    lines.push(...header(doc, "Reading"));
    lines.push(
      `Throughput is the median of ${String(r.processes)} fresh processes. "Large-case plan" marks a case whose calls each outlast a warmup batch. Latency is per call, nearest rank. Memory: allocations per operation ("collections counted" when every window collected), the peak of one call above what was in use before it (the V8 heap, external memory such as Buffers, and the two together), the total above the empty-call floor, the peak a memory budget reads (the total above the floor for an input under ${bytes(BENCH_CONTRACT.FLOOR_INPUT_BYTES)}, the raw total for any other), and whether the settled heap stays flat over a long run.`,
      "",
    );
    const f = r.memoryFloor;
    if (f !== undefined && f !== null) {
      lines.push(
        f.status === "measured"
          ? `Empty-call floor, what the peak probe itself costs: ${bytes(f.medianPeakHeapBytes)} heap, ${f.medianPeakTotalBytes === undefined ? "n/a" : bytes(f.medianPeakTotalBytes)} total (the median of ${String(f.calls)} calls).`
          : `Empty-call floor: skipped (${f.reason}).`,
        "",
      );
    }
    lines.push(
      "| Benchmark | Size | Per op | Ops/s | Bytes/s | p50 | p95 | p99 | Alloc/op | Peak heap | Peak external | Peak total | Above floor | Budget reads | Long run |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const c of r.cases) {
      const t = c.throughput;
      const large =
        t.status === "measured" && t.processes.some((p) => p.plan === "large")
          ? " (large-case plan)"
          : "";
      const perOp =
        t.status === "measured" ? `${time(t.medianMsPerOp)}${large}` : `skipped (${t.reason})`;
      const ops = t.status === "measured" ? String(t.opsPerSecond) : "n/a";
      const bps =
        t.status === "measured" && t.bytesPerSecond !== null
          ? `${bytes(t.bytesPerSecond)}/s`
          : "n/a";
      const l = c.latency;
      const lat =
        l === null
          ? ["n/a", "n/a", "n/a"]
          : l.status === "measured"
            ? [ns(l.p50Ns), ns(l.p95Ns), ns(l.p99Ns)]
            : [`skipped (${l.reason})`, "n/a", "n/a"];
      const a = c.allocations;
      const alloc =
        a === null
          ? "n/a"
          : a.status === "measured"
            ? `${bytes(a.heapBytesPerOp + a.externalBytesPerOp)}${a.method === "gc-accounted" ? " (collections counted)" : ""}`
            : `skipped (${a.reason})`;
      const p = c.peak;
      const optional = (n: number | undefined) => (n === undefined ? "n/a" : bytes(n));
      const peak =
        p === null
          ? ["n/a", "n/a", "n/a", "n/a", "n/a"]
          : p.status === "measured"
            ? [
                bytes(p.peakHeapBytes),
                optional(p.peakExternalBytes),
                optional(p.peakTotalBytes),
                optional(p.peakTotalAboveFloorBytes),
                bytes(budgetOf(c, p)),
              ]
            : Array.from({ length: 5 }, () => `skipped (${p.reason})`);
      const lr = c.longRun;
      const long =
        lr === null
          ? ""
          : lr.status === "measured"
            ? `${lr.verdict} (${bytes(lr.growthBytes)} over ${String(lr.ops)} ops, ${String(lr.slopeBytesPerOp)} B/op)`
            : `skipped (${lr.reason})`;
      lines.push(
        `| ${c.benchmark} | ${c.size} | ${perOp} | ${ops} | ${bps} | ${lat.join(" | ")} | ${alloc} | ${peak.join(" | ")} | ${long} |`,
      );
    }
    const failures = r.failures ?? [];
    if (failures.length > 0) {
      lines.push(
        "",
        `Could not measure ${String(failures.length)} part(s) of the run; every other case above was measured and written:`,
        "",
        ...failures.map((x) =>
          x.benchmark === null
            ? `- the empty-call floor: ${x.message}`
            : `- ${x.phase} of ${x.benchmark} @ ${String(x.size)}: ${x.message}`,
        ),
      );
    }
    if (r.importCost !== null) {
      const i = r.importCost;
      lines.push(
        "",
        `Cold import: median ${time(i.medianMs)}, p95 ${time(i.p95Ms)} over ${String(i.runs)} fresh processes (an empty module: median ${time(i.emptyMedianMs)}). Loaded: ${String(i.files.length)} file(s), ${bytes(i.totalBytes)}, ${bytes(i.totalGzipBytes)} gzipped.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
