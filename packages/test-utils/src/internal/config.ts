/**
 * Internal shared constants for the conformance runners. Not part of the public
 * API surface (no JSDoc `@example` gate applies — these are `@internal`).
 *
 * @internal
 * @packageDocumentation
 */

/**
 * Default number of generated cases per property when a runner's `numRuns` is
 * omitted. Chosen to be heavy enough to surface delimiter/escape edge cases in a
 * parser's round-trip without making a suite slow.
 *
 * @internal
 */
export const DEFAULT_NUM_RUNS = 300;
