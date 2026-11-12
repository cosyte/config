<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/bench

> How fast, how much memory, how heavy: measured the same way in every package, and kept as data.

[![npm version](https://img.shields.io/npm/v/@cosyte/bench.svg)](https://www.npmjs.com/package/@cosyte/bench)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.15.0-brightgreen.svg)](https://nodejs.org)

Benchmarks for the @cosyte/\* packages: throughput, latency percentiles, memory, cold import time and loaded bytes, as versioned JSON; a base against head comparison interleaved on one machine; and a check of a reading against a package's budgets and its floor.

## Why this exists

The scaling gate in `@cosyte/test-utils/perf` catches work that grows faster than its input, and it
says plainly that it cannot see a change that makes everything 10% slower: both of its phases slow
down together and the ratio does not move. This package is the other half. It measures one build
the way a consumer runs it (the built entry, in a plain Node process), writes what it measured with
the machine it measured it on, and compares a pull request's build against its base on one machine,
interleaved, so the machine's noise lands on both sides.

It also keeps us honest about what a number means. Every reading names its runner, its Node version
and every sample behind it; every comparison carries the interval behind its verdict; and the
comparison's false alarm rate is something we measure on the runner it runs on, not something we
assume.

## Status

`@cosyte/bench` is on the Cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

It is new, and joins the line the other packages in this repository share. What is decided is in [ADR 0005](https://github.com/cosyte/config/blob/main/documentation/decisions/0005-the-performance-standard.md),
the performance standard, including every constant in `BENCH_CONTRACT` and where it comes from. The
results format is versioned on its own (`schemaVersion: 1`) and only grows within a version.

## Install

```sh
pnpm add -D @cosyte/bench
```

Node `>=22.15.0`. No runtime dependencies.

## Usage

A suite is a module whose default export is `defineSuite(...)`: a `.mjs` file on any supported
Node, or a `.ts` file on a Node that strips types (22.18 and later). It is handed the module under test
rather than importing it, so the same suite measures a base build and a head build. Every corpus is
built in code, from an index: the runner never reads a data file, so the inputs are synthetic by
construction.

```ts runnable
import { defineBenchmark, defineSuite } from "@cosyte/bench";

const message = (segments: number) => "MSH|^~\\&|LAB\r" + "OBX|1|NM|GLU||99\r".repeat(segments);

// In bench/parse.bench.ts this is the module's default export.
const suite = defineSuite({
  name: "@cosyte/example parse",
  benchmarks: [
    defineBenchmark({
      name: "parse",
      sizes: [
        {
          label: "10 segments",
          build: () => ({ inputs: Array.from({ length: 64 }, () => message(10)) }),
        },
        { label: "10,000 segments", build: () => ({ inputs: [message(10_000)] }), compare: false },
      ],
      bind: (pkg: { parse: (raw: string) => string[] }) => (raw: string) => pkg.parse(raw),
      weigh: (segments) => segments.length,
    }),
  ],
});

suite.benchmarks[0]?.sizes.length; // => 2
```

Then, from the package's directory, after a build:

```sh
# A reading of this build: throughput, latency, memory, import cost.
cosyte-bench run --suite bench/parse.bench.ts --target dist/index.mjs --out bench.json

# Base against head, interleaved on this machine. The base is built in another checkout.
cosyte-bench compare --suite bench/parse.bench.ts \
  --base ../base/dist/index.mjs --head dist/index.mjs --summary comparison.md

# Check that a results file matches the schema.
cosyte-bench check bench.json

# Judge a reading taken on a GitHub-hosted runner against the package's budgets and its floor.
cosyte-bench gate bench.json --budgets bench/budgets.json --floor bench/floor.json
```

Exit codes: 0 clean, 1 a finding (a regression, a results file that does not match the schema, or a
limit not held), 2 could not measure or judge (a skip, a process that died, an input it could not
read). A skip is not a pass.

A `run` whose measuring process fails for one case still measures and writes every other case. The
reading lists what failed in `failures` (the phase, `timing`, `memory` or `floor`, the case, and the
first line of the error; the whole error goes to stderr) and the command exits 2. A case whose timing
failed is left out of `cases`; one whose memory failed keeps its timing with its memory `null`. A
case whose warmup never settled is not a failure: it is in `cases`, its throughput `skipped` with
the reason `warmup-unstable`.

## Entry points

| entry point                                   | what it is                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cosyte-bench`                                | the bin: `run`, `compare`, `calibrate`, `check`, `gate` and `floor`                                                                                                      |
| `@cosyte/bench`                               | writing a suite (`defineSuite`, `defineBenchmark`), judging ratios (`judge`), reading results (`readResults`, `RESULTS_SCHEMA`, `budgetPeakBytes`), and `BENCH_CONTRACT` |
| `@cosyte/bench/schema/results-v1.schema.json` | the results schema as JSON Schema, for a tool in another language                                                                                                        |
| `@cosyte/bench/schema/budgets-v1.schema.json` | the budgets file's schema                                                                                                                                                |
| `@cosyte/bench/schema/floor-v1.schema.json`   | the floor file's schema                                                                                                                                                  |
| `@cosyte/bench/package.json`                  | the manifest                                                                                                                                                             |

The module entry point has no side effects: importing it starts no process. The schema is plain JSON:

```ts runnable
import schema from "@cosyte/bench/schema/results-v1.schema.json" with { type: "json" };

schema.properties.schemaVersion.const; // => 1
```

The budgets and floor schemas are plain JSON too:

```ts runnable
import budgets from "@cosyte/bench/schema/budgets-v1.schema.json" with { type: "json" };
import floor from "@cosyte/bench/schema/floor-v1.schema.json" with { type: "json" };

budgets.properties.kind.const; // => "budgets"
floor.properties.kind.const; // => "floor"
```

```ts runnable
import { BENCH_CONTRACT, judge } from "@cosyte/bench";

BENCH_CONTRACT.ROUNDS; // => 12
judge([1.1, 1.12, 1.09, 1.11, 1.1, 1.13, 1.1, 1.08, 1.12, 1.1, 1.11, 1.09]).verdict; // => "regression"
```

## Overrides

There are none, on purpose. Every constant that shapes a measurement is frozen in `BENCH_CONTRACT`:
a comparison's false alarm rate was measured with those values, and a package that changed one would
be running an instrument nobody has calibrated. What a package does choose is in its suite and on
the command line:

- the sizes, and which of them a pull request's comparison runs (`compare: false` leaves a slow size
  to the readings);
- `weigh`, the number a result is reduced to, and `longRun`, the size the long run uses besides the
  largest size whose long run fits in 60 s;
- `--only <benchmark or case>`, `--processes <n>`, `--no-memory` and `--no-import` on `run`.

## What it measures

| Measure                                | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What it cannot see                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Throughput, small to very large inputs | Per size, fresh processes; a warmup by the scaling gate's rule, or by the large-case plan below when every warmup batch is one long pass; 5 samples of whole passes of at least 50 ms; the median of the processes' medians                                                                                                                                                                                                                                                                                | Anything the suite's sizes do not cover; numbers from another machine                                                               |
| Latency p50, p95, p99                  | One call at a time on a nanosecond clock, up to 2 s or 5,000 calls; a percentile is reported only with at least 10 calls above it                                                                                                                                                                                                                                                                                                                                                                          | Calls shorter than 20 clock reads (skipped, typed); the tail of a size with few calls                                               |
| Allocations per operation              | Heap growth over windows of `n` and `2n` operations in which no collection ran, in a process with a 64 MiB young generation; the difference cancels the cost of reading the heap. When every window collects, the largest pair is counted with what its collections reclaimed (`method: "gc-accounted"`). A pair whose `2n` window counted more than 64 KiB fewer than its `n` window is no count and is measured again at half the window; when every pair does, the count is skipped (`allocation-fell`) | Native memory a library allocates outside V8's accounting                                                                           |
| Peak memory                            | Per call, the higher of what was in use just before any collection during the call and at its end, above what was in use before it: the V8 heap (`peakHeapBytes`), external memory such as Buffers and ArrayBuffers (`peakExternalBytes`), and the two together (`peakTotalBytes`); each also above the run's empty-call floor (`peakTotalAboveFloorBytes` and the like), below                                                                                                                            | Native memory a library allocates outside V8's accounting                                                                           |
| Heap flat over a long run              | 30 rounds, the heap settled after each; a Theil-Sen slope over the last 24; growing when the fitted growth reaches 64 KiB. On the long-run size and on the largest size whose 30 rounds fit in 60 s                                                                                                                                                                                                                                                                                                        | A leak too small to reach 64 KiB over the run (each result says the smallest it could see, `detectableBytesPerOp`); external memory |
| Cold import and loaded bytes           | 20 fresh processes import the target, 20 import an empty module, interleaved; one more records every file the import loads, with its gzip size                                                                                                                                                                                                                                                                                                                                                             | What a bundler keeps after tree shaking                                                                                             |

Memory measurements need `gc()`; the runner starts those processes with `--expose-gc` itself, and
with `--no-concurrent-array-buffer-sweeping`, so a collection frees the ArrayBuffers it found dead
before it ends and the external memory it reports before and after is exact.

### The empty-call floor and small inputs

Reading the peak costs memory of its own: settling the heap, the profiler that records each
collection, the record itself. A reading therefore measures an empty call once, in a fresh process
through the same probe (`memoryFloor`), and gives each peak figure both raw and above the floor's
median, never below zero (`peakTotalAboveFloorBytes`, `medianPeakTotalAboveFloorBytes`, and the same
for the heap and external memory).

On a GitHub-hosted runner the floor's median call is stable, about 3.4 KiB. Its highest call is not:
usually about 29 KiB (one call, the first), and once 369,888 bytes. That highest call is the
probe's, and it lands in a case's highest peak too, which is why a few hundred bytes of input could
not read under 20 times its size whatever the code did. Read the floor's median as the probe's cost;
its highest is not a fixed figure.

A memory budget reads `budgetPeakBytes(caseReading)`: for a case whose inputs average under
`BENCH_CONTRACT.FLOOR_INPUT_BYTES` (64 KiB) it is the median call's total above the floor's median,
the code's typical call without the probe; for any other case, or one whose suite gave no byte
count, it is the highest raw `peakTotalBytes`. At 64 KiB the probe's usual highest call is about
2% of a 20 times budget, so a large input keeps the raw highest figure, which needs nothing from
another process. A suite that added its own empty "floor" case can drop it.

What the rule gives up:

- **A cost in fewer than half the calls is not bounded.** Under 64 KiB the budget reads the median
  of the case's 20 calls, so a cost that shows in fewer than half of them does not move it. In one
  reading a small case's highest call was 292,784 bytes against a median of 38,672: the budget read
  the median. The highest raw peak is still in the reading (`peakTotalBytes`) for anyone who looks.
- **The switch is a hard edge at 64 KiB.** A case whose inputs average 64 KiB or more reads its
  highest raw total, and one a byte under reads its median call above the floor. Two sizes either
  side of the edge can therefore read very different budgets for the same code.
- **The 2% is the usual highest, not every highest.** The one 369,888-byte floor call is about 28%
  of a 20 times budget at 64 KiB, so a large case whose highest call lands on such a probe outlier
  reads it as the code's.

### Large cases

A case whose single call takes longer than a warmup batch (50 ms) cannot settle by the scaling
gate's warmup rule on a shared runner: every batch is one call, and one call's jitter is what the
batch was there to average away. When 500 ms of warmup have passed, the rule has not settled, and
the last three batches were each one call of at least 50 ms, the warmup moves to the large-case
plan: one call at a time until the median of the last 5 calls is within 5% of the median of the 5
before them, at most 30 s from the start. Its samples are the same 5, each one call at that size.
Each process records the plan it ended on (`plan`), and a reading marks such a case. A case that
settles by the standard rule never moves, so small cases are measured exactly as before.

## The comparison

Each of 12 rounds runs every case once on the base build and once on the head build, each in a fresh
process, back to back; even rounds run the base first, odd rounds the head. A round gives one ratio
per case: the head's fastest sample over the base's. The verdict reads the sign test's interval on
the median of those 12 ratios (the 3rd smallest to the 3rd largest), which assumes nothing about the
shape of the noise:

- `regression`: the whole interval is above +3%;
- `improvement`: the whole interval is below 1 / 1.03;
- `no-regression`: the whole interval is at or below +3%;
- `inconclusive`: it straddles +3%. Not a pass and not a failure.

With the two sides the same, each case's chance of a false `regression` is at most 79 / 4096, about
1.9%, whatever the noise, as long as the rounds are independent. How often it actually happens on a
given runner, and how large a slowdown it reliably finds there, is what `cosyte-bench calibrate`
measures. The comparison posts its numbers and is not a required check until an A/A calibration on
its runner class shows, with 95% confidence, that false alarms are under 1% of the comparisons that
measured, and that comparisons with a skipped case are under 1% of all of them (ADR 0005). A
skipped case is never counted as a pass.

`calibrate --inject <fraction>` plants a slowdown on the head side: after each timed pass it reads
the clock until that fraction of the pass's own time has passed. The change a comparison then
measures is not exactly that fraction, and differs by workload and machine, so a calibration
reports the change it observed for each case, and a detection rate is read against that.

## Budgets and the floor

A package holds its build to two files beside its suite. `cosyte-bench gate` reads one reading
against both and exits 1 on any finding, 2 when something a limit names was not measured or a file
holds no limit at all (a skip is not a pass), and 0 when every limit held. It reads only a reading
taken on a GitHub-hosted runner (`environment.runner`): a developer machine's numbers describe that
machine, so they are refused with exit 2.

That runner check reads what the reading says about itself, from the environment variables of the
process that took it. It is trustworthy only when the CI job that runs `gate` took the reading
itself, in the same job; a reading file committed to the repository or handed over from elsewhere
can say anything.

[ADR 0007](https://github.com/cosyte/config/blob/main/documentation/decisions/0007-the-performance-budgets-standard.md)
is the standard, with the proposed defaults.

**The budgets file** (`bench/budgets.json`, `schema/budgets-v1.schema.json`) is the limits a
package commits to. A package's first budgets are approved by a person in review; the tool only
reads them. Each rule names a benchmark, a size, both or neither, and every rule that matches a
case applies to it:

```json
{
  "schemaVersion": 1,
  "kind": "budgets",
  "rules": [
    { "peakMultiple": { "small": 20, "medium": 20, "large": 20 } },
    { "benchmark": "parse: base64 document", "size": "4 MiB", "peakMultiple": { "large": 3 } },
    {
      "benchmark": "parse: dense",
      "size": "1 KiB",
      "allocBytesPerOp": 65536,
      "minOpsPerSecond": 20000
    }
  ],
  "import": { "maxColdImportMs": 15, "maxGzipBytes": 40960 }
}
```

- `peakMultiple`: the most `budgetPeakBytes` may be, over the average bytes of one input, by size
  class: `small` under 64 KiB, `medium` under 1 MiB, `large` from 1 MiB. A rule with a
  `peakMultiple` must name a limit for the class of every case it matches: a matched case whose
  class it leaves out cannot be judged (exit 2).
- `allocBytesPerOp`: heap and external bytes allocated by one operation (one input).
- `minBytesPerSecond`, `minOpsPerSecond`: the least throughput.
- `import.maxColdImportMs`, `import.maxGzipBytes`: the median cold import and the gzipped bytes the
  import loads.

A limit holds at exactly its value. A key the schema does not know is refused, a rule that matches
no case in the reading cannot be judged (exit 2), and neither can a file with no limit in it, so a
typo or a renamed case is never a limit nobody checks.

The check has no base branch to hold the budgets file to: a pull request can loosen its own
budgets file, and only review catches that. A change to `bench/budgets.json` is the owner's to
approve.

**The floor file** (`bench/floor.json`, `schema/floor-v1.schema.json`) is what the default branch
measured, case by case: milliseconds an operation, the budget's peak, bytes allocated an
operation, the median cold import and the gzipped bytes. `cosyte-bench floor` records it from an
A/A set, at least seven readings of one commit, each on a GitHub-hosted runner of one runner class
and Node line. For each measure it keeps the highest of them (`value`) and the highest less the
lowest (`noise`). A reading is a regression when a measure is above its limit, `value` plus three
times `noise`. For a memory measure (the peak and bytes allocated an operation) the limit is at
least 5% above `value` (`BENCH_CONTRACT.FLOOR_MEMORY_MARGIN`), whatever the spread: see "Memory moves
between levels" below. Time keeps its spread alone, and the gzipped bytes stay exact. A case the
floor does not keep yet is not judged, and a floor that keeps no measure cannot judge anything
(exit 2).

`floor` refuses a set holding an allocation count whose `2n` window counted more than 64 KiB fewer
than its `n` window (no code allocates fewer bytes by running more), and `gate` calls such a count
`unjudged` against a budget or a floor: take that reading again. Since 0.1.6 a reading never
writes one; a reading taken with an earlier version can hold one.

```sh
cosyte-bench floor aa-1.json aa-2.json ... aa-7.json --out bench/floor.json
cosyte-bench floor next-1.json ... next-7.json --from bench/floor.json --out bench/floor.json
```

With `--from` a measure takes the new set's value and noise only when the new set's whole limit is
below the old set's lowest reading (`value - noise`), an improvement the old noise cannot explain;
otherwise it keeps the old value and noise. Taking the lower of the two would ratchet the limit down
on a lucky set, and unchanged code would fail more often with every recording.

`gate --base-floor <the base branch's floor>` finds a floor file that is looser than its base: a
limit raised, a measure or a case dropped, or a floor for another runner class or Node line.
`gate --floor` needs exactly one of `--base-floor` and `--no-base-floor`; `--no-base-floor` says the
base branch has no floor file yet, a package's first floor, and the summary says it was not
compared.

What the floor gives up:

- **One measure of unchanged code fails now and then.** The rate depends on the shape of the noise.
  In a simulation of seven readings and the limit above, one measure failed unchanged code about
  0.01% of the time under normal noise, 0.2% under log-normal noise (sigma 0.5), 0.4% under
  exponential noise and 1.2% under very heavy log-normal noise (sigma 1), and the rate did not move
  over 30 recordings with `--from`. Across a suite each measure is a separate chance: with `k`
  measures the chance that any one fails is at most `k` times the rate of one.
- **It catches only large regressions.** The limit sits about 3.4 spreads above the measure's true
  median (in a simulation of normal noise), so a real regression of 1 spread is caught under 1% of
  the time, 2 spreads about 7 to 9%, about 3.5 spreads about half the time, and about 5.2 spreads
  about 92%. For a measure whose seven readings spread 5% of its value, a 10% regression is caught
  about 7 to 9% of the time, 17% about half the time, and 95% detection needs about 27%. The floor
  is a backstop against large regressions; small ones are the base against head comparison's job.
  For the same reason `floor --from` tightens only after an improvement of about four spreads, so a
  floor rarely moves. A memory measure held by the 5% margin below tightens only after an
  improvement of more than 5%, since the new set's limit is then at least 5% above its highest
  reading.
- **A reading is only compared within its runner class and Node line.** A new runner image is a
  new class, and the floor cannot judge it (exit 2) until it is recorded afresh.
- **A floor that measured no noise holds exactly.** The gzipped bytes the import loads are the same
  in every reading, so any growth of them is a regression.
- **Memory moves between levels, so a memory measure keeps 5% of room.** V8 compiles on a
  background thread, and when that compile finishes decides which code a process runs, so one
  process of unchanged code allocates on one of two or three levels. In 82 readings of one
  unchanged `@cosyte/dicom` source on GitHub-hosted runners (Bench floor runs 43109166865,
  43110461726, 43113425128, 43114865620 and 43116547990, 7, 7, 21, 21 and 21 readings, and Budgets
  runs 43110461576, 43113425069, 43114865841 twice and 43116548037), the higher allocation levels sat
  3.4% to 4.7% above the median reading, and one peak level 11.2% to 11.4% above the highest reading
  of a set that missed it. A set that landed on one level measures almost no spread: the peak of
  `parseDicom: CT @ single frame` read 74,616 bytes in all 21 readings of run 43113425128, and
  74,880 in 3 of the 82 readings (readings 5 and 6 of run 43109166865 and Budgets run
  43110461576), with nothing between. With the limit at three spreads alone, a floor recorded from one set
  failed 3 to 38 of the other readings of that source (out of 61 for a 21-reading set, 75 for a
  7-reading one); with the 5% margin, 0 to 5. We tried margins of 0.5% to 5%: below 5% the 4.7%
  allocation level still failed. Resampling the 82 readings (5,000 trials), a reading failed any
  memory measure of a 21-reading floor 13.2% of the time with three spreads alone and 2.8% with the
  margin, and of a 7-reading floor 44.8% and 5.5%.
- **What the margin gives up.** A memory measure whose seven or more readings spread less than 5%
  of its value, divided by three, is held to 5% above its highest reading, not less: any growth of
  more than 5% fails, however still the set was, and a smaller one passes. In the same resampling, a
  5% regression of one memory measure against a 21-reading floor was caught 41.3% of the time with three spreads alone and
  2.3% with the margin, a 10% one 55.6% and 57.5%, and a 25% one 83.4% and 85.2% (the last two
  differ by the resampling alone). A measure whose three spreads come to more than 5% keeps the
  limit it had. A level more than 5% up still fails unchanged code when no reading of the set
  landed on it: the dicom readings above show one peak level 11.2% to 11.4% up in 4 of 82.

**Recording a floor again with 0.1.6.** The margin applies to a floor file as it is: nothing needs
recording for it. A floor whose set held an allocation count that fell has a limit far too loose for
that measure. In `bench/floor.json` it is an `allocBytesPerOp` whose lowest reading, `value` less
`noise`, is far below zero: the dicom floor recorded from run 43113425128 had -14,057,504 bytes an
operation. A lowest reading a few bytes below zero is jitter on code that allocates next to
nothing, which `floor` still records, and needs nothing. To be sure, look at the set's readings: a
count fell when its `heapBytesPerOp` or `externalBytesPerOp` times its `windowOps` is below
-65,536, and `floor` from 0.1.6 refuses such a reading and names it. Take a fresh A/A set with 0.1.6 and record it with `--from`:
the new set replaces a measure whose lowest reading was below zero whenever its limit is lower, and
the floor is not reported as loosened. A floor not yet on the default branch is recorded afresh,
without `--from`. A reading taken with an earlier version that holds such a count is `unjudged`
(exit 2): take it again with 0.1.6.

## PHI and safety

This package processes no patient data. Inputs come from the suite's own code, never from a file
path the runner is given. Reports carry names, sizes, counts and timings. When the measured function
or a suite's build throws, the report names the case, the phase and the error's class, and leaves out
its message, because a parser's message may quote its input; the message stays on the error's `cause`
for whoever runs the case directly. Results name the machine by its CPU model, operating system and
CI runner image, never by host name, user or absolute path.

## API

- `defineSuite(suite)`, `defineBenchmark(benchmark)`: write a suite. `defineSuite` checks it and
  throws a `TypeError` naming the problem.
- `judge(ratios, threshold?, alpha?)`: the comparison's verdict for one case from its per-round ratios.
- `readResults(text)`: parse and check a results document; throws a `TypeError` listing every
  problem. `RESULTS_SCHEMA` is the schema, also shipped as `schema/results-v1.schema.json`.
- `budgetPeakBytes(caseReading)`: the peak a memory budget reads for a case: the median call above
  the empty-call floor for an input under 64 KiB, the highest raw total for any other.
- `readBudgets(text)`, `BUDGETS_SCHEMA`: parse and check a budgets file; throws a `TypeError`
  listing every problem.
- `readFloor(text)`, `FLOOR_SCHEMA`: parse and check a floor file, the same way.
- `BENCH_CONTRACT`: the frozen constants.
- `BenchError`: what a run that could not measure throws.

## Compatibility

Node `>=22.15.0`, for the synchronous module hooks the import measurement uses.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change to a constant in `BENCH_CONTRACT`, to the warmup or to the verdict changes what every
calibration measured, so it goes through ADR 0005's review triggers and a new calibration.

## License

MIT, copyright Cosyte LLC. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
