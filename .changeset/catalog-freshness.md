---
"@cosyte/script-utils": patch
---

The catalog check a library runs is now advisory. `cosyte-catalog` (and `catalog.js`) still compares the package.json description with the catalog this release carries, but a disagreement, or a package the catalog does not list, prints both values as a note and exits 0: a library that changes its description is no longer held red until the next script-utils release. `--strict` (or `{ strict: true }`) restores the gate, 1 for a disagreement and 2 for an unlisted package; 2 still means the check could not run. Keeping the catalog fresh moves to cosyte/config, which compares it with every library's latest release on npm (its description, release line and engines range) nightly and before each config release, and regenerates it from there.
