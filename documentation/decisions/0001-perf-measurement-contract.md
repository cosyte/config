# 0001: The performance measurement contract for `@cosyte/test-utils/perf`

- **Status:** Accepted (2026-07-26)
- **Scope:** `@cosyte/test-utils/perf` (the throughput gate, the memory gate, the reporting benchmark)
  and every `@cosyte/*` package that consumes it.
- **Relates to:** the perf roadmap (`operations/roadmaps/config/perf.md` §8/P1) · the PERF-P0
  calibration, `experiments/perf-calibration/ANALYSIS.md` + `README.md` (config#32, `1952b37`) ·
  umbrella `documentation/conventions.md` (perf-gate standard, corrected 2026-07-25) · umbrella
  ADR 0001 (the pre-alpha version ladder, which
  [ADR 0002](0002-the-0-1-0-version-line.md) retired for this repository's published packages).
- **Supersedes:** nothing. It is the first binding statement of how a `@cosyte/*` package measures
  itself, and it is what `hl7`'s bespoke suite gets migrated onto in P4.

## Context

The roadmap's north star is that every `@cosyte/*` package can prove, in its own CI and without
bespoke code, that it has not silently acquired an algorithmic-complexity regression, and can
publish defensible throughput numbers. `hl7` shipped such a suite by hand; the other twelve packages
have nothing, and are one `/drain` away from copying `hl7`'s defects twelve times.

Four beliefs the research overturned, and one it left as a hole, made it impossible to write the kit
first and calibrate it later: the ratio does **not** cancel coverage overhead (V1), a fixed-count
warmup cannot reach steady state (W1), "take the minimum" is folklore with no evidence behind it
(W2), and `gc(true)` silently scavenges (M2), while the ratio **ceiling** had no published basis at
all (§10/O1). P0 therefore measured all of it first: 3,200 4N-vs-N ratios on a linear workload, 320
on a deliberately O(n²) one, and 200 GC-fixpoint trials, across two runner classes, on a real
Node 22.23.1 / V8 12.4 binary.

This ADR freezes what P0 measured into a contract, so that P2/P3 implement a decided thing rather
than re-deriving it, and so that **no constant in the kit lacks a recorded justification**.

**One question is already closed and is not re-opened here.** The kit is **zero-dependency and
hand-rolled on `node:perf_hooks`** (founder, 2026-07-25). mitata is out on maintenance (§10/O5);
`tinybench` and `bench-node` were out on merit before that: an exhaustive grep of tinybench's
published bundle for `steady|converg|tier|deopt|turbofan|maglev|jit` returns zero hits (W3), and
bench-node's `%NeverOptimizeFunction` default measures Ignition/Sparkplug-tier execution and needs
`--allow-natives-syntax` on every consumer (W4). `vitest bench` is out on V5: experimental,
SemVer-exempt, and already rewritten in Vitest 5.

## Decision

### The constants, and where each one comes from

Every number the kit will hard-code, with its basis. **Measured** means it is derived from P0's
committed datasets under `experiments/perf-calibration/data/`. Most rows re-derive with
`node experiments/perf-calibration/analyze.mjs <dir>`; four (`ESTIMATOR (benchmark)`,
`WARMUP_MIN_MS`, `WARMUP_BATCH_MS` and `MIN_PHASE_MS`) are derived from the same committed
`ratios.jsonl` directly, because `analyze.mjs` does not emit those statistics. **Judgement** means P0
could not settle it and the reasoning is written down instead: the roadmap's §10/O1 clause, applied
honestly.

| Constant                | Value                                  | Basis                                                                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATIO_CEILING`         | **8**                                  | **Measured.** Above the worst false alarm in 3,200 samples (6.649, `min`, container leg) and below the weakest real O(n²) signal at `hl7`'s own fixture size (8.84). Margins: 1.20× / 1.10×. Conditional on the estimator, the sampling shape, `MIN_PHASE_MS` and the warmup rule                             |
| `RATIO_FLOOR`           | **1.5**                                | **Measured.** Below all 3,200 samples (worst 1.702) and above the ≈1 a same-workload-both-phases bug produces. Margin 1.13×: the weakest constant in this table                                                                                                                                               |
| `ESTIMATOR` (assertion) | **`min` of the phase's sample vector** | **Measured.** `min` caps the container false-alarm tail at 6.649; `median`/`trimmedMean`/`mean` reach 8.25–8.58 against a weakest signal of 8.84, i.e. a 3%-wide window: no window at all                                                                                                                     |
| `ESTIMATOR` (benchmark) | **median, full vector reported**       | **Measured.** median vs trimmed-mean divergence over the same 3,200 rows is p50 1.5%, p95 7.1%, **max 25.6%**: a one-per-tail trim does not remove a one-sided tail, so the more robust estimator is the honest headline                                                                                      |
| `REPS` per phase        | **5**                                  | **Measured, by construction.** The entire calibration was taken at 5 reps per phase; `min` over a different rep count is a different statistic, so changing this invalidates `RATIO_CEILING`                                                                                                                  |
| `SCALE_STEP`            | **4×**                                 | **Measured, by construction.** Same: every ratio in the dataset is a 4× step. Ideal linear ratio 4; a quadratic at 4× lands 4.69…14.47 depending on fixture size (see below)                                                                                                                                  |
| `PHASE_ORDER`           | **fixed `N` → `4N`**                   | **Measured.** C5 is a ~4.7–5.1% _reproducible bias_, not noise (the two ordering distributions do not overlap on the quiet leg), so fixing the order is sufficient. The governing 6.649 sample is itself an `N`→`4N` row                                                                                      |
| `WARMUP_MIN_MS`         | **500**                                | **Measured.** One further trial, 136–294 ms (p50) of the same workload, brought rep-to-rep drift from as much as 1.23× inside ±5%. 500 ms is 1.7–3.7× that                                                                                                                                                    |
| `WARMUP_MAX_MS`         | **5 000**                              | **Judgement.** No measured basis. Bounds the fleet cost (13 packages × 2 axes) and leaves ~100 batches of headroom at `WARMUP_BATCH_MS`, i.e. the cap is reached only by a genuinely unsettled runtime                                                                                                        |
| `WARMUP_BATCH_MS`       | **50**                                 | **Judgement, forced by measurement.** The unit the stability rule is evaluated on. A single ~4–9 ms pass is _not_ stable enough to satisfy ±5% three times running (1–92% of warm phases do, by axis; see the table in §2); a 50 ms batch aggregates 5–12 passes, and aggregation is what shrinks that jitter |
| `WARMUP_STABLE_TOL`     | **±5%**                                | **Judgement, anchored on measurement.** P0's nearest measurement is the rep1/rep5 ratio _within_ a warm 5-rep phase: 0.96–1.05× (GitHub), 0.97–1.02× (container). That is a different statistic at a different granularity, so ±5% is a judgement this band motivates rather than establishes                 |
| `WARMUP_STABLE_BATCHES` | **3 consecutive**                      | **Judgement.** Two consecutive can be met by a coincidental pair on a heavy-tailed distribution; a third batch costs 50 ms against a 5 s cap                                                                                                                                                                  |
| `MIN_PHASE_MS`          | **4**                                  | **Measured.** The fastest base phase in all 3,200 samples was 4.14 ms. Below that the ceiling is extrapolation, so the gate skips rather than answers. (It also buries the clock: a 111 ns timer read is 0.003% of 4 ms)                                                                                      |
| `CLOCK`                 | **`performance.now()`**                | **Measured, by construction.** P0's whole dataset is in `performance.now()` milliseconds. `hrtime.bigint()` is finer (111 ns/call vs `memoryUsage()`'s 8 286 ns) but phases are ≥ 4 ms, so the float clock is not the limit                                                                                   |
| `GC_SETTLE_BYTES`       | **64 KiB**                             | **Judgement, anchored on measurement.** 58.5× the worst drift observed between settled rounds (1 120 bytes) and far below any retention worth reporting                                                                                                                                                       |
| `GC_SETTLE_ROUNDS`      | **2 consecutive**                      | **Measured.** A single zero-arg `gc()` reached the fixpoint in 100/100 trials; the two-round confirmation rule exits after **3 calls** on measured data                                                                                                                                                       |
| `GC_MAX_ROUNDS`         | **7**                                  | **Cited.** V8's own `kMaxNumberOfAttempts` in `Heap`'s maximal-reclamation path [S20]                                                                                                                                                                                                                         |
| `HEAP_NOISE_FLOOR`      | **~1 KiB**                             | **Measured.** Median within-trial spread across settled rounds is 0.000%, but a minority of trials move by up to 1 120 bytes with no workload running. A settled byte figure is stable to ~1 KiB, not to zero                                                                                                 |
| coverage on perf tests  | **off**: `test/perf` excluded          | **Measured.** P0's _pre-registered_ decision rule tripped (Δ p95 44.1% on one container cell; 22.3% re-checked on `min`)                                                                                                                                                                                      |
| gate imports            | **`src`, through the test host**       | **Measured, by construction**: see "V4" below. The benchmark imports built `dist` from a plain Node process                                                                                                                                                                                                   |

### 1. Estimator: `min` for the assertion, never for the report

The ratio assertion uses `min(quad samples) / min(base samples)`. The full sample vector for both
phases is **retained and emitted** in every failure and skip diagnostic, never pre-reduced.

This is **not** a rehabilitation of the min-of-N folklore. W2's criticism (that its canonical source
asserts it with no citation, derivation or data, and that no modern harness in any runtime reports it)
stands, and it is why the _benchmark_ headlines a median with the distribution beside it and
exposes `min` only as one field among several. What P0 added is evidence for one narrow use: on the
ratio of two same-process phases, where the noise is one-sided, `min` is the only estimator that does
not import a one-sided stall on one side of the ratio into the ratio itself. It is the only estimator
that leaves a usable window at all (6.65…8.84 rather than 8.58…8.84).

**Bound, recorded:** two runner classes, one workload shape, the _ratio_ only. This says nothing
about what to publish in `benchmarks.md`, which is why the two estimators are decided separately.

### 2. Warmup: time-budgeted with a stability rule, never a fixed count

W1 is a structural argument, not a tuning observation: V8's `InterruptBudgetFor()` returns
`invocation_count_for_maglev * bytecode_length`, and `DEFINE_WEAK_IMPLICATION(maglev,
maglev_overwrite_budget)` raises the effective TurboFan threshold to 16 000 _interrupt units scaled
by bytecode length_, so no invocation count can be correct across two different parsers, let alone
thirteen. P0 confirmed the consequence: after `hl7`'s exact ~2 100-invocation warmup, the first
measured rep is up to **1.23× slower than the fifth**, and that first rep is the only measurement a
real CI gate ever takes.

The rule:

> A **batch** is repeated passes over the base corpus until at least `WARMUP_BATCH_MS` (50 ms) has
> been timed, reported as one aggregate. Run batches. After at least `WARMUP_MIN_MS` (500 ms) in
> total, stop when `WARMUP_STABLE_BATCHES` (3) consecutive batch timings lie within
> `WARMUP_STABLE_TOL` (±5%) of their median. If `WARMUP_MAX_MS` (5 s) elapses without that, **skip
> loudly** with reason `warmup-unstable`: never measure anyway. Warmup runs once per axis, before
> either phase: both phases exercise the same code path.

**The batch length is load-bearing and is not a free choice**, because relative jitter shrinks as the
batch grows, so the same ±5% means different things at different granularities. Evaluated at the
granularity of a single pass, the rule is frequently unsatisfiable even at steady state. Measured on
P0's committed warm, coverage-off base vectors, this is the fraction of phases in which some three
consecutive reps sit within ±5% of their median:

| leg / axis        | median rep | 3-in-a-row within ±5% | within ±10% |
| ----------------- | ---------: | --------------------: | ----------: |
| GitHub / count    |     4.4 ms |                 91.7% |       99.7% |
| GitHub / size     |     4.9 ms |              **1.0%** |       97.0% |
| container / count |     7.4 ms |                 77.0% |       92.3% |
| container / size  |     9.4 ms |             **26.7%** |       87.0% |

(n = 300 warm phases per cell, 5 reps each, so only three candidate windows per phase; this shows
the rule's sensitivity to granularity, not a skip rate. Pooling the cold trials back in moves the two
bold cells to 13.3% and 33.5%, which does not change the conclusion. Note the size axis is the worse
one on _both_ legs despite its longer reps: the failure is not simply "short phases are jittery", so
the batch has to be defined in time rather than in passes.) The response is to fix the granularity, not to
loosen the tolerance: a 50 ms batch aggregates 5–12 of those passes, and aggregation is precisely
what removes the jitter the table exposes. **Review trigger:** if a package hits `warmup-unstable` at
adoption, raise `WARMUP_BATCH_MS` first and relax `WARMUP_STABLE_TOL` only if that fails: the
tolerance is the constant that decides what "steady" means.

**A permanently-skipping gate cannot ship, structurally.** The obvious hazard of a skip-on-unstable
rule is a gate that skips forever and reads green while blind (roadmap §5's second-worst outcome).
It cannot survive adoption: §5's per-package self-check runs the same warmup, and a self-check that
cannot produce a ratio cannot show the injected O(n²) regression clearing the ceiling, so it **fails
the build** at adoption rather than shipping a silent skip.

500 ms of a typical parse fixture is on the order of 60 000 invocations, roughly 30× what `hl7`
warms today. That is deliberately _not_ offered as a tier-up guarantee: W1's empirical leg found a
pure function still unmarked for TurboFan at 80 000 invocations, which is exactly why the rule is
stability-based rather than count-based.

**The interaction that must not be forgotten.** `min` over 5 reps partially launders an unfinished
warmup, because the last reps are the fast ones, and `RATIO_CEILING` was set from the worst false
alarm in the whole population, which is a _warm_ row. **Changing the warmup rule moves the operating
point, so the ceiling must be re-checked, on both sides.** The signal side is the per-package
self-check in §5. The false-alarm side (the side the ceiling exists to clear, and roadmap §5's
risk #1) is roadmap P2's own acceptance clause, "does **not** fire across 200 clean runs"; that run
must be taken under the warmup rule decided here, not under `hl7`'s fixed-count one. P2 owns both.

### 3. Sampling shape

`REPS = 5`, `SCALE_STEP = 4×`, phases run in fixed `N` → `4N` order, both phases in the same process,
built corpora constructed outside every timed region, results summed into an exported sink the caller
reads back.

The sink is not decoration and is not optional. It is the _only_ structural defence against the
measured work being eliminated, and the mechanism to cite is Turboshaft's **use-based** liveness
reducer (`src/compiler/turboshaft/dead-code-elimination-reducer.h`), which is the optimizing backend
in the V8 that Node 22 ships, not the type-based `dead-code-elimination.h` pass that gets cited by
mistake (W5).

C5, the one confound a same-process ratio does not cancel, is handled by fixing the order rather
than randomizing. P0 measured it at ~4.7% (count) and ~5.1% (size) on the quiet leg, with the two
ordering distributions non-overlapping: small, but a reproducible bias rather than noise.
Randomization would fold that bias into the variance of a window only 1.33× wide, which is the wrong
trade. The residual must not be described as pure noise.

### 4. The ceiling, the floor, and what the floor does not do

Assertion, per axis: `RATIO_FLOOR ≤ min(quad)/min(base) ≤ RATIO_CEILING`. Both are hard failures.

**The ceiling is 8.** `hl7`'s shipped `LINEARITY_MAX = 10` is too high and P4 must **lower** it, not
merely re-comment it: at `hl7`'s own fixture size a real O(n²) regression scored 8.84 and would have
passed. A ceiling has to sit below the weakest signal, not merely above the noise.

It is set from the worst false alarm across the **whole** population, 6.649, which is a
coverage-**on** row. Under the regime §6 adopts, the worst coverage-off false alarm is **6.300**
(container; 4.501 on GitHub), so the ceiling's real margin under the shipped configuration is 1.27×
rather than 1.20×. The governing number stays 6.649 anyway: the conservative one is the right one to
publish, and it costs nothing.

**The floor is 1.5, and it fails rather than warns.** P0 flagged the alternative, and it was
considered: the floor's margin (1.13×) is the thinnest in the table, and a flaky gate is the failure
mode this project exists to prevent. It fails anyway, because the two error costs are not
symmetric: the bug the floor catches is _deterministic_ (a corpus builder returning the same array
twice reproduces on every run, and is caught the first time), whereas a spurious sub-1.5 ratio needs
a 1.13× excursion beyond the worst of 3,200 samples. A warning in CI is a thing nobody reads.

**The counter-argument, recorded because it is strong.** The lower tail is not thin: of 3,200 `min`
ratios, **0 fall below 1.5, 3 below 2.0** (1.702, 1.753, 1.829) **and 9 below 2.5**. Multiplied by 13
packages × 2 axes on every CI run and every developer's `verify.sh`, a spurious hard failure is not a
remote event, and P0 explicitly asked P1 to consider warning instead. This ADR takes the other side
on the asymmetry argument above, and pairs it with a trigger rather than pretending the margin is
comfortable. **Review trigger:** the first floor breach observed in the wild _without_ a
fixture-construction bug behind it drops the floor to a warning, in its own commit.

**Correction the roadmap's §7 needs, carried here and not quietly dropped: the floor cannot catch
dead-code elimination on the count axis.** If the parse were optimized away entirely, the count-axis
loop still runs 4N vs N iterations, so the ratio stays ≈4 and the floor never fires. What the floor
actually catches is narrower than "an accidental benchmark short-circuit": it catches _the two phases
received the same workload_: a wrong input size, a corpus builder returning the same array twice.
Dead-code elimination is prevented structurally by the sink (§3); it is not detected by the floor.

### 5. Fixture size is a calibration parameter, and each package must prove its own

The other correction the roadmap needs. The claim "the gate catches complexity-shaped regressions" is
true, and it now carries a qualifier that is not optional:

> **provided the fixture is large enough, and each package must prove that, not assume it.**

P0's Experiment C measured the signal side that had never been measured. It is not 16 and it is not a
constant; it climbs with fixture size, because a quadratic parser only scores near 16 once the
quadratic term dominates the linear per-line work:

| base OBX → 4× | container signal | container worst false alarm |                            window |
| ------------- | ---------------: | --------------------------: | --------------------------------: |
| 125 → 500     |             4.69 |                       6.649 | **none: signal inside the noise** |
| 250 → 1000    |             8.09 |                       6.649 |                             1.22× |
| 500 → 2000    |             8.84 |                       6.649 |                             1.33× |
| 1000 → 4000   |            10.68 |                       6.649 |                             1.61× |

At the smallest fixture a real O(n²) regression is indistinguishable from noise: the gate would read
green while broken, which is the roadmap's §5 second-worst outcome. So:

**Every package that adopts the gate must run the kit's injected-O(n²) self-check at the fixture
sizes its own gate uses, and that self-check must fail the build if the injected regression does not
clear `RATIO_CEILING`.** This is what converts 8 from a global guess into a per-package guarantee,
and it is the only mechanism here that degrades safely: a package whose fixtures are too small finds
out at build time instead of shipping a gate that cannot fail. P2 owns building it; every rollout
phase owns running it.

Two caveats that both cut the same way, recorded so nobody re-reads this table as an optimistic one:
n=20 per signal cell and the _minimum_ of 20 is a noisy lower-tail statistic, so the true weakest
signal is probably lower; and this is one quadratic shape: an O(n²)-in-field-count regression has a
different crossover.

### 6. Coverage: perf tests come out of the coverage run

P0's decision rule was pre-registered _before_ the sweep, precisely so a tripped result could not be
explained away afterwards. It tripped: Δ p95 **44.1%** on one container cell (22.3% re-checked on
`min`, the estimator this ADR adopts), against a threshold of 15%.

So `test/perf/**` is **excluded from the coverage-enabled run** and the perf gate runs in its own
non-instrumented invocation. Not because coverage was proven to distort the ratio (the honest read
is that the tripping cell is plausibly a heavy tail on both sides at n=50) but because it was not
proven _not_ to, and excluding costs nothing.

V1's magnitude is now measured and is worth recording accurately, because `hl7`'s comment is wrong in
both directions people assume: coverage costs **1.17×–1.43×**, far less than the "several-fold"
inflation the comment assumes, and it **mostly cancels** in the ratio, at a residual of ≤4.5%
(GitHub) to 14.4% (the container's noisiest cell) rather than the "cancels" the comment claims. The
mechanism is confirmed: `@vitest/coverage-v8` drives V8's `kBlockCount` precise coverage, compiling
an effectful `Builtin::kIncBlockCounter` call into the measured function body in every tier, at a
cost scaling with executed-block count and density, which differ between the compared phases; it
just does not dominate. P4 fixes the comment.

**Consequence that must not be lost:** with perf tests out of the coverage run, any `src` line
reached _only_ by a perf test stops counting toward the per-directory ≥90 thresholds in
`@cosyte/vitest-config`. That is expected to be nil (perf fixtures exercise the main parse path that
unit tests already cover), but each rollout must confirm it rather than assume it. It also means the
umbrella's `scripts/verify-policy.json` needs the new `test:perf` script added to `config`'s (and
each consumer's) required list, or `verify.sh` will run the coverage suite and silently never run the
gate. **That is umbrella work: no backlog item exists for it yet, and it must be raised with the
coordinator at pointer-bump time. It is deliberately not done from inside this submodule.**

### 7. V4: the gate measures `src` through the test host; the benchmark measures built `dist`

Vite's SSR transform rewrites imported bindings into namespace property accesses and evaluates the
module via `new AsyncFunction`; Vitest's own benchmarking guide warns this getter indirection "can
dominate the measurement" in a hot loop. Only `node_modules` is externalized, so `hl7`'s gate,
importing `../../src/index.js`, measures transformed code.

Verified directly in this repo's own Vitest 4.1.4 host (2026-07-26), by printing
`Function.prototype.toString` of three call shapes inside a running test:

| call shape                              | what the host actually runs                    |
| --------------------------------------- | ---------------------------------------------- |
| imported binding, called in a test file | `(0,__vite_ssr_import_2__.parseMessage)(m)`    |
| same-module call inside the loop        | `parseMessage(m)`: plain local call, no getter |
| imported binding hoisted into a local   | `fn(m)`: plain local call, no getter           |

Three things follow.

1. **The decision:** the gate keeps importing `src` through the test host. It is the calibrated
   regime (P0's whole dataset was taken there), it couples the gate to no build step, and the residual
   is bounded by §5's per-package self-check, which measures the real signal _including_ this effect.
2. **The kit's API shape removes the hazard from the measured loop anyway.** The runner takes a
   workload generator and a parse _function_ (a shape §6 of the roadmap already mandates, for PHI
   reasons: the runner never takes a file path). The runner is consumed from `node_modules`, so it is
   externalized and untransformed, and it calls `fn(input)` on a local binding. The namespace getter is
   evaluated where the caller passes the reference, not once per iteration. P0's harness has the same
   shape by accident (its timing loop and its parse function live in the same module), so the
   calibration matches the kit, and it is `hl7`'s current hand-rolled shape that is the outlier. P4's
   migration removes a per-call getter from the loop.
3. **The residual is a sensitivity risk, not a false-alarm risk.** Any constant per-call overhead
   inside `src` cancels exactly on the count axis (both phases run the same code, 4N vs N) and _dilutes_
   the size-axis ratio toward 1. It can only make the gate less sensitive, never more flaky. That
   direction is the dangerous one (a gate reading green while blind), and §5's self-check is what
   bounds it, because it measures the signal through the same transform.

**Published numbers are the other case.** `benchmarks.md` numbers describe what a consumer executes,
so the reporting benchmark imports the **built `dist` entry from a plain Node process** (no Vite
host, no SSR transform, no coverage) and every published figure carries its method, its machine and
an "indicative, not a floor" label. A gate and a published number are answering different questions
and are allowed different hosts; what is not allowed is publishing a number taken under the gate's
host without saying so.

### 8. Memory constants (binding on P3)

- **Force GC with zero-argument `gc()` only.** The kit **constructs the argument itself or passes
  none**, and rejects any caller-supplied `gc` argument outright.
- **M2's rule is about whether V8 recognises a key, not about truthiness.** The research framed it as
  "a _truthy_ parameter that is not setting options → `{type:'minor'}`". That is wrong, and so is the
  broader "everything except `{type:'major'}` scavenges". Measured on Node 22 with ~22.9 MiB of
  old-space garbage: an object carrying `type`, `execution` or `flavor` is parsed as options and
  defaults to a **major** GC (`gc({execution:'sync'})` and `gc({flavor:'last-resort'})` each reclaimed
  all 22.88 MiB), while a primitive, an **empty object**, or an object with only unrecognised keys
  falls to the legacy path and **scavenges**: `gc(true)`, `gc(false)`, `gc(1)`, `gc(null)`,
  `gc(undefined)`, `gc({})`, `gc({foo:1})` each reclaimed **0.00 MiB**. `gc({})` and `gc({foo:1})` are
  the cases that separate "is an object" from "is parsed as options", and neither was in the original
  seven-form list. The failure is silent either way, which is why the rule is "construct it yourself".
- **Settle by rule, not by count:** loop until `GC_SETTLE_ROUNDS` (2) consecutive rounds each reclaim
  under `GC_SETTLE_BYTES` (64 KiB), capped at `GC_MAX_ROUNDS` (7). Measured, that exits after 3 calls.
  A single zero-arg `gc()` reached the fixpoint in 100/100 trials, so M3's `kMinNumberOfAttempts`…
  `kMaxNumberOfAttempts` describes V8's _internal_ loop and does not translate into multiple explicit
  calls on this garbage shape, but the rule, not the observed count, is what ships.
- **Sync, not async.** O4 is answered: the async form settled in the same one round in 50/50 trials on
  both legs. Use the simpler synchronous call. (`{execution:'async'}` reclaims nothing until the
  promise settles, so probing it synchronously scores a working form as broken.)
- **A settled byte figure is stable to ~1 KiB, not to zero** (`HEAP_NOISE_FLOOR`). The _baseline_ also
  drifts across trials by ~0.56%. That is the harness's own footprint moving, not GC instability, and
  the two must not be conflated.
- **The memory gate remains counting-invariant-only** and the byte-level half remains a non-blocking
  report, per roadmap P3. Nothing measured here changes that: `heapUsed` is a per-space sum with no
  liveness filter (M1), it is blind to Buffer payloads by ~4 000× (M6), and young-generation sizing
  derives from host rather than cgroup memory (M4): visible in our own environment record, where the
  container reports 157.3 GiB to `os.totalmem()` under a 16 GiB cgroup.

### 9. Fail-safe: the typed skips

Borrowed from the parser class and binding on every runner here: **a performance measurement must
never report a confident wrong answer.** The gate skips loudly, with a typed reason, rather than
passing silently or failing, when:

| reason            | condition                                                                    |
| ----------------- | ---------------------------------------------------------------------------- |
| `phase-too-short` | the base phase's `min` sample is under `MIN_PHASE_MS` (4 ms)                 |
| `warmup-unstable` | `WARMUP_MAX_MS` elapsed without `WARMUP_STABLE_BATCHES` inside the tolerance |
| `gc-unavailable`  | a byte figure was requested and `globalThis.gc` is absent                    |
| `gc-unsettled`    | `GC_MAX_ROUNDS` reached without two consecutive settled rounds               |

A skip is not a pass. `phase-too-short` in particular means the package's fixture is below the
calibrated regime, and §5's self-check is what turns that into a build failure rather than a
permanently green-but-skipping gate.

**PHI:** every diagnostic (failure, skip and report alike) prints sizes, counts, ratios and sample
vectors. It never echoes input content. Inputs are synthetic and generated in-process by construction;
the runner takes a generator function, never a file path.

## Consequences

**Positive.** P2 and P3 implement a decided contract instead of re-deriving it, with every constant
traceable. The two beliefs that would have propagated defects across thirteen packages, "the ratio
cancels coverage" and "warm up a fixed number of times", are corrected before the copy, not after.
The published-number path and the gating path are separated, so neither one's constraints distort the
other. And the gate's honest limits are now stated in a citable place rather than implied.

**Negative / cost.** A hand-rolled harness means we own the timer-overhead and batching problems a
library would have solved; if sub-microsecond workloads appear, batching for near-free operations is
the one place a library architecture was genuinely ahead (V6) and this decision should be revisited.
The window is thin (1.33× on the noisier runner class), and this ADR does not make it wider; it makes
it _known_, and pushes the real guarantee down to a per-package self-check that costs build time.
Warmup now takes 0.5–5 s per axis. It runs once per axis, not once per phase, so 1–10 s per package
and up to ~2 minutes across the fleet. And `RATIO_CEILING` is conditional on the estimator, the
sampling shape and the warmup rule (review trigger 2), so it cannot be moved on its own.

**Review triggers**. This ADR is calibrated, not eternal:

1. **The runner image generation moves.** C4 measured a significant change point (p=0.001) from an
   `ubuntu-22.04`→`24.04` bump with no code change. Re-run `perf-calibration.yml` and re-check the
   table.
2. **`REPS`, `SCALE_STEP`, `PHASE_ORDER`, the warmup rule, or the estimator changes.** Each moves the
   operating point `RATIO_CEILING` was set from.
3. **A floor breach with no fixture-construction bug behind it** → the floor drops to a warning.
4. **Node's major version moves.** Everything here is Node 22.23.1 / V8 12.4.

**Still not established, and not claimed** (roadmap §9 stands unchanged): no absolute throughput or
memory figure is a portable guarantee; constant-factor regressions are invisible (C6: a 10% slowdown
passes, and nothing in P0 touched that); byte-level memory numbers are GC-fixpoint approximations,
not retained-size truth; cross-package comparison is meaningless; and nothing here detects a
regression that manifests only under real I/O, network or concurrency.

**Deferred, deliberately.** Heap-snapshot / dominator-tree retained size (§10/O2): the only technique
that answers "how many bytes does this graph retain", essentially unresearched, and out of P3.
`getHeapSpaceStatistics().old_space` as a primary metric instead of `heapUsed` (§10/O3): plausible,
never evaluated. Whether anyone gates CI on `vitest bench` (§10/O6): unsearched, and moot now that
the library question is closed. `pathways`: a Product-class throughput/latency/back-pressure problem
that shares no methodology with parse microbenchmarks, and needs its own roadmap.
