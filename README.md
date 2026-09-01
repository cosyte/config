<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# cosyte-config

> One enforced toolchain for every cosyte package, published as eight small config packages.

[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Shared build/lint/format configuration for the @cosyte/\* packages.

## Why this exists

Every cosyte package needs the same TypeScript options, the same lint rules, the same formatter
settings, the same build and test wiring. Copied into each repository, those files drift: a rule
relaxed in one place to unblock a release stays relaxed, and nobody finds out until two packages
disagree about what "strict" means.

The nearest alternative is a template repository, and it is not this. A template is copied once, so
fixing the template fixes no existing repo. These are published packages instead: a consumer
declares them as devDependencies, and a change to the standard reaches every repository as a version
bump and `pnpm install`.

The standard these packages encode is [`drift-manifest.json`](drift-manifest.json), which is the
cosyte estate's engineering baseline and says of itself that it inherits its authority from no other
document. Every requirement in it carries its own provenance note. There is no prose twin.

## Status

`cosyte-config` is on the cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

This root package is `private: true` and is never published; it is the workspace that builds the
eight `@cosyte/*` packages below, all of which are on that same line. Still moving: the
`@cosyte/process` verb set and its override file, the `@cosyte/test-utils` performance contract
(whose ceiling is still open, see [ADR 0001](documentation/decisions/0001-perf-measurement-contract.md)),
and the shared ESLint rule set, which gains rules as the parsers find gaps.

## Install

`cosyte-config` is the workspace itself, not something to install. Clone it and work in it:

```sh
git clone https://github.com/cosyte/config.git
cd config
pnpm install --frozen-lockfile
```

Node `>=22.14` and pnpm `10.34.5` (the pinned `packageManager`, which is not to be substituted). The
eight published packages are what a consumer installs; each one's own README carries its specifier
and its Node floor.

## Usage

A consumer repository takes what it needs as devDependencies. What each package is, and the one line
that adopts it:

| Package                                               | What it is                                                                                                                  | How a package consumes it                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@cosyte/tsconfig`](packages/tsconfig)               | `base.json` (type-check options) plus `library.json` (adds declaration and sourcemap emit)                                  | `"extends": "@cosyte/tsconfig/base.json"`                                                 |
| [`@cosyte/eslint-config`](packages/eslint-config)     | ESLint 10 flat config: unified `typescript-eslint` (`recommendedTypeChecked`), JSDoc gates on public exports, cosyte rules  | `import cosyte from "@cosyte/eslint-config"; export default cosyte(import.meta.dirname);` |
| [`@cosyte/prettier-config`](packages/prettier-config) | The cosyte Prettier settings                                                                                                | `"prettier": "@cosyte/prettier-config"` in `package.json`                                 |
| [`@cosyte/tsup-config`](packages/tsup-config)         | The cosyte tsup baseline: dual ESM and CJS with declarations, ES2023, treeshake on                                          | `import { cosyteTsup } from "@cosyte/tsup-config";`                                       |
| [`@cosyte/vitest-config`](packages/vitest-config)     | The cosyte Vitest baseline: v8 coverage with gating per-directory thresholds, plus the runnable-docs snippet suite          | `import { cosyteVitest } from "@cosyte/vitest-config";`                                   |
| [`@cosyte/script-utils`](packages/script-utils)       | Zero-dependency helpers for the gate scripts in `scripts/`: `isCliEntrypoint` and the shared PHI-scan engine                | `import { isCliEntrypoint } from "@cosyte/script-utils";`                                 |
| [`@cosyte/test-utils`](packages/test-utils)           | The shared conformance kit for the parsers: round-trip, lenient-mode, immutability, warning-code and PHI-leak runners       | `import { roundTripProperty } from "@cosyte/test-utils";`                                 |
| [`@cosyte/process`](packages/process)                 | One `cosyte-process` bin behind build, test, lint, typecheck, format and check, so script bodies stop being hand-maintained | `"build": "cosyte-process build"`                                                         |

A typical parser repository wires four of them at once:

```sh
pnpm add -D @cosyte/tsconfig @cosyte/eslint-config @cosyte/prettier-config @cosyte/vitest-config
```

`hl7` is the reference consumer: it adopts the toolchain first and the others follow it.

## PHI and safety

This repository publishes build configuration, not a data path. Nothing here parses, stores,
transmits or logs patient data, and no package in it should ever be handed any.

Two packages do carry machinery that exists BECAUSE of PHI, and both are described in their own
READMEs: `@cosyte/script-utils` ships the shared PHI-scan engine that the per-repo commit gates run,
and `@cosyte/test-utils` ships the PHI-leak invariant runners a parser proves itself against. Both
operate on the consumer's own inputs, in the consumer's own process; neither sends anything
anywhere. Never illustrate a config example, a test fixture or an issue report with real patient
data.

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

## The README shape gate

`pnpm run readme-check` grades this repository's own nine READMEs against the house skeleton: the
banner, one H1, a tagline, the house badge row, the manifest `description` verbatim, and then `Why
this exists`, `Status`, `Install`, `Usage`, `PHI and safety`, `Contributing`, `License`. It runs in
CI's required `verify` job.

The governed set is DERIVED from the workspace rather than listed, so a ninth package cannot be added
without a README: it arrives as a refusal, not as a skip. Exit codes follow the house contract, `0`
clean, `1` a violation, `2` could not run, for the reason every gate here holds it: a checker that
cannot read its input must never report the same code as one that read it and found something. It
grades `config` only; an estate-wide README group is a separate change.

## Decisions

Repo-scoped ADRs live in [`documentation/decisions/`](documentation/decisions); these are the ones
only `config` binds.

- [`0001: The performance measurement contract`](documentation/decisions/0001-perf-measurement-contract.md)
  covers how `@cosyte/test-utils/perf` measures: estimator, warmup, the ratio ceiling and floor, coverage,
  `src`-vs-`dist`, and the GC rules. Every constant traced to the PERF-P0 calibration in
  [`experiments/perf-calibration/`](experiments/perf-calibration) or to a written judgement note.

## Versioning

Every published package is on the **`0.1.x`** line: its surface is settled, and bump types follow
ordinary semver (`patch` for a fix, `minor` for an addition, `major` for a removal or a rename)
rather than a pre-alpha rule. `0.1.0` is not a `1.0.0` stability promise; the reasoning and what the
line does and does not claim are in
[ADR 0002](documentation/decisions/0002-the-0-1-0-version-line.md), and the per-package audit behind
it is [`documentation/release-0.1.0-audit.md`](documentation/release-0.1.0-audit.md). Releases are
managed with Changesets and, once the environment is created (a one-time setup step), gated on a
protected `release` environment; the full pipeline (and the OIDC and npm provenance migration
deferred to launch) is documented in [`RELEASING.md`](RELEASING.md).

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome.

A change has to clear the required `verify` job, which runs the release gates and the README gate
before install, then formatting, types, lint, tests, build and the published-types check. A change to
a published package also needs a changeset (`pnpm changeset`) that bumps a real package and says
what changed; `pnpm run changeset:guard` refuses one that cannot.

## License

MIT, copyright Cosyte. See [LICENSE](LICENSE).
