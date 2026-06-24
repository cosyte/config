# Changelog

All notable changes to `@cosyte/eslint-config` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

## [Unreleased]

### Changed

- ESLint 10 baseline: `@eslint/js` `^10`, `eslint-plugin-jsdoc` `^63`, `typescript-eslint` `^8.62`,
  `eslint-config-prettier` `^10.1`. The `eslint` peer accepts `^9 || ^10` during the suite's migration
  window; it will tighten to `^10` once every repo is on ESLint 10.

### Added

- `typescript` is now a declared peer dependency (the type-checked rules require it).

## [0.0.2] - 2026-06-24

### Added

- Initial release: ESLint 9 flat config — `recommendedTypeChecked` + the cosyte guardrails (no `any`,
  no unjustified casts, JSDoc + `@example` gate on public exports, `no-console` in library code).

  (`0.0.1` was never published.)
