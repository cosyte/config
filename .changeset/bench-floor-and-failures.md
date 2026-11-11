---
"@cosyte/bench": patch
---

A reading measures the empty-call floor once per run: the peak of a call that does nothing, read in
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
