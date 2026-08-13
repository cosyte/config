---
"@cosyte/process": patch
---

First release of `@cosyte/process`: the shared per-repo process scripts for the `@cosyte/*` repos,
behind one `cosyte-process` bin.

Every parser repo hand-maintains the same five `package.json` scripts, the same variant scripts, and
the tool versions behind them, which is the copy-per-repo shape `@cosyte/script-utils` already
removed from the PHI gate. A wired consumer's script body becomes exactly `cosyte-process <verb>` for
`build`, `test`, `lint`, `typecheck` and `format`, and never changes again; what a verb runs, and at
which tool version, moves with a version bump of this package plus `pnpm install`.

The five delegated verbs propagate the tool's exit code verbatim. `cosyte-process check` grades the
invoking repo's own wiring for CI. Repo-specific deviation lives in `cosyte-process.config.json` and
nowhere else: per verb, `globs` and `flags` replace those token classes of the baseline, while the
tool name and the mode-selecting core tokens are never touched. tsup, vitest with
`@vitest/coverage-v8`, eslint, prettier and typescript are dependencies of this package and resolve
from it, so a wired consumer declares none of them.
