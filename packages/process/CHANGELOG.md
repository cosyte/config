# Changelog

All notable changes to `@cosyte/process` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically.

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
