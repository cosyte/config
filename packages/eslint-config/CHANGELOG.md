# Changelog

All notable changes to `@cosyte/eslint-config` are documented here, following
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
