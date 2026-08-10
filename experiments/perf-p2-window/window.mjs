#!/usr/bin/env node
/**
 * PERF-P2 / O-P2-2: derive the SEPARATION FIGURE from a noise dataset and a signal dataset.
 *
 * The open question on `PERF-P2` is not "how often does the gate false-alarm". It is whether ANY
 * constant ceiling can sit between the worst false alarm and the weakest genuine O(n^2) signal on
 * the runner class the gate would actually run on. That is one number, and until now it was
 * computed by hand in prose:
 *
 *     window = weakest signal / worst noise
 *
 * A window at or below 1.0 means the two distributions overlap and NO choice of ceiling separates
 * them, which is a sampling-shape problem rather than a tuning problem (ADR 0001 section 3, and the
 * revision that would follow is a founder call, not an edit to this directory).
 *
 * This script derives it instead, so the figure is reproducible from the raw rows and a reader can
 * re-take it against any pair of datasets. It asserts nothing and gates nothing.
 *
 * Usage:
 *   node window.mjs --noise <file.jsonl> [--noise ...] --signal <file.jsonl> [--signal ...]
 *                   [--ceiling 8] [--fixture-floor 500]
 *
 * Exit codes:
 *   0  a window was derived
 *   2  the inputs could not produce one (bad invocation, unreadable or empty dataset)
 *
 * TWO READING TRAPS ARE HANDLED HERE, and both are why "max of the measured column" is the wrong
 * answer:
 *
 *   1. THE NOISE MAXIMUM IS CENSORED. A ratio above the ceiling makes `scalingGate` THROW, so the
 *      run has no measured row at all: `experiments/perf-p2-false-alarm/false-alarm.test.ts`
 *      records it as `firedRatio` with BOTH axes `not-reached`. Reading the measured column's max
 *      as the worst false alarm therefore reads the worst NON-FIRING run and silently drops every
 *      fire, which is exactly backwards. Both populations are pooled below.
 *   2. `firedAxis` IS NOT TRUSTWORTHY ON EVERY ROW. Rows written before that field was read out of
 *      the gate's diagnostic (they carry no `firedDiagnostic`) inferred the axis, and inferred it
 *      wrongly. The ratio is real; the attribution is not. Those rows are pooled for the figure and
 *      reported as unattributed, never printed under an axis heading.
 */

import { readFileSync } from "node:fs";

const DEFAULT_CEILING = 8;

/**
 * The smallest base fixture the pooled figure is allowed to be decided by, in OBX lines.
 *
 * 500 is `hl7`'s own fixture and P0 Experiment A's, so it is the smallest size any package ships
 * against today. Smaller fixtures are still measured and printed, because how signal degrades with
 * size is the reason this sweep exists at all (P0 read 4.69, 8.09, 8.84 climbing with size). They
 * are kept OUT of the pooled figure because ADR 0001 section 5 makes fixture size a per-package
 * calibration parameter and `assertScalingGateFires` REFUSES a fixture whose signal does not clear
 * the ceiling: an under-sized fixture is rejected by the shipped kit before the gate ever runs, so
 * grading the shared constant on one would grade it on a configuration that cannot exist.
 *
 * This is a judgement, which is why it is a named flag with its value printed rather than a
 * constant folded into the arithmetic. Pass `--fixture-floor 0` to pool everything.
 */
const DEFAULT_FIXTURE_FLOOR = 500;

/** Pooled across phases: the archive's own tables are per fixture size, cold and warm together. */
const SIGNAL_KEY = "baseObx";

function parseArgs(argv) {
  const noise = [];
  const signal = [];
  let ceiling = DEFAULT_CEILING;
  let fixtureFloor = DEFAULT_FIXTURE_FLOOR;
  const numeric = { "--ceiling": "ceiling", "--fixture-floor": "fixtureFloor" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== "--noise" && flag !== "--signal" && !(flag in numeric)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    if (value === undefined) throw new Error(`${flag} needs a value`);
    i++;
    if (flag === "--noise") noise.push(value);
    else if (flag === "--signal") signal.push(value);
    else {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`${flag} needs a number, got ${value}`);
      if (numeric[flag] === "ceiling") ceiling = parsed;
      else fixtureFloor = parsed;
    }
  }
  if (noise.length === 0 || signal.length === 0) {
    throw new Error("both --noise and --signal are required (each may be repeated)");
  }
  return { noise, signal, ceiling, fixtureFloor };
}

/**
 * Read a JSONL file. A short or truncated capture is the failure mode this whole experiment is most
 * exposed to (a run that aborted early reads as a small clean dataset rather than as an error), so a
 * line that does not parse REFUSES rather than being dropped.
 */
function readRows(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error(`${file} holds no rows`);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}: line ${String(i + 1)} is not JSON (truncated capture?): ${error}`);
    }
  });
}

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const quantile = (xs, p) => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const fmt = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(4) : "n/a");

/**
 * Every ratio a linear workload produced, whether the gate answered or fired.
 *
 * `censored` records which population a value came from: a fired run's ratio is only ever visible
 * through the exception, and a reader comparing this tool's output with `analyze.mjs` (which
 * summarises the measured column) needs to see that they are counting different things.
 */
function readNoise(files) {
  const rows = files.flatMap((f) => readRows(f).map((r) => ({ ...r, source: f })));
  const observations = [];
  const skips = new Map();
  let fires = 0;

  for (const row of rows) {
    for (const axis of ["count", "size"]) {
      const cell = row[axis];
      if (!cell) continue;
      if (cell.status === "measured" && typeof cell.ratio === "number") {
        observations.push({ axis, ratio: cell.ratio, censored: false, source: row.source });
      } else if (cell.status === "skipped") {
        const reason = cell.reason ?? "unstated";
        skips.set(`${axis}:${reason}`, (skips.get(`${axis}:${reason}`) ?? 0) + 1);
      }
    }
    if (row.fired !== null && row.fired !== undefined) {
      fires++;
      if (typeof row.firedRatio === "number") {
        // Trap 2: only a row carrying the gate's own diagnostic has a READ axis. The rest are
        // pooled by ratio and named unattributed rather than filed under a guess.
        const axis = typeof row.firedDiagnostic === "string" ? (row.firedAxis ?? "unread") : null;
        observations.push({
          axis: axis ?? "unattributed",
          ratio: row.firedRatio,
          censored: true,
          source: row.source,
        });
      }
    }
  }

  if (observations.length === 0) throw new Error("the noise dataset produced no ratios at all");
  const worst = observations.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return { rows, observations, skips, fires, worst };
}

/**
 * What a genuine O(n^2) regression scored, by fixture size.
 *
 * Coverage-on rows are excluded rather than pooled: ADR 0001 section 6 takes perf tests out of the
 * coverage run, so the coverage-off regime is the only one the shipped gate ever measures under.
 * The count of what was excluded is printed, because a filter nobody can see is a filter nobody can
 * check.
 */
function readSignal(files) {
  const all = files.flatMap((f) => readRows(f));
  const used = all.filter((r) => r.coverage !== true);
  if (used.length === 0) throw new Error("the signal dataset holds no coverage-off rows");

  const bySize = new Map();
  for (const row of used) {
    const key = row[SIGNAL_KEY];
    if (typeof row.ratioMin !== "number") continue;
    if (!bySize.has(key)) bySize.set(key, []);
    bySize.get(key).push(row.ratioMin);
  }
  const sizes = [...bySize.entries()]
    .map(([base, ratios]) => ({
      base: Number(base),
      n: ratios.length,
      weakest: Math.min(...ratios),
      p50: quantile(ratios, 0.5),
      strongest: Math.max(...ratios),
    }))
    .sort((a, b) => a.base - b.base);
  if (sizes.length === 0) throw new Error("no signal row carried a numeric ratioMin");
  return { total: all.length, excludedCoverage: all.length - used.length, sizes };
}

function main() {
  const { noise, signal, ceiling, fixtureFloor } = parseArgs(process.argv.slice(2));
  const n = readNoise(noise);
  const s = readSignal(signal);

  const out = [];
  const say = (line = "") => out.push(line);

  say(`# PERF-P2 window: weakest signal against worst noise`);
  say();
  say(`noise  ${noise.join(", ")}`);
  say(`signal ${signal.join(", ")}`);
  say(`frozen RATIO_CEILING under test: ${String(ceiling)}`);
  say(`fixture floor for the pooled figure: ${String(fixtureFloor)} base OBX lines`);
  say();

  say(`## Noise, a workload that is linear by construction`);
  say();
  say(`runs                      ${String(n.rows.length)}`);
  say(
    `gate FIRED                ${String(n.fires)}  (${((100 * n.fires) / n.rows.length).toFixed(2)}%)`,
  );
  const measured = n.observations.filter((o) => !o.censored);
  const censored = n.observations.filter((o) => o.censored);
  say(`ratios pooled             ${String(n.observations.length)}`);
  say(`  measured (gate answered) ${String(measured.length)}`);
  say(`  censored (gate fired)    ${String(censored.length)}`);
  for (const axis of ["count", "size"]) {
    const these = measured.filter((o) => o.axis === axis).map((o) => o.ratio);
    if (these.length === 0) continue;
    say(
      `measured ${axis.padEnd(5)} axis      min ${fmt(Math.min(...these))} p50 ${fmt(quantile(these, 0.5))} ` +
        `p95 ${fmt(quantile(these, 0.95))} max ${fmt(Math.max(...these))}  (n ${String(these.length)})`,
    );
  }
  for (const [key, count] of [...n.skips.entries()].sort()) {
    say(`axis skip ${key}: ${String(count)}`);
  }
  say();
  say(
    `WORST FALSE ALARM         ${fmt(n.worst.ratio)}  ` +
      `(${n.worst.censored ? "a fire, so censored out of the measured column" : "measured, no fire"}` +
      `, ${n.worst.axis} axis)`,
  );
  say();

  say(`## Signal, a genuine O(n^2) regression on the same box`);
  say();
  if (s.excludedCoverage > 0) {
    say(`(${String(s.excludedCoverage)} coverage-on row(s) excluded, ADR 0001 section 6)`);
  }
  say(`base -> ${String(4)}x        n   weakest      p50   strongest`);
  for (const cell of s.sizes) {
    say(
      `${String(cell.base).padStart(6)} -> ${String(cell.base * 4).padEnd(7)} ` +
        `${String(cell.n).padStart(3)}   ${fmt(cell.weakest).padStart(7)}  ${fmt(cell.p50).padStart(7)}  ` +
        `${fmt(cell.strongest).padStart(7)}`,
    );
  }
  say();

  say(`## The window`);
  say();
  say(`base -> 4x        worst noise   weakest signal    window   a ceiling exists?`);
  for (const cell of s.sizes) {
    const window = cell.weakest / n.worst.ratio;
    const separates = n.worst.ratio < cell.weakest;
    say(
      `${String(cell.base).padStart(6)} -> ${String(cell.base * 4).padEnd(7)} ` +
        `${fmt(n.worst.ratio).padStart(11)}   ${fmt(cell.weakest).padStart(14)}   ` +
        `${(window.toFixed(2) + "x").padStart(7)}   ${separates ? "yes" : "NO"}`,
    );
  }
  say();

  // The decisive figure pools the shippable fixture sizes. A package chooses its own fixture size
  // (ADR 0001 section 5), so a ceiling that separates at one size and not another does not
  // separate: the constant is shared across every package that adopts the gate.
  const pooled = s.sizes.filter((c) => c.base >= fixtureFloor);
  if (pooled.length === 0) {
    throw new Error(
      `no measured fixture size is at or above the floor of ${String(fixtureFloor)}, ` +
        `so no pooled figure can be derived (lower --fixture-floor, or measure a larger fixture)`,
    );
  }
  const excluded = s.sizes.filter((c) => c.base < fixtureFloor);
  const weakestAnywhere = pooled.reduce((a, b) => (b.weakest < a.weakest ? b : a));
  const pooledWindow = weakestAnywhere.weakest / n.worst.ratio;
  const anyCeiling = n.worst.ratio < weakestAnywhere.weakest;

  say(`POOLED OVER THE SHIPPABLE FIXTURE SIZES, the figure that decides the shared constant:`);
  say();
  say(
    `pooled sizes              ${pooled.map((c) => `${String(c.base)} -> ${String(c.base * 4)}`).join(", ")}`,
  );
  if (excluded.length > 0) {
    say(
      `excluded, under the floor ${excluded.map((c) => `${String(c.base)} -> ${String(c.base * 4)}`).join(", ")}  ` +
        `(measured above, and printed there; assertScalingGateFires refuses a fixture this small)`,
    );
  }
  say(`worst false alarm         ${fmt(n.worst.ratio)}`);
  say(
    `weakest genuine signal    ${fmt(weakestAnywhere.weakest)}  ` +
      `(at ${String(weakestAnywhere.base)} -> ${String(weakestAnywhere.base * 4)}, n ${String(weakestAnywhere.n)})`,
  );
  say(`SEPARATION FIGURE         ${pooledWindow.toFixed(4)}x`);
  say();
  say(
    anyCeiling
      ? `VERDICT: SOME ceiling separates signal from noise on this box (any value strictly between ` +
          `${fmt(n.worst.ratio)} and ${fmt(weakestAnywhere.weakest)}).`
      : `VERDICT: NO ceiling separates signal from noise on this box. The distributions overlap: ` +
          `the worst false alarm (${fmt(n.worst.ratio)}) is at or above the weakest genuine ` +
          `regression (${fmt(weakestAnywhere.weakest)}).`,
  );
  // Both failure modes are reported, never just the first one found. A ceiling can be too low and
  // too high at the same time once the distributions overlap, and naming only one of them reads as
  // "move the constant the other way", which is the tuning answer this measurement exists to refuse.
  const firesOnCleanCode = n.worst.ratio >= ceiling;
  const passesARegression = weakestAnywhere.weakest <= ceiling;
  if (!firesOnCleanCode && !passesARegression) {
    say(`The frozen RATIO_CEILING of ${String(ceiling)} is inside that window.`);
  } else {
    say(`The frozen RATIO_CEILING of ${String(ceiling)} is NOT inside the window:`);
    if (firesOnCleanCode) {
      say(
        `  the worst false alarm ${fmt(n.worst.ratio)} is at or above it, so the gate fires on ` +
          `clean code;`,
      );
    }
    if (passesARegression) {
      say(
        `  the weakest genuine regression ${fmt(weakestAnywhere.weakest)} is at or below it, so ` +
          `the gate passes a real regression.`,
      );
    }
  }

  process.stdout.write(out.join("\n") + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`window.mjs: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
