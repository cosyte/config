---
"@cosyte/process": patch
---

`cosyte-process format` now runs prettier 3.9.10 (was 3.8.3). Prettier's 3.9 line fixes Markdown,
TypeScript and CSS formatting cases, so a repo's first `format --check` after this update can name
files to reformat; `cosyte-process format` rewrites them.
