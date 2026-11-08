---
"@cosyte/process": patch
---

`cosyte-process check` now fails a consumer whose direct `vitest` (in `devDependencies` or `dependencies`) is not exactly the version this package pins, a caret range included: test files type-check against the consumer's vitest while `cosyte-process test` runs this package's. The README now says a wired consumer keeps `vitest` pinned exactly to that version for types, instead of declaring no direct vitest at all.
