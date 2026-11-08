---
"@cosyte/eslint-config": patch
---

eslint-plugin-jsdoc moves from ^63 to ^65.4.5, and `engines.node` is now declared as `>=22.22.2`, which eslint-plugin-jsdoc 64 and later require (it is ESM only from 64). The rule set does not change. 65 makes `jsdoc/check-indentation` refuse a missing space after the asterisk, but this config does not turn that rule on, so a consumer sees no new finding from it; run over the source of all sixteen repositories that use this config, 65 reports nothing that 63 did not.
