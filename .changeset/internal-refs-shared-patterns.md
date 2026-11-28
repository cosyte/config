---
"@cosyte/script-utils": patch
---

The internal-reference gate (`cosyte-internal-refs`, `runInternalRefsScan`) now scans more files and looks for more id forms, so a repository that adopts this version may see findings its last run did not report.

Every run now reads, whatever `scripts/internal-refs.json` says: the files under `.changeset/`, `CLAUDE.md`, `AGENTS.md` and `.github/workflows/` whole, and every `//` and `/* */` comment and every string literal in the JavaScript and TypeScript under `src/`, `test/` and `tests/`. Before, it read only `surfacePaths`, plus doc comments and string literals where those passes were turned on. A comment hit is labelled `/ comment`. An exclude pathspec already in `surfacePaths`, `sourceDocComments.paths` or `sourceStringLiterals.paths` holds for the matching default pass too.

Six rules join the canonical set, so every repository gets them without an extra rule of its own: item, decision and standard ids, tracking row ids, plan and roadmap citations, decision numbers, private repository names and paths, and session ids. They are built to let field names (`PID-5`, `CX-1`, `ORG-1`, `ST01`, `407-D7`), standards names (`ISO-8601`, `UTF-8`, `RFC-5322`), table and transaction numbers (`HL7-0396`, `X12-837`) and code values (`D64.9`, `U+D800`) through. `canonicalRuleNames()` now returns 12 names, and `extractComments`, `DEFAULT_SURFACE_PATHS` and `DEFAULT_SOURCE_ROOTS` are new exports. A repository's own `extraRules` keep working, and now run over the new files as well.

What a caller must change: run the gate once after upgrading and fix each new finding, by rewording the reference in words a reader can check. A file the gate must not read, such as a generated table, is left out with one exclude pathspec naming its literal path in the matching axis, with the reason beside it in a `$` note.
