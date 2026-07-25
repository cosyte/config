#!/usr/bin/env bash
# PERF-P0 sweep driver. Runs Experiment A (ratio distribution, 8 cells) and Experiment B (GC
# fixpoint), writing raw data under experiments/perf-calibration/data/.
#
#   run.sh            full sweep — 50 fresh processes per cell, ~20 min
#   run.sh --quick    3 per cell, for a smoke check that the harness still works
#   run.sh --bc-only  Experiments B and C only, leaving A's dataset untouched (~4 min)
#
# --bc-only exists because A's dataset is expensive and is measured against a module whose bytecode
# must not change; B and C can be re-taken without invalidating it.
#
# Node 22 is REQUIRED, not preferred: §10/O7 of the roadmap says every memory measurement in the
# source research was taken on Node v24.18.0, and re-running on a real 22 binary is the whole point.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DATA="$HERE/data"
VITEST="$REPO/node_modules/.bin/vitest"

RUNS=50
MODE="${1:-}"
[ "$MODE" = "--quick" ] && RUNS=3
# Runs per (size, coverage) cell of Experiment C. Small: the signal is a large effect and the
# quadratic parser is ~100x slower than the linear one.
SIGNAL_RUNS=10
[ "$MODE" = "--quick" ] && SIGNAL_RUNS=2

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" != "22" ]; then
  echo "run.sh: needs Node 22, found $(node -v). O7 is exactly this: don't calibrate on 24." >&2
  exit 66
fi
[ -x "$VITEST" ] || { echo "run.sh: $VITEST missing — run 'pnpm install' first" >&2; exit 66; }

mkdir -p "$DATA"
RATIOS="$DATA/ratios.jsonl"
SIGNAL="$DATA/signal.jsonl"
[ "$MODE" != "--bc-only" ] && : > "$RATIOS"
: > "$SIGNAL"

# Environment provenance. A perf number without its machine is not a claim (roadmap §7).
# shellcheck disable=SC2016  # the ${...} below are JS template literals, expanded by node not bash
node -e '
const os = require("node:os");
const fs = require("node:fs");
const read = (p) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };
process.stdout.write(JSON.stringify({
  capturedBy: "experiments/perf-calibration/run.sh",
  node: process.versions.node,
  v8: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
  cpuModel: os.cpus()[0]?.model ?? null,
  cpuCount: os.cpus().length,
  totalMemBytes: os.totalmem(),
  loadAvg: os.loadavg(),
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  // M4: young-generation sizing derives from cgroup-constrained memory, and the variance bites
  // hardest exactly on limited containers. Record the limit so a future reader can tell which.
  cgroupMemoryMax: read("/sys/fs/cgroup/memory.max") ?? read("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
  github: process.env.GITHUB_ACTIONS === "true"
    ? { runner: process.env.RUNNER_NAME ?? null, image: process.env.ImageOS ?? null,
        imageVersion: process.env.ImageVersion ?? null, runId: process.env.GITHUB_RUN_ID ?? null }
    : null,
}, null, 2) + "\n");
' > "$DATA/environment.json"

if [ "$MODE" = "--bc-only" ]; then
  echo "== Skipping Experiment A (--bc-only): $(wc -l < "$RATIOS") existing rows left as-is =="
else
echo "== Experiment A: ratio distribution ($RUNS runs/cell, 8 cells) =="
for cov in 0 1; do
  for axis in count size; do
    for ordering in NF FN; do
      printf '  cell %s:%s coverage=%s ' "$axis" "$ordering" "$cov"
      for ((r = 0; r < RUNS; r++)); do
        args=(run --config "$HERE/vitest.config.ts")
        [ "$cov" = 1 ] && args+=(--coverage)
        CELL="$axis:$ordering" WARM_TRIALS=3 RUN_INDEX="$r" COV="$cov" OUT="$RATIOS" \
          "$VITEST" "${args[@]}" >/dev/null 2>&1 || { echo "FAILED at run $r" >&2; exit 1; }
        printf '.'
      done
      printf ' ok\n'
    done
  done
done
fi

echo "== Experiment C: what an O(n^2) regression scores, by fixture size =="
for cov in 0 1; do
  for sz in 125 250 500 1000; do
    printf '  S=%s coverage=%s ' "$sz" "$cov"
    for ((r = 0; r < SIGNAL_RUNS; r++)); do
      args=(run --config "$HERE/vitest.config.ts" signal-check)
      [ "$cov" = 1 ] && args+=(--coverage)
      SIGNAL_S="$sz" WARM_TRIALS=1 RUN_INDEX="$r" COV="$cov" OUT="$SIGNAL" \
        "$VITEST" "${args[@]}" >/dev/null 2>&1 || { echo "FAILED at run $r" >&2; exit 1; }
      printf '.'
    done
    printf ' ok\n'
  done
done

echo "== Experiment B: GC fixpoint =="
OUT="$DATA/gc-fixpoint.json" node --expose-gc "$HERE/gc-fixpoint.mjs"

echo "== Done. $(wc -l < "$RATIOS") ratio rows, $(wc -l < "$SIGNAL") signal rows in $DATA =="
