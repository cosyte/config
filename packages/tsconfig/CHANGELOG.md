# Changelog

All notable changes to `@cosyte/tsconfig` are documented here, following
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
  in. No compiler-option change; the `CHANGELOG.md` inside the published tarball is the only thing
  that differs.

## [0.0.3] - 2026-07-31

### Changed

- Documentation no longer uses em dashes, in line with the cosyte brand voice. No
  compiler-option change.

## [0.0.2] - 2026-06-25

### Changed

- `target` and `lib` raised from `ES2022` to `ES2023` (the suite's Node ≥ 22 floor supports it).

## [0.0.1] - 2026-06-24

### Added

- Initial release: `base.json` (strict type-check baseline) and `library.json` (`base.json` + emit).
