#!/usr/bin/env bash
# The long run's calibration: readings of `decodeSourceLiterals` through `leak-target.mjs` with no
# leak and with known leaks, to see what slope each reads as.
#
#   experiments/bench-calibration/long-run.sh <runs per setting> <cpu> <out dir>
#
# <cpu> pins every reading to that logical CPU with taskset; `none` leaves them unpinned.
# LEAK_EVERY=0 retains nothing; 1 retains one small object per call; 16 one per 16 calls; 64 one per
# 64 calls. Build first: `pnpm build`.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
here="$root/experiments/bench-calibration"
runs=$1
cpu=$2
out=$3
mkdir -p "$out"
pin=()
if [ "$cpu" != "none" ]; then pin=(taskset -c "$cpu"); fi

for every in 0 64 16 1; do
  for i in $(seq 1 "$runs"); do
    LEAK_EVERY=$every "${pin[@]}" node "$root/packages/bench/dist/cli.mjs" run \
      --suite "$here/leak.bench.mjs" --target "$here/leak-target.mjs" \
      --processes 1 --no-import --out "$out/every-$every-$i.json" >/dev/null 2>>"$out/log.txt"
  done
done
echo "done: $out"
