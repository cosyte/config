# 0005: The performance standard

- **Status:** Proposed (2026-11-10). Sections 1 to 7 decide; section 8 (the results repository)
  and section 9 (comparisons with other libraries) are a method and a proposal, and decide nothing
  until they are built.
- **Scope:** how every `@cosyte/*` package measures its own performance: what is measured, by which
  instrument, how much noise each instrument has and how that noise was measured, what each one
  cannot detect, how a repository adopts the standard, and how results are kept.
- **Relates to:** [ADR 0001](0001-perf-measurement-contract.md) (the scaling gate's measurement
  contract, whose warmup rule this standard shares and whose stated limits it does not loosen) ·
  [`packages/bench/`](../../packages/bench) (the benchmark package) ·
  [`experiments/bench-calibration/`](../../experiments/bench-calibration) (every number in
  sections 5 and 7) · [`packages/script-utils/bench/`](../../packages/script-utils/bench) (the first suite).
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

| Measure                                | Why                                                                                                                                                                | How (`@cosyte/bench`)                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Throughput, small to very large inputs | A parser that is fast on a 1 KiB message and slow on a 4 MiB one has a problem the small number hides. Each suite declares its sizes; each is measured on its own. | Per size, fresh processes; the warmup of ADR 0001 section 2; 5 samples, each whole passes over the corpus until at least 50 ms; milliseconds per operation, operations a second, and bytes a second when the suite gives a byte count                           |
| Latency p50, p95, p99                  | Throughput averages away the slow calls; a commit gate or a message pipeline waits on the slow ones.                                                               | One call at a time on `process.hrtime.bigint`, at least 20 calls, then until 2 s or 5,000 calls; percentiles by nearest rank, so every reported value was observed                                                                                              |
| Allocations per operation              | Allocation is the cost a throughput number spreads over garbage collections it may or may not include.                                                             | Heap growth across a window of `n` and of `2n` operations in which no collection ran, `(growth(2n) - growth(n)) / n`, in a process with a 64 MiB young generation; external (Buffer) bytes the same way                                                         |
| Peak heap                              | What a very large input needs in memory at once.                                                                                                                   | Per call: the higher of the heap just before any collection during the call (from `v8.GCProfiler`) and the heap at its end, above the settled heap before it, under V8's default heap sizing. The heap only shrinks at a collection, so this is its high point. |
| Heap flat over a long run              | A leak shows only over many operations.                                                                                                                            | 30 rounds of about 100 ms each; the heap settled after each by ADR 0001 section 8's rule; a Theil-Sen slope over the last 24 rounds; `growing` when the fitted growth reaches 64 KiB                                                                            |
| Cold import time and loaded bytes      | Every consumer pays the import once per process, and a CLI pays it on every run.                                                                                   | 20 fresh processes import the target and 20 import an empty module, interleaved, with no compile cache; one more records every file the import loads (a synchronous module hook) with its size and gzip size                                                    |

All of it runs against the **built entry a consumer imports, in a plain Node process**, which is
what ADR 0001 section 7 requires of a published number. Every measured call's result is summed into
a sink the runner checks, and a loop whose sink never moved is refused rather than reported: a loop
the compiler deleted produces a fast, confident and meaningless number.

**One case per process.** Each benchmark at each size runs in its own fresh process. A process that
measured several functions through one harness loop would make that loop's call site polymorphic,
and the cost of the second case would depend on which ran first. A fresh process also carries no
compiled code, heap layout or cache warmth from one side of a comparison to the other.

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

| Constant                                                               | Value               | Basis                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| warmup                                                                 | ADR 0001 section 2  | **Shared.** Read from `PERF_CONTRACT` and bundled at build time                                                                                                                                                                                                                              |
| `SAMPLES`                                                              | 5                   | **Judgement.** ADR 0001's `REPS`; the fastest of 5 survives four stalled samples                                                                                                                                                                                                             |
| `SAMPLE_MIN_MS`                                                        | 50                  | **Judgement, anchored on measurement.** ADR 0001's `WARMUP_BATCH_MS`, where a 50 ms aggregate was measured to bring per-pass jitter inside 5%                                                                                                                                                |
| `ROUNDS`                                                               | 12                  | **Judgement.** The smallest even count whose sign-test rank at `ALPHA` is 3, so two wild rounds at either end cannot move the interval                                                                                                                                                       |
| `ALPHA`                                                                | 0.05                | **Judgement.** One-sided, per end; the realized tail at 12 rounds is 79 / 4096                                                                                                                                                                                                               |
| `THRESHOLD`                                                            | 3%                  | **Judgement.** The smallest change a comparison will call a regression. Section 5 measures what it costs and buys on the same runs, against 2% and 5%                                                                                                                                        |
| `REQUIRED_FALSE_ALARM_RATE`, `REQUIRED_CONFIDENCE`                     | 1%, 95%             | **Decided** for the required-check rule                                                                                                                                                                                                                                                      |
| latency: `LATENCY_BUDGET_MS`, `LATENCY_MAX_CALLS`, `LATENCY_MIN_CALLS` | 2,000 ms, 5,000, 20 | **Judgement.** Bounds a case's latency time; 20 calls is the fewest that report a p50 under the next rule                                                                                                                                                                                    |
| `LATENCY_TAIL_CALLS`                                                   | 10                  | **Judgement.** A percentile `q` is reported only when `n(1 - q) >= 10`: p95 needs 200 calls, p99 1,000. Below that the "percentile" is the maximum under another name                                                                                                                        |
| `LATENCY_TIMER_MULTIPLE`                                               | 20                  | **Judgement.** A median call shorter than 20 clock reads is reported as skipped (`latency-below-timer-resolution`): it would measure the clock                                                                                                                                               |
| `ALLOC_WINDOW_OPS`, `ALLOC_WINDOW_MS`, `ALLOC_SEMI_SPACE_MIB`          | 256, 100 ms, 64 MiB | **Judgement.** Windows short enough that a 64 MiB young generation rarely collects inside one; a window in which a collection ran is halved and taken again, and a case whose windows always collect is skipped, typed. The two-window difference cancels the fixed cost of reading the heap |
| `PEAK_CALLS`                                                           | 20                  | **Judgement.** The peak is a maximum; 20 calls report it and their median                                                                                                                                                                                                                    |
| `LONG_RUN_ROUNDS`, `LONG_RUN_SETTLE_ROUNDS`, `LONG_RUN_ROUND_MS`       | 30, 5, 100 ms       | **Judgement.** 3 s of a case; the first 5 rounds left out while caches and compiled code settle                                                                                                                                                                                              |
| `LONG_RUN_GROWTH_BYTES`                                                | 64 KiB              | **Judgement, pending a check.** Meant to sit above the fitted growth of a run that retains nothing and to be reached by a retained 40-byte object every 64 calls over a 1 KiB decode's long run; section 5's long-run calibration checks both                                                |
| `GC_SETTLE_BYTES`, `GC_SETTLE_ROUNDS`, `GC_MAX_ROUNDS`                 | 64 KiB, 2, 7        | **Shared.** ADR 0001 section 8                                                                                                                                                                                                                                                               |
| `IMPORT_RUNS`                                                          | 20                  | **Judgement.** Enough for a median and a p95 that is not the maximum                                                                                                                                                                                                                         |

### 5. Noise and its measured bounds

Every number here comes from `experiments/bench-calibration/`, where the runs, the scripts and the
analysis live; `analyze.mjs` re-derives each table from the committed data. The runs are taken on
GitHub-hosted runners (`ubuntu-latest`, one comparison per runner at a time) by
`.github/workflows/bench-calibration.yml`, which runs on a pull request that changes the comparison
and can be run by hand. A developer machine's numbers describe that machine and are not used here.

**The comparison's false alarms and detections.** Pending. The runner calibration started by the
pull request that adds this standard had not finished when this was written, so this standard
states no false alarm rate and no detection rate yet. Until it does, the comparison is advisory, as
it would be anyway until the rule in section 4 is met.

**What the planted slowdown is.** `cosyte-bench calibrate --inject <f>` does one thing: on the head
side, after each timed pass over the corpus, it reads the clock until `f` times that pass's own
measured time has passed, so each sample's time includes the spin. That is not the same as the
measured code being slower by `f`. The spin changes the loop the engine compiles and what the
processor does between passes, so the change a comparison measures under it is not `f`, and differs
by workload and machine. Every calibration therefore reports, for each case, the change it observed
(the median of every measured round's head over base), and a detection rate in this standard is
stated against that observed change, never against `f`.

**The long run.** Pending, from the same workflow: ten readings each of `decodeSourceLiterals` on
1 KiB sources through a wrapper that retains nothing, or one small object (about 40 bytes) every 64
calls, every 16 calls, or every call. The `LONG_RUN_GROWTH_BYTES` line of 64 KiB is checked against
them when they land.

### 6. What it cannot detect

These are the sentences a package README, a pull request or a white paper may quote, and nothing
stronger:

- **A slowdown under the comparison's threshold, by design**, and on a noisy runner a good deal more
  than that: an interval wider than the slowdown is `inconclusive`, not `regression`. The size it
  reliably finds is the detection rate in section 5 for that runner class, not the threshold.
- **A slow drift of many changes, each under the threshold.** Only a series of readings over time
  can show that (section 8).
- **Anything on a machine too busy to settle.** A process whose warmup does not settle within 5 s is
  `skipped`, and a skip is not a pass. On a heavily loaded machine most cases skip; the comparison
  then says it could not measure rather than guessing.
- **Anything portable.** A reading belongs to the machine it was taken on; numbers from different
  runner classes, or from different packages, are not comparable.
- **Memory outside the V8 heap**, in the peak and the long run. Allocations report external bytes
  separately; the peak does not include them.
- **A leak below `detectableBytesPerOp`** for its case.
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
   `compare: false`: readings still measure it.
3. **A reading** on the default branch: `cosyte-bench run --suite ... --target dist/index.mjs --out
...`, kept with its machine (section 8).
4. **The comparison on every pull request**: the base checked out and built beside the head, then
   `cosyte-bench compare --suite ... --base <base>/dist/index.mjs --head dist/index.mjs --summary
...`, in one job, so both builds run on one machine. Its Markdown goes in the job summary. It is a
   reusable job in `cosyte/.github`, and it is advisory until the rule in section 4 is met.
5. **A calibration on the runner class the comparison runs on**: an A/A run first, then planted
   slowdowns of a nominal 5%, 10% and 20% for the detection rate, read against the change each case
   was observed at, and again at every review trigger. In this repository that is
   `.github/workflows/bench-calibration.yml`, which runs on every pull request that changes the
   comparison's source or the calibration scripts, and by hand.

`config` adopts it first, on the PHI scan engine in `@cosyte/script-utils`, which runs in every
parser's commit gate: `packages/script-utils/bench/phi-scan.bench.mjs` measures the whole engine on
one file (`runPhiScan` with a path, the way `cosyte-phi-scan <path>` runs) and the escape decoder
alone (`decodeSourceLiterals`), each at 1 KiB, 32 KiB, 1 MiB and 4 MiB of synthetic TypeScript.
`pnpm bench:phi-scan` takes a reading. The first reading on a GitHub-hosted runner is pending, from
the `readings` job of the same calibration workflow.

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
few minutes per suite. A suite with many slow cases has to mark some `compare: false`. The bounds
hold only for the runner class they were measured on, so a new runner class needs its own
calibration before its verdicts mean anything, and on a busy machine the comparison mostly skips.

**Review triggers.**

1. The comparison moves to a runner class it has not been calibrated on, including the first GitHub
   hosted runner it runs on.
2. The runner image or Node's major version changes.
3. `SAMPLES`, `SAMPLE_MIN_MS`, `ROUNDS`, `THRESHOLD`, the estimator or the warmup rule changes. Each
   moves what the calibration measured.
4. A false alarm in the wild: a `regression` on a change that a rerun, or a reading of the code,
   shows did not slow anything down.
5. An A/A calibration in which more than a tenth of the cases skip: the runner is too noisy for this
   method as it stands.
