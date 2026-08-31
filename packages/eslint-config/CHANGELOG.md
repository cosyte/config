# Changelog

All notable changes to `@cosyte/eslint-config` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package is on the
**`0.1.x`** line: its surface is settled, and bump types follow ordinary semver rather than a
pre-alpha rule. See
[ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md).

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically. Until 2026-08-04 nothing
> did it at all, so shipped content stayed under `[Unreleased]` and every release republished it.

## [Unreleased]

## [0.1.0] - Unreleased

### Changed

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** No rule, option, peer
  range, or behaviour change: the flat config and its guardrails are byte-identical to `0.0.6`. What
  moves is the version policy this package states about itself, and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.6` does not resolve this release and has to widen its range once.
- The `0.0.6` section below was relabelled: its content had shipped and was still sitting under
  `[Unreleased]`, which is the same defect the note above describes, recurring one release after it
  was written down. The `CHANGELOG.md` inside the published tarball is the only thing that differs.

## [0.0.6] - 2026-08-04

### Changed

- The sections below were relabelled: content that had already shipped was still sitting under
  `[Unreleased]`, so each release republished it. Every section now carries the version it shipped
  in. No rule, option, or behaviour change; the `CHANGELOG.md` inside the published tarball is the
  only thing that differs.

## [0.0.5] - 2026-07-31

### Changed

- Documentation and source comments no longer use em dashes, in line with the cosyte brand
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

- Initial release of the ESLint 9 flat config: `recommendedTypeChecked` + the cosyte guardrails (no `any`,
  no unjustified casts, JSDoc + `@example` gate on public exports, `no-console` in library code).

  (`0.0.1` was never published.)
