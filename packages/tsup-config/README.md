# @cosyte/tsup-config

Shared [tsup](https://tsup.egoist.dev) build config for the `@cosyte/*` libraries: dual ESM plus CJS
with `.d.ts`, an `ES2023` target, Node platform, treeshake on and splitting off.

Sourcemaps are on, the out-extensions are `.mjs` and `.cjs`, and `node_modules` is never bundled.
Pair it with `@arethetypeswrong/cli` (`attw`) as a publish gate, which is what catches a dual-format
package whose types resolve to the wrong half.

## Install

```sh
pnpm add -D @cosyte/tsup-config tsup
```

`tsup` is a peer dependency: this package configures it and never pulls its own copy in.

## Use

`tsup.config.ts`:

```ts runnable
import { cosyteTsup } from "@cosyte/tsup-config";

const config = cosyteTsup({ entry: ["src/index.ts"] });
config.format; // => ["esm", "cjs"]
config.outExtension({ format: "esm" }); // => { js: ".mjs" }
```

`entry` is the one option every consumer supplies, because only the package knows what it builds.

## Entry points

| entry point           | what it is                                                           |
| --------------------- | -------------------------------------------------------------------- |
| `@cosyte/tsup-config` | the `cosyteTsup(overrides?)` factory, returning a tsup config object |

## Overrides

Anything in tsup's own `Options` can be passed to `cosyteTsup` and is merged over the baseline, so
adding a second entry point or switching a format off is one argument:

```ts
export default cosyteTsup({
  entry: ["src/index.ts", "src/perf/index.ts"],
  sourcemap: false,
});
```

The merge is shallow and the overrides win, so nothing here is unreachable. That is deliberate: a
build config that cannot be adjusted per package is one a package works around by not using it. The
baseline is what you get for free, not what you are held to.

Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the `@cosyte/*`
suite.
