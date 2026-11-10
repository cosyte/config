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

Benchmarks for the @cosyte/\* packages: throughput, latency percentiles, memory, cold import time and loaded bytes, as versioned JSON, and a base against head comparison interleaved on one machine.

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
```

Exit codes: 0 clean, 1 a finding (a regression, or a results file that does not match the schema),
2 could not measure (a skip, a process that died, an input it could not read). A skip is not a pass.

## Entry points

| entry point                                   | what it is                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cosyte-bench`                                | the bin: `run`, `compare`, `calibrate` and `check`                                                                                                    |
| `@cosyte/bench`                               | writing a suite (`defineSuite`, `defineBenchmark`), judging ratios (`judge`), reading results (`readResults`, `RESULTS_SCHEMA`), and `BENCH_CONTRACT` |
| `@cosyte/bench/schema/results-v1.schema.json` | the results schema as JSON Schema, for a tool in another language                                                                                     |
| `@cosyte/bench/package.json`                  | the manifest                                                                                                                                          |

The module entry point has no side effects: importing it starts no process. The schema is plain JSON:

```ts runnable
import schema from "@cosyte/bench/schema/results-v1.schema.json" with { type: "json" };

schema.properties.schemaVersion.const; // => 1
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

| Measure                                | How                                                                                                                                                                                                                                                                                                                     | What it cannot see                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Throughput, small to very large inputs | Per size, fresh processes; a warmup by the scaling gate's rule, or by the large-case plan below when every warmup batch is one long pass; 5 samples of whole passes of at least 50 ms; the median of the processes' medians                                                                                             | Anything the suite's sizes do not cover; numbers from another machine                                                               |
| Latency p50, p95, p99                  | One call at a time on a nanosecond clock, up to 2 s or 5,000 calls; a percentile is reported only with at least 10 calls above it                                                                                                                                                                                       | Calls shorter than 20 clock reads (skipped, typed); the tail of a size with few calls                                               |
| Allocations per operation              | Heap growth over windows of `n` and `2n` operations in which no collection ran, in a process with a 64 MiB young generation; the difference cancels the cost of reading the heap. When every window collects, the largest pair is counted with what its collections reclaimed (`method: "gc-accounted"`)                | Native memory a library allocates outside V8's accounting                                                                           |
| Peak memory                            | Per call, the higher of what was in use just before any collection during the call and at its end, above what was in use before it: the V8 heap (`peakHeapBytes`), external memory such as Buffers and ArrayBuffers (`peakExternalBytes`), and the two together (`peakTotalBytes`), which is what a memory budget reads | Native memory a library allocates outside V8's accounting                                                                           |
| Heap flat over a long run              | 30 rounds, the heap settled after each; a Theil-Sen slope over the last 24; growing when the fitted growth reaches 64 KiB. On the long-run size and on the largest size whose 30 rounds fit in 60 s                                                                                                                     | A leak too small to reach 64 KiB over the run (each result says the smallest it could see, `detectableBytesPerOp`); external memory |
| Cold import and loaded bytes           | 20 fresh processes import the target, 20 import an empty module, interleaved; one more records every file the import loads, with its gzip size                                                                                                                                                                          | What a bundler keeps after tree shaking                                                                                             |

Memory measurements need `gc()`; the runner starts those processes with `--expose-gc` itself, and
with `--no-concurrent-array-buffer-sweeping`, so a collection frees the ArrayBuffers it found dead
before it ends and the external memory it reports before and after is exact.

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
