# @cosyte/vitest-config

Shared [Vitest](https://vitest.dev) config for the `@cosyte/*` packages: v8 coverage with the
standard reporters and excludes, and enabled, gating per-directory thresholds at >= 90.

The excludes are the ones that would otherwise inflate a score for free: barrels, fixtures,
generated code and declarations. A second entry point, `/snippets`, executes the examples in a
package's documentation against its code.

## Install

```sh
pnpm add -D @cosyte/vitest-config vitest @vitest/coverage-v8 vite
```

`vitest`, `@vitest/coverage-v8` and `vite` are peer dependencies. Install `vite` explicitly: Vitest
4 needs `vite` >= 6, and without a direct declaration a resolver will happily keep an incompatible
vite 5 that some other dependency asked for.

## Use

`vitest.config.ts`:

```ts runnable
import { cosyteVitest } from "@cosyte/vitest-config";

const { thresholds } = cosyteVitest({ coverageDirs: ["parser", "model"] }).test.coverage;
thresholds.lines; // => 90
thresholds["src/parser/**"].lines; // => 90
```

Each entry in `coverageDirs` adds a per-directory `src/<dir>/**` gate at >= 90 on top of the global
gate, which is what stops a well-covered helper directory paying for an untested parser.

## Entry points

| entry point                      | what it is                                                          |
| -------------------------------- | ------------------------------------------------------------------- |
| `@cosyte/vitest-config`          | the `cosyteVitest(opts?)` factory, returning a Vitest config object |
| `@cosyte/vitest-config/snippets` | the doc/code-agreement harness described below                      |

### `@cosyte/vitest-config/snippets`: doc/code agreement

The `/snippets` subpath is the documentation analog of the conformance runners: it proves the
examples in a package's documentation still do what the prose claims. A copy-pasteable snippet that
silently returns the wrong field (a dose, a code, an identifier) is a clinical-harm failure mode
wearing a documentation costume, so a green docs build carrying a wrong snippet is exactly what this
prevents.

Mark a fenced block opt-in with ` ```ts runnable ` and assert its output inline with `// =>`:

````md
```ts runnable
import { parseHl7 } from "@cosyte/hl7";

const { warnings } = parseHl7(raw);
warnings.length; // => 0
```
````

`docSnippetSuite()` walks a docs directory, turns each runnable block into a Vitest `test` labelled
by file and line, compiles it, and executes it: a line of the form `<expr>; // => <value>` becomes
`expect(<expr>).toStrictEqual(<value>)`. A block tagged ` ```ts runnable throws ` must throw
instead.

**Where the tag goes in this repository, and where it deliberately does not.** The `## Use` section
holds the example a consumer copies, so when that example is TypeScript or JavaScript it carries the
tag and runs on every `pnpm test`. A script block anywhere else illustrates a pattern rather than
being the documented way to consume the package: an anti-example, a fragment with no imports, or an
integration written against a parser package this repo does not contain, none of which can be
executed here without asserting something untrue. `test/package-docs.test.ts` enforces that split
instead of trusting it, and refuses an untagged TypeScript or JavaScript block inside a `## Use`
section by file and line.

```ts
// test/docs-content.test.ts
import { join } from "node:path";
import { docSnippetSuite } from "@cosyte/vitest-config/snippets";

docSnippetSuite({
  docsDir: join(import.meta.dirname, "..", "docs-content"),
  // Point a snippet's `import ... from "@cosyte/hl7"` at what you want to prove against. This repo's
  // source for a fast local gate, or `../dist/index.js` (after `pnpm build`) for artifact fidelity.
  resolve: (spec) =>
    spec === "@cosyte/hl7" ? join(import.meta.dirname, "..", "src", "index.ts") : undefined,
});
```

The primitives are exported too, for bespoke wiring. `extractRunnableSnippets` is the one that
decides what runs, and it reports each block's 1-based first code line so a failure points at the
snippet rather than at the fence:

```ts runnable
import { extractRunnableSnippets } from "@cosyte/vitest-config/snippets";

const fence = "`".repeat(3);
const doc = ["# Title", "", fence + "ts runnable", "const dose = 5;", fence].join("\n");
extractRunnableSnippets(doc).length; // => 1
extractRunnableSnippets(doc)[0].line; // => 4
```

`rewriteAssertions`, `remapImports` and `runSnippet` are the remaining three, in the order
`docSnippetSuite` applies them.

> `runSnippet` writes a transient `.ts` module under `tmpDir` (default `.cosyte-doc-snippets/` in
> the project root) and imports it so Vitest transforms the TypeScript: add `.cosyte-doc-snippets*/`
> to `.gitignore`. It must stay inside the project root, because files under `node_modules` are not
> transformed.

## Overrides

Both entry points are configured entirely through their arguments, and neither enforces anything a
consumer cannot reach:

- `cosyteVitest` takes `coverageThresholds` to add or override specific coverage keys, and `test`
  for any other Vitest option. Both are merged last, so a repo that genuinely cannot hold >= 90 in
  one directory lowers that one key rather than abandoning the config.
- `docSnippetSuite` takes `docsDir` or `files`, `include` (default `.md` and `.mdx`), `resolve`,
  `runnableTag` (default `"runnable"`), `name`, `requireSnippet` and `tmpDir`.

A package with no runnable snippets yields an empty, passing suite unless `requireSnippet` is set:
absence degrades quietly, a _wrong_ snippet fails loudly. Lowering a coverage threshold is the
override worth arguing about in review, because unlike the others it changes what CI will let
through.

Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the `@cosyte/*`
suite.
