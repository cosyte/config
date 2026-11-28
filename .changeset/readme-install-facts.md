---
"@cosyte/process": patch
---

README: a consumer declares a tool this package runs (tsup, `@vitest/coverage-v8`, eslint, prettier, typescript) directly only when its own code imports it, pinned to the exact version this package pins, with vitest as the usual case. Before, the README said a consumer declares none of them except vitest.
