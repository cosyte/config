# Changelog

All notable changes to `@cosyte/script-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically.

## [0.0.1] - 2026-08-05

### Added

- First release. `isCliEntrypoint(import.meta.url)` answers "is this module the file Node was
  pointed at", for the `scripts/*.mjs` gates that must not run their CLI body when a test imports
  them for their exports.

  It replaces the raw string comparison those gates were spelling by hand,
  `` import.meta.url === `file://${resolve(process.argv[1])}` ``, which compares two strings rather
  than two paths and therefore answers `false` for three ordinary invocations: an extension-less
  specifier that Node or `tsx` resolved (`node scripts/gate` running `scripts/gate.js`), a checkout
  under a path containing a space (`import.meta.url` percent-encodes and the concatenation does
  not), and a symlinked invocation (Node resolves the main module to its real path). In each the
  gate exits 0 having checked nothing.

  Those three forms also COMBINE, and the combination is the one that hides: an extension-less
  `argv[1]` names no file, so it cannot be resolved directly, and any symlinked ancestor then puts
  the two sides in different places. `isCliEntrypoint` resolves the deepest ancestor that does
  exist and keeps the rest verbatim, so `tsx scripts/gate` answers correctly under a symlinked
  checkout.

  The package carries no runtime dependencies and no build step, because the gates that import it
  run before `pnpm install` on purpose.
