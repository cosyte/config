# Changelog

All notable changes to `@cosyte/vitest-config` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained. The package stays on the **`0.0.x`-until-first-alpha** ladder.

## [Unreleased]

### Added

- Initial release: `cosyteVitest(opts)` — v8 coverage, standard excludes, and enabled, gating
  per-directory thresholds at >= 90.
- Declared `vite` (`^6 || ^7 || ^8`) as a peer dependency — Vitest 4 requires vite >= 6, and the
  resolver otherwise keeps an incompatible vite 5 (missing the `./module-runner` export).
