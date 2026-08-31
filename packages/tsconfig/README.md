# @cosyte/tsconfig

Shared TypeScript configuration for the `@cosyte/*` packages: strict, `ES2023`, `NodeNext`, and the
full rigor set.

`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and
the rest are on, so a parser cannot index into an array and read the result as defined, and cannot
reach a field the type never promised.

## Install

```sh
pnpm add -D @cosyte/tsconfig typescript
```

`typescript` is the compiler this configures, so install it alongside.

## Use

`tsconfig.json`, for type-checking (set your own `include`, and your own `outDir` if you emit):

```jsonc
{
  "extends": "@cosyte/tsconfig/base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"],
}
```

`tsconfig.build.json`, for emitting a publishable library:

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

Both are JSON files the compiler reads, so neither carries a runnable example below.

## Overrides

Anything in `compilerOptions` is overridable by declaring it again in the extending file, which is
how `outDir`, `rootDir`, `noEmit` and `include` are meant to be set. TypeScript resolves the nearest
declaration, so your value wins over the one inherited from here.

Turning a rigor flag back off is the one override to think twice about. It is not blocked, and
nothing here can block it, but it silently widens what every downstream `@cosyte/*` consumer of your
types is allowed to assume. Change it here and take a version bump instead, so the whole suite moves
together.

Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the `@cosyte/*`
suite.
