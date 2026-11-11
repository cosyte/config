# Changelog

## 0.1.3

### Patch Changes

- 027dbf5: A reading measures the empty-call floor once per run: the peak of a call that does nothing, read in
  its own process through the same probe as the cases, which is what the probe itself costs. It is in
  the reading as `memoryFloor`, the Markdown prints it, and every case's peak also gives each figure
  above the floor's median, never below zero: `peakTotalAboveFloorBytes`,
  `medianPeakTotalAboveFloorBytes`, and the same for the heap and external memory.

  `budgetPeakBytes(caseReading)` is the peak a memory budget reads. For a case whose inputs average
  under `BENCH_CONTRACT.FLOOR_INPUT_BYTES` (64 KiB) it is the median call's total above the floor's
  median; for any other, or for a suite that gave no byte count, the highest raw `peakTotalBytes`, as
  before. On a GitHub-hosted runner the floor's median call is about 3.3 KiB and its highest about
  28 KiB, and that highest lands in a small case's highest peak, so a small input reads its median
  call. A budget script that read `peakTotalBytes` should call `budgetPeakBytes` instead, and a suite
  that added its own empty "floor" case can drop it.

  One case that cannot be measured no longer stops the run. `cosyte-bench run` writes every other case,
  lists what failed in the reading's `failures` (the phase, `timing`, `memory` or `floor`, the case,
  and the first line of the error) and in the Markdown, prints the whole error to stderr, and exits 2.
  A case whose timing failed is left out of `cases`; one whose memory failed keeps its timing. A script
  that ran each case alone to get past one failure can run them together and read `failures`.

  Every new field is added within results version 1, and documents written before still validate.

## 0.1.2

### Patch Changes

- c0c095a: Large cases are measured instead of skipped. A case whose single call takes longer than a warmup
  batch (50 ms) and has not settled by the scaling gate's rule after 500 ms moves to the large-case
  plan: one call at a time until the median of the last 5 calls is within 5% of the median of the 5
  before them, at most 30 s. Each timing process records the plan it ended on (`plan` in a reading's
  `throughput.processes`, `basePlans` and `headPlans` in a comparison), and a reading marks such a
  case. A case that settles by the standard rule warms up exactly as before.

  Allocations per operation are counted on a case whose every window collects: the largest pair of
  windows is counted with what its collections reclaimed (`method: "gc-accounted"`, with the number of
  `collections`), where before the case was skipped as `allocation-window-gc`.

  The peak reports external memory (Buffers, ArrayBuffers) beside the V8 heap, and the two together:
  `peakExternalBytes`, `peakTotalBytes` and their medians. A memory budget reads `peakTotalBytes`.
  Memory processes run with `--no-concurrent-array-buffer-sweeping`, so a collection frees dead
  ArrayBuffers before it ends and the external memory it reports is exact.

  The long run also runs on a benchmark's largest size whose 30 rounds fit in 60 s, besides its
  long-run size. A reading now times every size of a benchmark before measuring its memory.

  Every new field is added within results version 1 and none is renamed; documents written before
  still validate.

## 0.1.1

### Patch Changes

- 27ccbb7: First release of `@cosyte/bench`, the benchmark runner of the performance standard (ADR 0005). `cosyte-bench run` takes a reading of one build: throughput at each input size a suite declares, latency p50, p95 and p99, allocations per operation, peak heap per call, whether the heap stays flat over a long run, cold import time and the bytes an import loads. `cosyte-bench compare` runs a base build and a head build interleaved on one machine, 12 rounds of fresh processes, and judges each case with the sign test's interval on the median ratio (a regression is a whole interval above +3%). `cosyte-bench calibrate` runs many comparisons of known outcome, A/A or with a planted slowdown, and reports the false alarm or detection rate with its exact upper bound, counting only cases and comparisons that measured, the rate of comparisons that skipped a case, and the change each case was observed at. Every result is JSON in a versioned shape (`schemaVersion: 1`, `schema/results-v1.schema.json`) carrying the machine, the Node version, the runner, every sample and the constants in force; `cosyte-bench check` and `readResults` validate it. A measured function that throws is reported by case, phase and error class, never by its message, because a message may quote an input.
