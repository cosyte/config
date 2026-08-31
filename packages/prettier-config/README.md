<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/prettier-config

> One formatter setting sheet for every cosyte repository, adopted in a single line.

[![npm version](https://img.shields.io/npm/v/@cosyte/prettier-config.svg)](https://www.npmjs.com/package/@cosyte/prettier-config)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Shared Prettier configuration for @cosyte/\* packages.

## Why this exists

Formatting is the one thing a code review should never be about, and a per-repo `.prettierrc` makes
it about that anyway: two repositories disagree by one setting, a contributor moves between them,
and every diff carries reformatting noise that hides the change.

The nearest alternative is committing the same `.prettierrc` everywhere. That is the drift this
removes: adopting the settings is one `package.json` field, and changing them is a version bump
rather than ten pull requests.

## Status

`@cosyte/prettier-config` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.

Still moving: the `printWidth` and the per-filetype overrides. Both are the kind of setting that
reformats an entire repository when it changes, so a consumer that cares should pin an exact version
and take the reformat deliberately.

## Install

```sh
pnpm add -D @cosyte/prettier-config prettier
```

`prettier` is a peer dependency. Node `>=22.14`. The package ships one JSON file and no code.

## Usage

In `package.json`:

```json
{ "prettier": "@cosyte/prettier-config" }
```

Then format and check as usual:

```sh
pnpm exec prettier --write "**/*.{js,mjs,ts,json,md,yml,yaml}"
pnpm exec prettier --check "**/*.{js,mjs,ts,json,md,yml,yaml}"
```

Keep the two globs identical. A `--write` that covers a file `--check` does not is a formatting
violation that can never fail CI, which is how a repository ends up with a green check over files
nobody reads.

## PHI and safety

This package is formatter configuration. It contains no code, reads no input, and never sees patient
data: it is one JSON file Prettier reads. Nothing here logs, retains or transmits anything.

## Compatibility

`printWidth` 100, double quotes, semicolons, trailing commas, `arrowParens: always`, and LF line
endings, with the standard `*.md`, JSON and YAML overrides. `proseWrap` is `preserve`, so Prettier
reflows no prose: a markdown line stays where its author put it.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to a setting here needs a changeset
saying what moved: every consumer reformats on the version bump.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
