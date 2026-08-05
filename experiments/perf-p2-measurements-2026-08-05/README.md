# PERF-P2 measurements, 2026-08-05: one more runner class

**An archive, not a phase.** These five files are raw evidence taken while reviving `PERF-P2`
(PR [#34](https://github.com/cosyte/config/pull/34), branch head `8e64739`, still OPEN and still not
merged). Nothing here is imported by anything, nothing runs in CI, and this branch has no PR on
purpose: the branch is the artifact. It is committed only so 75 minutes of measurement is not lost
with a session, because the container class it describes has already changed once underneath this
project.

`#34` is untouched by this branch. Do not merge this into `main` expecting it to move `PERF-P2`
along; it does not, and section 4 says why.

## 1. The box, which is the whole point

A performance figure without its runner is not re-derivable, and this one was misread twice on the
way here.

|                              |                                                                          |
| ---------------------------- | ------------------------------------------------------------------------ |
| `nproc` / `os.cpus().length` | **56**                                                                   |
| cgroup `cpu.max`             | **`1200000 100000`, a 12-CPU quota**                                     |
| cgroup `memory.max`          | 32 GiB (against `os.totalmem()` 157.3 GiB)                               |
| CPU                          | Intel Xeon E5-2680 v4 @ 2.40 GHz                                         |
| Node / V8                    | **22.23.1** / 12.4.254.21-node.56, ADR 0001's calibration binary exactly |
| `NODE_OPTIONS`               | unset                                                                    |
| Host                         | shared with other workers; host `loadavg` 8 to 10 during sweep F         |

**Read the quota, never `nproc`.** `nproc` reports the host's 56 cores and is wrong by a factor of
almost five for anything that matters here. V8 sizes its concurrent GC and compiler pools from the
number `nproc` reports, while the cgroup throttles against the quota, which is the mechanism behind
every fire in this dataset and in `#34`'s.

**This is a third runner class, not a re-run of either of the two that matter.**

|                                                                  | cgroup CPU quota              | memory  |
| ---------------------------------------------------------------- | ----------------------------- | ------- |
| `#34`'s own calibration box (`experiments/perf-p2-false-alarm/`) | `200000 100000`, **2 CPUs**   | 16 GiB  |
| **this box**                                                     | `1200000 100000`, **12 CPUs** | 32 GiB  |
| GitHub-hosted `ubuntu-latest`, where the gate would actually run | 2 vCPU                        | 7.75 GB |

The container class moved 6x between `#34` being written and this being taken, with no decision
behind it. So these numbers neither reproduce `#34`'s box nor predict CI's. They characterise one
box, on one day.

## 2. What was run

Gate code at `8e64739`, unmodified. **No constant was changed**, and none may be: they are frozen by
ADR 0001, and raising a ceiling to stop false fires is how a gate becomes decorative.

- `experiments/perf-p2-false-alarm/run.sh 200`, three times, from a worktree of `8e64739`. 600 fresh
  `vitest` processes over PERF-P0's linear workload module, imported unchanged, at P0 Experiment A's
  fixture sizes. Every ratio recorded is a false alarm by construction. Rows land in
  `data/runs-sweepD.jsonl`, `-sweepE.jsonl`, `-sweepF.jsonl`, 200 rows each, verified by line count.
- PERF-P0 Experiment C (`experiments/perf-calibration/signal-check.test.ts`), coverage off, on the
  same box in the same session: 60 runs at `500 -> 2000` (`hl7`'s own fixture size), 20 each at
  `250 -> 1000` and `1000 -> 4000`. Rows land in `data/signal.jsonl`.

Both sides of the window were measured on the same box, which is what makes the comparison in
section 3 internally valid even though it does not transfer.

Re-summarise the sweeps with `node experiments/perf-p2-false-alarm/analyze.mjs <file>` **from a
checkout of `8e64739`** (that script does not exist on `main`). `data/signal.jsonl` rows carry
`baseObx`, `phase` and `ratioMin` and need no tool.

### The sweeps are not comparable to each other, and that is deliberate

| sweep |                     fires / 200 | condition                                                     |
| ----- | ------------------------------: | ------------------------------------------------------------- |
| D     |                           **0** | taken **with a `gate-refuter` agent live in the same cgroup** |
| E     | **1** (ratio 8.1700, size axis) | taken after that agent finished                               |
| F     |                           **0** | same, quiet                                                   |

`#34`'s `ANALYSIS.md` records a 48-run pass taken alongside concurrent `eslint`/`tsup` work that
fired 6 times in 48 and was discarded, "because it measures the agent, not the gate". **D is under a
milder version of that condition and its 0 must not be read against E's 1.** Only E and F were taken
clean. They are reported together because discarding D silently would hide that the pooled rate
below is a pooled rate over unequal conditions.

Contention can only make fires more likely, so D's 0 is not evidence the gate is quiet; it is one
sample that happened not to stall.

## 3. What the data says

**Noise, 600 runs pooled: 1 fire (0.17%)**, against 4 in 600 (0.67%) on the 2-CPU box.

- worst ratio observed, the fire: **8.1700**, size axis, sweep E run 77
- worst non-firing ratio: 7.6342, size axis, sweep F run 101
- count axis maximum across 600 runs: 5.0354
- 5 `warmup-unstable` axis-skips in 600 runs

Sweep E's fire is the mechanism `#34` describes, reproduced on a box with six times the quota:
warmup settled tight (9.5 to 9.8 ms/pass), the base phase was tight (9.14 to 10.49 ms), and then
**all five** scaled reps ran 74.7 to 83.9 ms where linear predicts about 37. A stall covering an
entire phase is one that `min` cannot cancel, because `min` exists to discard one-sided stalls.

**Signal, same box:**

| base -> 4x                       |      n |    weakest |   p50 |
| -------------------------------- | -----: | ---------: | ----: |
| `250 -> 1000`                    |     20 |     5.9210 | 10.68 |
| **`500 -> 2000`** (`hl7`'s size) | **60** | **8.7376** | 12.88 |
| `1000 -> 4000`                   |     20 | **6.9568** | 14.00 |

**The window, both sides on the same box:**

|                     | worst noise | weakest signal @ `500 -> 2000` |    window |
| ------------------- | ----------: | -----------------------------: | --------: |
| P0, GitHub-hosted   |       4.501 |                          11.43 | **2.54x** |
| P0, 2-CPU container |       6.649 |                           8.84 |     1.33x |
| **this box**        |  **8.1700** |                     **8.7376** | **1.07x** |

Two findings, and the second is the more important one:

1. **Six times the CPU quota cut the fire rate fourfold and did not open the window.** The noise tail
   still crosses `RATIO_CEILING = 8` (the ceiling now sits _below_ the worst observed false alarm)
   and lands within 7% of the weakest real signal. A lower fire rate is not discrimination.
2. **A false negative, newly measured.** At `1000 -> 4000`, 1 of 20 genuine O(n^2) runs scored
   **6.9568**, which a ceiling of 8 would have **passed**. P0 took 10 runs per cell there and
   reported 10.68 as the weakest, so this tail had not been seen. It means the signal distribution
   has its own low tail on a contended runner, and therefore **no choice of ceiling separates
   6.96-signal from 8.17-noise.** That is not a tuning problem.

## 4. What this does and does not settle

**It does not close `PERF-P2`'s second acceptance clause, and `#34` stays unmerged.** The clause is
"does not fire across 200 clean runs". Sweep E fired. More to the point, this box is not the runner
class the gate would run on, so even three clean sweeps here would not have transferred.

**What would settle it, cheapest first:**

1. **The GitHub-hosted runner, quiet, nothing else in the cgroup.** `run.sh` already records
   `cgroupCpuMax` and the GitHub runner fields for exactly this comparison, and
   `.github/workflows/perf-calibration.yml` is the precedent: a manual `workflow_dispatch` job that
   is explicitly not a gate. The analogous job for the P2 sweep is the decisive experiment, and P0's
   GitHub leg already showed a 2.54x window there, so it may well pass. This is O-P2-2 in `#34`'s own
   open questions.
2. **If it does not, the fix is the sampling shape, not a constant.** The failure is a throttle stall
   covering an entire phase. ADR 0001 section 3 fixes the phase _order_ but runs the phases
   consecutively in _time_, and nothing in the contract cancels a throttling state that changes
   between them. Interleaving base and scaled rep by rep, a paired-rep ratio, or a k-of-n re-measure
   on a fire would. That is an ADR 0001 revision, not a `PERF-P2` edit.
3. **A larger fixture is not sufficient on its own.** The signal does climb with fixture size
   (4.69, 8.09, 8.84 in P0), but the `1000 -> 4000` low tail above shows it degrades on a contended
   runner too.

## 5. Traps for whoever reads this next

- **`run.sh` archives on start, not on success.** A `data/runs-<timestamp>.jsonl` can be a five-line
  aborted partial. Check line counts before analysing one. All three files here are exactly 200 rows.
- **`max` is censored on any P2 sweep column.** A ratio above 8 throws, so it has no measured row and
  is recorded separately. Reading a sweep's "max measured" as its worst false alarm is backwards.
- **Do not measure the gate while agents share the cgroup.** See section 2.
- **This branch cannot be merged to `main` as-is, and neither can `#34`.** The em-dash gate
  (`scripts/check-no-emdash.sh`, landed 2026-07-30, after `#34` was written) has no allowlist and
  scans every tracked file. `main` passes it today. `data/runs-sweepE.jsonl` here carries one
  U+2014, inside the gate's own machine-written firing diagnostic, and `#34` carries far more:
  24 lines in `packages/test-utils/src/perf/scaling-gate.ts` alone, 44 in its `ANALYSIS.md`, one in
  its committed `data/runs.jsonl`. Raw measurement output does not get edited to satisfy a style
  gate, so the resolution is an allowlist for machine-written evidence plus a real pass over the
  prose and the source. Filed as a separate concern from reasons (1) and (2); nobody had recorded it.
- **`#34`'s `experiments/perf-p2-false-alarm/ANALYSIS.md` carries six known minor accuracy defects**,
  found by the narrow third pass on 2026-08-05 and deliberately left unapplied: the permitted third
  pass was spent finding them, and putting an ungraded diff on a parked branch was the wrong trade.
  They are documentary and none is a blocker. Whoever revives `PERF-P2` applies them.
