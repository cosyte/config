---
"@cosyte/process": patch
---

`cosyte-docs-reference` now refuses a markdown heading written in a TSDoc comment (a line such as `## Notes`, outside code), on an export or anywhere inside one, including a parameter, a member and the package's own comment. The page prints a comment as it is, so the heading would sit in the page's outline among the generated ones and shift their anchors. Each is named with where it is, the pages are still written, and the command exits 1; `--check` exits 1 on them too. `buildReference` returns them as `headings`.
