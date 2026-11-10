---
"@cosyte/vitest-config": patch
---

The snippet harness can run every code sample, not only the ones tagged `runnable`: `docSnippetSuite({ every: true })` runs each `ts`, `typescript`, `tsx`, `js`, `javascript` and `mjs` block, and a block that cannot run says why in its fence (`ts no-run <reason>`), which the test report lists as skipped with that reason; a `no-run` with no reason fails. A JavaScript sample now runs as a `.mjs` module, so TypeScript syntax in it fails. New exports: `extractSamples`, `planSamples` and `SAMPLE_LANGS`. Without `every`, nothing changes.
