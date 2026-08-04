# Changelog

All notable changes to `@cosyte/vitest-config` are documented here, following
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
  in. No config or behaviour change; the `CHANGELOG.md` inside the published tarball is the only
  thing that differs.

## [0.0.3] - 2026-07-31

### Changed

- Documentation and source comments no longer use em dashes, in line with the cosyte brand
  voice. No config or behaviour change.

## [0.0.2] - 2026-07-15

### Added

- Declared `vite` (`^6 || ^7 || ^8`) as a peer dependency. Vitest 4 requires vite >= 6, and the
  resolver otherwise keeps an incompatible vite 5 (missing the `./module-runner` export).
- **Doc/code-agreement harness** on a new `@cosyte/vitest-config/snippets` subpath: `docSnippetSuite()`
  plus the factored primitives (`extractRunnableSnippets`, `rewriteAssertions`, `remapImports`,
  `runSnippet`). It extracts every fenced ` ```ts runnable ` block from a package's `docs-content/`,
  compiles it, executes it against the package, and asserts its inline `// => value` results: the
  documentation analog of the conformance runners, so a green docs build can never carry a snippet
  that silently disagrees with the code. devDep-only; Vitest is already a peer, so no new dependency.

## [0.0.1] - 2026-06-25

### Added

- Initial release of `cosyteVitest(opts)`: v8 coverage, standard excludes, and enabled, gating
  per-directory thresholds at >= 90.
