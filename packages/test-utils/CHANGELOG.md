# Changelog

All notable changes to `@cosyte/test-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically. Until 2026-08-04 nothing
> did it at all, so shipped content stayed under `[Unreleased]` and every release republished it.

## [Unreleased]

### Added

- **`@cosyte/test-utils/perf`: the throughput scaling gate (PERF-P2).** A new subpath export, a
  sixth runner family alongside the conformance runners. It exists so every `@cosyte/*` package can
  prove, in its own CI and without bespoke code, that it has not silently acquired an
  **algorithmic-complexity** regression. Zero dependencies, hand-rolled on `node:perf_hooks`, that
  question is closed (founder, 2026-07-25) and the reasons are in ADR 0001. New exports:
  - `scalingGate(options)`: takes a workload **generator** and a parse **function**, does
    time-budgeted warmup, sampling and sink accumulation, and asserts
    `RATIO_FLOOR ≤ min(scaled)/min(base) ≤ RATIO_CEILING` on **two** axes.
  - `assertScalingGateFires(options, injection)`: the per-package self-check.
  - `PERF_CONTRACT`: the frozen constants, readable and deliberately not overridable.
  - `perfSink`: the accumulator the measured loop sums into.
- **Both axes, and size-scaling is not optional.** `count` scales the number of inputs at fixed
  length; `size` scales each input's length at fixed count. An O(n²)-in-length tokenizer is invisible
  to the count axis **by construction**: at fixed message size a quadratic parser still scores ≈4
  there, so there is no way to ask for one axis.
- **The self-check, which is the load-bearing half.** The ceiling of 8 is derived from a constant
  (the worst false alarm across 3,200 clean ratios, 6.649) and a **non-constant** (the weakest real
  O(n²) signal, which climbs 4.69 → 8.09 → 8.84 → 10.68 as the base fixture grows 125 → 250 → 500 →
  1000 segments). Below about 250 base segments a genuine quadratic sits _inside the noise_ and the
  gate reads green while broken. `assertScalingGateFires` takes the **same options object** the real
  gate is given, so "run the self-check at the sizes your real gate uses" is structural rather than a
  thing you remember to do, and it **fails the build** when the fixture is too small.
- **The fail-safe: typed, loud skips.** `phase-too-short` (base `min` under `MIN_PHASE_MS`) and
  `warmup-unstable` (never reached steady state) write the full diagnostic to stderr and return
  `status: "skipped"`. A measurement never reports a confident wrong answer, and **a skip is not a
  pass**. Both bounds are hard failures: the ceiling catches the complexity regression, the floor
  catches the two phases having received the same workload. The floor deliberately does **not** claim
  to catch dead-code elimination, that stays at ≈4 on the count axis and is prevented structurally
  by the sink instead.
- **PHI by construction.** The runner takes a generator function, never a file path, so inputs are
  synthetic and produced in-process. Every diagnostic (failure, skip and report alike) carries
  sizes, counts, ratios and sample vectors, and never echoes input content.
- `test:perf`, a second **non-instrumented** test invocation (`vitest.perf.config.ts`), with
  `test/perf/timed/**` excluded from the default `test` run. ADR 0001 §6: `@vitest/coverage-v8` drives
  V8's `kBlockCount` precise coverage, compiling an effectful counter into the measured function body
  in every tier at a cost that scales with executed-block count, which differs between the two
  phases a ratio compares, so it does not cleanly cancel. This package ships the split as the worked
  example the twelve adopting packages copy. It holds the only tests in the kit that read a real
  clock, and it is **not wired into CI**: across three 200-run false-alarm sweeps PERF-P2 measured
  this runner class firing on a linear workload 4 times in 600 runs and failing to reach steady state
  in another ~1%, and a known-flaky required check is the failure mode this whole project exists to
  prevent. Everything else about the gate: both bounds, both skip reasons, the sink liveness check,
  the axis naming, corpus construction and the PHI rule: is proved on an **injected clock** in the
  default `pnpm test`, exactly and in milliseconds. A wall-clock spin was tried first and abandoned:
  under a CPU-quota cgroup the kernel stops the whole group for the rest of each scheduling period,
  so the same 4-input corpus timed 8.01 ms on one pass and 32.66 ms on the next.

### Notes

- Every constant is fixed by
  [ADR 0001](../../documentation/decisions/0001-perf-measurement-contract.md) and each is tagged
  _measured_ or _judgement_. They are not tuning knobs; the ADR's review triggers are the process for
  moving one.
- **What this does not catch, stated because it will be quoted:** constant-factor regressions (a 10%
  slowdown passes, and always will: from a single cloud instance only 17–22% of configurations
  reliably detect one, so it is a property of the technique); complexity regressions whose fixture is
  too small; and anything that only manifests under real I/O, network or concurrency.

### Changed

- The sections below were relabelled: content that had already shipped was still sitting under
  `[Unreleased]`, so each release republished it. Every section now carries the version it shipped
  in. No runner or API change; the `CHANGELOG.md` inside the published tarball is the only thing that
  differs.

## [0.0.2] - 2026-07-31

### Added

- `assertNoDiagnosticPhiLeak`, a runner proving that consumer-controlled input does not echo into a
  diagnostic surface. For every slot the caller declares it sweeps each diagnostic `message`, the
  whole diagnostic rendered as JSON, as `util.inspect`, and by a walk of the object graph,
  `err.message`, `err.stack`, the thrown value itself, and every structural identifier the caller
  enumerates on the model. The walk is what reaches a nested `toString`, raw bytes attached as
  context, and entries past `inspect`'s truncation ceilings, none of which either summary rendering
  shows. Matching is case-insensitive, so a value upper-cased on conformance grounds still fails.
  What it proves, stated narrowly: **no verbatim echo of four or more bytes of a planted value, on
  a slot that provably reached the diagnostic it names.** It does not prove the absence of a
  re-encoded echo, an echo shorter than four bytes, or a leak through an undeclared slot.
- Each slot must name the diagnostic code it expects, and the runner asserts that code appeared in
  lenient mode. Counting diagnostics is not enough: an unrelated warning can otherwise stand in for
  the one the slot exists to trigger, leaving the leaking branch unentered and the suite green. The
  assertion is lenient-only because a strict mode throws on the first deviation, so only one slot
  could ever satisfy its own code there. Strict mode keeps its sweep.
- `getDiagnostics`, `getModelIdentifiers` and `parseStrict` are required rather than defaulted.
  `() => []` and `null` are legitimate answers; silence is not, and a silent default reading only
  `.warnings` would report green on a model it had half-read.
- Opt-in `checkLengthInvariance` catches a re-encoded echo by comparing diagnostic sizes across a
  short and a long planted value. Off by default because a diagnostic carrying an input-derived
  number, such as a position column gaining digits or a byte count, grows the same way and is
  correct.
- Exercised by constructed positive controls, each isolating the one surface it names, and by
  controls asserting the runner stays green where a correct parser would otherwise be failed.

### Changed

- Documentation, source comments, the npm package description, and seven assertion-failure
  message strings no longer use em dashes, in line with the cosyte brand voice. No API, type, or
  behaviour change: the message strings are the diagnostics a failing conformance run prints.

## [0.0.1] - 2026-06-26

### Added

- First real release of the conformance kit: the first built (publishable) package in `config`.
  Framework-agnostic, `fast-check`-powered (peer dep `^3`), throws on failure so any runner catches
  it. Public API:
  - `roundTripProperty`: `parse(serialize(x))` equals `x` (deep-equal default or custom `equals`)
    plus serialize-idempotency.
  - `lenientNeverThrowsProperty`: `parse` throws only on sanctioned fatals; every recovered warning
    carries a registered code and (optionally) positional context.
  - `immutabilityProperty`: a mutation attempt throws or returns a new instance; the original is
    never edited in place.
  - `sortedCodeSet`: sorted warning/fatal code values for a snapshot stability tripwire.
  - `assertNoSecretLeak`: the PHI-leak matrix across `JSON.stringify`, `String()`, template-literal
    interpolation, and `util.inspect`, naming the leaking channel on failure.
- Dual ESM + CJS build via `@cosyte/tsup-config` with per-condition types (`.d.ts` / `.d.cts`),
  `attw` as a publish gate.
