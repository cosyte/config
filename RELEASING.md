# Releasing `@cosyte/*` config packages

How the eight published toolchain packages get to npm, who is waiting on whom at each step, what to
do when a step does not finish, and the gotchas worth not rediscovering.

**The eight packages this repository publishes**, all public `@cosyte/*` scoped:
`@cosyte/eslint-config`, `@cosyte/prettier-config`, `@cosyte/process`, `@cosyte/script-utils`,
`@cosyte/test-utils`, `@cosyte/tsconfig`, `@cosyte/tsup-config`, `@cosyte/vitest-config`.

The root manifest `cosyte-config` is `private: true` and is never published and never versioned. That
flag is about npm publishability and says nothing about repository visibility: **this repository is
public**, which is what makes npm provenance and protected-environment required reviewers available
here at all.

## What changed on 2026-08-22, and why

Until 2026-08-22 the whole release workflow was a single job carrying `environment: release`, so
GitHub held it in `Waiting` before step one: **a human had to approve a run merely to have a "Version
Packages" PR opened or refreshed.** That is now split. The version step is ungated; the publish step
still waits for a human.

The change is not a preference. It is what
[`documentation/release-stall-evidence.md`](documentation/release-stall-evidence.md) measured across
every `.changeset/`-carrying repository in the organization: 185 Version Packages PRs ever opened,
183 merged at a median of three minutes after their last push, exactly two ever stalled past 72 idle
hours, both of them green and mergeable with a held release run sitting behind them, and **62
`Release` runs waiting on one reviewer at the moment of measurement**. Read that file before
proposing to change any of this.

**The acknowledgment itself did not move.** A published npm version is permanent and cannot be
withdrawn by this process, so the protected `release` environment stays in front of the publish
exactly as it was, with the same reviewer and the same `main`-only branch policy. What stopped
waiting on a human is the step that produces a pull request, which anyone can close.

## The pipeline, step by step

Every step names its actor, what triggers it, and how you know it finished. Steps that wait on a
human carry a budget.

| #   | step                                                                         | actor                                                                                       | trigger                                                              | signal it completed                                                                                                                            | wait budget                                           |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Land a change with a changeset (`pnpm changeset`)                            | contributor                                                                                 | a pull request into `main`                                           | the PR merges with a `.changeset/*.md` file in it                                                                                              | none (ordinary review)                                |
| 2   | `preflight` job: both release gates, then the verify ladder                  | automation, ungated                                                                         | push to `main`                                                       | the `preflight` job is green in the `Release` run                                                                                              | none, nothing waits                                   |
| 3   | `version` job: open or refresh the "Version Packages" PR                     | automation, ungated                                                                         | `preflight` green **and** at least one pending changeset             | a PR titled `Version Packages` on branch `changeset-release/main` exists or was force-pushed, and its required checks are running              | none, nothing waits                                   |
| 4   | Merge the "Version Packages" PR                                              | **release owner** (today: `NSchatz`)                                                        | that PR is open and its required checks are green                    | the PR is merged; a version commit lands on `main`                                                                                             | **24 hours** from the moment the PR's checks go green |
| 5   | `publish` job: `changeset publish`, then tag and release each bumped package | automation, **gated on the protected `release` environment**                                | push to `main` with **no** pending changesets, and `preflight` green | the run leaves `waiting`, `npm view <pkg>@<version>` answers for every bumped package, and one GitHub release per `<pkg>@<version>` tag exists | **24 hours** from the run entering `waiting`          |
| 6   | Approve the publish                                                          | **release approver** (today: `NSchatz`, the required reviewer on the `release` environment) | the `publish` job enters `waiting`                                   | the deployment is approved and the job starts                                                                                                  | counted inside step 5's budget                        |

The two arms in steps 3 and 5 are exclusive and the workflow chooses between them by asking the same
question `changesets/action` asks itself: **are there pending changesets in `.changeset/`?** If yes,
the ungated version arm runs and nothing is published. If no, the gated publish arm runs. Nothing
else decides it, and in particular the `release-notes.mjs` classifier does not: a classifier that
wrongly said "not a release" would withhold a publish on a green run, which is the exact failure the
changeset guard exists to close.

### Roles, named

- **Release owner.** Merges the Version Packages PR (step 4) and owns the stall rule below. Today
  this is `NSchatz`.
- **Release approver.** The required reviewer on the `release` environment (step 6). Today this is
  also `NSchatz`. The two roles are separable and should be separated the moment there is a second
  maintainer; nothing in the pipeline assumes they are the same person.

## When a Version Packages PR exceeds its budget

**The rule: a Version Packages PR whose required checks have been green for more than 24 hours is the
release owner's to end, and it ends in exactly one of two terminal states.**

- **Merged and published.** The default, and correct whenever the PR is mergeable and its bump is
  wanted. Merge it, then approve the publish run it triggers. The stall is over when every bumped
  package answers `npm view` and carries a tag.
- **Closed with its changesets preserved.** Correct when the bump is not wanted yet (a dependency is
  mid-flight, a package is about to be renamed). Close the PR and **leave the `.changeset/*.md` files
  on `main` untouched**. The next push to `main` reopens an equivalent PR from the same changesets.
  **Never delete a changeset to make a Version Packages PR go away.** Deleting it discards the bump
  and the changelog entry with no record that anything was dropped.

Anything else is not a terminal state. A PR that is red, unmergeable, or waiting on a fix is in one
of the failure states below and is resolved there first, then ended here.

**How to see the queue.** These two commands are the whole dashboard:

```bash
gh pr list --repo cosyte/config --search 'head:changeset-release/main is:open'
gh run list  --repo cosyte/config --workflow Release --status waiting
```

A non-empty second list is the thing this document exists to keep short: every entry is a publish
sitting on a human. Approve or cancel each one deliberately; do not let them accumulate.

## Failure states, and what the operator does

Five states, each with a terminal outcome you can reach from this section alone.

### (a) Required checks never report on the Version PR head

**Symptom.** The Version Packages PR shows checks as _pending_ forever, never failing. The merge
button is blocked and no admin can override it.

**Cause.** GitHub does not start workflow runs for events produced by `GITHUB_TOKEN`. That is
deliberate anti-recursion and nothing surfaces it. A required status check that never reports counts
as pending rather than failing, and with `bypass_actors: []` on the org rulesets nobody can merge past
it. A Version PR is force-pushed every time another changeset lands, and required checks are evaluated
against the PR's **current** head sha, so an update pushed by `GITHUB_TOKEN` returns it to zero
applicable checks even if the `opened` event was fine.

**Terminal action.**

1. Confirm the cause: `gh pr view <n> --repo cosyte/config --json author` returns `github-actions`
   rather than a human login. The `version` job also prints a `::warning` on every run when
   `RELEASE_PR_TOKEN` is unset.
2. Set `RELEASE_PR_TOKEN` (repository secret). Scope it narrowly: a fine-grained PAT with
   `Contents: read+write`, `Pull requests: read+write`, `Metadata: read` on this repository and
   nothing else. It does **not** need `Workflows: write`, because `pnpm run version` only changes
   `packages/*/package.json`, `packages/*/CHANGELOG.md` and `.changeset/`.
3. Close the stuck PR and push any trivial commit to `main` (or re-run the `Release` workflow) so the
   `version` job opens a fresh PR under the new token. The old PR cannot be rescued: its head sha was
   pushed by the wrong identity and no check will ever attach to it.
4. Terminal state: a new Version Packages PR with reporting checks, then the ordinary step 4 merge.

**Two implementation facts that make this fix fail silently if you get them wrong**, both already
wired in `release.yml` and both easy to undo by accident:

- The token must be set as `GITHUB_TOKEN` **in the action's `env`**, not through the `github-token:`
  input. The action reads `process.env.GITHUB_TOKEN || core.getInput("github-token")`, so the env
  wins and adding the input while leaving the env in place is a silent no-op.
- `persist-credentials: false` must stay on the `version` job's checkout. The version commit is
  pushed by `git push` out of that checkout, not through the API. Left at its default,
  `actions/checkout` persists an `http.<host>.extraheader` that git sends preemptively, so the
  `~/.netrc` the action writes with our token is never consulted and the push stays
  `GITHUB_TOKEN`-authored. Fixing only the env fixes the `opened` event and leaves `synchronize`
  broken.

### (b) A release gate refuses the changesets

**Symptom.** The `preflight` job reds on `Changesets must be able to bump something` or on
`Release notes must be derivable`. No PR is opened and nothing is published. Since 2026-08-22 this
happens **before** anyone is asked to approve anything.

**The two gates**, both zero-dependency node, both run in `preflight` in `release.yml` **and** in
`ci.yml`'s required `verify` job. The workflows invoke the scripts directly
(`node scripts/changeset-guard.mjs`, `node scripts/release-notes.mjs prepare --repo . --out ...`);
`pnpm changeset:guard` and `pnpm release:notes prepare` are the local aliases for the same scripts.

**`changeset-guard.mjs` refuses a changeset that cannot bump anything.** This is not hygiene. Given
only inert changesets, `changesets/action` logs `All changesets are empty; not creating PR`, publishes
nothing, and **exits 0**. Run 30640138565 (2026-07-31) was approved through the release environment as
a real publish, reported success, and shipped **none** of the six packages that were already a patch
ahead of the registry. Three shapes bump nothing and only the first is what the action calls empty:

- **frontmatter declaring no packages.** `@changesets/parse` does not throw on this; `yaml.load` of an
  empty block returns falsy and it sets `releases = []`. The file parses cleanly and carries a human
  summary, so it looks entirely normal in a diff.
- **every entry typed `none`.** `none` is a _valid_ type, so the releases list is non-empty and the
  action's own emptiness check does not fire. It opens a Version PR that changes no version. (`none`
  **alongside** a real bump is fine, and is what `none` is for.)
- **a misspelled package name.**

> **This bans an idiom this repo used deliberately three times.** `changeset add --empty` writes
> exactly that empty-frontmatter file, and `perf-measurement-contract-adr.md`,
> `phi-scan-scaffold-and-drift.md` and `prepublish-attw.md` each used it to record a repo-level change
> that bumped no package. Two were consumed harmlessly next to real changesets; the third was alone,
> and it is the one that cost a six-package publish. **There is no longer a changeset-shaped home for
> a repo-level note. Put it in the root `CHANGELOG.md`** and add no changeset at all.

**`release-notes.mjs prepare` refuses a release that cannot say what it shipped**, deriving one body
per bumped package from the changesets the version commit consumed.

**Terminal action.** Read the annotation, which names the offending file and what is wrong with it.
Then either fix the frontmatter (`"@cosyte/<pkg>": patch`) and the summary, or **delete the changeset
and put the note in the root `CHANGELOG.md`**. Push the fix to `main`. Terminal state: `preflight`
green, and the version arm opens a PR on the next run.

### (c) A publish partially succeeds, leaving bumped packages unpublished

**Symptom.** The `publish` job reds with `Bumped but never published`, naming the packages that are
missing from the registry, or with `Release accounting does not balance`. **Or** the `version` job
reds with `Bumped but never published (version arm)`, which is the same state reached by a different
route and has its own terminal action below.

**Why the job can tell you this at all.** The tag-and-release step is driven by **what the version
commit bumped**, not by what a given run published, and it asks the **registry** whether each package
is actually there. Both choices exist to close the same hole:

> With the step keyed on `published == 'true'`, a `gh release create` that failed on the third of
> eight packages would red the run; the re-run would then find all eight already on npm, publish
> nothing, **skip the step**, and go **green**, leaving five packages on npm with no tag and no GitHub
> release, permanently. Losing the tag matters more than it looks here, because this repository's
> changelog headings are dated from tags by hand.

**Terminal action.**

1. **Re-run the failed job.** This is the correct first move and usually the only one. The step is
   idempotent and self-healing: it runs on `!cancelled()`, so a partial publish still tags whatever
   reached npm, and a re-run completes what is missing instead of skipping it. `changeset publish`
   will publish nothing on the re-run for packages already on the registry, which is fine, because
   the accounting reads `npm view` rather than the run's own output.
2. If the re-run reports the same packages missing, the publish genuinely failed for them. Open the
   run's `npm-debug-log-config-run<id>-attempt<n>` artifact, which the workflow uploads on failure
   with credentials redacted, and read the npm error. The usual causes are an expired or wrong-typed
   `NPM_TOKEN` (see the authentication section) and an npm-side 403 on a scoped package.
3. Fix the cause and re-run again. **Do not hand-publish and do not bump the version to get past it.**
   A version consumed by a failed publish is not burned: the same version can be published again
   because nothing reached the registry under it.
4. Terminal state: the job is green and it has said `All N bumped package(s) are published, tagged and
released`. That sentence is the only thing that means the release is done.

**The version-arm variant, and why it exists.** The two arms are chosen by "are there pending
changesets", and a single push can be both a version commit and a push carrying a pending changeset:
merge a Version Packages PR while a newer changeset has landed on `main` since that PR was last
refreshed, and the merge bumps versions while `.changeset/` is still non-empty. That push takes the
ungated `version` arm, so the `publish` job does not run and nothing reaches the registry, while
`main` already carries the bumped manifests. It is legitimate and self-clearing, but it must not be
silent, so the `version` job carries its own copy of the registry accounting and reds on
`Bumped but never published (version arm)`.

**Terminal action for that variant** (the `version` job has no npm credentials, so it cannot fix this
itself and does not try):

1. **Merge the Version Packages PR that same run just opened or refreshed.** It consumes the pending
   changeset, so the next push to `main` has none, takes the publish arm, and publishes everything
   still owed, the earlier bump included. This is the normal move.
2. If that PR is not wanted yet, land any changeset-free commit on `main` instead. Same effect: the
   publish arm runs.
3. Terminal state: a `publish` run has said `All N bumped package(s) are published, tagged and
released`. Until then, `main` is ahead of the registry and the red version run is the record of it.
   **Do not delete the pending changeset to force the publish arm** - that discards a bump, and rule
   1 of the stall section applies here too.

### (d) A publish succeeds on a commit the release-notes gate did not recognise

**Symptom.** The `publish` job reds on `Published without a derived release body`. npm has already
published. No tag and no GitHub release were created.

**What it means.** `changeset publish` uploaded packages on a commit that `release-notes.mjs` did not
classify as a version commit, so no body was derived and the tag step never ran. This is unreachable
unless the wiring broke, and the check exists precisely to make the classifier's correctness
observable rather than assumed. It cannot withhold anything: the registry has already been written.

**Terminal action.** This one needs a human and does not have a re-run fix.

1. Find what actually reached the registry:
   `npm view <pkg> versions --json` for each of the eight packages, compared against
   `git show HEAD:packages/<pkg>/package.json`.
2. For every package published on that commit, create the tag and release by hand:
   `gh release create '<pkg>@<version>' --target <sha> --title '<pkg>@<version>' --notes-file <file>`,
   writing the body yourself from the changesets that commit consumed (`git show HEAD^:.changeset/`).
   The tag form is `<pkg>@<version>` and **must not** be simplified to `v<version>`: several packages
   publishing in one run would collide on a single tag.
3. Then work out why the classifier missed it, because that is the actual defect. The usual cause is a
   shallow checkout: the gate classifies `HEAD` against `HEAD^` and reads the changesets a version
   commit consumed out of the parent tree, so `fetch-depth: 0` is load-bearing in both `ci.yml` and
   all three jobs of `release.yml`.
4. Terminal state: every published package has a tag and a release, and the classifier defect has an
   issue or a fix.

### (e) The publish configuration is not one the allow-set permits

**Symptom.** The `publish` job reds on `The publish configuration must be one the allow-set permits`,
**after** the deployment was approved and **before** anything was packed or uploaded. Nothing reached
the registry. See [The configuration allow-check](#the-configuration-allow-check) below for what the
gate is and how to extend it; this section is the operator's five refusal states and their terminal
actions.

| exit | refusal state                                     | what it means                                                                          | terminal action                                                                                                                                   |
| ---- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | a value no entry permits                          | some source contributed a setting `npm-config-allow.json` does not allow at that value | Read the source the annotation names. Either change that source, or add the entry (below). Land the fix on `main` and re-run.                     |
| 1    | a required key does not hold                      | a `require` rule states a value and the publish would use a different one, or none     | Same: fix the source, or change the requirement in a reviewed PR. A `require` failing is the stronger signal; treat it as a defect first.         |
| 2    | the allow-set is absent, empty or unparseable     | the gate cannot know what is permitted                                                 | Restore or repair `npm-config-allow.json`. **This never means "permit everything"**, and deleting the file turns off releases, not the gate.      |
| 2    | a configuration source is unreadable or malformed | a file the publish reads exists but this gate could not read or parse it               | Fix the named file. A source that cannot be read is refused rather than skipped, because a skipped source is a green run over a value nobody saw. |
| 2    | a resolver could not be run                       | `npm config ls` or `pnpm config list` failed, or answered something unparseable        | Read the resolver's own error in the annotation. Usually a broken runner toolchain step; re-run the job once the toolchain step is fixed.         |

**Exit 1 and exit 2 are deliberately different**, the same way they are for `changeset-guard.mjs`: a
gate that could not read its input must not report the same code as a gate that read it and found a
violation, or "broken" and "caught something" become one signal in CI.

**Reproduce it locally before changing anything**: `pnpm run release:config-allow`. It needs no
credentials and prints every setting it observed with the source that supplied it. Your own laptop
contributes settings a runner does not (a personal `~/.npmrc`, a shell that exports `npm_config_*`),
so a local refusal is not by itself evidence about the release. Read the source it names.

## The configuration allow-check

**What it protects.** Everything that decides **where** these tarballs go, **what** goes inside them
and **what metadata rides along** is npm/pnpm configuration, and that configuration is assembled at
publish time out of sources nothing in this repository used to inspect: a global npmrc, the user
npmrc `actions/setup-node` **generates** on the runner and points `NPM_CONFIG_USERCONFIG` at, a
repository or per-package `.npmrc`, `pnpm-workspace.yaml`, the root manifest's `pnpm` block, each
package's `publishConfig`, `.changeset/config.json`, and the job's own environment. A redirected
`registry`, a disabled `provenance`, a widened `access` or an injected lifecycle-script setting
changes what reaches the public registry **without changing a tracked file in a way review would
see**. An npm publish is permanent and cannot be withdrawn.

**Where it runs, and why not earlier.** Inside the **gated** `publish` job, before the publish step
and before `pnpm install`. Effective configuration is a property of a specific process: its
environment, its working directory, and the home directory of the runner in a specific job. The
`preflight` job runs with different permissions, no npm credentials and no `release` environment, so
a configuration observed there is not evidence about this publish. The accepted cost is that a
refusal here happens after an approver has already approved the run. There is deliberately **no**
advisory copy in `preflight`: a green answer about the wrong process is exactly the evidence this
gate exists to distrust.

**How it decides.** It never re-implements anyone's precedence. It asks the package managers
themselves, in the publish command's own context: `npm config ls` (npm's own report of every setting
contributed by a source other than its built-in defaults, grouped by source, with values that lost to
a higher-precedence source printed commented out), `npm config ls --json` (the full effective map,
for the `require` rules), and `pnpm config list --json` (pnpm's effective map, which matters because
`changeset publish` spawns `pnpm publish` and pnpm reads `pnpm-workspace.yaml` and the manifest's
`pnpm` block, which npm does not). pnpm's built-in defaults are **measured** by running the same pnpm
binary in a throwaway directory carrying no configuration at all, rather than written down as a table
that would go stale on the next pnpm release.

**Anything it cannot resolve is a refusal, not a skip.** That is what keeps the guarantee true when a
future package-manager release adds a source nobody anticipated today.

**Where it lives.** `scripts/npm-config-allow.mjs` (zero-dependency, so it runs before
`pnpm install`), the allow-set in `npm-config-allow.json`, the local alias
`pnpm run release:config-allow`, and the suite in `test/npm-config-allow.test.ts`. Read the script's
header before changing it; it records why several apparently redundant refusals exist.

### Adding an entry to the allow-set

`npm-config-allow.json` is the committed answer to "what may a release of this repository be
configured with". Changing it is a reviewed diff, which is the whole point of it being a file.

1. Run `pnpm run release:config-allow` and read the line it refused. It names the key, the value and
   the **source** that supplied it.
2. **Decide whether that source should be contributing that value at all.** This is the step worth
   the minute. The right fix is often to change the source, not to widen the allow-set.
3. If the value is legitimate, add an entry to `allow`:

   ```json
   {
     "key": "provenance",
     "value": true,
     "why": "release.yml sets NPM_CONFIG_PROVENANCE from the repository's public visibility."
   }
   ```

   Exactly one of three match modes per entry: `value` pins an exact value (prefer this),
   `pattern` is a regular expression over the value, and `anyValue: true` permits the key at any
   value (use it only when the value is machine-specific, and say so in `why`). A non-empty `why` is
   **required**: an entry nobody justified is the one a reviewer waves through.

4. A **credential**-denoting key may only use `anyValue`. This file is committed to a public
   repository, and the check refuses an allow-set that pins a secret.
5. To require a key to hold a value whatever any source says, add to `require` instead. A requirement
   is checked against the resolvers' full effective maps, so it also catches a key **no source
   contributes at all**. `registry` is required at `https://registry.npmjs.org/` for exactly that
   reason.
6. Re-run `pnpm run release:config-allow`, then `pnpm test`. `test/npm-config-allow.test.ts` runs the
   check against this repository in both the local context and the context the gated publish job
   actually gives it, so an allow-set that would refuse the next release fails in CI first.

## The `release` environment (the approval gate)

The `publish` job in `release.yml` references `environment: release`, so the publish waits for a
human. The `preflight` and `version` jobs do not reference it and never wait.

> ### The protected environment exists
>
> `release` carries a **required reviewer** (`NSchatz`) and a **`main`-only** deployment-branch
> policy. Publishing stops for a human: the run sits at `waiting` until approved.
>
> Two platform facts worth keeping, because each one costs an afternoon to rediscover:
>
> - **Required reviewers need a public repo on GitHub Team.** On Free / Pro / Team they are
>   public-repo-only; a private repo needs Enterprise Cloud. The API refuses with a `422` naming the
>   "billing plan", which reads like a plan problem and is really a visibility one.
> - **Create the environment BEFORE a workflow references it.** Reference it first and GitHub silently
>   auto-creates an _unprotected_ environment of that name on the first run: a gate that gates nothing
>   while looking like it does, with no error and no warning.
>
> **Via the UI**. Settings, then Environments, then **New environment** `release`, then add:
>
> - **Required reviewers**: the maintainer (e.g. `NSchatz`). Leave **Prevent self-review** _off_
>   (solo-maintainer self-approval must be allowed).
> - **Deployment branches**: **Selected branches**, then add `main`.
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
> (`26444422` = `NSchatz`.)

**If the approval budget lapses.** A `publish` run sitting in `waiting` for more than 24 hours is the
release owner's to end: approve it, or cancel the run and say why in the version PR's thread. A
cancelled publish is recoverable (the version commit is on `main` and the next push re-runs the
publish arm); a forgotten one is what produces the backlog this pipeline was rebuilt to stop.

**Do not widen the reviewer set to admit an automation identity, and do not remove
`environment: release` from the `publish` job.** Either would mean a package could reach npm with no
human acknowledgment, a published version is permanent, and there is no operator decision authorizing
it. If the queue is still painful after the organization-wide split lands, the next levers are a
second human reviewer or npm Trusted Publishers with OIDC, and both are the operator's call.

## Release bodies: why `createGithubReleases` is off

`changesets/action` defaults `createGithubReleases` to **true**, and builds each body by finding a
`## <version>` heading in that package's `CHANGELOG.md`. This repository sets `"changelog": false` and
hand-maintains its changelogs, so `changeset version` writes no such heading, the action finds none,
and **its fallback is to use the whole file**. On 2026-07-31 all six release bodies published as the
raw `CHANGELOG.md`, `# Changelog` preamble and `## [Unreleased]` included. They were corrected by
hand afterwards, which is not a gate.

So the flag is **false**, which removes the dumping behaviour outright, and `scripts/release-notes.mjs`
supplies the replacement. Two consequences worth knowing:

- **The bodies come from the changesets, not from the changelog.** Deriving from the changelog would
  need a `## [0.0.6]` heading for a version that does not exist yet when the changeset is written, and
  with the generator disabled nothing writes it, so the gate would refuse every release until someone
  predicted the next version by hand. A changeset is written per change and deleted by the version
  commit, which is exactly what makes "what did this version consume" answerable from git.
- **With the flag off, the action no longer pushes the tags** that `changeset publish` creates in the
  runner's local clone. `release.yml` therefore creates them itself with `gh release create --target`:
  one tag, one release, both created there. Tags are `<pkg>@<version>`.

**`[Unreleased]` is promoted to a version heading BY HAND**, in the pull request that adds the
changeset. Nothing does it automatically. Until 2026-08-04 nothing did it at all, so shipped content
stayed under `[Unreleased]` in the file that shipped and each release republished the previous
release's notes. Whether to turn the Changesets changelog generator back on is a separate
founder-owned call (`CHANGELOG-PREAMBLE-FUTURE-TENSE`), and the release path does not depend on the
answer, because it reads changesets either way.

## Why this repository is not a thin caller of the shared workflow

Thirteen of the fourteen `.changeset/`-carrying repositories that have a release workflow call
`cosyte/.github/.github/workflows/release.yml@main` and inherit its `RELEASE_PR_TOKEN` wiring and
release-notes gate. This one cannot, measured 2026-08-04 and re-measured 2026-08-22:

1. **The shared gate would withhold every config publish, permanently, on a green run.** It answers
   "is a release pending" from the **root** `package.json`'s version. This repository's root manifest
   is `cosyte-config`, `private: true`, pinned at `0.0.0`; Changesets does not version a private root
   package, so that value has never changed and never will. Running the shared `prepare` against this
   repository returns `is-release=false`, code `never-versioned`, and the shared workflow supplies
   `publish:` only when that is `true`. That is a strictly worse instance of the silent-withholding
   class the changeset guard exists to close.
2. **It tags `v<version>`.** Its own comment states the assumption: "Every caller of this workflow is
   a single-package repo." This repository publishes eight.

`config/.github/workflows/ci.yml` used to carry a NOTE saying Phase C would replace the hand-rolled
workflow with a thin caller. That NOTE was stale and is corrected: Phase C was measured against this
repository and declined for the two reasons above.

The portable halves were ported instead: the `RELEASE_PR_TOKEN` wiring, a notes gate rebuilt for the
multi-package shape, and now the ungated-version / gated-publish split, which is filed as a follow-on
against `cosyte/.github` in the evidence record. If the shared workflow ever grows a multi-package
mode, revisit this.

## Authentication today

This repository is **public**, so publishing authenticates with `NPM_TOKEN`, an org-level secret
shared across the `@cosyte/*` repositories, and **with provenance**. `NPM_CONFIG_PROVENANCE` is wired
to `github.event.repository.visibility == 'public'`, so provenance is on with no workflow edit.

`NPM_TOKEN` **must be an npm _Automation_ token** (or a granular token). A classic _Publish_ token
demands a 2FA one-time password that CI cannot supply, and the publish dies with `EOTP This operation
requires a one-time password from your authenticator`: after a green build, at the very last step.
Note that a repository-level `NPM_TOKEN` silently overrides the org-level one, so keep the token in
exactly one place.

`NPM_TOKEN` and `NODE_AUTH_TOKEN` are supplied to the `publish` job **only**. The ungated `version`
job has neither, and is given no `publish:` input either, so reaching the registry from an ungated job
would take two independent mistakes rather than one. Keep it that way.

### The surface is declared, not described

Everything above used to live only in prose, here and in `release.yml`'s comments, and nothing
machine-checked that the described surface was the actual one. **`.github/credential-surface.json` is
now the declaration**: every credential the publish path consumes, and for each one its required
token class, the single storage location it may occupy, the job and step permitted to receive it, and
the condition that retires it. `scripts/credential-surface.mjs` compares that declaration against
`release.yml` and against this document, and **fails on any disagreement in either direction**: a
secret the workflow references and the declaration does not name, a credential the declaration names
that is no longer where it says, a credential exposed at a wider scope than declared, a
`GITHUB_TOKEN` permission grant beyond the declared one (or a job with no `permissions:` block, which
silently inherits the workflow-level grants), a registry-reaching job that does not reference the
protected environment, an issued credential form the log scrubbing does not cover, and a declared
credential this section omits.

It runs in `ci.yml`'s **required** `verify` job, so a credential-surface change is refused **at merge
time**, before anyone is asked to approve a deployment. Locally it is `pnpm credentials:check`.

**Change the declaration in the same commit as the workflow change it describes.** A pull request
that moves a credential and leaves this file alone does not merge, which is the entire point.

**What it cannot see.** Whether the `release` environment actually carries its required reviewer and
`main`-only policy is a GitHub-side fact, and referencing an environment that does not exist makes
GitHub silently auto-create an unprotected one of that name. The check asserts that the publish job
**asks** for the gate. That the gate exists is verified out of band, with the API call in "The
`release` environment" above.

## Credential rotation, revocation, and compensating actions

One procedure per declared credential, each covering issue, install, verify and revoke, plus the
manual compensating action for when the credential has already been used. `credential-surface.mjs`
fails if a credential in `.github/credential-surface.json` has no subsection here, or if a subsection
is missing one of those five steps, so this section cannot fall behind the declaration.

**No automated rollback.** There is no automated rollback for a credential change in this repository,
at any tier. Reverting the commit that changed a credential's wiring restores the workflow text and
restores nothing else: it does not un-issue a token, does not remove a secret from the organization or
the repository, does not revoke a token already copied elsewhere, and does not recall anything that
token published. Every remedy below is a human action taken against npm or GitHub, in that order, and
the compensating action per credential is the whole of it.

**A published version is permanent.** A version that has reached the registry stays there and is not
undone by revoking the credential that published it. Revoking `NPM_TOKEN` stops the **next** publish;
it does nothing about the one that already happened. npm's unpublish window is narrow and its use is a
founder decision with consumers on the other side of it, so the compensating action for a bad publish
is a **new version**, not a withdrawal. Treat "the credential was compromised" and "the wrong bytes
shipped" as two separate incidents with two separate remedies, and do not let revoking a token feel
like it addressed the second.

### `NPM_TOKEN`

**Blast radius before you start.** This is an **organization** secret shared by every `@cosyte/*`
repository. Rotating it affects all of them, not just this one, and there is no per-repository
override that is safe to introduce: a repository-level `NPM_TOKEN` silently outranks the
organization-level one, which is exactly how two tokens end up live with nobody sure which one
published.

- **Issue.** On npmjs.com as the `@cosyte` scope owner: Access Tokens, then Generate New Token, then
  **Granular Access Token** (or **Automation**). Grant it read and write on the `@cosyte` scope,
  nothing else, and set the shortest expiry the release cadence tolerates. **Do not issue a classic
  Publish token**: it demands a 2FA one-time password that CI cannot supply, and the publish dies with
  `EOTP This operation requires a one-time password from your authenticator` after a green build, at
  the very last step.
- **Install.** Set it in **exactly one place**: the `cosyte` organization secrets
  (`gh secret set NPM_TOKEN --org cosyte --visibility all`). Then confirm no repository-level copy
  exists anywhere it would shadow the organization one:
  `gh secret list --repo cosyte/config` must not list `NPM_TOKEN`. Delete any that does.
- **Verify.** Do not verify by publishing. Run the `Release` workflow on a `main` with no pending
  changesets, approve the `publish` deployment, and read the run: `changeset publish` reports "no new
  packages" and the accounting step says every bumped package is on the registry. A wrong-typed token
  fails there with `EOTP` and an expired one with `E401`, both **before** anything is written, because
  the publish preflight (`scripts/publish-preflight.mjs`) refuses an absent or empty token before the
  build even runs.
- **Revoke.** On npmjs.com, Access Tokens, revoke the old token **after** the new one is installed and
  verified, not before: the two steps overlap deliberately so no release window is left with no
  working token. Then re-read `gh secret list --org cosyte` and confirm one entry, one value.
- **Compensating action.** If the token is believed compromised, invert the order: **revoke first**,
  accept that every `@cosyte/*` publish is blocked until a replacement is installed, and say so in the
  org channel because thirteen other repositories share it. Then `npm token list` and audit recent
  versions of all eight packages (`npm view <pkg> versions --json`) against this repository's tags. A
  version that reached the registry cannot be pulled back by revoking the token that published it: if
  the bytes are wrong, publish a corrected **new** version and, only if the content is genuinely
  dangerous, take the unpublish question to the founder. Finally, harden: set the packages and the org
  to "Require two-factor authentication and disallow tokens", which makes a stolen token useless and
  is the same setting the OIDC cutover wants anyway.

### `RELEASE_PR_TOKEN`

**Optional by design.** Absent, the version arm still runs and the workflow prints a loud warning; the
only symptom is a Version Packages PR that arrives with zero applicable checks and therefore cannot be
merged by anyone. **Never make its absence fail the release closed.** That would take the release path
down to protect against a state this repository is already able to be in.

- **Issue.** As the release owner, on github.com: Settings, Developer settings, Personal access
  tokens, **Fine-grained tokens**, Generate new token. Resource owner `cosyte`, **Only select
  repositories** and select `config` alone. Repository permissions: **Contents** read and write,
  **Pull requests** read and write, **Metadata** read. Nothing else, and in particular **not**
  `Workflows: write`: `pnpm run version` only touches `packages/*/package.json`,
  `packages/*/CHANGELOG.md` and `.changeset/`. Set an expiry and diary it.
- **Install.** `gh secret set RELEASE_PR_TOKEN --repo cosyte/config`. Repository level, not
  organization level: it is scoped to this repository and there is no reason for another to hold it.
- **Verify.** Push any commit to `main` that leaves a changeset pending, then read the `version` job's
  first step. With the token set it prints that the Version PR's required checks will actually run;
  without it, a `::warning` with the title `Version PR will land with zero checks`. Then confirm the
  PR it opened is authored by a human login:
  `gh pr view <n> --repo cosyte/config --json author` must not return `github-actions`.
- **Revoke.** Delete the token on github.com, then
  `gh secret delete RELEASE_PR_TOKEN --repo cosyte/config`.
  Removing the secret and leaving the token live is the wrong half to do first: the
  workflow falls back to `secrets.GITHUB_TOKEN` immediately, so there is no outage to race, and a
  token nobody uses is the one that gets forgotten.
- **Compensating action.** A Version PR already opened under a revoked or wrong token **cannot be
  rescued**: its head sha was pushed by the wrong identity and no check will ever attach to it. Close
  it, leave its `.changeset/*.md` files on `main` untouched, install a working token, and push a
  trivial commit so a fresh PR opens under it. See failure state (a) above for the full sequence. If
  the token itself leaked, revoking it is sufficient harm reduction: it cannot publish to npm, it
  cannot edit workflows, and its blast radius is this repository's contents and pull requests.

### `GITHUB_TOKEN`

**Nothing to rotate.** GitHub mints this token at job start and revokes it at job end, so there is no
stored value, no expiry to diary, and no revocation request to make. What can drift is its **scope**,
and that is what the declaration pins: a per-job `permissions:` block for every job, checked grant by
grant, plus a refusal when a job declares no block at all and would silently inherit the
workflow-level grants, `id-token: write` included.

- **Issue.** Not applicable, and deliberately so: no human issues this credential. The equivalent act
  is granting it a permission, which is an edit to a `permissions:` block in `release.yml` **and** to
  `.github/credential-surface.json` in the same commit. A grant added to only one of the two does not
  merge.
- **Install.** Not applicable. The token is never stored. What is installed is the grant: keep every
  job's `permissions:` block explicit and minimal, and keep the workflow-level block as the ceiling
  rather than as a default anyone inherits by accident.
- **Verify.** `pnpm credentials:check` reports every grant that differs from the declaration, in both
  directions, and names any job without a block of its own. In a run, the deployment's log shows the
  token's permissions in the "Set up job" group; `id-token: write` must appear on `publish` and on
  nothing else.
- **Revoke.** Narrow or remove the grant in `release.yml` and in the declaration together, then merge.
  The next job mints a token without it; there is no live credential to invalidate. Removing
  `id-token: write` from `publish` also turns npm provenance off, so treat that grant as part of the
  publish contract rather than as hygiene.
- **Compensating action.** A leak of this token is bounded by the job that held it and expires with
  that job, so the remedy is not revocation but audit: read the run's log, list what the token could
  reach under that job's declared grants, and check `main`'s history and this repository's releases
  and pull requests for anything it wrote. If a grant turns out to have been wider than the work
  needed, narrow it in both files in one commit. Anything the token published to npm is out of its
  reach by construction: it has never held registry credentials, and the version arm holds no npm
  token at all.

## Proving the pipeline without burning a version

The `release-dry-run` job in `.github/workflows/ci.yml` runs on every push and pull request:

- `pnpm -r publish --dry-run --no-git-checks`: exercises the publish command path (auth-free, never
  uploads). The real release publishes via `changeset publish`, so this is a faithful proxy for the
  pack/manifest/access path rather than the literal release command. Green as "no new packages" until
  a changeset bumps a version, then it packs and validates that new version.
- `pnpm -r --filter "./packages/*" exec npm pack --dry-run`: asserts each publishable tarball
  assembles with the correct file set and built `dist`, **independent of what is already on npm** (a
  plain `publish --dry-run` skips already-published versions and would prove nothing for them).

A red here means a real release would fail. This is the "prove the pipe, burn nothing" gate.

### Keep packing tools out of `prepublishOnly`

`@cosyte/test-utils`'s `prepublishOnly` used to end in `pnpm attw`, and `attw --pack .` packs a
tarball of its own into the directory being published. Run from a `pnpm publish --dry-run` it did not
pack at all, and the step died with `ENOENT: cosyte-test-utils-0.0.2.tgz`.

**It stayed hidden because `publish --dry-run` skips a version already on npm**, so the whole
`prepublishOnly` chain only ran on a version bump. It first fired on the `0.0.2` Version PR
(2026-07-31).

`attw` still runs where it belongs: `pnpm attw`, as its own step in `verify`. Coverage is unchanged.
**Do not put a tool that packs, publishes, or installs back into a lifecycle script that publishing
itself invokes.**

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
than an npm one: attw packs with `execSync("npm pack")`, and `/bin/sh` is dash on Debian and Ubuntu
(so on the runner), which refuses to export a name that is not a valid shell identifier, while bash
forwards it. The strip covers the hyphen either way.

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
with seven red cases on a tree whose only change was a `CHANGELOG.md`. The fix is at the source rather
than in the caller: **`scripts/attw.mjs` strips those two keys from the environment of the `attw`
child**, in both copies of the wrapper, so every scaffolded parser inherits it.

## Still deferred: OIDC trusted publishing

**Provenance is live** (the repository is public). **OIDC trusted publishing**, publishing with no
token at all, is the remaining step. A turnkey sequence:

1. ~~**Bump the runner toolchain floor**~~: **DONE.** `packageManager` is now `pnpm@10.34.5`
   (>= 10.16) and the `setup-node` pins are `22.14` (>= 22.14) across `ci.yml` (`release-dry-run`)
   and `release.yml`; `engines.node` is `>=22.14`. Since publish runs via `pnpm run release`, **pnpm**
   carries OIDC trusted publishing, so the npm-CLI floor (npm >= 11.5.1) is not on the publish path
   and no `npm i -g npm@...` step is needed. `pnpm/action-setup@v6` reads `packageManager`, so the
   dry-run and release jobs install 10.34.5.
2. **Configure the Trusted Publisher on npm**: for each of the eight `@cosyte/*` packages: Settings,
   then Trusted Publisher, then GitHub org `cosyte`, repository `config`, workflow filename
   `release.yml`, environment name `release`, allowed action `npm publish`. **The environment name is
   still `release` after the 2026-08-22 split**, because the publish job is the one that kept it.
3. **Remove `NPM_TOKEN` / `NODE_AUTH_TOKEN`** from the workflow and repository secrets; keep
   `permissions: id-token: write` on the `publish` job (already present).
4. **Harden npm**: set the package and org to "Require two-factor authentication and disallow tokens";
   OIDC trusted publishers keep working, stolen tokens become useless.

Steps 2 to 4 are founder steps, not a build.

## The evidence behind all of this

[`documentation/release-stall-evidence.md`](documentation/release-stall-evidence.md) carries the
measurement: how the population of `.changeset/`-carrying repositories was enumerated, all 185 Version
Packages PRs with their idle times, the attribution of the two stalls, the gap analysis against what
the other repositories actually run, the disposition recorded for the acknowledgment, and the
follow-on list of changes this process implies in repositories other than this one. The per-PR table
is `documentation/release-stall-evidence/version-packages-prs.csv`. The **raw API responses for every
query that could not be bounded** are committed, base64-encoded, under
`documentation/release-stall-evidence/raw/` (446 KB across six files; the record's deposit table
carries a sha256 of each decoded body). That record's retrieval section says per query whether
re-running it reproduces the answer, or whether the deposit is the thing to read instead, or whether
the query merely returns whatever is true now. Read that section before quoting a number from it back
at anyone: the 62-run census in particular is dated and does not re-derive.
