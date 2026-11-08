# Changelog

## 0.1.2

### Patch Changes

- bcdb7ea: The README's license line names the legal owner: "MIT, copyright Cosyte LLC." The READMEs of `@cosyte/eslint-config`, `@cosyte/process` and `@cosyte/script-utils` also use US spelling where they did not (license, behavior, generalize, recognized, honored). No code, configuration or type changes.

## Released before this file was generated

Every release section above this heading is written by
[Changesets](https://github.com/changesets/changesets) from the changesets in `.changeset/`, newest
release first. A release writes its own version heading, so nothing above this line is maintained by
hand: a change is recorded by adding a changeset rather than by editing this file.

The sections below were kept by hand, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, until 2026-11-07. A version heading
that still read "Unreleased" after its version reached npm now carries that date; no entry was
reworded.

## [0.1.1] - 2026-11-07

### Changed

- **Published through npm trusted publishing, with provenance.** The code and configuration are
  unchanged from 0.1.0. Only the README differs: it writes Cosyte with a capital C.

## [0.1.0] - 2026-09-21

### Changed

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** No rule, option, peer
  range, or behaviour change: the flat config and its guardrails are byte-identical to `0.0.6`. What
  moves is the version policy this package states about itself, and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.6` does not resolve this release and has to widen its range once.
- The `README.md` in the tarball now opens its `## Status` section on the settled-line sentence
  instead of the pre-alpha ladder one, so the policy text a consumer reads agrees with the version
  printed beside it. `scripts/readme-check.mjs` grades that sentence against the release line the
  pending changesets resolve to.
- The `0.0.6` section below was relabelled: its content had shipped and was still sitting under
  `[Unreleased]`, which is the same defect the note above describes, recurring one release after it
  was written down. That relabelling changes only the `CHANGELOG.md` inside the published tarball.

## [0.0.6] - 2026-08-04

### Changed

- The sections below were relabelled: content that had already shipped was still sitting under
  `[Unreleased]`, so each release republished it. Every section now carries the version it shipped
  in. No rule, option, or behaviour change; the `CHANGELOG.md` inside the published tarball is the
  only thing that differs.

## [0.0.5] - 2026-07-31

### Changed

- Documentation and source comments no longer use em dashes, in line with the Cosyte brand
  voice. No rule, option, or behaviour change.

## [0.0.4] - 2026-06-26

### Added

- **Application mode:** `cosyte(rootDir, { library: false })` drops the JSDoc + `@example` gate and
  `no-console` while keeping every type-safety rule (no `any`, no unjustified casts, exhaustiveness,
  strict imports). Libraries (the default, `library: true`) are unchanged. This makes applications,
  like the `pathways` engine, first-class consumers of the one shared config instead of forking it:
  an app has no published API surface to document and legitimately logs.

## [0.0.3] - 2026-06-25

### Changed

- ESLint 10 baseline: `@eslint/js` `^10`, `eslint-plugin-jsdoc` `^63`, `typescript-eslint` `^8.62`,
  `eslint-config-prettier` `^10.1`. The `eslint` peer accepts `^9 || ^10` during the suite's migration
  window; it will tighten to `^10` once every repo is on ESLint 10.

### Added

- `typescript` is now a declared peer dependency (the type-checked rules require it).

## [0.0.2] - 2026-06-24

### Added

- Initial release of the ESLint 9 flat config: `recommendedTypeChecked` + the Cosyte guardrails (no `any`,
  no unjustified casts, JSDoc + `@example` gate on public exports, `no-console` in library code).

  (`0.0.1` was never published.)
