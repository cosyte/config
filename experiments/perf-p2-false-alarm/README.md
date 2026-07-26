# PERF-P2 — the false-alarm sweep

**Read `ANALYSIS.md` first.** This file is how to re-run it.

A **throwaway-but-committed experiment**, the same shape as `../perf-calibration/`. Nothing here is
exported from `@cosyte/test-utils`, nothing here runs in `pnpm test` or `pnpm test:perf`, and nothing
else in the repo imports it.

## The question

The roadmap's acceptance clause for PERF-P2 has two halves. One is "fires on an injected O(n²)
fixture", and that is a _test_ — it lives in
`packages/test-utils/test/perf/timed/self-check.test.ts`. The other cannot be a test, because it is a
statement about a distribution:

> …and does **not** fire across 200 clean runs.

## Why it could not be inherited from PERF-P0

P0 already measured 3,200 ratios on a linear workload, which is a much larger false-alarm sample than
this one. It does not answer the question, and ADR 0001 §2 says so in terms:

> `min` over 5 reps partially launders an unfinished warmup, because the last reps are the fast ones
> — and `RATIO_CEILING` was set from the worst false alarm in the whole population, which is a _warm_
> row. **Changing the warmup rule moves the operating point, so the ceiling must be re-checked — on
> both sides.** […] The false-alarm side […] is roadmap P2's own acceptance clause, "does **not** fire
> across 200 clean runs"; that run must be taken under the warmup rule decided here, not under
> `hl7`'s fixed-count one. P2 owns both.

P0 warmed with `hl7`'s fixed ~2,100 invocations. The kit warms on a **time budget with a stability
rule** — ≥500 ms, stop on three consecutive 50 ms batches within ±5%, cap 5 s — which was P1's
judgement and had never been run at scale by anyone. So the false-alarm side is re-measured here
against the thing that actually ships.

`false-alarm.test.ts` imports P0's linear workload module (`../perf-calibration/workload.ts`)
**unchanged**, at P0 Experiment A's own fixture sizes — 1,000 ADT messages on the count axis, 10 ORU
messages at 500 → 2,000 OBX lines on the size axis. Nothing in this directory modifies that module:
its bytecode length and coverage block count are what P0's 3,200 committed measurements were taken
against.

**The warmup rule is not the only variable, though**, and `ANALYSIS.md` §4 turns on that: P0 ran one
axis per process where this runs both (size second), and the timed loop body differs. See §1 there
before attributing any difference from P0 to the warmup rule.

## What one run is

One fresh `vitest` process, one `scalingGate` call over a workload that is **linear by construction**.
Every ratio recorded is therefore a false alarm by definition — the questions are only how large, how
often the gate refused to answer at all (a skip is a third outcome, distinct from both firing and
passing), and how often it fired.

`run.sh` launches the file once per process rather than looping in one, because that is how a real CI
gate runs: once, in a fresh fork, with no JIT state inherited from a previous trial.

## Running it

```bash
mise exec node@22 -- ./run.sh          # 200 runs — the acceptance clause, ~25 min
mise exec node@22 -- ./run.sh --quick  # 5 runs, smoke check
mise exec node@22 -- ./run.sh 50       # n runs
node analyze.mjs data                  # re-summarise a dataset without re-taking it
```

**Node 22 is required, not preferred.** ADR 0001's constants are calibrated on Node 22.23.1 / V8 12.4
and its review trigger 4 is "Node's major version moves" — re-measuring the ceiling on 24 answers a
different question. `run.sh` refuses to run on anything else. This is not hypothetical: the first
probe of this gate was taken on Node 24.18.0 in this container and scored **6.709** on the count axis
for the same linear workload that scores ~4.0 on 22.

## What is in `data/`

| File                     | What it is                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `runs.jsonl`             | the current sweep — one row per run: both axes' status, ratio, full sample vectors, warmup shape |
| `runs-<timestamp>.jsonl` | an archived sweep, written by `run.sh` before it starts a new one                                |
| `runs-sweepA.jsonl`      | the first sweep. ⚠️ its `firedAxis` field is **invented** — see below                            |
| `environment.json`       | the machine, the Node/V8 build, and the **cgroup CPU quota** — see `ANALYSIS.md`                 |

⚠️ **`runs-sweepA.jsonl` predates the axis-attribution fix.** Its harness inferred the firing axis
rather than reading it, and inferred it wrongly — every fire is labelled `count` regardless (see
`ANALYSIS.md` §5.1). Its fire count and ratios are valid; its axis is not. `analyze.mjs` suppresses
the axis breakdown for any row lacking `firedDiagnostic`, which is exactly the pre-fix rows, so
re-summarising it will not reprint the bad attribution. The field is left in the file rather than
back-filled: a value that cannot be recomputed should not be quietly replaced by a guess.

Full sample vectors are retained, never pre-reduced. W2's criticism of min-of-N as a _reported_
statistic stands, and a dataset that threw away the vector could not be re-analysed under a different
estimator.

## Re-run it when

The same triggers as ADR 0001: the runner image generation moves, Node's major version moves, or any
of `REPS` / `SCALE_STEP` / `PHASE_ORDER` / the warmup rule / the estimator changes. Each of those
moves the operating point the ceiling was set from, and this is the measurement of one side of it.
