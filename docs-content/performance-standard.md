---
id: performance-standard
title: The performance standard
sidebar_label: Performance standard
description: "How every Cosyte package measures its speed, memory, import time and bundle size, how much noise each instrument has, and what it cannot detect."
---

This page is the decision record [`documentation/decisions/0005-the-performance-standard.md`](https://github.com/cosyte/config/blob/main/documentation/decisions/0005-the-performance-standard.md) in
cosyte/config, written out for this site. The record is the source: a change is made there.

- **Status:** Proposed (2026-11-10). Sections 1 to 7 decide; section 8 (the results repository)
  and section 9 (comparisons with other libraries) are a method and a proposal, and decide nothing
  until they are built. Amended the same day for large inputs: the large-case plan, allocations
  counted through collections, external memory in the peak, and the long run at a benchmark's
  largest size that fits (sections 2, 4, 5 and 6).
- **Scope:** how every `@cosyte/*` package measures its own performance: what is measured, by which
  instrument, how much noise each instrument has and how that noise was measured, what each one
  cannot detect, how a repository adopts the standard, and how results are kept.
- **Relates to:** [ADR 0001](https://github.com/cosyte/config/blob/main/documentation/decisions/0001-perf-measurement-contract.md) (the scaling gate's measurement
  contract, whose warmup rule this standard shares and whose stated limits it does not loosen) ·
  [`packages/bench/`](https://github.com/cosyte/config/tree/main/packages/bench) (the benchmark package) ·
  [`experiments/bench-calibration/`](https://github.com/cosyte/config/tree/main/experiments/bench-calibration) (every number in
  sections 5 and 7) · [`packages/script-utils/bench/`](https://github.com/cosyte/config/tree/main/packages/script-utils/bench) (the first suite).
- **Supersedes:** nothing. ADR 0001 stands unchanged, including every limit it states.

## Context

We want every package to be able to show, in its own CI and in a form a reader can check, how fast
it is, how much memory it uses, how heavy it is to load, and that a change did not make any of that
worse. ADR 0001 gave us one instrument for one question. Its scaling gate runs a workload at `N` and
at `4N` in one process and asserts the ratio stays inside a calibrated band, which catches work that
grows faster than its input. ADR 0001 is also plain about what it does not do: a constant-factor
slowdown is invisible to it, because both phases slow down together and the ratio does not move,
and from a single cloud instance a slowdown of 10% or less cannot be caught reliably by any tuning
of that technique.

What was missing:

1. **The numbers themselves.** Throughput at small and very large inputs, latency percentiles,
   memory, and the cost of loading a package had no shared instrument; a package that wanted them
   would write its own, and thirteen packages would measure thirteen ways.
2. **An instrument for constant-factor regressions.** The obvious one (run the old build in one CI
   job and the new one in another, and compare) does not work: the two runs land on different
   machines or at different times, and on a shared runner that difference is larger than the
   slowdowns we care about. The instrument has to cancel the runner's noise by construction, and
   then has to be measured, not assumed, to say how much noise is left.
3. **A record over time.** Without one, a slow drift of many small changes, each under any
   comparison's threshold, cannot be seen even in principle.

## Decision

### 1. Two instruments, two questions

| Instrument                                             | Question it answers                                                                       | Where it runs                              | Gate?                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| The scaling gate (`@cosyte/test-utils/perf`, ADR 0001) | Does the cost grow faster than the input?                                                 | `src`, through the test host, every CI run | **Required**, as today                                            |
| The benchmarks (`@cosyte/bench`)                       | How fast, how much memory, how heavy is this build, and is the head slower than the base? | the built entry, in plain Node processes   | The comparison is **advisory** until the rule in section 4 is met |

Neither replaces the other. The scaling gate catches regressions that grow with the input, at fixture
sizes each package proves are large enough. The comparison catches regressions that do not grow,
down to a size its calibration states. The readings say what the numbers are, on a named machine.

### 2. What we measure, and why each

| Measure                                | Why                                                                                                                                                                | How (`@cosyte/bench`)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Throughput, small to very large inputs | A parser that is fast on a 1 KiB message and slow on a 4 MiB one has a problem the small number hides. Each suite declares its sizes; each is measured on its own. | Per size, fresh processes; the warmup of ADR 0001 section 2, or for a large case the large-case plan below; 5 samples, each whole passes over the corpus until at least 50 ms; milliseconds per operation, operations a second, and bytes a second when the suite gives a byte count                                                                                                                                                                           |
| Latency p50, p95, p99                  | Throughput averages away the slow calls; a commit gate or a message pipeline waits on the slow ones.                                                               | One call at a time on `process.hrtime.bigint`, at least 20 calls, then until 2 s or 5,000 calls; percentiles by nearest rank, so every reported value was observed                                                                                                                                                                                                                                                                                             |
| Allocations per operation              | Allocation is the cost a throughput number spreads over garbage collections it may or may not include.                                                             | Heap growth across a window of `n` and of `2n` operations in which no collection ran, `(growth(2n) - growth(n)) / n`, in a process with a 64 MiB young generation; external (Buffer) bytes the same way. When every window collects, the largest pair is counted with its collections (below)                                                                                                                                                                  |
| Peak memory                            | What a very large input needs in memory at once, inside the V8 heap and outside it: a Buffer or an ArrayBuffer is outside.                                         | Per call, for the V8 heap, for external memory (Buffers, ArrayBuffers) and for the two together: the higher of what was in use just before any collection during the call (from `v8.GCProfiler`) and at its end, above what was in use before it, under V8's default heap sizing. Each only shrinks at a collection, so this is its high point. A memory budget reads the total; for an input under 64 KiB, its median call above the empty-call floor (below) |
| Heap flat over a long run              | A leak shows only over many operations.                                                                                                                            | 30 rounds of about 100 ms each, at least one pass each; the heap settled after each by ADR 0001 section 8's rule; a Theil-Sen slope over the last 24 rounds; `growing` when the fitted growth reaches 64 KiB. On the benchmark's long-run size and on its largest size whose rounds fit in 60 s                                                                                                                                                                |
| Cold import time and loaded bytes      | Every consumer pays the import once per process, and a CLI pays it on every run.                                                                                   | 20 fresh processes import the target and 20 import an empty module, interleaved, with no compile cache; one more records every file the import loads (a synchronous module hook) with its size and gzip size                                                                                                                                                                                                                                                   |

All of it runs against the **built entry a consumer imports, in a plain Node process**, which is
what ADR 0001 section 7 requires of a published number. Every measured call's result is summed into
a sink the runner checks, and a loop whose sink never moved is refused rather than reported: a loop
the compiler deleted produces a fast, confident and meaningless number.

**One case per process.** Each benchmark at each size runs in its own fresh process. A process that
measured several functions through one harness loop would make that loop's call site polymorphic,
and the cost of the second case would depend on which ran first. A fresh process also carries no
compiled code, heap layout or cache warmth from one side of a comparison to the other.

**Large cases.** ADR 0001 section 2's warmup rule settles when three batches in a row lie within
5% of their median, and a batch is whole passes of at least 50 ms because that aggregate is what
ADR 0001 measured as bringing pass-to-pass jitter inside 5%. A case whose single pass takes 50 ms
or more gets no aggregation: every batch is one pass. On a 4-CPU GitHub-hosted runner the passes of
a parser on a 1 to 4 MiB input, which builds a heap of a hundred MiB or more and collects it, vary by
more than 5% from one to the next, three in a row rarely agree, and 5 s holds only a few dozen of
them, so every audit of a parser so far found its large cases skipped as `warmup-unstable`. That is
a skip, not a measurement, and it left the sizes the standard most wants to see unmeasured.

So a large case gets a plan sized to its run time. When 500 ms of warmup have passed, the standard
rule has not settled, and the last three batches were each at least `LARGE_PASS_MS` a pass (one pass
each, by construction), the warmup moves to the large-case plan: one pass at a time until the median
of the last `LARGE_WARMUP_WINDOW` (5) passes lies within the same 5% of the median of the 5 before
them, or `LARGE_WARMUP_MAX_MS` (30 s) from the start pass without that, which is then
`warmup-unstable` as before. A median of 5 moves with neither of up to two stalled passes, where the
standard rule needs every one of three to agree; two windows in agreement is the same evidence the
standard rule asks for, that the code has stopped getting faster, read at the grain a long pass
allows. The samples are unchanged: 5, each whole passes until at least 50 ms, which at this size is
one pass. A case that settles by the standard rule never moves, and a case whose batches hold
several passes cannot move, so the small and middle cases warm up exactly as before. A case whose
calls take well under 50 ms can still move when a busy machine makes three of its batches single
passes of 50 ms or more at the 500 ms point; section 5 says how often that happened. Each timing
process records the plan it ended on, in a reading and in a comparison. The
scaling gate's rule, in `PERF_CONTRACT`, is not changed: it is still the one source of the standard
plan, and the scaling gate's own fixtures are sized to it.

**Allocations through collections.** A window of a call that allocates more than the 64 MiB young
generation always collects, so every large case used to skip its allocations as
`allocation-window-gc`. Now, when every window collects, the first and largest pair of windows is
counted with its collections instead (`method: "gc-accounted"`): a window allocated what the heap
grew by over it plus what each collection in it reclaimed, read from `v8.GCProfiler` as the heap in
use before the collection less the heap in use after it. The heap grows between collections only by
allocation and shrinks only at a collection, so the sum is the bytes allocated. Nothing extra is
run: the windows were already taken. External memory is counted the same way, and to make that
exact a memory process runs with `--no-concurrent-array-buffer-sweeping`, so a collection frees the
ArrayBuffers it found dead before it ends rather than on a background thread after it: without the
flag, a collection's after-reading still held them and the count fell short. A test checks both
against known amounts in real processes: an allocation 256 times another, one counted each way,
agrees within 5%, and an 8 MiB Buffer a call counts as 8 MiB a call within 5%. A case whose windows
do not collect is counted exactly as before (`method: "no-gc-window"`).

**The empty-call floor.** Reading a peak costs memory of its own: the settle, the profiler that
records each collection, the record. Four of our packages measured about 21 to 24 KiB for it with
nothing to measure, so an input of a few hundred bytes could not read under 20 times its size
whatever the code did, and one package added an empty case by hand to see it. A reading now measures
an empty call once, in its own process through the same probe (`memoryFloor`), and gives every peak
figure both raw and less the floor's median, never below zero (`peakTotalAboveFloorBytes` and the
like). Measured on a GitHub-hosted runner, the floor's median call is 3,384 bytes and its highest
29,008 (one call of 20, the first): the tens of KiB are the probe's one highest call, and they land
in a case's highest peak as well. The median is stable from run to run, about 3.4 KiB. The highest
is not: usually about 29 KiB, and once 369,888 bytes. So the floor is its median, and its highest is
not a fixed figure; nothing here should be read as a fixed 28 KiB.

So a memory budget reads, for a case whose inputs average under `FLOOR_INPUT_BYTES` (64 KiB), the
median call's total above the floor's median: the code's typical call, without the probe. Taking the
floor's highest off a case's highest instead would hide real cost, because peaks are not additive:
for the escape decoder on a 1 KiB input it gives 16,824 bytes, where the median call is 35,256 above
the floor. For any other case the budget reads the raw highest total, as before: at 64 KiB the
probe's usual highest call is about 2% of a 20 times budget, and the raw figure needs nothing from
another process. `budgetPeakBytes` applies the rule.

What the rule gives up, said plainly:

- **A cost in fewer than half the calls is not bounded.** Under 64 KiB the budget reads the median
  of the case's 20 calls (`PEAK_CALLS`), so a cost that shows in fewer than half of them does not
  move it. One reading had a highest call of 292,784 bytes against a median of 38,672, and the
  budget read the median. The raw highest stays in every reading (`peakTotalBytes`), unbudgeted.
- **The switch is a hard edge at 64 KiB.** At an average input of 64 KiB or more the budget reads
  the raw highest total; a byte under, the median call above the floor. There is no blend between
  them, so two sizes either side of the edge can read very different budgets for the same code.
- **The 2% is the usual highest, not every highest.** The one 369,888-byte floor call is about 28%
  of a 20 times budget at 64 KiB, so a large case whose highest call lands on such a probe outlier
  reads it as the code's.

**One failed case keeps the run.** A measuring process that fails (it threw, died or timed out) is a
failure of its own case and phase. A reading lists it in `failures`, with the first line of the
error only, since what follows may be the process's stderr, writes every other case, and exits 2.
Before, one such case stopped the whole run and nothing was written.

**The engine is our own.** ADR 0001 closed the library question for the scaling gate on measured
grounds (no published harness detects V8 steady state; `bench-node` measures an unoptimized tier;
`vitest bench` is experimental and outside semver; mitata is unmaintained), and the same grounds
hold here. None of them runs a base and a head interleaved in fresh processes, calibrates its own
false alarm rate, or measures the memory figures above, so we would have built those parts around
any of them. The package has no runtime dependencies. Its warmup rule is not a copy: `measure.ts`
imports `PERF_CONTRACT` from the scaling gate's own contract file and the build bundles it, so the
two instruments warm up by one rule kept in one place (a test swaps that source and sees the
benchmarks' warmup follow it).

### 3. The scaling gate stays exactly as ADR 0001 decided

Its constants, its typed skips, its self-check and its stated limits are unchanged, and nothing here
is a reason to read its limits more generously. "A 10% slowdown passes the scaling gate" stays true,
and no package may describe its scaling gate as catching constant-factor regressions. It stays the
required check for complexity regressions. What changes is that a package now has a second
instrument for the regressions it cannot see.

### 4. The comparison

A comparison is 12 rounds. In each round every case runs once on the base build and once on the
head build, each in a fresh process, back to back; even rounds run the base first, odd rounds the
head. Both builds are on one machine, in one CI job.

- A drift in the machine over the run (another tenant, a thermal change, a cgroup's quota) lands on
  both sides of a round, seconds apart, and cancels in their ratio.
- An order effect lands on the head in half the rounds and on the base in the other half, so it
  widens the spread of the ratios rather than biasing their median.

Each round gives one ratio per case: the head process's **fastest** sample over the base process's.
The fastest, not the median, for the reason ADR 0001 section 1 measured: the noise on a shared
machine is one-sided (another tenant only ever slows a sample down), and `min` is the one estimator
that keeps a stall on one side out of a ratio. Every sample is kept in the results, so another
estimator can be judged later on the same runs (`experiments/bench-calibration/analyze.mjs` does).

The verdict reads the **sign test's interval on the median ratio**: the 3rd smallest to the 3rd
largest of the 12 ratios. It assumes nothing about the shape of the noise (heavy-tailed, skewed or
bimodal), only that the rounds are independent, which a fresh process per side per round is there
to make true.

| Verdict         | Rule                                                                 | Exit |
| --------------- | -------------------------------------------------------------------- | ---- |
| `regression`    | the whole interval is above `1 + THRESHOLD` (+3%)                    | 1    |
| `improvement`   | the whole interval is below `1 / (1 + THRESHOLD)`                    | 0    |
| `no-regression` | the whole interval is at or below `1 + THRESHOLD`                    | 0    |
| `inconclusive`  | the interval straddles `1 + THRESHOLD`                               | 0    |
| `skipped`       | a process could not settle its warmup (ADR 0001's `warmup-unstable`) | 2    |

**A bound that holds by construction.** When the two sides run the same code, each ratio is as
likely to fall above the true median as below it, so the chance that the 3rd smallest of 12 lies
above 1, let alone above 1.03, is at most `P(Binomial(12, 1/2) <= 2) = 79 / 4096`, about **1.93%
per case**, whatever the noise. That is a ceiling, not the rate: the threshold pushes the real rate
below it, by an amount that depends on how noisy the runner is, which is what the calibration
measures. For a comparison of `k` cases the per-comparison ceiling is `1 - (1 - 0.0193)^k` if the
cases are independent, and at most `k` times 1.93% in any case.

**When the comparison becomes a required check.** The scaling gate stays required. The timing
comparison posts its numbers on every pull request and becomes a required check on a runner class
when an **A/A calibration on that runner class**, on the repository's own suite, shows that a
required check on unchanged code would be wrongly red under 1% of the time, for either of the two
reasons it can be:

- **False alarms.** The per-comparison false alarm rate's exact one-sided 95% upper bound
  (Clopper-Pearson) is **under 1%**. It is counted over the comparisons whose outcome is known:
  every case measured, or a regression was called. A skipped case is never a pass and never a
  trial, so comparisons that measured nothing cannot meet the rule.
- **Skips.** A skipped case makes the comparison exit 2, a red check. The rate of comparisons with
  a skipped case, over all of them, must have its 95% upper bound under 1% too.

With no false alarm and no skip at all that takes at least **299** A/A comparisons; with one, 473;
with two, 628. `cosyte-bench calibrate` computes both bounds and says whether the rule is met, and
why not. It is re-judged at every review trigger below.

The constants, and where each comes from:

| Constant                                                               | Value               | Basis                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| warmup                                                                 | ADR 0001 section 2  | **Shared.** Read from `PERF_CONTRACT` and bundled at build time                                                                                                                                                                                                                                                                                        |
| `SAMPLES`                                                              | 5                   | **Judgement.** ADR 0001's `REPS`; the fastest of 5 survives four stalled samples                                                                                                                                                                                                                                                                       |
| `SAMPLE_MIN_MS`                                                        | 50                  | **Judgement, anchored on measurement.** ADR 0001's `WARMUP_BATCH_MS`, where a 50 ms aggregate was measured to bring per-pass jitter inside 5%                                                                                                                                                                                                          |
| `ROUNDS`                                                               | 12                  | **Judgement.** The smallest even count whose sign-test rank at `ALPHA` is 3, so two wild rounds at either end cannot move the interval                                                                                                                                                                                                                 |
| `ALPHA`                                                                | 0.05                | **Judgement.** One-sided, per end; the realized tail at 12 rounds is 79 / 4096                                                                                                                                                                                                                                                                         |
| `THRESHOLD`                                                            | 3%                  | **Judgement.** The smallest change a comparison will call a regression. Section 5 measures what it costs and buys on the same runs, against 2% and 5%                                                                                                                                                                                                  |
| `REQUIRED_FALSE_ALARM_RATE`, `REQUIRED_CONFIDENCE`                     | 1%, 95%             | **Decided** for the required-check rule                                                                                                                                                                                                                                                                                                                |
| latency: `LATENCY_BUDGET_MS`, `LATENCY_MAX_CALLS`, `LATENCY_MIN_CALLS` | 2,000 ms, 5,000, 20 | **Judgement.** Bounds a case's latency time; 20 calls is the fewest that report a p50 under the next rule                                                                                                                                                                                                                                              |
| `LATENCY_TAIL_CALLS`                                                   | 10                  | **Judgement.** A percentile `q` is reported only when `n(1 - q) >= 10`: p95 needs 200 calls, p99 1,000. Below that the "percentile" is the maximum under another name                                                                                                                                                                                  |
| `LATENCY_TIMER_MULTIPLE`                                               | 20                  | **Judgement.** A median call shorter than 20 clock reads is reported as skipped (`latency-below-timer-resolution`): it would measure the clock                                                                                                                                                                                                         |
| `ALLOC_WINDOW_OPS`, `ALLOC_WINDOW_MS`, `ALLOC_SEMI_SPACE_MIB`          | 256, 100 ms, 64 MiB | **Judgement.** Windows short enough that a 64 MiB young generation rarely collects inside one; a window in which a collection ran is halved and taken again, and a case whose windows always collect is skipped, typed. The two-window difference cancels the fixed cost of reading the heap                                                           |
| `PEAK_CALLS`                                                           | 20                  | **Judgement.** The peak is a maximum; 20 calls report it and their median                                                                                                                                                                                                                                                                              |
| `FLOOR_INPUT_BYTES`                                                    | 64 KiB              | **Judgement, anchored on measurement.** The peak probe's highest empty call is usually about 29 KiB on a GitHub-hosted runner (once 369,888 bytes); at 64 KiB the usual one is about 2% of a 20 times budget, so a budget reads the median call above the empty-call floor only for an input under it. A hard edge, with what it gives up in section 2 |
| `LONG_RUN_ROUNDS`, `LONG_RUN_SETTLE_ROUNDS`, `LONG_RUN_ROUND_MS`       | 30, 5, 100 ms       | **Judgement.** 3 s of a case; the first 5 rounds left out while caches and compiled code settle                                                                                                                                                                                                                                                        |
| `LONG_RUN_GROWTH_BYTES`                                                | 64 KiB              | **Measured** (section 5): about 40 times the fitted growth of a run that retains nothing on a GitHub-hosted runner, and passed in every run by a retained 40-byte object every 64 calls over a 1 KiB decode's long run                                                                                                                                 |
| `GC_SETTLE_BYTES`, `GC_SETTLE_ROUNDS`, `GC_MAX_ROUNDS`                 | 64 KiB, 2, 7        | **Shared.** ADR 0001 section 8                                                                                                                                                                                                                                                                                                                         |
| `IMPORT_RUNS`                                                          | 20                  | **Judgement.** Enough for a median and a p95 that is not the maximum                                                                                                                                                                                                                                                                                   |
| `LARGE_PASS_MS`                                                        | 50 ms               | **Shared.** ADR 0001's `WARMUP_BATCH_MS`: at or above it a batch is one pass, so the aggregation that rule rests on cannot happen                                                                                                                                                                                                                      |
| `LARGE_WARMUP_WINDOW`                                                  | 5                   | **Judgement.** As `SAMPLES`: a median of 5 survives two stalled passes. Two windows make the fewest passes the plan settles in 10                                                                                                                                                                                                                      |
| `LARGE_WARMUP_MAX_MS`                                                  | 30 s                | **Judgement.** Ten passes of a 3 s call fit; it bounds a process of a case that never settles. Six times the standard cap, for passes up to 60 times longer than a batch                                                                                                                                                                               |
| `LONG_RUN_MAX_MS`                                                      | 60 s                | **Judgement.** The long run on the largest size: 30 rounds of a pass of up to 2 s. Its `detectableBytesPerOp` says how coarse a run of so few operations is                                                                                                                                                                                            |

### 5. Noise and its measured bounds

Every number here comes from `experiments/bench-calibration/`, where the runs, the scripts and the
analysis live; `analyze.mjs` re-derives each table from the committed data. The runs are taken on
GitHub-hosted runners (`ubuntu-latest`, one comparison per runner at a time) by
`.github/workflows/bench-calibration.yml`, which runs when a pull request that changes the
comparison is opened or reopened, and can be run by hand. A developer machine's numbers describe that machine and are not used here.

**The comparison's false alarms and detections.** Taken by two runs of the calibration workflow
on the pull request that added this standard (runs 42778129838 and 42789908888; the second started
when a document changed, on the same `@cosyte/bench` source). Each run used nine `ubuntu-latest`
runners (4 logical CPUs each; the runners drew four CPU models, AMD EPYC 7763, 9V74 and 9V45 and
Intel Xeon Platinum 8370C, on the `ubuntu26` image, Node 24.22.2), each running whole comparisons
one at a time for 80 minutes, about two minutes a comparison. The base and the head were two copies
of the PHI scan engine in two directories, over the suite's six compared cases. Six runners per run
ran A/A comparisons; one each ran a planted slowdown of a nominal 5%, 10% and 20% on the head side.

| Planted (nominal) | Comparisons | With a skip | Regression verdicts (comparisons) | Upper 95% | Measured cases | Regression verdicts (cases) | Upper 95% |
| ----------------- | ----------- | ----------- | --------------------------------- | --------- | -------------- | --------------------------- | --------- |
| none (A/A)        | 448         | 0           | 0                                 | 0.67%     | 2,688          | 0                           | 0.11%     |
| 5%                | 75          | 0           | 75                                | 100%      | 450            | 302 (67.1%)                 |           |
| 10%               | 77          | 0           | 77                                | 100%      | 462            | 427 (92.4%)                 |           |
| 20%               | 78          | 0           | 78                                | 100%      | 468            | 468 (100%)                  |           |

By case, with the change each case was observed at (the median of every measured round's head over
base, over both runs) and its detections:

| Case                          | Observed at a nominal 5% | Found | At 10% | Found | At 20% | Found |
| ----------------------------- | ------------------------ | ----- | ------ | ----- | ------ | ----- |
| runPhiScan, one file @ 1 KiB  | +5.3%                    | 53/75 | +10.5% | 77/77 | +20.8% | 78/78 |
| runPhiScan, one file @ 32 KiB | +4.8%                    | 70/75 | +10.3% | 77/77 | +20.8% | 78/78 |
| runPhiScan, one file @ 1 MiB  | +3.9%                    | 62/75 | +8.0%  | 77/77 | +16.3% | 78/78 |
| decodeSourceLiterals @ 1 KiB  | +5.0%                    | 57/75 | +10.0% | 70/77 | +19.8% | 78/78 |
| decodeSourceLiterals @ 32 KiB | +4.2%                    | 30/75 | +11.1% | 70/77 | +22.4% | 78/78 |
| decodeSourceLiterals @ 1 MiB  | +3.9%                    | 30/75 | +7.2%  | 56/77 | +17.0% | 78/78 |

What that does and does not show:

- **No false alarm and no skip in 448 A/A comparisons.** Both per-comparison rates are therefore
  under 0.67% with 95% confidence for this suite on `ubuntu-latest` with Node 24, which meets the
  rule in section 4 (`cosyte-bench calibrate`'s own summary of the same runs says so). Nothing
  becomes a required check in this change: the pull request job that would run the comparison is
  still to be built in `cosyte/.github`, Node 22 has not been calibrated, and another suite needs
  its own calibration.
- **One round's noise on this runner class is small.** With nothing changed, a round's 5th and 95th
  percentile ratios were 0.911 to 0.981 and 1.019 to 1.100, by case (`analyze.mjs` prints each).
- **What it finds depends on the case and the runner.** A slowdown observed at 16% or more was
  found every time. One observed at 7% to 11% was found in 56 to 77 of 77 comparisons by case: every
  time on the run whose 10% runner drew an EPYC 9V74 (234 of 234 cases), and 193 of 228 cases on the
  run whose 10% runner drew an EPYC 9V45, where the decoder's cases were noisier. One observed at 3.9%
  to 5.3%, near the 3% threshold, was found in 30 to 70 of 75. The interval has to clear the
  threshold whole, so a change near it is found only some of the time.
- **The planted slowdown is not the observed one.** A nominal 10% was observed at 7.2% to 11.1% by
  case, which is why every detection here is stated against the observed change.
- **The estimator and the threshold, judged on the same runs.** On the A/A runs a 2% threshold, and
  the median sample instead of the fastest, each raised one false alarm in 448 comparisons (upper
  bound 1.05%, which would not meet the rule); a 5% threshold raised none. At a nominal 5%, a 2%
  threshold found 371 of 450 cases and the median sample at 3% found 377, against 302 for the
  shipped rule; a 5% threshold found 12. The shipped rule trades some sensitivity near the threshold
  for no false alarm on these runs; changing it is review trigger 3.

**What the planted slowdown is.** `cosyte-bench calibrate --inject <f>` does one thing: on the head
side, after each timed pass over the corpus, it reads the clock until `f` times that pass's own
measured time has passed, so each sample's time includes the spin. That is not the same as the
measured code being slower by `f`. The spin changes the loop the engine compiles and what the
processor does between passes, so the change a comparison measures under it is not `f`, and differs
by workload and machine. Every calibration therefore reports, for each case, the change it observed
(the median of every measured round's head over base), and a detection rate in this standard is
stated against that observed change, never against `f`.

**The long run.** Ten readings each of `decodeSourceLiterals` on 1 KiB sources through a wrapper
that retains nothing, or one small object (about 40 bytes) every 64 calls, every 16 calls, or every
call, on one GitHub-hosted runner (AMD EPYC 9V45, 4 logical CPUs, the `ubuntu26` image, Node
24.22.2), from the calibration workflow's `readings` job:

| Retained                  | Runs | Slope, bytes per operation | Fitted growth              | Called growing |
| ------------------------- | ---- | -------------------------- | -------------------------- | -------------- |
| nothing                   | 10   | 0.0028 to 0.0031           | 1,617 B                    | 0 of 10        |
| one object every 64 calls | 10   | 0.6573 to 0.6693           | 337,368 to 371,380 B       | 10 of 10       |
| one object every 16 calls | 10   | 2.4677 to 2.5808           | 1,216,272 to 1,391,213 B   | 10 of 10       |
| one object every call     | 10   | 41.1879 to 42.0756         | 19,095,795 to 21,889,576 B | 10 of 10       |

A run that retains nothing fits about 1.6 KB of growth over its fitted span: the heap's own noise
(ADR 0001 measured about 1 KiB), not a leak. The 64 KiB line sits about 40 times above it, and a
retained object every 64 calls (about 0.66 bytes per operation) passes it about five times over in
every run. The runs did 19,200 to 23,744 operations a round, so the smallest leak this case's long
run can call growing there (`detectableBytesPerOp`, which every result reports for its own case) is
0.115 to 0.142 bytes per operation. A case with fewer, slower operations sees less: a long run of
30 calls of a 300 ms operation fits 24 of them, so it cannot call a leak under about 2.7 KB a call
growing, and says so in that number.

**The large-case plan.** Taken by the calibration workflow on the pull request that added the plan
(run 42894544614), on GitHub-hosted runners (`ubuntu-latest`, 4 logical CPUs, the `ubuntu26` image,
Node 24.22.2), over `experiments/bench-calibration/large.bench.mjs`: a delimited-message parser
written for the calibration (`large-target.mjs`), on one synthetic message of 1 MiB and of 4 MiB. A
4 MiB call takes about 127 ms there and peaks at about 240 MiB of heap, the shape of a parser's
largest case. The runs are in `data/large-case/run-42894544614/`.

The same suite, read on one runner (AMD EPYC 9V45) with the runner as it was before the plan and
with the plan (`large-reading-base.json`, `large-reading-head.json`):

| Runner     | Size  | Per op                      | p50      | Alloc/op                         | Peak heap  | Peak external | Peak total | Long run |
| ---------- | ----- | --------------------------- | -------- | -------------------------------- | ---------- | ------------- | ---------- | -------- |
| before     | 1 MiB | 32.1 ms                     | 31.9 ms  | skipped (`allocation-window-gc`) | 64.03 MiB  | n/a           | n/a        | flat     |
| before     | 4 MiB | skipped (`warmup-unstable`) | n/a      | skipped (`allocation-window-gc`) | 240.92 MiB | n/a           | n/a        |          |
| large plan | 1 MiB | 28.7 ms                     | 31.3 ms  | 76.22 MiB, collections counted   | 64.03 MiB  | 40 B          | 64.03 MiB  | flat     |
| large plan | 4 MiB | 126.6 ms, on the large plan | 128.9 ms | 298.95 MiB, collections counted  | 243.29 MiB | 40 B          | 243.29 MiB | flat     |

p95 and p99 stay `n/a` at 4 MiB: 20 calls fit the latency budget, and a percentile needs 10 calls
above it. The 4 MiB long run is the largest size's (30 calls fit its budget), so it can call a leak
growing only from about 2.7 KB a call, which its `detectableBytesPerOp` says.

The comparison on the plan: six runners each ran whole A/A comparisons of the 4 MiB case for 80
minutes, both sides the same code in two directories. The runners drew three CPU models (AMD EPYC
7763 and 9V74, Intel Xeon Platinum 8370C).

| Case                 | Comparisons | With a skip | Regression verdicts | Upper 95% | Processes on the large plan | A/A round ratio, 5th to 95th percentile |
| -------------------- | ----------- | ----------- | ------------------- | --------- | --------------------------- | --------------------------------------- |
| parseMessage @ 4 MiB | 236         | 0           | 0                   | 1.26%     | 5,654 of 5,664              | 0.924 to 1.075                          |

- **No false alarm and no skip in 236 comparisons**, every one of 5,664 processes measured. That
  bounds both rates under 1.26% with 95% confidence for this case on this runner class, which does
  not yet meet the rule in section 4 (a clean record needs 299 comparisons). A comparison of a large
  case stays advisory, as every comparison is until that rule is met on its own suite.
- **One round's noise is within the small cases' range.** A 4 MiB round's ratio spans 0.924 to
  1.075 from the 5th to the 95th percentile with nothing changed (median 0.999), against 5th
  percentiles of 0.911 to 0.981 and 95th percentiles of 1.019 to 1.100 across the small cases
  above. No detection rate has been measured on the plan yet.
- **The 10 processes on the standard plan** settled by the standard rule on a quiet moment, which
  the plan allows: it changes nothing for a case that settles.
- **The rerun of the comparison calibration above on the same pull request** found no false alarm
  and no skip in 227 A/A comparisons of the PHI scan suite, and a handful of processes of its
  slowest compared case (runPhiScan at 1 MiB, about 24 ms a call) moved to the large plan on a busy
  moment; their rounds' ratios were inside the others' spread. That run is not committed here; its
  numbers are in the pull request.

### 6. What it cannot detect

These are the sentences a package README, a pull request or a white paper may quote, and nothing
stronger:

- **A slowdown under the comparison's threshold, by design**, and on a noisy runner a good deal more
  than that: an interval wider than the slowdown is `inconclusive`, not `regression`. The size it
  reliably finds is the detection rate in section 5 for that runner class, not the threshold.
- **A slow drift of many changes, each under the threshold.** Only a series of readings over time
  can show that (section 8).
- **Anything on a machine too busy to settle.** A process whose warmup does not settle within 5 s,
  or 30 s on the large-case plan, is `skipped`, and a skip is not a pass. On a heavily loaded machine most cases skip; the comparison
  then says it could not measure rather than guessing.
- **Anything portable.** A reading belongs to the machine it was taken on; numbers from different
  runner classes, or from different packages, are not comparable.
- **Memory outside the V8 heap, in the long run**, and native memory a library allocates outside
  V8's accounting anywhere. The peak and allocations report external memory (Buffers and
  ArrayBuffers) beside the heap; the long run reads the heap only.
- **A leak below `detectableBytesPerOp`** for its case.
- **A memory cost in fewer than half the calls of a small input.** Under 64 KiB a budget reads the
  median of 20 calls, so it does not bound a cost that shows in fewer than 10 of them (section 2).
- **What a bundler keeps.** The loaded bytes are what Node loads for the entry; tree shaking depends
  on what a consumer imports.
- **Real I/O, network or concurrency.** Every workload is synthetic and in memory, apart from the
  files a suite writes for itself.

### 7. How a repository adopts it

1. **The scaling gate**, exactly as ADR 0001 and `@cosyte/test-utils`' README describe, in a
   `test:perf` script with its own non-instrumented Vitest config, and its self-check at the
   gate's own fixture sizes. It is the required check.
2. **A suite**, `bench/<name>.bench.mjs`, over the built entry a consumer imports: a size a typical
   input has, a large one, and one far past what a hand-written input reaches. Corpora are built in
   code, never read from a file. A size whose processes are too slow for a pull request is marked
   `compare: false`: readings still measure it. A memory budget reads the peak's total, which counts
   Buffers and ArrayBuffers as well as the V8 heap: `budgetPeakBytes` gives it, the median call
   above the empty-call floor for an input under 64 KiB and the raw highest (`peakTotalBytes`) for
   any other.
3. **A reading** on the default branch: `cosyte-bench run --suite ... --target dist/index.mjs --out
...`, kept with its machine (section 8).
4. **The comparison on every pull request**: the base checked out and built beside the head, then
   `cosyte-bench compare --suite ... --base <base>/dist/index.mjs --head dist/index.mjs --summary
...`, in one job, so both builds run on one machine. Its Markdown goes in the job summary. It is a
   reusable job in `cosyte/.github`, and it is advisory until the rule in section 4 is met.
5. **A calibration on the runner class the comparison runs on**: an A/A run first, then planted
   slowdowns of a nominal 5%, 10% and 20% for the detection rate, read against the change each case
   was observed at, and again at every review trigger. In this repository that is
   `.github/workflows/bench-calibration.yml`, which runs when a pull request that changes the
   comparison's source or the calibration scripts is opened or reopened, and by hand.

`config` adopts it first, on the PHI scan engine in `@cosyte/script-utils`, which runs in every
parser's commit gate: `packages/script-utils/bench/phi-scan.bench.mjs` measures the whole engine on
one file (`runPhiScan` with a path, the way `cosyte-phi-scan <path>` runs) and the escape decoder
alone (`decodeSourceLiterals`), each at 1 KiB, 32 KiB, 1 MiB and 4 MiB of synthetic TypeScript.
`pnpm bench:phi-scan` takes a reading. The first one, on one GitHub-hosted runner (AMD EPYC 9V45, 4
logical CPUs, the `ubuntu26` image, Node 24.22.2), from the calibration workflow's `readings` job
(`experiments/bench-calibration/data/phi-scan-reading.json`):

| Benchmark            | Size   | Per op   | Bytes/s    | p50      | p95     | p99     | Alloc/op | Peak heap  | Long run |
| -------------------- | ------ | -------- | ---------- | -------- | ------- | ------- | -------- | ---------- | -------- |
| runPhiScan, one file | 1 KiB  | 31.2 us  | 33.2 MiB/s | 30.1 us  | 37.5 us | 84.4 us | 56.6 KiB | 84.2 KiB   | flat     |
| runPhiScan, one file | 32 KiB | 425 us   | 73.6 MiB/s | 403 us   | 443 us  | 791 us  | 1.27 MiB | 1.25 MiB   |          |
| runPhiScan, one file | 1 MiB  | 23.1 ms  | 43.3 MiB/s | 23.1 ms  | n/a     | n/a     | skipped  | 37.4 MiB   |          |
| runPhiScan, one file | 4 MiB  | 126.3 ms | 31.7 MiB/s | 119.8 ms | n/a     | n/a     | skipped  | 130.56 MiB |          |
| decodeSourceLiterals | 1 KiB  | 4.44 us  | 233 MiB/s  | 4.19 us  | 4.50 us | 9.61 us | 33.1 KiB | 39.4 KiB   | flat     |
| decodeSourceLiterals | 32 KiB | 132 us   | 237 MiB/s  | 129 us   | 138 us  | 358 us  | 1000 KiB | 1 MiB      |          |
| decodeSourceLiterals | 1 MiB  | 4.46 ms  | 224 MiB/s  | 4.76 ms  | 5.00 ms | n/a     | 31.2 MiB | 31.43 MiB  |          |
| decodeSourceLiterals | 4 MiB  | 71.1 ms  | 56.3 MiB/s | 71.6 ms  | n/a     | n/a     | skipped  | 120.41 MiB |          |

Cold import of `phi-scan.js`: median 5.43 ms, p95 5.63 ms over 20 fresh processes (an empty module:
0.25 ms); one file, 112.3 KiB, 36.2 KiB gzipped. "n/a" for a percentile means fewer than 10 calls lay
above it; "skipped" is a typed refusal, never a number (here `allocation-window-gc`: every window
of a very large call collected).

One thing in it is a finding rather than a number. The escape decoder's cost per byte rises above
about 1 MiB: from 1 MiB to 4 MiB its time per operation goes from 4.46 ms to 71.1 ms, 16 times the
time for four times the input, which at those sizes the scaling gate's ceiling of 8 would flag. We
have not changed the engine here.

### 8. Keeping results over time (a proposal)

Nothing in this section is decided. It is the shape we propose for `cosyte/benchmarks`, written down
so the pieces built now do not have to change for it. Every results document already carries what
the repository needs: `schemaVersion`, the tool and its version, the time, the suite, the machine
(Node, V8, CPU, the runner's image and a `runner.class` key), the commit, every sample, and the
constants in force.

```
cosyte/benchmarks
  README.md                      what is here, how it was measured, how to read it
  METHOD.md                      a copy of this standard's sections 2 to 6, versioned with the data
  schema/results-v1.schema.json  the schema, from @cosyte/bench
  results/<package>/<runner class>/<node major>/<yyyy>/<yyyy-mm-dd>-<short sha>.json
                                 one reading per default-branch commit, as written
  calibrations/<runner class>/<yyyy-mm-dd>-<inject>.json
                                 each A/A and injected calibration, as written
  comparisons/<format>/<yyyy-mm-dd>/...
                                 the comparison suite's runs (section 9), when there are any
  series/<package>.jsonl         derived: one line per case per reading, rebuilt from results/
```

- **Written only from a default branch**, by a scheduled or post-merge job that takes a reading and
  commits it; a pull request's comparison stays a workflow artifact and a job summary.
- **Read only within one class.** A change point is meaningful inside one runner class and one Node
  major version, both in every path and every document; ADR 0001 measured a significant shift from
  a runner image update with no code change. A drift report compares like with like or says it
  cannot.
- **Validated on the way in**, with `cosyte-bench check`; a document that does not match its
  schema is refused.
- **What a series can show that a comparison cannot**: a slow drift of many changes each under the
  threshold. That is the one gap the comparison leaves by design.
- Charts on docs.cosyte.com read `series/`; that is a later step.

### 9. A fair comparison with other libraries (method only)

No comparison has been run, and anything published from one waits for the owner's words. This is
how one would be run.

- **Same input, same work.** Each library parses the same synthetic corpora, built by our own
  generators, to the closest equivalent of the same result (a parsed message tree). Where a library
  does more (validation, normalization) or less, the difference is written beside its number, never
  hidden in it.
- **Each at its defaults.** No library is tuned, and neither is ours. A non-default setting appears
  only when a library's documentation says it is the normal way to use it, and then for every library
  that has one.
- **One harness, one machine, one run.** The same `@cosyte/bench` suite shape, with each library's
  entry as a target; every library measured in the same job on the same runner, interleaved by
  round as the comparison is, so no library gets the quiet half of the run.
- **Correctness first.** Each library's output on every corpus is checked against a known answer
  before it is timed; a library that fails a corpus is reported as failing it, not timed on it.
- **Everything published.** Versions, the runner class, the corpora's generators, the raw results
  and this method, in `cosyte/benchmarks/comparisons/`, so anyone can rerun it and get their own
  numbers.
- **Every library's authors are told** before anything is published, and their corrections are taken
  in.

## Consequences

**Positive.** Every package can say how fast it is at every size it cares about, how much memory it
uses and what its import costs, measured one way and kept with its machine. A change that slows a
package down has an instrument aimed at it, with a false alarm rate bounded by construction and
measured on its runner. The two instruments warm up by one rule, and the scaling gate's limits are
carried over unchanged.

**Negative.** A comparison costs about 24 fresh processes per case, most of their time in warmup: a
few minutes per suite. A suite with many slow cases has to mark some `compare: false`. A large case
costs more again: its warmup takes at least 10 of its calls and up to 30 s, and its long run up to
a minute. The bounds
hold only for the runner class they were measured on, so a new runner class needs its own
calibration before its verdicts mean anything, and on a busy machine the comparison mostly skips.

**Review triggers.**

1. The comparison moves to a runner class it has not been calibrated on, including the first GitHub
   hosted runner it runs on.
2. The runner image or Node's major version changes.
3. `SAMPLES`, `SAMPLE_MIN_MS`, `ROUNDS`, `THRESHOLD`, the estimator, the warmup rule or the
   large-case plan's constants change. Each moves what the calibration measured.
4. A false alarm in the wild: a `regression` on a change that a rerun, or a reading of the code,
   shows did not slow anything down.
5. An A/A calibration in which more than a tenth of the cases skip: the runner is too noisy for this
   method as it stands.
