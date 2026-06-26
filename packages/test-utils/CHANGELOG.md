# Changelog

All notable changes to `@cosyte/test-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained. The package stays on the **`0.0.x`-until-first-alpha** ladder.

## [Unreleased]

## [0.0.1] - 2026-06-26

### Added

- First real release of the conformance kit — the first built (publishable) package in `config`.
  Framework-agnostic, `fast-check`-powered (peer dep `^3`), throws on failure so any runner catches
  it. Public API:
  - `roundTripProperty` — `parse(serialize(x))` equals `x` (deep-equal default or custom `equals`)
    plus serialize-idempotency.
  - `lenientNeverThrowsProperty` — `parse` throws only on sanctioned fatals; every recovered warning
    carries a registered code and (optionally) positional context.
  - `immutabilityProperty` — a mutation attempt throws or returns a new instance; the original is
    never edited in place.
  - `sortedCodeSet` — sorted warning/fatal code values for a snapshot stability tripwire.
  - `assertNoSecretLeak` — the PHI-leak matrix across `JSON.stringify`, `String()`, template-literal
    interpolation, and `util.inspect`, naming the leaking channel on failure.
- Dual ESM + CJS build via `@cosyte/tsup-config` with per-condition types (`.d.ts` / `.d.cts`),
  `attw` as a publish gate.
