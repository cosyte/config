# Changelog

All notable changes to `@cosyte/tsup-config` are documented here, following
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
  in. No build-option change; the `CHANGELOG.md` inside the published tarball is the only thing that
  differs.

## [0.0.2] - 2026-07-31

### Changed

- Documentation no longer uses em dashes, in line with the cosyte brand voice. No build-option
  change.

## [0.0.1] - 2026-06-25

### Added

- Initial release of `cosyteTsup(overrides)`: the standard dual ESM + CJS, ES2023, Node-platform tsup
  build config for `@cosyte/*` libraries.
