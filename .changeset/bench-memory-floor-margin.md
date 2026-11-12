---
"@cosyte/bench": patch
---

A floor no longer fails unchanged code on a memory level it did not see, and an allocation count
that fell is measured again instead of written below zero.

- **A memory measure's floor limit is at least 5% above its highest reading.** The peak and bytes
  allocated an operation are held to the highest A/A reading plus three spreads, or plus 5% of it
  (the new `BENCH_CONTRACT.FLOOR_MEMORY_MARGIN`), whichever is more. V8 compiles on a background
  thread, so one process of unchanged code allocates on one of two or three levels, and a set of
  readings that all landed on one level measured almost no spread. In 82 readings of one unchanged
  `@cosyte/dicom` source on GitHub-hosted runners (Bench floor runs 43109166865, 43110461726,
  43113425128, 43114865620 and 43116547990; Budgets runs 43110461576, 43113425069, 43114865841 twice
  and 43116548037), a floor recorded from one set failed 3 to 38 of the other readings of that
  source with three spreads alone, and 0 to 5 with the margin. Milliseconds an operation and the
  cold import keep their spread alone, and the gzipped bytes stay exact.
- **What the margin costs.** A memory measure whose three spreads come to under 5% no longer fails
  growth of 5% or less; anything more still fails. Resampling the same 82 readings (5,000 trials),
  a 5% regression of one memory measure against a 21-reading floor was caught 41.3% of the time
  before and 2.3% after; a 10% one 55.6% and 57.5%, and a 25% one 83.4% and 85.2%. With
  `floor --from`, a memory measure held by the margin now tightens only after an improvement of
  more than 5%.
- **An allocation count that fell is no count.** A pair of windows whose `2n` window counted more
  than 64 KiB fewer than its `n` window is measured again at half the window, and the count is
  skipped (`allocation-fell`) when every pair does. `cosyte-bench floor` refuses a set holding such
  a count from an earlier version, and `cosyte-bench gate` calls one `unjudged` (exit 2) against a
  budget or a floor. One reading recorded -14,057,504 bytes an operation this way.
- **`floor --from` replaces a measure whose lowest reading was below zero** whenever the new set's
  limit is lower, so a floor recorded from such a count can be recorded again without being
  reported as loosened.

What a repo must do: nothing for the margin, which applies to a floor file as it is. A floor whose
`allocBytesPerOp` has a lowest reading (`value` less `noise`) far below zero, such as the
-14,057,504 above, was recorded from a count that fell; a few bytes below zero is jitter and needs
nothing. Take a fresh A/A set with this version and record it with `--from` (or afresh, without
`--from`, when the default branch has no floor yet). A reading from an earlier version that holds
such a count is taken again. The exported `MemorySkipReason` type gains `allocation-fell`: code
that switches on it handles one more reason. Nothing else exported changes.
