# Changelog

## 0.1.5

### Patch Changes

- 958b55b: `cosyte-process format` now runs prettier 3.9.10 (was 3.8.3). Prettier's 3.9 line fixes Markdown,
  TypeScript and CSS formatting cases, so a repo's first `format --check` after this update can name
  files to reformat; `cosyte-process format` rewrites them.

## 0.1.4

### Patch Changes

- c872af7: vitest and `@vitest/coverage-v8` move from 4.1.4 to 4.1.12, which brings `@vitest/mocker` 4.1.12 with them and closes GHSA-82fw-gwwq-j7x9 and GHSA-qxg6-89mg-rqv8 for every repository that installs this package. A consumer that worked around those alerts with an override such as `"@cosyte/process>vitest"` can drop it on this version. Both stay pinned exactly, as every tool here is: the toolchain a consumer runs is the one this package's version names, and `@vitest/coverage-v8` 4.1.12 names vitest 4.1.12 exactly as its peer, so two caret ranges could pair mismatched versions in a consumer's lockfile. One alert this version cannot close for a consumer: eslint, which this package pins at 10.5.0, asks for minimatch ^10, and every minimatch 10 release is inside GHSA-g3hv-75wg-m249. No eslint release accepts minimatch 11 yet, so a consumer that needs that alert closed overrides minimatch to 11.0.1 under `eslint`, `@eslint/config-array` and `@typescript-eslint/typescript-estree`, as config's own root manifest does; minimatch 11.0.1 in turn asks for brace-expansion ^5.0.12, which closes GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7 and GHSA-q2hr-2g5m-vwhr.

## 0.1.3

### Patch Changes

- ff7e942: The security-workflow trigger surface accepts the shared workflow at any published reference instead of `@main`: a caller's `uses` for `codeql.yml` and `scorecard.yml` is `cosyte/.github/.github/workflows/<file>@` followed by the commit a published `workflows-*` reference was cut from, or that reference's name. `@main` is now a finding, because it moves on cosyte/.github's clock rather than the caller's. The pattern is exported as `PUBLISHED_WORKFLOWS_REFERENCE`, and `SECURITY_WORKFLOW_SURFACES[...].job.uses` now names the workflow without a ref.

## 0.1.2

### Patch Changes

- bcdb7ea: The README's license line names the legal owner: "MIT, copyright Cosyte LLC." The READMEs of `@cosyte/eslint-config`, `@cosyte/process` and `@cosyte/script-utils` also use US spelling where they did not (license, behavior, generalize, recognized, honored). No code, configuration or type changes.

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

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** No CLI, verb, modifier,
  or configuration change: the six verbs, the four modifiers, the token partition and
  `cosyte-process.config.json` all behave exactly as in `0.0.2`, and the `cosyte-process` bin
  resolves to the same entry point. What moves is the version policy this package states about
  itself, and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.2` does not resolve this release and has to widen its range once.
- The `README.md` in the tarball now opens its `## Status` section on the settled-line sentence
  instead of the pre-alpha ladder one, so the policy text a consumer reads agrees with the version
  printed beside it. `scripts/readme-check.mjs` grades that sentence against the release line the
  pending changesets resolve to.

## [0.0.2] - 2026-08-13

### Added

- **A version line on the delegated verbs.** `build`, `test`, `lint`, `typecheck` and `format` print
  the single line `cosyte-process <version>` to stderr before the tool is spawned, so it precedes the
  tool's own output and names the `@cosyte/process` that produced the run. The version is read from
  this package's own manifest at run time rather than baked in, so it follows every bump. `check`
  prints no such line and stdout is untouched.

## [0.0.1] - 2026-08-13

### Added

- **First release: `cosyte-process`, the shared per-repo process scripts as one bin.** Every
  `@cosyte/*` parser repo hand-maintains the same five `package.json` scripts, the same four variant
  scripts, and the tool versions behind them. That is the same copy-per-repo shape
  `@cosyte/script-utils` removed from the PHI gate, and it costs the same way: a change to what
  `lint` means is thirteen pull requests, and the copies drift in between.

  A wired consumer's script body is exactly `cosyte-process <verb>` for `build`, `test`, `lint`,
  `typecheck` and `format`, and never changes again. What a verb runs, and which version of the tool
  runs it, moves with a version bump of this package plus `pnpm install`.

- **Six verbs and four modifiers.** `build`, `test`, `lint`, `typecheck` and `format` delegate and
  propagate the tool's exit code verbatim; `check` verifies the invoking repo's own wiring. The
  modifiers are `test --watch`, `test --coverage`, `lint --fix` and `format --check`, at most one per
  invocation.

- **A token partition, which is what makes the rest well defined.** Every invocation splits into
  tool, core, flag and glob tokens and is emitted in that order. Core tokens are the mode-selecting
  ones (`run`, `--noEmit`, `--write`) and survive everything, which is why the two substituting
  modifiers always find their target.

- **`cosyte-process.config.json`, the one place repo-specific deviation may live.** Per verb, `globs`
  replaces that verb's baseline glob tokens and `flags` replaces its flag tokens. The tool name and
  core tokens are never touched, `check` is not overridable, and a modifier composes over the
  OVERRIDDEN invocation rather than the baseline. Any schema violation makes every verb exit non-zero
  naming the file and the first violation, rather than quietly running something else.

- **The tools are dependencies of this package.** tsup, vitest with `@vitest/coverage-v8`, eslint,
  prettier and typescript resolve from here, pinned exactly, so a consumer declares none of them and
  a shared upgrade is one version bump. A tool that fails to resolve is reported as a defect in THIS
  package's install, never as a missing step in the consumer.

- **`cosyte-process check`, for consumer CI.** It grades exactly the process wiring: the five verb
  scripts, any reserved variant scripts that are present (an absent one is conforming), and the
  override file. It exits non-zero naming each violation.

- **Tested against the compatibility floor it claims.** node 22.0.x and pnpm 10.0.0, from a packed
  tarball installed into a fixture outside this workspace that pins its own
  `packageManager: pnpm@10.0.0`, so config's own pnpm pin is never involved.
