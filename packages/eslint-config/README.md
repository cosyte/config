# @cosyte/eslint-config

Shared ESLint flat config for the `@cosyte/*` packages: ESLint 10 plus the unified
`typescript-eslint` on `recommendedTypeChecked`, hardened with the cosyte guardrails.

No `any`, no unjustified casts, a JSDoc and `@example` gate on public exports, and `no-console` in
library code. Tests and build scripts relax the JSDoc and console rules, and
`eslint-config-prettier` is applied last so formatting stays Prettier's job.

## Install

```sh
pnpm add -D @cosyte/eslint-config eslint typescript
```

`eslint` (`^9` or `^10`) and `typescript` are peer dependencies. `typescript` is not optional: the
type-checked rules need a program to ask.

## Use

`eslint.config.js`:

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

## Overrides

The second argument is the whole override surface:

- `opts.ignores`: extra ignore globs, appended to the baseline.
- `opts.files`: replaces which globs the type-checked rules apply to. Defaults to `src`, `test`,
  `scripts` and `*.config.ts`.
- `opts.library`: defaults to `true`. Set it `false` for an application (a service or an engine) to
  drop the JSDoc and `@example` gate and `no-console`.

```js
// An application: same type safety, no doc or console gate.
export default cosyte(import.meta.dirname, { library: false });
```

Every type-safety rule (no `any`, no unjustified casts, exhaustiveness, strict imports) stays on
either way. An application has no published API surface to document and legitimately logs; it has no
licence to be less type-safe, so that half is not overridable through `opts` at all. Appending your
own config object after the factory's array is ESLint's own escape hatch and nothing here can stop
it, but a rule switched off that way is switched off in one repo while every sibling still enforces
it. Change it here and take a version bump instead.

Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the `@cosyte/*`
suite.
