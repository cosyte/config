# AGENTS.md

`cosyte/config` is our shared toolchain: a pnpm workspace that publishes eight `@cosyte/*` packages
to npm under MIT from `packages/` (the ESLint, Prettier, TypeScript, tsup and Vitest configs,
`test-utils`, `process`, and `script-utils`, which carries the PHI-scan engine and the shared
gates). It also holds the parser template, `scripts/parser-template/`, that
`scripts/scaffold-parser.mjs` copies into every new parser repository.

## Build and test

Use Node.js 22.22.2 or later and pnpm 10.34.5, the version `packageManager` in `package.json` pins.
tsup 9 and eslint-plugin-jsdoc 65 need that Node. The root `engines.node` stays `>=22.14`: it is the
floor that a package declaring no `engines` of its own reports.
Scripts and tests call a bare `pnpm`, so put 10.34.5 first on PATH.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## The gate

Run these from the repository root, in this order, after `git add`: the dash gate reads only tracked
files. CI runs them on Node.js 22 and 24.

```sh
node scripts/changeset-guard.mjs
node scripts/release-notes.mjs prepare --repo . --out "$RUNNER_TEMP/release-notes"
node scripts/credential-surface.mjs
node scripts/install-hardening.mjs
node scripts/readme-check.mjs
node packages/script-utils/claude-card.js
node scripts/drift-check.js
pnpm install --frozen-lockfile
pnpm check:no-emdash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm quality:check --base origin/main
pnpm build
pnpm attw
actionlint
```

Outside CI, set `RUNNER_TEMP` to a scratch directory, and run `drift-check.js` from a checkout whose
directory is named `config`: under any other name it exits 2, "nothing was graded".

`pnpm quality:check` is the coverage ratchet: it compares the coverage `pnpm test` just measured
in each package with `quality-floor.json`, and with `--base` also requires every changed line to
have run. Mutation testing runs in CI's `mutation` job on a pull request, over the files it changed;
to run it locally, `pnpm exec cosyte-mutate changed --base origin/main` in `packages/vitest-config`,
`packages/test-utils` and `packages/process`, and
`pnpm exec cosyte-mutate changed --base origin/main --config packages/script-utils/stryker.config.mjs`
from the root, then `pnpm exec cosyte-ratchet check --skip coverage --base origin/main`.
`documentation/decisions/0004-the-testing-standard.md` is the standard.

A change to what a package ships needs a patch changeset (`pnpm changeset`); anything else gets
none. `RELEASING.md` covers the release.

## Data

Synthetic data only: real patient data never enters this repository, in a fixture, a test, an
example, an issue, or a log. The PHI-scan engine here runs in every parser's commit gate, so a
change to it, or to the parser template, is proved red against a leak it must still catch before it
is proved green.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). See also
[CONTRIBUTING](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md).
