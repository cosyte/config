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

Shared Vitest config (v8 coverage, per-directory >=90 gates) and StrykerJS mutation testing config for @cosyte/\* packages.

## Why this exists

Coverage that is reported but not gated is a number nobody acts on, and a repo-wide threshold hides
the one directory that has none: a package can sit at 92% overall while its serializer is at 40%.
The Cosyte baseline gates per directory, and it ships enabled rather than as a setting each repo
remembers to switch on.

The nearest alternative is a hand-written `vitest.config.ts` per repository with `coverage.thresholds`
copied in. That is the drift this removes, and it is also where the second half of this package comes
from: nothing in that alternative proves the examples in your documentation still work.

The third half is mutation testing. Coverage says a line ran; it does not say a test would notice
if the line were wrong. `@cosyte/vitest-config/stryker` runs the same Vitest suites under StrykerJS,
which changes the code one small way at a time and counts the changes no test noticed.

## Status

`@cosyte/vitest-config` is on the Cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

Still moving: the coverage exclude list and the snippet-suite options (`runnableTag`, `resolve`,
`requireSnippet`), which have changed shape as the first consumers adopted them. The 90 threshold and
the `cosyteVitest(options)` signature are the settled parts, and a change to either is recorded with
the bump type it deserves rather than absorbed into a patch.

The mutation-testing entry points, `/stryker`, `/mutate` and the `cosyte-mutate` bin, are new and
the least settled part. In particular, the changed-files run mutates each changed file whole;
whether it should mutate only the changed lines, which is faster on a large file, is open.

## Install

```sh
pnpm add -D @cosyte/vitest-config vitest @vitest/coverage-v8 vite
```

`vitest` (4 or 5), `@vitest/coverage-v8` (the same major) and `vite` are peer dependencies.
Install `vite` explicitly: Vitest 4 and 5 require major version 6 or later, and without a direct
declaration the resolver will happily keep an incompatible vite 5. Node `>=22.14`. ESM only.

For mutation testing, also install the optional peers: StrykerJS 10 and its Vitest runner, and
`@cosyte/script-utils`, which `cosyte-mutate changed` reads a change with. A package that uses only
the Vitest config installs none of them; `cosyte-mutate changed` without `@cosyte/script-utils`
exits 2 and names it.

```sh
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner @cosyte/script-utils
```

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
| `@cosyte/vitest-config/stryker`  | `cosyteStryker(options?)`, the shared StrykerJS config              |
| `@cosyte/vitest-config/mutate`   | `runMutate`, the body of the `cosyte-mutate` bin, and its parts     |
| `cosyte-mutate` (bin)            | `full`, and `changed --base <ref>`                                  |

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

`cosyteStryker` takes `mutate`, `vitestConfig` and `stryker` (any other Stryker option, merged
last); its defaults and the reason for each are tabled under the mutation section below.

A package with no runnable snippets yields an empty, passing suite unless `requireSnippet` is set:
absence degrades quietly, a _wrong_ snippet fails loudly. Lowering a coverage threshold is the
override worth arguing about in review, because unlike the others it changes what CI will let
through.

## Mutation testing: `/stryker` and `cosyte-mutate`

A `stryker.config.mjs` at the package root exports what the factory returns:

```ts runnable
import { cosyteStryker } from "@cosyte/vitest-config/stryker";

const config = cosyteStryker();
config.testRunner; // => "vitest"
config.ignoreStatic; // => false
config.jsonReporter; // => { fileName: "reports/mutation/mutation.json" }
```

Then, from the same directory:

```sh
pnpm exec cosyte-mutate full                          # every file the config names
pnpm exec cosyte-mutate changed --base origin/main    # only what this change touched
pnpm exec cosyte-ratchet check --skip coverage --base origin/main
```

`full` writes `reports/mutation/mutation.json`, the report the floor file's mutation score is read
from. `changed` writes `reports/mutation/changed.json` beside it, so a run over a few files is never
read as the whole package's score. A change with no changed source file starts no run: it writes an
empty report, so the ratchet can tell "ran, nothing to mutate" from "never ran", and exits 0.
`cosyte-mutate` exits 0 when the run finished and 2 when it could not run; it does not judge the
score.

The `/mutate` entry point is the bin's body and the pieces it is built of, for a caller that runs
it from its own script. `selectChangedFiles` is the rule a changed run picks its files by:

```ts runnable
import { selectChangedFiles } from "@cosyte/vitest-config/mutate";

const picked = selectChangedFiles({
  changed: ["src/a.ts", "src/a.test.ts", "README.md"],
  root: "/repo",
  cwd: "/repo",
  patterns: ["src/**/*.ts", "!src/**/*.test.ts"],
});
picked; // => ["src/a.ts"]
```

### What the Stryker config sets, and why

`cosyteStryker({ mutate, vitestConfig, stryker })` takes the file list, the Vitest config file, and
any other Stryker option, merged last, so a package can change anything below. What each default is
and why:

| setting            | default                                     | why                                                                          |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `testRunner`       | `vitest`, resolved from this package        | Stryker cannot find a plugin by name under pnpm                              |
| `vitest.pool`      | `forks`                                     | Vitest's own default; Stryker's is threads, where `process.chdir()` throws   |
| `coverageAnalysis` | `perTest`                                   | each mutant runs only the tests that reach it                                |
| `mutate`           | `src/**/*.ts` without tests, barrels, types | the same files `@cosyte/vitest-config` measures coverage over                |
| `ignoreStatic`     | `false`                                     | static mutants are module-level tables, such as a scanner's patterns: kept   |
| `thresholds.break` | `null`                                      | the floor file decides a drop, not Stryker                                   |
| reports            | JSON and HTML under `reports/mutation/`     | JSON for the ratchet and CI, HTML for a person reading the surviving mutants |

Setting `ignoreStatic: true` makes a run faster and is the override worth arguing about in review: it
drops every mutant in module-level code from the score without an inline reason for any of them.

### An exception, and why it needs two comments

A mutant that cannot be killed (an equivalent mutant, or a line only a child process reaches) gets
an inline exception that names its reason:

```js
// Stryker disable next-line ConditionalExpression: both branches return the same value here
```

Mutation testing does not read coverage's ignore hints, so a line excluded from coverage with
`/* v8 ignore next -- reason */` still has its mutants, and they show as not covered. Such a line
needs both comments, each with its reason. `cosyte-ratchet check --base` lists every exception in
changed code, so the pull request can carry the list.

## The 90 gates and the floor file

The 90 thresholds are one fixed minimum for every package, and they fail the test run itself. The
floor file, `quality-floor.json`, held by `cosyte-ratchet` in `@cosyte/script-utils`, is each
repository's own record of what it measured, and it only rises. The two do different jobs:

- A package above 90 on a metric is held by its floor, which sits at what it measured; the 90 gate
  is a backstop that does not fire.
- A package below 90 on a metric lowers that one key with `coverageThresholds`, and its floor still
  holds the measured value, so the number can only rise from there.
- A pull request's own changed lines are held to 100 by the ratchet, whatever either number says.

The `json-summary` and `lcov` reports this config writes are the two the ratchet reads.

## PHI and safety

This package is test configuration. It processes no patient data: it configures a test runner and,
through `/snippets`, compiles and executes the code blocks you point it at. Through `/stryker` it
runs your own tests against altered copies of your own source, in a sandbox directory
(`.stryker-tmp/`) inside your project; add it and `reports/mutation/` to `.gitignore`.

Two consequences worth stating plainly, because `/snippets` does run code. It executes the snippets
in your own documentation, in your own process, so a documentation example must never contain real
patient data: it would then be executed, and it is already committed. And the transient module
`runSnippet` writes is written under your project root, so a snippet's inputs land on disk exactly as
a test fixture's would. Use synthetic data in documentation, as in tests.

## API

### `cosyteVitest(options)`

The baseline config: v8 coverage with `text` / `html` / `lcov` / `json-summary` reporters, the standard excludes
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

MIT, copyright Cosyte LLC. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
