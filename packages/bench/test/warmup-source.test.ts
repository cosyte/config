import { expect, it, vi } from "vitest";

// The warmup rule has one source, `PERF_CONTRACT` in @cosyte/test-utils/perf. Swap that source for
// other numbers and this package's warmup must follow them: a restated copy would not.
vi.mock("../../test-utils/src/perf/contract.js", () => ({
  PERF_CONTRACT: {
    WARMUP_MIN_MS: 1,
    WARMUP_BATCH_MS: 2,
    WARMUP_MAX_MS: 3,
    WARMUP_STABLE_TOL: 0.4,
    WARMUP_STABLE_BATCHES: 5,
  },
}));

it("reads the warmup rule from PERF_CONTRACT rather than restating it", async () => {
  const { WARMUP } = await import("../src/measure.js");
  expect(WARMUP).toEqual({
    MIN_MS: 1,
    BATCH_MS: 2,
    MAX_MS: 3,
    STABLE_TOL: 0.4,
    STABLE_BATCHES: 5,
  });
});
