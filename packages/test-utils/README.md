# @cosyte/test-utils

The shared conformance test kit for the `@cosyte/*` parsers — so every parser proves the **same**
archetype invariants against one contract instead of reinventing them.

> **Status: scaffold.** This package is filled in the test-strategy phase of the standardization
> campaign (see `prompts/STANDARDIZATION-PLAN.md`, Phase E), extracted from `hl7`'s proven harnesses.
> It is `private` until it has real content.

Planned surface:

- **`fast-check` arbitraries** per format — spec-valid and vendor-quirky/malformed generators.
- **Invariant runners** — round-trip, tolerance tiers, immutability, strict-vs-lenient.
- **Warning-code stability** snapshot helpers.
- **PHI-leak assertion matrix** — `JSON.stringify`, coercion, `util.inspect`, log interpolation.
- **Generalized PHI scanner** — lifted from `dicom`'s `phi-scan`.
- **Conformance corpus loader** — a shared, synthetic, versioned fixture corpus.

Part of [cosyte/config](https://github.com/cosyte/config).
