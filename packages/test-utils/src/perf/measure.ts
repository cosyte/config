/**
 * The measurement primitives: the sink, the estimators, the timed phase, and the time-budgeted
 * warmup. Internal to `@cosyte/test-utils/perf` — the public surface is
 * {@link ../scaling-gate.js | scalingGate} and {@link ../self-check.js | assertScalingGateFires}.
 *
 * Everything here is hand-rolled on `node:perf_hooks`, with zero dependencies. That question is
 * closed (founder, 2026-07-25) and the reasons are recorded in ADR 0001: no published harness
 * detects V8 steady state (tinybench's bundle has zero hits for
 * `steady|converg|tier|deopt|turbofan|maglev|jit`), `bench-node` measures a deliberately
 * unoptimized tier, and `vitest bench` is experimental and SemVer-exempt.
 *
 * @internal
 * @packageDocumentation
 */

import { performance } from "node:perf_hooks";

import { PERF_CONTRACT } from "./contract.js";

/**
 * The accumulator every measured parse result is summed into, and read back by the runner.
 *
 * It is not decoration and not optional. V8's optimizing backend in Node 22 is Turboshaft, whose
 * dead-code elimination is **use-based** (`src/compiler/turboshaft/dead-code-elimination-reducer.h`
 * — not the type-based `dead-code-elimination.h` pass that gets cited by mistake). A measured loop
 * whose result is never used is a loop the compiler is entitled to delete, and a deleted loop
 * produces a confident, fast, meaningless number. Summing into a module-level export that the
 * runner reads back afterwards is the structural defence.
 *
 * @example
 * ```ts
 * import { perfSink } from "@cosyte/test-utils/perf";
 *
 * typeof perfSink.value; // => "number"
 * ```
 */
export const perfSink: { value: number } = { value: 0 };

/**
 * Smallest sample in a vector. The estimator ADR 0001 fixes for the **ratio assertion** — and only
 * for that. On the ratio of two same-process phases the noise is one-sided, so `min` is the only
 * estimator that does not import a one-sided stall on one side of the ratio into the ratio itself;
 * measured, it is the only one that leaves a usable window at all (6.65…8.84 rather than 8.58…8.84).
 *
 * This does not rehabilitate min-of-N as a reporting statistic: the full vector is retained and
 * emitted everywhere, and the *benchmark* headline is a median.
 *
 * @internal
 */
export function minOf(xs: readonly number[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (const x of xs) if (x < m) m = x;
  return m;
}

/**
 * Median of a vector. The estimator ADR 0001 fixes for the **reported** headline: median vs
 * trimmed-mean divergence over P0's 3,200 rows is p50 1.5%, p95 7.1%, max 25.6%, and a one-per-tail
 * trim does not remove a one-sided tail.
 *
 * @internal
 */
export function medianOf(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

/**
 * Round to 4 decimal places, so emitted diagnostics stay readable.
 *
 * @internal
 * @example
 * ```ts
 * round4(4.123456); // => 4.1235
 * ```
 */
export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The default `weigh`: one per non-nullish result. Shared by the gate and the self-check so the two
 * cannot drift — a self-check that summed a different quantity than the gate would be measuring a
 * different loop.
 *
 * @internal
 */
export function defaultWeigh(result: unknown): number {
  return result === undefined || result === null ? 0 : 1;
}

/**
 * Where loud diagnostics go by default. `stderr` rather than `stdout` so a skip survives a test
 * reporter that swallows stdout — a skip that nobody sees is the silent pass the fail-safe rule
 * exists to prevent.
 *
 * @internal
 */
export function toStderr(line: string): void {
  process.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
}

/**
 * One timed phase: `reps` full passes over `corpus`, returning the **full** sample vector in
 * milliseconds. Never pre-reduced — W2's one surviving remedy is that the whole vector is available
 * to whoever reads the diagnostic.
 *
 * The corpus is built by the caller *outside* every timed region. `parse` and `weigh` are local
 * bindings here, so the loop calls them directly rather than through a Vite-SSR namespace getter —
 * the shape P0's harness had, and the reason the kit takes a function rather than a module.
 *
 * @internal
 */
export function timePhase<TInput, TResult>(
  corpus: readonly TInput[],
  parse: (input: TInput) => TResult,
  weigh: (result: TResult) => number,
): number[] {
  const samples: number[] = [];
  for (let r = 0; r < PERF_CONTRACT.REPS; r++) {
    let local = 0;
    const t0 = performance.now();
    for (const input of corpus) local += weigh(parse(input));
    samples.push(performance.now() - t0);
    perfSink.value += local;
  }
  return samples;
}

/** The outcome of one axis's warmup. @internal */
export interface WarmupReport {
  /** Whether the stability rule was satisfied before `WARMUP_MAX_MS`. */
  readonly stable: boolean;
  /** Total wall time spent warming, in milliseconds. */
  readonly elapsedMs: number;
  /** Total passes over the base corpus. */
  readonly passes: number;
  /**
   * Per-batch aggregate, in **milliseconds per pass**. A batch runs whole passes until at least
   * `WARMUP_BATCH_MS` has been timed and reports one aggregate; passes-per-batch can differ between
   * batches as the runtime tiers up, so the comparable aggregate is normalized per pass. Comparing
   * raw batch totals would read a 6-pass batch as 20% slower than a 5-pass one.
   */
  readonly batches: readonly number[];
}

/**
 * Whether the last `WARMUP_STABLE_BATCHES` aggregates all lie within `WARMUP_STABLE_TOL` of their
 * median.
 *
 * @internal
 */
export function batchesAreStable(batches: readonly number[]): boolean {
  const n = PERF_CONTRACT.WARMUP_STABLE_BATCHES;
  if (batches.length < n) return false;
  const window = batches.slice(-n);
  const mid = medianOf(window);
  if (mid <= 0) return false;
  return window.every((b) => Math.abs(b - mid) / mid <= PERF_CONTRACT.WARMUP_STABLE_TOL);
}

/**
 * Time-budgeted warmup with a stability rule — never a fixed invocation count.
 *
 * W1 is structural, not a tuning observation: V8's `InterruptBudgetFor()` returns
 * `invocation_count_for_maglev * bytecode_length`, and `DEFINE_WEAK_IMPLICATION(maglev,
 * maglev_overwrite_budget)` raises the effective TurboFan threshold to 16,000 *interrupt units
 * scaled by bytecode length*. No invocation count can be correct across two different parsers, let
 * alone thirteen. P0 confirmed the consequence: after `hl7`'s exact ~2,100-invocation warmup the
 * first measured rep is up to **1.23× slower than the fifth**, and that first rep is the only
 * measurement a real CI gate ever takes.
 *
 * Warms on the **base** corpus only, once per axis — both phases exercise the same code path.
 *
 * **Two properties of the batching, recorded because they are easy to misread:**
 *
 * 1. A batch runs *whole passes* until at least `WARMUP_BATCH_MS` has been timed, so a corpus whose
 *    single pass already exceeds 50 ms degenerates to one-pass batches. The stability rule then
 *    evaluates at exactly the per-pass granularity ADR 0001 §2 measures as satisfiable in as few as
 *    **1.0%** of already-warm phases — so such a package is likely to hit `warmup-unstable`. That
 *    fails safe (a loud skip, never a silent pass) and the ADR's stated remedy is to raise
 *    `WARMUP_BATCH_MS` under its review triggers, not to special-case it here.
 * 2. `WarmupReport.batches` is **milliseconds per pass**, not the raw batch total. ADR 0001 §2 says
 *    "batch timings"; normalising is the only reading that is a statistic at all, since batches can
 *    contain different pass counts as the runtime tiers up, and comparing a 6-pass total against a
 *    5-pass total would read a 20% regression that is not there. Note this is **not** uniformly the
 *    laxer reading — with pass cost drifting 8.0 → 9.0 ms, raw totals of 56 / 54 / 56 look stable at
 *    3.6% while the normalised 8 / 9 / 8 is 12.5% and does not. It is the *correct* reading, not the
 *    permissive one, and on that example it is the stricter of the two.
 *
 * @internal
 */
export function warmUp<TInput, TResult>(
  corpus: readonly TInput[],
  parse: (input: TInput) => TResult,
  weigh: (result: TResult) => number,
): WarmupReport {
  const start = performance.now();
  const batches: number[] = [];
  let passes = 0;

  for (;;) {
    const b0 = performance.now();
    let batchPasses = 0;
    let batchMs: number;
    do {
      let local = 0;
      for (const input of corpus) local += weigh(parse(input));
      perfSink.value += local;
      batchPasses++;
      batchMs = performance.now() - b0;
    } while (batchMs < PERF_CONTRACT.WARMUP_BATCH_MS);

    passes += batchPasses;
    batches.push(batchMs / batchPasses);

    const elapsedMs = performance.now() - start;
    if (elapsedMs >= PERF_CONTRACT.WARMUP_MIN_MS && batchesAreStable(batches)) {
      return { stable: true, elapsedMs, passes, batches };
    }
    if (elapsedMs >= PERF_CONTRACT.WARMUP_MAX_MS) {
      return { stable: false, elapsedMs, passes, batches };
    }
  }
}
