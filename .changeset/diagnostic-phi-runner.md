---
"@cosyte/test-utils": patch
---

Add `assertNoDiagnosticPhiLeak`, a runner that proves consumer-controlled input does not echo into a
diagnostic surface.

- For each slot the caller declares, the runner sweeps every diagnostic `message`, the whole
  diagnostic rendered as JSON, as `util.inspect`, and by a walk of the object graph, `err.message`,
  `err.stack`, the thrown value itself, and every structural identifier the caller enumerates on the
  parsed model. All three renderings are needed: `JSON.stringify` of an `Error`-valued field is
  `{}`, and both summaries hide a nested `toString`, raw bytes attached as context, and entries past
  `inspect`'s truncation ceilings. Matching is case-insensitive.
- What it proves is deliberately narrow: no verbatim echo of four or more bytes of a planted value,
  on a slot that provably reached the diagnostic it names. It does not prove the absence of a
  re-encoded echo, an echo shorter than four bytes, or a leak through a slot nobody declared.
- Each slot names the diagnostic code it expects, and that code must appear in lenient mode.
  Counting diagnostics would let an unrelated warning stand in for the one the slot exists to
  trigger. Strict mode keeps its sweep but is not held to the code, because a strict parser throws
  on the first deviation and only one slot could ever be that deviation.
- `getDiagnostics`, `getModelIdentifiers` and `parseStrict` are required rather than defaulted, so a
  parser cannot go green on a model the runner only half-read.
- `checkLengthInvariance` is opt-in. It catches a re-encoded echo, but a diagnostic carrying an
  input-derived number grows with the input and is correct, so it is off unless asked for.
- `assertNoSecretLeak` is unchanged. It answers a different question, whether a `Secret<T>` wrapper
  resists stringification, and the package docs now say so at the point of import.
