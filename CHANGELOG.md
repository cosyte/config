# Changelog: `cosyte-config` (repo)

Repo-level changes to this monorepo: the shared toolchain spine, the drift check, the parser
scaffold, release plumbing, and supply-chain / governance hygiene. Follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Per-package changes live in each package's own `packages/*/CHANGELOG.md`**:
`@cosyte/tsconfig`, `@cosyte/eslint-config`, `@cosyte/prettier-config`, `@cosyte/tsup-config`,
`@cosyte/vitest-config`, `@cosyte/test-utils`, each hand-maintained on the
**`0.0.x`-until-first-alpha** ladder (Changesets' own changelog generation is disabled). This file
tracks only what those don't own: the workspace root, the drift manifest/check, the scaffold
generator, CI/release, and dependency/governance hygiene. The root workspace is `private` and ships
no package, so entries here are **dated** rather than versioned.

## [Unreleased]

### Changed

- **Published with npm provenance.** The repo is public, so every `@cosyte/*` config package now
  ships a signed SLSA provenance attestation linking the tarball to the exact commit and workflow
  that built it: verifiable with `npm audit signatures`. No API or behaviour change.
- **Every em dash is gone from the tree** (EMDASH-CONFORMANCE part 2). Measured byte level over all
  126 tracked files before the sweep: 529 occurrences of U+2014 as the literal character across 73
  files, 42 of them not markdown, plus **one in an encoded form that a literal-character sweep
  passes straight over**: the JS escape in `scripts/parser-template/package.json`'s npm
  `description`. That file is what `scripts/scaffold-parser.mjs` generates every new parser repo
  from, so the escape was on its way into the published `description` of every future `@cosyte/*`
  parser. Sweep for the encodings, never only for the character.
  - **Three occurrences carried a value rather than punctuation** and were converted by hand before
    any bulk transform ran, because a bulk rule would have turned a declared absence into a stray
    glyph: the null-cell placeholder in `experiments/perf-calibration/analyze.mjs` (now `n/a`), the
    "not applicable" cell in `ANALYSIS.md`'s runner-class table, and the 60-character separator rule
    printed by `scripts/drift-check.js`.
  - `analyze.mjs` and the committed tables under `experiments/perf-calibration/data/` were rewritten
    **consistently**, so the tables still re-derive by running the analyzer. That is this
    experiment's whole contract, and punctuating the generator and its evidence differently would
    have broken it silently.

### Added

- **The em-dash brand rule is now gated in CI** (`scripts/check-no-emdash.sh`, `check:no-emdash`,
  and `.github/workflows/no-emdash.yml`). It scans every tracked file, and separately the PR title,
  body and commit messages, which is what the rule names explicitly. The content sweep above and
  this gate landed in the **same commit**: a gate without the sweep reds CI on arrival, and a sweep
  without the gate grows the character back.
  - It runs from `verify` as well as from its own workflow. `verify` is a required status check here
    and `no-emdash` is not, so without that the gate would run, be visible, and still not block a
    merge. Making `no-emdash` required is a ruleset change, and the follow-up.
  - It **closes cross-repo residual (iv)**, which every other copy of this gate in the ecosystem
    records as a known hole and declines to close: it unsets any interposed `grep`/`xargs`/`sed`/`awk`
    shell function, and runs a **scanner-visibility probe** that refuses rather than reporting a
    clean tree when the grep in use silently skips a file. The pattern self-test cannot catch that
    case, because a tool that skips a file and a tool that read it and found it clean produce the
    same empty output and the same exit 0. Both halves were checked against a real `-I`-forcing
    interposition rather than reasoned about, as was every other refusal in the script.

- **PERF-P1: the measurement contract is now written down.** New
  `documentation/decisions/0001-perf-measurement-contract.md` (the repo's first ADR; a
  `documentation/decisions/` folder now exists here, matching `fhir`/`transform`/`cli`). It freezes,
  with PERF-P0's measured data, everything `@cosyte/test-utils/perf` will hard-code, so P2/P3
  implement a decided contract instead of re-deriving it, and **no constant in the kit lacks a
  recorded justification**. Every entry in its table is tagged _measured_ (re-derived from the
  committed datasets under `experiments/perf-calibration/data/`) or _judgement_ (P0 could not settle
  it, so the reasoning is written down instead). What it fixes:
  - **Estimator split.** `min` for the ratio _assertion_, the only estimator leaving a usable window
    (6.65…8.84 rather than 8.58…8.84), with the full sample vector retained and emitted; a **median**
    headline with the distribution beside it for the _benchmark_, since median-vs-trimmed-mean
    divergence reaches 25.6% at the tail. W2's criticism of min-of-N as a reported statistic stands.
  - **Warmup is time-budgeted, never fixed-count** (W1): ≥500 ms, stop on 3 consecutive 50 ms batches
    within ±5%, cap 5 s, and **skip loudly** if it never stabilises. The batch length is itself a
    constant with a measured motivation: at the granularity of a single ~4–9 ms pass the ±5% rule is
    unsatisfiable in 8–99% of _already warm_ phases, worst on the size axis, so the fix is coarser batches, not a looser
    tolerance. And the interaction that has to be remembered: changing the warmup rule moves the
    operating point the ceiling was set from, on both the signal and the false-alarm side.
  - **Ratio ceiling 8, floor 1.5**, both hard failures, plus a `MIN_PHASE_MS` of 4 ms below which the
    gate skips rather than answers (the fastest base phase in 3,200 samples was 4.14 ms).
  - **The perf tests come out of the coverage run** (`test/perf`): P0's pre-registered rule tripped.
  - **`src`-vs-`dist` (V4) settled both ways:** the gate keeps importing `src` through the test host
    (the calibrated regime), the reporting benchmark imports built `dist` from a plain Node process.
    Verified directly in this repo's Vitest 4.1.4 host that the SSR getter lands on _call sites in the
    test file_ and not on a same-module or hoisted-local call, so the kit's function-value API keeps
    it out of the measured loop, and it is `hl7`'s current shape that is the outlier.
  - **The GC rules for P3**, including M2 restated correctly: the boundary is whether V8 **recognises a
    key** (`type`/`execution`/`flavor`), not truthiness: `gc({})` and `gc({foo:1})` scavenge exactly
    like `gc(true)`.
  - **Two corrections carried into the roadmap's own framing rather than dropped:** the floor **cannot**
    catch dead-code elimination on the count axis (the sink does that, structurally), and "catches
    complexity-shaped regressions" now carries "**provided the fixture is large enough, and each
    package must prove that**", enforced by a per-package injected-O(n²) self-check at the sizes that
    package's real gate uses.

- **PERF-P0: the perf gate is now calibrated, before it is built.** New
  `experiments/perf-calibration/` (a committed experiment, not a published API: nothing imports it
  and it does not run in `pnpm test`) measures the three constants `@cosyte/test-utils/perf` needs
  rather than guessing them: 3,200 4N-vs-N measurements on a linear workload across `{count,size}`
  axis × `{N→4N, 4N→N}` ordering × `{coverage on, off}` on two runner classes, 320 on a deliberately
  O(n²) one, and 200 GC-fixpoint trials: all on a real **Node 22.23.1 / V8 12.4** binary,
  discharging roadmap §10/O7. Constants: **ceiling 8, floor 1.5, 3 GC calls.** Findings, in
  `experiments/perf-calibration/ANALYSIS.md`:
  - **The gate's discriminating power is much thinner than the roadmap assumes.** The "≈16 signal"
    a quadratic regression was assumed to produce is neither 16 nor a constant. It climbs with
    fixture size, and near the crossover it lands _inside_ the false-alarm tail. On the noisier
    runner the usable window between worst false alarm (6.649) and weakest real regression at
    `hl7`'s own fixture size (8.84) is a factor of **1.33**. So fixture size is a calibration
    parameter, and P2's injected-O(n²) self-check only proves anything when run at the sizes the
    package's real gate uses.
  - **`hl7`'s shipped ceiling of 10 is too high**: the weakest real regression at its own fixture
    size scored 8.84, so the shipped gate would have passed it. P4 must lower it, not just re-comment
    it.
  - **The estimator is load-bearing**: `min` caps the false-alarm tail at 6.649 where the central
    estimators reach 8.25–8.58, which would leave no window at all.
  - **V1 measured**: coverage costs 1.17–1.43× and _mostly_ cancels in the ratio, residual a few
    percent, so `hl7`'s "coverage cancels" comment is wrong as written.
  - **W1 confirmed**: after `hl7`'s fixed-count warmup the first measured rep is still up to 23%
    slower than the fifth.
  - **M2 confirmed on Node 22, with the rule corrected**: the boundary is not truthiness but whether
    V8 recognises a key; `gc({execution:'sync'})` and `gc({flavor:'last-resort'})` are major GCs,
    while `gc({})` and `gc({foo:1})` silently scavenge.

  New `perf-calibration.yml` (`workflow_dispatch` only, never a gate) takes the GitHub-hosted legs.
  The pre-registered coverage decision rule **tripped**, so P1's ADR inherits a recommendation to
  exclude the perf tests from the coverage run.

- **PHI-GATE-SUITE: `phi-scan` is now an enforced baseline script + a scaffold default.** Added
  `"phi-scan"` to `drift-manifest.json`'s `requiredScripts`, so `drift-check` fails any `@cosyte/*`
  parser that loses its commit-time PHI scanner (all six targets already carry one: `drift-check`
  stays green). To keep a **newly** scaffolded parser born-compliant, the parser template
  (`scripts/parser-template/`) now ships a **STARTER** `scripts/phi-scan.ts`: the proven shared
  machinery (`--staged` pre-commit + full-tree CI modes, synthetic allow-list, `--allow-fixture`
  override-log gate, exit codes 0/1/2, `git`-only-via-`execFileSync`) plus a cross-cutting SSN/email
  detection **floor** and a prominent, fenced TODO obligating the author to add structured,
  field-level PHI detection for their standard before relying on it. Also adds
  `scripts/phi-allow-list.txt`, `phi-scan-overrides.md`, `test/scripts/phi-scan.test.ts`, the
  `phi-scan` script + `simple-git-hooks` `pre-commit` wiring (`tsx` + `simple-git-hooks` devDeps),
  `run-phi-scan: true` on the template's CI caller, and `scripts/**/*.ts` to the template's
  tsconfig/lint/format scope.
- **REL-PIPE**: proved the publish pipeline without burning a version. New **`release-dry-run` CI
  job** exercises the publish path (`pnpm -r publish --dry-run`) + asserts every publishable tarball
  assembles (`npm pack --dry-run`) on each push/PR: auth-free, no upload, no version consumed; a red
  here means a real release would fail. `release.yml` now references an **`environment: release`**
  approval gate. New **`RELEASING.md`** documents the whole pipeline + the turnkey OIDC-trusted-
  publishing / provenance migration deferred to the public launch (PUB-FLIP).

### Changed

- `release.yml` NOTE rewritten to reflect the environment gate and the OIDC-at-PUB-FLIP reality
  (provenance auto-enables on the public flip; tokenless OIDC needs npm ≥ 11.5.1 / pnpm ≥ 10.16
  first).

### Remaining (one-time, privileged, not autopilot-doable)

- ~~**Create the protected `release` environment**~~: done. `release` carries a required reviewer
  and a `main`-only deployment-branch policy; see `RELEASING.md`.

## 2026-06-30

### Added

- This repo-level `CHANGELOG.md` (the monorepo root previously had none; per-package changelogs were
  already present).

### Changed

- **DEPS-1**: `drift-manifest.json` gained a canonical `pnpmOverrides` block and
  `scripts/drift-check.js` now **fails** any consumer repo whose `pnpm.overrides` are missing or
  divergent, enforcing the suite-wide `esbuild` (path-traversal) and `js-yaml`
  (`GHSA-h67p-54hq-rp68`) dev-dependency advisory remediation with no per-repo drift. The root
  carries the same overrides block for parity.

## 2026-06-27

### Changed

- Pinned GitHub Actions bumped via Dependabot: `actions/checkout` 4→7, `actions/setup-node` 4→6,
  `pnpm/action-setup` 4→6.

## 2026-06-26

### Added

- Dependabot config (`npm` + `github-actions`, grouped, weekly) and `CODEOWNERS`.
- `@cosyte/eslint-config` application mode (`{ library: false }`) so apps opt out of the JSDoc /
  `console` gates the libraries enforce.
- Deterministic parser scaffold generator (`scripts/`) for standard-compliant `@cosyte/*` parsers;
  the template `package.json` is born clean with a `pnpm format` step.

### Changed

- Drift check extended to require `@cosyte/tsup-config` + `@cosyte/vitest-config`.

### Fixed

- `@cosyte/test-utils` `@cosyte/*` devDependencies use the `workspace:` protocol.

## 2026-06-25

### Added

- `@cosyte/test-utils` conformance kit built out.
- The `vite` peer required for the Vitest 4 standard.

### Fixed

- npm provenance gated on public repo visibility; `NPM_TOKEN` passed explicitly to the Changesets
  publish step.

## 2026-06-24

### Added

- Initial monorepo: the shared `@cosyte/*` toolchain packages (`tsconfig`, `eslint-config`,
  `prettier-config`, `tsup-config`, `vitest-config`) + the `@cosyte/test-utils` scaffold, wired with
  Changesets.
- The **drift check** (`scripts/drift-check.js` + `drift-manifest.json`): the enforcement spine that
  keeps every consumer repo on one toolchain with no drift.
- Dogfooding CI + smoke tests + the provenance release path.

### Changed

- Baseline raised to **ES2023 + ESLint 10** (the suite's Node ≥ 22 floor).
