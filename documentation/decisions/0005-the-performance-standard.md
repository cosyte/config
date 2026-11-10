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
  section 5) · [`packages/script-utils/bench/`](../../packages/script-utils/bench) (the first suite).
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
any of them. The package has no runtime dependencies. The warmup constants are restated in
`@cosyte/bench` rather than imported, and a test holds them equal to `PERF_CONTRACT`, so the two
instruments warm up by one rule.

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
when an **A/A calibration on that runner class**, on the repository's own suite, shows a
per-comparison false alarm rate whose exact one-sided 95% upper bound (Clopper-Pearson) is **under
1%**. With no false alarm at all that takes at least **299** A/A comparisons; with one, 473; with
two, 628. `cosyte-bench calibrate` computes the bound and says whether the rule is met. It is
re-judged at every review trigger below.

The constants, and where each comes from:

| Constant                                                               | Value               | Basis                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| warmup                                                                 | ADR 0001 section 2  | **Shared.** Restated, and held equal to `PERF_CONTRACT` by a test                                                                                                                                                                                                                                                                                                                              |
| `SAMPLES`                                                              | 5                   | **Judgement.** ADR 0001's `REPS`; the fastest of 5 survives four stalled samples                                                                                                                                                                                                                                                                                                               |
| `SAMPLE_MIN_MS`                                                        | 50                  | **Judgement, anchored on measurement.** ADR 0001's `WARMUP_BATCH_MS`, where a 50 ms aggregate was measured to bring per-pass jitter inside 5%                                                                                                                                                                                                                                                  |
| `ROUNDS`                                                               | 12                  | **Judgement.** The smallest even count whose sign-test rank at `ALPHA` is 3, so two wild rounds at either end cannot move the interval                                                                                                                                                                                                                                                         |
| `ALPHA`                                                                | 0.05                | **Judgement.** One-sided, per end; the realized tail at 12 rounds is 79 / 4096                                                                                                                                                                                                                                                                                                                 |
| `THRESHOLD`                                                            | 3%                  | **Judgement.** The smallest change a comparison will call a regression. Section 5 measures what it costs and buys on the same runs, against 2% and 5%                                                                                                                                                                                                                                          |
| `REQUIRED_FALSE_ALARM_RATE`, `REQUIRED_CONFIDENCE`                     | 1%, 95%             | **Decided** for the required-check rule                                                                                                                                                                                                                                                                                                                                                        |
| latency: `LATENCY_BUDGET_MS`, `LATENCY_MAX_CALLS`, `LATENCY_MIN_CALLS` | 2,000 ms, 5,000, 20 | **Judgement.** Bounds a case's latency time; 20 calls is the fewest that report a p50 under the next rule                                                                                                                                                                                                                                                                                      |
| `LATENCY_TAIL_CALLS`                                                   | 10                  | **Judgement.** A percentile `q` is reported only when `n(1 - q) >= 10`: p95 needs 200 calls, p99 1,000. Below that the "percentile" is the maximum under another name                                                                                                                                                                                                                          |
| `LATENCY_TIMER_MULTIPLE`                                               | 20                  | **Judgement.** A median call shorter than 20 clock reads is reported as skipped (`latency-below-timer-resolution`): it would measure the clock                                                                                                                                                                                                                                                 |
| `ALLOC_WINDOW_OPS`, `ALLOC_WINDOW_MS`, `ALLOC_SEMI_SPACE_MIB`          | 256, 100 ms, 64 MiB | **Judgement, checked.** In a prototype of the method on Node 22, 24 and 26, GC-free windows of 200 to 1,000 small operations reproduced the per-operation heap growth to within 1.2% (8,757 to 8,860 bytes for one synthetic operation); `total_allocated_bytes`, which only Node 26 has, converges to the same figure with a fixed overhead per read, which the two-window difference cancels |
| `PEAK_CALLS`                                                           | 20                  | **Judgement.** The peak is a maximum; 20 calls report it and their median                                                                                                                                                                                                                                                                                                                      |
| `LONG_RUN_ROUNDS`, `LONG_RUN_SETTLE_ROUNDS`, `LONG_RUN_ROUND_MS`       | 30, 5, 100 ms       | **Judgement.** 3 s of a case; the first 5 rounds left out while caches and compiled code settle                                                                                                                                                                                                                                                                                                |
| `LONG_RUN_GROWTH_BYTES`                                                | 64 KiB              | **Measured** (section 5): above the largest fitted growth of a run that retains nothing, and reached by a retained 40-byte object every 64 calls over a 1 KiB decode's long run                                                                                                                                                                                                                |
| `GC_SETTLE_BYTES`, `GC_SETTLE_ROUNDS`, `GC_MAX_ROUNDS`                 | 64 KiB, 2, 7        | **Shared.** ADR 0001 section 8                                                                                                                                                                                                                                                                                                                                                                 |
| `IMPORT_RUNS`                                                          | 20                  | **Judgement.** Enough for a median and a p95 that is not the maximum                                                                                                                                                                                                                                                                                                                           |

### 5. Noise and its measured bounds

Every number here comes from `experiments/bench-calibration/`, where the runs, the scripts and the
analysis live; `analyze.mjs` re-derives each table from the committed data.

**The comparison's false alarms and detections.** Taken on a developer desktop (Intel i9-9900K,
8 cores and 16 threads, Node 24.22.2), four comparisons at a time, each pinned to one logical CPU,
while the machine was shared with other work: its load average ran from 5.7 to 70.7 over the runs
(`data/loadavg.txt`). The base and the head were two copies of the PHI scan engine in two
directories, over the suite's six compared cases.

| Injected   | Comparisons | Measured cases | Regression verdicts (cases) | Upper 95% | Comparisons with one | Upper 95% | Skipped cases |
| ---------- | ----------- | -------------- | --------------------------- | --------- | -------------------- | --------- | ------------- |
| none (A/A) | 108         | 429            | 0                           | 0.70%     | 0                    | 2.74%     | 219 of 648    |
| 10%        | 24          | 55             | 16 (29%)                    |           | 12 (50%)             |           | 89 of 144     |

What that does and does not show:

- **No false alarm in 108 A/A comparisons.** The per-comparison rate is therefore under 2.74% with
  95% confidence on this machine. It is not under 1%: that needs 299 clean comparisons, and it needs
  them on the runner class the comparison runs on, which this machine is not. The comparison stays
  advisory.
- **The machine was too busy for this method a third of the time.** 219 of 648 A/A cases skipped
  because a process's warmup did not settle within 5 s. A skip is reported as a skip, never as a
  verdict. This is review trigger 5's condition, on this machine.
- **One round's noise on this machine is large.** With nothing changed, a round's 5th and 95th
  percentile ratios were 0.70 to 0.79 and 1.25 to 1.41, by case (`analyze.mjs` prints each). Against that spread a
  10% slowdown was called a regression in 29% of the measured cases and inconclusive in the rest:
  under this load the comparison finds slowdowns well above 10%, not 10%.
- **The estimator and the threshold, judged on the same runs.** The median sample instead of the
  fastest found more of the 10% slowdowns (22 of 55) and raised one A/A false alarm (1 of 429
  cases); a 2% threshold found 22 of 55 with one false alarm; 5% found 11 of 55 with none. On this
  little data and this machine, the fastest sample at 3% is the one that raised no false alarm; the
  runner's calibration decides again.

**The long run.** Ten readings each of `decodeSourceLiterals` on 1 KiB sources through a wrapper
that retains nothing, or one small object (about 40 bytes) every 64 calls, every 16 calls, or every
call, on the developer machine described above:

| Retained                  | Runs | Slope, bytes per operation | Fitted growth            | Called growing |
| ------------------------- | ---- | -------------------------- | ------------------------ | -------------- |
| nothing                   | 10   | 0.0023 to 0.0101           | 516 to 530 B             | 0 of 10        |
| one object every 64 calls | 10   | 0.6270 to 0.6652           | 54,179 to 77,046 B       | 8 of 10        |
| one object every 16 calls | 10   | 2.0218 to 2.6223           | 77,637 to 449,708 B      | 10 of 10       |
| one object every call     | 10   | 32.0198 to 42.1982         | 2,079,095 to 8,942,309 B | 10 of 10       |

A run that retains nothing fits a slope of 0.0023 to 0.0101 bytes per operation, about half a
kilobyte of growth over its fitted span: the heap's own noise (ADR 0001 measured about 1 KiB), not a
leak. The 64 KiB line sits more than 120 times above it. (The runs' operations per round ranged from
1,600 to 9,600, because a round is sized by 100 ms of a busy machine.) A retained
object every 64 calls (about 0.64 bytes per operation) reaches the 64 KiB line in 8 of 10 runs: that
is the edge of what a 3 s long run of this case can see, and each result reports that edge for its
own case as `detectableBytesPerOp`. A case with fewer, slower operations sees less: a long run of
30 calls of a 300 ms operation fits 24 of them, so it cannot call a leak under about 2.7 KB a call
growing, and says so in that number.

**Allocations.** In a prototype of the method on Node 22.23, 24.22 and 26.10, GC-free windows gave 8,757 to 8,860
bytes per operation for one synthetic operation across windows of 200 and 1,000 operations; a window
of 10 read 10,778 on Node 22, which is the fixed cost of reading the heap that the two-window
difference removes.

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
5. **A calibration on the runner class the comparison runs on**: an A/A run first, then injected
   slowdowns of 5%, 10% and 20% for the detection rate, and again at every review trigger. In this
   repository that is the manual workflow `.github/workflows/bench-calibration.yml`.

`config` adopts it first, on the PHI scan engine in `@cosyte/script-utils`, which runs in every
parser's commit gate: `packages/script-utils/bench/phi-scan.bench.mjs` measures the whole engine on
one file (`runPhiScan` with a path, the way `cosyte-phi-scan <path>` runs) and the escape decoder
alone (`decodeSourceLiterals`), each at 1 KiB, 32 KiB, 1 MiB and 4 MiB of synthetic TypeScript.
`pnpm bench:phi-scan` takes a reading. The first one, on the developer machine above, the measuring processes pinned to one logical CPU, load average 14 to
25 (`experiments/bench-calibration/data/phi-scan-reading.json`):

| Benchmark            | Size   | Per op  | Bytes/s    | p50      | p95      | p99      | Alloc/op | Peak heap | Long run |
| -------------------- | ------ | ------- | ---------- | -------- | -------- | -------- | -------- | --------- | -------- |
| runPhiScan, one file | 1 KiB  | 68.6 us | 15.1 MiB/s | 74.7 us  | 132.4 us | 386.5 us | 59.7 KiB | 85 KiB    | flat     |
| runPhiScan, one file | 32 KiB | 1.17 ms | 26.8 MiB/s | 0.999 ms | 2.04 ms  | 2.76 ms  | 1.28 MiB | 1.26 MiB  |          |
| runPhiScan, one file | 1 MiB  | 50.7 ms | 19.7 MiB/s | 52.1 ms  | n/a      | n/a      | skipped  | 37.2 MiB  |          |
| runPhiScan, one file | 4 MiB  | skipped |            | 243.2 ms | n/a      | n/a      | skipped  | 130.6 MiB |          |
| decodeSourceLiterals | 1 KiB  | 18.0 us | 57.7 MiB/s | 10.9 us  | 21.2 us  | 29.3 us  | 33.1 KiB | 47.9 KiB  | flat     |
| decodeSourceLiterals | 32 KiB | 445 us  | 70.4 MiB/s | 396 us   | 809 us   | 1.15 ms  | 1000 KiB | 1 MiB     |          |
| decodeSourceLiterals | 1 MiB  | 13.0 ms | 76.9 MiB/s | 13.2 ms  | n/a      | n/a      | 31.2 MiB | 31.3 MiB  |          |
| decodeSourceLiterals | 4 MiB  | skipped |            | 230.5 ms | n/a      | n/a      | skipped  | 120.4 MiB |          |

Cold import of `phi-scan.js`: median 13.0 ms, p95 15.1 ms (an empty module: 0.8 ms); one file,
112.3 KiB, 36.2 KiB gzipped.

Two things in it are findings rather than numbers. The escape decoder's cost per byte rises above
about 1 MiB: from 1 MiB to 4 MiB its median call goes from 13.2 ms to 230.5 ms, 17 times the time for
four times the input, which at those sizes the scaling gate's ceiling of 8 would flag. And the 4 MiB
throughput cases skip: one call there is longer than the warmup's 50 ms batch, and three calls in a
row did not land within 5% of each other in 5 s on this machine. ADR 0001 section 2 names that case
and its remedy (a longer batch, under its review triggers); we have not changed the shared rule here.
Their latency is still reported, from the first process, which did settle.

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
