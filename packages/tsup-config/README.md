<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/tsup-config

> One dual-format build baseline, so every Cosyte library packs the same way.

[![npm version](https://img.shields.io/npm/v/@cosyte/tsup-config.svg)](https://www.npmjs.com/package/@cosyte/tsup-config)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Shared tsup build config (dual ESM + CJS, ES2023) for @cosyte/\* libraries.

## Why this exists

Dual-format publishing is where a library quietly breaks: the ESM build resolves, the CJS build does
not, the `.d.ts` files point at the wrong one, and nobody finds out until a consumer on the other
module system installs it. Getting that right once and copying the config into ten repositories means
getting it wrong in nine of them eventually.

The nearest alternative is a hand-written `tsup.config.ts` per repository. This is the same baseline
as a published package instead, so a fix to the out-extension or the target reaches every library
that uses it as a version bump.

## Status

`@cosyte/tsup-config` is on the Cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

Still moving: the compile target and the treeshake and splitting settings, all three of which change
what a consumer's published artifact looks like. The `cosyteTsup(options)` shape itself is the part
least likely to move.

## Install

```sh
pnpm add -D @cosyte/tsup-config tsup
```

`tsup` (8 or 9) is a peer dependency. Node `>=22.14`; tsup 9 itself needs 22.18 or later. ESM
only.

## Usage

`tsup.config.ts` is one call, and `entry` is the one option every consumer supplies, because only
the package knows what it builds:

```ts runnable
import { cosyteTsup } from "@cosyte/tsup-config";

const config = cosyteTsup({ entry: ["src/index.ts"] });
config.format; // => ["esm", "cjs"]
config.outExtension({ format: "esm" }); // => { js: ".mjs" }
```

Export that object as the file's default (`export default cosyteTsup({ entry: ["src/index.ts"] })`)
and everything else is the enforced standard.

Pair it with `@arethetypeswrong/cli` (`attw`) as a publish gate. A dual build that emits the wrong
declaration for one of its two module systems still packs and still publishes; `attw` is what turns
that into a red before it reaches npm.

## Entry points

| entry point           | what it is                                                           |
| --------------------- | -------------------------------------------------------------------- |
| `@cosyte/tsup-config` | the `cosyteTsup(overrides?)` factory, returning a tsup config object |

One entry point, so `@cosyte/tsup-config` is the only specifier a consumer ever writes.

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

## Code splitting and `plainCjsExports`

Turn `plainCjsExports` on whenever you turn `splitting` on, so that two entry points share one copy
of a module (one error class, one piece of state) instead of each bundling its own:

```ts
export default cosyteTsup({
  entry: { index: "src/index.ts", parse: "src/parse.ts" },
  splitting: true,
  plainCjsExports: true,
});
```

With `splitting` on, tsup has rollup write each CommonJS entry point on its own, and rollup
re-exports what the shared chunk holds as getters that cannot be redefined. A caller who stubs an
export (`jest.spyOn(lib, "parse")`, `vi.spyOn`) or assigns to one in strict mode gets a
`TypeError`, where a one-file build gave them writable data properties. `plainCjsExports` rewrites
the export block at the end of each CommonJS entry point back into those data properties once tsup
has written it, so the CommonJS exports look the same as a one-file build's. The ESM output is not
touched.

It rewrites a getter only when it reads a chunk the same build wrote, and only when that chunk
exports the binding as a plain value it never reassigns, so the copy is the value the getter would
have returned. Anything else fails the build rather than ship a getter:

- a star re-export of a module the build leaves external (`export * from "node:path"`), which
  rollup writes as getters inside a loop;
- a named re-export of a module the build leaves external, and a re-exported `let` the shared chunk
  reassigns, since a copy would not follow either;
- any other getter, `defineProperty` on `exports`, `exports` passed whole to a function, or
  `module.exports` in an entry point, and an export block that does not end the file.

An export name that is not an identifier, `__proto__` among them, is defined with
`Object.defineProperty`, so no name can set the module's prototype.

The option needs the baseline's `treeshake: true`, which is what makes rollup write the CommonJS
output this reads. It adds a tsup plugin after any `plugins` you pass. Leave it off for a one-file
build: its exports are already data properties, except a re-export of an external package, which
rollup writes as a getter in either build and the option would refuse.

## PHI and safety

This package is build configuration. It shapes how a library is compiled and packed, reads no
runtime input, and never sees patient data: nothing here logs, retains or transmits anything.

## Compatibility

Dual **ESM + CJS** with `.d.ts`, **ES2023** target, Node platform, treeshake on, splitting off,
`.mjs` and `.cjs` out-extensions, and sourcemaps. `plainCjsExports` is off unless you turn it on. The out-extensions are deliberate: they make each
artifact's module system explicit in its filename rather than dependent on the nearest
`package.json` `type` field.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to the baseline needs a changeset
saying what moved: it changes the artifact every consumer publishes.

## License

MIT, copyright Cosyte LLC. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
