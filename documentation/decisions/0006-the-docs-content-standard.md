# 0006: The docs-content standard

- **Status:** Proposed (2026-11-10), for review before merge.
- **Scope:** the `docs-content/` folder of every `@cosyte/*` library: the pages docs.cosyte.com
  renders from each release's `docs-content.tar.gz`. It does not reach a package's README, which
  `scripts/readme-check.mjs` governs.
- **Relates to:** [`packages/script-utils/docs-content.js`](../../packages/script-utils/docs-content.js)
  (the structure check) · [`packages/process/src/docs-reference.ts`](../../packages/process/src/docs-reference.ts)
  (the reference generator) · [`packages/vitest-config/snippets.js`](../../packages/vitest-config/snippets.js)
  (the sample runner) · the testing standard and the performance standard, decision records written
  beside this one, whose outputs feed the two quality pages (section 8).

## Context

Each library ships a `docs-content/` folder: Markdown pages with front matter and a `sidebars.json`.
`cosyte-process pack-docs` packs it into a release asset, and docs.cosyte.com renders that asset. The
folders grew one library at a time, with no shared shape. Measured on 2026-11-10 across the 15
libraries: 176 pages, from 1 (`pathways`) to 31 (`hl7`); 13 of the 15 sidebars used the same five
categories, Installation, Quickstart, Core concepts, Guides and Troubleshooting, `dates` used four of
them (no Guides), and `pathways` has none, only its overview; what went in each varied;
of 543 TypeScript and JavaScript samples, 284 (52%) were run by any test; and no library had a page on
how it is tested or how fast it is.

We want three things from the folder: a reader finds the same kinds of page in the same places in
every library; every sample a reader can copy is run against the code; and testing and performance
are shown with numbers, each with its method.

## Decision

### 1. Four kinds of page, after Diataxis, and two fixed pages

Every page is one of four kinds, after the Diataxis framework (diataxis.fr). Each kind answers one
need, and a page that tries to answer two answers both badly.

| Kind         | The reader wants to    | A page of this kind holds                                                                                                                                  |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tutorial     | learn, by doing        | one task from nothing to a working result, with synthetic input, every step a sample that runs; no choices and no digressions                              |
| How-to guide | do one thing they know | a goal in the title ("Read a patient's identifiers"), the steps, and the samples; it assumes the reader knows why, and links the explanation and reference |
| Reference    | look a fact up         | complete, austere lists: error and warning codes, grammars, version and conformance matrices; structured like the thing it describes                       |
| Explanation  | understand why and how | the model, the design and its trade-offs, what the standard says and what we do about it; no steps                                                         |

Two pages are fixed, and every library has both:

- **Testing and quality** (`testing-and-quality`): what we test and how (unit tests, conformance
  corpora, property-based tests, mutation testing, fuzzing, the PHI scan), what each technique
  catches and what it cannot, the method (a link to the testing standard), and a "Current numbers"
  section generated at each release (section 8).
- **Performance** (`performance`): what we measure (throughput, latency percentiles, memory, import
  time and bundle size), how (a link to the performance standard and to the benchmark results), how
  a reader can run the benchmarks, and a "Current numbers" section generated at each release.

### 2. The pages every library has

`intro` (the overview: what the package does, who it is for and what it is not), `installation`,
`quickstart`, `troubleshooting`, `testing-and-quality` and `performance`; at least one how-to guide
and at least one explanation; and the generated reference (section 6). Tutorials beyond the
quickstart and hand-written reference pages are added when a library has them.

### 3. The sidebar

One sidebar, `docs`, in this shape and this order. Every page is listed exactly once, and every id
listed is a page.

```json
{
  "docs": [
    "intro",
    { "type": "category", "label": "Installation", "items": ["installation"] },
    { "type": "category", "label": "Quickstart", "items": ["quickstart"] },
    { "type": "category", "label": "Tutorials", "items": ["build-an-ack"] },
    { "type": "category", "label": "How-to guides", "items": ["read-identifiers"] },
    { "type": "category", "label": "Explanation", "items": ["the-message-model"] },
    { "type": "category", "label": "Reference", "items": ["warning-codes"] },
    { "type": "category", "label": "Troubleshooting", "items": ["troubleshooting"] },
    "testing-and-quality",
    "performance"
  ]
}
```

- `intro` comes first, as a page, not a category.
- The categories come in the order above. Installation, Quickstart, How-to guides, Explanation and
  Troubleshooting are required; Tutorials and Reference appear when a library has those pages.
  Installation opens with `installation`, Quickstart with `quickstart`, Troubleshooting with
  `troubleshooting`.
- Installation and Quickstart stay as their own categories because docs.cosyte.com requires both
  for every library: they are the route a reader arriving from a post takes to a first result. The
  quickstart is the first tutorial, and installation is a how-to guide.
- A category holds page ids, or a category of page ids one level down (for a library with many pages
  of one kind, such as the spec notes under Explanation). Nothing deeper, and no `autogenerated`,
  `link` or `html` items.
- `testing-and-quality` and `performance` come last, as pages, in that order.
- No category is labelled "API Reference": docs.cosyte.com adds that category itself, from the
  generated pages, just before Troubleshooting.

**What this needs from docs.cosyte.com.** Its build checks each library's top-level sidebar labels
against its own list, which today has Core concepts and Guides and not Tutorials, How-to guides,
Explanation or Reference. That list has to accept the four before a library releases with this
sidebar; until then a release with it fails the site's deploy build.

### 4. Front matter and file names

Every page opens with front matter, one `key: value` per line:

```yaml
---
id: read-identifiers
title: Read a patient's identifiers
sidebar_label: Read identifiers
description: "Pull the medical record number and other identifiers out of a message, with the authority that assigned each."
---
```

- `id`, `title`, `sidebar_label` and `description` are required and not empty. `id` is the file
  name without `.md`. `title` is in sentence case. `description` is one plain sentence of at most 160
  characters, the length a search result shows.
- `sidebar_position` is not used: the sidebar sets the order. Other Docusaurus keys are allowed.
- A page is a `.md` file at the top of `docs-content/`, named in lower-case words joined by single
  hyphens. The name says what the page is about, not its kind, so existing pages keep their URLs.
- `docs-content/api/` belongs to the reference generator, and images go in `docs-content/img/`.
- Docusaurus compiles `.md` as MDX, so a brace or an angle bracket outside code is written in code
  or escaped.

### 5. Cross-links

- A link to another page of the same library is relative and names the file: `./warning-codes.md`
  or `./warning-codes.md#ack-codes`. It resolves on GitHub and on the site alike.
- A link into the generated reference names its page and anchor: `./api/README.md#parsehl7`.
- A link to another library uses its full docs.cosyte.com address.
- Every how-to guide links the reference entries it uses; every explanation links the how-to guides
  that apply it; the quickstart ends with links onward to the tutorials and how-to guides;
  troubleshooting links the codes it mentions.

### 6. The reference is generated from TSDoc

`cosyte-docs-reference` (a bin of `@cosyte/process`) runs TypeDoc with typedoc-plugin-markdown over
each entry point the package's `exports` names and writes one page per module to
`docs-content/api/`. The pages are committed, so a change to the public surface shows in review as a
change to them. `cosyte-docs-reference --check` writes nothing and fails when the committed pages
differ from what the source generates.

Every export, that is every function, class, interface, type alias, enum, variable and namespace an
entry point exports, carries a TSDoc summary; the same command reports each one that does not. A
function counts as documented when it or one of its signatures has a summary. A comment holding only
a tag, such as `@deprecated`, is not a summary. Members of an export (properties, methods, enum
members) are not checked yet.

No tag hides an export. One tagged `@internal`, `@hidden` or `@ignore` is still something a reader can
import, so it is shown in the reference and checked like any other: a symbol is either documented or
not exported from a public entry point. There is no allow list; measured on 2026-11-10, no library
needs one (counting `@internal` exports changes no library's count of undocumented exports, and no
library uses `@hidden` or `@ignore`). If one is ever needed, it will be an explicit list in the
library, each entry with its reason, so every exception shows in review.

Hand-written guides sit on top: a how-to guide or an explanation links into the generated reference
rather than restating it.

### 7. Every sample runs

Every TypeScript and JavaScript block in `docs-content/` (fences `ts`, `typescript`, `tsx`, `js`,
`javascript` and `mjs`) is a sample, and each one runs in the library's test suite:

```ts
// test/docs-content.test.ts
docSnippetSuite({ docsDir: join(root, "docs-content"), every: true, resolve });
```

- A sample imports the package by its published name; `resolve` points that at the built package,
  so a sample is proved against what a reader installs.
- `value; // => expected` lines become assertions. A block tagged `throws` must throw.
- A block that cannot run says why in its fence, `ts no-run <reason>`, and the test report lists it
  as skipped with that reason. A `no-run` with no reason fails the suite.
- Samples use synthetic data only: the 555 telephone range, `example.com` addresses, and identifiers
  that are visibly invented.
- Shell, JSON and text blocks are not samples and are not run.
- Each sample runs as the module its fence names: a `js`, `javascript` or `mjs` sample as a `.mjs`
  module, so TypeScript syntax in it fails; a `tsx` sample as `.tsx`; any other as `.ts`. A suite
  without `every` runs its `runnable` blocks as `.ts` modules, as it always has.

### 8. The live numbers on the two quality pages

Each quality page has a section headed `## Current numbers`, and that section belongs to a generator:
at each release, the release workflow replaces it, in the `docs-content.tar.gz` it builds, with the
numbers measured on `main` at the release commit. The numbers are never typed by hand, and they are
not committed: the section in the repository holds one sentence saying the numbers are filled in at
release.

The section states the commit, the date, the runtime and the runner, and links the method. What it
shows:

- **Testing and quality**, from the testing standard's outputs: line, branch, function and statement
  coverage; the mutation score of the latest full run, with its date; the floor each number is held
  to; and the number of property-based properties, with the cases each runs on a pull request and
  nightly.
- **Performance**, from the performance standard's outputs: throughput by message size, latency at
  p50, p95 and p99, peak heap and allocations over a long run, import time and bundle size.
  Comparisons with other libraries are not part of these pages.

What we assume of those outputs, to be confirmed when the generator is built: each is a JSON file
that CI writes on `main` and keeps for the release commit; the testing one carries the four coverage
totals, the mutation score with its run date, and the floors; the performance one is in the shape the
public benchmark results repository keeps, and records the commit, Node.js version, operating system
and runner class with each number. A number that is missing is shown as "not measured for this
release" with the reason, never left out.

### 9. The checks, and what each one cannot catch

| Check                                                        | Catches                                                                                                                                                                                                                                                                                                                                | Cannot catch                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cosyte-docs-content` (`@cosyte/script-utils`)               | the sidebar's shape and order; a page not listed, listed twice, or listed and missing; a missing required page; missing or empty front matter keys, an `id` that is not the file name, a description over 160 characters, `sidebar_position`; a page name or place outside the rules; a quality page with no "Current numbers" section | whether a page holds what its kind asks; a broken link (the shared CI's docs-content link check resolves those); a brace that breaks the MDX build; prose quality    |
| `cosyte-docs-reference` (`@cosyte/process`)                  | an export with no TSDoc summary; committed reference pages that no longer match the source                                                                                                                                                                                                                                             | an undocumented member; a comment that is wrong; an `@example` that does not run                                                                                     |
| `docSnippetSuite({ every: true })` (`@cosyte/vitest-config`) | a sample that throws, fails an `// =>` assertion, does not compile as JavaScript, or a `throws` sample that does not throw; a `no-run` with no reason                                                                                                                                                                                  | a sample whose output is right but whose prose is wrong; whether the data in a sample is synthetic; a sample that runs but proves nothing because it asserts nothing |

Measured on 2026-11-10, on each library's checked-out `main` at the time:

- **The structure check** found 8 to 50 findings in each of the 15 libraries, since none follows
  this standard yet: every library lacks both quality pages, and no sidebar has the new shape. In
  front matter, 13 libraries use `sidebar_position`, 11 have pages with no `sidebar_label`, and 4
  have a description over 160 characters.
- **The reference generator** ran in 1.4 to 7.3 seconds per library (one 16-core Linux desktop
  under a load average of about 40 from other work, Node.js 26, a warm cache) and wrote 44 pages
  across the 15 libraries; every one of them compiled as MDX, checked with `@mdx-js/mdx`. It found 3 undocumented exports, all in `hl7` (three
  namespaces re-exported with `export * as`), and none in the other 14. TypeDoc's own rule, which
  also requires members, found 2 to 1,150 undocumented exports and members per library on the root
  entry point alone, which is why members are left for later.
- **The sample runner** would run all 543 samples; 284 run today, so 259 samples in 13 libraries
  either start to run or take a `no-run` reason when a library turns `every` on.

### 10. Rollout

The standard is piloted on `hl7`, then brought to every other library, one pull request each; each is
public copy and waits for review before merge. The checks join the shared CI in cosyte/.github after
the pilot: the shared workflow already has a `check-docs-content` input for the link check, off in
every repository today.

## Consequences

- Every library's docs-content changes: pages move between categories, the two quality pages are
  written, front matter is completed, and samples that cannot run are made to run or given a reason.
- A pull request that changes an export also changes `docs-content/api/`, and review sees it.
- docs.cosyte.com has to accept the four new category labels before the first library releases
  with them. It generates its own reference from the source asset today and keeps doing so; it can
  read the committed pages instead later, which would also let the reference carry its source links.

## Alternatives considered

- **Keep the site's current categories and nest the new kinds under them.** It renders with no
  change to the site, but a reader would not see the four kinds the standard is built on, and
  "Guides" and "Core concepts" would keep meaning different things in different libraries.
- **Generate the reference only at release.** Nothing to keep fresh, but an API change would not be
  visible in review, and links into the reference could not be checked in a pull request.
- **API Extractor and API Documenter instead of TypeDoc.** It reports undocumented exports well,
  but it needs a declaration rollup per entry point and writes a different Markdown than the one
  docs.cosyte.com renders today.
- **Require members to be documented now.** The measured gap (up to 1,150 in one library) would turn
  the check into a backlog, not a gate.
- **No exceptions to "every sample runs".** Some samples cannot run in a test (a listener that never
  closes); a `no-run` with its reason in the fence keeps each one visible in the report.
- **A `kind` key in the front matter.** The sidebar category already says what kind a page is, and
  a second statement of the same fact is one more thing to keep in agreement.
