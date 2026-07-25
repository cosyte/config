/**
 * PERF-P0 — turns `data/` into the tables in `ANALYSIS.md`. Pure derivation: no measurement happens
 * here, so re-running it on a committed dataset always reproduces the same numbers.
 *
 * Usage: `node experiments/perf-calibration/analyze.mjs [dataDir]` — writes markdown to stdout.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.argv[2] ?? join(here, "data");

const rows = readFileSync(join(dataDir, "ratios.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const gc = JSON.parse(readFileSync(join(dataDir, "gc-fixpoint.json"), "utf8"));
const env = JSON.parse(readFileSync(join(dataDir, "environment.json"), "utf8"));

const ESTIMATORS = ["min", "median", "trimmedMean", "mean"];
/** The estimator every headline table uses. Chosen for reporting only — P1 owns the real choice. */
const HEADLINE = "median";

const asc = (xs) => [...xs].sort((a, b) => a - b);
/** Nearest-rank percentile. No interpolation: with n=200 the rank is unambiguous. */
const pct = (xs, p) => {
  const s = asc(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const med = (xs) => pct(xs, 50);
const f = (n, d = 3) => (n === undefined || n === null ? "—" : n.toFixed(d));
const pctDiff = (a, b) => ((a - b) / b) * 100;

const key = (r) => `${r.axis}:${r.ordering}:${r.coverage ? "cov" : "raw"}:${r.phase}`;
const cells = new Map();
for (const r of rows) {
  if (!cells.has(key(r))) cells.set(key(r), []);
  cells.get(key(r)).push(r);
}

const ratiosOf = (rs, est = HEADLINE) => rs.map((r) => r.ratios[est]);
const pick = (axis, ordering, cov, phase) => cells.get(`${axis}:${ordering}:${cov}:${phase}`) ?? [];

const AXES = ["count", "size"];
const ORDERINGS = ["NF", "FN"];
const COVS = ["raw", "cov"];
const PHASES = ["cold", "warm"];

const out = [];
const say = (...s) => out.push(...s);

say(`## Environment`, ``);
say(
  `\`${env.platform}\` · Node \`${env.node}\` · V8 \`${env.v8}\` · ${String(env.cpuCount)} CPU` +
    ` (\`${env.cpuModel ?? "unknown"}\`) · ${(env.totalMemBytes / 1024 ** 3).toFixed(1)} GiB RAM` +
    ` · cgroup memory.max \`${env.cgroupMemoryMax ?? "unset"}\` · NODE_OPTIONS \`${env.nodeOptions ?? "unset"}\``,
);
if (env.github) {
  say(
    ``,
    `GitHub-hosted: image \`${env.github.image ?? "?"}\` version \`${env.github.imageVersion ?? "?"}\`,` +
      ` run \`${env.github.runId ?? "?"}\`.`,
  );
}
say(
  ``,
  `Ratio rows: **${String(rows.length)}** across ${String(cells.size)} cell/phase groups.`,
  ``,
);

say(`## A1 — ratio distribution, by cell (estimator: \`${HEADLINE}\`)`, ``);
say(
  `Ideal is exactly **4.0**. The workload is linear, so every deviation is measurement noise.`,
  ``,
);
say(`| axis | order | coverage | phase | n | min | p50 | p95 | p99 | max |`);
say(`|---|---|---|---|---:|---:|---:|---:|---:|---:|`);
for (const axis of AXES)
  for (const ordering of ORDERINGS)
    for (const cov of COVS)
      for (const phase of PHASES) {
        const rs = pick(axis, ordering, cov, phase);
        if (rs.length === 0) continue;
        const v = ratiosOf(rs);
        say(
          `| ${axis} | ${ordering} | ${cov === "cov" ? "on" : "off"} | ${phase} | ${String(v.length)} ` +
            `| ${f(Math.min(...v))} | ${f(med(v))} | ${f(pct(v, 95))} | ${f(pct(v, 99))} | ${f(Math.max(...v))} |`,
        );
      }
say(``);

say(`## A2 — estimator comparison (worst observed ratio, all cells pooled)`, ``);
say(`| estimator | p50 | p95 | p99 | max | max (cold only) |`);
say(`|---|---:|---:|---:|---:|---:|`);
for (const est of ESTIMATORS) {
  const all = rows.map((r) => r.ratios[est]);
  const cold = rows.filter((r) => r.phase === "cold").map((r) => r.ratios[est]);
  say(
    `| \`${est}\` | ${f(med(all))} | ${f(pct(all, 95))} | ${f(pct(all, 99))} | ${f(Math.max(...all))} ` +
      `| ${f(Math.max(...cold))} |`,
  );
}
say(``);

say(`## A3 — ordering effect (C5: the confound a same-process ratio does NOT cancel)`, ``);
say(`| axis | coverage | phase | p50 N→4N | p50 4N→N | Δ p50 | max N→4N | max 4N→N |`);
say(`|---|---|---|---:|---:|---:|---:|---:|`);
for (const axis of AXES)
  for (const cov of COVS)
    for (const phase of PHASES) {
      const nf = ratiosOf(pick(axis, "NF", cov, phase));
      const fn = ratiosOf(pick(axis, "FN", cov, phase));
      if (nf.length === 0 || fn.length === 0) continue;
      say(
        `| ${axis} | ${cov === "cov" ? "on" : "off"} | ${phase} | ${f(med(nf))} | ${f(med(fn))} ` +
          `| ${f(pctDiff(med(fn), med(nf)), 1)}% | ${f(Math.max(...nf))} | ${f(Math.max(...fn))} |`,
      );
    }
say(``);

say(`## A4 — coverage effect (V1), against the pre-registered decision rule`, ``);
say(
  `Rule, recorded before the sweep: exclude perf tests from coverage iff |Δ p50| > 5% or Δ p95 > 15%.`,
  ``,
);
say(`| axis | order | phase | p50 off | p50 on | Δ p50 | p95 off | p95 on | Δ p95 | trips rule |`);
say(`|---|---|---|---:|---:|---:|---:|---:|---:|---|`);
let tripped = false;
for (const axis of AXES)
  for (const ordering of ORDERINGS)
    for (const phase of PHASES) {
      const off = ratiosOf(pick(axis, ordering, "raw", phase));
      const on = ratiosOf(pick(axis, ordering, "cov", phase));
      if (off.length === 0 || on.length === 0) continue;
      const dP50 = pctDiff(med(on), med(off));
      const dP95 = pctDiff(pct(on, 95), pct(off, 95));
      const trips = Math.abs(dP50) > 5 || dP95 > 15;
      tripped ||= trips;
      say(
        `| ${axis} | ${ordering} | ${phase} | ${f(med(off))} | ${f(med(on))} | ${f(dP50, 1)}% ` +
          `| ${f(pct(off, 95))} | ${f(pct(on, 95))} | ${f(dP95, 1)}% | ${trips ? "**YES**" : "no"} |`,
      );
    }
say(``, `**Decision rule verdict: ${tripped ? "TRIPPED" : "not tripped"}.**`, ``);

say(`## A5 — coverage overhead is NOT uniform across the two compared phases`, ``);
say(
  `V1's mechanism predicts the instrumentation cost scales with executed-block count and density, ` +
    `which differ between the phases. If the two multipliers below were equal, coverage would cancel ` +
    `exactly in the ratio; the gap between them is the non-cancellation, in the units that matter.`,
  ``,
);
say(`| axis | order | phase | base ×slower | quad ×slower | gap |`);
say(`|---|---|---|---:|---:|---:|`);
const medPhaseMs = (rs, which) => med(rs.map((r) => med(r[which])));
for (const axis of AXES)
  for (const ordering of ORDERINGS)
    for (const phase of PHASES) {
      const off = pick(axis, ordering, "raw", phase);
      const on = pick(axis, ordering, "cov", phase);
      if (off.length === 0 || on.length === 0) continue;
      const b = medPhaseMs(on, "base") / medPhaseMs(off, "base");
      const q = medPhaseMs(on, "quad") / medPhaseMs(off, "quad");
      say(
        `| ${axis} | ${ordering} | ${phase} | ${f(b, 2)}× | ${f(q, 2)}× | ${f(pctDiff(q, b), 1)}% |`,
      );
    }
say(``);

say(`## A6 — warmup: is the sample vector still descending? (W1)`, ``);
say(
  `Each phase records 5 reps. If a fixed-count warmup were sufficient, rep 1 and rep 5 would be ` +
    `interchangeable. Ratio of the FIRST rep to the LAST, median across trials.`,
  ``,
);
say(`| axis | coverage | phase | base rep1/rep5 | quad rep1/rep5 |`);
say(`|---|---|---|---:|---:|`);
for (const axis of AXES)
  for (const cov of COVS)
    for (const phase of PHASES) {
      const rs = [...pick(axis, "NF", cov, phase), ...pick(axis, "FN", cov, phase)];
      if (rs.length === 0) continue;
      const r1r5 = (which) => med(rs.map((r) => r[which][0] / r[which][r[which].length - 1]));
      say(
        `| ${axis} | ${cov === "cov" ? "on" : "off"} | ${phase} | ${f(r1r5("base"), 2)}× | ${f(r1r5("quad"), 2)}× |`,
      );
    }
say(``);

say(`## B1 — \`gc()\` rounds to a \`heapUsed\` fixpoint (M3), Node ${gc.node} / V8 ${gc.v8}`, ``);
const roundsHist = (trials) => {
  const h = new Map();
  for (const t of trials) h.set(t.roundsRequired, (h.get(t.roundsRequired) ?? 0) + 1);
  return [...h.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${String(k)}→${String(v)}`)
    .join(", ");
};
const finals = gc.fixpoint.map((t) => t.final);
const spread = (Math.max(...finals) - Math.min(...finals)) / med(finals);
say(`| leg | trials | rounds required (value→count) | residual spread (max−min)/median |`);
say(`|---|---:|---|---:|`);
say(
  `| sync \`gc()\` | ${String(gc.fixpoint.length)} | ${roundsHist(gc.fixpoint)} | ${f(spread * 100, 2)}% |`,
);
const afinals = gc.asyncFixpoint.map((t) => t.final).filter((x) => x !== null);
const aspread = (Math.max(...afinals) - Math.min(...afinals)) / med(afinals);
say(
  `| async \`gc({execution:'async'})\` | ${String(gc.asyncFixpoint.length)} | ${roundsHist(gc.asyncFixpoint)} ` +
    `| ${f(aspread * 100, 2)}% |`,
);
say(``);

say(`## B2 — what each \`gc\` argument form actually reclaims (M2)`, ``);
say(
  `Old-space garbage of ~${f(med(gc.fixpoint.map((t) => t.live - t.final)) / 1024 ** 2, 1)} MiB per trial.`,
  ``,
);
say(`| form | trials | median reclaimed | verdict |`);
say(`|---|---:|---:|---|`);
for (const form of gc.argumentForms) {
  if (form.error) {
    say(`| \`${form.form}\` | 0 | — | threw: \`${form.error}\` |`);
    continue;
  }
  const m = med(form.reclaimedBytes);
  say(
    `| \`${form.form}\` | ${String(form.reclaimedBytes.length)} | ${f(m / 1024 ** 2, 2)} MiB ` +
      `| ${m > 1024 ** 2 ? "**major GC**" : "scavenge — reading is invalid"} |`,
  );
}
say(``);

process.stdout.write(out.join("\n") + "\n");
