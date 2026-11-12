---
"@cosyte/script-utils": patch
---

`cosyte-docs-content` now requires a page for each runnable example, with the example's code
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
