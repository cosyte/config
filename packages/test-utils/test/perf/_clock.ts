/**
 * A controllable clock for the gate's wiring tests.
 *
 * ## Why the wiring tests do not use the real one
 *
 * The assertions in `gate.test.ts` are about the *runner*: does a ratio above the ceiling throw,
 * does one below the floor throw, does an unmeasurable phase skip loudly instead of doing either.
 * None of that is a question about a workload, and answering it with real timings makes every
 * assertion a measurement of whatever machine the suite happens to run on.
 *
 * A wall-clock spin looks like it solves that — occupy 8 ms and you have measured 8 ms regardless of
 * CPU speed — and it does not. Under a CPU-quota cgroup the kernel stops the whole group for the
 * remainder of each scheduling period once the quota is spent, so a phase that occupies 32 ms of CPU
 * can measure 100 ms of wall time, bimodally, switching on a timescale of hundreds of milliseconds.
 * Measured in this repo's own container (`cpu.max` = 2 CPUs against `os.cpus().length` = 56): the
 * same 4-input corpus timed 8.01 ms on one pass and 32.66 ms on the next. That is precisely the
 * condition the gate's fail-safe exists to refuse to answer under — which makes it a terrible
 * substrate for testing that the gate answers correctly.
 *
 * So the clock is injected instead. `parse` advances it by an exact amount per input, and every
 * duration the runner computes is then arithmetic rather than measurement: ratios are exact, the
 * warmup rule terminates in zero real time, and the tests are immune to whatever else is running on
 * the box. The one thing that genuinely must be measured — a real parser at a real fixture size —
 * is measured, on the real clock, in `timed/self-check.test.ts`.
 *
 * ## What this deliberately does not test
 *
 * That `performance.now()` is a sane clock. ADR 0001 fixes it as the contract's clock on measured
 * grounds (phases are ≥ 4 ms, so a 111 ns timer read is 0.003% of the smallest phase) and there is
 * nothing here that could add to that.
 */

import { performance } from "node:perf_hooks";
import { afterEach } from "vitest";

/** A clock the test drives. Every reading is exactly what the test set it to. */
export interface FakeClock {
  /** Current fake time, in milliseconds. */
  now: () => number;
  /** Move fake time forward. */
  advance: (ms: number) => void;
  /** How many times the runner read the clock — a check that it is reading the injected one. */
  reads: () => number;
}

/**
 * A **stack**, not a slot. A test may install more than once (proving two shapes in one `it`), and a
 * single-slot implementation would capture the *previous fake* as "the original" on the second
 * install and restore to it — leaving a permanently frozen clock behind for the rest of the file.
 * No assertion in this suite reads the real clock, so that leak would be silent until the day
 * someone added one. Unwinding in reverse makes the helper's hermeticity guarantee actually true.
 */
const restores: (() => void)[] = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/**
 * Replace `performance.now` for the duration of the test, and restore it afterwards.
 *
 * The kit reads `performance.now()` as a property access at call time on the object it imported from
 * `node:perf_hooks`, which is the same object this patches — so no seam has to be added to the
 * production API to make it testable. That matters: a `clock` option on `ScalingGateOptions` would
 * be a footgun on a gate whose whole job is to measure honestly.
 */
export function installFakeClock(startMs = 1_000): FakeClock {
  const original = performance.now.bind(performance);
  let t = startMs;
  let reads = 0;
  performance.now = (): number => {
    reads++;
    return t;
  };
  restores.push(() => {
    performance.now = original;
  });
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    reads: () => reads,
  };
}

/**
 * A `parse` that costs an exact number of fake milliseconds per input, and returns a real value so
 * the sink moves and the liveness check is satisfied honestly.
 *
 * `costOf` receives the input, so a test can make cost depend on the input's size (the size axis),
 * on its index (an accumulating-rescan regression on the count axis), or on nothing at all.
 */
export function costingParse<TInput>(
  clock: FakeClock,
  costOf: (input: TInput) => number,
): (input: TInput) => number {
  return (input: TInput): number => {
    const cost = costOf(input);
    clock.advance(cost);
    return 1;
  };
}
