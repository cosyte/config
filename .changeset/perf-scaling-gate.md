---
"@cosyte/test-utils": patch
---

PERF-P2: add `@cosyte/test-utils/perf` — the throughput scaling gate.

A new subpath export, and a sixth runner family alongside the conformance runners on the root entry.
It exists so every `@cosyte/*` package can prove, in its own CI and **without bespoke code**, that it
has not silently acquired an algorithmic-complexity regression. Zero dependencies, hand-rolled on
`node:perf_hooks`.

- **`scalingGate(options)`** — takes a workload **generator** and a parse **function** (never a file
  path, which is what keeps PHI out of the benchmark path by construction), does time-budgeted warmup
  with a stability rule, sampling, and sink accumulation, then asserts
  `RATIO_FLOOR ≤ min(scaled)/min(base) ≤ RATIO_CEILING` on **two** axes.
- **Both axes, and size-scaling is not optional.** `count` scales the number of inputs at fixed
  length; `size` scales each input's length at fixed count. An O(n²)-in-length tokenizer is invisible
  to the count axis by construction — at fixed message size a quadratic parser still scores ≈4 there
  — so there is no way to ask for one axis.
- **`assertScalingGateFires(options, injection)`** — the per-package self-check, and the load-bearing
  half. The ceiling of 8 sits between a constant (the worst false alarm across 3,200 clean ratios,
  6.649) and a **non-constant**: the weakest real O(n²) signal climbs 4.69 → 8.09 → 8.84 → 10.68 as
  the base fixture grows 125 → 250 → 500 → 1000 segments. At the smallest, a genuine quadratic is
  _inside the noise_ and the gate reads green while broken. The self-check takes the **same options
  object** the real gate is given — so "run it at the sizes your real gate uses" is structural rather
  than remembered — and it fails the build when the fixture is too small. It also checks the _clean_
  parse can produce a ratio at those sizes, not just the regressed one, since the regressed parse is
  the slower of the two and would otherwise mask a permanently-skipping gate.
- **Fail-safe.** Typed, loud skips (`phase-too-short`, `warmup-unstable`) on stderr with
  `status: "skipped"` — a measurement never reports a confident wrong answer, and **a skip is not a
  pass**. Both bounds are hard failures. The floor's claim is deliberately narrow: it catches _the two
  phases received the same workload_, not dead-code elimination, which stays at ≈4 on the count axis
  and is prevented structurally by the sink.
- **`PERF_CONTRACT`** — the frozen constants, readable, printable, and deliberately not overridable.

Every constant is fixed by `documentation/decisions/0001-perf-measurement-contract.md`, each tagged
_measured_ or _judgement_. **What it does not catch, stated because it will be quoted:**
constant-factor regressions (a 10% slowdown passes and always will — from a single cloud instance
only 17–22% of configurations reliably detect one), complexity regressions whose fixture is too
small, and anything that only manifests under real I/O, network or concurrency.

No change to the root entry point: a parser importing the conformance runners does not pull
`node:perf_hooks` in with them.

One limitation this slice **measured** rather than inherited, and which every adopting package needs:
the ceiling is calibrated to a runner class. Across three 200-run sweeps on a CPU-quota-throttled
container the gate fired on a linear workload 4 times in 600 runs, at ratios of 8.94–11.01 — above the
weakest real O(n²) signal at `hl7`'s own fixture size (8.84). A same-process ratio cancels JIT state,
but the two phases are separated in _time_ and a cgroup's throttling state changes between them. So
`assertScalingGateFires` proves your **fixture** is big enough and says nothing about whether your
**runner** is quiet enough; establish both before adopting.
