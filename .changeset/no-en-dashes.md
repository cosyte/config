---
"@cosyte/script-utils": patch
"@cosyte/test-utils": patch
---

The packed `check-no-emdash.sh` in `@cosyte/script-utils` refuses the en dash (U+2013) as well as the em dash, per the operator decision of 2026-11-07. It matches the en dash in the same six forms it already matched for the em dash: the literal character, its URL encoding, its JS escape and three HTML entity spellings. Its self-test also proves it matches a known en dash and passes a clean line (hyphens, a range written with "to", the minus sign). Exit codes, modes and the exclusion declaration are unchanged, and the messages name both dashes. A tracked file or PR text carrying an en dash in any of those forms now refuses where 0.1.1 printed OK: write a range with "to", and rewrite a pause with a period, a colon, a comma or parentheses.

`@cosyte/test-utils` writes the numeric ranges in its `./perf` doc comments with "to" instead of an en dash. Those comments ship in `dist/perf/*.d.ts` and its source maps. No runner, API, type or constant changes.
