# @cosyte/vitest-config

Shared [Vitest](https://vitest.dev) config for the `@cosyte/*` packages: v8 coverage with
`text` / `html` / `lcov` reporters, the standard excludes (barrels, fixtures, generated code,
declarations), and **enabled, gating** per-directory thresholds at **>= 90**.

## Install

```sh
pnpm add -D @cosyte/vitest-config vitest @vitest/coverage-v8
```

`vitest` and `@vitest/coverage-v8` are peer dependencies.

## Use

`vitest.config.ts`:

```ts
import { cosyteVitest } from "@cosyte/vitest-config";

export default cosyteVitest({
  coverageDirs: ["parser", "model", "serialize", "helpers"],
});
```

Each entry in `coverageDirs` adds a per-directory `src/<dir>/**` gate at >= 90 on top of the global
gate. Use `coverageThresholds` to add or override specific keys, and `test` for any other Vitest
options.

Part of [cosyte/config](https://github.com/cosyte/config) — one enforced toolchain for the `@cosyte/*`
suite.
