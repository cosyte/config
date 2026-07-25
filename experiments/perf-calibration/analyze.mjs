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
/** Experiment C is optional: a `--bc-only` artifact has it, an older dataset may not. */
let signal = [];
try {
  signal = readFileSync(join(dataDir, "signal.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
} catch {
  signal = [];
}
const env = JSON.parse(readFileSync(join(dataDir, "environment.json"), "utf8"));

const ESTIMATORS = ["min", "median", "trimmedMean", "mean"];
/**
 * The estimator the per-cell tables are derived on. Overridable with `EST=` because the pre-registered
 * decision rule reads "for the estimator P1 adopts", and ANALYSIS.md §1 ends up recommending `min` for
 * the ratio assertion — so every conclusion has to be checkable on `min`, not only on the default.
 */
const HEADLINE = process.env["EST"] ?? "median";
if (!ESTIMATORS.includes(HEADLINE)) throw new Error(`EST must be one of ${ESTIMATORS.join(", ")}`);

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
  `Ideal is exactly **4.0**. The workload is linear, so no deviation here is a real regression — ` +
    `but do not read the spread as pure noise either: A3 shows a **reproducible** ordering and axis ` +
    `bias of a few percent sitting inside it. The tail is noise; the offset of the centre is not.`,
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
/**
 * Two different things get called "spread" here and conflating them misreads the data.
 *   - `settled` — WITHIN a trial, across rounds 2..N once the fixpoint is reached. This is the one
 *     that answers "how stable is a settled `heapUsed` reading", i.e. how much of a measured delta
 *     is real. Reported as the median across trials.
 *   - `drift` — ACROSS trials, comparing each trial's final reading. This moves for reasons that have
 *     nothing to do with GC stability (the process's own baseline creeping as the harness allocates,
 *     a compilation cache being released), so it is reported separately and never as "noise".
 */
const settledSpreads = (trials) =>
  trials
    .filter((t) => t.series.length > 1)
    .map((t) => {
      const tail = t.series.slice(1);
      return {
        rel: (Math.max(...tail) - Math.min(...tail)) / med(tail),
        abs: Math.max(...tail) - Math.min(...tail),
      };
    });
const driftSpread = (trials) => {
  const finals = trials.map((t) => t.final).filter((x) => x !== null);
  return (Math.max(...finals) - Math.min(...finals)) / med(finals);
};
say(
  `| leg | trials | rounds required (value→count) | settled spread, median | settled spread, WORST | baseline drift |`,
);
say(`|---|---:|---|---:|---:|---:|`);
for (const [label, trials] of [
  ["sync `gc()`", gc.fixpoint],
  ["async `gc({execution:'async'})`", gc.asyncFixpoint],
]) {
  const sp = settledSpreads(trials);
  const worst = sp.reduce((a, b) => (b.abs > a.abs ? b : a), { rel: 0, abs: 0 });
  say(
    `| ${label} | ${String(trials.length)} | ${roundsHist(trials)} ` +
      `| ${f(med(sp.map((x) => x.rel)) * 100, 3)}% | ${String(worst.abs)} B (${f(worst.rel * 100, 3)}%) ` +
      `| ${f(driftSpread(trials) * 100, 2)}% |`,
  );
}
say(
  ``,
  `The **worst** column is the one P3 has to design against: the median settled reading is exactly ` +
    `reproducible, but a minority of trials still move by ~1 KiB across settled rounds with no ` +
    `workload running. That is the noise floor of a settled \`heapUsed\` figure, and it is not zero.`,
  ``,
);

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

if (signal.length > 0) {
  say(`## D — the SIGNAL side: what an O(n²)-in-length regression actually scores`, ``);
  say(
    `Same harness, same \`min\` estimator, same 4× size step — only the parser is quadratic. This is ` +
      `the number the ceiling is argued *against*, and it was inherited arithmetic ("≈16") until now.`,
    ``,
  );
  say(`| base OBX → 4× | coverage | n | min | p50 | max |`);
  say(`|---|---|---:|---:|---:|---:|`);
  const sizes = [...new Set(signal.map((r) => r.baseObx))].sort((a, b) => a - b);
  for (const sz of sizes)
    for (const cov of [false, true]) {
      const v = signal.filter((r) => r.baseObx === sz && r.coverage === cov).map((r) => r.ratioMin);
      if (v.length === 0) continue;
      say(
        `| ${String(sz)} → ${String(sz * 4)} | ${cov ? "on" : "off"} | ${String(v.length)} ` +
          `| ${f(Math.min(...v), 2)} | ${f(med(v), 2)} | ${f(Math.max(...v), 2)} |`,
      );
    }
  const worstNoise = Math.max(...rows.map((r) => r.ratios["min"]));
  const bySize = sizes.map((sz) => ({
    sz,
    lo: Math.min(...signal.filter((r) => r.baseObx === sz).map((r) => r.ratioMin)),
  }));
  say(``);
  say(
    `| base OBX → 4× | weakest signal seen | worst false alarm (\`min\`, all rows) | separated? |`,
  );
  say(`|---|---:|---:|---|`);
  for (const { sz, lo } of bySize) {
    say(
      `| ${String(sz)} → ${String(sz * 4)} | ${f(lo, 2)} | ${f(worstNoise, 2)} ` +
        `| ${lo > worstNoise ? `yes, by ${f(lo / worstNoise, 2)}×` : "**NO — overlaps the noise**"} |`,
    );
  }
  say(
    ``,
    `The signal is **not a constant**. It climbs with fixture size as the quadratic term overtakes ` +
      `the linear per-line work, so **the fixture size is part of the gate's calibration, not a free ` +
      `choice**. A package that picks fixtures too small gets a gate whose signal sits inside its own ` +
      `false-alarm tail — green while broken, which is roadmap §5's second-worst outcome.`,
    ``,
  );
}

say(`## C — candidate constants, derived`, ``);
say(
  `Mechanical derivation only; the judgement about how much margin to buy is written up in ` +
    `ANALYSIS.md. Both populations are shown; the ALL column is the one ANALYSIS.md quotes, because ` +
    `the binding worst case turns out not to be a cold row.`,
  ``,
);
const CEILING = 8;
say(
  `| estimator | cold n | cold min…max | ALL n | ALL min…max | headroom of ceiling ${String(CEILING)} (all) |`,
);
say(`|---|---:|---|---:|---|---:|`);
for (const est of ESTIMATORS) {
  const cold = rows.filter((r) => r.phase === "cold").map((r) => r.ratios[est]);
  const all = rows.map((r) => r.ratios[est]);
  say(
    `| \`${est}\` | ${String(cold.length)} | ${f(Math.min(...cold))} … ${f(Math.max(...cold))} ` +
      `| ${String(all.length)} | ${f(Math.min(...all))} … ${f(Math.max(...all))} ` +
      `| ${f(CEILING / Math.max(...all), 2)}× |`,
  );
}
say(
  ``,
  `Both populations are shown because the cold-only split, though pre-registered, was justified on ` +
    `the premise that warm rows are a quieter steady state. On the noisy leg they are not uniformly ` +
    `quieter, so a margin quoted from cold alone overstates the headroom. **The ALL column is the ` +
    `honest one** and is what ANALYSIS.md quotes.`,
);
say(``);

process.stdout.write(out.join("\n") + "\n");
