---
"@cosyte/eslint-config": patch
"@cosyte/prettier-config": patch
"@cosyte/test-utils": patch
"@cosyte/tsconfig": patch
"@cosyte/tsup-config": patch
"@cosyte/vitest-config": patch
---

The bundled `CHANGELOG.md` no longer heads already-shipped content `[Unreleased]`.

Every section now carries the version it shipped in, dated from that release's tag, so a reader of
the published tarball can tell which release a given entry belongs to. Previously the newest entries
sat under `[Unreleased]` in the file that shipped, which meant each release republished the previous
release's notes under a heading saying they had not shipped yet.

Nothing else in the tarball changes: no rule, setting, compiler option, build option, or runner
behaviour is different in any of the six packages.
