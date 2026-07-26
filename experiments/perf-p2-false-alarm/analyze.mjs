#!/usr/bin/env node
/**
 * Summarise the PERF-P2 false-alarm sweep.
 *
 * The question is binary and the roadmap asks it that way: across N clean runs, how many times did
 * the gate FIRE on a workload that is linear by construction? Everything else here is context for
 * that number — the ratio distribution (how close it came), and the skip census (how often it
 * refused to answer, which is a different outcome from both firing and passing).
 *
 * Usage: node analyze.mjs [dataDir]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Accepts a directory (reads `runs.jsonl`) or a specific `.jsonl` file, so an archived sweep can be
// re-summarised without being made current. `run.sh` archives rather than truncates.
const target = process.argv[2] ?? join(import.meta.dirname, "data");
const file = target.endsWith(".jsonl") ? target : join(target, "runs.jsonl");
const rows = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l));

const CEILING = 8;
const FLOOR = 1.5;

const q = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toFixed(4));

console.log(`# PERF-P2 false-alarm sweep — ${rows.length} runs (${file})\n`);

const fired = rows.filter((r) => r.fired !== null);
console.log(`## The acceptance clause\n`);
console.log(
  `gate FIRED on a linear workload : ${fired.length} / ${rows.length}  (${((100 * fired.length) / rows.length).toFixed(1)}%)`,
);
for (const op of new Set(fired.map((r) => r.fired))) {
  const these = fired.filter((r) => r.fired === op);
  const ratios = these.map((r) => r.firedRatio).filter((x) => typeof x === "number");
  console.log(
    `  - ${op}: ${these.length}` +
      (ratios.length > 0
        ? `  ratios ${fmt(Math.min(...ratios))}…${fmt(Math.max(...ratios))} (p50 ${fmt(q(ratios, 0.5))})`
        : ""),
  );
  // Only rows carrying `firedDiagnostic` had their axis READ from the gate's message. Older rows
  // (see README's warning on `runs-sweepA.jsonl`) inferred it, and inferred it wrongly — every fire
  // is labelled `count` there regardless. Reprinting that would relaunder an invented measurement
  // through a tool that looks authoritative, so it is suppressed rather than shown with an asterisk.
  const attributed = these.filter((r) => typeof r.firedDiagnostic === "string");
  for (const ax of new Set(attributed.map((r) => r.firedAxis))) {
    console.log(`      on the ${ax} axis: ${attributed.filter((r) => r.firedAxis === ax).length}`);
  }
  if (attributed.length < these.length) {
    console.log(
      `      axis UNKNOWN for ${these.length - attributed.length} (recorded before the attribution fix)`,
    );
  }
}
console.log();

for (const axis of ["count", "size"]) {
  const cells = rows.map((r) => r[axis]);
  const measured = cells.filter((c) => c.status === "measured");
  const skipped = cells.filter((c) => c.status === "skipped");
  const ratios = measured.map((c) => c.ratio);
  const overCeiling = ratios.filter((x) => x > CEILING);
  const underFloor = ratios.filter((x) => x < FLOOR);

  console.log(`## ${axis} axis`);
  console.log(
    `measured ${measured.length} · skipped ${skipped.length} · not reached ${cells.length - measured.length - skipped.length}`,
  );
  for (const reason of new Set(skipped.map((c) => c.reason))) {
    console.log(`  skip ${reason}: ${skipped.filter((c) => c.reason === reason).length}`);
  }
  if (ratios.length > 0) {
    console.log(
      `ratio  min ${fmt(Math.min(...ratios))} · p50 ${fmt(q(ratios, 0.5))} · p95 ${fmt(q(ratios, 0.95))} · max ${fmt(Math.max(...ratios))}`,
    );
    console.log(
      `       above ceiling ${CEILING}: ${overCeiling.length} · below floor ${FLOOR}: ${underFloor.length}`,
    );
    console.log(
      `       margin of worst observed to ceiling: ${fmt(CEILING / Math.max(...ratios))}x`,
    );
  }
  // Settled runs only. Pooling the unsettled ones in drags the tail past WARMUP_MAX_MS and makes
  // "warmup settled in p99 …" describe runs that never settled at all.
  const warmMs = measured.map((c) => c.warmupMs).filter((x) => x !== null);
  if (warmMs.length > 0) {
    console.log(
      `warmup settled in  p50 ${q(warmMs, 0.5)} ms · p90 ${q(warmMs, 0.9)} ms · p95 ${q(warmMs, 0.95)} ms · max ${Math.max(...warmMs)} ms  (settled runs only)`,
    );
  }
  const baseMins = measured.map((c) => c.baseMin).filter((x) => x !== null);
  if (baseMins.length > 0) {
    console.log(
      `base phase min  p50 ${fmt(q(baseMins, 0.5))} ms · min ${fmt(Math.min(...baseMins))} ms`,
    );
  }
  console.log();
}

const elapsed = rows.map((r) => r.elapsedMs);
console.log(
  `## Cost\nper run  p50 ${q(elapsed, 0.5)} ms · p95 ${q(elapsed, 0.95)} ms · max ${Math.max(...elapsed)} ms`,
);
