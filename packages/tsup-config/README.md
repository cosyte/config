# @cosyte/tsup-config

Shared [tsup](https://tsup.egoist.dev) build config for the `@cosyte/*` libraries: dual **ESM + CJS**
with `.d.ts`, **ES2023** target, Node platform, treeshake on, splitting off, `.mjs` / `.cjs`
out-extensions, and sourcemaps. Pair it with `@arethetypeswrong/cli` (`attw`) as a publish gate.

## Install

```sh
pnpm add -D @cosyte/tsup-config tsup
```

`tsup` is a peer dependency.

## Use

`tsup.config.ts`:

```ts
import { cosyteTsup } from "@cosyte/tsup-config";

export default cosyteTsup({ entry: ["src/index.ts"] });
```

Pass any tsup `Options` to override the baseline (e.g. multiple `entry` points). Everything else is the
enforced standard.

Part of [cosyte/config](https://github.com/cosyte/config) — one enforced toolchain for the `@cosyte/*`
suite.
