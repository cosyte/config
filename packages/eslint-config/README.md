<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/eslint-config

> The cosyte lint bar in one factory call: no `any`, no undocumented public export, no drift.

[![npm version](https://img.shields.io/npm/v/@cosyte/eslint-config.svg)](https://www.npmjs.com/package/@cosyte/eslint-config)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Shared ESLint flat config (ESLint 10 + typescript-eslint) for @cosyte/\* packages.

## Why this exists

A healthcare parser's lint rules are not style preferences. `no-explicit-any` and the cast rules are
what keep a claim about a field's type from being a guess, and a JSDoc gate on public exports is what
keeps a published API from shipping undocumented. Copied per repository, those rules get relaxed
locally to unblock a release and stay relaxed.

The nearest alternative is `eslint-config-airbnb` or a hand-rolled flat config per repo. Neither
encodes the cosyte rules, and neither closes the drift: this is a published package, so a rule added
here reaches every consumer as a version bump.

## Status

`@cosyte/eslint-config` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.

The factory signature `cosyte(tsconfigRootDir, opts?)` is settling, but the RULE SET behind it is
not: rules are added as the parsers find gaps, and a version bump can therefore red a consumer that
was passing. Pin an exact version if you need a lint run to stay green across an install.

## Install

```sh
pnpm add -D @cosyte/eslint-config eslint typescript
```

`eslint` (^9 or ^10) and `typescript` are peer dependencies. Node `>=22.14`. ESM only.

## Usage

`eslint.config.js` exports the array the factory returns:

```ts runnable
import cosyte from "@cosyte/eslint-config";

const config = cosyte(import.meta.dirname);
Array.isArray(config); // => true
```

The argument is `tsconfigRootDir`: the directory holding the `tsconfig.json` the type-checked rules
resolve against, which is why `import.meta.dirname` is the normal value. Lint at
`--max-warnings=0`, which is what every `@cosyte/*` repo's `lint` script passes.

## Entry points

| entry point             | what it is                                                                       |
| ----------------------- | -------------------------------------------------------------------------------- |
| `@cosyte/eslint-config` | the default export `cosyte(tsconfigRootDir, opts?)`, a flat-config array factory |

One entry point, so `@cosyte/eslint-config` is the only specifier a consumer ever writes.

## Overrides

The second argument is the whole override surface: `opts.ignores` appends ignore globs, `opts.files`
replaces which globs the type-checked rules apply to, and `opts.library` drops the JSDoc, `@example`
and `no-console` gates for an application. The [API](#api) below states each one's default.

Every type-safety rule (no `any`, no unjustified casts, exhaustiveness, strict imports) stays on
either way. An application has no published API surface to document and legitimately logs; it has no
licence to be less type-safe, so that half is not reachable through `opts` at all. Appending your
own config object after the factory's array is ESLint's own escape hatch and nothing here can stop
it, but a rule switched off that way is switched off in one repo while every sibling still enforces
it. Change it here and take a version bump instead.

## PHI and safety

This package is lint configuration. It reads source files to check them and never executes them, and
it sees no patient data: nothing here logs, retains or transmits anything.

The rules do carry a safety intent worth naming. `no-console` in library code is not tidiness, it is
what keeps a parser from printing a field it was handed, and the type-safety rules are what keep a
PHI-bearing field from being cast into something the compiler stops checking. The gate that actually
scans for patient data is `@cosyte/script-utils/phi-scan`, not this package.

## API

The factory is `cosyte(tsconfigRootDir, opts?)`:

- `opts.ignores`: extra ignore globs.
- `opts.files`: override which globs the type-checked rules apply to (defaults to
  `src` / `test` / `scripts` / `*.config.ts`).
- `opts.library`: defaults to `true`. Set `false` for an **application** (for example a service or
  engine) to drop the JSDoc and `@example` gate and `no-console`. Every type-safety rule (no `any`,
  no unjustified casts, exhaustiveness, strict imports) stays on either way: apps just have no
  published API surface to document and legitimately log.

```js
// An application: same type safety, no doc/console gate.
export default cosyte(import.meta.dirname, { library: false });
```

## Compatibility

ESLint 10 flat config, built on the unified `typescript-eslint` package at
`recommendedTypeChecked`, so type-aware linting needs a real `tsconfig` and the `tsconfigRootDir`
the factory takes. Tests and build scripts relax the JSDoc and console rules.
`eslint-config-prettier` is applied last, so formatting stays Prettier's job and no rule here fights
it.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a new rule needs a changeset saying what it
refuses: adding one reds every consumer that was passing without it.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
