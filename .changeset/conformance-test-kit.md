---
"@cosyte/test-utils": patch
---

First real release of `@cosyte/test-utils` — the shared, framework-agnostic conformance kit every
`@cosyte/*` parser consumes (and the first built/publishable package in `config`).

Generic, parameterized invariant runners; the format-specific `fast-check` arbitraries stay per
parser. `fast-check` is a peer dependency (`^3`); runners use `node:assert/strict` and throw on
failure, so any test runner catches them — no Vitest dependency at runtime.

- `roundTripProperty` — `parse(serialize(x))` equality (deep-equal default or custom `equals`) plus
  serialize-idempotency.
- `lenientNeverThrowsProperty` — `parse` throws only on sanctioned fatals; recovered warnings carry a
  registered code and (optionally) positional context.
- `immutabilityProperty` — a mutation attempt throws or returns a new instance; the original is never
  edited in place.
- `sortedCodeSet` — sorted warning/fatal code values for a snapshot stability tripwire.
- `assertNoSecretLeak` — the PHI-leak matrix across `JSON.stringify`, `String()`, template-literal
  interpolation, and `util.inspect`, naming the leaking channel on failure.

Ships a dual ESM + CJS build (`@cosyte/tsup-config`) with per-condition types (`.d.ts` / `.d.cts`) and
`attw` as a publish gate. Pre-alpha `0.0.x` ladder: patch bump to the first `0.0.1`.
