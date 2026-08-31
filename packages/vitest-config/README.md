<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/vitest-config

> Gating coverage thresholds by default, plus a suite that runs the examples in your docs.

[![npm version](https://img.shields.io/npm/v/@cosyte/vitest-config.svg)](https://www.npmjs.com/package/@cosyte/vitest-config)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Shared Vitest config (v8 coverage, per-directory >=90 gates) for @cosyte/\* packages.

## Why this exists

Coverage that is reported but not gated is a number nobody acts on, and a repo-wide threshold hides
the one directory that has none: a package can sit at 92% overall while its serializer is at 40%.
The cosyte baseline gates per directory, and it ships enabled rather than as a setting each repo
remembers to switch on.

The nearest alternative is a hand-written `vitest.config.ts` per repository with `coverage.thresholds`
copied in. That is the drift this removes, and it is also where the second half of this package comes
from: nothing in that alternative proves the examples in your documentation still work.

## Status

`@cosyte/vitest-config` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.

Still moving: the coverage exclude list and the snippet-suite options (`runnableTag`, `resolve`,
`requireSnippet`), which have changed shape as the first consumers adopted them. The 90 threshold and
the `cosyteVitest(options)` signature are the settled-looking parts, but they are not covered by a
stability promise at `0.0.x`.

## Install

```sh
pnpm add -D @cosyte/vitest-config vitest @vitest/coverage-v8 vite
```

`vitest`, `@vitest/coverage-v8`, and `vite` are peer dependencies. Install `vite` explicitly:
Vitest 4 requires major version 6 or later, and without a direct declaration the resolver will
happily keep an incompatible vite 5. Node `>=22.14`. ESM only.

## Usage

`vitest.config.ts` exports what the factory returns:

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
| `@cosyte/vitest-config/snippets` | the doc/code-agreement harness described under the API below        |

They are separate subpaths because they are separately adoptable, and importing the config never
loads the harness. `extractRunnableSnippets` is the primitive that decides what runs, and it reports
each block's 1-based first code line so a failure points at the snippet rather than at the fence:

```ts runnable
import { extractRunnableSnippets } from "@cosyte/vitest-config/snippets";

const fence = "`".repeat(3);
const doc = ["# Title", "", fence + "ts runnable", "const dose = 5;", fence].join("\n");
extractRunnableSnippets(doc).length; // => 1
extractRunnableSnippets(doc)[0].line; // => 4
```

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

## PHI and safety

This package is test configuration. It processes no patient data: it configures a test runner and,
through `/snippets`, compiles and executes the code blocks you point it at.

Two consequences worth stating plainly, because `/snippets` does run code. It executes the snippets
in your own documentation, in your own process, so a documentation example must never contain real
patient data: it would then be executed, and it is already committed. And the transient module
`runSnippet` writes is written under your project root, so a snippet's inputs land on disk exactly as
a test fixture's would. Use synthetic data in documentation, as in tests.

## API

### `cosyteVitest(options)`

The baseline config: v8 coverage with `text` / `html` / `lcov` reporters, the standard excludes
(barrels, fixtures, generated code, declarations), and **enabled, gating** per-directory thresholds
at **>= 90**.

### Doc/code agreement: `@cosyte/vitest-config/snippets`

The `/snippets` subpath is the **documentation analog of the conformance runners**: it proves the
examples in a package's `docs-content/` still do what the prose claims. A copy-pasteable snippet that
silently returns the wrong field (a dose, a code, an identifier) is a clinical-harm failure mode
wearing a documentation costume, so a green docs build carrying a wrong snippet is exactly what this
prevents.

Mark a fenced block **opt-in** with ` ```ts runnable ` and assert its output inline with `// =>`:

````md
```ts runnable
import { parseHl7 } from "@cosyte/hl7";

const { warnings } = parseHl7(raw);
warnings.length; // => 0
```
````

`docSnippetSuite()` walks a docs directory, turns each runnable block into a Vitest `test` labelled by
file and line, compiles it, and executes it: a line of the form `<expr>; // => <value>` becomes
`expect(<expr>).toStrictEqual(<value>)`. A block tagged ` ```ts runnable throws ` must throw instead.

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

Options: `docsDir` / `files`, `include` (default `.md` / `.mdx`), `resolve` (import-specifier
remapper), `runnableTag` (default `"runnable"`), `name`, `requireSnippet`, `tmpDir`. A package with no
runnable snippets yields an empty, passing suite: absence degrades quietly; a _wrong_ snippet fails
loudly. The primitives (`extractRunnableSnippets`, `rewriteAssertions`, `remapImports`, `runSnippet`)
are exported too, for bespoke wiring.

> `runSnippet` writes a transient `.ts` module under `tmpDir` (default `.cosyte-doc-snippets/` in the
> project root) and imports it so Vitest transforms the TypeScript: add `.cosyte-doc-snippets*/` to
> `.gitignore`. It must stay inside the project root; files under `node_modules` are not transformed.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to the thresholds or the excludes needs
a changeset saying what moved: it can red a consumer that was passing.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
