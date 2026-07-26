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

## Decisions

Repo-scoped ADRs live in [`documentation/decisions/`](documentation/decisions). Cross-repo choices
stay in the meta-repo's `documentation/decisions/`; these are the ones only `config` binds.

- [`0001 — The performance measurement contract`](documentation/decisions/0001-perf-measurement-contract.md)
  — how `@cosyte/test-utils/perf` measures: estimator, warmup, the ratio ceiling/floor, coverage,
  `src`-vs-`dist`, and the GC rules. Every constant traced to the PERF-P0 calibration in
  [`experiments/perf-calibration/`](experiments/perf-calibration) or to a written judgement note.

## Versioning

Every package follows the cosyte ladder: **`0.0.x` until first alpha**. Releases are managed with
Changesets and — once the environment is created (a one-time setup step) — gated on a protected
`release` environment; the full pipeline (and the OIDC / npm provenance migration deferred to launch)
is documented in [`RELEASING.md`](RELEASING.md).
