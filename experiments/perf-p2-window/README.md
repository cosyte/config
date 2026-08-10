# PERF-P2 / O-P2-2: the window between signal and noise

A **throwaway-but-committed experiment**, the same shape as `../perf-calibration/` and
`../perf-p2-false-alarm/`. Nothing here is exported from `@cosyte/test-utils`, nothing here runs in
`pnpm test` or `pnpm test:perf`, and nothing else in the repo imports it.

## The question, which is not the one the two earlier sweeps asked

`../perf-p2-false-alarm/` measures how often the shipped gate fires on a workload that cannot
regress. PERF-P0 Experiment C measures what a genuine O(n^2) regression scores. Each is one side of
a distribution, and `PERF-P2`'s remaining question is about the **distance between them**:

> Is there any constant `RATIO_CEILING` that sits above every false alarm and below every real
> regression, on the runner class the gate would actually run on?

That is one number:

```
window = weakest genuine signal / worst false alarm
```

A window at or below **1.0x** means the two distributions overlap and **no** choice of ceiling
separates them. That is not a tuning problem, and the remedy is not a different constant: it is a
change to the sampling shape (ADR 0001 section 3), which is an **ADR revision and a founder call**,
not an edit to this directory.

Three windows had been read before this experiment existed, and **not one of them was taken on the
runner the gate would run on**:

| reading                       | box                                 | window    |
| ----------------------------- | ----------------------------------- | --------- |
| PERF-P0, GitHub-hosted        | 2 vCPU, but P0's fixed-count warmup | **2.54x** |
| `#34`'s own calibration       | 2-CPU container                     | 1.33x     |
| the 2026-08-05 re-measurement | **12**-CPU container                | **1.07x** |

The 12-CPU sweep also turned up the finding that reframed the whole item: at `1000 -> 4000`, 1 of 20
genuine O(n^2) runs scored **6.9568**, which a ceiling of 8 would have **passed**. A gate that fires
on clean code is annoying; a gate that passes a real quadratic regression is silent. Both were true
of the same constant at the same time.

## Why the two sides have to be taken on one box, in one session

A window is a difference, so both sides have to come from the same machine or the difference is not
a measurement. That is what this directory adds, and it is the only thing it adds: `run.sh` drives
the **noise** leg and the **signal** leg back to back in one process sequence, and `window.mjs`
derives the figure from the rows.

**Neither test file is copied or modified.** The noise leg launches
`../perf-p2-false-alarm/false-alarm.test.ts` through that directory's own vitest config, and the
signal leg launches `../perf-calibration/signal-check.test.ts` through that directory's own. What is
duplicated here is a `for` loop, not a measurement. The sibling's `run.sh` is deliberately not
called: it archives and rewrites its own committed dataset on start, and a driver that mutates a
committed dataset as a side effect of measuring something else is a trap for whoever runs it in a
working tree.

## The box census, which is the point and not a prelude

Every previous reading of this gate was taken on a box nobody had checked, and the class changed
**six times over** underneath the experiment with no decision behind it. Two readers in one session
reported the wrong number, both by reading `nproc`.

`run.sh` derives the box and **refuses to run on the wrong one**:

- Inside a **container**, `nproc` reports the host's cores and is the wrong answer. The cgroup
  quota is the authority. V8 sizes its concurrent GC and compiler pools from the host count while
  the cgroup throttles against the quota, which is the mechanism behind every fire in these
  datasets.
- On a **GitHub-hosted runner**, there is no container: it is a VM, its root cgroup reads
  `max 100000` (no quota), and `nproc` is the correct and only answer. Deriving the box from
  `cpu.max` alone would read "unlimited" on precisely the machine this experiment exists to
  characterise.

So: **the quota when one is set, the host count otherwise**, with the raw values recorded in
`data/environment.json` either way, so the derivation can be checked rather than believed.
`EXPECT_CPUS` defaults to **2**. Another size refuses unless `ALLOW_ANY_BOX=1`, and that flag is
recorded in the provenance as `boxAsExpected: false`, because a window from another box is a
different measurement wearing the same file names.

## Running it

The real run is `.github/workflows/perf-p2-window.yml`, dispatched by hand. It is the only place the
2-vCPU box exists, and it is not a gate.

```bash
gh workflow run "PERF-P2 window (O-P2-2)" --ref main
```

Locally, for harness work only:

```bash
mise exec node@22 -- ./run.sh --quick             # 3 noise runs, 1 signal run per size
ALLOW_ANY_BOX=1 mise exec node@22 -- ./run.sh     # on a box that is not 2 vCPU: NOT O-P2-2
node window.mjs --noise data/noise.jsonl --signal data/signal.jsonl
```

**Node 22 is required, not preferred**, for the reason both sibling drivers give: ADR 0001's
constants are calibrated on Node 22.23.1 / V8 12.4, and its review trigger 4 is "Node's major
version moves". `run.sh` refuses any other major.

Knobs: `NOISE_RUNS` (default 200, the roadmap's acceptance clause), `SIGNAL_RUNS` per size
(default 30, each run writing 2 rows), `SIGNAL_SIZES` (default `250 500 1000`), `EXPECT_CPUS`,
`ALLOW_ANY_BOX`.

## What `window.mjs` does that reading the columns by hand does not

Two traps, and both make the naive answer wrong in the direction that reads as "it separates":

1. **The noise maximum is censored.** A ratio above the ceiling makes `scalingGate` **throw**, so
   that run has no measured row at all: it is recorded as `firedRatio` with both axes
   `not-reached`. Taking the measured column's `max` as the worst false alarm therefore reads the
   worst **non-firing** run and drops every fire. `window.mjs` pools the measured and the censored
   populations and says which one the worst came from.
2. **`firedAxis` is not trustworthy on every row.** Rows written before that field was read out of
   the gate's own diagnostic inferred the axis, and inferred it wrongly. The ratio is real; the
   attribution is not. Those rows are pooled for the figure and reported as `unattributed`, never
   printed under an axis heading. `../perf-p2-false-alarm/analyze.mjs` suppresses the same rows for
   the same reason.

It also states its one judgement instead of folding it into the arithmetic. The pooled figure is
taken over fixture sizes **at or above `--fixture-floor` (default 500**, `hl7`'s own fixture and the
smallest any package ships against). Smaller fixtures are still measured and printed, because how
signal degrades with size is half of why this sweep exists, but they do not decide the shared
constant: ADR 0001 section 5 makes fixture size a per-package calibration parameter, and
`assertScalingGateFires` refuses a fixture whose signal does not clear the ceiling, so an under-sized
fixture is rejected by the shipped kit before the gate ever runs. Pass `--fixture-floor 0` to pool
everything.

## Re-deriving the earlier readings with the same tool

The 12-CPU reading was computed by hand in prose. The same rows through `window.mjs` reproduce it,
and this is worth running before trusting a new number out of the same script:

```bash
git fetch origin perf-p2-measurements-2026-08-05
B=origin/perf-p2-measurements-2026-08-05:experiments/perf-p2-measurements-2026-08-05/data
for f in runs-sweepE runs-sweepF signal; do git show "$B/$f.jsonl" > "/tmp/$f.jsonl"; done
node window.mjs --noise /tmp/runs-sweepE.jsonl --noise /tmp/runs-sweepF.jsonl \
                --signal /tmp/signal.jsonl
```

It prints worst false alarm **8.1700** (the fire, censored out of the measured column), worst
non-firing 7.6342, count-axis max 5.0354, weakest signal 8.7376 at `500 -> 2000` and 6.9568 at
`1000 -> 4000`, a per-size window of **1.07x** at `hl7`'s fixture, and a pooled separation figure of
**0.8515x**: no ceiling separates them. Every one of those matches that branch's own README, which
is the point of running it.

Sweep D is left out above on purpose. It was taken with another agent live in the same cgroup, and
contention can only make fires more likely, so its 0 fires is one sample that happened not to stall
rather than evidence of quiet.

## Traps for whoever reads this next

- **A short capture is worse than a failed one.** `window.mjs` reports an extreme, and fewer rows
  can only lower the worst false alarm and raise the weakest signal, so a truncated dataset moves
  the answer toward "it separates" from both sides at once. `run.sh` asserts the row counts and
  refuses to summarise a short file, and `window.mjs` refuses a line it cannot parse rather than
  skipping it.
- **The two sides are not sampled symmetrically.** 200 noise runs against 60 signal rows per size
  means the noise tail is explored much harder than the signal tail. That is the conservative
  direction for a "no ceiling separates" finding and the **unsafe** direction for a "it separates"
  one, so a positive result here deserves more signal runs before anything is wired into CI.
- **This directory ships no committed dataset**, unlike its two siblings, and `run.sh` truncates
  rather than archives for that reason. The real datasets live where the sweep was taken: the
  workflow uploads `perf-p2-window-data` as an artifact, and a run worth keeping goes onto its own
  measurement branch, the way `perf-p2-measurements-2026-08-05` did.
- **Nothing here may be wired into CI.** Not `test:perf`, not this workflow, not
  `verify-policy.json`. The founder decision of 2026-08-07 merged the kit with the gate deliberately
  out of CI, and settling the ceiling is the condition on adoption, not something adoption can
  precede.
