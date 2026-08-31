# Changelog

All notable changes to `@cosyte/tsup-config` are documented here, following
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

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** No build-option change:
  `cosyteTsup(overrides)` produces exactly the dual ESM and CJS build `0.0.3` produced. What moves is
  the version policy this package states about itself, and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.3` does not resolve this release and has to widen its range once.
- The `0.0.3` section below was relabelled: its content had shipped and was still sitting under
  `[Unreleased]`, which is the same defect the note above describes, recurring one release after it
  was written down. The `CHANGELOG.md` inside the published tarball is the only thing that differs.

## [0.0.3] - 2026-08-04

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
