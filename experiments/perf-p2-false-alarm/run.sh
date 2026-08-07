#!/usr/bin/env bash
# PERF-P2 false-alarm sweep. Runs the SHIPPED gate over a workload that is linear by construction,
# in N fresh processes, and records every ratio. Every row is a false alarm by definition.
#
#   run.sh            200 runs: the roadmap's acceptance clause, ~25 min
#   run.sh --quick    5 runs, for a smoke check that the harness still works
#   run.sh <n>        n runs
#
# Node 22 is REQUIRED, not preferred: ADR 0001's constants are calibrated on Node 22.23.1 / V8 12.4
# and its review trigger 4 is "Node's major version moves". Re-measuring the ceiling on 24 would
# answer a different question than the one this sweep is for.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DATA="$HERE/data"
VITEST="$REPO/node_modules/.bin/vitest"

RUNS=200
case "${1:-}" in
  --quick) RUNS=5 ;;
  "") ;;
  *) RUNS="$1" ;;
esac

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" != "22" ]; then
  echo "run.sh: needs Node 22, found $(node -v)." >&2
  echo "  ADR 0001 is calibrated on 22.23.1/V8 12.4; try:  mise exec node@22 -- $0 $*" >&2
  exit 66
fi
[ -x "$VITEST" ] || { echo "run.sh: $VITEST missing, run 'pnpm install' first" >&2; exit 66; }

mkdir -p "$DATA"
OUT="$DATA/runs.jsonl"
# Archive rather than truncate. An acceptance dataset is expensive (~25 min) and not reproducible:
# this sweep's whole finding is that the fire count is environment-dominated, so two sweeps taken
# hours apart are two observations, not one superseding the other. A previous run of this script
# destroyed the first 200-run dataset by truncating here; it does not get to happen twice.
if [ -s "$OUT" ]; then
  ARCHIVE="$DATA/runs-$(date -u +%Y%m%dT%H%M%SZ).jsonl"
  mv "$OUT" "$ARCHIVE"
  echo "archived previous dataset -> $(basename "$ARCHIVE")"
fi
: > "$OUT"

# Environment provenance. A perf number without its machine is not a claim (roadmap §7). The cgroup
# CPU quota is recorded because it is the field that explains this box: `os.cpus().length` reports
# the host's core count, while the container is capped far below it, and V8 sizes its concurrent
# GC/compiler thread pools from the former.
node -e '
const os = require("node:os");
const fs = require("node:fs");
const read = (p) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };
process.stdout.write(JSON.stringify({
  capturedBy: "experiments/perf-p2-false-alarm/run.sh",
  runs: Number(process.argv[1]),
  node: process.versions.node,
  v8: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
  cpuModel: os.cpus()[0]?.model ?? null,
  cpuCount: os.cpus().length,
  cgroupCpuMax: read("/sys/fs/cgroup/cpu.max"),
  cgroupMemoryMax: read("/sys/fs/cgroup/memory.max"),
  totalMemBytes: os.totalmem(),
  loadAvg: os.loadavg(),
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  github: process.env.GITHUB_ACTIONS ? { runner: process.env.RUNNER_NAME ?? null, image: process.env.ImageOS ?? null } : null,
}, null, 2) + "\n");
' "$RUNS" > "$DATA/environment.json"
# The provenance file is committed, and the repo's `format:check` covers `**/*.json`, so normalise it
# here rather than leaving a re-run of this sweep to turn CI red for a whitespace diff.
"$REPO/node_modules/.bin/prettier" --write --log-level warn "$DATA/environment.json" >/dev/null 2>&1 || true

echo "PERF-P2 false-alarm sweep: $RUNS fresh processes on $(node -v)"
for i in $(seq 1 "$RUNS"); do
  RUN_INDEX="$i" OUT="$OUT" "$VITEST" run --config "$HERE/vitest.config.ts" --silent >/dev/null 2>&1 \
    || echo "  run $i: vitest exited non-zero (recorded in the JSONL if the row was written)" >&2
  if [ $((i % 10)) -eq 0 ]; then echo "  $i/$RUNS"; fi
done

echo
node "$HERE/analyze.mjs" "$DATA"
