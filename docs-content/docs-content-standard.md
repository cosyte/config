---
id: docs-content-standard
title: The docs-content standard
sidebar_label: Docs-content standard
description: "How every Cosyte library's documentation is laid out and checked: the kinds of page, the sidebar, samples that run, and what an example may print."
---

This page is the decision record [`documentation/decisions/0006-the-docs-content-standard.md`](https://github.com/cosyte/config/blob/main/documentation/decisions/0006-the-docs-content-standard.md) in
cosyte/config, written out for this site. The record is the source: a change is made there.

- **Status:** Proposed (2026-11-10), for review before merge. Revised the same day from what the
  pilot on `hl7` found (section 11). Revised on 2026-11-12 with the rules on what each kind of page
  holds, from a Diataxis audit of every library's pages (section 12). Revised on 2026-11-12 again
  with a page for each runnable example, under an Examples category (section 13). Revised on
  2026-11-12 a third time with what an example may print (section 14).
- **Scope:** the `docs-content/` folder of every `@cosyte/*` library: the pages docs.cosyte.com
  renders from each release's `docs-content.tar.gz`. It does not reach a package's README, which
  `scripts/readme-check.mjs` governs, except for what a sample may print (section 14), which holds
  for the README's samples as for the pages'.
- **Relates to:** [`packages/script-utils/docs-content.js`](https://github.com/cosyte/config/blob/main/packages/script-utils/docs-content.js)
  (the structure check) · [`packages/process/src/docs-reference.ts`](https://github.com/cosyte/config/blob/main/packages/process/src/docs-reference.ts)
  (the reference generator) · [`packages/vitest-config/snippets.js`](https://github.com/cosyte/config/blob/main/packages/vitest-config/snippets.js)
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

A page's kind is the sidebar category it is listed in (section 3). Section 12 gives the rules a page
of each kind keeps, and how the structure check reads each one.

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
and at least one explanation; a `limitations` page, in Reference (section 12); and the generated
reference (section 6). Tutorials beyond the quickstart and other hand-written reference pages are
added when a library has them, and a library with runnable examples has a page for each one
(section 13).

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
    { "type": "category", "label": "Examples", "items": ["example-extract-patient-info"] },
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
  Troubleshooting are required; Tutorials and Reference appear when a library has those pages, and
  Examples when it has runnable examples (section 13).
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
Explanation or Reference. That list has to accept the four, and Examples (section 13), before a
library releases with this sidebar; until then a release with it fails the site's deploy build.

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
- `sidebar_position` is not used: the sidebar sets the order. Other Docusaurus keys are allowed, and
  so is `held_by`, which a configuration or command reference carries (section 12).
- A page is a `.md` file at the top of `docs-content/`, named in lower-case words joined by single
  hyphens. The name says what the page is about, not its kind, so existing pages keep their URLs.
  The name shares a content word with the title, and a new one never begins `guides-`, `concepts-`
  or `core-concepts` (section 12).
- `docs-content/api/` belongs to the reference generator, and images go in `docs-content/img/`.
- Docusaurus compiles `.md` as MDX, so a brace or an angle bracket outside code is written in code
  or escaped.

### 5. Cross-links

- A link to another page of the same library is relative and names the file: `./warning-codes.md`
  or `./warning-codes.md#ack-codes`. It resolves on GitHub and on the site alike.
- A link into the generated reference names its page and anchor: `./api/README.md#parsehl7`. The
  page must be one the generator wrote, and the anchor one that a heading on it gets on the site:
  the heading's text (a code span read as its content, a link as its text, a backslash escape as the
  character) in lower case, with every character that is not a letter, a mark, a digit, an
  underscore, a space or a hyphen dropped, and each space turned into a hyphen. A heading whose
  anchor is already taken on the page gets `-1`, the next `-2`, in page order. That is how the
  site's markdown loader slugs a heading, so `### parseHL7()` is `#parsehl7` and the second
  `#### Example` on a page is `#example-1`.
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

A TSDoc comment holds no markdown heading (a line such as `## Notes`, outside code), on an export
or on anything inside one: a signature, a parameter, a member, or the package's own comment. The
generator prints a comment as it is, so a heading in one would sit in the page's outline among the
generated headings, as if it were an export, and would shift the numbered anchors of the headings
after it. `cosyte-docs-reference` reports each one, with where it is, and fails. Write it as a bold
line or a sentence; the same comment also shows in an editor's hover, where a heading is just as out
of place.

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
- Each TypeScript sample (`ts`, `typescript`, `tsx`) is also type-checked against the package's
  types before it runs, so a sample that runs but would not compile in a reader's project fails.
  Each is compiled as its own module, importing the package by its published name, which the
  library resolves to its built declarations through its `exports`; the options are the library's
  `tsconfig.json`, with emit and the unused-name checks turned off, since a sample may declare a name
  only to show it.
- A block that cannot run says why in its fence, `ts no-run <reason>`, and the test report lists it
  as skipped with that reason. A `no-run` with no reason fails the suite.
- A sample that runs but whose types cannot be checked, such as one that shows what happens when a
  caller ignores them, says why the same way, `ts no-typecheck <reason>`: it runs, its test name
  carries the reason, and a `no-typecheck` with no reason fails the suite. A `throws` sample is
  type-checked like any other, so one that throws only because it misuses the types says so with
  `no-typecheck`. There is no switch that turns the check off for a whole library: each exception
  shows in the page and in review.
- The pages under `api/` are not samples: they are generated from TSDoc, and their examples are
  parts of a signature's documentation, which the reference check owns. A suite that walks
  `docs-content/` with `every` leaves `api/` out; `includeGenerated: true` walks it too.
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
not committed: the section in the repository holds this placeholder and nothing else, however its
lines wrap, up to the next heading of level one or two:

> The numbers for this section are measured on `main` at each release and filled in when the release
> is built. They are never typed by hand.

The structure check refuses anything else in the section, a table or a sub-heading as much as a
sentence added beside the placeholder, so a number typed by hand cannot be committed there. The
method, and anything else written by hand, goes in a section of its own.

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

| Check                                                        | Catches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Cannot catch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cosyte-docs-content` (`@cosyte/script-utils`)               | the sidebar's shape and order; a page not listed, listed twice, or listed and missing; a missing required page; missing or empty front matter keys, an `id` that is not the file name, a description over 160 characters, `sidebar_position`; a page name or place outside the rules; a quality page with no "Current numbers" section, or with anything in it but the placeholder; a link into the reference whose page is not generated or whose anchor no heading on it gets; each pattern section 12 gives for what a kind of page holds; a runnable example with no page, an example page with no example or outside Examples, and a Code section that differs from the example's file (section 13) | whether a page holds what its kind asks beyond those patterns (section 12 lists what each cannot see); whether an example page's expected output is what the example prints, or its prose is true of it (section 13); any other broken link (the shared CI's docs-content link check resolves those); a heading the generator writes in a form the slug reading does not know (setext, an explicit `{#id}`, HTML or an entity in the heading); a brace that breaks the MDX build; prose quality |
| `cosyte-docs-content`, the print rule (section 14)           | a console, logger or printer call in a README or page sample whose argument reads an identifying accessor or is a whole message, segment, resource or person                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | a value carried under another name; a field the lists do not name; a value printed by a call the check does not know as a printer; whether a value it allows is in fact safe                                                                                                                                                                                                                                                                                                                    |
| `cosyte-docs-reference` (`@cosyte/process`)                  | an export with no TSDoc summary; a markdown heading in any TSDoc comment; committed reference pages that no longer match the source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | an undocumented member; a comment that is wrong; an `@example` that does not run; a heading inside a list or a quote in a comment                                                                                                                                                                                                                                                                                                                                                               |
| `docSnippetSuite({ every: true })` (`@cosyte/vitest-config`) | a sample that throws, fails an `// =>` assertion, does not compile as JavaScript, or a `throws` sample that does not throw; a TypeScript sample with a type error against the package's built types; a `no-run` or `no-typecheck` with no reason                                                                                                                                                                                                                                                                                                                                                                                                                                                         | a sample whose output is right but whose prose is wrong; whether the data in a sample is synthetic; a sample that runs but proves nothing because it asserts nothing; the types of a JavaScript sample                                                                                                                                                                                                                                                                                          |

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

### 11. Revised after the pilot

Bringing `hl7` to this standard first found five places where the checks fell short of it. Each is
now part of the standard and of its check:

1. **The generated pages were run as samples.** A suite walking `docs-content/` with `every` also
   read `api/`, whose examples are fragments of a signature's documentation (385 of them in `hl7`,
   many using a name the fragment never declares). The sample runner now leaves `api/` out of such
   a walk (section 7).
2. **A link into the reference was not checked.** Nothing resolved `./api/README.md#parsehl7`, so an
   export renamed in the source would have broken every link to it silently. The structure check
   now resolves each one, page and anchor, as the site slugs headings (section 5). On the pilot's
   pages it resolves all 87 such links, and a changed anchor turns it red.
3. **A heading in a TSDoc comment entered the page's outline.** The pilot rewrote one by hand. The
   reference check now refuses any, rather than rewriting a comment on its way into the page, so the
   page and the comment a reader sees in an editor stay the same text (section 6).
4. **A sample that ran was not proved to compile.** Vitest strips types before running a sample,
   so a sample with a type error passed. The sample runner now type-checks each TypeScript sample
   against the package's built types (section 7). On the pilot's pages, 110 of the 111 TypeScript
   samples that run type-check; the one that does not carries a `@ts-expect-error` that TypeScript
   does not need, since the function it calls is generic and accepts the misspelled option the
   comment says it refuses.
5. **The "Current numbers" section could hold anything.** The check asked only for the heading, so a
   table typed by hand would have passed under it. It now requires the placeholder alone (section
   8).

### 12. What each kind of page holds, and how the check reads it

Until this section, nothing read whether a page holds what its kind asks: a page's kind was set only
by its sidebar category, so a how-to guide that was mostly explanation, or an explanation that held a
settings table, passed. A Diataxis audit of every library's pages on 2026-11-12 found those mixed
pages in most libraries, and limitations pages filed four ways. These eight rules come from it. The
structure check reads each one from the page's category, its title, its id and its headings:

1. **A how-to guide's title states its goal and begins with a verb in the imperative.** The check
   reads the title's first word against a list of verbs, `IMPERATIVE_VERBS` in
   `@cosyte/script-utils`; a guide that needs a verb the list lacks adds it there. Words read first
   as nouns (release, support, report, list, index and the like) are not on it, so a noun title
   such as "Release notes" is a finding. It cannot tell whether the rest of the title states a goal.
2. **A how-to holds steps; how and why it works goes in an explanation it links.** A how-to has no
   heading (H2 or H3) that begins How, Why or The alternatives. It cannot see explanation written
   under any other heading.
3. **An explanation has no settings table and no steps:** no table whose header starts Key or Option
   with a Default column, and no numbered H2 (`1. ...` or `Step 1: ...`). A section numbered only to
   order an argument is a finding too: write its heading without the number. It cannot see a list
   of steps written as a paragraph or a numbered list.
4. **Each library has one limitations page, id `limitations`, in Reference; no other page has a
   heading Known limitations or Limitations.** A page that names limitations links that page. It
   cannot see a limitation written under another heading.
5. **A tutorial's H2s are numbered steps in order, and it ends with "What you built" and "Next".**
   The quickstart is its own category and is not read as a tutorial here. It cannot tell whether a
   step is one the reader can follow.
6. **A page id names what the page is about and shares a content word with its title; a new id never
   begins `guides-`, `concepts-` or `core-concepts`.** Words such as "the", "how" or "guides" do not
   count, a shorter word matches a longer one that begins with it (`ack` and `acks`), and the six
   fixed pages are not read. It cannot tell whether the shared word is the one the page is about.
7. **A reference for a surface that is not TypeScript (configuration keys, CLI commands) is
   generated from the code, or a test holds every entry to it.** A Reference page whose id names
   configuration, options, settings, environment, a command or the CLI, or that holds a settings
   table, names that generator or test in its front matter, `held_by: test/docs-content.test.ts`,
   a path from the repository root; the file must exist and name the page's file as a whole path
   segment (`configuration.md` is not named by `cli-configuration.md` or `configuration.mdx`). It
   is never a page: a Markdown or MDX file, or any file under `docs-content/`, is refused, so a page
   cannot hold itself or lean on a README. Nor is it a text file that can only mention the page: a
   `.markdown` or `.txt` file, or a file with no extension unless its text begins with `#!`, as a
   script does. It cannot tell whether the test holds every entry; review does.
8. **A measured number appears only in a "Current numbers" section, never in prose.** A check can
   only approximate it: a number followed by a measured unit (a percentage, `ms`, `µs`, `ns`, a size
   in bytes, a rate a second, "times faster"), in prose outside code and outside that section, on a
   page not in Reference. It cannot tell a measurement from a limit such as "1 MiB", so it is a
   warning and never fails.

**The ratchet.** The first seven rules, and the two rules on example pages (section 13), fail a
library only past the findings it had when they landed. `docs-content-ratchet.json`, shipped in
`@cosyte/script-utils`, records each library's count per rule, by the name in its `package.json`;
at or under its count a rule's findings are listed and pass, and over it every one fails. The counts only fall: the check names a count a library has
dropped below, and that count is lowered in this repository, never raised; a test holds the file to
main's copy. A library or a rule with no count has none to spend, so a new library keeps every rule
from its first page. Measured on 2026-11-12 at each library's `main` (the commit for each is in the
file), the counts are:

| Library     | howto-title | howto-steps | explanation-content | limitations | tutorial-steps | page-id | reference-source |
| ----------- | ----------- | ----------- | ------------------- | ----------- | -------------- | ------- | ---------------- |
| astm        |             |             |                     | 2           | 2              | 4       |                  |
| ccda        |             | 1           |                     |             |                |         |                  |
| cli         |             |             |                     | 1           |                | 3       | 1                |
| dates       |             |             |                     | 1           | 3              | 2       |                  |
| deid        | 1           | 2           |                     | 7           |                | 10      |                  |
| dicom       |             |             |                     | 1           |                | 2       |                  |
| fhir        |             |             |                     | 1           |                | 2       |                  |
| hl7         |             |             | 6                   | 14          | 2              | 1       |                  |
| mllp        |             |             |                     | 2           |                | 1       | 2                |
| ncpdp       |             |             |                     | 3           | 2              |         |                  |
| pathways    |             | 11          | 1                   | 1           |                | 1       | 2                |
| synth       |             | 1           |                     | 1           | 18             | 11      | 1                |
| terminology |             |             |                     | 1           | 1              | 1       |                  |
| transform   |             |             |                     | 2           | 2              | 3       |                  |
| x12         |             | 1           |                     | 2           |                |         |                  |

`dicom` still has the sidebar categories from before this standard (Core concepts and Guides), so
the rules that read a kind find little there yet; its pages meet them when it moves to the four
kinds. The audit's other findings, the pages to split and the pages each library is missing, are
work on each library's pages, not rules.

### 13. A page for each runnable example

Each library's `examples/` folder holds small programs that run against the built package, and none
of them appeared on docs.cosyte.com: a reader of the site could not find them. On 2026-11-12, 14 of
the 15 libraries held 3 to 14 runnable examples each, 66 in all, read from the checkouts the
umbrella pinned that day; `pathways` has none. So every runnable example has a page:

- **Which files.** A runnable example is a `.ts`, `.mts`, `.js` or `.mjs` file at the top of
  `examples/`, whose name does not begin with `_` or `.` (a helper the examples import, such as
  `_cosyte.ts`) and that is not a `.d.ts` file, a test (`*.test.*`, `*.spec.*`) or a tool's
  configuration (`*.config.*`, such as `eslint.config.js`). Folders under `examples/` are not read:
  they hold the fixtures and helpers the examples import, or a project of their own with its own
  README.
- **The page.** `docs-content/example-<name>.md`, the name being the file's without its extension,
  listed under the Examples category, which comes after How-to guides and holds example pages only.
  Its H2 headings are, in this order: **What it shows** (what the example does and which part of the
  package it uses), **Run it** (the commands, from the repository root), **Expected output** (a
  fenced block holding what it prints, as it prints it) and **Code**. The first three are written by
  hand.
- **The code is included from the file, never pasted.** The Code section runs from its heading to
  the end of the page and is the example's whole file, in a fence titled with its path.
  `cosyte-docs-content --write` writes it from the file, replacing the section or adding it to a page
  that has none, and the check compares it: a Code section that differs from the file by one
  character fails, so a change to an example is a change to its page, committed with it. Docusaurus
  cannot include a file at build time here, because the site renders `docs-content.tar.gz` alone,
  without the repository; so the generator copies the file in, the way the Terraform modules'
  generators copy their examples' files into their pages. The fence is marked
  `no-run the example file itself, which the library runs from examples/`, so the sample runner
  (section 7) lists it as skipped with that reason rather than running it away from the files it
  imports.
- **What fails.** A runnable example with no page, an example page whose example is gone, an
  example page listed outside Examples, a page under Examples that is not an example page, an
  example whose name is not a page name (lower-case words joined by hyphens), two examples with one
  name (`a.ts` and `a.mjs`), a missing or misplaced heading, an Expected output section with no
  fenced block, and a Code section that differs from the file. The first eight fail under the rule
  `example-page`, the last under `example-code`.
- **The ratchet holds both rules**, like the rules on kinds (section 12), so no library goes red the
  day it takes them. `docs-content-ratchet.json` records each library's `example-page` count: its
  runnable examples with no page, read with the check itself from the checkouts the umbrella pinned
  on 2026-11-12 (the commit for each is in the file's `examplesMeasuredAt`). That is the runnable
  examples above, not every file in `examples/`: a library's `README.md`, `tsconfig.json`,
  `eslint.config.js`, the `_cosyte.ts` helper and folders of fixtures are not examples, so `x12`
  holds 17 files at the top of `examples/` and 14 examples. No library records an `example-code`
  count, so a Code section that differs from its file fails everywhere, and `--write` fixes it. The
  counts only fall: once a library writes a page, the check names the count to lower here, and an
  example added without a page takes the library over its count and fails. The counts are:

  | Library | example-page | Library     | example-page |
  | ------- | ------------ | ----------- | ------------ |
  | astm    | 4            | hl7         | 3            |
  | ccda    | 8            | mllp        | 4            |
  | cli     | 4            | ncpdp       | 3            |
  | dates   | 3            | synth       | 4            |
  | deid    | 4            | terminology | 3            |
  | dicom   | 4            | transform   | 4            |
  | fhir    | 4            | x12         | 14           |

  A count is per rule, so a page with a missing heading counts against the same number as an
  example with no page, and is held while the library is at or under it; lowering the count as
  pages are written is what makes each such finding fail.

- **Writing a page.** `--write` opens each page once and reads and writes it through that one file
  descriptor, without following a symbolic link (`O_NOFOLLOW`), so a page swapped for a link between
  the read and the write is not written through. On Windows, Node.js has no `O_NOFOLLOW`, so that
  protection does not apply there: a link swapped in at that moment would be followed.
- **What it cannot catch.** Whether the expected output is what the example prints today, and
  whether the prose under What it shows and Run it is true of the example. Each of the 14 libraries
  has a `pnpm examples` script that runs its examples, and some examples assert their own output;
  holding the page's expected output to a run is left for later, since it needs the package built
  and every example run, which the structure check does not do.

`--write` never creates a page, since a page that only repeats the file says nothing the file does
not. A library that takes this version needs no page at once; it writes them as it can, and its
count is lowered with each.

### 14. What an example may print

Each library's README and pages print fields from their samples with `console.log`, and on
2026-11-12 several printed a patient's name, record number or date of birth. The values are
synthetic, but the page is published, and a reader copies what it does into code that runs on real
messages: an example that logs a patient's name teaches a reader to log one. So the rule is the
same everywhere:

- **An example never passes a value that identifies a patient or another person to `console.log`
  or any other logger or printer:** a name, a record or member number, a date of birth, an address,
  a phone number, an email, a free-text note, or a whole message, segment or resource.
- **To show what a field holds, the example reads it into a variable or asserts on it,** with the
  synthetic value in a comment beside it, marked as synthetic.
- **What an example prints is what is safe to log:** message types, codes from a code system,
  counts, lengths, positions, the precision of a date, warning and error codes, and booleans.
- **Every sample still runs** (section 7): a print is replaced by a read or an assertion, never
  removed, so no example becomes code that nothing executes.

Wrong, since it prints the record number and the whole message:

```ts
const msg = parseMessage(SAMPLE);
console.log("Record number:", msg.patient?.mrn);
console.log(msg);
```

Right, since it prints a type and a count, and shows the record number in a comment:

```ts
const msg = parseMessage(SAMPLE);
const mrn = msg.patient?.mrn; // "SYN-000123", synthetic
console.log("Message type:", msg.meta.type);
console.log("Warnings:", msg.warnings.length);
```

An assertion shows a field as well, with the same mark: `msg.patient?.mrn; // => "SYN-000123"`,
on a line under a comment that says the value is synthetic.

**The check.** `cosyte-docs-content` reads each TypeScript and JavaScript sample (the fences of
section 7) in the README and in the pages at the top of `docs-content/`, example pages included. It
finds each call that prints: the `console` methods that print, `process.stdout.write` and
`process.stderr.write`, and the printing methods (`info`, `warn`, `error` and the like) of any object
named `log`, `logger` or ending in `Logger`. A call is a finding, under the rule `example-print`, when
an argument:

- reads an identifying accessor anywhere in its chain (`msg.patient.mrn`, `doc.getMrn()`,
  `row["mrn"]`, `{ mrn }`, or a template that interpolates one), unless the chain ends in a
  `length`, `size` or `precision` read (`msg.patient.mrn.length`). The list is `IDENTIFYING_ACCESSORS` in `@cosyte/script-utils`. A name
  is matched with any `get` prefix, case, `_` and `-` set aside, and a dotted entry such as
  `patient.id` or `name.family` matches those members in a row, for a name that identifies a person
  only after another;
- or is a whole message, segment, resource or person, as the value printed: `console.log(msg)`, a
  template that interpolates `segment`, `JSON.stringify(bundle)` or `msg.toString()`. The list is
  `WHOLE_VALUES`. A field of one (`msg.meta.type`) is not a whole value, and `error.message` is the
  text of an error, not a message.

A comparison, a negation, `typeof`, the condition of a conditional, a string literal, a comment and
an object's keys are not read as printed values. A finding names the file, the line and the list
entry it matched, never the argument, which may hold a synthetic value.

**Each library extends the lists** in `cosyte-docs-content.config.json` at its repository root,
for the accessors, whole values and printers its own API has:

```json
{
  "examplePrint": {
    "accessors": ["practiceAssignedId"],
    "wholeValues": ["dataset"],
    "printers": ["out.print"]
  }
}
```

The file takes only the key `examplePrint`, and under it only `required`, `accessors`, `wholeValues`
and `printers`; anything else, or a file that is not JSON, stops the check with exit 2, so a
misspelled key is not silently ignored.

**Advisory, then required.** The rule lands advisory: its findings are listed on stdout and never
change the exit code, so no library goes red the day it takes the release. Each library sweeps its
README and pages, one pull request each, and in the same pull request turns the rule on by setting
`"required": true` under `examplePrint`; from then on each finding fails the check. Unlike the rules
the ratchet holds (section 12), it has no count to fall from: a library is advisory or required.

**What it cannot catch.** It reads a sample as tokens, not as a program, so it cannot see a value
carried under another name (`const id = msg.patient.mrn; console.log(id)`), a field its lists do not
name, a value read by a path string (`get("PID-5")`), or a print through a function it does not know
as a printer. Nor can it tell whether a value it allows, such as a free-text field under another
name, is safe to print. Review reads for those.

## Consequences

- Every library's docs-content changes: pages move between categories, the two quality pages are
  written, front matter is completed, and samples that cannot run are made to run or given a reason.
- A pull request that changes an export also changes `docs-content/api/`, and review sees it.
- A pull request that changes an example also changes its page's Code section, and a new example
  comes with its page (section 13).
- Every library sweeps its README and pages for samples that print an identifying value, and turns
  the print rule on once they are clean (section 14).
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
- **Include an example's code at build time** (a raw-loader import or a remote code block). It
  would never go stale, but docs.cosyte.com renders the release's `docs-content.tar.gz` alone, which
  holds no `examples/`; copying the file in at the check, as the Terraform modules do, keeps the page
  whole in the asset and the copy exact.
- **Generate the whole example page from the file's leading comment.** No page to write by hand,
  but a comment written for a reader of the code says neither the expected output nor how to run it
  in the words a page needs, and the site would show the comment twice.
- **A `kind` key in the front matter.** The sidebar category already says what kind a page is, and
  a second statement of the same fact is one more thing to keep in agreement.
- **Turn the rules on what a kind holds on at full strength.** All fifteen libraries would go red
  the day they landed (section 12's table), and each would need its pages rewritten before any other
  change could merge. The ratchet keeps them green and lets the counts only fall.
- **Leave the example rules out of the ratchet.** Every library holding examples would fail the
  check the day it took the release, until it wrote a page for each of its examples (66 in all);
  the ratchet holds today's missing pages and still fails a new example without one.
- **Make the print rule required the day it lands.** Every library whose samples hold a finding
  would fail until it was swept, and no other change could merge there first; so the rule starts
  advisory, and each library turns it on with its sweep.
- **Parse samples with the TypeScript compiler for the print rule.** It would follow a value from
  one name to another, but `@cosyte/script-utils` takes no dependencies, and the lists of names are
  the part that needs review whichever way the code is read.
- **Look for the synthetic values themselves rather than the accessors.** A value differs in every
  sample and every library; the accessors that read one are few and are the same across samples.
- **Warn on every rule instead of failing.** A warning in a log is read once and then not at all;
  only the measured-number rule, which a check cannot read reliably, is a warning.
