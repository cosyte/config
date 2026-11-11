<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/script-utils

> The two things every repo-local gate script gets wrong, fixed once and shared.

[![npm version](https://img.shields.io/npm/v/@cosyte/script-utils.svg)](https://www.npmjs.com/package/@cosyte/script-utils)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Zero-dependency helpers for the repo-local gate scripts in @cosyte/\* repos.

## Why this exists

A gate script that exits 0 without having checked anything is worse than no gate, because the run
conclusion is the only thing anyone reads. Two ways of producing one turned out to be universal
across the Cosyte repositories: an entrypoint guard written by hand that answers `false` for ordinary
invocations, and thirteen byte-distinct copies of one PHI scanner, each of which had to be fixed
separately when an escape was found.

The nearest alternative is `scripts/parser-template/`, and it is deliberately not this. A scaffold is
COPIED, so fixing the template fixes no repository that already exists. Here a fix is one pull
request and a version bump.

## Status

`@cosyte/script-utils` is on the Cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

Still moving: the `runPhiScan` option surface, which is where the per-repo axes below are still being
argued about, and the cross-cutting detection floor, which gains patterns as escapes are found. A new
pattern is a new red in a consumer that was passing, so pin an exact version if a green commit gate
matters more to you than a new detection.

## Install

```sh
pnpm add -D @cosyte/script-utils
```

Node `>=22.14`. ESM only, no runtime dependencies, and no build step. Both of those are load-bearing
rather than minimalism: the gates in `config` itself run **before `pnpm install`** on purpose, so
that a broken or hostile install cannot decide whether a release gate runs.

### If your gate runs before `pnpm install`, do not use the bare specifier

Read this before adopting the package, because it is the one thing that does not generalize.

A bare `import ... from "@cosyte/script-utils"` resolves through `node_modules`, so it only works
once the install has happened. `config`'s own gates run before their install and therefore import
this file by **relative path** instead, which needs nothing on disk but the checkout.

So check when your gate runs, and pick accordingly:

| When the gate runs               | How to import                                    |
| -------------------------------- | ------------------------------------------------ |
| After `pnpm install` (the usual) | `@cosyte/script-utils`, as a `devDependency`     |
| Before `pnpm install`            | A relative path to a vendored or checked-in copy |

Installing the package does not, on its own, give a pre-install gate the property described above.

Every entry point is published as source with no build step, so the relative-path route works for
each: the files are `index.js` and one `<entry>.js` per subpath, each beside its own hand-written
`.d.ts`. A vendored copy of a gate is that one file: its command-line form loads nothing beside it
unless node was pointed at a file of the same name.

## Usage

Guard a script's CLI side effect so a test can import it for its exports. That guard wraps the exit,
so this is the whole shape of a real gate:

```ts runnable
import { isCliEntrypoint } from "@cosyte/script-utils";

/** Your gate's body, exported so a test can import it without the CLI running. */
export function main(argv: string[]): number {
  return argv.length;
}

// This module was imported, not pointed at, so the guard is closed: `main` does not run and nothing
// exits. The assertion is deliberately ahead of the branch, so the example cannot exit a test
// process even if that answer ever changed.
const runAsCli = isCliEntrypoint(import.meta.url);
runAsCli; // => false
if (runAsCli) process.exit(main(process.argv.slice(2)));
```

That guard is what lets a test import the module for its exports without the CLI executing as a side
effect, while the script still runs normally when invoked.

The PHI scanner is the other half, on its own subpath. Its shared read filter is exported so a
caller can compose with it rather than restate it:

```ts runnable
import { exemptsMarkdown } from "@cosyte/script-utils/phi-scan";

exemptsMarkdown("docs/adopting.md"); // => false
exemptsMarkdown("src/patient.ts"); // => true
```

The internal-reference gate is the third, and it is configured entirely through one object. The
axis names below are the whole interface a consumer needs, so they are checked here rather than
described:

```ts runnable
import { canonicalRuleNames, resolveConfig } from "@cosyte/script-utils/internal-refs";

const config = {
  projectPrefixes: ["HL7", "CCDA"],
  standardsDesignations: ["HL7-(?:V2|V3|CDA)"],
  surfacePaths: ["README.md", "docs-content"],
  accountedTarballFiles: ["CHANGELOG.md", "dist"],
};

// Hand that to `runInternalRefsScan(config)` and it returns an exit code. Checked here without
// touching a repository, so this example reds if an axis is ever renamed under a consumer.
resolveConfig(config).problems; // => undefined
canonicalRuleNames().length; // => 6
```

The `attw` publish gate is the fourth. It exists because `attw` prints "This package does not
contain types." and exits **0**: for a package that ships types, that sentence means the
declarations were not in the tarball, which is a broken publish reported as a pass. Your repo keeps
`scripts/attw.mjs` and an `attw` script whose body is exactly `node scripts/attw.mjs`; that file is
a caller, and this is the whole of it:

```ts runnable
import { runAttwGate } from "@cosyte/script-utils/attw";

// The one line a consuming repo's `scripts/attw.mjs` carries:
//
//     process.exitCode = runAttwGate({ callerUrl: import.meta.url });
//
// `callerUrl` is required and has no default. `attw` is resolved as `../node_modules/.bin/attw`
// from it, so the binary that runs is YOUR package's own; defaulted to this module's location it
// would resolve inside `node_modules/@cosyte/`, where your package has no attw at all. The gate
// RETURNS the code to exit with and never calls `process.exit`, so it is testable in-process.
typeof runAttwGate; // => "function"
```

The README gate is the fifth. It checks a library README against the house skeleton and npm's
size limit, and it reads everything package-specific from `package.json`:

```ts runnable
import { checkReadme, README_CHARACTER_LIMIT } from "@cosyte/script-utils/readme";

const manifest = {
  name: "@cosyte/demo",
  repository: "https://github.com/cosyte/demo",
  engines: { node: ">=22.14" },
};

// A README that is only a title: each finding names the rule it breaks and the line.
const findings = checkReadme("# @cosyte/demo\n", manifest);
findings.some((finding) => finding.rule === "tile"); // => true
README_CHARACTER_LIMIT; // => 60000
```

The card checker is the sixth. It checks a repository's CLAUDE.md against the card spec: a title,
a paragraph, then `## Gate`, `## Hazard` and `## Rules`, in at most 60 lines of at most 100
characters and 5,120 bytes:

```ts runnable
import { checkClaudeCard, CARD_MAX_LINES } from "@cosyte/script-utils/claude-card";

const card =
  "# cosyte/demo\n\nOur demo.\n\n## Gate\n\npnpm test\n\n## Hazard\n\nNone.\n\n## Rules\n\n- One.\n";
checkClaudeCard(card); // => []
checkClaudeCard(card.replace("## Hazard", "## Notes")).length > 0; // => true
CARD_MAX_LINES; // => 60
```

The catalog is the seventh: one record per library, generated from its package.json, with its
tier, and one for Pathways. A site reads the list from it, and a library checks its description
against it:

```ts runnable
import { CATALOG, catalogEntry } from "@cosyte/script-utils/catalog";

CATALOG.libraries.length; // => 14
CATALOG.libraries.filter((library) => library.tier === "standard").length; // => 8
catalogEntry("@cosyte/hl7")?.docs; // => "https://docs.cosyte.com/hl7"
CATALOG.engine.displayName; // => "Pathways"
```

## Entry points

| entry point                          | what it is                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `@cosyte/script-utils`               | `isCliEntrypoint(moduleUrl)`, the entry-point guard                                          |
| `@cosyte/script-utils/phi-scan`      | `runPhiScan(config)` and `exemptsMarkdown(relPath)`, the shared PHI gate                     |
| `@cosyte/script-utils/internal-refs` | `runInternalRefsScan(config)`, the shared internal-reference gate                            |
| `@cosyte/script-utils/attw`          | `runAttwGate(options)`, the shared `attw` publish gate                                       |
| `@cosyte/script-utils/readme`        | `runReadmeGate(options)` and `checkReadme(text, manifest)`, the README gate                  |
| `@cosyte/script-utils/claude-card`   | `runClaudeCardGate(options)` and `checkClaudeCard(text)`, the CLAUDE.md card checker         |
| `@cosyte/script-utils/catalog`       | `CATALOG`, `catalogEntry(name)` and `runCatalogCheck(options)`, the catalog of our libraries |
| `@cosyte/script-utils/agent-notes`   | deprecated (D62): `runAgentNotesCheck(options)` and `checkAgentNotes(input)`                 |
| `@cosyte/script-utils/ratchet`       | `runRatchet(options)` and its parts, the coverage and mutation ratchet                       |
| `@cosyte/script-utils/changes`       | `readChanges({ base })`, the lines a change touched against a base ref, read from git        |
| `@cosyte/script-utils/docs-content`  | `runDocsContentCheck(options)` and `checkDocsContent(input)`, the docs-content check         |

They are separate subpaths because they are separately adoptable: a repo can take the entry-point
guard without taking a position on PHI scanning, a repo can take the internal-reference gate without
taking either, and importing one never loads another.

### The four gates from the command line

Each shared gate runs from a repository's package script with no file of its own but one input
(ST34). The dash gate already did; the other three now do too:

| gate           | command                                                     | the one per-repository file       |
| -------------- | ----------------------------------------------------------- | --------------------------------- |
| em and en dash | `bash node_modules/@cosyte/script-utils/check-no-emdash.sh` | `scripts/check-no-emdash.exclude` |
| attw           | `node node_modules/@cosyte/script-utils/attw.js`            | `scripts/attw.exclude`            |
| PHI scan       | `node node_modules/@cosyte/script-utils/phi-scan.js`        | `scripts/phi-scan.exclude`        |
| internal refs  | `node node_modules/@cosyte/script-utils/internal-refs.js`   | `scripts/internal-refs.json`      |

- **attw** runs for the package in the working directory, as the one-line `scripts/attw.mjs`
  caller does. `scripts/attw.exclude` names the resolutions the package leaves out, one per line:
  `node10` alone selects attw's `node16` profile, and `node10` with `node16-cjs` selects `esm-only`.
  It selects a profile and nothing else; any other entry, a repeat, `node16-cjs` alone, or a
  `--profile` argument beside the file is refused at exit 1.
- **PHI scan** runs the engine with the house settings: exit codes 0 clean, 1 hits, 2 refuse; the
  whole repository as the scan root; `--staged` reading everything but Markdown; the allow-list at
  `scripts/phi-allow-list.txt` and the override log at `phi-scan-overrides.md`. Each line of
  `scripts/phi-scan.exclude` is one literal tracked path (`#` lines are comments); a directory, a
  pattern, a repeat or a path git does not track is refused at exit 2. `--allow-list <path>`,
  with `--staged`, with paths or alone, uses that allow list instead of
  `scripts/phi-allow-list.txt` (a relative path is read from the working directory, and the
  repository's own list is not read). A tool scanning a repository that keeps no allow list passes
  an empty file, and the floor then has no exceptions; without the option that repository refuses
  at exit 2. A path the option names that does not exist or cannot be read is refused at exit 2. It
  carries the cross-cutting floor only, so a repository whose standard needs field-level detectors
  keeps a caller passing `detect` until the per-standard detectors ship here.
- **Internal refs** reads its axes from `scripts/internal-refs.json` (keys starting with `$` are
  notes), with exit codes 0 clean, 1 hits, 2 the gate could not run. The file may not set
  `exitCodes`, `repoRoot` or `write`, which the command-line form owns.

### The bins, for a repository with no package.json

Every gate is also a bin (D56), so a repository with no `package.json`, or none that depends on this
package, runs it through npx. `script-utils` is named after the package, so npx runs it by the
package's name and it dispatches to the gate named first:

```sh
npx -y @cosyte/script-utils@0.1 no-emdash          # the dispatcher: script-utils <command>
npx -y -p @cosyte/script-utils@0.1 cosyte-readme   # or one gate's own bin
```

| bin                    | `script-utils` command | the gate                                          |
| ---------------------- | ---------------------- | ------------------------------------------------- |
| `cosyte-no-emdash`     | `no-emdash`            | the em and en dash gate, over files and names     |
| `cosyte-attw`          | `attw`                 | the attw publish gate, for the package here       |
| `cosyte-phi-scan`      | `phi-scan`             | the PHI commit-gate                               |
| `cosyte-internal-refs` | `internal-refs`        | the internal-reference gate                       |
| `cosyte-readme`        | `readme`               | the README gate                                   |
| `cosyte-claude-card`   | `claude-card`          | the CLAUDE.md card checker                        |
| `cosyte-agent-notes`   | `agent-notes`          | deprecated (D62): the retired agent-notes checker |
| `cosyte-catalog`       | `catalog`              | the catalog check                                 |
| `cosyte-ratchet`       | `ratchet`              | the coverage and mutation ratchet                 |
| `cosyte-docs-content`  | `docs-content`         | the docs-content structure check                  |

Each runs over the working directory, takes the arguments its gate takes, exits with the gate's own
code, and prints what it does with `--help`. `script-utils` with no command prints the list and exits 2.
Under CI (`CI` set to anything but empty, `false` or `0`, as GitHub Actions sets it) `--help` and
`-h` print to stderr and exit non-zero (2, or 1 for the dash gate, whose only codes are 0 and 1): help
checks nothing, so a package script that ends in `--help` must not pass a required check.

### The em-dash gate, which is a file rather than a subpath

This package also ships `check-no-emdash.sh`, the one implementation of the em-dash gate for every
`@cosyte/*` repository. It is a shell script and not a module, so it is not in the `exports` map:
nothing imports it, a repository EXECUTES it.

```sh
# The package script every consuming repo keeps, which forwards its arguments:
#   "check:no-emdash": "bash node_modules/@cosyte/script-utils/check-no-emdash.sh"
bash node_modules/@cosyte/script-utils/check-no-emdash.sh              # scan every tracked file
bash node_modules/@cosyte/script-utils/check-no-emdash.sh --stdin PR   # scan text on stdin
bash node_modules/@cosyte/script-utils/check-no-emdash.sh --list-scanned
bash node_modules/@cosyte/script-utils/check-no-emdash.sh --self-id
```

Exit 0 means the mode completed and found nothing banned. Exit 1 means anything else: a banned form
was found, an input could not be read, an input was not scanned, a declaration was unusable, or an
argument was not recognized. There is no third code. Hits and diagnostics go to stderr in every mode.

`--self-id` prints the sha256 of the copy that is executing, so a repository can prove it is running
these bytes rather than a fork of them. `--list-scanned` prints the NUL-separated, repo-root-relative
path of every tracked file the default scan reads, so a repository adopting the gate can compare its
coverage against whatever it ran before rather than compare two filter expressions.

A repository narrows WHAT IS SCANNED, and only that, through a tracked file at its own top level,
`scripts/check-no-emdash.exclude`: one entry per line, `#` comments and blank lines ignored, an entry
ending in `/` covering every tracked path beneath it, and every entry anchored at the repository
root. An entry that matches no tracked path is refused rather than ignored, because an exclusion that
has outlived its subject is a hole nobody is looking at; an excluded path's name is left out with its
content. Nothing narrows WHAT IS MATCHED: the banned forms are fixed in the gate. They are the em
dash (U+2014) and the en dash (U+2013), in any case, each as the literal character, its URL encoding,
its backslash-u escape (plain, braced and eight-digit), its braced backslash-x escape, its CSS escape
(plain and zero-padded), its Unicode name escape (a backslash, `N` and the character's name in braces), and its named, decimal and hexadecimal
HTML entities, with or without the semicolon and with leading zeros. The default scan also reads
every tracked file's NAME, because a name is copy too.

A changelog whose dated archive predates the generated part names that archive with a boundary line
in the same file, `CHANGELOG.md em-only below ## Released before this file was generated` or
`CHANGELOG.md unread below ## Released before this file was generated`. The text after `below` is a
whole line of that file, matched exactly; from it to the end of the file is the archive. `em-only`
reads the archive for the em dash alone, in every form, so an en dash in an old range passes and an em
dash still fails; `unread` does not read the archive. Above the line the file is read for both dashes
like any other, and its name is scanned as always. A boundary line the file no longer carries is
refused, so a lost heading fails closed, and a file cannot be both left out whole and given a
boundary.

### The README gate

`@cosyte/script-utils/readme` checks a library's README against the house skeleton, and against a
size limit under npm's: the registry keeps only the first 65,536 characters of a README, and the
gate refuses one over 60,000. A library runs it from its package script, with no file of its own:

```sh
# "readme:check": "node node_modules/@cosyte/script-utils/readme.js"
node node_modules/@cosyte/script-utils/readme.js              # the package in this directory
node node_modules/@cosyte/script-utils/readme.js --dir <path> # another package directory
```

The skeleton, in order: the shared lockup tile in a `<picture>` element with the alt text assets
declares for it; `# <package name>`; a one-line `>` tagline of at most 120 characters; the badge row
(npm version, CI, license and Node, one per line, derived from `package.json`); then the sections
`Why this exists`, `Status`, `Install`, `Usage`, `Support`, `Security`, `Contributing` and
`License`, in that order, none empty, with `License` last and linking the repository's `LICENSE` by
its absolute URL. A link to the package's page on docs.cosyte.com sits after `## Usage` begins and
before `## Support`. Other sections may sit between the required ones.

Exit 0 means the README follows the skeleton, 1 that it does not (each finding names its line and
its rule, from `README_RULES`), and 2 that the gate could not read the package: no README, no
`package.json`, or a manifest without the `@cosyte/*` name, the github.com/cosyte repository URL or
the `engines.node` the skeleton is derived from. Nothing is configurable, so no setting switches a
rule off.

### The CLAUDE.md card checker

`@cosyte/script-utils/claude-card` checks the CLAUDE.md card every Cosyte repository keeps: what
must pass before a push, what a change can break that a gate would not show, and the rules that bind
there. The spec is `documentation/claude-card.md` in cosyte/config. A repository runs it with no file
of its own:

```sh
node node_modules/@cosyte/script-utils/claude-card.js              # CLAUDE.md in this directory
node node_modules/@cosyte/script-utils/claude-card.js --dir <path> # another repository
```

The card opens with `# <name>` and a paragraph, then has exactly three level-2 sections in order,
`## Gate`, `## Hazard` and `## Rules` (a heading may go on after its word, as in
`## Rules that bind here`), none empty. It is at most 60 lines, every line at most 100 characters
with code included, and at most 5,120 bytes. When an AGENTS.md sits beside it, the card imports it on
a line of its own, `@AGENTS.md`. Exit 0 means the card follows the spec, 1 that it does not (each
finding names its line and rule, from `CARD_RULES`), and 2 that CLAUDE.md could not be read.

### The catalog

`@cosyte/script-utils/catalog` is the one list of our libraries (ST13): the 8 standards (HL7 v2,
MLLP, FHIR, C-CDA, X12, NCPDP, ASTM and DICOM), the 6 built on them (terminology, transform, deid,
synth, dates and cli), and Pathways, our integration engine, in development and not on npm. Each
record is generated from the package's own `package.json` (name, description, release line,
engines, repository, docs and npm URLs) and carries its tier; the data ships as `catalog.json`
beside the module, and `CATALOG` is that file, frozen.

Each package.json description is that library's one canonical line (ST14). Two sides check it, and
each checks one thing:

- **cosyte/config keeps the catalog fresh.** `node scripts/catalog.mjs check --npm` compares the
  committed catalog with every library's latest release on npm. It runs nightly and before each
  config release, and fails when a library has released a description, release line or engines
  range the catalog does not carry; `write --npm` regenerates it. npm keeps 255 characters of a
  description, so a longer one is fresh when npm holds its first 255, and the run notes it.
- **A library can check its own line, advisory.** With no file of its own:

```sh
node node_modules/@cosyte/script-utils/catalog.js              # the package in this directory
node node_modules/@cosyte/script-utils/catalog.js --dir <path> # another package directory
node node_modules/@cosyte/script-utils/catalog.js --strict     # a disagreement fails
```

It compares the package.json description with the catalog this release of `@cosyte/script-utils`
carries. A disagreement, or a package the catalog does not list, prints both values as a note and
exits 0: a library that changes its description is not held red until the next script-utils
release, because config's check against npm picks the change up once the library is released. Exit
2 means the check could not run (no package.json, or an argument it does not accept). `--strict`
restores the gate: 1 for a disagreement, 2 for an unlisted package.

### The coverage and mutation ratchet

`cosyte-ratchet` holds a repository to a floor file at its root, `quality-floor.json`: each package
directory, relative to the file, with its coverage (lines, branches, functions, statements) and its
mutation score. A floor only rises: `raise` never lowers one, and `check --base` fails a change
that lowers or removes one.

```sh
cosyte-ratchet check --skip mutation                     # coverage against its floor, every run
cosyte-ratchet check --skip mutation --base origin/main  # and a pull request's changed lines
cosyte-ratchet check --skip coverage --base origin/main  # the mutants in a pull request's changed code
cosyte-ratchet raise                                     # move floors up to what was measured
```

`check` prints each metric, its floor and its gap to 100, and exits 1 on any drop. With `--base` it
also holds the change's own code to 100: every changed line coverage counts must have run, and
every mutant in changed code must be killed, unless an inline comment names its reason
(`/* v8 ignore next -- reason */` for coverage, `// Stryker disable next-line all: reason` for a
mutant). It lists every exception it finds in changed code, so the pull request can carry the list,
and an exception with no reason fails. With `--base` it also reads the floor file as it was at the
merge base and exits 1 when the change lowered any floor in it or removed one; raising a floor or
adding one passes. `raise` never lowers a floor. Exit 2 means an input could not be read: the floor
file now or at the merge base, a report a floor needs, or git.

It reads Istanbul's `coverage/coverage-summary.json` and `coverage/lcov.info` (which
`@cosyte/vitest-config` writes), and StrykerJS's `reports/mutation/mutation.json` and `changed.json`
(which `@cosyte/vitest-config/stryker` writes), from each package directory. A changed line any package's
suite ran counts as run.

`@cosyte/script-utils/changes` is how both the ratchet and `@cosyte/vitest-config/mutate` read what a
change touched: the diff from the merge base of the base ref and HEAD to the working tree, plus
untracked files, as each file's changed lines. `readFileAtCommit({ commit, path, cwd })` reads a
file as it was at a commit, which is how the ratchet reads the floor file at the merge base. A base
ref or a path reaches git on standard input, never as an argument, so no value can become a git
option.

```ts runnable
import { parseUnifiedDiff } from "@cosyte/script-utils/changes";

const diff = ["+++ b/src/a.ts", "@@ -3 +3,2 @@"].join("\n");
[...(parseUnifiedDiff(diff).get("src/a.ts") ?? [])]; // => [3, 4]
```

```ts runnable
import { parseFloor, toFloor } from "@cosyte/script-utils/ratchet";

toFloor(98.056); // => 98.05
const floor = parseFloor({ packages: { ".": { coverage: { lines: 98.05 }, mutation: 81.2 } } });
floor.packages["."].mutation; // => 81.2
```

### The docs-content check

`@cosyte/script-utils/docs-content` checks a library's `docs-content/` folder, the pages
docs.cosyte.com renders, against the docs-content standard (decision record 0006 in this
repository). Run it from a package script:

```sh
cosyte-docs-content                # docs-content/ in the working directory
cosyte-docs-content --dir <path>   # another repository
```

It checks the sidebar's shape (`intro`, then Installation, Quickstart, Tutorials, How-to guides,
Explanation, Reference and Troubleshooting in that order, then `testing-and-quality` and
`performance`), that every page is listed once and every listed id is a page, the required pages,
each page's front matter, page names, and the "Current numbers" section on both quality pages,
which holds only the placeholder sentence until the release fills in the numbers. It also resolves
every link into the generated reference, `./api/<page>.md#<anchor>`: the page must exist under
`api/`, and the anchor must be one of its headings, slugged the way docs.cosyte.com slugs them. It
does not read any other link, check the generated pages themselves, or run a sample: the shared
CI's link check, `cosyte-docs-reference` in `@cosyte/process` and the sample runner in
`@cosyte/vitest-config` do those. Exit 0 clean, 1 a finding, 2 the check could not run.

```ts runnable
import { checkDocsContent } from "@cosyte/script-utils/docs-content";

const found = checkDocsContent({ pages: [{ name: "intro", text: "# Intro\n" }], sidebars: null });
found.map((f) => f.rule).includes("front-matter"); // => true
found.map((f) => f.rule).includes("required-page"); // => true
```

### The agent-notes checker, deprecated

`@cosyte/script-utils/agent-notes` and its bin, `cosyte-agent-notes`, are deprecated. They check a
repository's agent notes, `documentation/agent-notes.md`, and every
`documentation/agent-notes.md#<anchor>` pointer into them. On 2026-11-08 the notes were removed from
every Cosyte repository (D62): a CLAUDE.md card stands on its own, and what does not fit on it goes
where it is used, in a test, a comment at the code it guards, an ADR, the README or docs, or a
runbook (`documentation/claude-card.md` in cosyte/config). Remove the package script or CI step that
runs the checker.

Until a minor release removes them, the entry point and the bin keep a repository that still runs
the checker green while its notes are removed. With no `documentation/agent-notes.md` (not tracked,
or deleted from the working tree) the checker exits 0 with one line,
`agent notes: OK, no agent notes (retired, D62)`, whatever still points at the file. A repository
that still has the file is checked as before: exit 0 clean, 1 a finding (file, line and rule from
`AGENT_NOTES_RULES`, then a line saying the notes are retired), and 2 that the check could not run.

```ts runnable
import { checkAgentNotes, NOTES_PATH } from "@cosyte/script-utils/agent-notes";

// The file it checks, which no repository keeps any more.
NOTES_PATH; // => "documentation/agent-notes.md"

// A card with no notes and nothing pointing at them has no findings.
checkAgentNotes({ claude: "# demo\n\nOur demo.\n", notes: null, files: [] }); // => []
```

## Overrides

`isCliEntrypoint` has no options and cannot be overridden. It answers one question and its
tie-breaking direction is the whole design, so a knob to invert it would be a knob to turn the gate
off.

`runPhiScan` is configured entirely through its `config` argument, along the five axes tabulated
under [the five per-repo axes](#the-five-per-repo-axes) below: three are required because they are
the ones a port gets wrong, and the defaulted ones move for every repo at once through a version
bump.

The engine's own cross-cutting detection floor is not on that list, and it is not overridable.
Neither is the completeness rule that refuses a run which enumerated a target and never read it. A
caller can widen what is scanned and can add detection, and cannot subtract either of those two.

`runInternalRefsScan` follows the same bargain along [its own axes](#the-internal-reference-axes):
four required, six defaulted, and every per-repository difference supplied by the caller. What it
will not accept is a configuration that SUBTRACTS. The canonical rule set, the self-test floor and
every completeness refusal are not caller inputs, and an option that reaches for one of them is
refused by name rather than ignored. So is an option the gate has never heard of: an ignored setting
reads, from the caller's side, exactly like an honored one.

`runAttwGate` takes the narrowest bargain of the four, and deliberately. A caller supplies where it
lives (`callerUrl`, required, no default) and may supply the arguments to forward; everything else
is the gate's. The arguments it will forward are an ALLOW-LIST of two (`--profile` with its value,
and `--no-definitely-typed`), because a deny-list of blinding spellings bought exactly one more
evasion per round: each of `--quiet`, `-q`, `--format json`, `-fjson`, `-qP`, `--config-path`,
`--help` and `--version` was measured making attw exit 0 with nothing for the gate to read.
Widening that set is a deliberate one-line edit in this package, reviewed here, and not something a
caller can do. No net can be switched off.

`cosyte-ratchet` takes the floor file's path, the base ref, and `--skip coverage` or
`--skip mutation` for a run that does not make that report; a skipped metric is printed as skipped,
never as passed. It has no way to lower a floor, and a floor file with a key it does not know is
refused rather than read around: a misspelled metric would be a floor nobody checks.

## PHI and safety

This package ships the machinery of the PHI commit-gate, so it is the one package here that reads
files which may contain patient data. What it does with them, stated narrowly:

- It reads your repository's own files, in your own process, to look for PHI-shaped content. It sends
  nothing anywhere and opens no network connection.
- It **does not log, echo or persist a matched value**. A finding names a path, a locator inside it
  (`(ssn)`, `(email)`, or the field id your own detector raised it against) and the rule that fired;
  the matched bytes are not written into the report, because a gate that prints the secret it found
  has published it into a CI log. A `value` your detector passes to `ctx.hit` is dropped at the
  boundary rather than stored, so nothing downstream can print what no record carries.
- The allow-list and the override log record DECLARATIONS about paths, never content.
- Detection is a floor, not a proof: this package owns a dashed SSN shape and an email at an
  undeclared domain, and everything field-level is yours to supply through `detect`. A clean run
  means nothing this configuration looked for was found, which is not the same as no PHI.

The consumer still owns the rest: deciding what a PHI-bearing field is for its standard, keeping real
patient data out of the repository in the first place, and never illustrating a rule, a fixture or an
issue report with a real value.

## API

### `isCliEntrypoint(import.meta.url)`

Is this module the file Node was pointed at, rather than one imported by something else?

#### Why not compare the strings

The obvious spelling is a one-liner, and several Cosyte repos wrote it by hand:

```js
// Do not do this.
import.meta.url === `file://${resolve(process.argv[1])}`;
```

It compares two strings rather than two paths, so it answers `false` for three ordinary invocations
of the script that contains it. All three were measured on Node 22.23.1, not predicted:

| Invocation                     | What happens                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/gate`            | Node resolves the extension and runs `scripts/gate.js`; `argv[1]` keeps `scripts/gate`, which names no file. `tsx scripts/gate` does the same with `.ts`. |
| A checkout under `/space dir/` | `import.meta.url` percent-encodes to `/space%20dir/`; concatenating `file://` onto a raw path does not.                                                   |
| A symlinked invocation         | Node resolves the main module to its real path, so `import.meta.url` is the target while `argv[1]` is the link. `node_modules/.bin` shims hit this.       |

In every one the guard is `false`, so the gate exits 0 having checked nothing. That is worse than
the defect the gate was written to catch, because the run conclusion is the only thing anyone reads.

`isCliEntrypoint` compares canonical paths, resolves symlinks, and treats an `argv[1]` that names no
file on disk as a specifier Node had to resolve.

#### Which way it errs

When the answer is genuinely ambiguous it returns `true` and the CLI runs. A false positive runs a
gate during an import, which is loud and immediately visible; a false negative skips a gate and
exits 0, which is silent. Those are not symmetric, so the tie goes to running.

It throws a `TypeError` rather than returning `false` when handed something that is not a non-empty
string, for the same reason.

### `runPhiScan(config)`

`@cosyte/script-utils/phi-scan` is the shared machinery of the `@cosyte/*` PHI commit-gate.

```ts
import { exemptsMarkdown, runPhiScan } from "@cosyte/script-utils/phi-scan";

process.exit(
  runPhiScan({
    exitCodes: { clean: 0, hits: 1, refuse: 2 },
    scanRoots: ["."],
    isStagedReadable: exemptsMarkdown,
    detect: (ctx) => {
      // Your standard's field-level detection. Check every PHI-bearing field
      // against ctx.allow, and raise findings with ctx.hit(...).
    },
  }),
);
```

It returns an exit code rather than calling `process.exit`, so a test can drive it in process.

#### Why it is a dependency and not a template file

`scripts/parser-template/` is a **scaffold**, not a dependency: the scaffolder copies it, so fixing
the template fixes no existing repo. That produced thirteen byte-distinct copies of one scanner, and
a newly-found escape therefore cost one pull request and one adversarial review **per repo**. Three
escape classes were paid for that way before this package existed. Here it is one pull request and a
version bump.

#### The boundary: what the engine owns, and what stays in your repo

**The ENGINE, shared and shipped here.** Argument parsing and the three modes (`--staged`, explicit
paths, and the `all`-mode sweep); reading the allow-list and the override log; target enumeration;
the union of the working-tree walk with the bytes git carries at every index path, deduplicated **by
content** under git's own `blob <len>\0` framing; the completeness rule (a target the run enumerated
and never read refuses, naming the paths); the per-root observation rule (`all` mode refuses unless
every `scanRoots` entry yielded a file the WALK read, naming the starved roots); every refusal; and a
cross-cutting detection floor that finds a dashed SSN shape and an email at an undeclared domain over
every file, always.

**A JavaScript or TypeScript source is read twice**: as its bytes, and as the document its string
literals spell, with `\uXXXX`, `\u{...}`, `\xHH` and the single-character escapes decoded (an
escaped backslash first, so a doubled backslash before `u002D` stays text). The floor and your
`detect` run over both views, and the decoded view adds only what the raw view did not report, with
`, escape-encoded in a source literal` on its reason. It is a view, not a parser, so it also decodes a
`String.raw` template or a comment quoting an escape; an `ID <value>` declaration clears such a hit.

**The RULES, local to your repo, never moved and never shipped in this package.**
`scripts/phi-allow-list.txt` (the positive declaration that a token is synthetic, tagged `NAME`,
`DOB`, `ADDR`, `ID`, `EMAILDOMAIN`); `phi-scan-overrides.md` (the `--allow-fixture` audit log, and
whatever category-to-field map your detector reads); and the per-standard field detector you supply
through `detect` (names, DOB, MRN / member id, address, phone, parsed out of your own wire format).

The split is not a convenience. **This package's `files` list ships no repo's rules**, so a
declaration one consumer makes can never travel to another consumer through a version bump: with no
file at `allowListPath` the engine treats every PHI-shaped token as undeclared, and refuses rather
than reporting clean. A rules file is a reviewed, committed act in the repository it describes.

#### The five per-repo axes

Which ones are required is the design, not an oversight.

| Axis                | Option                            | Required?                                                       |
| ------------------- | --------------------------------- | --------------------------------------------------------------- |
| 1 Exit codes        | `exitCodes`                       | **Required.** The siblings disagree; a default would be a port. |
| 2 Roots             | `scanRoots`                       | **Required.** `["."]` is the whole repository.                  |
| 2 Roots (subtract)  | `excludedPaths`, `isWalkReadable` | Defaulted. Moving the shared boundary is one change here.       |
| 3 `--staged` scope  | `isStagedReadable`                | **Required.** It decides what a commit is blocked on.           |
| 4 Gitlinks          | `regularBlobModes`                | Defaulted to git's two regular-blob modes.                      |
| 5 EOL normalization | none                              | Machinery. A port must check it, not set it.                    |

A required axis has no default **because** it is the thing a port gets wrong: carrying an exit code
across a repo boundary is how a caller ends up branching on a meaning that repo never assigned.
A defaulted axis is the opposite case: every repo wants the same answer, so the answer lives here
and reaches all of them through a version bump.

#### Two things worth knowing before you adopt

**A detector that consults nothing has no remedy.** The whole-file `--allow-fixture` bypass is
recorded and then refused, so it cannot reach a clean run. Check every PHI-bearing field against
`ctx.allow`, or a developer meeting your detector has nowhere to go. The engine's own floor does
this on both branches.

**`all` mode needs a git index.** It refuses when git cannot name the index or names it empty,
because without it the sweep is the working-tree walk's word alone. A freshly scaffolded repo has to
`git init` and commit before an `all`-mode run means anything.

**Every scan root has to produce something.** `all` mode refuses when a `scanRoots` entry yielded no
file the walk read, and names it, even when git tracks files under it: those are still read from the
index, but what git carries cannot vouch for a directory on disk. A root that is missing, unreadable,
or whose every file your read filter drops used to leave the sweep quietly narrower than its own
configuration said, and one productive root made the whole run look productive. If you narrow
`scanRoots`, this is the tier that tells you what the narrowing stopped reading. A root naming a
regular file is scanned as one target; one naming a symbolic link is refused rather than followed;
one naming a directory that cannot be listed is refused, naming the path.

**`scanRoots` bounds the WALK, not the index.** `all` mode reads the bytes git carries at every
tracked path, whatever your roots say, because a root list answers what is on disk under it and the
index answers what your repository carries. A hit found there is labelled `(git index)` or
`(git index; the working tree differs)`, with a footer counting them: the second means the file on
disk reads clean, so re-staging is part of the remedy.

**`isStagedReadable` decides what `--staged` REFUSES, not only what it reads.** A staged entry that
is not a regular blob, or that has no stage-0 blob, is refused when this predicate admits it and left
alone when it does not, because what a commit is blocked on is your repository's decision. `all` mode
still refuses such an entry on both of its routes.

### `runInternalRefsScan(config)`

`@cosyte/script-utils/internal-refs` keeps our own bookkeeping off every surface a consumer reads:
item identifiers, phase and wave language, ADR numbers, internal repository paths and traceability
markers, on the pages, the npm metadata and, optionally, the doc comments that compile into shipped
type declarations and the string literals a consumer reads as error and warning text.

```ts
import { runInternalRefsScan } from "@cosyte/script-utils/internal-refs";

process.exit(
  runInternalRefsScan({
    projectPrefixes: ["HL7", "CCDA", "MLLP"],
    standardsDesignations: ["HL7-(?:V2|V3|CDA)", "FHIR-R\\d[A-Z]?"],
    surfacePaths: ["README.md", "TRADEMARKS.md", "LICENSE", "docs-content"],
    accountedTarballFiles: ["CHANGELOG.md", "dist"],
    sourceDocComments: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
    sourceStringLiterals: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
  }),
);
```

It returns an exit code rather than calling `process.exit`, so a test can drive it in process.

#### What exit 0 means, and what it does not

Exit 0 means the run completed, enumerated its configured surface, read every target it enumerated,
passed its own self-tests and found nothing. A hit, an enumerated target that was never read, an
unreadable input, an input a text matcher classifies as binary, a configured surface path the
repository does not track, a `files` entry the configuration does not account for, and a failed
self-test are each a non-zero exit with the cause on stderr. A hit report names the file, the line
and the rule.

#### The internal-reference axes

Four are required, and which four is the design rather than an oversight: each is the axis a port
gets wrong, and a default would be one repository's answer imposed on every other.

| Axis                       | Option                  | Required?                                                             |
| -------------------------- | ----------------------- | --------------------------------------------------------------------- |
| 1 Project prefixes         | `projectPrefixes`       | **Required**, empty refused. Keying on these is why `MSH-2` survives. |
| 2 Standards designations   | `standardsDesignations` | **Required.** Never flagged. An empty list declares no collisions.    |
| 3 Public surface           | `surfacePaths`          | **Required**, empty refused, every entry must be tracked.             |
| 4 Tarball accounting       | `accountedTarballFiles` | **Required.** The `files` entries already accounted for.              |
| 5 Source doc comments      | `sourceDocComments`     | Defaulted OFF. Enable where the build copies doc text verbatim.       |
| 6 Source string literals   | `sourceStringLiterals`  | Defaulted OFF. Enable where messages reach a consumer. No comments.   |
| 7 Exit codes               | `exitCodes`             | Defaulted `{ clean: 0, hits: 1, refuse: 1 }`. `clean` must stay 0.    |
| 8 Added detection          | `extraRules`            | Defaulted `[]`. Each added rule brings its own samples.               |
| 9 Added self-test material | `extraSamples`          | Defaulted `{}`. Additive only.                                        |
| 10 Repository under test   | `repoRoot`              | Defaulted to the working directory, anchored at its git top level.    |
| 11 Report destination      | `write`                 | Defaulted to the process streams.                                     |

`CONFIG_AXES` is the same table as data, so a consumer can enumerate it rather than transcribe it.

The string-literal pass reads double-quoted, single-quoted and template literals (a multi-line
template whole, a `${...}` as a space), decodes their escapes, and also reads the literals on one
source line joined, so a phrase split across `"a " + "b"` is seen. It never reads a comment: a `//`
line, a trailing `//` and a `/* */` block are skipped, so an item identifier in a maintainer's note
stays allowed. A regular-expression literal is skipped too. In both source passes a NUL byte reads as
a space instead of refusing the file, since a raw separator inside a literal is legitimate source;
the clean line counts them.

#### Two things worth knowing before you adopt this one

**The prefix set has to be extended by hand, and that is the cheaper mistake.** A new programme
means adding its prefix, and nothing catches it until someone does. The alternative is a `WORD-N`
shape rule, which flags the segment-field references a parser's documentation exists to provide.

**Every configured prefix has to be reachable.** The self-test floor proves each one still matches,
so a prefix shadowed by a standards designation refuses the run instead of silently contributing
nothing. That is the axis a caller edits most, and a dead entry there is a rule that stopped seeing.

### `runAttwGate(options)`

The `attw` publish gate, run in the working directory of the package being checked. It returns the
exit code a caller should exit with: 0 when every net passed, attw's own status when attw itself
judged the package, and 1 for every refusal.

`attw --pack .` prints "This package does not contain types." and exits **0**, because
`getExitCode()` returns before it reads the problem list whenever the analysis found no types at
all. For a package that ships types, that is a broken publish reported as a pass, and the window it
arrives through is ordinary: `tsup` emits JS in one pass and declarations in a later one, so every
build has a moment where `dist/` holds `.mjs`/`.cjs` and no `.d.ts`.

Four nets, each catching something the others cannot:

1. **Preflight**, over every relative artifact path the manifest promises. A path that is missing or
   empty reds and is named. A manifest that declares NOTHING is refused rather than reported as
   checked: three of the four nets grade that one set, so an empty set makes them vacuous at once.
2. **The document attw prints**, never its prose. The gate forces `--format json` and asserts
   `analysis.types.kind === "included"`, so a route that hides or reformats the output leaves stdout
   unparseable, and unparseable fails closed.
3. **npm's own pack listing.** A declared path can be on disk and out of the tarball, which net 1
   cannot see and which a committed `.attw.json` can hide from attw's exit code. This net asks npm.
4. **The manifest pnpm WOULD PUBLISH.** pnpm applies `publishConfig` as publish-time overrides and
   rewrites the manifest inside the tarball; `npm pack` does not. This org publishes with pnpm, so
   the document net 3 grades is not the one that ships.

What each net does and does not claim, and every measurement behind them, is in `attw.js`'s own
docblock. It is not restated here: a claim written down twice is a claim that drifts.

On Windows the gate checks and starts `node_modules/.bin/attw.cmd`, because the extensionless
`attw` there is a POSIX shell script, and it starts attw, npm and pnpm through `cmd.exe`, because
all three are `.cmd` files that Node will not start without a shell. Every argument and every path
on that command line is in double quotes (a bare name found on PATH, such as `npm`, is not: `cmd.exe`
gives a quoted one the wrong `%~dp0`), with a trailing run of backslashes doubled so node still
reads the closing quote as one, and an argument carrying a double quote, a percent sign or a line break is
refused on every system. Two exports say what the gate starts: `attwBinaryPath(callerUrl,
platform?)`, the binary's path, and `toolCommand(file, args, platform?)`, the command, its arguments
and whether a shell runs it.

## Compatibility

Node `>=22.14`, ESM only, published as source (`index.js`, `phi-scan.js`, `internal-refs.js` and
`attw.js` with hand-written `.d.ts` files) with no build step, so a consumer can import it by
relative path from a checkout as well as by specifier. `runPhiScan` shells out to `git` for the
index-backed half of its sweep, so `all` mode needs git on the path, `runInternalRefsScan` shells
out to `git` for its whole enumeration, and `runAttwGate` spawns the consuming package's own `attw`
binary, `npm pack` and, where a `publishConfig` object is present, `pnpm pack`, through `cmd.exe`
on Windows.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to the scan engine needs a changeset:
a new detection pattern reds a consumer that was passing, and a removed one silently stops catching
something. Never open an issue containing a real PHI value; describe the shape instead.

## License

MIT, copyright Cosyte LLC. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
