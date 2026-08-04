# Changelog

All notable changes to `@cosyte/test-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically. Until 2026-08-04 nothing
> did it at all, so shipped content stayed under `[Unreleased]` and every release republished it.

## [Unreleased]

### Changed

- The sections below were relabelled: content that had already shipped was still sitting under
  `[Unreleased]`, so each release republished it. Every section now carries the version it shipped
  in. No runner or API change; the `CHANGELOG.md` inside the published tarball is the only thing that
  differs.

## [0.0.2] - 2026-07-31

### Added

- `assertNoDiagnosticPhiLeak`, a runner proving that consumer-controlled input does not echo into a
  diagnostic surface. For every slot the caller declares it sweeps each diagnostic `message`, the
  whole diagnostic rendered as JSON, as `util.inspect`, and by a walk of the object graph,
  `err.message`, `err.stack`, the thrown value itself, and every structural identifier the caller
  enumerates on the model. The walk is what reaches a nested `toString`, raw bytes attached as
  context, and entries past `inspect`'s truncation ceilings, none of which either summary rendering
  shows. Matching is case-insensitive, so a value upper-cased on conformance grounds still fails.
  What it proves, stated narrowly: **no verbatim echo of four or more bytes of a planted value, on
  a slot that provably reached the diagnostic it names.** It does not prove the absence of a
  re-encoded echo, an echo shorter than four bytes, or a leak through an undeclared slot.
- Each slot must name the diagnostic code it expects, and the runner asserts that code appeared in
  lenient mode. Counting diagnostics is not enough: an unrelated warning can otherwise stand in for
  the one the slot exists to trigger, leaving the leaking branch unentered and the suite green. The
  assertion is lenient-only because a strict mode throws on the first deviation, so only one slot
  could ever satisfy its own code there. Strict mode keeps its sweep.
- `getDiagnostics`, `getModelIdentifiers` and `parseStrict` are required rather than defaulted.
  `() => []` and `null` are legitimate answers; silence is not, and a silent default reading only
  `.warnings` would report green on a model it had half-read.
- Opt-in `checkLengthInvariance` catches a re-encoded echo by comparing diagnostic sizes across a
  short and a long planted value. Off by default because a diagnostic carrying an input-derived
  number, such as a position column gaining digits or a byte count, grows the same way and is
  correct.
- Exercised by constructed positive controls, each isolating the one surface it names, and by
  controls asserting the runner stays green where a correct parser would otherwise be failed.

### Changed

- Documentation, source comments, the npm package description, and seven assertion-failure
  message strings no longer use em dashes, in line with the cosyte brand voice. No API, type, or
  behaviour change: the message strings are the diagnostics a failing conformance run prints.

## [0.0.1] - 2026-06-26

### Added

- First real release of the conformance kit: the first built (publishable) package in `config`.
  Framework-agnostic, `fast-check`-powered (peer dep `^3`), throws on failure so any runner catches
  it. Public API:
  - `roundTripProperty`: `parse(serialize(x))` equals `x` (deep-equal default or custom `equals`)
    plus serialize-idempotency.
  - `lenientNeverThrowsProperty`: `parse` throws only on sanctioned fatals; every recovered warning
    carries a registered code and (optionally) positional context.
  - `immutabilityProperty`: a mutation attempt throws or returns a new instance; the original is
    never edited in place.
  - `sortedCodeSet`: sorted warning/fatal code values for a snapshot stability tripwire.
  - `assertNoSecretLeak`: the PHI-leak matrix across `JSON.stringify`, `String()`, template-literal
    interpolation, and `util.inspect`, naming the leaking channel on failure.
- Dual ESM + CJS build via `@cosyte/tsup-config` with per-condition types (`.d.ts` / `.d.cts`),
  `attw` as a publish gate.
