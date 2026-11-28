---
"@cosyte/script-utils": patch
---

`CATALOG` now records Pathways as released on npm and lists `@cosyte/ihe`, the IHE parser, as a standard that is not on npm yet: the engine record's `status` is `released`, its `onNpm` is `true`, it carries an `npm` URL, and its `description` is the one in Pathways' `package.json`.

Every library record now carries `onNpm`, and a record carries its `npm` URL only when the package is on npm, so the `npm` field of `CatalogLibrary` is optional in the declarations. `CATALOG.libraries` holds 15 records, 9 of the standard tier. In `catalog/tiers.json`, a standard is on npm unless its entry says `"onNpm": false`, and the freshness check reads every package marked on npm, Pathways included, from its latest release.

What a caller must change: code that reads `library.npm` from `CATALOG` must handle a record with no `npm` field (read `library.onNpm` first), and a count or list built from `CATALOG.libraries` now includes `@cosyte/ihe`.
