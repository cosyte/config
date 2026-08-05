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

Both steps run inside the **`release` environment**, which is **protected**. It is the approval gate,
so nothing reaches npm without a deliberate human ack.

### The two gates that run before any of it

Both are zero-dependency node, both run in `ci.yml`'s required `verify` job **and** first in
`release.yml`, before install and before an approver is asked for anything.

**`pnpm changeset:guard`** refuses a changeset that cannot bump anything. This is not hygiene: given
only inert changesets, `changesets/action` logs `All changesets are empty; not creating PR`,
publishes nothing, and **exits 0**. Run 30640138565 (2026-07-31) was approved through this
environment as a real publish, reported success, and shipped **none** of the six packages that were
already a patch ahead of the registry. Three shapes bump nothing and only the first is what the
action calls empty:

- **frontmatter declaring no packages.** `@changesets/parse` does not throw on this; `yaml.load` of
  an empty block returns falsy and it sets `releases = []`. The file parses cleanly and carries a
  human summary, so it looks entirely normal in a diff.
- **every entry typed `none`.** `none` is a _valid_ type, so the releases list is non-empty and the
  action's own emptiness check does not fire. It opens a Version PR that changes no version.
  (`none` **alongside** a real bump is fine, and is what `none` is for.)
- **a misspelled package name.**

> **This bans an idiom this repo used deliberately three times.** `changeset add --empty` writes
> exactly that empty-frontmatter file, and `perf-measurement-contract-adr.md`,
> `phi-scan-scaffold-and-drift.md` and `prepublish-attw.md` each used it to record a repo-level
> change that bumped no package. Two were consumed harmlessly next to real changesets; the third was
> alone, and it is the one that cost a six-package publish. **There is no longer a changeset-shaped
> home for a repo-level note. Put it in the root `CHANGELOG.md`**, which is where this repo already
> says repo-level entries belong, and add no changeset at all. That is what `cf07086` concluded, and
> the guard now enforces it.

**`pnpm release:notes prepare`** refuses a release that cannot say what it shipped, deriving one body
per bumped package from the changesets the version commit consumed. See the next section for why
that is the source rather than the changelog.

### After the publish: tags and releases

`createGithubReleases: false` means the action no longer pushes the tags `changeset publish` creates
in the runner's local clone, so `release.yml` creates them itself. That step is driven by **what the
version commit bumped**, not by what a given run published, and it asks the **registry** whether each
package is actually there. Both choices exist to close the same hole:

> With the step keyed on `published == 'true'`, a `gh release create` that failed on the third of six
> packages would red the run; the re-run would then find all six already on npm, publish nothing,
> **skip the step**, and go **green**, leaving four packages on npm with no tag and no GitHub release,
> permanently. Losing the tag is specific to `createGithubReleases: false` and matters more here than
> it looks, because this repo's changelog headings are dated from tags by hand.

So the step is **idempotent**: a re-run completes whatever is missing rather than skipping it, and a
package that was bumped but never reached the registry is named and reds the run. If you ever see it
fail, re-running the job is the correct first move.

### Release bodies: why `createGithubReleases` is off

`changesets/action` defaults `createGithubReleases` to **true**, and builds each body by finding a
`## <version>` heading in that package's `CHANGELOG.md`. This repo sets `"changelog": false` and
hand-maintains its changelogs, so `changeset version` writes no such heading, the action finds none,
and **its fallback is to use the whole file**. On 2026-07-31 all six release bodies published as the
raw `CHANGELOG.md`, `# Changelog` preamble and `## [Unreleased]` included. They were corrected by
hand afterwards, which is not a gate.

So the flag is **false**, which removes the dumping behaviour outright, and `scripts/release-notes.mjs`
supplies the replacement. Two consequences worth knowing:

- **The bodies come from the changesets, not from the changelog.** Deriving from the changelog would
  need a `## [0.0.6]` heading for a version that does not exist yet when the changeset is written,
  and with the generator disabled nothing writes it, so the gate would refuse every release until
  someone predicted the next version by hand. A changeset is written per change and deleted by the
  version commit, which is exactly what makes "what did this version consume" answerable from git.
- **With the flag off, the action no longer pushes the tags** that `changeset publish` creates in the
  runner's local clone. `release.yml` therefore creates them itself with `gh release create --target`:
  one tag, one release, both created there. Tags are `<pkg>@<version>`, which is what Changesets uses
  in a multi-package repo and what this repo's existing tags are. **Do not "simplify" that to
  `v<version>`**: six packages publishing in one run would collide on a single tag.

**`[Unreleased]` is promoted to a version heading BY HAND**, in the pull request that adds the
changeset. Nothing does it automatically. Until 2026-08-04 nothing did it at all, so shipped content
stayed under `[Unreleased]` in the file that shipped and each release republished the previous
release's notes. The six changelogs were corrected by hand; whether to turn the Changesets changelog
generator back on is a separate founder-owned call (`CHANGELOG-PREAMBLE-FUTURE-TENSE`), and the
release path above does not depend on the answer, because it reads changesets either way.

### Why this repo is not a thin caller of the shared workflow

Every parser calls `cosyte/.github/.github/workflows/release.yml@main` and inherits its
`RELEASE_PR_TOKEN` wiring and release-notes gate. This repo cannot, measured 2026-08-04:

1. **The shared gate would withhold every config publish, permanently, on a green run.** It answers
   "is a release pending" from the **root** `package.json`'s version. This repo's root manifest is
   `cosyte-config`, `private: true`, pinned at `0.0.0`; Changesets does not version a private root
   package, so that value has never changed and never will. Running the shared `prepare` against this
   repo returns `is-release=false`, code `never-versioned`, and the shared workflow supplies
   `publish:` only when that is `true`. That is a strictly worse instance of the silent-withholding
   class the changeset guard exists to close.
2. **It tags `v<version>`.** Its own comment states the assumption: "Every caller of this workflow is
   a single-package repo."

The two portable halves were ported instead: the `RELEASE_PR_TOKEN` wiring, and a notes gate rebuilt
for the six-package shape. If the shared workflow ever grows a multi-package mode, revisit this.

### `RELEASE_PR_TOKEN`, and why the Version PR needs it

GitHub does not start workflow runs for events produced by `GITHUB_TOKEN`. That is deliberate
anti-recursion and nothing surfaces it, so a "Version Packages" PR opened with that token arrives
with **zero checks**, and a required status check that never reports is **pending**, not failing:
with `bypass_actors: []` on the rulesets nobody can merge past it, an admin included.

Two things are needed and the second is the one that is easy to miss:

1. **`GITHUB_TOKEN` in the action's `env`**, which is what it opens the PR with. The action reads
   `process.env.GITHUB_TOKEN || core.getInput("github-token")`, so **the env wins**: adding a
   `github-token:` input while leaving the env in place would be a silent no-op.
2. **`persist-credentials: false` on the checkout.** The version commit is pushed by `git push` out
   of that checkout, not through the API. Left at its default, `actions/checkout` persists an
   `http.<host>.extraheader` that git sends preemptively, so the `~/.netrc` the action writes with
   our token is never consulted and the push stays `GITHUB_TOKEN`-authored.

Fixing only (1) fixes the `opened` event and leaves `synchronize` broken. A Version PR is
force-pushed every time another changeset lands, and required checks are evaluated against the PR's
**current** head sha, so an update pushed by `GITHUB_TOKEN` returns it to zero applicable checks.

**Scope it narrowly:** a fine-grained PAT with `Contents: read+write`, `Pull requests: read+write`,
`Metadata: read` on this repo and nothing else. It does **not** need `Workflows: write`:
`pnpm run version` changes `packages/*/package.json`, `packages/*/CHANGELOG.md` and `.changeset/`,
none of which is under `.github/workflows/`.

**Absent, it falls back to `GITHUB_TOKEN` and says so loudly** in the run log. Failing closed instead
would take this repo's release path down to protect against a state it is already in.

### Authentication today

This repo is **public**, so publishing authenticates with `NPM_TOKEN`, an org-level secret shared
across the `@cosyte/*` repos, and **with provenance**. `NPM_CONFIG_PROVENANCE` is wired to
`github.event.repository.visibility == 'public'`, so provenance is on with no workflow edit.

`NPM_TOKEN` **must be an npm _Automation_ token** (or a granular token). A classic _Publish_ token
demands a 2FA one-time password that CI cannot supply, and the publish dies with `EOTP This
operation requires a one-time password from your authenticator`: after a green build, at the very
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
>   "billing plan", which reads like a plan problem and is really a visibility one.
> - **Create the environment BEFORE a workflow references it.** Reference it first and GitHub
>   silently auto-creates an _unprotected_ environment of that name on the first run: a gate that
>   gates nothing while looking like it does, with no error and no warning.
>
> **Via the UI**. Settings → Environments → **New environment** `release`, then add:
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
> (`26444422` = `NSchatz`. Required reviewers need the repo to be **public** on GitHub Team: see
> above; a private repo would need Enterprise Cloud.)

## Proving the pipeline without burning a version

The `release-dry-run` job in `.github/workflows/ci.yml` runs on every push/PR:

- `pnpm -r publish --dry-run --no-git-checks`: exercises the publish command path (auth-free, never
  uploads). The real release publishes via `changeset publish`, so this is a faithful proxy for the
  pack/manifest/access path rather than the literal release command. Green as "no new packages" until
  a changeset bumps a version, then it packs + validates that new version.
- `pnpm -r --filter "./packages/*" exec npm pack --dry-run`: asserts each publishable tarball
  assembles with the correct file set + built `dist`, **independent of what's already on npm** (a
  plain `publish --dry-run` skips already-published versions and would prove nothing for them).

A red here means a real release would fail. This is the "prove the pipe, burn nothing" gate: no real
publish, no version consumed.

### Keep packing tools out of `prepublishOnly`

`@cosyte/test-utils`'s `prepublishOnly` used to end in `pnpm attw`, and `attw --pack .` packs a
tarball of its own into the directory being published. Run from a `pnpm publish --dry-run` it did not
pack at all, and the step died with `ENOENT: cosyte-test-utils-0.0.2.tgz`.

**It stayed hidden because `publish --dry-run` skips a version already on npm**, so the whole
`prepublishOnly` chain only ran on a version bump. It first fired on the `0.0.2` Version PR
(2026-07-31).

`attw` still runs where it belongs: `pnpm attw`, as its own step in `verify`. Coverage is unchanged.
**Do not put a tool that packs, publishes, or installs back into a lifecycle script that publishing
itself invokes.** (This paragraph used to say attw ran "twice", counting the `Pack integrity` job.
That job runs `npm pack --dry-run` and never invokes attw. It is a second net on the tarball, not a
second attw run.)

#### The mechanism, measured, and two claims retracted

The cause is not a staging directory. **`pnpm publish --dry-run` exports `npm_config_dry_run=true`
into every lifecycle script it runs**, `npm pack` honours it and prints its listing while writing no
file, and `attw` then opens the path it computed from the manifest
(`<dir>/<name>-<version>.tgz`; it never asks npm where the file went). Reproduced here at both ends:
with the variable set, `npm pack` leaves no tarball; on a non-dry-run `pnpm publish`, the lifecycle
environment carries `npm_config_registry`, `npm_config_cache`, `npm_config_user_agent` and **no
`dry_run` key at all**. `npm_config_pack_destination` breaks it the same way from the other side, by
moving the tarball off the computed path. Both take effect upper-cased too. The hyphenated spelling
npm also honours (`npm_config_dry-run`) may or may not arrive, and that is a shell question rather
than an npm one: attw packs with `execSync("npm pack")`, and `/bin/sh` is dash on Debian and on the
`ubuntu-latest` runner, which refuses to export a name that is not a valid shell identifier, while
bash forwards it. The strip covers the hyphen either way.

Two earlier claims about this are therefore **RETRACTED**:

- that the pack "lands somewhere attw cannot find" in a staging context. It is not written.
- that a real publish "would have failed identically". `changeset publish` does run `prepublishOnly`,
  but it sets no `dry_run`, so the pack succeeds. **This class has never broken a release. It breaks
  the dry run that exists to prove one**, which is bad enough: `release-dry-run` is the gate, and a
  Version PR cannot merge through a red one.

**A nested pack of a THROWAWAY FIXTURE is a different act from a nested pack of the package being
published, and it is fine.** `packages/test-utils/test/attw-gate.test.ts` shells out to a real
`attw --pack` against fixtures in `os.tmpdir()`, and `prepublishOnly` runs `pnpm test`, which is how
`CONFIG-PREPUBLISH-ATTW-ENOENT` reached the `0.0.3` Version PR ([#46](https://github.com/cosyte/config/pull/46))
with seven red cases on a tree whose only change was a `CHANGELOG.md`. The fix is at the source
rather than in the caller: **`scripts/attw.mjs` strips those two keys from the environment of the
`attw` child**, in both copies of the wrapper, so every scaffolded parser inherits it. The rule above
is unchanged, and the reason to keep it is now the sharper one: a tool that packs THE PACKAGE BEING
PUBLISHED, inside the publish, writes a tarball into the tree that is about to be packed.

## Still deferred: OIDC trusted publishing

**Provenance is live** (the repo is public). **OIDC trusted publishing**, publishing with no token
at all, is the remaining step, and it needs a toolchain bump first. A turnkey sequence:

1. ~~**Bump the runner toolchain floor**~~: **DONE.** `packageManager` is now `pnpm@10.34.5`
   (≥ 10.16) and the `setup-node` pins are `22.14` (≥ 22.14) across `ci.yml` (`release-dry-run`) and
   `release.yml`; `engines.node` is `>=22.14`. Since publish runs via `pnpm run release`, **pnpm**
   carries OIDC trusted publishing, so the npm-CLI floor (npm ≥ 11.5.1) is not on the publish path and
   no `npm i -g npm@…` step is needed. `pnpm/action-setup@v6` reads `packageManager`, so the dry-run
   and release jobs install 10.34.5. Proven green by `release-dry-run`.
2. **Configure the Trusted Publisher on npm**: for each `@cosyte/*` package: Settings → Trusted
   Publisher → GitHub org `cosyte`, repository `config`, workflow filename `release.yml`, environment
   name `release`, allowed action `npm publish`.
3. **Remove `NPM_TOKEN` / `NODE_AUTH_TOKEN`** from the workflow and repo secrets; keep
   `permissions: id-token: write` (already present). Provenance auto-enables on the public flip.
4. **Harden npm**: set the package/org to "Require two-factor authentication and disallow tokens";
   OIDC trusted publishers keep working, stolen tokens become useless.

Reference: `operations/plans/GITHUB-TEAM-MATURITY-PLAN.md` (Decision D1, Phase C) in the umbrella repo.
