# Changelog

## 0.1.13

### Patch Changes

- 04ae7b9: `cosyte-docs-content` now reads what each TypeScript and JavaScript sample in a library's README and
  docs-content pages prints, under the new rule `example-print`. A `console` method that prints,
  `process.stdout.write`, `process.stderr.write`, or a printing method of an object named `log`,
  `logger` or ending in `Logger` is a finding when an argument reads an identifying accessor (a name,
  a record or member number, a date of birth, an address, a phone number, an email or a free-text
  note, such as `msg.patient.mrn` or `doc.getMrn()`) or prints a whole message, segment, resource or
  person (`console.log(msg)`, `JSON.stringify(bundle)`). A field read through a person or a name is
  a finding whatever its last name (`patient.gender`, `res.name[0].text`, `patient.photo[0].url`;
  the list is `PERSON_PATHS`), unless it ends in what kind of record it is, a code or a count
  (`patient.type`, `patient.resourceType`; the list is `PERSON_SAFE_ENDS`). A printer is found however the sample calls it: `console["log"]`,
  `console?.log`, `console.log?.()`, a name given to it (`const print = console.log`, `.bind`,
  `const { info } = logger`), and a logger under another name (`const c = console`, `pino()`,
  `createLogger()`, `logger.child()`, `new Console()`). A thrown error whose message carries an
  identifying value is a finding too. A chain that ends in a `length`, `size` or
  `precision` read (`serializeResource(bundle).length` included), a comparison, a type, a count and a
  code are allowed, and so is any field named `message`, which is taken as an error's or a warning's
  text, and a segment read off a locus or a position (`f.locus.segment`, which names a segment such as
  `PID`; the list is `LOCATION_NAMES`). A sample nested more than `PRINT_NESTING_LIMIT` (200) groups and templates deep
  stops the check with exit 2, naming the file and line. A finding names the file, the
  line and the list entry it matched, never the value.

  The rule is advisory: its findings are listed on stdout and never change the exit code. A library
  turns it on, once its samples are swept, with `cosyte-docs-content.config.json` at its repository
  root: `{ "examplePrint": { "required": true } }`. The same object's `accessors`, `wholeValues` and
  `printers` add the library's own names to the lists; any other key or value (`"examplePrint": null`
  included), a list entry that is not a name or dotted names (one that holds a space, say, which
  could never match; a whole value is a single name), or a file that is not JSON,
  stops the check with exit 2. New exports: `samplePrintFindings`, `sampleBlocks`,
  `examplePrintFindings`, `readPrintConfig`, `readReadme` and the lists they read. What a caller
  changes: nothing until it turns the rule on; then each sample that prints an identifying value reads
  it into a variable or asserts on it, with the synthetic value in a comment.

  The docs-content standard (decision record 0006) states the rule, with a right and a wrong example,
  in its new section 14, with what the check cannot catch (a printer passed by reference, a loop or
  callback variable, a helper's arguments, a value copied into a neutral name, a name destructured
  from a person), and is now a page on docs.cosyte.com beside the testing and performance
  standards.

- 13b8aa6: `cosyte-docs-content` now requires a page for each runnable example, with the example's code
  written into the page from its file, and accepts an Examples category in the sidebar.

  - **The Examples category.** It comes after How-to guides, is optional, and holds example pages
    only. `CATEGORIES` gains it, and the sidebar check's messages name it.
  - **A page for each example.** A runnable example is a `.ts`, `.mts`, `.js` or `.mjs` file at the
    top of `examples/` whose name does not begin with `_` or `.` and that is not a `.d.ts`, a test or
    a `*.config.*` file (`isExampleFile`). Its page is `docs-content/example-<name>.md`, listed under
    Examples, with the H2 headings What it shows, Run it, Expected output (holding a fenced block) and
    Code, in that order. A missing page, a page whose example is gone, a page outside Examples, and a
    page under Examples that is not an example page fail under the new rule `example-page`.
  - **The code comes from the file.** The Code section runs to the end of the page and is the whole
    file in a fence titled with its path and marked `no-run`. `cosyte-docs-content --write` writes it
    (also `writeExamplePages(root)` and `exampleCodeSection(file, text)`), and a Code section that
    differs from the file fails under the new rule `example-code`. `--write` never creates a page.
  - **Held by the ratchet.** `RATCHETED_RULES` gains `example-page` and `example-code`, and
    `docs-content-ratchet.json` records each library's `example-page` count: its runnable examples
    with no page, measured with this check at the commit its new `examplesMeasuredAt` names. The file
    also gains `rules`, the rules it holds. No library records an `example-code` count.

  What a caller must change: nothing at once. A library is not failed on this version for its
  examples with no page while they are at or under its recorded count; an example added without a
  page takes it over, and each one fails. It writes each page under an Examples category and runs
  `cosyte-docs-content --write`; the check then says which count to lower in
  `docs-content-ratchet.json` here. The type `DocsContentRatchetedRule` now includes
  `DocsContentExampleRule`. `--write` reads and writes a page through one descriptor without
  following a symbolic link; on Windows, where Node.js has no `O_NOFOLLOW`, that protection does not
  apply.

  `readDocsContent` now also reads `examples/` and returns `examples`, and refuses (exit 2) when
  `examples` is there and is not a directory, or an example is not a regular file. A caller of
  `checkDocsContent` that builds its input by hand passes `examples` to have them checked; without
  it, a page named `example-<name>` is reported as having no example. The unknown-argument message
  now reads "only --dir <repository root> and --write".

- 44d5694: `cosyte-docs-content` now also refuses a `held_by` that names a text file that can only mention the
  page: a `.markdown` or `.txt` file, or a file with no extension unless its text begins with `#!`, as
  a script does. Such a reference is reported under `reference-source` with the message "which is a
  text file, not the generator or the test that holds the reference to the code". What a caller
  changes: a `held_by` that named such a file names the generator or the test instead.
- a32b89e: `cosyte-docs-content` now reads whether each page holds what its kind asks, the kind being the
  sidebar category the page is listed in (decision record 0006, section 12). Seven new rules: a how-to
  guide's title begins with an imperative verb (`howto-title`) and it has no heading that begins How,
  Why or The alternatives (`howto-steps`); an explanation has no settings table and no numbered H2
  (`explanation-content`); each library has one `limitations` page, in Reference, and no other page
  has a limitations heading (`limitations`); a tutorial's H2s are numbered steps ending in "What you
  built" and "Next" (`tutorial-steps`); a page id shares a word with its title and does not begin
  `guides-`, `concepts-` or `core-concepts` (`page-id`); and a configuration or command reference
  names the generator or test that holds it to the code in `held_by:` in its front matter
  (`reference-source`); that file names the page's file as a whole path segment, and it is never a
  page (a Markdown or MDX file, or any file under `docs-content/`). A number with a measured unit outside "Current numbers" is a warning
  (`measured-number`) and never fails.

  A library's findings under the seven rules are held by a ratchet, `docs-content-ratchet.json`,
  which records each library's counts as they were on 2026-11-12, so no library goes red when it
  takes this version. The counts only fall. New exports: `RATCHETED_RULES`, `WARNING_RULES`,
  `DOCS_CONTENT_RATCHET`, `applyDocsContentRatchet`, `docsContentWarnings`, `pageKinds`,
  `isHeldByPath`, `HELD_BY_KEY`, `LIMITATIONS_PAGE`, `TUTORIAL_ENDING`, `KIND_PREFIXES` and
  `IMPERATIVE_VERBS`. `readDocsContent` also returns `sources` and `library`.

  What a caller changes: `checkDocsContent` now returns the seven new rules' findings with the rest,
  unratcheted, so a caller that treats any finding as a failure passes them through
  `applyDocsContentRatchet` first, as `runDocsContentCheck` does. Code that switches over
  `DocsContentRule` sees eight new values.

- 15e7df4: A new check, `cosyte-release-pr` (also `script-utils release-pr` and the `./release-pr` entry point), fails a library whose Version Packages pull request would fail its own checks, and a changeset whose opening sentence the release would refuse.

  - **`version-script`**: the `version` script runs `changeset version`, then the `VERSION` sync, then `cosyte-docs-reference` without `--check`, in that order, so the API reference that prints `VERSION` is regenerated in the release commit. A step may reach a command through another script, such as `pnpm docs:reference`.
  - **`changeset-bullet`** and **`changeset-shape`**: each pending changeset has a front matter block that is not empty and that the release can read, a summary when it releases a package, and an opening sentence of at most 400 characters, measured conservatively as an upper bound on the bullet the release publishes. An empty changeset, the file `changeset add --empty` writes, is refused, because the release cannot read it once consumed: a change that releases no package gets no changeset at all.

  The version rule applies only when a file under `src/` declares an exported `VERSION`. It does not read tests: a release pull request's mutation job proves the test that pins `VERSION` to package.json. Exit 0 clean, 1 a finding, 2 the package could not be read. Nothing existing changes, so a caller changes nothing; a library adopts the check by adding `"check:release-pr": "cosyte-release-pr"` and running it in CI.

## 0.1.12

### Patch Changes

- b99b748: The catalog now carries `@cosyte/synth`'s Node floor from its latest release, `>=22.12.0` (it read `>=22.0.0`). Nothing changes for a caller.

## 0.1.11

### Patch Changes

- c854d59: `@cosyte/script-utils`: the attw gate (`cosyte-attw`, `runAttwGate` and `runAttwCli`) now starts on
  Windows. It used to check `node_modules/.bin/attw` and start it without a shell; on Windows that file
  is a POSIX shell script, so the start failed with ENOENT, and npm and pnpm, which the gate also
  starts, are `.cmd` files there that Node will not start without a shell. On Windows the gate now
  checks and starts `node_modules/.bin/attw.cmd`, and starts all three tools through `cmd.exe` with
  every argument and every path on the command line in double quotes, a trailing run of backslashes
  doubled so each argument arrives whole. Elsewhere nothing changes. Two new exports,
  `attwBinaryPath(callerUrl, platform?)` and `toolCommand(file, args, platform?)`, say which binary and
  which command line. The gate now refuses an argument carrying a double quote, a percent sign or a
  line break, on every system: no argument it accepts needs one. A repository that skipped the attw
  step on Windows can drop the skip once it takes this version. Callers change nothing.

  `@cosyte/bench`: the README now says what the small-input memory budget gives up: a cost in fewer
  than half of a small case's 20 calls is not bounded, the rule switches at a hard 64 KiB edge, and
  the empty-call floor's highest call is not a fixed figure (usually about 29 KiB, once 369,888
  bytes) while its median is stable at about 3.4 KiB. No behavior changes.

## 0.1.10

### Patch Changes

- a926e03: The catalog now records the 0.2 line for @cosyte/transform and @cosyte/deid, matching their latest npm releases, so the release preflight passes again.

## 0.1.9

### Patch Changes

- 65208bf: The docs-content check (`cosyte-docs-content`, `@cosyte/script-utils/docs-content`) now resolves every link a page makes into the generated reference, `./api/<page>.md#<anchor>`: the page must exist under `docs-content/api/`, and the anchor must be one a heading on it gets on docs.cosyte.com (lower case, every character but a letter, a mark, a digit, an underscore, a space or a hyphen dropped, each space a hyphen, a repeat numbered `-1`, `-2`). A link that does not resolve is a finding under the new rule `reference-link`, with its page and line. It also requires the "Current numbers" section of both quality pages to hold only the placeholder, `NUMBERS_PLACEHOLDER`, until the release fills in the numbers: a table, a sub-heading or a sentence added beside it is a finding. `readDocsContent` now returns the generated pages as `reference`, and `headingAnchors(text)` is exported.
- 57847cb: A new subpath, `@cosyte/script-utils/docs-content`, and its bin, `cosyte-docs-content` (also `script-utils docs-content`): the structure check for a library's `docs-content/` folder, against the docs-content standard (decision record 0006 in cosyte/config). It checks the sidebar's shape (`intro`, then Installation, Quickstart, Tutorials, How-to guides, Explanation, Reference and Troubleshooting in that order, then the pages `testing-and-quality` and `performance`), that every page is listed once and every listed id is a page, the required pages, each page's front matter (`id` equal to the file name, `title`, `sidebar_label`, a `description` of at most 160 characters, no `sidebar_position`), page names, and the "Current numbers" section on both quality pages. Exit 0 clean, 1 a finding, 2 the check could not read its input. Nothing else in the package changes.
- cc43161: The PHI scan's command-line form (`cosyte-phi-scan`, `script-utils phi-scan` and `node phi-scan.js`) takes `--allow-list <path>`, the allow list to use instead of `scripts/phi-allow-list.txt`. It goes with `--staged`, with paths, or alone; a relative path is read from the working directory, and the repository's own list is not read. A tool scanning a repository that keeps no allow list can pass an empty file and get a scan with no exceptions, where the scan used to refuse at exit 2 for the missing list. A path the option names that does not exist, or that cannot be read (a directory, no read permission), is refused at exit 2 before anything is scanned, with a line saying which. So are the option with no path, an empty path, and the option given twice. Without the option nothing changes: a repository with no `scripts/phi-allow-list.txt` still refuses at exit 2. `runPhiScan` is unchanged; its `allowListPath` setting already did this for a caller script.
- 5a0470a: Adds the coverage and mutation ratchet: the `cosyte-ratchet` bin (also `script-utils ratchet`) and the `./ratchet` entry point. `cosyte-ratchet check` reads a floor file, `quality-floor.json`, holding each package's coverage (lines, branches, functions, statements) and mutation score, compares what was measured, prints each metric with its floor and its gap to 100, and exits 1 on any drop. With `--base <ref>` it also requires every changed line coverage counts to have run and every mutant in changed code to be killed, unless an inline comment names a reason (`/* v8 ignore next -- reason */`, `// Stryker disable next-line all: reason`), and lists each such exception in changed code; an exception with no reason fails. With `--base` it also reads the floor file as it was at the merge base and exits 1 when the change lowered or removed any floor in it; raising or adding a floor passes. `cosyte-ratchet raise` moves floors up to what was measured and never lowers one. Exit 2 means an input could not be read. Also adds `./changes`, `readChanges({ base })`: the lines a change touched against a base ref, read from git, which the ratchet and `@cosyte/vitest-config/mutate` share, and `readFileAtCommit({ commit, path, cwd })`, a file as it was at a commit. The base ref and the path reach git on standard input, never as arguments.

## 0.1.8

### Patch Changes

- 7dee328: The catalog carries `@cosyte/cli`'s description from its latest npm release, which no longer ends
  with the sentence on value-free diagnostics and the exit-code contract.

## 0.1.7

### Patch Changes

- 9d0d69f: Deprecated: the agent-notes checker, `@cosyte/script-utils/agent-notes` and its bin `cosyte-agent-notes`. The agent notes, `documentation/agent-notes.md`, were removed from every Cosyte repository (D62), so remove the package script or CI step that runs it. Until a minor release removes the entry point and the bin, a repository with no notes file (not tracked, or deleted from the working tree) passes: the checker exits 0 with one line, `agent notes: OK, no agent notes (retired, D62)`, where it used to fail on a pointer left in the card, a source comment or a changelog. A repository that still has the file is checked as before, and a failing run ends with a line saying the notes are retired. `--help`, the `script-utils` command list, the declarations and the README say it is deprecated.
- 9d0d69f: The CLAUDE.md card checker no longer sends detail to `documentation/agent-notes.md`, which was removed from every repository (D62). A card over 5,120 bytes, or with a level-2 heading other than Gate, Hazard and Rules, is told to move the detail to where it is used: a test, a comment at the code it guards, an ADR, the README or docs, or a runbook. What the checker checks, and its exit codes, are unchanged.

## 0.1.6

### Patch Changes

- 239ac9a: The catalog check a library runs is now advisory. `cosyte-catalog` (and `catalog.js`) still compares the package.json description with the catalog this release carries, but a disagreement, or a package the catalog does not list, prints both values as a note and exits 0: a library that changes its description is no longer held red until the next script-utils release. `--strict` (or `{ strict: true }`) restores the gate, 1 for a disagreement and 2 for an unlisted package; 2 still means the check could not run. Keeping the catalog fresh moves to cosyte/config, which compares it with every library's latest release on npm (its description, release line and engines range) nightly and before each config release, and regenerates it from there.
- 4e30735: The dash gate reads a changelog's dated archive the way the repositories that keep one already do. A line in `scripts/check-no-emdash.exclude` of the form `CHANGELOG.md em-only below ## Released before this file was generated` reads the file from that exact line to its end for the em dash alone, in every form, so an en dash in an old range passes while an em dash still reds; `CHANGELOG.md unread below <line>` does not read the archive at all. Everything above the line is read for both dashes as before, the file's name is still scanned, and a boundary line the file no longer carries is refused rather than ignored. The test suite now spells out every encoded form terminology's own scanner carried (the braced escape, lower-case URL encoding, entities with no semicolon or with leading zeros, and the upper-case X), all of which 0.1.4 already refused. The internal-refs slice rule no longer counts `the` or `each` as a determiner: a fixed-width reader's field slice (`the field slices`, `the slice holding the concept code`) is the reader's vocabulary. `this`, `that`, `another`, `previous`, `next`, `final` and `current` still red, so `the final slice` and `the next slice` are still hits, but a bare `the slice` and `each slice` no longer are.
- 409ef6c: Under CI, every gate's `--help` and `-h` now exit non-zero instead of 0: the bins exit 2 and the dash gate exits 1, after printing the help to stderr with a line saying why. Help checks nothing, so a package script such as `"attw": "cosyte-attw --help"` used to pass a required check having run no gate. CI is read the way the common runners set it: `CI` set to anything but an empty string, `false` or `0`. At a terminal `--help` prints to stdout and exits 0 as before.
- 91f8d76: The internal-refs canonical rules take what generalizes from dicom's own gate. An umbrella spec id (`S0228-github-profile-ci-drift`, never a HCPCS code such as `S9083`) is an identifier. The phase rule also catches the adjective forms (`in subsequent phases`, `a later wave`, `waves 2 and 3`) while letting the clinical senses through (`a later phase of the disease`), and a citation of the roadmap (`tracked by the roadmap`). The ADR rule reads the plural, `#` and two-digit forms (`ADRs 0015`, `ADR #0018`, `ADR 23`). The jargon rule catches process commentary (`a later PR`, `this changeset`, `out of scope for this change`) but not `this spec`, `this session` or `this port`, which are reader words in a parser, and lets an image slice in its volume through. The repo-path rule catches the planning files a session writes (`CONTEXT.md`, `REQUIREMENTS.md`, `PITFALLS.md`), the meta-repo or umbrella repo named as a place, and its `work/` and `cards/` directories, and a `decisions/NNNN-` path wherever it sits. Measured on the pinned libraries, this adds 12 hits, all of them real (in hl7, x12 and ncpdp), and removes none. dicom's decision-number, issue-number, `WORD-N` and bare section rules stay dicom's: each collides with reference material another library publishes.
- d75579c: The internal-refs gate gains a source string-literal pass, `sourceStringLiterals: { enabled, paths, extraRules }`, off by default like the doc-comment pass. It reads the double-quoted, single-quoted and template literals in the tracked source under `paths`, decoded, plus the literals on each line joined, because a string literal reaches a consumer as error and warning text. It never reads a comment, so an item identifier in a `//` note or a `/* */` block stays allowed, and it skips regular-expression literals. In both source passes a NUL byte now reads as a space instead of refusing the file: a raw separator inside a literal is legitimate source, and a space keeps the word boundary beside it. The public-surface pass still refuses a NUL-bearing target.
- d30eca0: The PHI engine reads a JavaScript or TypeScript source as the document its string literals spell, as well as its bytes. A literal can spell a dashed identifier's separators as `-`, `\u{2D}` or `\x2D`, and the raw floor read straight past it. Each `.ts`, `.js`, `.mts`, `.cts`, `.mjs`, `.cjs`, `.tsx` and `.jsx` target is now also decoded (an escaped backslash first, so a doubled backslash stays text), and the floor and the caller's `detect` run over that view too, so a field-level detector can parse a record whose separators are escapes. The decoded view adds only what the raw view did not report, and says `escape-encoded in a source literal` on the hit. It is a view, not a parser, so it also decodes a `String.raw` template or a comment quoting an escape; an `ID <value>` declaration in the allow-list clears such a hit. `decodeSourceLiterals` and `isSourceLiteralContainer` are exported.

## 0.1.5

### Patch Changes

- f5e1a1f: The internal-refs phase rule lets two kinds of ordinary prose through. `phase` as the second half of a compound word is no longer a hit (`connect-phase socket`, `two-phase state`, `read-phase timeout`), and neither is `phase` or `phases` followed by `where`, `are`, `was`, `were`, `during` or `at` (`All 5 phases are defined`, `Connection lifecycle phase where the error occurred`). A phase named beside those words is still a hit (`shipped in phase 2`, `Phase 3 was where it failed`, `Phase-L`), and both guards' passages are in the rule's self-test floor, so every run proves them. The catalog is regenerated from each library's current package.json: the terminology, deid and synth descriptions take the serial comma, the cli record carries cli's current description, and cli's engines are `>=22.0.0`.

## 0.1.4

### Patch Changes

- b9b2a7c: Every gate is now a bin, so a repository with no `package.json` can run it through npx: `cosyte-no-emdash`, `cosyte-attw`, `cosyte-phi-scan`, `cosyte-internal-refs`, `cosyte-readme`, `cosyte-claude-card`, `cosyte-agent-notes` and `cosyte-catalog`, each with `--help`, and `script-utils`, the dispatcher npx runs by the package's name (`npx -y @cosyte/script-utils@0.1 no-emdash`). The dash gate also matches every form the marketing and consulting scanner caught, in any case: the characters, URL encoding, the backslash-u escape (plain, braced and eight-digit), the braced backslash-x escape, the CSS escape, the Unicode name, and the named, decimal and hexadecimal HTML entities with or without the semicolon and with leading zeros. It now reads every tracked file's name as well as its content, and answers `--help`. A tracked file or name carrying one of the newly matched forms is refused where 0.1.3 printed OK.

## 0.1.3

### Patch Changes

- f15075b: A new entry point, `@cosyte/script-utils/agent-notes`: the checker for a repository's agent notes, which replaces each library's own. What does not fit on the CLAUDE.md card lives in one file, `documentation/agent-notes.md`, and the card points into it in one form, `documentation/agent-notes.md#<anchor>`. The checker reads every tracked file and requires every pointer to name a heading of the notes (its GitHub slug) or an explicit `<a id>` or `<a name>` target; in CLAUDE.md it also refuses a bare backticked `#anchor` and `agent-notes.md#` without its directory. A notes directory, notes the card never points into, a blank notes file, an empty section and a citation of the umbrella's deleted ADR 0023 or its doc-budget hook are findings. Run it with `node node_modules/@cosyte/script-utils/agent-notes.js`; it exits 0 when clean, 1 with each finding's file, line and rule, and 2 when it cannot run.
- 7a0f98c: The `attw` gate in `@cosyte/script-utils` reads `npm pack --dry-run --json` in both of npm's shapes: the array npm 10 and 11 print, and the object keyed by package name that npm 12 prints. Before this, npm 12's object read as no tarball at all, and the gate refused every package ("npm described 0 tarball(s)"). It still requires exactly one entry whose name is the package's own, and in the object shape the key must match too; any other document is refused as before. The docblock no longer says every repo's `prepare` is the same one-liner: the parser template's `prepare` printed on stdout, inside the JSON this net reads, and twelve sibling repos still carry that line.
- 9d56322: A new entry point, `@cosyte/script-utils/catalog`: the one list of our libraries. It holds a record for each of the 14 libraries, the 8 standards (HL7 v2, MLLP, FHIR, C-CDA, X12, NCPDP, ASTM and DICOM) and the 6 built on them (terminology, transform, deid, synth, dates and cli), and one for Pathways, our integration engine, in development and not on npm. Each record is generated from the package's own package.json (name, description, release line, engines, repository, docs and npm URLs) and carries its tier. The data ships as `catalog.json` beside the module, and `CATALOG` is that file, frozen. Every library can run `node node_modules/@cosyte/script-utils/catalog.js` to check that its package.json description is the catalog's: it exits 0 when they agree, 1 with both values when they do not, and 2 when the package is not listed or package.json cannot be read.
- d0a2576: A new entry point, `@cosyte/script-utils/claude-card`: the checker for the CLAUDE.md card every Cosyte repository keeps. A card opens with `# <name>` and a paragraph, then has exactly three level-2 sections in order, Gate, Hazard and Rules (a heading may go on after its word, as in `## Rules that bind here`), none empty. It is at most 60 lines, every line at most 100 characters with code included, and at most 5,120 bytes, and when an AGENTS.md sits beside it the card imports it on a line of its own (`@AGENTS.md`). Run it with `node node_modules/@cosyte/script-utils/claude-card.js`; it exits 0 when the card follows the spec, 1 with each finding's line and rule, and 2 when CLAUDE.md cannot be read. `checkClaudeCard`, `runClaudeCardGate` and the limits it checks against are exported.
- a71747a: The attw, PHI-scan and internal-reference gates run from the command line, each with one per-repository file, as the dash gate already did. `node node_modules/@cosyte/script-utils/attw.js` runs the attw gate for the package in the working directory, and `scripts/attw.exclude` selects the profile (`node10` alone for `node16`, with `node16-cjs` for `esm-only`). `node node_modules/@cosyte/script-utils/phi-scan.js` runs the PHI engine over the whole repository with exit codes 0, 1 and 2, `--staged` reading everything but Markdown, and the literal tracked paths in `scripts/phi-scan.exclude` left out; it carries the cross-cutting floor only. `node node_modules/@cosyte/script-utils/internal-refs.js` reads the gate's axes from `scripts/internal-refs.json`, with exit codes 0, 1 and 2. The PHI engine's `--staged` route now passes `--ignore-submodules=none` to git, so a staged gitlink is refused even when the user's git config hides submodules from `git diff`. The internal-reference gate's ADR rule also matches an ADR path segment (`docs/adr/0001-scope.md`) and its phase rule the plural (`Phases 1 to 6`), as ten of the eleven per-repository copies did, and an extra rule's pattern may be a `{ source, flags }` object, so a rule read from JSON can be case-insensitive.
- bcdb7ea: The README's license line names the legal owner: "MIT, copyright Cosyte LLC." The READMEs of `@cosyte/eslint-config`, `@cosyte/process` and `@cosyte/script-utils` also use US spelling where they did not (license, behavior, generalize, recognized, honored). No code, configuration or type changes.
- e788688: A new entry point, `@cosyte/script-utils/readme`: the README gate for every `@cosyte/*` library. It checks the house skeleton (the shared lockup tile with the alt text assets declares for it, `# <package name>`, a one-line tagline, the badge row for npm version, CI, license and Node derived from `package.json`, the sections Why this exists, Status, Install, Usage, Support, Security, Contributing and License in that order with none empty, a link to the package's page on docs.cosyte.com between Usage and Support, and License last with an absolute link to the repository's LICENSE) and refuses a README over 60,000 characters, because npm keeps only the first 65,536. Run it with `node node_modules/@cosyte/script-utils/readme.js`; it exits 0 when the README follows the skeleton, 1 with each finding's line and rule, and 2 when it cannot read the package. `checkReadme`, `badgeRow`, `runReadmeGate` and the constants it checks against are exported.

## Released before this file was generated

Every release section above this heading is written by
[Changesets](https://github.com/changesets/changesets) from the changesets in `.changeset/`, newest
release first. A release writes its own version heading, so nothing above this line is maintained by
hand: a change is recorded by adding a changeset rather than by editing this file.

The sections below were kept by hand, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, until 2026-11-07. A version heading
that still read "Unreleased" after its version reached npm now carries that date; no entry was
reworded.

## [0.1.2] - 2026-11-07

### Changed

- **`check-no-emdash.sh` refuses the en dash (U+2013) as well as the em dash** (operator decision,
  2026-11-07). It matches the en dash in the same six forms it already matched for the em dash: the
  literal character, its URL encoding, its JS escape and three HTML entity spellings. Its self-test
  now also proves it matches a known en dash and passes a clean line (hyphens, a range written with
  "to", the minus sign U+2212). Exit codes, modes and the exclusion declaration are unchanged; the
  messages name both dashes. **A tracked file or a PR text carrying an en dash in any of those forms
  now refuses where 0.1.1 printed OK**: write a range with "to", and rewrite a pause with a period,
  a colon, a comma or parentheses.

## [0.1.1] - 2026-09-24

### Fixed

- **`phi-scan`: the per-root observation rule is answered from the WALK's reads only.** It was
  answered from every read the run took, including the index-union reads of the bytes git carries,
  so a scan root that was missing or empty on disk was credited whenever git tracked a file under
  it. In a real repository every root holds tracked files, so the rule never fired for the state it
  exists to catch. Measured before the change: two repositories with `src` emptied on disk, differing
  only in whether `src/index.ts` was tracked, exited at the refuse code and at the clean code with
  `OK: no hits`. **Such a root now refuses at the `refuse` code, naming it.** Those tracked files are
  still read from the bytes git carries and a hit in them is printed before the refusal; the
  completeness rule still counts every read, and a root the walk reads is not refused.

## [0.1.0] - 2026-09-21

### Changed

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** `isCliEntrypoint`
  exports exactly what `0.0.2` exports. The phi-scan engine does NOT: see the entries below, which
  are what this release actually carries on that subpath. The version policy itself is unchanged in
  substance and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.2` does not resolve this release and has to widen its range once, which is recorded as break
  candidate BC-2 in `documentation/release-0.1.0-audit.md`.
- **`phi-scan`: `all` mode refuses unless EVERY scan root yielded a file that was read**, naming the
  starved roots. The completeness rule asks whether every target was read; nothing asked whether a
  root produced a target at all, and one productive root made the whole run look productive.
  Measured before the change: a caller supplying an `isWalkReadable` that admits nothing read no
  file on either sweeping route and printed `OK: no hits` at the CLEAN code over a tracked file
  carrying a live dashed identifier.
- **`phi-scan`: an UNTRACKED file removed mid-run is reported SKIPPED rather than refusing.** A
  target the walk listed and that was gone by read time refused unconditionally, which made an
  ordinary mid-run deletion look like an unaccounted-for file. Git carries no bytes at such a path,
  so nothing the repository holds went unread. The exception is bounded: a tracked file, a
  non-`ENOENT` failure, a path named on argv and a path that came BACK before the run ended all
  still refuse.
- **`phi-scan`: a finding names a position and stops there.** A hit report prints the locus, the
  locator inside it and the rule that fired, and no longer the token that matched:
  `segment=(ssn) (dashed SSN pattern)` where it used to carry the identifier as well. stderr is a CI
  log, and a diagnostic ABOUT a PHI leak that quotes the leak is a second copy of it somewhere with
  no retention policy. `Hit.value` is now optional, a hit the engine reports never carries one, and
  **a gate test asserting that the matched identifier reaches stderr asserts on the locator and the
  rule instead.**
- **`phi-scan`: `all` mode reads the bytes git carries at EVERY tracked path.** `scanRoots` bounds
  the WALK, which answers what is on disk under the roots you declared; the index answers what your
  repository CARRIES, and a root list was narrowing that too. Measured on the first consumer to
  adopt this engine: three real messages under an undeclared top-level directory were read by
  neither route, and a tracked symbolic link outside every root was reached by neither. **A
  repository whose roots are narrower than itself has more of it read after this release.** The two
  READ filters are unchanged and still apply on both sweeping routes, so a tracked `.md` and an
  `excludedPaths` entry mean what they meant. `--staged` is untouched.
- **`phi-scan`: the `--staged` route refuses what `isStagedReadable` admits, and nothing else.** Its
  non-regular and unmerged refusals used to fire for any path under a scan root, so a repository
  whose staged scope is narrower than its roots had commits blocked that its own gate had always let
  through: what a commit is blocked on is a hook decision each repository takes for itself. **This
  refuses LESS at the pre-commit hook.** A staged entry your staged scope declines is still refused
  by `all` mode on both of its routes, so your own sweep catches it; widen `isStagedReadable` if you
  want the hook to refuse it too. Recorded with its compensating control as N1 in
  [ADR 0003](../../documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md).
- **`phi-scan`: a hit in the bytes git carries says WHICH kind it is.** The single
  `(as git carries it)` label becomes `(git index)` for a path whose working-tree copy the run never
  read and `(git index; the working tree differs)` for one whose disk copy carries other bytes, with
  a footer counting how many reported hits are in those bytes. The second kind reads clean in the
  file a developer opens, so re-staging is part of its remedy and one label hid that. **A gate test
  asserting the old label asserts one of the two new ones.**
- **`phi-scan`: an index-route refusal no longer discards the hits already in hand.** An unmerged
  index entry or a tracked link refused the whole sweep before anything was read, so a consumer saw
  a refusal with no indication that PHI had already been found. The walk sweeps first, prints what
  it found, and the refusal follows at the same code.
- **`phi-scan`: a clean run that skipped a file says so on stdout**, as
  `OK: no hits (N untracked file(s) skipped, see stderr)`. With nothing skipped the line is
  byte-identical to what it was.
- **`phi-scan`: a scan root has one settled outcome per KIND.** A regular file is scanned as one
  target, a symbolic link is refused rather than followed, and a directory that cannot be listed is
  refused at your `refuse` code naming the path: that one used to escape `readdirSync` uncaught and
  take node's own exit 1, the code this contract reserves for HITS FOUND. The kind stays DERIVED
  from the filesystem rather than declared, and what that gives up is recorded as N2 in ADR 0003.
- **`phi-scan`: two refusals reworded because their remedies differ.** "git could not read this
  repository's git index" and "the git index holds no entries" were one sentence. The starved-root
  refusal says how many of how many roots went unobserved and names them.
- **`phi-scan`: which tier refuses `--allow-fixture` follows the MODE.** A bypass beside a positional
  path names something the run does not enumerate; a lone bypass declares a path an `all`-mode run
  would have read and is refused by the completeness rule. Both name the path, and neither reaches a
  clean run, which is unchanged.
- The `README.md` in the tarball now opens its `## Status` section on the settled-line sentence
  instead of the pre-alpha ladder one, so the policy text a consumer reads agrees with the version
  printed beside it. `scripts/readme-check.mjs` grades that sentence against the release line the
  pending changesets resolve to.

## [0.0.2] - 2026-08-11

### Added

- **`@cosyte/script-utils/phi-scan`: the shared machinery of the `@cosyte/*` PHI commit-gate, as a
  parameterised engine.** `scripts/parser-template/` is a SCAFFOLD rather than a dependency, so
  `scripts/phi-scan.ts` was COPIED into every parser repo. **Thirteen repos, thirteen byte-distinct
  copies**, so a newly-found escape cost one pull request and one adversarial review PER REPO, and
  three escape classes had already been paid for that way. `runPhiScan(config)` owns argument
  parsing, the allow-list and override log, target enumeration on all three routes, the union of the
  working-tree walk with the bytes git carries, content deduplication under git's own
  `blob <len>\0` framing, the completeness rule, every refusal, and the cross-cutting SSN/email
  floor.

  **THE FIVE PER-REPO AXES ARE PARAMETERS, NOT FORKS**, and which ones are required is itself the
  design. `exitCodes`, `scanRoots` and `isStagedReadable` are **REQUIRED**: the siblings genuinely
  disagree on all three, and a default would be the porting mistake the gate exists to catch (at
  least one sibling uses 2 where another uses 1). `excludedPaths`, `isWalkReadable` (the Markdown
  read exemption) and `regularBlobModes` are **DEFAULTED**, so moving one of those boundaries is a
  change to this package plus a version bump rather than an edit in thirteen repos. EOL
  normalization has **no parameter at all** and stays machinery: the walk/index deduplication is by
  CONTENT, so where a `text` attribute or `core.autocrlf` makes the index carry LF and the working
  tree CRLF, BOTH forms are scanned.

  **Per-standard field detection stays with the caller**, through `detect`. It is handed the
  reported LOCUS rather than the target path, so a hit found in the bytes git carries cannot be
  reported against a working-tree copy a developer would open and find clean. That used to be a
  sentence in a comment; it is now the only path a caller can reach.

- **A scan root may name a regular FILE, and the kind is DERIVED from the filesystem rather than
  declared**, which is what keeps the parameter a plain `string[]`. Measured against the thirteen
  live copies: they declare roots in at least six different shapes, and one declares
  `{ rel, shape: "directory" | "file" }` with a single file among them. An earlier draft fed every
  root to `readdirSync`, so such a root threw `ENOTDIR`, uncaught, and the run took node's exit 1,
  the code this contract reserves for HITS FOUND. **What deriving gives up is stated rather than
  left to be found**: a declaration can notice a root is not the KIND it was meant to be and
  derivation cannot. A root that is neither a file nor a directory is still refused, a root naming a
  symbolic link is refused rather than followed, and a MISSING root is skipped, which is unchanged
  from the copied scanners and is named as the one remaining silently-empty root state.
- **A scan root of `"."` means the whole repository**, with gitignored directories pruned during
  descent and `.git` skipped by literal name, which is what makes a whole-repository root usable at
  all rather than a walk through `node_modules`. Pruning is equivalent to filtering afterwards
  because **`git check-ignore` is index-aware at directory granularity**, measured both ways on git
  2.39.5: with nothing tracked underneath, a gitignored directory is reported ignored and pruned;
  with one file force-added underneath it is reported NOT ignored, so the walk descends and still
  reads it. An earlier draft justified this with the gitignore-pattern rule that a path under an
  excluded directory cannot be re-included, which does not settle it, because the filter being
  replaced asked `check-ignore` too.

### Changed

- **Two containments the first draft ASSERTED are now ENFORCED**, both falsified by this slice's
  adversarial review and both reproduced against the pre-consolidation scanner too, so neither is a
  regression this package introduced. What was introduced was the sentence claiming they held, on the
  API contract thirteen migrations are about to be written against.
  - **A staged path `isStagedReadable` admits that no scan root covers is REFUSED.** The type said
    the `--staged` filter was "narrower than the root half by construction"; nothing constructed it,
    because they are two independent keys. Measured with roots at `["src"]` and the filter at the
    shared Markdown exemption: a STAGED mode-120000 entry under `test/fixtures/` was outside every
    scan root, so the non-regular refusal never saw it, and the route enumerated it, READ it, handed
    the link's TARGET PATH to the detector as if it were content, counted the scan complete and
    printed `OK: no hits` at exit 0. Narrowing silently to the intersection would have been the wrong
    repair: it hides a misconfiguration in the one place the gate blocks a commit.
  - **A scan root is normalised the way every other path is, and one resolving outside the repository
    is refused.** `"./src"` is a spelling the type documents as valid; it walked correctly while
    `isUnderScanRoot` compared it against the normalized index path and never matched, emptying the
    union, the index non-blob refusal and the unmerged refusal in silence. Measured: `["src"]`
    refused a tracked mode-120000 entry at exit 2 while `["./src"]` reported clean at exit 0 over the
    same repository.
- **The optional axes are shape-checked.** `excludedPaths: ["a"]`, a plausible reading of
  "repo-relative paths", used to survive normalization, reach `.has(...)` inside enumeration, and
  take node's exit 1 from there, which the exit contract reserves for HITS FOUND.
- **The floor's dashed-SSN branch now consults `allow.ids`, in either rendering.** This is a
  correction rather than a port: with the whole-file `--allow-fixture` bypass closed, a detector
  that consults nothing leaves a developer with a hit and **no remedy at all**, and a sibling
  shipped a footer claiming the token allow-list was the only remedy that reaches a clean run while
  that was false for exactly this branch. One `ID` entry now covers both the dashed and the undashed
  rendering, so a repo does not have to guess which one a fixture uses.
- **A fatal partway through the sweep prints the hits already found BEFORE the refusal**, instead of
  discarding them. Measured on a mutant that throws after the reads: the old ordering produced a
  refusal with **zero** `HIT:` lines over a corpus containing a real hit. The refusal still wins the
  exit code and the clean line is still unreachable from there, so nothing is reported as accounted
  for that is not.
- **The hit footer is scoped to what the engine can know.** It says the cross-cutting floor consults
  the allow-list and that a repo's own detectors are answerable that way **only if** they consult
  it. The engine cannot see inside a caller's `detect`, so a wider claim would be one it has no
  evidence for.
- **A detector that throws REFUSES the scan** rather than escaping to node's own exit code, which
  this contract reserves for HITS FOUND. A misconfigured scanner throws a `TypeError` rather than
  returning a code: at the point a required axis is missing, `exitCodes` is itself the thing that
  was not supplied, so there is no trustworthy code to return.

## [0.0.1] - 2026-08-05

### Added

- First release. `isCliEntrypoint(import.meta.url)` answers "is this module the file Node was
  pointed at", for the `scripts/*.mjs` gates that must not run their CLI body when a test imports
  them for their exports.

  It replaces the raw string comparison those gates were spelling by hand,
  `` import.meta.url === `file://${resolve(process.argv[1])}` ``, which compares two strings rather
  than two paths and therefore answers `false` for three ordinary invocations: an extension-less
  specifier that Node or `tsx` resolved (`node scripts/gate` running `scripts/gate.js`), a checkout
  under a path containing a space (`import.meta.url` percent-encodes and the concatenation does
  not), and a symlinked invocation (Node resolves the main module to its real path). In each the
  gate exits 0 having checked nothing.

  Those three forms also COMBINE, and the combination is the one that hides: an extension-less
  `argv[1]` names no file, so it cannot be resolved directly, and any symlinked ancestor then puts
  the two sides in different places. `isCliEntrypoint` resolves the deepest ancestor that does
  exist and keeps the rest verbatim, so `tsx scripts/gate` answers correctly under a symlinked
  checkout.

  The package carries no runtime dependencies and no build step, because the gates that import it
  run before `pnpm install` on purpose.
