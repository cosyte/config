/**
 * `@cosyte/bench`: the benchmark runner for the `@cosyte/*` packages.
 *
 * It measures what the performance standard names (throughput across input sizes, latency
 * percentiles, allocations, peak heap, a flat heap over a long run, cold import time and loaded
 * bytes), writes the results as versioned JSON, and compares a base build against a head build
 * interleaved on one machine. It stands beside the scaling gate in `@cosyte/test-utils/perf`, which
 * stays the required check for complexity regressions; this package adds the constant-factor
 * comparison and the readings, and says how much noise each one has.
 *
 * Most use is through the `cosyte-bench` command; this entry point is for writing a suite
 * ({@link defineSuite}) and for reading results ({@link readResults}), budgets files
 * ({@link readBudgets}) and floor files ({@link readFloor}).
 *
 * @packageDocumentation
 */

export { BENCH_CONTRACT, type BenchContractShape } from "./contract.js";
export {
  defineBenchmark,
  defineSuite,
  type AnyBenchmark,
  type BenchCorpus,
  type BenchSize,
  type BenchSuite,
  type Benchmark,
  type CaseRef,
} from "./suite.js";
export {
  judge,
  type CalibrationBody,
  type CaseComparison,
  type ComparisonBody,
  type CountedRate,
  type Verdict,
} from "./compare.js";
export {
  budgetPeakBytes,
  type CaseReading,
  type ReadingBody,
  type RunFailure,
  type Throughput,
} from "./reading.js";
export type { LatencyReport, WarmupReport } from "./measure.js";
export type { AllocationReport, LongRunReport, MemorySkipReason, PeakReport } from "./memory.js";
export type { ImportCostReport, LoadedFile } from "./import-cost.js";
export type { Environment, Runner } from "./environment.js";
export {
  RESULTS_SCHEMA,
  SCHEMA_VERSION,
  readResults,
  type BuildRef,
  type ResultsDocument,
} from "./results.js";
export { BenchError } from "./spawn.js";
export { BUDGETS_SCHEMA, readBudgets, type BudgetRule, type Budgets } from "./budgets.js";
export { FLOOR_SCHEMA, readFloor, type Floor, type FloorCase, type FloorValue } from "./floor.js";
export type { GateFinding, SizeClass } from "./gate.js";
