---
"@cosyte/script-utils": patch
---

A new entry point, `@cosyte/script-utils/readme`: the README gate for every `@cosyte/*` library. It checks the house skeleton (the shared lockup tile with the alt text assets declares for it, `# <package name>`, a one-line tagline, the badge row for npm version, CI, license and Node derived from `package.json`, the sections Why this exists, Status, Install, Usage, Support, Security, Contributing and License in that order with none empty, a link to the package's page on docs.cosyte.com between Usage and Support, and License last with an absolute link to the repository's LICENSE) and refuses a README over 60,000 characters, because npm keeps only the first 65,536. Run it with `node node_modules/@cosyte/script-utils/readme.js`; it exits 0 when the README follows the skeleton, 1 with each finding's line and rule, and 2 when it cannot read the package. `checkReadme`, `badgeRow`, `runReadmeGate` and the constants it checks against are exported.
