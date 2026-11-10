# The benchmark calibration

The runs behind the numbers in section 5 of
[ADR 0005](../../documentation/decisions/0005-the-performance-standard.md), the performance
standard. A committed experiment, the same shape as `../perf-calibration/`: nothing here is exported
from a package, nothing runs in `pnpm test`, and nothing else in the repository imports it.

## The questions

1. **How often does the base against head comparison call a regression when nothing changed?** An
   A/A calibration: many full comparisons of the PHI scan engine against a copy of itself in another
   directory. Every `regression` is a false alarm. This is what the standard's rule for making the
   comparison a required check reads, together with how often a comparison skips a case: each must
   be under 1% per comparison, with 95% confidence. A skipped case is never counted as a pass.
2. **How large a slowdown does it find?** The same comparisons with a planted slowdown on the head
   side (`--inject`): after each timed pass the clock is spun for that fraction of the pass's own
   measured time. The change a comparison then measures is not exactly that fraction (the spin
   changes the loop the engine compiles and what the processor does between passes), so every
   calibration reports the change each case was observed at, and a detection rate is read against
   that. Every `regression` is a detection.
3. **What does the comparison do on a large case?** An A/A calibration of `large.bench.mjs`, a
   parser written for this on 4 MiB of synthetic text, whose calls outlast a warmup batch, so every
   process runs on the large-case plan; and a reading of the same suite with the runner before the
   plan and with it.
4. **What slope does the long run read for a known leak?** Readings of `decodeSourceLiterals` through
   `leak-target.mjs`, which retains one small object every `LEAK_EVERY` calls (0, 64, 16 or 1).

## Files

| File                                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibrate.sh`                            | Questions 1 to 3: `<inject> <batches> <comparisons per batch> <first cpu or none> <lanes> <out dir>`, and `DEADLINE` (a Unix time) to stop starting batches; `SUITE` and `TARGET` point it at another suite and its target. Each lane writes one results file per batch, so a run stopped early keeps what it finished                                                                                                                                                                                                                                                                                |
| `long-run.sh`                             | Question 4: `<runs per setting> <cpu or none> <out dir>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `leak-target.mjs`, `leak.bench.mjs`       | The leaking target and its suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `large-target.mjs`, `large.bench.mjs`     | Question 3: a delimited-message parser written for the calibration, and its suite of one synthetic message of 1 MiB and of 4 MiB                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `analyze.mjs`                             | Every table in ADR 0005 section 5: `compare <dir>...` and `long-run <dir>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `data/`                                   | The runs, as `@cosyte/bench` wrote them on GitHub-hosted runners (results schema version 1, minified): `comparison/run-<id>/inject-0/shard-1` to `shard-6` for two workflow runs (448 A/A comparisons in all), `inject-0.05`, `inject-0.10` and `inject-0.20` in each (75, 77 and 78 with a planted slowdown), `long-run/` (40 readings), `phi-scan-reading.json` (the first reading in ADR 0005), and `large-case/run-<id>/`: `inject-0/shard-1` to `shard-6` (236 A/A comparisons of the large case), the large suite read before and with the large-case plan, and the PHI scan suite read with it |
| `.github/workflows/bench-calibration.yml` | All four questions on GitHub-hosted runners: when a pull request that changes the comparison's source or these scripts is opened or reopened, and by hand                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Re-running it

```sh
pnpm install --frozen-lockfile && pnpm build
# A/A, one lane, unpinned, for 80 minutes, one comparison per results file.
DEADLINE=$(( $(date +%s) + 80 * 60 )) experiments/bench-calibration/calibrate.sh 0 1000 1 none 1 "$PWD/runs/aa"
# A planted slowdown of a nominal 10% on the head side.
DEADLINE=$(( $(date +%s) + 80 * 60 )) experiments/bench-calibration/calibrate.sh 0.10 1000 1 none 1 "$PWD/runs/inject-0.10"
experiments/bench-calibration/long-run.sh 10 none "$PWD/runs/long-run"
# The large case, A/A.
SUITE="$PWD/experiments/bench-calibration/large.bench.mjs" TARGET="$PWD/experiments/bench-calibration/large-target.mjs" \
  DEADLINE=$(( $(date +%s) + 80 * 60 )) experiments/bench-calibration/calibrate.sh 0 1000 1 none 1 "$PWD/runs/large"
node experiments/bench-calibration/analyze.mjs compare runs/aa runs/inject-0.10
node experiments/bench-calibration/analyze.mjs long-run runs/long-run
node experiments/bench-calibration/analyze.mjs compare runs/large
```

Do not rebuild while a run is going: every measuring process starts from `packages/bench/dist`.
Parallel lanes share the machine, so they are noisier than one comparison alone on a runner; a
calibration that is to decide the required-check rule runs one lane per runner of the class itself,
which is what the workflow does.

## What the data is, and is not

The standard's numbers come only from runs on GitHub-hosted runners, the class a pull request's
comparison runs on. Each results file names its machine in `environment` (CPU model, logical CPUs,
Node, the runner image) and its load in `environment.loadAverage`. A run on a developer machine
measures that machine and is not committed here.
