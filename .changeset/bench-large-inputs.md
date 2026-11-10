---
"@cosyte/bench": patch
---

Large cases are measured instead of skipped. A case whose single call takes longer than a warmup
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
