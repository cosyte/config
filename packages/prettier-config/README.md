# @cosyte/prettier-config

Shared Prettier configuration for the `@cosyte/*` packages: `printWidth` 100, double quotes,
semicolons, trailing commas, `arrowParens: always`, and LF line endings, with the standard
`*.md` / JSON / YAML overrides.

## Install

```sh
pnpm add -D @cosyte/prettier-config prettier
```

## Use

In `package.json`:

```json
{ "prettier": "@cosyte/prettier-config" }
```

Part of [cosyte/config](https://github.com/cosyte/config) — one enforced toolchain for the `@cosyte/*`
suite.
