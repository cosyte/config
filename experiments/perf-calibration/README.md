# PERF-P0 — calibration

**Status: complete.** The output is `ANALYSIS.md` (the written analysis and the three constants) plus
the committed datasets under `data/`. Read `ANALYSIS.md` first; this file is how to re-run it.

This is a **throwaway-but-committed experiment**, not a published API. Nothing here is exported from
`@cosyte/test-utils`, nothing here runs in `pnpm test`, and nothing else in the repo imports it. It
exists because the roadmap (`operations/roadmaps/config-perf.md` §8/P0) will not let P1 freeze the
kit's constants on judgement when they can be measured.

## What it answers

| #   | Question                                                                                      | Where        |
| --- | --------------------------------------------------------------------------------------------- | ------------ |
| 1   | What is the empirical distribution of the 4N-vs-N ratio on a linear workload?                 | Experiment A |
| 2   | Does phase **ordering** move it? (C5 — the one confound a same-process ratio does not cancel) | Experiment A |
| 3   | Does `--coverage` move it? (V1 — mechanism-only until now)                                    | Experiment A |
| 4   | How many `gc()` rounds settle `heapUsed`, on a real **Node 22** binary? (M3, §10/O7)          | Experiment B |
| 5   | Does `gc(true)` really scavenge on Node 22? (M2)                                              | Experiment B |
| 6   | Sync vs async `gc()` — does the async form settle in fewer rounds? (§10/O4)                   | Experiment B |

## Experiment A — ratio distribution

`ratio-calibration.test.ts`, hosted in **vitest** because the gate it calibrates will be. The workload
(`workload.ts`) is a linear-by-construction HL7-shaped parser, so **every ratio recorded is a
false alarm by definition** — the spread is the noise the ceiling has to clear, and nothing else.

Cells: `{count, size} axis` × `{NF, FN} ordering` × `{coverage on, off}` = 8.
Each cell is swept with 50 **fresh vitest processes**, each contributing 1 `cold` ratio (the first
trial after an `hl7`-shaped fixed-count warmup — the only measurement a real CI gate ever takes) and
3 `warm` ratios (the steady-state noise floor). 200 ratios per cell, 1,600 in total.

The split is weighted toward `cold` on purpose: a real gate only ever takes a cold measurement, so
that is the distribution the ceiling must clear. `warm` is here to separate "the ratio is noisy"
from "V8 had not settled yet", not to pad the sample.

Every phase's **full sample vector** is recorded, never a reduced statistic, and four estimators
(`min`, `median`, `trimmedMean`, `mean`) are computed from it — W2 says min-of-N is unbacked, and
choosing the estimator is P1's call, not P0's.

## Experiment B — GC fixpoint

`gc-fixpoint.mjs`, plain `node --expose-gc` (no vitest — this is a property of the runtime, not the
host). Each trial builds a ~23 MB object graph, forces two major GCs to promote it into old space,
drops it, then probes rounds to a fixpoint. Old space is the point: a scavenge reclaims young-gen
garbage, so young garbage would make the broken `gc(true)` idiom look correct.

## Pre-registered decision rule

Recorded here **before the sweep was run**, per the roadmap's fail-safe clause, so the reading of the
coverage leg is not chosen after seeing it. `test/perf/**` must be excluded from the coverage run iff
either holds, on any cell, for the estimator P1 adopts:

- **Shifted:** the coverage-on median ratio differs from the coverage-off median ratio by **> 5%**
  relative; or
- **Wider:** the coverage-on **p95** ratio exceeds the coverage-off p95 ratio by **> 15%** relative.

Otherwise coverage stays on and V1's mechanism, while real, is recorded as immaterial at this scale.

_(Amendment, logged: the tail statistic was written as p99 and changed to p95 before the sweep, after
a 3-run smoke test showed that at n=50 per cold cell the p99 is just the maximum — a rule that trips
on one outlier is not a rule. Nothing had been measured at full sample size when this changed.)_

## Running it

```bash
# Node 22 required — O7: pass 4 of the research ran only on Node v24.18.0.
experiments/perf-calibration/run.sh              # full sweep, ~15 min, writes data/
experiments/perf-calibration/run.sh --quick      # 3 runs per cell, for a smoke check
node experiments/perf-calibration/analyze.mjs    # re-derive ANALYSIS.md's tables from data/
```

The GitHub-hosted leg is `.github/workflows/perf-calibration.yml` (`workflow_dispatch` only). It runs
the same `run.sh` on `ubuntu-latest` and uploads `data/` as an artifact — that is where the numbers in
`ANALYSIS.md` marked _GitHub-hosted_ come from.

## Known limitations

One point in time, one workload shape. C4 says the runner image _will_ drift and fake a regression;
re-run this when the image generation changes, and treat the constants as due for review, not as
settled forever. See `ANALYSIS.md` §7 for the full list.

Two runner classes were swept and they are **not** interchangeable — the GitHub-hosted runner was
quiet enough that calibrating only there would have hidden the finding the constants turn on. Both
datasets are committed (`data/` is the container leg, `data/github-hosted/` the `ubuntu-latest` one);
neither is reported instead of the other.
