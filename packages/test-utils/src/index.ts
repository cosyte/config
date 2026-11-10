/**
 * `@cosyte/test-utils`: the shared conformance test kit for the `@cosyte/*`
 * healthcare-standard parsers.
 *
 * Every parser (`hl7`, `mllp`, `dicom`, `x12`, `ccda`, `ncpdp`, …) proves the
 * **same** archetype invariants (round-trip fidelity, idempotent normalize,
 * lenient-mode robustness, model immutability, warning-code stability, and
 * PHI-leak resistance) against
 * one contract instead of reinventing them. This kit ships those invariants as
 * **generic, parameterized runners**; the **format-specific arbitraries stay in
 * each parser** (the kit contains no HL7/DICOM/X12 generators).
 *
 * **There are two PHI runners and they answer different questions.** Importing
 * one is not coverage for the other:
 *
 * - {@link assertNoSecretLeak} asks whether a `Secret<T>`-style **wrapper**
 *   resists the four stringification channels. It says nothing about a parser.
 * - {@link assertNoDiagnosticPhiLeak} asks whether **consumer-controlled input
 *   reaches a diagnostic surface**: a warning `message`, a position object,
 *   `err.stack`, or a structural identifier on the model. This is the one a
 *   parser needs.
 *
 * Design constraints:
 *
 * - **Framework-agnostic.** Runners use {@link https://fast-check.dev/ | fast-check}
 *   (a peer dependency) and `node:assert/strict`; they **throw** on failure, so
 *   any test runner (Vitest, `node:test`, Mocha) catches it. The kit takes
 *   **no** runtime dependency on Vitest.
 * - **Strict types, no `any`.** Generics carry the parser's own model type
 *   through each runner.
 * - **Fast on a pull request, deep at night, replayable.** Each property runs
 *   {@link DEFAULT_NUM_RUNS} cases unless `COSYTE_PROPERTY_RUNS` says otherwise,
 *   and a failure prints the seed and path that replay it exactly
 *   ({@link PROPERTY_ENV}).
 *
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { roundTripProperty, assertNoSecretLeak } from "@cosyte/test-utils";
 *
 * roundTripProperty({
 *   arbitrary: fc.record({ a: fc.string() }),
 *   serialize: (v) => JSON.stringify(v),
 *   parse: (raw) => JSON.parse(raw) as { a: string },
 * });
 * ```
 *
 * @packageDocumentation
 */

export {
  assertProperty,
  DEFAULT_NUM_RUNS,
  PROPERTY_ENV,
  propertyFailureMessage,
  resolvePropertyRun,
  type PropertyRunOptions,
  type ResolvedPropertyRun,
} from "./property.js";
export { roundTripProperty, type RoundTripOptions } from "./round-trip.js";
export {
  idempotentNormalizeProperty,
  type IdempotentNormalizeOptions,
} from "./idempotent-normalize.js";
export { lenientNeverThrowsProperty, type LenientOptions, type LenientWarning } from "./lenient.js";
export { immutabilityProperty, type ImmutabilityOptions } from "./immutability.js";
export { sortedCodeSet } from "./warning-codes.js";
export { assertNoSecretLeak, type SecretLeakOptions } from "./phi.js";
export {
  assertNoDiagnosticPhiLeak,
  PHI_MARKER_UNIT,
  type DiagnosticSlot,
  type DiagnosticSurfaceOptions,
} from "./diagnostic-phi.js";
