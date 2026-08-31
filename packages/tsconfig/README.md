<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/tsconfig

> Two TypeScript configs, one strictness bar, no per-repo copy to drift.

[![npm version](https://img.shields.io/npm/v/@cosyte/tsconfig.svg)](https://www.npmjs.com/package/@cosyte/tsconfig)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Shared TypeScript configuration for @cosyte/\* packages.

## Why this exists

A `tsconfig.json` copied into ten repositories is ten strictness bars. One of them relaxes
`exactOptionalPropertyTypes` to unblock a release, the relaxation stays, and two packages now
disagree about what their types promise.

The nearest alternative is a template file the scaffolder copies, and it is not this: fixing a
template fixes no repository that already exists. This is a published package, so raising the bar
reaches every consumer as a version bump and `pnpm install`.

## Status

`@cosyte/tsconfig` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.

The two config names (`base.json`, `library.json`) are stable in practice, but the option set inside
them is not: compiler options are added as TypeScript ships them and as the parsers find gaps, and
each addition can red a consumer's build. Pin an exact version if that matters to you.

## Install

```sh
pnpm add -D @cosyte/tsconfig typescript
```

`typescript` is a peer dependency. Node `>=22.14`. The package ships two JSON files and no code.

## Usage

Two configs:

- **`base.json`**: the type-check baseline (no emit). Extend this for `tsc --noEmit`.
- **`library.json`**: `base.json` plus declaration and sourcemap emit, for building a publishable library.

`tsconfig.json` (type-check, set your own `outDir` / `noEmit` / `include`):

```jsonc
{
  "extends": "@cosyte/tsconfig/base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"],
}
```

`tsconfig.build.json` (emit a library):

```jsonc
{
  "extends": "@cosyte/tsconfig/library.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
}
```

## Entry points

Two configs, and the root specifier `@cosyte/tsconfig` deliberately resolves to neither: a
`tsconfig.json` names the file it extends, so each one is reached by its own subpath.

| entry point                     | what it is                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `@cosyte/tsconfig/base.json`    | the type-check baseline, no emit. Extend this for `tsc --noEmit`              |
| `@cosyte/tsconfig/library.json` | `base.json` plus declaration and sourcemap emit, for building a published lib |

Both are JSON files the compiler reads, so neither carries an example this repository's test run
executes: there is nothing to call.

## Overrides

Anything in `compilerOptions` is overridable by declaring it again in the extending file, which is
how `outDir`, `rootDir`, `noEmit` and `include` are meant to be set. TypeScript resolves the nearest
declaration, so your value wins over the one inherited from here.

Turning a rigor flag back off is the one override to think twice about. It is not blocked, and
nothing here can block it, but it silently widens what every downstream `@cosyte/*` consumer of your
types is allowed to assume. Change it here and take a version bump instead, so the whole suite moves
together.

## PHI and safety

This package is build configuration. It contains no code, reads no input, and never sees patient
data: it is two JSON files the TypeScript compiler reads. Nothing here logs, retains or transmits
anything.

## Compatibility

Strict, `ES2023`, `NodeNext`, with the full rigor set (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, and more). `NodeNext` module
resolution means a consumer needs a TypeScript new enough to understand it, and dual-published
packages should verify their emitted types with `@arethetypeswrong/cli`.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to this package needs a changeset
saying what moved: a compiler option added here reds every consumer that was passing without it.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
