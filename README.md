# cosyte-config

The single source of truth for how `@cosyte/*` packages are type-checked, linted, and formatted.
Three small published packages, consumed by each parser as devDependencies — no per-repo config
copies, no drift.

| Package                                               | What it is                                                                                                                                                                                     | How a package consumes it                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@cosyte/tsconfig`](packages/tsconfig)               | `base.json` (type-check options) + `library.json` (adds declaration/sourcemap emit)                                                                                                            | `"extends": "@cosyte/tsconfig/base.json"`                                                 |
| [`@cosyte/eslint-config`](packages/eslint-config)     | ESLint 10 flat config — unified `typescript-eslint` (`recommendedTypeChecked`) + JSDoc gates on public exports + cosyte rules (apps opt out of the doc/console gates via `{ library: false }`) | `import cosyte from "@cosyte/eslint-config"; export default cosyte(import.meta.dirname);` |
| [`@cosyte/prettier-config`](packages/prettier-config) | The cosyte Prettier settings                                                                                                                                                                   | `"prettier": "@cosyte/prettier-config"` in `package.json`                                 |

The standard these encode is documented in the meta-repo's `documentation/conventions.md`
("Canonical toolchain (enforced)"). `hl7` is the reference consumer.

## Versioning

Every package follows the cosyte ladder: **`0.0.x` until first alpha**. Releases are managed with
Changesets.
