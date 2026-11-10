#!/usr/bin/env bash
# The comparison's calibration: many full base against head comparisons of the PHI scan engine
# against a copy of itself, in parallel lanes, each lane pinned to one logical CPU.
#
#   experiments/bench-calibration/calibrate.sh <inject> <batches> <comparisons per batch> <first cpu> <lanes> <out dir>
#
# <inject> 0 is an A/A calibration: both sides run the same code from two directories, so every
# regression verdict is a false alarm. Above 0 the head side is made slower by that fraction, so a
# regression verdict is a detection. Each lane writes one results file per batch, so a run stopped
# early keeps what it finished. Build first (`pnpm build`), and do not rebuild while it runs.
# COSYTE_ROOT points it at another copy of the repository.
set -euo pipefail

root=${COSYTE_ROOT:-$(git rev-parse --show-toplevel)}
inject=$1
batches=$2
per=$3
first_cpu=$4
lanes=$5
out=$6

mkdir -p "$out"
work=$(mktemp -d "${TMPDIR:-/tmp}/cosyte-bench-calibrate-XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/base" "$work/head"
cp "$root/packages/script-utils/phi-scan.js" "$work/base/phi-scan.js"
cp "$root/packages/script-utils/phi-scan.js" "$work/head/phi-scan.js"

for lane in $(seq 0 $((lanes - 1))); do
  cpu=$((first_cpu + lane))
  (
    for batch in $(seq 1 "$batches"); do
      taskset -c "$cpu" node "$root/packages/bench/dist/cli.mjs" calibrate \
        --suite "$root/packages/script-utils/bench/phi-scan.bench.mjs" \
        --base "$work/base/phi-scan.js" --head "$work/head/phi-scan.js" \
        --comparisons "$per" --inject "$inject" \
        --out "$out/lane-$lane-batch-$batch.json" >/dev/null 2>>"$out/lane-$lane.log"
    done
  ) &
done
wait
echo "done: $out"
