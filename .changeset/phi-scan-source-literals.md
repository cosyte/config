---
"@cosyte/script-utils": patch
---

The PHI engine reads a JavaScript or TypeScript source as the document its string literals spell, as well as its bytes. A literal can spell a dashed identifier's separators as `-`, `\u{2D}` or `\x2D`, and the raw floor read straight past it. Each `.ts`, `.js`, `.mts`, `.cts`, `.mjs`, `.cjs`, `.tsx` and `.jsx` target is now also decoded (an escaped backslash first, so a doubled backslash stays text), and the floor and the caller's `detect` run over that view too, so a field-level detector can parse a record whose separators are escapes. The decoded view adds only what the raw view did not report, and says `escape-encoded in a source literal` on the hit. It is a view, not a parser, so it also decodes a `String.raw` template or a comment quoting an escape; an `ID <value>` declaration in the allow-list clears such a hit. `decodeSourceLiterals` and `isSourceLiteralContainer` are exported.
