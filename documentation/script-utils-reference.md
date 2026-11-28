# `@cosyte/script-utils`: gate reference

The detailed rules of three gates in `@cosyte/script-utils`, kept here so the package README stays
under the size npm displays whole. The README says what each gate is and how to run it, and links to
the section here that holds the detail.

## The em-dash gate: what is scanned and what is matched

A repository narrows WHAT IS SCANNED, and only that, through a tracked file at its own top level,
`scripts/check-no-emdash.exclude`: one entry per line, `#` comments and blank lines ignored, an entry
ending in `/` covering every tracked path beneath it, and every entry anchored at the repository
root. An entry that matches no tracked path is refused rather than ignored, because an exclusion that
has outlived its subject is a hole nobody is looking at; an excluded path's name is left out with its
content. Nothing narrows WHAT IS MATCHED: the banned forms are fixed in the gate. They are the em
dash (U+2014) and the en dash (U+2013), in any case, each as the literal character, its URL encoding,
its backslash-u escape (plain, braced and eight-digit), its braced backslash-x escape, its CSS escape
(plain and zero-padded), its Unicode name escape (a backslash, `N` and the character's name in
braces), and its named, decimal and hexadecimal HTML entities, with or without the semicolon and
with leading zeros. The default scan also reads every tracked file's NAME, because a name is copy
too.

### A changelog's dated archive

A changelog whose dated archive predates the generated part names that archive with a boundary line
in the same file, `CHANGELOG.md em-only below ## Released before this file was generated` or
`CHANGELOG.md unread below ## Released before this file was generated`. The text after `below` is a
whole line of that file, matched exactly; from it to the end of the file is the archive. `em-only`
reads the archive for the em dash alone, in every form, so an en dash in an old range passes and an em
dash still fails; `unread` does not read the archive. Above the line the file is read for both dashes
like any other, and its name is scanned as always. A boundary line the file no longer carries is
refused, so a lost heading fails closed, and a file cannot be both left out whole and given a
boundary.

## The docs-content check: what each kind of page holds

The check reads whether each page holds what its kind asks, the kind being the sidebar category the
page is listed in. A how-to guide's title begins with an imperative verb (`IMPERATIVE_VERBS`, which
leaves out words read first as nouns, so "Release notes" is a finding), and it has no heading that
begins How, Why or The alternatives. An explanation has no settings table (Key or Option, with a
Default column) and no numbered H2. A tutorial's H2s are numbered steps, `1. ...` or `Step 1: ...`,
ending in "What you built" and "Next". Each library has one `limitations` page, in Reference, and no
other page has a Known limitations or Limitations heading. A page id shares a word with its title and
does not begin `guides-`, `concepts-` or `core-concepts`. A configuration or command reference names
the generator or the test that holds it to the code in its front matter,
`held_by: test/docs-content.test.ts`, and that file names the page's file as a whole path segment.
`held_by` never names a page: a Markdown or MDX file, or any file under `docs-content/`, is refused.
Nor does it name a text file that can only mention the page: a `.markdown` or `.txt` file, or a file
with no extension unless its text begins with `#!`, as a script does.

### Example pages

Every runnable example has a page. A runnable example is a `.ts`, `.mts`, `.js` or `.mjs` file at
the top of `examples/` whose name does not begin with `_` or `.` and that is not a `.d.ts`, a test
or a `*.config.*` file (`isExampleFile`). Its page is `docs-content/example-<name>.md`, listed under
the Examples category, with the H2 headings What it shows, Run it, Expected output (holding a fenced
block with what the example prints) and Code, in that order. The Code section runs to the end of the
page and is the example's file, which `cosyte-docs-content --write` writes and the check compares,
so the code on the page is never pasted by hand. Its fence is marked `no-run` with a reason, since
the example runs from `examples/` in the library's own CI, not as a docs sample. A missing page, a
page whose example is gone, and a Code section that differs from the file each fail, under the
rules `example-page` and `example-code`. The ratchet holds both, at the count of examples with no
page each library had when they landed, so a library is not failed for its existing examples and
fails once it adds one without a page; no library has an `example-code` count. `--write` never
creates a page: what the example shows, how to run it and what it prints are written by hand. It
reads and writes each page through one file descriptor, without following a symbolic link; on
Windows, where Node.js has no `O_NOFOLLOW`, that protection does not apply.

## The internal-reference gate: its axes

`runInternalRefsScan(config)` takes these axes. `CONFIG_AXES` in
`@cosyte/script-utils/internal-refs` is the same table as data, so a consumer can enumerate it
rather than transcribe it.

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

### What the source passes read

The string-literal pass reads double-quoted, single-quoted and template literals (a multi-line
template whole, a `${...}` as a space), decodes their escapes, and also reads the literals on one
source line joined, so a phrase split across `"a " + "b"` is seen. It never reads a comment. Every
run also reads `DEFAULT_SURFACE_PATHS` whole, and each comment and string literal under
`DEFAULT_SOURCE_ROOTS`, whatever the axes say; an exclude pathspec in an axis holds for the matching
default pass. A regular-expression literal is skipped too. In every source pass a NUL byte reads as
a space instead of refusing the file, since a raw separator inside a literal is legitimate source;
the clean line counts them.
