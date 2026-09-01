<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/process

> Five script bodies you never edit again, and the tool versions behind them.

[![npm version](https://img.shields.io/npm/v/@cosyte/process.svg)](https://www.npmjs.com/package/@cosyte/process)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

The shared per-repo process scripts for @cosyte/\* repos: one `cosyte-process` bin behind build, test, lint, typecheck, format and check.

## Why this exists

Every parser repo hand-maintains the same five `package.json` scripts, plus a handful of variants,
plus the tool versions behind them. Sharing the CONFIG files still leaves the invocations copied, so
a repo can be on the shared ESLint config and a two-year-old ESLint, and the difference is invisible
until a rule behaves differently in one repository.

The nearest alternative is a shared config package plus hand-written scripts, which is where this
estate already was. `@cosyte/process` is the single source of truth for all of it: a consumer's
script body becomes `cosyte-process <verb>` and never changes again, and a shared change to what a
verb does, or to which version of a tool runs it, arrives as a version bump of this package and
`pnpm install`.

## Status

`@cosyte/process` is on the cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

Still moving: the verb set itself (which verbs exist, and what each one invokes) and the override
file's schema. Both are consumer-visible in a way a version bump can break, because a changed
invocation runs different tooling over the same source. The five delegating script bodies are the
part designed never to move.

## Install

```sh
pnpm add -D @cosyte/process
```

Nothing else. The tools the verbs run (tsup, vitest and its `@vitest/coverage-v8` provider, eslint,
prettier, typescript) are dependencies of this package and resolve from it. A wired consumer declares
**no direct devDependency** on any of them. Node `>=22.0.0`. ESM only.

## Usage

Five scripts, each body exactly the delegation:

```json
{
  "scripts": {
    "build": "cosyte-process build",
    "test": "cosyte-process test",
    "lint": "cosyte-process lint",
    "typecheck": "cosyte-process typecheck",
    "format": "cosyte-process format"
  }
}
```

Four **reserved variant** script names exist. Carry any subset of them, including none; each one you
do carry has exactly this body:

```json
{
  "scripts": {
    "test:watch": "cosyte-process test --watch",
    "test:coverage": "cosyte-process test --coverage",
    "lint:fix": "cosyte-process lint --fix",
    "format:check": "cosyte-process format --check"
  }
}
```

Script bodies are never edited per repo. If a repo needs something different, that is what the
override file below is for.

## Entry points

| entry point       | what it is                                                                       |
| ----------------- | -------------------------------------------------------------------------------- |
| `cosyte-process`  | the bin, which is how a wired repo consumes this package                         |
| `@cosyte/process` | the same contract programmatically: the baseline, the verbs and the wiring check |

The bin is the product; the module entry point exists so that the wiring check, the tests and any
future tooling read the contract from one place instead of restating it:

```ts runnable
import { BASELINE, expectedScriptBody, toArgv, VERBS } from "@cosyte/process";

toArgv(BASELINE.typecheck); // => ["tsc", "--noEmit"]
expectedScriptBody("build"); // => "cosyte-process build"
VERBS.includes("check"); // => true
```

Nothing on that entry point has side effects, so importing it never runs a tool.

## Overrides

Repo-specific deviation lives in one file, `cosyte-process.config.json`, at the repo root:

```json
{
  "lint": { "globs": ["src/**/*.ts", "bin/**/*.ts"] },
  "test": { "flags": ["--reporter=dot"] }
}
```

The rules, in full:

- Top-level keys are verb names, among `build`, `test`, `lint`, `typecheck`, `format`. `check` is
  never overridable.
- Each value is an object with optional `globs` and optional `flags`, each an array of strings.
- `globs` replaces that verb's baseline glob tokens; `flags` replaces its baseline flag tokens. An
  absent key keeps the baseline tokens.
- The tool name and the core tokens are never added, removed, replaced or reordered. A `test` flags
  override of `["--coverage"]` yields `vitest run --coverage`, never `vitest --coverage`.
- No other keys at either level.

Any violation makes **every** verb exit non-zero, naming the file and the first violation, rather
than silently running something else.

One common reason to reach for this: the baseline `format` globs name `src/`, `test/`, `scripts/` and
the repo root. `prettier` fails on a pattern that matches nothing, so a repo with no `scripts/`
directory overrides `format`'s `globs` rather than creating an empty directory. (`lint` carries
`--no-error-on-unmatched-pattern` and needs no such care.)

## PHI and safety

This package runs your build, test, lint, typecheck and format tools. It processes no patient data
itself: it does not read your source as data, and it neither logs, retains nor transmits anything of
its own.

What it does do is spawn tools whose output goes to your terminal and to your CI log, so anything a
test or a compiler prints is printed by the underlying tool, unchanged and unfiltered by this
package. That is the consumer's surface to keep clean: a test that prints patient data prints it into
CI, whichever runner invoked it.

## API

### What each verb runs

Absent an override, each verb executes exactly this in the invoking repo's working directory, and
exits with the tool's own exit code:

| verb        | invocation                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `build`     | `tsup`                                                                                                   |
| `test`      | `vitest run`                                                                                             |
| `lint`      | `eslint --max-warnings=0 --no-error-on-unmatched-pattern "src/**/*.ts" "scripts/**/*.ts" "test/**/*.ts"` |
| `typecheck` | `tsc --noEmit`                                                                                           |
| `format`    | `prettier --write "src/**/*.{ts,md}" "test/**/*.ts" "scripts/**/*.{ts,mjs}" "*.{json,md,yml}"`           |
| `check`     | nothing: it verifies this repo's own wiring (see below)                                                  |

Your tool config files stay yours. `tsup.config.ts`, `eslint.config.js`, `vitest.config.ts`,
`tsconfig.json` and the `prettier` field in your `package.json` live in your repo and are what these
invocations pick up. What this package owns is which tool runs, at which version, with which
arguments.

### The token partition

Every invocation splits into four parts, and the split is what the modifiers and the override file
are defined against:

| verb        | tool       | core tokens | flag tokens                                          | glob tokens        |
| ----------- | ---------- | ----------- | ---------------------------------------------------- | ------------------ |
| `build`     | `tsup`     |             |                                                      |                    |
| `test`      | `vitest`   | `run`       |                                                      |                    |
| `lint`      | `eslint`   |             | `--max-warnings=0` `--no-error-on-unmatched-pattern` | the three patterns |
| `typecheck` | `tsc`      | `--noEmit`  |                                                      |                    |
| `format`    | `prettier` | `--write`   |                                                      | the four patterns  |

An invocation is always emitted in that order: **tool, core, flags, globs.** Core tokens are the
mode-selecting ones, and they survive everything.

### Modifiers

Exactly four exist, at most one per invocation:

| invocation                       | effect                                           |
| -------------------------------- | ------------------------------------------------ |
| `cosyte-process test --watch`    | replaces the core token `run` with `watch`       |
| `cosyte-process test --coverage` | appends `--coverage` after the flag tokens       |
| `cosyte-process lint --fix`      | appends `--fix` after the flag tokens            |
| `cosyte-process format --check`  | replaces the core token `--write` with `--check` |

A modifier composes over the **effective** invocation: the baseline as your override file has already
adjusted it. With a `globs` override on `lint`, `lint --fix` fixes your globs, not the baseline ones.

### `cosyte-process check`

Run it in CI. It exits 0 when this repo's process wiring conforms:

- the five verb scripts are present and delegate exactly as above,
- every reserved variant script that is present delegates exactly as above (absent ones are fine),
- `cosyte-process.config.json` is absent or valid.

Otherwise it exits non-zero and names each violation. That scope, the five scripts, any present
reserved variants, and the override file, is exactly what "process wiring" means here; nothing else
in your `package.json` is graded.

```json
{
  "scripts": {
    "check:process": "cosyte-process check"
  }
}
```

### Updating

A shared-process change reaches a wired consumer as a dependency version bump plus `pnpm install`.
There is no other consumer-side edit for the five verbs: not to a script body, not to a tool version,
not to a config file. If a change to this package would require one, that is a bug in the change.

## Compatibility

Node `>=22.0.0` and pnpm `10.0.0` are the floor, which is what the consumer repos declare. The
package is tested against exactly that floor, installed from a packed tarball into a fixture outside
this workspace.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to a verb's invocation or to the
override schema needs a changeset saying what moved: it changes what runs in every wired consumer.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
