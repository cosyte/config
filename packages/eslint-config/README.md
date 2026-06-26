# @cosyte/eslint-config

Shared ESLint flat config for the `@cosyte/*` packages: **ESLint 10** + the unified `typescript-eslint`
(`recommendedTypeChecked`), hardened with the cosyte guardrails — no `any`, no unjustified casts, a
JSDoc + `@example` gate on public exports, and `no-console` in library code. Tests and build scripts
relax the JSDoc/console rules. `eslint-config-prettier` is applied last so formatting is Prettier's job.

## Install

```sh
pnpm add -D @cosyte/eslint-config eslint typescript
```

`eslint` (^9 or ^10) and `typescript` are peer dependencies.

## Use

`eslint.config.js`:

```js
import cosyte from "@cosyte/eslint-config";

export default cosyte(import.meta.dirname);
```

The factory is `cosyte(tsconfigRootDir, opts?)`:

- `opts.ignores` — extra ignore globs.
- `opts.files` — override which globs the type-checked rules apply to (defaults to
  `src` / `test` / `scripts` / `*.config.ts`).
- `opts.library` — defaults to `true`. Set `false` for an **application** (e.g. a service or engine)
  to drop the JSDoc + `@example` gate and `no-console`. Every type-safety rule (no `any`, no
  unjustified casts, exhaustiveness, strict imports) stays on either way — apps just have no published
  API surface to document and legitimately log.

```js
// An application: same type safety, no doc/console gate.
export default cosyte(import.meta.dirname, { library: false });
```

Lint at `--max-warnings=0`.

Part of [cosyte/config](https://github.com/cosyte/config) — one enforced toolchain for the `@cosyte/*`
suite.
