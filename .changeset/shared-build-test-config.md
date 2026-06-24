---
"@cosyte/tsup-config": patch
"@cosyte/vitest-config": patch
---

Initial release of the shared build + test config packages: `@cosyte/tsup-config` (dual ESM + CJS,
ES2023) and `@cosyte/vitest-config` (v8 coverage, enabled per-directory >= 90 gates). These remove the
per-parser copy-pasted tsup/vitest config so the build and test toolchain is inherited, not copied.
