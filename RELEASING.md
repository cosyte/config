# Releasing `@cosyte/*` config packages

How the six published toolchain packages (`@cosyte/tsconfig`, `eslint-config`, `prettier-config`,
`tsup-config`, `vitest-config`, `test-utils`) get to npm — and what is deliberately deferred to the
public launch.

## The pipeline

Releases run on [Changesets](https://github.com/changesets/changesets). The flow:

1. A change lands with a changeset (`pnpm changeset`) describing the bump. Every package stays on the
   **`0.0.x`-until-first-alpha** ladder (patch bumps only; a published version is never moved back).
2. On push to `main` with pending changesets, `.github/workflows/release.yml` opens/updates a
   **"Version Packages"** PR that consumes the changesets and bumps versions + per-package changelogs.
3. Merging that PR triggers the workflow again; with no pending changesets it runs
   `pnpm run release` (`build` → `changeset publish`) and publishes the bumped packages.

Both steps run inside the **`release` environment**. Once that environment is created as **protected**
(one-time setup below), it becomes the approval gate — nothing reaches npm without a deliberate human
ack.

### Authentication today

The repo is **private**, so publishing authenticates with `NPM_TOKEN` (repo secret) and **without
provenance**. `NPM_CONFIG_PROVENANCE` is wired to `github.event.repository.visibility == 'public'`,
so provenance turns itself on automatically the moment the repo goes public — no workflow edit needed.

## The `release` environment (approval gate)

The `release` job in `release.yml` references `environment: release`, so both the version-PR step and
the publish step pass through this gate. Pre-launch this also gates version-PR creation; that mild
friction is intentional (nothing in the release workflow runs unattended). If it becomes annoying
post-launch, split into an ungated `version` job and a gated `publish` job.

> ### ⚠️ One-time setup required — create the protected environment
>
> The environment does **not exist yet**. The autopilot PAT lacks the `Environments: write`
> permission, so it was left for a founder (or a token with that scope) to create — a ~30-second
> action. **Until it exists, GitHub auto-creates an _unprotected_ environment named `release` on the
> first release run** (equivalent to no gate — the same posture as before this change, so no
> regression); the gate goes live the instant the protected version is created.
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
> (`26444422` = `NSchatz`. Required reviewers on a **private** repo need GitHub **Team+** — `cosyte`
> is on Team.)

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

## Deferred to launch (PUB-FLIP) — OIDC trusted publishing + provenance

Both npm **provenance** and **OIDC trusted publishing** require a **public** source repo, so the real
first provenance publish happens at the coordinated public launch. When `cosyte/config` goes public,
migrate to tokenless OIDC — a turnkey sequence:

1. **Bump the runner toolchain floor** — OIDC trusted publishing needs **npm ≥ 11.5.1**, **Node ≥
   22.14**, and (since we publish via pnpm) **pnpm ≥ 10.16** (this repo pins `pnpm@10.0.0` today).
   Bump `packageManager` + the `setup-node`/`action-setup` versions accordingly.
2. **Configure the Trusted Publisher on npm** — for each `@cosyte/*` package: Settings → Trusted
   Publisher → GitHub org `cosyte`, repository `config`, workflow filename `release.yml`, environment
   name `release`, allowed action `npm publish`.
3. **Remove `NPM_TOKEN` / `NODE_AUTH_TOKEN`** from the workflow and repo secrets; keep
   `permissions: id-token: write` (already present). Provenance auto-enables on the public flip.
4. **Harden npm** — set the package/org to "Require two-factor authentication and disallow tokens";
   OIDC trusted publishers keep working, stolen tokens become useless.

Reference: `operations/plans/GITHUB-TEAM-MATURITY-PLAN.md` (Decision D1, Phase C) in the umbrella repo.
