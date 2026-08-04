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

### Added

- **`scripts/changeset-guard.mjs`: an inert changeset can no longer withhold a publish on a green
  run** (`DEPENDABOT-PR-QUEUE`, item 2). `changesets/action` given only changesets that resolve to
  zero package bumps logs `All changesets are empty; not creating PR`, opens no Version PR,
  publishes nothing, and **exits 0**. Run 30640138565 (2026-07-31) did exactly that: approved
  through the protected `release` environment as a real publish, reported success, and shipped none
  of the six packages whose manifests were already a patch ahead of the registry. `cf07086` (#41)
  deleted the offending file and wrote the finding down, which fixed the instance and left the
  class. The guard runs first in both `ci.yml` and `release.yml`, before install, and refuses per
  file rather than per repo. The copy that spares an approver is the **`ci.yml`** one: `release.yml`
  declares `environment: release` at job level, so that whole job waits for approval before its first
  step runs.
  - **Three shapes bump nothing, and only the first is what the action calls empty.** Frontmatter
    that declares no packages (`yaml.load` of an empty block returns falsy and
    `@changesets/parse@0.4.3` sets `releases = []` **without throwing**, so the file parses cleanly
    and carries a human summary). A changeset whose every entry is type `none`, which is **valid**
    in the parser's own `validVersionTypes`, so its releases list is non-empty, it does **not** trip
    the action's emptiness check, and it instead opens a Version PR that changes no version. And a
    misspelled package name. All three are read off the vendored parser source, not inferred from
    the log line.
  - **`none` alongside a real bump is still accepted**, because that is what `none` is for.
  - **The negative control is committed, not run once by hand** (`test/changeset-guard.test.ts`, 14
    cases). It drives the shipped CLI with `execFileSync` and asserts the **process exit code**,
    because what the workflow depends on is the exit code and an exported function returning
    `{ ok: false }` proves nothing about it. This repo has already been bitten by that exact gap
    (#42, where `attw`'s wrapper exited 0 on an untyped pack). Both directions are pinned: an inert
    changeset **must** exit non-zero, a real one **must** exit zero, and an empty `.changeset/`
    directory must exit **zero** because that is the publish arm and refusing it would block every
    release. A guard that refuses everything fails the first control; one that refuses nothing fails
    the second.
  - **A guard that cannot run exits 2, never 1.** 1 is reserved for "an inert changeset was found",
    and collapsing the two would make a broken gate and a caught defect one signal.

- **`scripts/release-notes.mjs`: release bodies are derived and checked before npm is touched**
  (`DEPENDABOT-PR-QUEUE`, item 1). `changesets/action` defaults `createGithubReleases` to **true**,
  and builds each body by finding a `## <version>` heading in that package's `CHANGELOG.md`. Every
  package here sets `"changelog": false` and hand-maintains its changelog, so `changeset version`
  writes no such heading, the action finds none, and **its fallback is the whole file**: on
  2026-07-31 all six bodies published as the raw `CHANGELOG.md`, `# Changelog` preamble and
  `## [Unreleased]` included. The bodies were corrected by hand, which is not a gate.
  `createGithubReleases` is now **false**, which removes the dumping behaviour outright, and this
  script supplies the replacement.
  - **Derived from the changesets the version commit consumed, not from the CHANGELOG.** Deriving
    from the changelog would require a `## [0.0.6]` heading for a version that does not exist when
    the changeset is written, and with the generator disabled nothing writes it, so a gate asserting
    it would refuse every release until a human predicted the next version by hand. That is a
    deadlock of a shape this org has already met. A changeset is written per change, carries a
    summary by construction, and is deleted by the version commit, which is what makes "what did
    this version consume" answerable from git.
  - **Ordering is the point.** The changesets are in the tree at `HEAD^`, so every refusal runs with
    the registry untouched. A published version is permanent (ADR 0001), so a check after the
    publish is a complaint, not a gate.
  - **What it refuses:** a version bump that consumed no changesets; a consumed changeset with an
    empty summary; a bumped package no changeset describes; and, asserted on the **finished bytes**
    by a separate entry point that knows nothing about how they were produced, a body that is empty,
    a stub, an em dash, one naming a different version than the one being tagged, or one carrying
    any of the three fingerprints of the CHANGELOG dump. It deliberately does **not** port
    `cosyte/.github`'s prose classifier: that is tuned against a single-package parser's changeset
    corpus, and an uncalibrated classifier that refuses a good release is worse than none.
  - **The publish command is NOT gated on the classifier**, and that is deliberate. The shared
    workflow withholds `publish:` when its notes step says "not a release"; here, a classifier that
    was wrong in that direction would **withhold a publish on a green run**, which is precisely the
    failure item 2 exists to close. So the publish stays unconditional, and a second step refuses
    loudly if a publish happens on a commit the gate never recognised. A misclassification reddens;
    it never withholds silently.

- **🩺 WHAT THE GATE CAUGHT, AND IT WAS THE SAME DEFECT CLASS THIS SLICE EXISTS TO CLOSE.** The
  first draft keyed the post-publish step on `steps.changesets.outputs.published == 'true'` and
  looped over `publishedPackages`. `gate-refuter` **REFUTED** it by measuring the action's own
  `run.ts`: `git.pushTag` sits inside `if (createGithubReleases)`, so turning that flag off makes
  this step the **only** thing that creates a tag. Then:

  > Six packages publish. `gh release create` succeeds for two and fails on the third. The step reds,
  > so an operator re-runs it. On the re-run `changeset publish` finds all six already on the
  > registry, publishes nothing and exits 0, so `published` is `false`, so the step is **skipped**,
  > so the run goes **GREEN** with four packages on npm carrying no tag and no release, permanently.

  A green run that did nothing, arrived at through the very fix for green runs that did nothing.
  **The step is now driven by what the version commit BUMPED, runs on `!cancelled()`, and asks the
  REGISTRY whether each package is actually there**, so a re-run completes the job instead of
  skipping it and a bumped package that never published is named rather than counted as done. Note
  this half is **not a base regression**: with `createGithubReleases` at its default of true the
  action pushed the tag inside its own call, so base lost a release _body_. Losing the _tag_ is new,
  and it matters more here than it looks because this repo's changelog headings are dated from tags.
  - `changesets/action` is now **pinned to `a45c4d5`**, the sha `cosyte/.github` pins and the sha the
    `pushTag` behaviour above was measured at. A floating `@v1` could move the internals this file
    now depends on with no diff here.
  - Three smaller findings, all applied: a comment claiming the guards run "before an approver is
    asked for anything", **false in `release.yml`** because `environment:` is declared at job level
    so the whole job waits first (the `ci.yml` copy is the one that genuinely spares the approver);
    the guard exiting 2 on `"@cosyte/x": patch # comment`, valid YAML a human plausibly writes, now
    accepted with a committed control proving an inert file carrying a comment is still refused; and
    the fact that this guard **bans an idiom this repo used deliberately three times**
    (`changeset add --empty` for a repo-level note), now written down in `RELEASING.md` with the
    root `CHANGELOG.md` named as the only home for such an entry.

### Changed

- **`config` stays on its own `release.yml` rather than becoming a thin caller of
  `cosyte/.github/.github/workflows/release.yml@main`, and the reason is measured, not preferential.**
  Adopting the shared workflow was the intended remedy and it cannot serve this repo's six-package
  shape:
  - Its gate answers "is a release pending" from the **root** `package.json`'s version. This repo's
    root manifest is `cosyte-config`, `private: true`, pinned at `0.0.0`, and Changesets does not
    version a private root package, so that value has never changed and never will. Running the
    shared `prepare` against this repo returns `is-release=false`, code `never-versioned`. The
    shared workflow supplies `publish:` **only** when that is `true`, so adopting it would withhold
    **every** config publish, permanently, on a green run: a strictly worse instance of the class
    item 2 exists to close.
  - It hardcodes `tag="v${version}"`, and its own comment states the assumption: "Every caller of
    this workflow is a single-package repo". This repo's fourteen tags are all `<pkg>@<version>`,
    and six packages publishing in one run would collide on a single tag.

    So the two portable halves were ported instead (the token wiring, and a notes gate rebuilt for
    six packages) and the workflow comment records what to delete if the shared one ever grows a
    multi-package mode.

- **Both gates run in `ci.yml`'s `verify` job, not only on push to `main`.** `verify` is a required
  status check in the `config-ci-required-checks` ruleset and a separate job would not be, so this is
  the half that can be made blocking from inside the repo, following the precedent the em-dash gate
  already set in that file. `verify` now checks out with `fetch-depth: 0`, which the notes gate needs:
  a shallow clone has no `HEAD^`, and the gate would report "no release pending" on every run, green
  and blind. On a Version PR the merge commit's first parent is the base branch, so the check sees
  the same shape the push-to-`main` run will, one merge earlier.

### Fixed

- **The six `packages/*/CHANGELOG.md` no longer head shipped content `[Unreleased]`**
  (`DEPENDABOT-PR-QUEUE`, item 3). Every one of them was **byte-identical to its own latest release
  tag**, so every byte under `[Unreleased]` had already shipped and would have republished on the
  next release. Each section now carries the version it shipped in, dated from that release's tag.
  `@cosyte/vitest-config` needed a **two-way split**: its `[Unreleased]` block spanned two shipped
  versions, and the boundary was read off the `@cosyte/vitest-config@0.0.2` tag rather than guessed
  (the `### Added` block is `0.0.2`, 2026-07-15; the em-dash `### Changed` entry is `0.0.3`,
  2026-07-31). One now-false future-tense clause went with it: "ships in the next release" had
  shipped.
  - **The generator flag was NOT flipped.** `"changelog": false` in `.changeset/config.json` is
    untouched. Whether to turn Changesets' changelog generation on is the founder-owned call tracked
    as `CHANGELOG-PREAMBLE-FUTURE-TENSE`, and it changes the shape of a shipped file in eight repos
    at once. **These six were corrected by hand; the mechanism that produced them is unchanged and
    that call stays open.** Each file now says so at the top: promotion of `[Unreleased]` to a
    version heading is manual, in the PR that adds the changeset.

- **`release.yml` carries the `RELEASE_PR_TOKEN` wiring, so a Version PR can run its checks.** GitHub
  does not start workflow runs for events produced by `GITHUB_TOKEN`, so a Version PR opened with it
  arrives with **zero checks**, and a required check that never reports is PENDING rather than
  failing: with `bypass_actors: []` nobody can merge past it, an admin included. Both halves are
  needed and the second is the one that is easy to miss. The token goes in the action's `env` (the
  action reads `process.env.GITHUB_TOKEN || core.getInput("github-token")`, so the env wins and
  adding the input alone would be a silent no-op), **and** the caller checkout sets
  `persist-credentials: false`, because the version commit is pushed by `git push` out of that
  checkout and the persisted `http.<host>.extraheader` otherwise outranks the `~/.netrc` the action
  writes. Fixing only the first fixes `opened` and leaves `synchronize` broken, which means it works
  until the second changeset. Absent, the secret **falls back to `GITHUB_TOKEN` and warns loudly**
  rather than failing closed: failing closed would take this repo's release path down to protect
  against a state it is already in.

- **The three residuals `TEMPLATE-REMINTS-BOTH-GATES` left in the parser template, closed at the
  source** (`TEMPLATE-SCAFFOLD-RESIDUALS`). `scripts/scaffold-parser.mjs` mints every new
  `@cosyte/*` parser from `scripts/parser-template/`, so each of these was not a defect in one repo
  but the shape every future repo would be born with. All three are measured on this tree; the new
  and changed cases red on the unfixed template (4 of the 16 `phi-scan` cases, and the forwarding
  pin below reds on a wrapper that drops the flag).
  - **A missing allow-list took exit 1, the code the contract reserves for HITS FOUND.**
    `loadAllowList()` sat outside `main`'s `InvocationError` handler, so a run that cannot find
    `scripts/phi-allow-list.txt` threw uncaught and got node's own 1. A caller that branches on the
    code, and CI is one, read "this corpus contains PHI" off a run that never opened a file. The load
    now sits inside the handler and refuses with 2. The previous suite asserted this as MEASURED
    (`not.toBe(0)`, with the defect written into the comment); the assertion is now the exact code,
    plus a counterfactual that rebuilds the old placement out of the emitted scanner and shows exit 1
    returning. **The live trigger is NOT a fresh scaffold**, which a draft of this entry and of the
    scanner's own docblock both claimed: the template ships `scripts/phi-allow-list.txt` and the
    scaffolder copies it, verified against a real `scaffold-parser.mjs` run. It is the scanner
    invoked from the wrong working directory, since `REPO_ROOT` is `process.cwd()`. The narrower
    claim is the one the suite actually exercises, and this file gets minted into every new parser,
    so the wrong one would have been copied with it.
    **What this does NOT claim:** an allow-list that exists but cannot be READ (a directory at that
    path, or mode 000) makes `readFileSync` throw a plain `Error`, which the handler wrapping it
    rethrows, and the run still takes exit 1. That is `PRE-EXISTING`, unchanged, and not answered by
    widening the catch or by enumerating `EACCES`/`EISDIR`: that is the deny-list shape the `attw`
    guard next door just retired. Its own slice if it is worth closing.
  - **The staged enumerator's status filter is now `--diff-filter=d` (an EXCLUSION) rather than
    `AMT` (an allow-list).** `synth#37` and `ncpdp#54` both ended on the exclusion form with "do not
    narrow this back to an allow-list" written down, and an allow-list is the wrong polarity for a
    safety gate: every letter it does not name is dropped in silence, which is exactly how sibling
    scanners missed `R` and then `T`, one refuter pass apart. With `--no-renames` already preventing
    `R` and `C` the practical delta is `U`, `X` and `B`. **This diff's base is `AMT`, not `AM`**, so
    what it closes is narrow: `AM` was this template's base one slice back, and `702fd2a` is what
    moved it to `AMT`, so repeating the backlog line's "strictly better than base's `AM`" here would
    have described a wider hole than the one this diff actually found. **It is still the right
    change, because this
    template is what every future parser inherits and it should not be the copy carrying the older
    shape.**
    Measured on git 2.39.5: a conflicted path lists as `:100644 000000 <sha> 0000000 U` plus its
    path, ONE record and two fields, destination mode `000000`, so the two-field stride is unaffected
    and the mode reaches the non-regular refusal (exit 2) instead of being dropped unlisted. A new
    case builds a real merge conflict in the emitted repo and pins both directions: `AMT` lists
    nothing, `d` lists it, the scan refuses, and restoring `AMT` makes the same tree report clean.
  - **`--no-definitely-typed`'s FORWARDING is now pinned on its own.** Every other case in the attw
    suite passes it so the gate stays off the network, and that is precisely why none of them pinned
    it: the flag rode along on every run, so a wrapper that ACCEPTED it and then dropped it kept the
    whole suite green. The acceptance half was covered incidentally by the allow-list; the
    forwarding half was not covered at all. The real CLI cannot answer the question (it reports on a
    tarball, not on its own argv, and the flag only suppresses a network lookup), so the pin runs the
    EMITTED wrapper against an `attw` shim that records what it was handed. **With a negative
    control**: without the flag the shim must see `--pack .` and nothing else, which is what stops a
    wrapper that hardcodes the flag from satisfying the pin. `--profile` is pinned the same way in
    both spellings, and `--quiet` is asserted to be refused before attw is reached, so "forwards it"
    cannot be satisfied by forwarding everything. **The same gap is open upstream in
    `terminology#40` and is not touched here.**
  - **Deliberately NOT done, carried forward from `TEMPLATE-REMINTS-BOTH-GATES` unchanged: the
    template's own starter suite gains no symlink cases.** Nothing in this repo can execute
    `scripts/parser-template/test/`, and shipping unexecuted tests into every new parser is worse
    than shipping none. The coverage lives in this repo's `test/phi-scan-scaffold.test.ts`, which
    runs the real scaffolder and exercises the EMITTED scanner.
  - **Also deliberately not done: the fix is not ported into the existing parser repos.** Those
    carry their own copies and their own history; this item is about what gets MINTED. Porting is a
    separate item with a separate owner.

- **The parser template was still re-minting both gate holes into every new parser, and it was the
  last source of either** (TEMPLATE-REMINTS-BOTH-GATES). `scripts/scaffold-parser.mjs` mints every
  new `@cosyte/*` parser from `scripts/parser-template/`, so a hole left there is not one repo's
  defect: it is every future repo's. The two 2026-08-03 class ports had landed across the fleet and
  this template had received neither. Three halves, all measured on this tree rather than carried
  over as prose.
  - **The `attw` argument guard is now an ALLOW-LIST** (`--profile`, `--no-definitely-typed`,
    everything else refused), ported from `terminology#40`. **A deny-list bought exactly one more
    evasion per round, and this repo had already paid for two of them.** The first shape matched
    tokens, so `-fjson` was neither `-f` nor `--format` and walked through; the second matched short
    clusters per character, which closed `-fjson`/`-Pfjson`/`-Pf json` and **closed nothing else**.
    Measured here against `@arethetypeswrong/cli@0.18.4` on a pack whose tarball carries no types,
    through that per-character guard: **`--help`, `-h`, `--version` and `-V` each exited 0 with the
    untyped sentence absent and a NON-EMPTY transcript**, so the empty-output net could not backstop
    them either and the gate could not tell any of the four from a pass. The allow-list retires all
    four at once, and `--config-path`, `--definitely-typed`, `--ignore-rules` and every future
    spelling fall out for free. `--profile`'s value is still forwarded, separated or fused, pinned
    on the **ESM-only** fixture, which is the only one here attw judges differently per profile
    (measured: default reds it, `esm-only` does not, `node16` reds it). The bare-CLI premise is
    asserted **first** and the same wrapper without a profile is asserted to still red, so a dropped
    value **or a hardcoded default** reds the case. **A draft of this pinned it on the well-formed
    dual package instead, where attw returns 0 with or without a profile, so the assertion was
    `0 === 0` and a gate hardcoding `--profile strict` kept all 29 cases green.** The gate's own
    docblock says every drift between copies of a claim is a claim edited in some of them and not
    the others; this one was caught by the gate's refuter, in this diff, and is recorded rather than
    quietly corrected.
    - **The six cluster rules were deliberately NOT extended, and the per-character machinery is
      gone rather than kept beside the allow-list.** Enumerating spellings is a ceiling, not a fix.
    - **What this does NOT close, stated because the gate's own prose must not imply otherwise:**
      `readConfig()` applies a committed `.attw.json` after argv and calls `setOptionValueWithSource`
      for nearly every key, **so the config route wins regardless of the allow-list.** The
      name-scoped `.attw.json` refusal covers `quiet` and `format` only. `terminology#40`'s gate
      insisted that be **its own item** rather than a fourth round here, and it still is.
  - **The preflight's exit-code counterfactual is deleted rather than reworded**, and both branches
    of it are pinned absent. It read the MANIFEST and never the TARBALL, and the tarball is what
    `containsTypes()` keys on (`listFiles(directory).some(ts.hasTSFileExtension)`, computed before
    any entrypoint resolves), so a package whose `files` packs a whole `dist/` can lose every
    declared declaration and still hand attw an undeclared chunk declaration to find. A gate that
    reds correctly and then explains itself with a falsehood teaches the next reader the wider,
    wrong story, and this file gets copied.
  - **The preflight now reads `bin` and normalizes a path declared without a leading `./`.** Both
    measured leaving the old gate at exit 0: a manifest promising `bin: {demo: "./dist/cli.js"}` with
    no such file (attw never looks at `bin` at all), and `"types": "dist/index.d.ts"`, which is legal
    and is the spelling npm's own documentation uses. The second dropped a real promise while the
    gate still reported it had checked. `exports` leaves are left alone: Node requires `./` there.
  - **`scripts/phi-scan.ts` refuses (exit 2) an in-scope entry that is not a regular file, on BOTH
    enumerating routes**, ported from `terminology#37` plus `dicom#60`'s `--no-renames`. Measured on
    the emitted scaffold with a synthetic name-bearing payload outside the walk roots: all-mode
    exited **0** `OK: no hits`, `--staged` exited **0** after `git add`, and naming the target
    explicitly exited **1** with the hit. **The payload was detectable the whole time; the two routes
    never looked at it.** `walk()` enumerates `Dirent.isFile()`, an lstat answer, so a link is
    neither a file nor a directory and fell out silently; `--staged` reads content with
    `git show :<path>`, and git stores a link as its TARGET PATH under mode 120000, so that route was
    handed the path text. Neither route is made to follow a link, and **a refusal never prints the
    target**, which is working-tree text that can itself carry PHI.
  - **THE SCOPE PREDICATE IS SPLIT, AND THAT HALF IS THE ONE TWO SIBLINGS EACH FOUND THE HARD WAY.**
    `synth#37` and `ncpdp#54` independently shipped a single shared predicate and both had the two
    routes disagree about a `.md`-named link, because root scope and the read filter were one test.
    Here `isUnderScanRoot` decides whether an entry is the scan's business (every non-regular check
    keys on it) and the read filters decide whether a regular file's bytes are read. Pinned with a
    counterfactual: a scanner built by collapsing the two exits **0** under `--staged` on a
    `src/notes.md` link that all-mode refuses.
  - **`--no-renames` and `--diff-filter=AMT` are both load-bearing, each pinned with its git premise
    asserted first.** With rename detection on (the default), `git mv <link> test/fixtures/<name>` is
    an ordinary developer action that stages as `:120000 120000 ... R100` with two paths, which the
    status filter then deletes outright: measured, the record set was **empty** and a scanner with
    detection left on printed `OK: no hits` and exited 0 over a mode-120000 entry under the corpus
    root. Replacing an already-TRACKED fixture with a link raises `T`, which `--diff-filter=AM`
    deleted before any mode could be read. An index entry at exactly `test/fixtures` (git records
    none for a directory, so the corpus root itself replaced) is in scope too.
  - **`prepublishOnly` no longer ends in `&& pnpm attw`**, the shape `f32e7dd` removed from
    `@cosyte/test-utils` and which the template kept re-minting. `test/attw-scaffold.test.ts`
    previously asserted nothing about it on purpose; it now asserts the packing tool is absent **and
    that the rest of the chain is still there**, so the case cannot be satisfied by deleting the
    script.
  - **`test/phi-scan-scaffold.test.ts` is new, and it exists because the template's own suite never
    runs in this repo.** It travels into a scaffolded repo and runs against that repo's
    `node_modules`, so a defect in the template's scanner was invisible to this repo's CI. The new
    suite runs the REAL scaffolder and exercises the EMITTED scanner (through Node's type stripping,
    since `tsx` is not installed by a test). **9 of its 15 cases red on the pre-port template**; the
    6 that stay green are the ones that should, including the negative control and the `.md` READ
    exemption. The `attw` suite reds **20 of 29** on the pre-port gate.
  - **Deliberately NOT done here:** the template's own starter suite gains no symlink cases. Nothing
    in this repo can execute it, so shipping unexecuted tests into every new parser is worse than
    shipping none; the executed pin lives in this repo's root suite instead. Also unfixed and
    unrelated to this slice: `loadAllowList()` is called outside `main`'s `InvocationError` handler,
    so a missing allow-list escapes as an uncaught throw and takes exit **1**, the code this
    contract reserves for "hits found". Pre-existing, asserted as measured rather than as it ought
    to be.
  - No changeset, deliberately, per the two entries below: `packages/test-utils` publishes only
    `dist`, `README.md` and `CHANGELOG.md`, so nothing in any published tarball changes, and an
    unnecessary changeset silently withholds a release.
- **`attw --pack .` exits 0 on a package whose tarball carries no types, so both `attw` scripts
  this repo owns are now a wrapper that catches it** (ATTW-FALSE-GREEN-PORT; the remedy shipped in
  `@cosyte/terminology` and is ported here). `getExitCode.js` in `@arethetypeswrong/cli@0.18.4`
  opens with `if (!analysis.types) return 0`, returning **before** the problem list is read, so for
  a package that ships types a broken publish is reported as a pass. No `--profile`,
  `--ignore-rules` or config setting reaches that early return. A false red costs an hour; a false
  green merges.
  - **Reproduced on this repo's own package, with zero concurrency.** Against `@cosyte/test-utils`
    at `0.0.2`, both `rm -f dist/index.d.ts dist/index.d.cts && attw --pack .` and
    `rm -rf dist && attw --pack .` print the untyped sentence and exit **0**.
  - **Concurrency supplies the condition and is not the defect, which is why the answer is not a
    lock, a lease or a build queue.** `tsup` writes JS in one pass and declarations in a later one,
    so **every** build has a window in which `dist/` holds `.mjs`/`.cjs` and no `.d.ts`. Polling
    clean `tsup` runs on this package, the JS landed first in **every run measured, 12 of 12 across
    two independent sets**. **No width is quoted, not even a range**: the two sets disagreed about
    the spread on the same idle box, and a draft of this entry quoted a range the next set did not
    reproduce. The load-bearing fact is the order (JS, then declarations); the width is whatever the
    box was doing. The gate has to be able to say its own inputs were missing, whatever removed them.
  - `scripts/attw.mjs` carries **two nets that catch different things**: a preflight that every
    relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf
    of `exports`) exists and is non-empty, which catches the window above and **names the missing
    file**; and a post-check on the untyped sentence, which catches what the preflight structurally
    cannot, declarations present on disk but excluded from the tarball by `files`/`.npmignore`.
  - The post-check reads a string, so what would hide that string is **refused, by option and
    wholesale rather than by value**. Each blinding route was re-measured here rather than carried
    over as prose, and each exits 0 with the sentence gone: `--quiet`, `--format json`, its attached
    short form `-fjson`, and a `.attw.json` setting either (`readConfig()` calls
    `setOptionValueWithSource(..., "config")` inside the command action, **after** argv, so the file
    beats the flag). `--format table-flipped` still prints the sentence and is refused anyway: that
    over-strictness is the deliberate trade against value-parsing the guard.
  - **Short options are matched per character, not per token**, and that is load-bearing rather than
    tidy. Commander accepts an attached value (`-fjson`) and a cluster (`-Pq`), so a guard holding
    the exact tokens `-f` and `-q` lets **both straight through**: `-fjson` was measured handing back
    exit 0 over an untyped pack through exactly such a draft of this guard. attw's short options are
    `-P/--pack`, `-f/--format`, `-p/--from-npm`, `-q/--quiet`, so refusing any cluster containing `f`
    or `q` refuses nothing legitimate.
    **SUPERSEDED by the allow-list entry above, and the two halves fail differently.** The
    measurement stands and is why those spellings are still in the evidence table. The claim that the
    per-character rule "refuses nothing legitimate" does **not** stand as a description of the tree:
    `-P` is now refused like everything outside the allow-list, and the test that pinned it staying
    green is gone. Being over-strict about an argument nobody passes to a repo's own publish gate is
    the deliberate trade.
  - **`--config-path` is refused for a weaker and different reason, and the distinction is not
    pedantry.** On its own it blinds nothing: pointed at a file that does not exist, the untyped
    sentence still prints (measured). What it does is choose **which** file `readConfig()` applies,
    so pointed at one that sets `quiet` it blinds exactly like `.attw.json` (also measured). Upstream
    recorded this refusal as inferred rather than measured; both halves are measured here, and a
    draft of this entry wrongly upgraded that into "the flag blinds", which the tree contradicts.
    Both halves are now pinned by a test.
  - **THE ONE THAT MATTERS MOST IS THE TEMPLATE.** `scripts/parser-template/` is what
    `scripts/scaffold-parser.mjs` mints every NEW `@cosyte/*` parser from, so porting only
    `packages/test-utils/` would have left the defect being **re-minted into every future parser**.
    The two copies of the wrapper are kept byte-identical by an assertion, and
    `test/attw-scaffold.test.ts` runs the real scaffolder and shows the emitted gate reddening on a
    pack that bare `attw` passes. **All six of its cases red on the pre-port tree**, and the
    `test-utils` suite reds **15 of 18** there. Two of the three survivors are pure attw-behaviour
    controls, which are supposed to hold on both sides because they assert what the CLI does rather
    than what the wrapper does. **The third is not**: "still fails when attw itself fails, with
    attw's own status" is a wrapper assertion, and it survives on base only because the wrapper is
    absent there and Node's `MODULE_NOT_FOUND` exit is also `1`, which happens to equal the status it
    compares against. Do not read that one as a control.
  - `packages/test-utils/test/attw-gate.test.ts` pins both nets against the real binary, including
    **attw's own exit 0**, a negative control on a well-formed package, and that a real `attw`
    failure still fails: so an upgrade that reworks the wording or fixes the exit code reds the
    suite instead of letting the net go quietly slack.
  - No changeset accompanies this, deliberately, per the entry below and the `prepublishOnly`
    precedent: nothing in any published tarball changes, and an unnecessary changeset withholds a
    release.
  - **Known and deliberately not fixed here** (CLOSED by TEMPLATE-REMINTS-BOTH-GATES above):
    `scripts/parser-template/package.json` still ended `prepublishOnly` with `&& pnpm attw`, which is
    exactly the shape the entry below removed from `@cosyte/test-utils`, so the template was still
    re-minting it into every new parser. It was release-pipeline work and got its own slice, as
    intended. `test/attw-scaffold.test.ts` deliberately asserted **nothing** about `prepublishOnly`
    so that fixing it would not red this suite; it now asserts the fixed shape.
- **`prepublishOnly` no longer runs a tool that packs, which had broken every version bump.**
  `@cosyte/test-utils`'s `prepublishOnly` ended in `pnpm attw`, and `attw --pack .` packs a
  tarball of its own; run from inside `pnpm publish`'s staging context that pack lands where
  `attw` cannot find it, and the step dies with `ENOENT` on its own tgz. It stayed hidden because
  **`publish --dry-run` skips a version already on npm**, so the chain only ever ran on a bump. It
  first fired on the `0.0.2` Version PR (2026-07-31) and would have failed the real publish
  identically, since `changeset publish` runs `prepublishOnly` too. `attw` still runs twice, as
  its own CI step and in `Pack integrity`, so coverage is unchanged. Rule recorded in
  `RELEASING.md`: never put a tool that packs, publishes or installs into a lifecycle script that
  publishing itself invokes.
- **An empty changeset left in `.changeset/` silently withholds a release.**
  `changesets/action` publishes only when there are **zero** changeset files. With one present that
  bumps nothing it logs `All changesets are empty; not creating PR`, opens no Version PR, publishes
  nothing, and **exits green**. A repo-level note therefore belongs in this file, not in a
  package-less changeset that outlives the Version PR that would have consumed it.

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
