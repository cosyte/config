---
"@cosyte/script-utils": patch
---

A new entry point, `@cosyte/script-utils/catalog`: the one list of our libraries. It holds a record for each of the 14 libraries, the 8 standards (HL7 v2, MLLP, FHIR, C-CDA, X12, NCPDP, ASTM and DICOM) and the 6 built on them (terminology, transform, deid, synth, dates and cli), and one for Pathways, our integration engine, in development and not on npm. Each record is generated from the package's own package.json (name, description, release line, engines, repository, docs and npm URLs) and carries its tier. The data ships as `catalog.json` beside the module, and `CATALOG` is that file, frozen. Every library can run `node node_modules/@cosyte/script-utils/catalog.js` to check that its package.json description is the catalog's: it exits 0 when they agree, 1 with both values when they do not, and 2 when the package is not listed or package.json cannot be read.
