---
"@cosyte/eslint-config": patch
---

Add an application mode: `cosyte(rootDir, { library: false })` drops the JSDoc + `@example` gate and
`no-console` while keeping every type-safety rule (no `any`, no unjustified casts, exhaustiveness,
strict imports). Libraries (the default, `library: true`) are unchanged.

Applications — like the `pathways` engine — are now first-class consumers of the one shared config
instead of forking it or overriding rules locally: an app has no published API surface to document and
legitimately logs. Type safety is identical across libraries and apps; only the documentation-surface
guardrails differ.
