---
"@cosyte/tsconfig": patch
"@cosyte/eslint-config": patch
"@cosyte/prettier-config": patch
---

Bump the shared baseline to ES2023 + ESLint 10, and ship per-package README + CHANGELOG.

- `@cosyte/tsconfig`: `target`/`lib` ES2022 → ES2023.
- `@cosyte/eslint-config`: ESLint 10 stack (`@eslint/js` ^10, `eslint-plugin-jsdoc` ^63,
  `typescript-eslint` ^8.62); `typescript` is now a declared peer; the `eslint` peer accepts ^9 || ^10
  during the migration window.
- `@cosyte/prettier-config`: no config change; now ships its README/CHANGELOG.

Pre-alpha `0.0.x` ladder: patch bumps (breaking changes are allowed and called out in each CHANGELOG).
