---
---

PERF-P1 (repo-level; no published package changes): record the performance measurement contract as
this repo's first ADR, `documentation/decisions/0001-perf-measurement-contract.md`.

It freezes, with PERF-P0's measured data rather than judgement, the estimator (`min` for the ratio
assertion, median + full distribution for the benchmark), time-budgeted warmup, the ratio ceiling 8 /
floor 1.5, the `MIN_PHASE_MS` skip precondition, the exclusion of `test/perf/**` from the coverage
run, the `src`-vs-`dist` import split, and the GC rules P3 is bound by. Every constant is tagged
_measured_ or _judgement_, so no constant in `@cosyte/test-utils/perf` will lack a recorded
justification when P2/P3 build it.

This is an empty changeset: the change is documentation only: an ADR, the root `CHANGELOG.md` and a
README pointer. `@cosyte/test-utils` gains no code and no public surface here (the `/perf` subpath
lands in P2), so nothing is versioned.
