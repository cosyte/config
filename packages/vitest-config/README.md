# @cosyte/vitest-config

Shared [Vitest](https://vitest.dev) config for the `@cosyte/*` packages: v8 coverage with
`text` / `html` / `lcov` reporters, the standard excludes (barrels, fixtures, generated code,
declarations), and **enabled, gating** per-directory thresholds at **>= 90**.

## Install

```sh
pnpm add -D @cosyte/vitest-config vitest @vitest/coverage-v8 vite
```

`vitest`, `@vitest/coverage-v8`, and `vite` are peer dependencies (Vitest 4 needs `vite` >= 6 — install
it explicitly so the resolver doesn't keep an incompatible vite 5).

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

## Doc/code agreement — `@cosyte/vitest-config/snippets`

The `/snippets` subpath is the **documentation analog of the conformance runners**: it proves the
examples in a package's `docs-content/` still do what the prose claims. A copy-pasteable snippet that
silently returns the wrong field — a dose, a code, an identifier — is a clinical-harm failure mode
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
file and line, compiles it, and executes it — a line of the form `<expr>; // => <value>` becomes
`expect(<expr>).toStrictEqual(<value>)`. A block tagged ` ```ts runnable throws ` must throw instead.

```ts
// test/docs-content.test.ts
import { join } from "node:path";
import { docSnippetSuite } from "@cosyte/vitest-config/snippets";

docSnippetSuite({
  docsDir: join(import.meta.dirname, "..", "docs-content"),
  // Point a snippet's `import ... from "@cosyte/hl7"` at what you want to prove against — this repo's
  // source for a fast local gate, or `../dist/index.js` (after `pnpm build`) for artifact fidelity.
  resolve: (spec) =>
    spec === "@cosyte/hl7" ? join(import.meta.dirname, "..", "src", "index.ts") : undefined,
});
```

Options: `docsDir` / `files`, `include` (default `.md` / `.mdx`), `resolve` (import-specifier
remapper), `runnableTag` (default `"runnable"`), `name`, `requireSnippet`, `tmpDir`. A package with no
runnable snippets yields an empty, passing suite — absence degrades quietly; a _wrong_ snippet fails
loudly. The primitives (`extractRunnableSnippets`, `rewriteAssertions`, `remapImports`, `runSnippet`)
are exported too, for bespoke wiring.

> `runSnippet` writes a transient `.ts` module under `tmpDir` (default `.cosyte-doc-snippets/` in the
> project root) and imports it so Vitest transforms the TypeScript — add `.cosyte-doc-snippets*/` to
> `.gitignore`. It must stay inside the project root; files under `node_modules` are not transformed.

Part of [cosyte/config](https://github.com/cosyte/config) — one enforced toolchain for the `@cosyte/*`
suite.
