# Releasing `@cosyte/*` config packages

How the six published toolchain packages (`@cosyte/tsconfig`, `eslint-config`, `prettier-config`,
`tsup-config`, `vitest-config`, `test-utils`) get to npm, and the gotchas worth not rediscovering.

## The pipeline

Releases run on [Changesets](https://github.com/changesets/changesets). The flow:

1. A change lands with a changeset (`pnpm changeset`) describing the bump. Every package stays on the
   **`0.0.x`-until-first-alpha** ladder (patch bumps only; a published version is never moved back).
2. On push to `main` with pending changesets, `.github/workflows/release.yml` opens/updates a
   **"Version Packages"** PR that consumes the changesets and bumps versions + per-package changelogs.
3. Merging that PR triggers the workflow again; with no pending changesets it runs
   `pnpm run release` (`build` → `changeset publish`) and publishes the bumped packages.

Both steps run inside the **`release` environment**, which is **protected** — it is the approval gate,
so nothing reaches npm without a deliberate human ack.

### Authentication today

This repo is **public**, so publishing authenticates with `NPM_TOKEN` — an org-level secret shared
across the `@cosyte/*` repos — and **with provenance**. `NPM_CONFIG_PROVENANCE` is wired to
`github.event.repository.visibility == 'public'`, so provenance is on with no workflow edit.

`NPM_TOKEN` **must be an npm _Automation_ token** (or a granular token). A classic _Publish_ token
demands a 2FA one-time password that CI cannot supply, and the publish dies with `EOTP This
operation requires a one-time password from your authenticator` — after a green build, at the very
last step. Note that a repo-level `NPM_TOKEN` silently overrides the org-level one, so keep the
token in exactly one place.

## The `release` environment (approval gate)

The `release` job in `release.yml` references `environment: release`, so both the version-PR step and
the publish step pass through this gate. Pre-launch this also gates version-PR creation; that mild
friction is intentional (nothing in the release workflow runs unattended). If it becomes annoying
post-launch, split into an ungated `version` job and a gated `publish` job.

> ### ✅ The protected environment exists
>
> `release` carries a **required reviewer** (`NSchatz`) and a **`main`-only** deployment-branch
> policy. Publishing stops for a human: the run sits at `waiting` until approved.
>
> Two platform facts worth keeping, because each one costs an afternoon to rediscover:
>
> - **Required reviewers need a public repo on GitHub Team.** On Free / Pro / Team they are
>   public-repo-only; a private repo needs Enterprise Cloud. The API refuses with a `422` naming the
>   "billing plan" — which reads like a plan problem and is really a visibility one.
> - **Create the environment BEFORE a workflow references it.** Reference it first and GitHub
>   silently auto-creates an _unprotected_ environment of that name on the first run — a gate that
>   gates nothing while looking like it does, with no error and no warning.
>
> **Via the UI** — Settings → Environments → **New environment** `release`, then add:
>
> - **Required reviewers** → the maintainer (e.g. `NSchatz`). Leave **Prevent self-review** _off_
>   (solo-maintainer self-approval must be allowed).
> - **Deployment branches** → **Selected branches** → add `main`.
>
> **Via the API** (needs a token with `Environments: write`):
>
> ```bash
> gh api -X PUT repos/cosyte/config/environments/release --input - <<'JSON'
> {
>   "wait_timer": 0,
>   "prevent_self_review": false,
>   "reviewers": [{ "type": "User", "id": 26444422 }],
>   "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
> }
> JSON
> gh api -X POST repos/cosyte/config/environments/release/deployment-branch-policies -f name=main
> ```
>
> (`26444422` = `NSchatz`. Required reviewers need the repo to be **public** on GitHub Team — see
> above; a private repo would need Enterprise Cloud.)

## Proving the pipeline without burning a version

The `release-dry-run` job in `.github/workflows/ci.yml` runs on every push/PR:

- `pnpm -r publish --dry-run --no-git-checks` — exercises the publish command path (auth-free, never
  uploads). The real release publishes via `changeset publish`, so this is a faithful proxy for the
  pack/manifest/access path rather than the literal release command. Green as "no new packages" until
  a changeset bumps a version, then it packs + validates that new version.
- `pnpm -r --filter "./packages/*" exec npm pack --dry-run` — asserts each publishable tarball
  assembles with the correct file set + built `dist`, **independent of what's already on npm** (a
  plain `publish --dry-run` skips already-published versions and would prove nothing for them).

A red here means a real release would fail. This is the "prove the pipe, burn nothing" gate — no real
publish, no version consumed.

## Still deferred — OIDC trusted publishing

**Provenance is live** (the repo is public). **OIDC trusted publishing** — publishing with no token
at all — is the remaining step, and it needs a toolchain bump first. A turnkey sequence:

1. ~~**Bump the runner toolchain floor**~~ — **DONE.** `packageManager` is now `pnpm@10.34.5`
   (≥ 10.16) and the `setup-node` pins are `22.14` (≥ 22.14) across `ci.yml` (`release-dry-run`) and
   `release.yml`; `engines.node` is `>=22.14`. Since publish runs via `pnpm run release`, **pnpm**
   carries OIDC trusted publishing, so the npm-CLI floor (npm ≥ 11.5.1) is not on the publish path and
   no `npm i -g npm@…` step is needed. `pnpm/action-setup@v6` reads `packageManager`, so the dry-run
   and release jobs install 10.34.5. Proven green by `release-dry-run`.
2. **Configure the Trusted Publisher on npm** — for each `@cosyte/*` package: Settings → Trusted
   Publisher → GitHub org `cosyte`, repository `config`, workflow filename `release.yml`, environment
   name `release`, allowed action `npm publish`.
3. **Remove `NPM_TOKEN` / `NODE_AUTH_TOKEN`** from the workflow and repo secrets; keep
   `permissions: id-token: write` (already present). Provenance auto-enables on the public flip.
4. **Harden npm** — set the package/org to "Require two-factor authentication and disallow tokens";
   OIDC trusted publishers keep working, stolen tokens become useless.

Reference: `operations/plans/GITHUB-TEAM-MATURITY-PLAN.md` (Decision D1, Phase C) in the umbrella repo.
