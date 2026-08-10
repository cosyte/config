#!/usr/bin/env bash
# PERF-P2 / O-P2-2: take BOTH sides of the window, on ONE box, in one session.
#
#   run.sh                 the decisive sweep: 200 noise runs + 30 signal runs per fixture size
#   run.sh --quick         3 noise runs + 1 signal run per size, a smoke check of the harness only
#   run.sh <n>             n noise runs, signal legs unchanged
#
# Env knobs, all optional:
#   NOISE_RUNS        runs of the linear workload            (default 200, the acceptance clause)
#   SIGNAL_RUNS       runs of the quadratic workload PER SIZE (default 30, each writing 2 rows)
#   SIGNAL_SIZES      base OBX line counts, space separated  (default "250 500 1000")
#   EXPECT_CPUS       refuse to run on a box of another size (default 2, the GitHub-hosted runner)
#   ALLOW_ANY_BOX=1   take the measurement anyway, and say so in the provenance
#
# WHY THIS EXISTS AS ITS OWN DRIVER. The two halves were always measurable separately:
# `../perf-p2-false-alarm/` measures noise, PERF-P0 Experiment C measures signal. What was never
# scripted is the thing the open question is actually about, which is the DISTANCE BETWEEN THEM on
# one machine. Taking them in two sessions, or on two machines, produces two numbers whose
# difference is not a window. So this drives both legs back to back in one process sequence on one
# box, and `window.mjs` derives the figure from the rows.
#
# Node 22 is REQUIRED, not preferred, for the reason both sibling drivers state: ADR 0001's
# constants are calibrated on Node 22.23.1 / V8 12.4, and re-measuring the ceiling on another major
# answers a different question.
#
# NEITHER TEST FILE IS COPIED OR MODIFIED. The noise leg launches
# `../perf-p2-false-alarm/false-alarm.test.ts` through that directory's own vitest config, and the
# signal leg launches `../perf-calibration/signal-check.test.ts` through that directory's own. What
# is duplicated here is a for loop, not a measurement. The sibling's `run.sh` is deliberately NOT
# called: it writes into its own committed `data/`, archiving the checked-in dataset on start, and a
# driver that mutates a committed dataset as a side effect of measuring something else is a trap
# waiting for whoever runs this in a working tree.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DATA="$HERE/data"
VITEST="$REPO/node_modules/.bin/vitest"
NOISE_CONFIG="$REPO/experiments/perf-p2-false-alarm/vitest.config.ts"
SIGNAL_CONFIG="$REPO/experiments/perf-calibration/vitest.config.ts"

NOISE_RUNS="${NOISE_RUNS:-200}"
SIGNAL_RUNS="${SIGNAL_RUNS:-30}"
SIGNAL_SIZES="${SIGNAL_SIZES:-250 500 1000}"
EXPECT_CPUS="${EXPECT_CPUS:-2}"

case "${1:-}" in
  --quick) NOISE_RUNS=3; SIGNAL_RUNS=1 ;;
  "") ;;
  *) NOISE_RUNS="$1" ;;
esac

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" != "22" ]; then
  echo "run.sh: needs Node 22, found $(node -v)." >&2
  echo "  ADR 0001 is calibrated on 22.23.1/V8 12.4; try:  mise exec node@22 -- $0 $*" >&2
  exit 66
fi
[ -x "$VITEST" ] || { echo "run.sh: $VITEST missing, run 'pnpm install' first" >&2; exit 66; }
for f in "$NOISE_CONFIG" "$SIGNAL_CONFIG"; do
  [ -f "$f" ] || { echo "run.sh: missing sibling config $f" >&2; exit 66; }
done

mkdir -p "$DATA"
NOISE_OUT="$DATA/noise.jsonl"
SIGNAL_OUT="$DATA/signal.jsonl"
ENV_OUT="$DATA/environment.json"

# ---------------------------------------------------------------------------
# THE BOX CENSUS, WHICH IS THE POINT OF THIS EXPERIMENT AND NOT A PRELUDE TO IT.
#
# Every previous reading of this gate was taken on a box nobody had checked, and the class changed
# 6x underneath the experiment without anyone noticing: `#34` calibrated on a 2-CPU container, the
# re-measurement landed on a 12-CPU one, and BOTH readers who looked reported the wrong number
# because they read `nproc`.
#
# `nproc` and `os.cpus().length` report the HOST's cores. Inside a container the cgroup throttles
# against a quota that can be a fraction of that, while V8 still sizes its concurrent GC and
# compiler pools from the host count, which is the mechanism behind every fire in these datasets.
# So the quota is the authority WHEN THERE IS ONE.
#
# The converse matters just as much here and is the half that is easy to get backwards: a
# GitHub-hosted runner is a VM, not a container. Its root cgroup reads `max 100000`, meaning NO
# quota, and on that box `nproc` is the correct and only answer. Deriving "the box" from `cpu.max`
# alone would read "unlimited" on precisely the machine this experiment exists to characterise.
#
# Hence: quota if one is set, host count otherwise, and the raw values recorded either way so the
# derivation can be checked rather than believed.
# ---------------------------------------------------------------------------
CPU_JSON="$(node -e '
const fs = require("node:fs");
const os = require("node:os");
const read = (p) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };
const cpuMax = read("/sys/fs/cgroup/cpu.max");
const v1Quota = read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
const v1Period = read("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
let effective = os.cpus().length;
let basis = "host cpu count (no cgroup quota is set on this box)";
if (cpuMax) {
  const [quota, period] = cpuMax.split(/\s+/);
  if (quota !== "max" && Number(quota) > 0 && Number(period) > 0) {
    effective = Number(quota) / Number(period);
    basis = "cgroup v2 cpu.max quota";
  }
} else if (v1Quota && Number(v1Quota) > 0 && v1Period && Number(v1Period) > 0) {
  effective = Number(v1Quota) / Number(v1Period);
  basis = "cgroup v1 cfs quota";
}
process.stdout.write(JSON.stringify({ effective, basis, cpuMax, v1Quota, v1Period }));
')"
EFFECTIVE_CPUS="$(node -pe 'JSON.parse(process.argv[1]).effective' "$CPU_JSON")"
CPU_BASIS="$(node -pe 'JSON.parse(process.argv[1]).basis' "$CPU_JSON")"

echo "PERF-P2 window sweep"
echo "  node            $(node -v)"
echo "  effective CPUs  $EFFECTIVE_CPUS  (from $CPU_BASIS)"
echo "  host cpu count  $(node -pe 'require("node:os").cpus().length')"
echo "  cgroup cpu.max  $(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo 'not readable')"
echo "  noise runs      $NOISE_RUNS"
echo "  signal runs     $SIGNAL_RUNS per size, sizes: $SIGNAL_SIZES"

BOX_AS_EXPECTED=true
if [ "$EFFECTIVE_CPUS" != "$EXPECT_CPUS" ]; then
  BOX_AS_EXPECTED=false
  if [ "${ALLOW_ANY_BOX:-}" != "1" ]; then
    echo >&2
    echo "run.sh: REFUSING. This box has $EFFECTIVE_CPUS effective CPUs, expected $EXPECT_CPUS." >&2
    echo "  O-P2-2 is a question about ONE runner class: the quiet GitHub-hosted 2-vCPU runner the" >&2
    echo "  gate would actually run on. A window taken on another box does not transfer, and this" >&2
    echo "  project has already produced three readings on three classes for exactly that reason." >&2
    echo "  Set EXPECT_CPUS to the class you mean, or ALLOW_ANY_BOX=1 to record one anyway." >&2
    exit 66
  fi
  echo "  WARNING: ALLOW_ANY_BOX=1, so this is NOT the O-P2-2 measurement." >&2
fi

# Provenance. A perf number without its machine is not a claim (roadmap section 7), and the two
# preceding sweeps are unreadable without theirs. The committed file is covered by the repo's
# `format:check` glob, so normalise it here rather than leave a re-run to turn CI red on whitespace.
# shellcheck disable=SC2016  # the ${...} below are JS template literals, expanded by node not bash
node -e '
const os = require("node:os");
const fs = require("node:fs");
const read = (p) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };
const cpu = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify({
  capturedBy: "experiments/perf-p2-window/run.sh",
  experiment: "O-P2-2",
  noiseRuns: Number(process.argv[2]),
  signalRunsPerSize: Number(process.argv[3]),
  signalSizes: process.argv[4].split(/\s+/).map(Number),
  boxAsExpected: process.argv[5] === "true",
  expectedCpus: Number(process.argv[6]),
  effectiveCpus: cpu.effective,
  effectiveCpuBasis: cpu.basis,
  hostCpuCount: os.cpus().length,
  cgroupCpuMax: cpu.cpuMax,
  cgroupCpuV1Quota: cpu.v1Quota,
  cgroupCpuV1Period: cpu.v1Period,
  cgroupMemoryMax: read("/sys/fs/cgroup/memory.max"),
  node: process.versions.node,
  v8: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
  cpuModel: os.cpus()[0]?.model ?? null,
  totalMemBytes: os.totalmem(),
  loadAvgAtStart: os.loadavg(),
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  github: process.env.GITHUB_ACTIONS === "true"
    ? { runner: process.env.RUNNER_NAME ?? null, image: process.env.ImageOS ?? null,
        imageVersion: process.env.ImageVersion ?? null, runId: process.env.GITHUB_RUN_ID ?? null }
    : null,
}, null, 2) + "\n");
' "$CPU_JSON" "$NOISE_RUNS" "$SIGNAL_RUNS" "$SIGNAL_SIZES" "$BOX_AS_EXPECTED" "$EXPECT_CPUS" > "$ENV_OUT"
"$REPO/node_modules/.bin/prettier" --write --log-level warn "$ENV_OUT" >/dev/null 2>&1 || true

# Truncate rather than archive, which is the OPPOSITE of the sibling's rule and is deliberate: this
# directory ships no committed dataset, so there is nothing here an archive would protect. The
# expensive-dataset rule that made archiving right there is why the run below refuses on a short
# capture instead: a partial file is the failure this experiment is most exposed to, because a
# truncated capture reads as a small clean result rather than as an error.
: > "$NOISE_OUT"
: > "$SIGNAL_OUT"

echo
echo "== Noise: $NOISE_RUNS fresh processes over a workload that is linear by construction =="
for ((i = 1; i <= NOISE_RUNS; i++)); do
  RUN_INDEX="$i" OUT="$NOISE_OUT" "$VITEST" run --config "$NOISE_CONFIG" --silent >/dev/null 2>&1 \
    || echo "  noise run $i: vitest exited non-zero (the row is written from inside the test)" >&2
  if [ $((i % 10)) -eq 0 ]; then echo "  $i/$NOISE_RUNS"; fi
done

echo
echo "== Signal: what a genuine O(n^2) regression scores, by fixture size, on this same box =="
for sz in $SIGNAL_SIZES; do
  printf '  base OBX %s ' "$sz"
  for ((r = 0; r < SIGNAL_RUNS; r++)); do
    SIGNAL_S="$sz" WARM_TRIALS=1 RUN_INDEX="$r" COV=0 OUT="$SIGNAL_OUT" \
      "$VITEST" run --config "$SIGNAL_CONFIG" signal-check --silent >/dev/null 2>&1 \
      || { echo "FAILED at run $r" >&2; exit 1; }
    printf '.'
  done
  printf ' ok\n'
done

# REFUSE A SHORT CAPTURE. `window.mjs` derives an extreme-value figure, and an extreme of a
# truncated sample is simply wrong rather than noisy: fewer rows can only make the worst false alarm
# smaller and the weakest signal larger, which moves the answer toward "it separates" in both
# directions at once. So the row counts are asserted, and a short file stops the run here rather
# than being summarised.
expected_signal=0
for sz in $SIGNAL_SIZES; do expected_signal=$((expected_signal + SIGNAL_RUNS * 2)); done
noise_rows="$(wc -l < "$NOISE_OUT")"
signal_rows="$(wc -l < "$SIGNAL_OUT")"
echo
echo "rows: noise $noise_rows/$NOISE_RUNS, signal $signal_rows/$expected_signal (2 per run: cold, warm)"
if [ "$noise_rows" -ne "$NOISE_RUNS" ] || [ "$signal_rows" -ne "$expected_signal" ]; then
  echo "run.sh: REFUSING to summarise a short capture. Expected $NOISE_RUNS noise rows and" >&2
  echo "  $expected_signal signal rows. A partial dataset yields a WRONG window, not a noisy one." >&2
  exit 1
fi

echo
node "$HERE/window.mjs" --noise "$NOISE_OUT" --signal "$SIGNAL_OUT"
