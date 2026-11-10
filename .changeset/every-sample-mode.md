---
"@cosyte/vitest-config": patch
---

The snippet harness can run every code sample, not only the ones tagged `runnable`: `docSnippetSuite({ every: true })` runs each `ts`, `typescript`, `tsx`, `js`, `javascript` and `mjs` block, and a block that cannot run says why in its fence (`ts no-run <reason>`), which the test report lists as skipped with that reason; a `no-run` with no reason fails. In that mode a JavaScript sample runs as a `.mjs` module, so TypeScript syntax in it fails, and a `tsx` sample as a `.tsx` module; each sample `extractSamples` returns names its module in a new `extension` field, which `runSnippet` reads. New exports: `extractSamples`, `planSamples` and `SAMPLE_LANGS`. Without `every`, nothing changes: every `runnable` block, `tsx` included, still runs as a `.ts` module.
