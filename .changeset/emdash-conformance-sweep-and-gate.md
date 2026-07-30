---
"@cosyte/eslint-config": patch
"@cosyte/prettier-config": patch
"@cosyte/test-utils": patch
"@cosyte/tsconfig": patch
"@cosyte/tsup-config": patch
"@cosyte/vitest-config": patch
---

EMDASH-CONFORMANCE part 2: every em dash is gone from the published READMEs, doc comments and the `@cosyte/test-utils` npm description, and a `check:no-emdash` gate now keeps them out.

No API, type, or signature change in any of the six packages. Seven assertion-failure message strings in `@cosyte/test-utils` are repunctuated and do ship in `dist`; they are the diagnostics a failing conformance run prints, so a test asserting on their exact text would need updating. Nothing in this ecosystem does.

Why these packages are versioned for a punctuation change: a README and a `description` ship inside the tarball and render on the npm package page, so they are consumer-visible surfaces. `@cosyte/test-utils` is the one whose `description` itself changed.

Measured over all 126 tracked files, byte level, before the sweep: 529 occurrences of U+2014 as the literal character across 73 files (42 of them not markdown, 31 are), plus one in an ENCODED form that a literal-character sweep passes straight over. That one was the JS escape in `scripts/parser-template/package.json`'s npm `description`, which is the scaffold `scripts/scaffold-parser.mjs` generates every new parser repo from, so it was on its way into the published `description` of every future `@cosyte/*` parser.

Three occurrences carried a VALUE rather than punctuation and were converted by hand before any bulk transform ran: the null-cell placeholder in `experiments/perf-calibration/analyze.mjs`, the "not applicable" cell in `ANALYSIS.md`'s runner-class table, and the 60-character separator rule in `scripts/drift-check.js`.

The gate (`scripts/check-no-emdash.sh`, wired as `check:no-emdash` and into `no-emdash.yml`) also closes cross-repo residual (iv), which every other copy in the ecosystem records as a known hole: it unsets any interposed `grep`/`xargs`/`sed`/`awk` shell function and runs a scanner-visibility probe that refuses rather than reporting a clean tree when the grep in use silently skips a file.
