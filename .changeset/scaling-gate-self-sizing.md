---
"@cosyte/test-utils": patch
---

`@cosyte/test-utils/perf`: the scaling gate can size its own phases. Pass `selfSize: true` (or
`selfSize: { targetMs }`) in the options given to `scalingGate` and `assertScalingGateFires`, and
after the warmup the gate counts how many passes over the base corpus one timed rep needs to take at
least 20 ms (the new export `SELF_SIZE_TARGET_MS`, or `targetMs`, which may not be under
`MIN_PHASE_MS`), then times both phases at that many passes per rep, so the ratio is unchanged. A
fixture whose base phase reads under the 4 ms floor on a fast runner is then measured instead of
skipped, and no longer has to be grown by hand after every parser speedup. The floor, the ceiling,
the self-check and every skip stay as they are: a phase still under the floor at 65,536 passes a rep
skips `phase-too-short`, and the self-check still fails a fixture too small for a quadratic to clear
the ceiling.

The count chosen is reported: `passes` on each `PhaseReport`, a `self-sized:` line in the
diagnostic, and `passes` and `cleanPasses` on the self-check's report. The reports gain these fields
even when `selfSize` is unset: `passes: 1` on each phase, `passes: 1` and `cleanPasses: { count: 1,
size: 1 }` on the self-check's report. Off by default otherwise: a gate that does not set `selfSize`
runs one pass a rep and prints the same diagnostic as before. Callers change nothing; to adopt it,
add `selfSize: true` to the gate's options.

The gate measures warm, steady-state cost only (the fastest of several reps over the same inputs),
so a first-call or cold-cache cost is not seen, with or without self-sizing.
