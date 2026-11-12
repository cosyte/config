import { describe, expect, it } from "vitest";

import { PERF_CONTRACT } from "../../test-utils/src/perf/contract.js";
import { BENCH_CONTRACT } from "../src/contract.js";
import { WARMUP } from "../src/measure.js";

describe("the contracts", () => {
  it("warms up by the scaling gate's rule, number for number", () => {
    expect(WARMUP).toEqual({
      MIN_MS: PERF_CONTRACT.WARMUP_MIN_MS,
      BATCH_MS: PERF_CONTRACT.WARMUP_BATCH_MS,
      MAX_MS: PERF_CONTRACT.WARMUP_MAX_MS,
      STABLE_TOL: PERF_CONTRACT.WARMUP_STABLE_TOL,
      STABLE_BATCHES: PERF_CONTRACT.WARMUP_STABLE_BATCHES,
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(BENCH_CONTRACT)).toBe(true);
    expect(Object.isFrozen(WARMUP)).toBe(true);
  });

  it("holds the values the standard records", () => {
    expect(BENCH_CONTRACT).toMatchInlineSnapshot(`
      {
        "ALLOC_SEMI_SPACE_MIB": 64,
        "ALLOC_WINDOW_MS": 100,
        "ALLOC_WINDOW_OPS": 256,
        "ALPHA": 0.05,
        "FLOOR_INPUT_BYTES": 65536,
        "FLOOR_MEMORY_MARGIN": 0.05,
        "FLOOR_MIN_READINGS": 7,
        "FLOOR_NOISE_MULTIPLE": 3,
        "GC_MAX_ROUNDS": 7,
        "GC_SETTLE_BYTES": 65536,
        "GC_SETTLE_ROUNDS": 2,
        "IMPORT_RUNS": 20,
        "LARGE_INPUT_BYTES": 1048576,
        "LARGE_PASS_MS": 50,
        "LARGE_WARMUP_MAX_MS": 30000,
        "LARGE_WARMUP_WINDOW": 5,
        "LATENCY_BUDGET_MS": 2000,
        "LATENCY_MAX_CALLS": 5000,
        "LATENCY_MIN_CALLS": 20,
        "LATENCY_TAIL_CALLS": 10,
        "LATENCY_TIMER_MULTIPLE": 20,
        "LONG_RUN_GROWTH_BYTES": 65536,
        "LONG_RUN_MAX_MS": 60000,
        "LONG_RUN_ROUNDS": 30,
        "LONG_RUN_ROUND_MS": 100,
        "LONG_RUN_SETTLE_ROUNDS": 5,
        "PEAK_CALLS": 20,
        "REQUIRED_CONFIDENCE": 0.95,
        "REQUIRED_FALSE_ALARM_RATE": 0.01,
        "ROUNDS": 12,
        "SAMPLES": 5,
        "SAMPLE_MIN_MS": 50,
        "THRESHOLD": 0.03,
      }
    `);
  });
});
