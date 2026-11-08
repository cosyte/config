---
"@cosyte/script-utils": patch
---

The internal-refs gate gains a source string-literal pass, `sourceStringLiterals: { enabled, paths, extraRules }`, off by default like the doc-comment pass. It reads the double-quoted, single-quoted and template literals in the tracked source under `paths`, decoded, plus the literals on each line joined, because a string literal reaches a consumer as error and warning text. It never reads a comment, so an item identifier in a `//` note or a `/* */` block stays allowed, and it skips regular-expression literals. In both source passes a NUL byte now reads as a space instead of refusing the file: a raw separator inside a literal is legitimate source, and a space keeps the word boundary beside it. The public-surface pass still refuses a NUL-bearing target.
