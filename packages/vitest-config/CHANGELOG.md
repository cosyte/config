# Changelog

## 0.1.4

### Patch Changes

- 57847cb: The snippet harness can run every code sample, not only the ones tagged `runnable`: `docSnippetSuite({ every: true })` runs each `ts`, `typescript`, `tsx`, `js`, `javascript` and `mjs` block, and a block that cannot run says why in its fence (`ts no-run <reason>`), which the test report lists as skipped with that reason; a `no-run` with no reason fails. In that mode a JavaScript sample runs as a `.mjs` module, so TypeScript syntax in it fails, and a `tsx` sample as a `.tsx` module; each sample `extractSamples` returns names its module in a new `extension` field, which `runSnippet` reads. New exports: `extractSamples`, `planSamples` and `SAMPLE_LANGS`. Without `every`, nothing changes: every `runnable` block, `tsx` included, still runs as a `.ts` module.
- 65208bf: In every-sample mode, `docSnippetSuite({ every: true })` now type-checks each TypeScript sample (`ts`, `typescript`, `tsx`) against the package's types before it runs it, so a sample with a type error fails even though it would run. The samples compile as a reader's project would compile them: each its own module, importing the package by its published name, under the project's `tsconfig.json` (the new `tsconfig` option, or the one in the working directory) with emit, its folders and the unused-name checks off. A sample whose types cannot be checked says why in its fence, `ts no-typecheck <reason>`; it still runs, its test name carries the reason, and a `no-typecheck` with no reason fails. This needs `typescript`, now an optional peer dependency. Walking `docsDir`, every-sample mode also leaves out the generated reference under `api/`, whose examples are parts of a signature's documentation; `includeGenerated: true` walks it too. New export: `typecheckSamples`. Without `every`, nothing changes.
- 5a0470a: Adds mutation testing beside the Vitest config. `@cosyte/vitest-config/stryker` exports `cosyteStryker(options?)`, a StrykerJS config for the Vitest runner (resolved from this package, so it works under pnpm), with per-test coverage in Vitest's forks pool, every mutant kept (static ones too), no score threshold of its own, and the JSON report at `reports/mutation/mutation.json`. The new bin, `cosyte-mutate`, runs `full` over everything the config names, or `changed --base <ref>` over only the source files changed against the merge base of that ref and HEAD, writing `reports/mutation/changed.json`; a change with no changed source file starts no run, writes an empty report and exits 0, and a run that cannot start exits 2. `@cosyte/vitest-config/mutate` is the bin's body. `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` 10 are optional peer dependencies, and so is `@cosyte/script-utils`, which a changed run imports when it starts to read what a change touched, so a package that does not mutate installs nothing new; a changed run without it exits 2 and names it. `cosyteVitest` also adds the `json-summary` coverage reporter, so a coverage run writes `coverage/coverage-summary.json`, the totals `cosyte-ratchet` compares with a floor file; the `text`, `html` and `lcov` reporters, the thresholds and the excludes are unchanged.
- Updated dependencies [65208bf]
- Updated dependencies [57847cb]
- Updated dependencies [cc43161]
- Updated dependencies [5a0470a]
  - @cosyte/script-utils@0.1.9

## 0.1.3

### Patch Changes

- 095c103: `@cosyte/vitest-config/snippets` reads a markdown fence opener and a `// =>` doctest line in time linear in the line's length. Two regular expressions there let several quantifiers take the same spaces, so a long line that failed to match took time quadratic in its length: 100,000 spaces took 8 to 32 seconds on Node 26 (CodeQL js/polynomial-redos). Every snippet with an expression and a value is read as before. A doctest line with no expression, `; // => 1`, now becomes `expect()`, which fails the snippet, where an unindented one used to pass as a line that asserted nothing.

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
