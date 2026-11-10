# The benchmark calibration

The runs behind the numbers in section 5 of
[ADR 0005](../../documentation/decisions/0005-the-performance-standard.md), the performance
standard. A committed experiment, the same shape as `../perf-calibration/`: nothing here is exported
from a package, nothing runs in `pnpm test`, and nothing else in the repository imports it.

## The questions

1. **How often does the base against head comparison call a regression when nothing changed?** An
   A/A calibration: many full comparisons of the PHI scan engine against a copy of itself in another
   directory. Every `regression` is a false alarm. This is the number the standard's rule for making
   the comparison a required check reads: under 1% per comparison, with 95% confidence.
2. **How large a slowdown does it find?** The same comparisons with the head side made slower by a
   known fraction (`--inject`): after each pass over the corpus the clock is spun for that fraction of
   the pass's own time, so the slowdown is exact whatever the workload. Every `regression` is a
   detection.
3. **What slope does the long run read for a known leak?** Readings of `decodeSourceLiterals` through
   `leak-target.mjs`, which retains one small object every `LEAK_EVERY` calls (0, 64, 16 or 1).

## Files

| File                                      | What it is                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibrate.sh`                            | Questions 1 and 2: `<inject> <batches> <comparisons per batch> <first cpu> <lanes> <out dir>`. Each lane is pinned to one logical CPU and writes one results file per batch, so a run stopped early keeps what it finished                                                      |
| `long-run.sh`                             | Question 3: `<runs per setting> <cpu> <out dir>`                                                                                                                                                                                                                                |
| `leak-target.mjs`, `leak.bench.mjs`       | The leaking target and its suite                                                                                                                                                                                                                                                |
| `analyze.mjs`                             | Every table in ADR 0005 section 5: `compare <dir>...` and `long-run <dir>`                                                                                                                                                                                                      |
| `data/`                                   | The runs, as `@cosyte/bench` wrote them (results schema version 1, minified): `comparison/aa/` (108 A/A comparisons), `comparison/inject-0.10/` (24 with a 10% slowdown), `long-run/` (40 readings), `phi-scan-reading.json` (the first reading in ADR 0005), and `loadavg.txt` |
| `.github/workflows/bench-calibration.yml` | Question 1 or 2 on a GitHub-hosted runner, dispatched by hand                                                                                                                                                                                                                   |

## Re-running it

```sh
pnpm install --frozen-lockfile && pnpm build
# A/A: 4 lanes on CPUs 2 to 5, 5 batches of 3 comparisons each.
experiments/bench-calibration/calibrate.sh 0 5 3 2 4 "$PWD/runs/aa"
# A 10% slowdown on the head side.
experiments/bench-calibration/calibrate.sh 0.10 2 3 2 4 "$PWD/runs/inject-0.10"
experiments/bench-calibration/long-run.sh 10 6 "$PWD/runs/long-run"
node experiments/bench-calibration/analyze.mjs compare runs/aa runs/inject-0.10
node experiments/bench-calibration/analyze.mjs long-run runs/long-run
```

Do not rebuild while a run is going: every measuring process starts from `packages/bench/dist`.
Parallel lanes share the machine, so they are noisier than one comparison alone on a runner; a
calibration that is to decide the required-check rule runs one lane on the runner class itself,
which is what the workflow does.

## What the data is, and is not

The runs in `data/` were taken on a developer desktop (an 8-core, 16-thread Intel i9-9900K, Node
24.22.2) while it was shared with other work. `data/loadavg.txt` is its load average, sampled once a
minute through the runs (results files written from now on carry it in `environment.loadAverage`).
They measure that machine under that load and nothing else. They are not the GitHub-hosted runner's numbers, and the standard does not read them as such:
its required-check rule needs a calibration on the runner class the comparison runs on.
