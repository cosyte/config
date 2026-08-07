# PERF-P2: false-alarm sweep: analysis

**Status: complete. The acceptance clause is NOT reliably met, and that is reported as the result.**

> **Headline.** The roadmap's P2 acceptance clause is "the gate … does **not** fire across 200 clean
> runs." Three independent 200-run sweeps were taken on the same box, against the same gate code, on
> a workload that is linear by construction and therefore cannot regress:
>
> | sweep | fires / 200 | ratios                  | axis              |
> | ----- | ----------: | ----------------------- | ----------------- |
> | A     |       **3** | 8.9372, 9.3467, 11.0068 | _unknown: see §5_ |
> | B     |       **0** | none                    | none              |
> | C     |       **1** | 9.9859                  | size (measured)   |
>
> **4 fires in 600 runs (0.67%).** One sweep of three met the clause outright; the other two did not.
> The rate is dominated by ambient CPU contention rather than by anything the gate does, which is
> itself the finding, and it is a stronger claim than any single sweep could have supported.
>
> **No constant was changed in response.** They are frozen by ADR 0001 and PERF-P2 implements a
> decided contract; tuning one from inside the implementing phase is exactly the move the ADR's
> review triggers exist to prevent. This file is the evidence that a trigger has been pulled.

Datasets: `data/runs.jsonl` (sweep C, current) and `data/runs-*.jsonl` (archived sweeps).
Re-summarise any of them with `node analyze.mjs data` or `node analyze.mjs data/runs-<stamp>.jsonl`.

---

## 1. What was measured

200 fresh `vitest` processes per sweep, one `scalingGate` call each, over PERF-P0's linear workload
module imported **unchanged**, at P0 Experiment A's own fixture sizes (count `n` = 1,000 ADT
messages; size = 10 ORU messages at 500 → 2,000 OBX lines). Every ratio recorded is a false alarm by
definition.

The headline difference from P0's Experiment A is **the warmup rule**: P0 warmed with `hl7`'s fixed
~2,100 invocations, the kit warms on a time budget with a stability rule, and that is precisely why
ADR 0001 §2 assigned this re-measurement to P2:

> Changing the warmup rule moves the operating point, so the ceiling must be re-checked: on both
> sides. … that run must be taken under the warmup rule decided here, not under `hl7`'s fixed-count
> one. P2 owns both.

**It is not the only difference, and §4 turns on saying so.** Two more remain uncontrolled, and both
are asymmetric between the axes by construction:

1. **P0 ran one axis per process; the kit runs both, count first.** P2's size-axis figure is measured
   _second_, in a process that has already built, warmed on and timed a 1,000 + 4,000-message ADT
   corpus. That is a C5-class carry-over that can only land on the size axis.
2. **The timed loop body differs**: `parseMessage(m).segments.length` in the same module (P0) versus
   `weigh(parse(input))` through two parameter bindings (the kit). Different bytecode length feeds
   the tier-up budget in W1, the mechanism ADR 0001 itself cites.

So this sweep measures **the shipped configuration end to end**, which is what the acceptance clause
asks. It cannot attribute a difference from P0 to the warmup rule alone, and §4 does not.

## 2. The numbers

Sweep C (current dataset) and sweep B (archived), which differ only in when they ran:

|                                     | C · count |   C · size | B · count | B · size |
| ----------------------------------- | --------: | ---------: | --------: | -------: |
| measured                            |       199 |        198 |       200 |      195 |
| skipped `warmup-unstable`           |         0 |          1 |         0 |        5 |
| not reached (an earlier axis fired) |         1 |          1 |         0 |        0 |
| ratio p50                           |    4.0351 |     4.6251 |    4.0328 |   4.5974 |
| ratio p95                           |    4.1613 |     5.0473 |    4.1972 |   5.1678 |
| ratio max, measured runs            |    4.3295 |     6.1872 |    5.7123 |   5.8350 |
| ratio min                           |    2.9003 |     2.4761 |    2.4368 |   2.9792 |
| **fired**                           |      none | **9.9859** |      none |     none |

Sweep A's summary is preserved in §5 rather than in this table; its dataset was destroyed (§5).

Warmup settles quickly in the ordinary case and has a long tail, and the two sweeps differ enough
that pooling them would understate it, so both are given. Settled runs only:

|            | C · count | C · size | B · count | B · size |
| ---------- | --------: | -------: | --------: | -------: |
| warmup p50 |    542 ms |   542 ms |    544 ms |   547 ms |
| warmup p95 |    975 ms |   894 ms |  1,215 ms | 1,162 ms |
| warmup max |  2,978 ms | 4,509 ms |  4,703 ms | 4,734 ms |

Cost per run: **C** p50 1,567 ms / p95 2,165 ms / max 8,233 ms; **B** p50 1,602 ms / p95 **3,826 ms**
/ max 9,925 ms. Sweep B is the slower of the two on every tail statistic, which is the same ambient
contention §3 attributes the fires to.

**One read that is not available from the "measured" columns.** A run whose ratio exceeds 8 throws,
so it has no measured row and its ratio is recorded separately from the assertion's `actual` field.
Reading "max, measured runs" as the worst false alarm would be exactly backwards.

## 3. The mechanism, with evidence rather than speculation

Sweep C's single fire is preserved in full, because the harness now keeps the gate's own diagnostic
for a fired run (`run 111`, `firedDiagnostic`):

```
base  : 10 input(s) @ size 500  | min  7.1947 ms | samples [11.5081, 8.0156, 9.0432, 7.1947, 7.7457]
scaled: 10 input(s) @ size 2000 | min 71.8458 ms | samples [86.7662, 71.8458, 102.5957, 98.5414, 106.0708]
ratio: 9.9859
```

A linear parser at a 4× step should land near 28.8 ms. **Every one of the five scaled reps was slower
than 71 ms**, while the base phase caught a genuinely fast rep at 7.19 ms (against a sweep-wide p50 of
8.68). The two phases were measured in different machine states, and `min`, which exists to discard
one-sided stalls: cannot help when the stall covers the _entire_ phase.

The same row shows how that state arises, and it is the more uncomfortable finding:

```
warmup: stable after 2591 ms, 37 batches
        (ms/pass: 33.48, 9.31, 18.10, 7.45, 10.61, … 24.02, 20.69, 19.31, 20.00)
```

The batch series oscillates between **7.25 and 36.80 ms/pass (a factor of 5**) and the warmup rule
nonetheless declared steady state, because the last three batches (20.69, 19.31, 20.00) happened to
land within ±5% of their median. ADR 0001 §2 anticipated this shape for _two_ consecutive batches
("can be met by a coincidental pair on a heavy-tailed distribution") and chose three as the guard.
On a tail this fat, three coincide too. **`WARMUP_STABLE_BATCHES = 3` is a judgement constant, and
this is the first measurement of it against a genuinely heavy-tailed runner.**

Why the runner is heavy-tailed: the container runs under a **`cpu.max` of 2 CPUs** (`200000 100000`)
while `os.cpus().length` reports **56**, so V8 sizes its concurrent GC and compiler thread pools from
the host's core count and the cgroup is throttled whenever they run. Throttling stops the _whole
group_ for the remainder of the 100 ms scheduling period.

**The consequence is a confound a same-process ratio does not cancel, and it is not the one ADR 0001
models.** §3 of the ADR handles C5 (JIT state differing between the phases) by fixing the phase
order. But the phases are also separated _in time_, and the cgroup's throttling state changes on a
timescale of hundreds of milliseconds. Nothing in the estimator, the phase order, or the warmup rule
addresses that, because it is not a property of the program under test.

## 4. Did the warmup rule move the operating point? Count axis no; size axis yes, by ~8%

ADR 0001 §2 gave P2 an explicit job here: _"Changing the warmup rule moves the operating point, so
the ceiling must be re-checked: on both sides … P2 owns both."_ This is that check, and it has to be
done **per axis**, because the two axes have materially different distributions in both datasets and
pooling them hides exactly the effect being looked for.

The comparable P0 cell is `../perf-calibration/data/ratios.jsonl` filtered to
`coverage=false, phase="cold", ordering="NF"`: the regime the kit ships in.

| axis  | population                      |   n |        p50 |    p95 |    max |
| ----- | ------------------------------- | --: | ---------: | -----: | -----: |
| count | P0 (fixed-count warmup)         |  50 |     4.0382 | 4.2569 | 5.2846 |
| count | P2 sweeps A+B+C (time-budgeted) | 593 | **4.0328** | 4.1833 | 5.7123 |
| size  | P0 (fixed-count warmup)         |  50 |     4.2665 | 4.7537 | 5.3717 |
| size  | P2 sweeps A+B+C (time-budgeted) | 586 | **4.6100** | 5.1660 | 6.1872 |

**Count axis: unchanged.** p50 moves −0.1%.

**Size axis: the body of the distribution shifted +8.1%** (p50 4.2665 → 4.6100; p95 +8.7%). All three
P2 sweeps agree with each other (4.6100 / 4.5974 / 4.6251) and all three differ from P0 in the same
direction, so this is a reproducible shift and not drift between sessions.

**Why that matters more than an 8% number sounds.** P0's governing worst false alarm: the 6.6487
that `RATIO_CEILING = 8` was set to clear on this runner class: is itself a **size-axis** `N→4N`
row. The ceiling's container-leg margin is 8 / 6.649 = 1.20×, and an 8% shift of that axis's body
consumes a real part of it. This is the "re-check on both sides" the ADR asked for, and the answer on
the side that set the constant is _not_ "unchanged".

**But the warmup rule is not established as the cause, because it is not the only variable.** Two
further uncontrolled differences from P0 Experiment A, both of which predict an asymmetry that falls
on the size axis specifically:

1. **P0 ran one axis per process; the kit runs both, count first.** P2's size-axis measurement is
   therefore taken _second_, in a process that has already built, warmed on and timed a 1,000 + 4,000
   message ADT corpus. That is a C5-class carry-over, it is asymmetric between the axes by
   construction, and the count axis (which shows no shift) is the one that runs first.
2. **The timed loop body differs.** P0 calls `parseMessage(m).segments.length` in the same module;
   the kit calls `weigh(parse(input))` through two parameter bindings. Different bytecode length
   feeds the tier-up budget in W1: the mechanism ADR 0001 itself cites for why no fixed invocation
   count can be correct.

So the honest statement is: **the operating point moved on the size axis, and this dataset cannot
say whether the warmup rule, the two-axes-per-process shape, or the loop body did it.** Separating
them is a controlled re-run, and it is O-P2-1.

**On the tail, separately: these data do not show the warmup rule made it worse.** At the observed
4-in-600 rate, the probability P0's 100 matched rows contain zero fires is **0.51**: a coin flip.
Widening to P0's 400 coverage-off `N→4N` rows gives 0.069, still not decisive. P0 was underpowered to
detect a tail this rare, not contradicted by it. (If anything that understates the underpowering:
P0's rows are per-ratio while 4/600 is per-run.)

_(Two earlier drafts of this section got this wrong in opposite directions: the first compared
against a coverage-ON warm population and called the warmup rule "suggestively" implicated; the
second fixed the regime but pooled P0's axes and concluded the body had not moved at all. Both are
recorded as corrected rather than silently rewritten, because the pooled comparison is the more
seductive mistake: it reaches a reassuring answer through a table that looks matched.)_

## 5. Two process failures in taking these measurements, recorded

**5.1: Sweep A's axis attribution was invented, not measured.** The harness inferred the firing axis
as _"the count axis runs first, so an unmeasured count axis means count fired."_ That is wrong in the
silent direction: any fire throws out of `scalingGate`, so **neither** axis is ever recorded on a
fired run and the condition was unconditionally true. Every fire was hard-coded to `"count"`, and the
first draft of this file reported "all three on the count axis" as a measurement and built a
mechanism around it ("the count axis has the larger corpus and therefore the most allocation").

The attribution is now read out of the gate's own diagnostic, which names its axis, and the kit's
suite asserts that property directly (`test/perf/gate.test.ts`, "every diagnostic names its own
axis") so the experiment cannot silently depend on an unasserted format. **Sweep C's genuine
attribution is the _size_ axis**: the opposite of what sweep A claimed.

**5.2: `run.sh` truncated on start, and nearly cost a 200-run dataset.** Re-running the sweep
overwrote sweep A's `runs.jsonl`. It survived only because the working tree had been committed in the
interim, so it was recoverable with `git show cfcdfbc:…`; had that commit been garbage-collected
first it would have been gone for good. It is now committed properly as `data/runs-sweepA.jsonl`, and
`run.sh` archives to `data/runs-<timestamp>.jsonl` instead of truncating. Sweep A's summary, which
re-derives exactly from the recovered file:

```
gate FIRED : 3 / 200 (1.5%), perf-scaling-ceiling, ratios 8.9372…11.0068
count: measured 194 · skipped 3 (warmup-unstable) · p50 4.0327 · p95 4.2052 · max 5.6167 · min 1.5833
size : measured 193 · skipped 4 (warmup-unstable) · p50 4.6100 · p95 5.3247 · max 6.0754 · min 2.5909
```

Sweep A's fire count and ratios were validly measured: they come from the assertion's `operator` and
`actual`. Only its `firedAxis` field is invented (§5.1), and it is left in the committed dataset as-is
rather than back-filled: a field that cannot be recomputed should not be quietly replaced by a guess.

One number from sweep A is worth keeping even so: its lowest count-axis ratio was **1.5833** against
a floor of 1.5: a margin of **1.06×**. ADR 0001 calls the floor "the weakest constant in this table"
at a 1.13× margin over P0's worst of 1.702. The observed margin is thinner than the ADR believed.

## 6. What this does and does not license

**It does not license changing a constant.** Not from here. `RATIO_CEILING` is conditional on the
estimator, the sampling shape and the warmup rule together, and ADR 0001 review trigger 2 says it
"cannot be moved on its own." Raising it to clear 11.01 would put it above **8.84**: the weakest real
O(n²) signal measured at `hl7`'s own fixture size: converting a gate that occasionally cries wolf
into one that is guaranteed to sleep through a real regression. That is strictly worse.

**It does not license shipping quietly either.** Roadmap §5's risk #1 is a flaky gate: "a gate that
false-alarms gets disabled, and then there is no gate: worse than never building it, because the
repo now _claims_ protection." At 0.67% per run across 13 packages × 2 axes, that is not remote.

**What it does license, and what PERF-P2 therefore did:**

1. **Ship the kit as specified.** The implementation is faithful to ADR 0001 and 600 runs found no
   defect in it. Every fire was the gate doing exactly what the contract says, on a ratio it
   genuinely measured, in a machine state that made the measurement meaningless.
2. **Ship the measurement with it**, so the next phase inherits evidence instead of an assumption.
3. **Do not wire `test:perf` into CI**, and do not adopt the gate anywhere on the strength of the
   global ceiling. ADR 0001 §5 already requires each package to prove its own _fixtures_ with
   `assertScalingGateFires`. This sweep adds the other half: **a package must also establish its
   runner class**, because the self-check says nothing about whether the runner is quiet enough.
   P5/P6 should run this sweep on the runner the package's CI actually uses.
4. **Raise it with the founder before P4.** `hl7` is the first real consumer and the first place a
   false alarm blocks a clinical-safety fix.

## 7. Open questions this leaves

- **O-P2-1: What moved the size axis by 8%?** §4: the size-axis body shifted +8.1% against P0's
  matched cell, reproducibly across all three sweeps, while the count axis did not move at all. Three
  candidates are confounded and this dataset separates none of them: the time-budgeted warmup, the
  two-axes-in-one-process shape, and the changed loop body. **This is the highest-value follow-up**,
  because the axis that moved is the axis whose worst false alarm set `RATIO_CEILING`. A controlled
  re-run varying one at a time is cheap: P0's harness still exists beside this one.
- **O-P2-1b: Is `WARMUP_STABLE_BATCHES = 3` enough on a heavy-tailed runner?** §3 shows the rule
  declaring steady state on a series oscillating 5×, because three consecutive batches coincided.
  This is the leading candidate for the _fires_ specifically, as distinct from the body shift above.
  ADR 0001 §2's own review instruction: "raise `WARMUP_BATCH_MS` first and relax
  `WARMUP_STABLE_TOL` only if that fails": does not cover raising the _batch count_, which is what
  this evidence points at.
- **O-P2-2: Does a dedicated runner clear it?** P0's GitHub-hosted leg had a worst false alarm of
  4.5007 against the container's 6.3002 (coverage-off). Re-run `run.sh` in Actions to find out; the
  harness already records `cgroupCpuMax` and the GitHub runner fields for exactly this comparison.
- **O-P2-3: Is the size axis the more exposed one?** Everything points that way: it carries the
  higher p50, p95 and max in all three sweeps, it is the axis whose body shifted (§4), it took **10 of
  the 13** `warmup-unstable` skips across 600 runs, and the one genuinely-attributed fire was on it.
  Sweep A's contrary claim was an artifact (§5.1). Still n = 1 on the fire attribution.
- **O-P2-4: Is the floor now a warning?** ADR 0001's review trigger 3 fires on "the first floor
  breach observed in the wild _without_ a fixture-construction bug behind it." 1.5833 is not a
  breach; it is a 1.06× margin from one. Not yet triggered, but closer than the ADR assumed.

## 8. Provenance

Node **22.23.1** / V8 **12.4.254.21-node.56**: deliberately, not incidentally: ADR 0001's constants
are calibrated there and its review trigger 4 is "Node's major version moves." `run.sh` refuses any
other major.

That refusal earned itself immediately. The first probe of this gate was taken on **Node 24.18.0** in
the same container and scored **6.709** on the count axis for the same linear workload that gives a
p50 of 4.03 on Node 22, and its warmup frequently failed to settle at all. Whatever ADR 0001 says
about Node 22, it does not currently transfer to Node 24. Nothing here measures Node 24 well enough
to say more than that.

|                      |                                                           |
| -------------------- | --------------------------------------------------------- |
| CPU                  | Intel Xeon E5-2680 v4 @ 2.40 GHz, `os.cpus().length` = 56 |
| **cgroup CPU quota** | **`200000 100000`: 2 CPUs**                               |
| cgroup memory        | 16 GiB (against `os.totalmem()` = 157.3 GiB)              |
| `NODE_OPTIONS`       | unset                                                     |
| Concurrent load      | an agent session shared the same cgroup throughout        |

That last row is a real limitation and is not smoothed over. A 48-run pass taken _with_ concurrent
`eslint`/`tsup`/`attw` work in the same cgroup fired **6 times in 48 (12.5%)**; it was discarded
rather than reported, because it measures the agent, not the gate. The three sweeps above were taken
without concurrent builds, but "without concurrent builds" is not "dedicated," and the spread
between 12.5%, 1.5%, 0.5% and 0% across four passes on one box is the honest measure of how much this
number depends on what else holds the quota.
