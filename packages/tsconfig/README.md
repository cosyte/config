# @cosyte/tsconfig

Shared TypeScript configuration for the `@cosyte/*` packages — strict, `ES2023`, `NodeNext`, with the
full rigor set (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, and more).

Two configs:

- **`base.json`** — the type-check baseline (no emit). Extend this for `tsc --noEmit`.
- **`library.json`** — `base.json` plus declaration/sourcemap emit, for building a publishable library.

## Install

```sh
pnpm add -D @cosyte/tsconfig typescript
```

## Use

`tsconfig.json` (type-check — set your own `outDir` / `noEmit` / `include`):

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

Part of [cosyte/config](https://github.com/cosyte/config) — one enforced toolchain for the `@cosyte/*`
suite.
