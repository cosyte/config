// Summarize the calibration runs: the comparison's false alarms and detections, and the long run's
// slopes. Every table in section 5 of ADR 0005 (documentation/decisions/) comes out of this file.
//
//   node experiments/bench-calibration/analyze.mjs compare <dir>...
//   node experiments/bench-calibration/analyze.mjs long-run <dir>
//
// `compare` reads every calibration results file under the directories (at any depth), groups the
// comparisons by the slowdown injected, and judges each case again from its stored samples: with the
// shipped rule (each process's fastest sample, a 3% threshold), and with the alternatives the
// standard weighed, so the trade-off is measured on the same runs rather than argued. A skipped
// case is never a trial. A comparison is a trial when its outcome is known: every case measured, or
// a regression was called. Under a planted slowdown it also prints the change each case was
// observed at, because that, not the nominal fraction, is what a detection rate is read against. It
// needs a build (`pnpm build`), because it judges with the package's own `judge`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { BENCH_CONTRACT, judge, readResults } from "../../packages/bench/dist/index.mjs";

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The exact one-sided upper bound on a rate (Clopper-Pearson), as the package computes it. */
function upperBound(k, n, confidence = 0.95) {
  if (n === 0 || k >= n) return 1;
  const cdf = (p) => {
    let total = 0;
    let log = 0;
    for (let i = 0; i <= k; i++) {
      if (i > 0) log += Math.log(n - i + 1) - Math.log(i);
      total += Math.exp(log + i * Math.log(p) + (n - i) * Math.log1p(-p));
    }
    return total;
  };
  let lo = k / n;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > 1 - confidence) lo = mid;
    else hi = mid;
  }
  return hi;
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;

function jsonFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const path = join(dir, f);
      if (statSync(path).isDirectory()) return jsonFiles(path);
      return f.endsWith(".json") ? [path] : [];
    });
}

function compare(dirs) {
  const byInject = new Map();
  let environment;
  for (const dir of dirs) {
    for (const file of jsonFiles(dir)) {
      const doc = readResults(readFileSync(file, "utf8"));
      if (doc.kind !== "calibration") continue;
      environment ??= doc.environment;
      const list = byInject.get(doc.calibration.inject) ?? [];
      list.push(...doc.calibration.runs);
      byInject.set(doc.calibration.inject, list);
    }
  }
  const rules = [
    {
      name: "shipped: fastest sample, 3%",
      estimator: (xs) => Math.min(...xs),
      threshold: BENCH_CONTRACT.THRESHOLD,
    },
    { name: "fastest sample, 2%", estimator: (xs) => Math.min(...xs), threshold: 0.02 },
    { name: "fastest sample, 5%", estimator: (xs) => Math.min(...xs), threshold: 0.05 },
    { name: "median sample, 3%", estimator: median, threshold: BENCH_CONTRACT.THRESHOLD },
  ];
  const lines = [
    `Machine: ${environment?.cpuModel ?? "unknown"}, ${String(environment?.logicalCpus ?? "?")} logical CPUs, Node ${environment?.node ?? "?"}, ${environment?.runner.class ?? "?"}.`,
    "",
    "| Injected | Rule | Comparisons | With a skip | With an outcome | Regression (comparison) | Upper 95% | Measured cases | Regression (case) | Upper 95% |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const observed = [];
  for (const inject of [...byInject.keys()].sort((a, b) => a - b)) {
    const runs = byInject.get(inject);
    for (const rule of rules) {
      let cases = 0;
      let caseHits = 0;
      let outcomes = 0;
      let compHits = 0;
      let withSkip = 0;
      const byCase = new Map();
      for (const run of runs) {
        let any = false;
        let skipped = false;
        for (const c of run) {
          const key = `${c.benchmark} @ ${c.size}`;
          const row = byCase.get(key) ?? { ratios: [], measured: 0, hits: 0, skipped: 0 };
          byCase.set(key, row);
          if (c.verdict === "skipped") {
            skipped = true;
            row.skipped++;
            continue;
          }
          const ratios = c.headSamples.map(
            (h, k) => rule.estimator(h) / rule.estimator(c.baseSamples[k]),
          );
          cases++;
          row.measured++;
          row.ratios.push(...ratios);
          if (judge(ratios, rule.threshold).verdict === "regression") {
            caseHits++;
            row.hits++;
            any = true;
          }
        }
        if (skipped) withSkip++;
        if (any || !skipped) outcomes++;
        if (any) compHits++;
      }
      lines.push(
        `| ${pct(inject)} | ${rule.name} | ${String(runs.length)} | ${String(withSkip)} | ${String(outcomes)} | ${String(compHits)} (${pct(compHits / outcomes)}) | ${pct(upperBound(compHits, outcomes))} | ${String(cases)} | ${String(caseHits)} (${pct(caseHits / cases)}) | ${pct(upperBound(caseHits, cases))} |`,
      );
      if (rule === rules[0]) observed.push({ inject, byCase });
    }
  }
  lines.push(
    "",
    "By case, with the shipped rule: the change each case was observed at (the median of every measured round's head / base, fastest samples) and its regression verdicts.",
    "",
    "| Injected | Case | Measured | Skipped | Observed change | Regression verdicts |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const { inject, byCase } of observed) {
    for (const [key, row] of byCase) {
      const change =
        row.ratios.length === 0 ? "n/a" : `${((median(row.ratios) - 1) * 100).toFixed(1)}%`;
      lines.push(
        `| ${pct(inject)} | ${key} | ${String(row.measured)} | ${String(row.skipped)} | ${change} | ${String(row.hits)} of ${String(row.measured)} |`,
      );
    }
  }
  // The spread one round's ratio has with nothing changed: what the threshold has to clear.
  const aa = byInject.get(0) ?? [];
  const spread = new Map();
  for (const run of aa) {
    for (const c of run) {
      const key = `${c.benchmark} @ ${c.size}`;
      const list = spread.get(key) ?? [];
      list.push(...c.ratios);
      spread.set(key, list);
    }
  }
  if (spread.size > 0) {
    lines.push(
      "",
      "A/A per-round ratios (fastest sample), by case:",
      "",
      "| Case | Rounds | 5th percentile | Median | 95th percentile |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const [key, list] of spread) {
      const s = [...list].sort((a, b) => a - b);
      const at = (q) => s[Math.max(0, Math.ceil(q * s.length) - 1)];
      lines.push(
        `| ${key} | ${String(s.length)} | ${at(0.05).toFixed(3)} | ${median(s).toFixed(3)} | ${at(0.95).toFixed(3)} |`,
      );
    }
  }
  return lines.join("\n");
}

function longRun(dir) {
  const rows = new Map();
  for (const file of jsonFiles(dir)) {
    const every = Number(/every-(\d+)-/.exec(file)?.[1]);
    const doc = readResults(readFileSync(file, "utf8"));
    if (doc.kind !== "reading") continue;
    const lr = doc.reading.cases[0]?.longRun;
    if (lr?.status !== "measured") continue;
    const list = rows.get(every) ?? [];
    list.push(lr);
    rows.set(every, list);
  }
  const lines = [
    "| Retained | Runs | Slope, B/op (min to max) | Fitted growth (min to max) | Called growing |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const every of [...rows.keys()].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a))) {
    const list = rows.get(every);
    const slopes = list.map((l) => l.slopeBytesPerOp);
    // Older runs predate `growthBytes`: the fitted span is the rounds after the settling ones.
    const growth = list.map(
      (l) =>
        l.growthBytes ??
        Math.round(
          l.slopeBytesPerOp *
            (BENCH_CONTRACT.LONG_RUN_ROUNDS - 1 - BENCH_CONTRACT.LONG_RUN_SETTLE_ROUNDS) *
            l.opsPerRound,
        ),
    );
    const growing = growth.filter((g) => g >= BENCH_CONTRACT.LONG_RUN_GROWTH_BYTES).length;
    const what = every === 0 ? "nothing" : `one object every ${String(every)} call(s)`;
    lines.push(
      `| ${what} | ${String(list.length)} | ${Math.min(...slopes).toFixed(4)} to ${Math.max(...slopes).toFixed(4)} | ${String(Math.min(...growth))} to ${String(Math.max(...growth))} B | ${String(growing)} of ${String(list.length)} |`,
    );
  }
  return lines.join("\n");
}

const [mode, ...dirs] = process.argv.slice(2);
if (mode === "compare") process.stdout.write(`${compare(dirs)}\n`);
else if (mode === "long-run" && dirs[0] !== undefined)
  process.stdout.write(`${longRun(dirs[0])}\n`);
else {
  process.stderr.write("usage: analyze.mjs compare <dir>... | long-run <dir>\n");
  process.exitCode = 2;
}
