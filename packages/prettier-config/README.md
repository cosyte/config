# @cosyte/prettier-config

Shared Prettier configuration for the `@cosyte/*` packages: `printWidth` 100, double quotes,
semicolons, trailing commas, `arrowParens: always`, and LF line endings.

The standard `*.md`, JSON and YAML overrides ship with it, so one dependency settles formatting for
every file type these repos track.

## Install

```sh
pnpm add -D @cosyte/prettier-config prettier
```

`prettier` is the tool this configures, so install it alongside.

## Use

In `package.json`:

```json
{ "prettier": "@cosyte/prettier-config" }
```

## Entry points

| entry point               | what it is                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- |
| `@cosyte/prettier-config` | the config object itself (`index.json`), ready for the `prettier` field above |

There is no JavaScript entry point and no runnable example below, because the package is one JSON
file a tool reads rather than a module a consumer calls.

## Overrides

Every key is overridable: Prettier has no enforcement of its own, so a divergence costs nothing but
the divergence. Point the `prettier` field at your own module and spread this one, which is the
shape Prettier supports for extending a shared config:

```js
// prettier.config.js
import cosyte from "@cosyte/prettier-config" with { type: "json" };

export default { ...cosyte, printWidth: 80 };
```

Prefer changing it here and taking a version bump. A per-repo override is a formatting dialect, and
the point of a shared config is that there is one.

Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the `@cosyte/*`
suite.
