# PERF-P0 — calibration results

**Run 2026-07-25. Node 22.23.1 / V8 12.4.254.21-node.56 on both legs.** 3,200 ratio measurements
(1,600 per runner class) and 200 GC trials. Raw data in `data/` (container leg) and
`data/github-hosted/` (the `ubuntu-latest` leg, artifact of run
[30169401396](https://github.com/cosyte/config/actions/runs/30169401396)). Every table below is
re-derivable with `node analyze.mjs <dir>` — nothing here was typed by hand.

Method, cell design and the pre-registered decision rule: `README.md`.

---

## The three constants

| Constant          | Value                                                     | Basis                                                                                                                                                   |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ratio ceiling** | **10** — _conditional on the ratio estimator being `min`_ | 1.79× above the worst false alarm measured in 800 cold trials; ~1.6× below the ≈16 an O(n²) regression produces on a 4× workload                        |
| **Ratio floor**   | **1.5**                                                   | Below all 800 cold samples (worst 1.753); above the ≈1 that an equal-workload-both-sides bug produces                                                   |
| **GC rounds**     | **2**, via a stability rule, capped at 7                  | One zero-arg `gc()` reached the fixpoint in 100/100 trials on both legs; the second round is the confirmation, and 7 is V8's own `kMaxNumberOfAttempts` |

The ceiling's conditional is the single most important output of this experiment, and §1 is about it.

---

## 1. The estimator is load-bearing for whether the gate works at all

P1 was expected to choose the estimator on the strength of W2's argument (min-of-N is asserted
without evidence anywhere it appears). That framing is incomplete: on a **contended** machine the
estimator choice decides whether the ceiling has usable headroom.

Worst and best **cold** ratio observed, pooled over all 8 cells, 400 cold trials per leg:

| estimator     | GitHub-hosted min…max | container min…max | headroom at ceiling 10 |
| ------------- | --------------------- | ----------------- | ---------------------- |
| `min`         | 3.963 … **4.501**     | 1.753 … **5.587** | **1.79×**              |
| `median`      | 3.679 … 4.500         | 2.231 … **8.457** | 1.18×                  |
| `trimmedMean` | 3.819 … 4.707         | 2.472 … **8.584** | 1.16×                  |
| `mean`        | 3.591 … 4.820         | 2.291 … 8.252     | 1.21×                  |

On the quiet GitHub runner every estimator is equivalent — the worst false alarm sits between 4.50
and 4.82 whichever you pick, and any ceiling from 8 upward would do. On the contended 56-core
container the estimators separate sharply: `min` tops out at **5.587** while the three central
estimators reach **8.25–8.58**.

That matters because the signal is fixed. A genuine O(n²)-in-length regression on a 4× workload lands
near **16**. So the usable design space for the ceiling is the gap between the worst false alarm and
16, and the estimator choice nearly halves it:

- with `min` — noise ≤ 5.59, signal ≈ 16, and a ceiling of 10 sits 1.79× above the noise and 1.6×
  below the signal. Comfortable on both sides.
- with any central estimator — noise ≤ 8.58, so a ceiling of 10 has **1.16×** margin. That is not a
  gate, it is a coin flip on a loaded runner. Pushing the ceiling to 12 to recover margin leaves only
  1.33× below the signal, and the gate stops discriminating.

**Recommendation to P1.** Use `min` for the **ratio assertion**, and keep W2's remedy where it
belongs — retain and report the full sample vector, headline a robust central estimate in the
_benchmark_, and never present min _as_ the result. This is not a rehabilitation of the folklore.
W2's criticism was that min-of-N is asserted with no evidence; that criticism stands. What changed is
that the ratio's upper tail now has evidence, measured here, on our workload and our runners. The
mechanism is unremarkable once stated: benchmark noise is one-sided, so `min` is the only estimator
that does not import a scheduler stall on one side of a ratio into the ratio itself.

**Bound on this claim.** It covers the _ratio_, on two runner classes, on a linear workload. It says
nothing about which estimator to publish in `benchmarks.md`, and it is not a general finding about
V8 microbenchmarks.

---

## 2. Ceiling and floor

**Ceiling = 10.** With `min`, 1.79× above the worst of 800 cold trials and 1.6× below the ≈16 signal.

This happens to be the value `hl7`'s shipped gate already uses. It was judgement there (roadmap
§10/O1 says so plainly); it now has a measured basis, and the basis is _narrower_ than the original
reasoning assumed. `hl7`'s comment justifies 10 as "2.5× headroom over the ideal 4" — but the ideal
is not what a ceiling has to clear, the **false-alarm tail** is, and on a contended runner that tail
is 5.59, not 4. The real headroom is 1.79×, not 2.5×. Same constant, correct reason, and P4 should
rewrite the comment rather than keep it.

**Floor = 1.5.** Below every one of the 800 cold samples (worst 1.753 with `min`) and above the ≈1
an equal-workload-both-sides bug produces.

Two honest caveats P1 must carry into the ADR:

- **The floor's margin is thin — 1.17× with `min`.** It is the weakest constant here. The fail-safe
  rule (skip loudly when the precondition does not hold) does more work on the floor side than the
  ceiling side, and P1 should consider whether a floor breach should fail or warn.
- **The floor does not catch dead-code elimination on the count axis, and §7 of the roadmap implies
  it does.** If the parse were optimized away entirely, the count-axis loop still runs 4N vs N
  iterations, so the ratio stays ≈4 and the floor never fires. What the floor actually catches is
  _the two phases got the same workload_ — a wrong input size, a corpus builder returning the same
  array twice. That is a real bug class and worth asserting, but it is narrower than "an accidental
  benchmark short-circuit". Dead-code elimination has to be prevented structurally (the sink
  accumulator, W5), not detected by a floor.

---

## 3. The pre-registered coverage rule TRIPPED — exclude perf tests from coverage

The rule, recorded in `README.md` before the sweep: exclude iff |Δ p50| > 5% **or** Δ p95 > 15%, on
any cell.

| leg           | worst \|Δ p50\| |               worst Δ p95 | verdict     |
| ------------- | --------------: | ------------------------: | ----------- |
| GitHub-hosted |            4.5% |                      0.7% | not tripped |
| container     |            2.3% | **44.1%** (count/NF/cold) | **TRIPPED** |

The trip is on one cell of the noisy leg, and it is plausibly noise rather than instrumentation: that
same cell's coverage-**off** run produced a 7.217 outlier, so both sides of the comparison are drawn
from a heavy tail at n=50. I am recording that read, and following the pre-registration anyway.
The rule was written down precisely so a tripped result could not be explained away after the fact,
and the remedy is close to free — perf tests assert no product behaviour, so their contribution to a
coverage report is noise in the first place.

**Recommendation to P1: exclude the perf tests from the coverage run.** Not because coverage was
proven to distort the ratio, but because it was not proven _not_ to, and the cost of excluding is
zero.

### What V1's magnitude actually is

V1 was mechanism-only going in: `@vitest/coverage-v8` drives V8's `kBlockCount` precise coverage,
compiling an effectful counter increment into the measured function body in every tier, at a cost
that scales with executed-block count and density — which differ between the two compared phases,
so it need not cancel. Measured:

- **Coverage costs 1.17×–1.43×** on this workload. Real, and much smaller than the "several-fold"
  inflation `hl7`'s gate comment assumes.
- The cost is **higher on the size axis** (1.32–1.43×) than the count axis (1.17–1.35×) — consistent
  with block density differing between workloads, as the mechanism predicts.
- **The non-cancellation is measurable and small.** Comparing how much coverage inflates the base
  phase vs the quad phase: ≤ 4.5% on the GitHub runner, up to 14.4% on the container's noisiest cell.
  On the GitHub leg the size axis shows the predicted direction consistently — the base phase is more
  inflated than the quad phase (1.41× vs 1.37×), which is exactly the per-message fixed-overhead
  block density argument.

So: **the mechanism is confirmed, and its magnitude does not dominate.** `hl7`'s claim that coverage
overhead "cancels" is still wrong as written — it does not cancel, it _mostly_ cancels, at a residual
of a few percent. P4 must correct that comment.

---

## 4. Ordering (C5) is small once warmed, and warmup is the real problem (W1)

**Ordering.** Running `N→4N` versus `4N→N` moves the median ratio by |Δ| ≤ 3.8% (GitHub) and ≤ 5.3%
(container). C5 is real but is not the dominant term — it is smaller than the run-to-run noise it
sits inside. P1 does not need to randomize or interleave phases on this evidence.

**Warmup.** W1 said a fixed-count warmup cannot reach steady state. It does not, and the size of the
miss is directly visible in the sample vectors. Ratio of the first rep to the last within a phase:

| leg           | cold trials | warm trials |
| ------------- | ----------- | ----------- |
| GitHub-hosted | 1.09×–1.23× | 0.96×–1.05× |
| container     | 1.04×–1.15× | 0.97×–1.02× |

After `hl7`'s exact ~2,100-invocation warmup, the **first measured rep is still 9–23% slower than the
fifth**. By the second trial in the same process it is within 5%. The shipped fixed-count warmup is
demonstrably not at steady state at the moment the gate takes its only measurement — which is also
the mechanism behind the cold-vs-warm tail difference throughout §1.

This is the empirical basis for P1's "time-budgeted warmup, samples discarded until the distribution
stabilizes". Note the interaction with §1: `min` over 5 reps partially launders an unfinished warmup,
because the last reps are the fast ones. That is a second, independent reason the estimator and the
warmup rule have to be decided together.

---

## 5. GC: M2 confirmed and broadened, M3 does not bite, O4 answered

**M2 — confirmed on Node 22, and the rule is broader than stated.** With ~22.9 MiB of old-space
garbage, identical on both legs:

| form                                                                 |         reclaimed |                                   |
| -------------------------------------------------------------------- | ----------------: | --------------------------------- |
| `gc()`                                                               |     **22.88 MiB** | major GC                          |
| `gc({type:'major'})`                                                 |     **22.88 MiB** | major GC                          |
| `gc(true)` · `gc(false)` · `gc(1)` · `gc({})` · `gc({type:'minor'})` | **0.00 MiB** each | scavenge — the reading is invalid |

The research framed this as "a _truthy_ parameter that is not setting options → `{type:'minor'}`".
That under-states it: `gc(false)` and `gc({})` are equally broken. The operative rule for the kit is
**only the zero-argument form and an explicit `{type:'major'}` perform a major GC; every other
argument silently downgrades to a scavenge.** P3's fail-safe should reject _any_ argument it did not
itself construct, not just truthy ones.

**M3 — one round is enough here, so specify a rule, not a count.** A single zero-arg `gc()` reached
the fixpoint in **100/100 trials** across both legs; the following round reclaimed < 64 KiB every
time. V8's documented `kMinNumberOfAttempts = 2 … kMaxNumberOfAttempts = 7` describes its _internal_
maximal-reclamation loop, and on this garbage shape it does not translate into needing multiple
explicit calls. Do not hard-code 1 — the kit should loop until two consecutive rounds each reclaim
< 64 KiB, capped at 7. Measured exit: after 2 calls, always.

**Once settled, a `heapUsed` reading is bit-stable.** Within-trial spread across rounds 2…12 was
**0.000%** on both legs — the same integer, every round. Any non-zero delta from a settled baseline,
inside one process, is real. (Across trials the _baseline_ drifts — 0.56% on both legs' sync leg, and
0.8 MiB downward over the container's async leg. That is the harness's own footprint moving, not GC
instability, and the two must not be conflated.)

**O4 — no difference; standardize on sync `gc()`.** The async form settled in the same 1 round in
50/50 trials on both legs, with the same 0.000% settled spread. There is no measured reason to prefer
it, so the kit should use the simpler zero-arg synchronous call.

**O7 — discharged.** Everything above was taken on a real Node 22.23.1 / V8 12.4 binary. Every pass-4
finding that had only been measured on Node v24.18.0 reproduces.

---

## 6. Runner classes are not interchangeable, and that is the finding to remember

|                             | GitHub-hosted `ubuntu-latest` | container                             |
| --------------------------- | ----------------------------- | ------------------------------------- |
| CPU                         | 4 × AMD EPYC 7763             | 56 × Xeon E5-2680 v4 (shared)         |
| RAM / cgroup                | 15.6 GiB / unset              | 157.3 GiB visible / **16 GiB cgroup** |
| image                       | `ubuntu24` `20260720.247.2`   | —                                     |
| worst cold ratio (`min`)    | 4.501                         | 5.587                                 |
| worst cold ratio (`median`) | 4.500                         | 8.457                                 |

The GitHub-hosted runner was **quiet** — quiet enough that a calibration run only there would have
supported a ceiling of 8 and made the estimator question look irrelevant. The contended box is what
exposed both. Since `scripts/verify.sh` runs these gates on developer machines too, the constants
must cover the noisier class, and they are set from it.

One observation worth carrying into P3, not measured here: on the container `os.totalmem()` reports
**157.3 GiB** while the cgroup allows **16 GiB**. V8 sizes the young generation from the former. That
is M4's hazard visible in our own environment record — flagged, not quantified, because P0's memory
leg is about GC rounds rather than young-generation sizing.

---

## 7. What this does not establish

- **One point in time.** C4 is that a runner image bump produced a statistically significant change
  point with no code change. Re-run `perf-calibration.yml` when the image generation moves; treat
  these constants as due for review, not settled.
- **One workload shape.** A synthetic HL7-shaped tokenizer. A parser whose per-message fixed cost
  dominates differently (`dicom` byte framing, `x12` envelope walking) may have a different tail.
  P5's byte-oriented wave should sanity-check its own cells rather than assume these transfer.
- **Nothing about constant-factor sensitivity.** C6 stands untouched: this experiment says where the
  false-alarm tail is, not how small a regression the gate can see. It cannot see a 10% slowdown.
- **Nothing about `pathways`.** Out of scope by §2 and nothing here changes that.
- **The floor is the weakest constant**, at 1.17× margin, and its failure mode is narrower than the
  roadmap's §7 phrasing implies (§2).
