/**
 * `@cosyte/test-utils/perf` — the shared performance measurement kit for the `@cosyte/*` packages.
 *
 * A sixth runner family alongside the conformance runners on the root entry point. It exists so
 * that every package can prove, in its own CI and **without bespoke code**, that it has not
 * silently acquired an algorithmic-complexity regression.
 *
 * ```sh
 * pnpm add -D @cosyte/test-utils
 * ```
 *
 * ## The two things you call
 *
 * | Export                     | What it does                                                                          |
 * | -------------------------- | ------------------------------------------------------------------------------------- |
 * | {@link scalingGate}        | the gate: asserts the count **and** size scaling ratios stay inside the calibrated band |
 * | {@link assertScalingGateFires} | the self-check: proves this package's fixtures are big enough for the gate to fail  |
 *
 * You need **both**. `scalingGate` on its own is a gate whose sensitivity is unknown;
 * `assertScalingGateFires` is what turns the global ceiling into a guarantee for *your* fixtures,
 * and it fails the build when they are too small.
 *
 * ## What it will not tell you — read this before quoting it
 *
 * 1. **It does not detect constant-factor regressions.** A 10% slowdown passes, and always will.
 *    From a single cloud instance only 17–22% of configurations reliably detect a ≤10% slowdown, so
 *    this is a property of same-machine paired measurement, not a gap to be closed by tuning. Never
 *    claim 10% sensitivity for a package that adopts this.
 * 2. **"Catches complexity-shaped regressions" is conditional, not absolute.** It holds *only when
 *    the fixture is large enough*, and how large is workload-specific. The measured signal from a
 *    genuine O(n²)-in-length parser climbed 4.69 → 8.09 → 8.84 → 10.68 as the base fixture grew
 *    125 → 250 → 500 → 1000 repeated segments, against a false-alarm tail that stays at 6.649. At the
 *    smallest of those a real regression is inside the noise. **Each adopting package must prove its
 *    own fixtures clear that bar**, which is exactly what `assertScalingGateFires` does — and why a
 *    package that skips it has a gate with no established sensitivity.
 * 3. **The ceiling is calibrated to a runner class, and yours may not be in it.** Measured by
 *    PERF-P2's own false-alarm sweeps: on a CPU-quota-throttled container the gate fired on a
 *    workload that is linear by construction **4 times in 600 clean runs**, at ratios of 8.94–11.01
 *    — which sit **above** the weakest real O(n²) signal at `hl7`'s own fixture size (8.84). On that
 *    box no ceiling separates noise from signal at all. The
 *    mechanism is not modelled by the contract: a same-process ratio cancels JIT state, but the two
 *    phases are separated in *time*, and a cgroup's throttling state changes between them. So
 *    `assertScalingGateFires` proves your *fixture* is big enough and says nothing about whether
 *    your *runner* is quiet enough. Establish both before adopting — see
 *    `experiments/perf-p2-false-alarm/` in the `config` repo, which re-runs on any machine.
 * 4. Absolute timings from this kit are not a portable guarantee, cross-package comparison is
 *    meaningless, and nothing here sees a regression that only appears under real I/O, network or
 *    concurrency.
 *
 * ## Fail-safe
 *
 * A performance measurement must never report a confident wrong answer — the one Parser-class rule
 * this Infra-class kit borrows. When the preconditions for a ratio do not hold, the gate **skips
 * loudly** with a typed {@link PerfSkipReason} on stderr and returns `status: "skipped"`. A skip is
 * not a pass. Both bounds are asserted: the ceiling catches the complexity regression, the floor
 * catches the two phases having received the same workload.
 *
 * ## PHI
 *
 * The runner takes a **generator function, never a file path**, so inputs are synthetic and produced
 * in-process by construction rather than by discipline. Every diagnostic — failure, skip and report
 * alike — carries sizes, counts, ratios and sample vectors, and never echoes input content.
 *
 * ## Where the numbers come from
 *
 * Every constant in {@link PERF_CONTRACT} is fixed by ADR 0001 in the `config` repo
 * (`documentation/decisions/0001-perf-measurement-contract.md`), each tagged *measured* or
 * *judgement* with its basis, from the PERF-P0 calibration: 3,200 4N-vs-N ratios on a linear
 * workload, 320 on a deliberately O(n²) one, and 200 GC trials, across two runner classes on
 * Node 22.23.1 / V8 12.4. The kit is zero-dependency and hand-rolled on `node:perf_hooks`.
 *
 * @example
 * ```ts
 * import { scalingGate, assertScalingGateFires, PERF_CONTRACT } from "@cosyte/test-utils/perf";
 *
 * PERF_CONTRACT.RATIO_CEILING; // => 8
 * typeof scalingGate; // => "function"
 * typeof assertScalingGateFires; // => "function"
 * ```
 *
 * @packageDocumentation
 */

export { PERF_CONTRACT, type PerfContractShape } from "./contract.js";
export { perfSink } from "./measure.js";
export {
  scalingGate,
  type AxisReport,
  type CountAxisFixture,
  type PerfAxis,
  type PerfSkipReason,
  type PhaseReport,
  type ScalingGateOptions,
  type ScalingGateReport,
  type SizeAxisFixture,
} from "./scaling-gate.js";
export {
  assertScalingGateFires,
  type ScalingRegressionInjection,
  type ScalingSelfCheckReport,
} from "./self-check.js";
