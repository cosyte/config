# Changelog

All notable changes to `@cosyte/vitest-config` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained. The package stays on the **`0.0.x`-until-first-alpha** ladder.

## [Unreleased]

### Added

- Declared `vite` (`^6 || ^7 || ^8`) as a peer dependency — Vitest 4 requires vite >= 6, and the
  resolver otherwise keeps an incompatible vite 5 (missing the `./module-runner` export). _(Added after
  `0.0.1` published; ships in the next release.)_
- **Doc/code-agreement harness** on a new `@cosyte/vitest-config/snippets` subpath — `docSnippetSuite()`
  plus the factored primitives (`extractRunnableSnippets`, `rewriteAssertions`, `remapImports`,
  `runSnippet`). It extracts every fenced ` ```ts runnable ` block from a package's `docs-content/`,
  compiles it, executes it against the package, and asserts its inline `// => value` results — the
  documentation analog of the conformance runners, so a green docs build can never carry a snippet
  that silently disagrees with the code. devDep-only; Vitest is already a peer, so no new dependency.

## [0.0.1] - 2026-06-25

### Added

- Initial release: `cosyteVitest(opts)` — v8 coverage, standard excludes, and enabled, gating
  per-directory thresholds at >= 90.
