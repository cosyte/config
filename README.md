# cosyte-config

The single source of truth for how `@cosyte/*` packages are type-checked, linted, and formatted.
Small published packages, consumed by each parser as devDependencies: no per-repo config
copies, no drift.

| Package                                               | What it is                                                                                                                                                                                    | How a package consumes it                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@cosyte/tsconfig`](packages/tsconfig)               | `base.json` (type-check options) + `library.json` (adds declaration/sourcemap emit)                                                                                                           | `"extends": "@cosyte/tsconfig/base.json"`                                                 |
| [`@cosyte/eslint-config`](packages/eslint-config)     | ESLint 10 flat config: unified `typescript-eslint` (`recommendedTypeChecked`) + JSDoc gates on public exports + cosyte rules (apps opt out of the doc/console gates via `{ library: false }`) | `import cosyte from "@cosyte/eslint-config"; export default cosyte(import.meta.dirname);` |
| [`@cosyte/prettier-config`](packages/prettier-config) | The cosyte Prettier settings                                                                                                                                                                  | `"prettier": "@cosyte/prettier-config"` in `package.json`                                 |
| [`@cosyte/script-utils`](packages/script-utils)       | Zero-dependency helpers for the gate scripts in `scripts/`, starting with `isCliEntrypoint`                                                                                                   | `import { isCliEntrypoint } from "@cosyte/script-utils";`                                 |

The standard these encode is documented in the meta-repo's `documentation/conventions.md`
("Canonical toolchain (enforced)"). `hl7` is the reference consumer.

## Install hardening

Two pnpm resolution settings defend every install of this repository, and both ship switched **off**
at the pinned `pnpm@10.34.5`, so both are in force only because
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) says so:

| setting             | value          | what it refuses                                                                                          |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `minimumReleaseAge` | `1440`         | any dependency version, direct or transitive, published less than 24 hours ago                           |
| `trustPolicy`       | `no-downgrade` | any version whose trust evidence is weaker than that of an earlier-published version of the same package |

The 24 hours is pnpm's own number and its own reasoning: "Since malware is usually detected quickly,
delaying updates by 24 hours will most likely prevent you from installing a bad version"
([supply-chain security](https://pnpm.io/supply-chain-security)). The requirement itself is declared
in [`drift-manifest.json`](drift-manifest.json)'s `installHardening` group, which is where the same
two settings are required of every `@cosyte/*` package repo, so this repository is graded against the
standard it publishes rather than exempt from it.

**The exception route.** A package that has to be let through goes in `minimumReleaseAgeExclude` or
`trustPolicyExclude` in `pnpm-workspace.yaml`, pinned to an exact version, with a
`# reason: ...` comment on the line above it. The reason is not a courtesy:
`scripts/install-hardening.mjs` fails and names any exemption that does not carry one, and a change
to either setting or to the exclusion lists must also be a reviewed diff in
[`npm-config-allow.json`](npm-config-allow.json), which pins what a release may be configured with.

**What enforces it.** `pnpm run install-hardening` (`scripts/install-hardening.mjs`) runs in CI's
required `verify` job, **before** `pnpm install --frozen-lockfile`. It reads the required floor out
of `drift-manifest.json`, asks pnpm for the value it would actually use, and refuses rather than
passing when the settings file is missing or unparseable, when an environment variable or CLI flag
disagrees with it, or when the pnpm on the path predates the setting and would ignore the key.

**What it does not do.** A cooldown is a detection-window bet, not a proof. `no-downgrade` says
nothing about a package that never carried trust evidence at all. And at pnpm 10.34.5 both checks run
during RESOLUTION, so `pnpm install --frozen-lockfile` skips them entirely: an entry already in
`pnpm-lock.yaml` is not re-verified (the `trustLockfile` verification pass is a pnpm v11 feature).
They defend the moment a dependency enters the lockfile, which is the moment that matters.

## Decisions

Repo-scoped ADRs live in [`documentation/decisions/`](documentation/decisions). Cross-repo choices
stay in the meta-repo's `documentation/decisions/`; these are the ones only `config` binds.

- [`0001: The performance measurement contract`](documentation/decisions/0001-perf-measurement-contract.md)
  covers how `@cosyte/test-utils/perf` measures: estimator, warmup, the ratio ceiling/floor, coverage,
  `src`-vs-`dist`, and the GC rules. Every constant traced to the PERF-P0 calibration in
  [`experiments/perf-calibration/`](experiments/perf-calibration) or to a written judgement note.

## Versioning

Every package follows the cosyte ladder: **`0.0.x` until first alpha**. Releases are managed with
Changesets and, once the environment is created (a one-time setup step), gated on a protected
`release` environment; the full pipeline (and the OIDC / npm provenance migration deferred to launch)
is documented in [`RELEASING.md`](RELEASING.md).
