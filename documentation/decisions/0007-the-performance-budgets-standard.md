# 0007: The performance budgets standard

- **Status:** Proposed (2026-11-11). Sections 1 to 5 decide the mechanism. The defaults in section 2
  are proposals: no package is held to a number until its own budgets file is approved by the
  repository's owner in review, and nothing here sets one.
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

| Exit | When                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Every limit held                                                                                                                                                       |
| 1    | A case is over a budget (`breach`), a measure is above its floor by more than the floor's noise (`regression`), or the floor file is looser than its base (`loosened`) |
| 2    | A limit names something the reading did not measure, a file could not be read, or the reading was not taken on a GitHub-hosted runner (`unjudged`)                     |

A skip is not a pass, as in ADR 0005: a budget on a case whose throughput skipped, a rule that
matches no case, a floor case the reading lacks, each exits 2. A key either file's schema does not
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
  least `FLOOR_MIN_READINGS` (3) readings of one commit, of one suite, on one runner class and one
  Node major version, each from a GitHub-hosted runner, and refuses anything else. For each measure
  it keeps the highest of them (`value`) and the highest less the lowest (`noise`): the spread the
  set measured with nothing changed. A measure any reading of the set did not measure gets no floor.
- **A regression is beyond that noise.** A reading's measure above `value + noise` is a
  `regression`. The limit is the highest plus the whole spread, not the highest, because the next
  reading of unchanged code lands above the highest of three about a quarter of the time (one in
  `n + 1` for `n` readings, whatever the distribution).
- **It only improves.** `cosyte-bench floor <reading>... --from bench/floor.json` records a new set
  into the old floor: each value becomes the lower of the old and the new, each noise stays the
  floor's own, and no case or measure is dropped. `gate --base-floor` compares a pull request's floor
  file with its base branch's and finds a value or a noise raised, a case or a measure gone, or a
  floor for another suite, runner class or Node line: each is `loosened`, exit 1. A floor is loosened
  only with the owner's words, on a pull request whose check says so.
- **Compared like with like.** A reading of another suite, runner class or Node major version is not
  compared with the floor (exit 2), as ADR 0005 section 6 says no reading is portable. A runner image
  change is a new runner class; its floor is recorded afresh and approved as a loosening.
- **A new case has no floor** until the next recording adds it, and is judged by its budgets alone.

### 4. Only GitHub-hosted readings

`gate` and `floor` read only a reading whose `environment.runner` is `github-actions` on a
`github-hosted` runner. A developer machine's numbers describe that machine, and a self-hosted
runner is not the runner class ADR 0005 measured its noise on; either is refused with exit 2.
`cosyte-bench run` still measures anywhere: the refusal is in what a budget or a floor will read.

### 5. In the shared CI

The check runs as a job of the shared workflow in `cosyte/.github`, off by default behind its own
input, so a package opts in, and with a stable job id so it can be a required check. On a pull
request the job builds the head, takes a reading of it on its `ubuntu-latest` runner at the lowest
Node line, and runs `cosyte-bench gate` with the package's two files and the base branch's floor,
failing on exit 1 or 2. A second job, on the default branch after a merge or by hand, takes the A/A
set on separate runners and opens a pull request with `cosyte-bench floor --from` when the floor
improved. That job is to be built in `cosyte/.github`; this record decides what it runs.

**When the job may be required.** Once a package's budgets and floor are approved. The bytes the
import loads are the same on every runner; time is not (ADR 0005 section 5 saw four CPU models in
one run), so a budget or a floor on time is set with that room, and a false failure in the wild is
a review trigger. How much the peak and allocations move between hosted runners has not been
measured yet: a package's A/A set is the first measure of it.

### 6. Constants

| Constant             | Value | Basis                                                                                                                                               |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LARGE_INPUT_BYTES`  | 1 MiB | **Judgement.** Where ADR 0005's large-case plan starts to matter (a 1 MiB call takes tens of milliseconds) and where the audit's large inputs begin |
| `FLOOR_MIN_READINGS` | 3     | **Judgement.** The fewest that measure a spread beside a highest; more measure it better, and a package may record from more                        |

### 7. What it cannot do

- **Bound a false failure rate on the floor.** The noise is the spread of a few readings, not a
  calibrated rate as ADR 0005's comparison has. A floor recorded from more readings is less likely
  to fail unchanged code; none is certain not to.
- **See a regression within the floor's noise.** A floor whose set spread 10% on time does not see a
  10% slowdown. The base against head comparison (ADR 0005 section 4) is the finer instrument for
  time.
- **Allow any growth of a measure that measured no noise.** The gzipped bytes are the same in every
  reading of one commit, so the floor holds them exactly: a pull request that adds code adds bytes,
  and is a `regression` until the floor is loosened with the owner's words or the budget alone is
  used for size.
- **Judge a reading of another runner class.** Until a floor is recorded on a new class, the check
  exits 2 there.
- Everything ADR 0005 section 6 says each measure cannot see.

## Consequences

**Positive.** Every package can hold its memory, allocations, throughput, import time and size to
written numbers, and a pull request that breaks one, or that is worse than the default branch by more
than that branch's own spread, fails. The limits live in files a reader can check, in one format, and
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
