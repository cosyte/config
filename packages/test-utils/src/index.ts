// @cosyte/test-utils — the shared conformance test kit for the @cosyte/* parsers.
//
// Scaffold only. Filled in the test-strategy phase (see prompts/STANDARDIZATION-PLAN.md, Phase E),
// extracted from hl7's proven harnesses so every parser proves the same archetype invariants against
// one contract. Planned exports:
//   - fast-check arbitraries per format (spec-valid + vendor-quirky/malformed)
//   - invariant runners: round-trip, tolerance tiers, immutability, strict-vs-lenient
//   - warning-code stability snapshot helpers
//   - the PHI-leak assertion matrix (JSON.stringify / coercion / util.inspect / log interpolation)
//   - the generalized PHI scanner (from dicom's phi-scan)
//   - the shared synthetic, versioned conformance corpus loader
export {};
