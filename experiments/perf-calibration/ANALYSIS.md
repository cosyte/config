# PERF-P0 — calibration results

**Run 2026-07-25. Node 22.23.1 / V8 12.4.254.21-node.56 on both legs.** 3,200 linear-workload ratio
measurements (1,600 per runner class), 320 quadratic-workload measurements, 200 GC trials. Raw data
in `data/` (container leg) and `data/github-hosted/` (`ubuntu-latest`, artifacts of runs
[30169401396](https://github.com/cosyte/config/actions/runs/30169401396) and
[30170837520](https://github.com/cosyte/config/actions/runs/30170837520)). Every number below
re-derives with `node analyze.mjs <dir>` (add `EST=min` to check a conclusion on the recommended
estimator) — nothing here was typed by hand.

Method, cell design and the pre-registered decision rule: `README.md`.

---

## The three constants

| Constant          | Value                                                                                           | Basis                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ratio ceiling** | **8** — conditional on the estimator being `min` **and** on the fixture being large enough (§2) | Sits in the only window that exists: above the worst false alarm in 3,200 trials (6.649) and below the weakest real regression measured at `hl7`'s own fixture size (8.84) |
| **Ratio floor**   | **1.5**                                                                                         | Below all 3,200 samples (worst 1.702); above the ≈1 an equal-workload-both-sides bug produces                                                                              |
| **GC rounds**     | **3 calls**, via a stability rule, capped at 7                                                  | One zero-arg `gc()` reclaims; rounds 2 and 3 confirm. 7 is V8's own `kMaxNumberOfAttempts`                                                                                 |

**The headline is not the numbers. It is that the window is 1.33× wide.** §2 is about that.

---

## 1. The estimator decides whether a window exists at all

Worst and best ratio on the **linear** workload — the false-alarm population, since nothing is wrong
by construction. All 1,600 rows per leg:

| estimator     | GitHub-hosted min…max | container min…max |
| ------------- | --------------------- | ----------------- |
| `min`         | 3.222 … **4.501**     | 1.702 … **6.649** |
| `median`      | 3.106 … 4.518         | 1.332 … **8.494** |
| `trimmedMean` | 3.037 … 4.711         | 1.416 … **8.584** |
| `mean`        | 3.031 … 4.820         | 1.805 … 8.252     |

On the GitHub runner every estimator is equivalent. On the noisier container they separate sharply:
`min` caps the tail at **6.649** while the three central estimators reach **8.25–8.58**. Since §2
shows the weakest real signal at `hl7`'s fixture size is **8.84**, a central estimator leaves a
window of 8.58…8.84 — **3% wide, which is no window at all.** With `min` the window is 6.65…8.84.

**Recommendation to P1: use `min` for the ratio assertion**, and keep W2's remedy where it belongs —
retain the full sample vector, headline a robust central estimate in the _benchmark_, never present
min _as_ the result. This does not rehabilitate the folklore: W2's criticism was that min-of-N is
asserted with no evidence, and that criticism stands. What is new is evidence for one narrow use.
The mechanism is unremarkable — benchmark noise is one-sided, so `min` is the only estimator that
does not import a one-sided stall on one side of a ratio into the ratio itself.

**Bound.** Two runner classes, one workload shape, the _ratio_ only. Says nothing about what to
publish in `benchmarks.md`.

---

## 2. The signal is not 16, it is not a constant, and it nearly collides with the noise

The ceiling has two sides. The noise floor is §1. The other side — what a genuine complexity
regression scores — was inherited arithmetic ("a quadratic on a 4× workload lands near 16") from
`hl7`'s gate comment, never measured. Experiment C measures it: the same harness, the same `min`
estimator, the same 4× size step, with a deliberately O(n²)-in-length parser that is asserted to
produce byte-identical output first (a "regression" that computes something else is not a
regression).

Weakest signal observed, against the worst false alarm from §1, per leg:

| base OBX → 4× | container signal | container noise | window                                | GitHub signal | GitHub noise |
| ------------- | ---------------: | --------------: | ------------------------------------- | ------------: | -----------: |
| 125 → 500     |         **4.69** |           6.649 | **none — signal is inside the noise** |          6.69 |        4.501 |
| 250 → 1000    |             8.09 |           6.649 | 1.22×                                 |         10.91 |        4.501 |
| 500 → 2000    |             8.84 |           6.649 | 1.33×                                 |         11.43 |        4.501 |
| 1000 → 4000   |            10.68 |           6.649 | 1.61×                                 |         14.47 |        4.501 |

Three things follow, and they matter more than the constants themselves.

**The signal climbs with fixture size.** A quadratic parser only scores near 16 once the quadratic
term dominates the linear per-line work. Near the crossover it scores 5–9. So **the fixture size is
part of the gate's calibration, not a free choice.** At 125→500 on the noisier leg a real O(n²)
regression is _indistinguishable from noise_ — the gate would read green while broken, which is
roadmap §5's second-worst outcome, and the roadmap does not currently warn about it.

**`hl7`'s shipped ceiling of 10 is too high, and I had this backwards.** An earlier draft of this
document said the measured data vindicated `hl7`'s judgement value. It does not. At `hl7`'s own
fixture size (500→2000) the weakest real regression measured **8.84** — _under_ 10 — so the shipped
gate would have passed it. A ceiling has to sit below the weakest signal, not merely above the
noise. P4 must lower it, not merely re-comment it.

**The usable window is 6.649 … 8.84 — a factor of 1.33.** A ceiling of **8** is 1.20× above the
worst false alarm and 1.10× below the weakest signal. That is thin, and it is thin because the
technique is thin, not because the constant is badly chosen: on the noisier leg this gate class
separates a real quadratic from noise by about a third of a decade. The roadmap's "catches
complexity-shaped regressions" is true, but it needs the qualifier **"provided the fixture is large
enough — and the package must prove that, not assume it."**

**So the most useful thing P2 can build is not a constant, it is a self-check.** P2's acceptance
already requires the runner to fire on an injected O(n²) fixture. This data says that check is only
meaningful **run at the same fixture sizes the package's real gate uses**. Done that way it converts
the ceiling from a global guess into a per-package guarantee, and it is the only mechanism here that
degrades safely: a package whose fixtures are too small finds out at build time instead of shipping
a gate that cannot fail.

**Caveats, which all cut the same way.** n=20 per signal cell, and the _minimum_ of 20 is a noisy
lower-tail statistic — the true weakest signal is probably lower, so the window is if anything
narrower than measured. And this is one quadratic shape; an O(n²)-in-field-count regression has a
different crossover. Neither caveat makes the picture better.

---

## 3. The floor

**Floor = 1.5.** Below every one of the 3,200 samples (worst 1.702, `min`, container) and above the
≈1 an equal-workload-both-sides bug produces. Margin **1.13×** — the weakest constant here, and P1
should consider whether a floor breach warns rather than fails.

**It does not catch dead-code elimination, and roadmap §7 implies it does.** If the parse were
optimized away, the count-axis loop still runs 4N vs N iterations, so the ratio stays ≈4 and the
floor never fires. What it actually catches is _the two phases got the same workload_ — a wrong
input size, a corpus builder returning the same array twice. Real, but narrower than "an accidental
benchmark short-circuit". Dead-code elimination has to be prevented structurally (the sink
accumulator, W5), not detected by a floor.

---

## 4. The pre-registered coverage rule TRIPPED — exclude perf tests from coverage

The rule, recorded in `README.md` before the sweep: exclude iff |Δ p50| > 5% **or** Δ p95 > 15%, on
any cell.

| leg           | worst \|Δ p50\| |               worst Δ p95 | verdict     |
| ------------- | --------------: | ------------------------: | ----------- |
| GitHub-hosted |            4.5% |                      0.7% | not tripped |
| container     |            2.3% | **44.1%** (count/NF/cold) | **TRIPPED** |

The trip is on one cell of the noisy leg and is plausibly noise: that cell's coverage-**off** run
also produced a 7.217 outlier, so both sides are drawn from a heavy tail at n=50. That read is
recorded, and the pre-registration is followed anyway — it was written down precisely so a tripped
result could not be explained away afterwards, and the remedy is nearly free. It also survives
re-checking on `min`, the estimator §1 recommends (Δ p95 22.3%, same cell), so the outcome is not an
artifact of the reporting estimator.

**Recommendation to P1: exclude the perf tests from the coverage run.** Not because coverage was
proven to distort the ratio, but because it was not proven _not_ to, and excluding costs nothing.

### V1's magnitude

V1 was mechanism-only: `@vitest/coverage-v8` drives V8's `kBlockCount` precise coverage, compiling an
effectful counter increment into the measured function body in every tier, at a cost scaling with
executed-block count and density — which differ between the compared phases, so it need not cancel.
Measured:

- **Coverage costs 1.17×–1.43×.** Real, and far smaller than the "several-fold" inflation `hl7`'s
  gate comment assumes.
- Higher on the size axis (1.32–1.43×) than the count axis (1.17–1.35×), consistent with block
  density differing between workloads.
- **Non-cancellation is measurable and small**: comparing how much coverage inflates the base phase
  vs the quad phase gives ≤ 4.5% on GitHub, up to 14.4% on the container's noisiest cell. On the
  GitHub leg the size axis shows the predicted direction consistently (base 1.41× vs quad 1.37×).

So the mechanism is confirmed and does not dominate. `hl7`'s claim that coverage overhead "cancels"
is still wrong as written — it _mostly_ cancels, at a residual of a few percent. P4 must fix that
comment.

---

## 5. Ordering (C5) is small but reproducible; warmup (W1) is the real problem

**Ordering.** On `min`, running `N→4N` vs `4N→N` moves the median ratio by ~4.7% (count) and ~5.1%
(size) on the GitHub leg, where within-cell spread is only ±1.5% and the two distributions **do not
overlap**. So C5 is small in magnitude but is a _reproducible bias_, not noise — an earlier draft
called it noise on the strength of `median`-estimator numbers, which is the wrong estimator to judge
it on. Practical consequence is unchanged: fixing the phase order is sufficient, randomization is
not required. But P1 must not treat the residual spread as pure noise, because a few percent of it
is structural.

**Warmup.** W1 said a fixed-count warmup cannot reach steady state. It does not. Ratio of the first
rep to the last within a phase, after `hl7`'s exact ~2,100-invocation warmup:

| leg           | cold trials | warm trials |
| ------------- | ----------- | ----------- |
| GitHub-hosted | 1.01×–1.23× | 0.96×–1.05× |
| container     | 1.04×–1.15× | 0.97×–1.02× |

Worst case, the first measured rep is **23% slower than the fifth**; three of eight GitHub cells are
already within 5%, so the effect is real but uneven. By the second trial in the same process
everything is within 5%. The shipped fixed-count warmup is not at steady state at the moment the
gate takes its only measurement.

This is the basis for P1's "time-budgeted warmup, samples discarded until stable". Note the
interaction with §1: `min` over 5 reps partially launders an unfinished warmup, because the last
reps are the fast ones. Estimator and warmup rule have to be decided together — and because the
constants here were calibrated at the cold operating point, **changing the warmup rule moves the
operating point and the ceiling needs re-checking**, cheaply, via the §2 self-check.

---

## 6. GC: M2 confirmed but the rule is about recognised keys, M3 does not bite, O4 answered

**M2 — the effect is real; the rule is not the one the research stated.** With ~22.9 MiB of
old-space garbage, identical on both legs:

| form                                                                                                                |         reclaimed |                                   |
| ------------------------------------------------------------------------------------------------------------------- | ----------------: | --------------------------------- |
| `gc()`                                                                                                              |     **22.88 MiB** | major GC                          |
| `gc({type:'major'})`                                                                                                |     **22.88 MiB** | major GC                          |
| `gc({execution:'sync'})`                                                                                            |     **22.88 MiB** | major GC                          |
| `await gc({execution:'async'})`                                                                                     |     **22.88 MiB** | major GC                          |
| `gc({flavor:'last-resort'})`                                                                                        |     **22.88 MiB** | major GC                          |
| `gc(true)` · `gc(false)` · `gc(1)` · `gc(null)` · `gc(undefined)` · `gc({})` · `gc({foo:1})` · `gc({type:'minor'})` | **0.00 MiB** each | scavenge — the reading is invalid |

The research framed this as "a _truthy_ parameter that is not setting options → `{type:'minor'}`",
and an earlier draft of this document over-generalised further, to "every argument other than
`{type:'major'}` scavenges". Both are wrong. The operative rule is about **whether V8 recognises a
key**: an object carrying `type`, `execution` or `flavor` is parsed as options and defaults to a
major GC; a primitive, an empty object, or an object with only unrecognised keys falls to the legacy
path and scavenges. `gc({})` and `gc({foo:1})` are the cases that separate "is an object" from "is
parsed as options", and the original 7-form list contained neither.

For P3 the safe rule is unchanged and still conservative: **construct the argument yourself or pass
none.** Do not accept a caller-supplied `gc` argument, since the failure is silent either way.

Note `await` matters: `{execution:'async'}` reclaims nothing until the promise settles, so probing it
synchronously scores a working form as broken.

**M3 — one round reclaims; specify a rule, not a count.** A single zero-arg `gc()` reached the
fixpoint in **100/100 trials** across both legs. V8's `kMinNumberOfAttempts = 2 … kMaxNumberOfAttempts
= 7` describes its _internal_ loop and does not translate into needing multiple explicit calls on
this garbage shape. Do not hard-code 1: loop until **two consecutive** rounds each reclaim < 64 KiB,
capped at 7. Measured, that rule exits after **3 calls** — round 1 reclaims 23.4 MB, rounds 2 and 3
both settle. (The dataset's own `roundsRequired` field uses a one-settled-round rule and so reads 1;
the recommended rule is strictly more conservative.)

**A settled `heapUsed` reading is stable to ~1 KiB, not to zero.** The median within-trial spread
across settled rounds is 0.000% — the same integer every round — but a minority of trials move by up
to **1,120 bytes** with no workload running. P3 must treat ~1 KiB as the noise floor of a settled
byte figure, not 0. (Across trials the _baseline_ also drifts — 0.56% on both legs. That is the
harness's own footprint moving, not GC instability; the two must not be conflated.)

**O4 — no difference; standardize on sync `gc()`.** The async form settled in the same 1 round in
50/50 trials on both legs. No measured reason to prefer it, so use the simpler zero-arg synchronous
call.

**O7 — discharged.** All of the above was taken on a real Node 22.23.1 / V8 12.4 binary. Every pass-4
finding previously measured only on Node v24.18.0 reproduces.

---

## 7. Runner classes are not interchangeable

|                           | GitHub-hosted `ubuntu-latest` | container                             |
| ------------------------- | ----------------------------- | ------------------------------------- |
| CPU                       | 4 × AMD EPYC 7763             | 56 × Xeon E5-2680 v4 (shared host)    |
| RAM / cgroup              | 15.6 GiB / unset              | 157.3 GiB visible / **16 GiB cgroup** |
| image                     | `ubuntu24` `20260720.247.2`   | —                                     |
| worst false alarm (`min`) | 4.501                         | 6.649                                 |
| weakest signal @ 500→2000 | 11.43                         | 8.84                                  |
| window                    | 2.54×                         | 1.33×                                 |

The GitHub-hosted runner was **quiet**. Calibrating only there would have supported a ceiling
anywhere in 5…11 and made both the estimator question and the fixture-size question look
irrelevant. The second leg is what exposed them. Since `scripts/verify.sh` runs these gates on
developer machines too, the constants are set from the noisier class.

I have deliberately **not** labelled the container "contended" as a causal claim: the only load
evidence recorded is a start-of-sweep `loadAvg` of ~4.7 on 56 cores, and no CPU quota or steal-time
measurement was taken. What is established is that its ratio distribution has a much heavier tail;
_why_ is not.

One observation for P3, flagged not quantified: on the container `os.totalmem()` reports **157.3
GiB** while the cgroup allows **16 GiB**, and V8 sizes the young generation from the former. That is
M4's hazard visible in our own environment record.

---

## 8. What this does not establish

- **One point in time.** C4 — a runner image bump produced a significant change point with no code
  change. Re-run `perf-calibration.yml` when the image generation moves.
- **One workload shape, and one regression shape.** A parser whose per-message fixed cost dominates
  differently (`dicom` framing, `x12` envelope walking) may have a different tail, and an
  O(n²)-in-field-count regression has a different crossover than the length-based one measured here.
  P5's byte-oriented wave should re-take its own cells rather than assume these transfer.
- **Nothing about constant-factor sensitivity.** C6 stands untouched: this says where the tails are,
  not how small a regression is visible. A 10% slowdown is invisible.
- **The signal's lower tail is under-sampled** — n=20 per cell, and a minimum over 20 is noisy.
- **Nothing about `pathways`.** Out of scope by §2 of the roadmap.
- **The floor is the weakest constant** (1.13× margin) and its failure mode is narrower than the
  roadmap's §7 phrasing implies (§3).
