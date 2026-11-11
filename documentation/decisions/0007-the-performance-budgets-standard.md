# 0007: The performance budgets standard

- **Status:** Proposed (2026-11-11). Sections 1 to 5 decide the mechanism. The defaults in section 2
  are proposals: no package is held to a number until its own budgets file is approved by the
  repository's owner in review, and nothing here sets one. The floor's rule is an open question for
  the owner (section 8).
- **Scope:** the limits every `@cosyte/*` package holds its own build to, written in two files
  beside its benchmark suite, and the check that fails a pull request on them: what the files say,
  where the numbers come from, which readings count, and what the check gives up.
- **Relates to:** [ADR 0005](0005-the-performance-standard.md) (the performance standard: what is
  measured, by which instrument, and how much noise each has; every measure this standard limits is
  one ADR 0005 defines) · [`packages/bench/`](../../packages/bench) (`cosyte-bench gate` and
  `cosyte-bench floor`, and the two schemas).
- **Supersedes:** nothing. ADR 0005 stands unchanged, including the rule for when its base against
  head comparison becomes a required check.

## Context

ADR 0005 gave every package one way to measure itself and one way to compare a pull request's build
with its base. Neither fails a pull request on a number. The scaling gate fails on work that grows
faster than its input, and the comparison is advisory until an A/A calibration on its suite meets
ADR 0005's rule. So a package could hold 30 times its input in memory, or load twice the code it
did a month ago, and every check would stay green.

We decided that performance is a first priority for every package: each one has written budgets
that CI enforces, and a floor that only improves, with a regression beyond measured noise failing
the pull request. Every package was then read on realistic inputs on GitHub-hosted runners, each
with a script that judged its reading against proposed budgets. The four packages with such a
script (`bench/budgets.mjs` in `dicom`, `fhir`, `ncpdp` and `terminology`) propose the same four:

- a peak under 20 times the input for a dense shape (many segments, claims, entries or elements);
- a peak under 3 times the input for a large opaque payload (a base64 document, a binary);
- a median cold import under 15 ms;
- throughput, in bytes a second, not falling by more than half from a shape's smallest size to its
  largest.

They were written as advisory scripts that always exit 0, one per package, each with its own way of
naming a shape, and they read the raw peak of the V8 heap. This standard puts the limits in one file
format that `@cosyte/bench` reads, reads the peak the way ADR 0005 says a memory budget does
(`budgetPeakBytes`: the heap and external memory together, and for an input under 64 KiB the median
call above the empty-call floor), and adds the floor.

## Decision

### 1. Two files and one check

A package that adopts this standard keeps two files beside its suite, by convention
`bench/budgets.json` and `bench/floor.json`, and its CI runs, on a reading of the pull request's
build:

```sh
cosyte-bench gate reading.json --budgets bench/budgets.json --floor bench/floor.json \
  --base-floor <the base branch's bench/floor.json> --summary gate.md
```

| Exit | When                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Every limit held                                                                                                                                                                                     |
| 1    | A case is over a budget (`breach`), a measure is above the highest of the floor's recorded readings plus 3 times their spread (`regression`), or the floor file is looser than its base (`loosened`) |
| 2    | A limit names something the reading did not measure, a file could not be read, or the reading was not taken on a GitHub-hosted runner (`unjudged`)                                                   |

A skip is not a pass, as in ADR 0005: a budget on a case whose throughput skipped, a rule that
matches no case, a peak budget on a matched case whose size class the rule's `peakMultiple` leaves
out, a floor case the reading lacks, and a budgets file or a floor that holds no limit at all, each
exits 2. A key either file's schema does not
know is refused, so a mistyped limit is an error, never a limit nobody checks.

### 2. The budgets file

`schema/budgets-v1.schema.json`. A list of rules; each names a benchmark, a size, both or neither,
and every rule that matches a case applies to it, so a narrower rule can only add a limit. A limit
holds at exactly its value.

| Field                    | The limit                                                                                                            | Reads (ADR 0005)                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `peakMultiple`           | The most the peak may be, as a multiple of the average bytes of one input, by size class: `small`, `medium`, `large` | `budgetPeakBytes`, over `bytesPerPass / inputsPerPass` |
| `allocBytesPerOp`        | The most one operation (one input, one message) may allocate                                                         | `heapBytesPerOp + externalBytesPerOp`                  |
| `minBytesPerSecond`      | The least throughput in bytes of input a second, for the sizes the rule names                                        | `throughput.bytesPerSecond`                            |
| `minOpsPerSecond`        | The least throughput in operations a second                                                                          | `throughput.opsPerSecond`                              |
| `import.maxColdImportMs` | The most the median cold import may take                                                                             | `importCost.medianMs`                                  |
| `import.maxGzipBytes`    | The most every file the import loads may weigh, gzipped                                                              | `importCost.totalGzipBytes`                            |

**Size classes**, by the average bytes of one input: `small` under 64 KiB (`FLOOR_INPUT_BYTES`, where
`budgetPeakBytes` reads the median call above the empty-call floor), `medium` from 64 KiB and under
1 MiB, `large` from 1 MiB (`LARGE_INPUT_BYTES`). A class a rule does not name has no peak budget
under that rule. A case whose suite gave no byte count has no class, and a peak budget on it cannot
be judged.

**The proposed defaults**, from the audit's scripts above. Each is a proposal: a package's first
budgets file is written from its own floor reading and approved by the owner in review, and may
start looser than a default where the package does not yet meet it, with the work to meet it
written down.

| Limit                                                     | Proposed default  | Basis                                                                                                                                      |
| --------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `peakMultiple`, a dense shape                             | 20 in every class | **The audit's proposal**                                                                                                                   |
| `peakMultiple`, a large opaque payload                    | 3 in `large`      | **The audit's proposal**                                                                                                                   |
| `import.maxColdImportMs`                                  | 15                | **The audit's proposal**                                                                                                                   |
| `allocBytesPerOp`, `minBytesPerSecond`, `minOpsPerSecond` | none              | **Per package.** The audit proposed none, and what a message costs depends on its format; each is written from the package's floor reading |
| `import.maxGzipBytes`                                     | none              | **Per package**, from its floor reading                                                                                                    |

The audit's fourth proposal, throughput kept to half from a shape's smallest size to its largest,
is a ratio between two cases, not a limit on one, and the budgets file does not express it. The
scaling gate (ADR 0001) is the instrument for growth with input size; a package that wants a
throughput limit at its largest size writes one with `minBytesPerSecond` on that size.

### 3. The floor file

`schema/floor-v1.schema.json`. What the default branch measured, case by case, for every measure
where lower is better: milliseconds an operation (the median of the timing processes' medians), the
peak (`budgetPeakBytes`), bytes allocated an operation, the median cold import and the gzipped
bytes the import loads.

- **Recorded from an A/A set.** `cosyte-bench floor <reading>... --out bench/floor.json` takes at
  least `FLOOR_MIN_READINGS` (7) readings of one commit, of one suite, on one runner class and one
  Node major version, each from a GitHub-hosted runner, and refuses anything else. For each measure
  it keeps the highest of them (`value`) and the highest less the lowest (`noise`): the spread the
  set measured with nothing changed. A measure any reading of the set did not measure gets no floor.
- **A regression is past the limit.** A reading's measure above its limit, `value` plus
  `FLOOR_NOISE_MULTIPLE` (3) times `noise`, is a `regression`. The highest alone would not do: the
  next reading of unchanged code lands above the highest of `n` about one time in `n + 1`, whatever
  the distribution. Section 7 gives the rate the limit allows.
- **It only improves, and not on luck.** `cosyte-bench floor <reading>... --from bench/floor.json`
  records a new set into the old floor. A measure takes the new set's value and noise only when the
  new set's whole limit is below the old set's lowest reading (`value - noise`): an improvement the
  old set's own noise cannot explain. Otherwise it keeps the old value and noise, and no case or
  measure is dropped. A first version of this rule took the lower of the old and the new value and
  kept the old noise; on unchanged code that lowers the limit whenever a set happens to read low,
  so the floor drifted down and failed unchanged code more often with every recording. The rule
  here almost never fires on unchanged code (section 7), so the limit does not drift, and it can
  never rise.
- **A looser floor file is a finding.** `gate --base-floor` compares a pull request's floor file with
  its base branch's and finds a limit raised, a case or a measure gone, or a floor for another
  suite, runner class or Node line: each is `loosened`, exit 1. A floor is loosened only with the
  owner's words, on a pull request whose check says so. `gate --floor` needs exactly one of
  `--base-floor` and `--no-base-floor`: the shared job passes `--no-base-floor` only when the base
  branch has no floor file, a package's first floor, and the summary says the floor was not compared.
- **A floor that keeps no measure** judges nothing, and exits 2 rather than passing.
- **Compared like with like.** A reading of another suite, runner class or Node major version is not
  compared with the floor (exit 2), as ADR 0005 section 6 says no reading is portable. A runner image
  change is a new runner class; its floor is recorded afresh and approved as a loosening.
- **A new case has no floor** until the next recording adds it, and is judged by its budgets alone.

### 4. Only GitHub-hosted readings

`gate` and `floor` read only a reading whose `environment.runner` is `github-actions` on a
`github-hosted` runner. A developer machine's numbers describe that machine, and a self-hosted
runner is not the runner class ADR 0005 measured its noise on; either is refused with exit 2.
`cosyte-bench run` still measures anywhere: the refusal is in what a budget or a floor will read.

The check reads what the reading says about itself (`environment.runner`, from the environment
variables of the process that took it). It is trustworthy only when the job that runs `gate` took
the reading itself, in the same job; a reading committed to the repository or handed in from
anywhere else can claim any runner. The shared job therefore takes its reading and judges it in one
job, and reads no reading file from the pull request.

### 5. In the shared CI

The check runs as a job of the shared workflow in `cosyte/.github`, off by default behind its own
input, so a package opts in, and with a stable job id so it can be a required check. On a pull
request the job builds the head, takes a reading of it on its `ubuntu-latest` runner at the lowest
Node line, and runs `cosyte-bench gate` with the package's two files and the base branch's floor,
failing on exit 1 or 2. It takes the reading itself, in the same job (section 4), and reads the base
floor from the base branch's commit (`git show <base sha>:bench/floor.json`), never from the pull
request's tree, which the pull request can change; it passes `--no-base-floor` only when the base
commit has no floor file. A second job, on the default branch after a merge or by hand, takes the A/A
set on separate runners and opens a pull request with `cosyte-bench floor --from` when the floor
improved. That job is to be built in `cosyte/.github`; this record decides what it runs.

**When the job may be required.** Once a package's budgets and floor are approved. The bytes the
import loads are the same on every runner; time is not (ADR 0005 section 5 saw four CPU models in
one run), so a budget or a floor on time is set with that room, and a false failure in the wild is
a review trigger. How much the peak and allocations move between hosted runners has not been
measured yet: a package's A/A set is the first measure of it.

### 6. Constants

| Constant               | Value | Basis                                                                                                                                                                   |
| ---------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LARGE_INPUT_BYTES`    | 1 MiB | **Judgement.** Where ADR 0005's large-case plan starts to matter (a 1 MiB call takes tens of milliseconds) and where the audit's large inputs begin                     |
| `FLOOR_MIN_READINGS`   | 7     | **Measured by simulation** (section 7). With five, exponential noise failed one measure 1.2% of the time; a package may record from more                                |
| `FLOOR_NOISE_MULTIPLE` | 3     | **Measured by simulation** (section 7). The margin above the highest reading, in spreads, that keeps one measure's rate near or under 1% for the noise shapes simulated |

### 7. What it cannot do

- **Bound a false failure rate on the floor for every noise shape.** The limit is a spread of seven
  readings, not a calibrated rate as ADR 0005's comparison has, so the rate depends on the shape of
  the noise. We simulated it: seven readings, the limit above, then 30 recordings with `--from`, each
  of seven fresh readings of the same code, 40,000 trials a shape (the package's own test repeats
  the exponential case with a seeded generator and holds it under 1% with no drift). The chance that
  one more reading of unchanged code fails one measure:

  | Noise                 | Fresh floor | After 1 recording | After 10 | After 30 |
  | --------------------- | ----------- | ----------------- | -------- | -------- |
  | normal                | 0.00%       | 0.01%             | 0.01%    | 0.01%    |
  | log-normal, sigma 0.5 | 0.17%       | 0.21%             | 0.19%    | 0.21%    |
  | exponential           | 0.40%       | 0.44%             | 0.39%    | 0.41%    |
  | log-normal, sigma 1   | 1.24%       | 1.25%             | 1.28%    | 1.12%    |

  The first rule (three readings, the limit the highest plus one spread, the lower value kept on
  each recording) failed one measure under normal noise 6.3% of the time fresh and 22% after 30
  recordings in the same simulation; five readings and three spreads still failed exponential noise
  1.2% of the time. Under very heavy noise (log-normal, sigma 1, where the 95th
  percentile is about five times the median) one measure still fails about 1.2% of the time; we
  chose seven readings and three spreads as the rule that keeps the other shapes well under 1% at
  a cost of seven readings a recording, and say plainly that the heaviest shape is just over it.

- **Bound the rate across a suite.** Each case's three measures and the import's two are separate
  chances. With `k` measures the chance that unchanged code fails any one is at most `k` times the
  rate of one, and `1 - (1 - p)^k` if they are independent: for a suite of `N` cases that is
  `k = 3N + 2`. Ten cases make 32 measures: about 0.3% under normal noise, 6% under log-normal noise
  of sigma 0.5, 12% under exponential noise, if every measure were that noisy. Most are not (the
  gzipped bytes do not move at all), but a suite with many noisy time measures will fail unchanged
  code now and then, and each such failure is review trigger 1.
- **Catch a small regression.** The limit is the highest of seven readings plus three spreads. In
  a simulation of normal noise it sits about 3.4 spreads above the true median of the measure
  (about 9.2 standard deviations), so a real regression is caught:

  | Regression, in spreads | Caught        |
  | ---------------------- | ------------- |
  | 1                      | under 1%      |
  | 2                      | about 7 to 9% |
  | about 3.5              | about half    |
  | about 5.2              | about 92%     |

  For a measure whose seven readings spread 5% of its value, a 10% regression is caught about 7 to
  9% of the time, a 17% one about half the time, and 95% detection needs about 27%. The floor is a
  backstop against large regressions; small ones are the base against head comparison's job (ADR
  0005 section 4), which reads both builds on one runner. The same margin makes the floor slow to
  move: `floor --from` takes a new set only after an improvement of about four spreads, so a floor
  rarely tightens.

- **Allow any growth of a measure that measured no noise.** The gzipped bytes are the same in every
  reading of one commit, so the floor holds them exactly: a pull request that adds code adds bytes,
  and is a `regression` until the floor is loosened with the owner's words or the budget alone is
  used for size.
- **Judge a reading of another runner class.** Until a floor is recorded on a new class, the check
  exits 2 there.
- **Trust a reading it did not watch being taken.** The runner check reads what the reading says
  about itself (section 4).
- **Hold the budgets file to its base branch.** A pull request can loosen its own
  `bench/budgets.json`, and only review catches that: a change to it is the owner's to approve.
- Everything ADR 0005 section 6 says each measure cannot see.

### 8. The open question: how strict the floor is

The floor's rule trades false failures against sensitivity, and the owner chooses between:

1. **This rule** (seven readings, the highest plus three spreads, tightening only beyond the old
   noise): unchanged code fails one measure rarely (section 7: well under 1% for most noise
   shapes, about 1.2% for the heaviest simulated), and a regression is caught reliably only from
   about five spreads. Small regressions are left to the base against head comparison.
2. **A tighter rule** (fewer spreads, or the highest alone): smaller regressions caught, more false
   failures. The first version of this record, the highest plus one spread over three readings,
   failed one measure of unchanged code 6.3% of the time under normal noise.
3. **Time out of the failing floor check.** Milliseconds an operation stay in the floor file and
   the summary, and never fail a pull request; the floor fails only on the peak, allocations, the
   cold import and the gzipped bytes, and time is the comparison's alone. Time is the measure that
   moves most between hosted runners (ADR 0005 section 5).

We recommend 1 until packages' A/A sets show how much each measure moves, then revisit 3 for time.

## Consequences

**Positive.** Every package can hold its memory, allocations, throughput, import time and size to
written numbers, and a pull request that breaks one, or that measures above the highest of the
default branch's recorded readings plus three times their spread, fails. The limits live in files a reader can check, in one format, and
a looser file is itself a finding.

**Negative.** Each package needs its own approved budgets and an A/A set of readings before the check
means anything: several readings of a whole suite, minutes each. A floor that holds exactly (the
gzipped bytes) fails every pull request that adds code until it is loosened knowingly. A runner image
change makes every floor unjudgeable until it is recorded afresh.

**Review triggers.**

1. A `regression` on a pull request that a rerun, or a reading of the code, shows did not make
   anything worse.
2. ADR 0005's review triggers, each of which moves what a floor measured.
3. A package that cannot meet a proposed default after the work to meet it, or a default that every
   package meets by a wide margin.
