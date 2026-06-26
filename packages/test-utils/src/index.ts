/**
 * `@cosyte/test-utils` — the shared conformance test kit for the `@cosyte/*`
 * healthcare-standard parsers.
 *
 * Every parser (`hl7`, `mllp`, `dicom`, `x12`, `ccda`, `ncpdp`, …) proves the
 * **same** archetype invariants — round-trip fidelity, lenient-mode robustness,
 * model immutability, warning-code stability, and PHI-leak resistance — against
 * one contract instead of reinventing them. This kit ships those invariants as
 * **generic, parameterized runners**; the **format-specific arbitraries stay in
 * each parser** (the kit contains no HL7/DICOM/X12 generators).
 *
 * Design constraints:
 *
 * - **Framework-agnostic.** Runners use {@link https://fast-check.dev/ | fast-check}
 *   (a peer dependency) and `node:assert/strict`; they **throw** on failure, so
 *   any test runner — Vitest, `node:test`, Mocha — catches it. The kit takes
 *   **no** runtime dependency on Vitest.
 * - **Strict types, no `any`.** Generics carry the parser's own model type
 *   through each runner.
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

export { roundTripProperty, type RoundTripOptions } from "./round-trip.js";
export { lenientNeverThrowsProperty, type LenientOptions, type LenientWarning } from "./lenient.js";
export { immutabilityProperty, type ImmutabilityOptions } from "./immutability.js";
export { sortedCodeSet } from "./warning-codes.js";
export { assertNoSecretLeak, type SecretLeakOptions } from "./phi.js";
