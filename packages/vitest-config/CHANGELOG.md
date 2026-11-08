# Changelog

## 0.1.2

### Patch Changes

- bcdb7ea: The README's license line names the legal owner: "MIT, copyright Cosyte LLC." The READMEs of `@cosyte/eslint-config`, `@cosyte/process` and `@cosyte/script-utils` also use US spelling where they did not (license, behavior, generalize, recognized, honored). No code, configuration or type changes.
- 75c1056: `@cosyte/vitest-config` accepts Vitest 5 as well as Vitest 4: the `vitest` and `@vitest/coverage-v8` peer ranges are now `^4.0.0 || ^5.0.0`, so a package on Vitest 5 installs it without a peer warning. The configuration it returns is unchanged; Vitest 5 reads the same `coverage` options, and its own `vite` range (6.4 or later, 7 or 8) sits inside this package's.

## Released before this file was generated

Every release section above this heading is written by
[Changesets](https://github.com/changesets/changesets) from the changesets in `.changeset/`, newest
release first. A release writes its own version heading, so nothing above this line is maintained by
hand: a change is recorded by adding a changeset rather than by editing this file.

The sections below were kept by hand, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, until 2026-11-07. A version heading
that still read "Unreleased" after its version reached npm now carries that date; no entry was
reworded.

## [0.1.1] - 2026-11-07

### Changed

- **Published through npm trusted publishing, with provenance.** The code and configuration are
  unchanged from 0.1.0. Only the README differs: it writes Cosyte with a capital C.

## [0.1.0] - 2026-09-21

### Changed

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** No config or behaviour
  change: `cosyteVitest(opts)`, its coverage thresholds, its peer ranges and the `./snippets`
  doc-agreement harness are byte-identical to `0.0.4`. What moves is the version policy this package
  states about itself, and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.4` does not resolve this release and has to widen its range once.
- The `README.md` in the tarball now opens its `## Status` section on the settled-line sentence
  instead of the pre-alpha ladder one, so the policy text a consumer reads agrees with the version
  printed beside it. `scripts/readme-check.mjs` grades that sentence against the release line the
  pending changesets resolve to. Its "still moving" note is rewritten to match: the parts that are
  settled are now described as settled, and a change to one is recorded with the bump type it
  deserves.
- The `0.0.4` section below was relabelled: its content had shipped and was still sitting under
  `[Unreleased]`, which is the same defect the note above describes, recurring one release after it
  was written down. That relabelling changes only the `CHANGELOG.md` inside the published tarball.

## [0.0.4] - 2026-08-04

### Changed

- The sections below were relabelled: content that had already shipped was still sitting under
  `[Unreleased]`, so each release republished it. Every section now carries the version it shipped
  in. No config or behaviour change; the `CHANGELOG.md` inside the published tarball is the only
  thing that differs.

## [0.0.3] - 2026-07-31

### Changed

- Documentation and source comments no longer use em dashes, in line with the Cosyte brand
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
