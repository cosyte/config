# cosyte/config

The pnpm workspace that publishes the toolchain every `@cosyte/*` repo builds, lints and tests
with: nine packages under `packages/`, the PHI-scan engine in `script-utils` among them. It
also holds the estate baseline, `drift-manifest.json`, which `scripts/drift-check.js` checks.

@AGENTS.md

## Gate

Required checks: `verify (22)` and `verify (24)` (one job, Node 22 and 24) and `actionlint`. Run
from the repo root after `git add`, since the em-dash gate reads only `git ls-files` (#56):

```sh
node scripts/changeset-guard.mjs
node scripts/release-notes.mjs prepare --repo . --out "$RUNNER_TEMP/release-notes"
node scripts/credential-surface.mjs && node scripts/install-hardening.mjs
node scripts/readme-check.mjs && node packages/script-utils/claude-card.js
node scripts/drift-check.js && pnpm install --frozen-lockfile && pnpm check:no-emdash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test
pnpm quality:check --base origin/main && pnpm build && pnpm attw
actionlint
```

- Outside CI: `RUNNER_TEMP` set to a scratch directory, every `pnpm` on `PATH` at 10.34.5 (a newer
  one fails the scripts and tests that call it bare), and a checkout named `config`, or
  `drift-check.js` exits 2, "nothing was graded".
- Not required, but red if they fail: CI's `release-dry-run` job (publish and pack dry runs), and
  `no-emdash.yml`, which also reads the PR title, the PR body and every commit message.

## Hazard: a change here reaches every repo

The PHI-scan engine in `packages/script-utils/phi-scan.js` runs in the parsers' commit gates, and
every new parser starts as `scripts/parser-template/`. A change that narrows a pattern, skips a
path or reports clean after reading nothing turns PHI detection off wherever they run, silently.

- Prove an engine or template change red before green against a leak it must still catch (#114:
  `OK: no hits` over an emptied `src`). A change that makes the engine refuse less names what still
  refuses in `documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md`.
- A hit names the place and the rule, never the matched value: reports used to copy it into the CI
  log (`packages/script-utils/CHANGELOG.md`, "a finding names a position").

## Rules

- A change to what a package ships needs a changeset that bumps it; anything else gets none. A
  changeset that bumped nothing withheld a whole release on a green run (#41).
- Nothing that packs, publishes or installs goes in a `prepublishOnly`: it broke every version bump
  (#40). A gate or test spawning npm or pnpm checks which `npm_config_*` the child inherits (#47).
- A gate that could not read its input exits 2 (0 is clean, 1 a finding), and its tests assert the
  CLI's exit code, each new case seen red first: gates exited 0 on a defect (#42) and unrun (#48).
- The template's own `test/` never runs here: cover a template change in the root suites that run
  the real scaffolder (`test/*scaffold*.test.ts`); new parsers were born red (#43, #57).
- `quality-floor.json` only rises (`cosyte-ratchet raise`); a PR's changed lines are 100% covered
  and its mutants killed (CI's `mutation` job), or an inline exception names its reason
  (`documentation/decisions/0004-the-testing-standard.md`).
- Keep `fetch-depth: 0` in `verify` and the release jobs, and `persist-credentials: false` on the
  version job: without them the notes gate passes blind and a Version PR gets no checks (#45).
