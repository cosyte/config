# Release audit: the `0.1.0` line for the eight published `@cosyte/*` packages

The decision record and the mechanical inputs for cutting `0.1.0`. It says, per package, what is
unreleased and what that classifies as; certifies what the public surface actually is and whether
`0.1.0` removes any of it; lists every change that would be breaking under semver with a disposition
on each; and states the release plan the changesets in `.changeset/` implement.

- **Audited commit:** `b78e2d977ac7615513c21f582c5efe5e42734209` (`main`, "S0092-config-3: defend the
  install with a cooldown and a trust policy, and require both of every target (#89)").
- **Audit date:** 2026-08-31.
- **Item:** `S0200-config-release-prep-1`.
- **Disposition:** [ADR 0002](decisions/0002-the-0-1-0-version-line.md).
- **What this audit does NOT do:** it does not publish, does not run `changeset version`, does not
  tag and does not merge a "Version Packages" pull request. Those are steps 4 to 6 of
  [`RELEASING.md`](../RELEASING.md) and they belong to the release owner. This is step 1: a change
  landed with changesets.

## 1. There are zero pending changesets, and what that means for this audit

At the audited commit `.changeset/` carries exactly two entries, `README.md` and `config.json`, and
`scripts/changeset-guard.mjs` classifies both as `NOT_A_CHANGESET`. **There are zero pending
changesets.** That is not an anomaly: it is the publish arm, and `RELEASING.md` records it as how
every release in this repository starts.

So "audit the pending changesets" cannot be answered by reading `.changeset/`, and reporting an
empty audit would be a true sentence that answers nothing. The unreleased record is resolved from
four places instead, each of which exists in this repository at the audited commit:

| #   | evidence route                                       | what it answers                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `packages/*/package.json` `version`                  | what the workspace says each package is                                                                                                                                                                                                                                                                                                                  |
| E2  | `git tag --list`, tags of the form `<pkg>@<version>` | what was published. `RELEASING.md` records that `release.yml` creates one tag and one GitHub release per package the version commit bumped, **after asking the registry whether each package is actually there**, and reds on `Bumped but never published` when it is not. A tag is therefore evidence of a registry write, not of an intention to write |
| E3  | the registry's own `dist-tags`, fetched 2026-08-31   | what npm says `latest` is today. One response per package, deposited with this item's spec as `sources/registry.npmjs.org---package-cosyte-2F<pkg>-dist-tags`                                                                                                                                                                                            |
| E4  | `git diff '<pkg>@<version>' HEAD -- packages/<dir>`  | what moved in each package since its own release, graded against that package's `files` field for whether the moved path is inside the published tarball                                                                                                                                                                                                 |
| E5  | each package's `CHANGELOG.md`                        | the package's own written unreleased record                                                                                                                                                                                                                                                                                                              |

E1, E2 and E3 agree for all eight packages, which is the useful finding: **the workspace is at
parity with the registry.** Nothing is a patch ahead of npm, which is the state run 30640138565
(2026-07-31) shipped nothing out of and which `scripts/changeset-guard.mjs` exists to keep from
recurring.

## 2. The classification rules applied

Every rule below is written in this repository at the audited commit and is cited to the file that
carries it. No rule is imported from anywhere else.

| #   | rule                                                                                                                                                                                                                                                                                                                      | where it is written                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The eight published packages are `@cosyte/eslint-config`, `@cosyte/prettier-config`, `@cosyte/process`, `@cosyte/script-utils`, `@cosyte/test-utils`, `@cosyte/tsconfig`, `@cosyte/tsup-config`, `@cosyte/vitest-config`. The root manifest `cosyte-config` is `private: true`, is never published and is never versioned | `RELEASING.md`, opening section; `package.json`                                                                                                               |
| R2  | A change that reaches no published tarball gets **no changeset**, because a changeset that bumps nothing is refused. The precedent is stated four times over: `scripts/` and `test/` are outside every published tarball, so a bump there would republish identical bytes                                                 | root `CHANGELOG.md`, the `#55` / `#59` / `#61` / `#62` entries; `scripts/changeset-guard.mjs`                                                                 |
| R3  | A repo-level change that bumps no package goes in the root `CHANGELOG.md` **with no changeset at all**. `changeset add --empty` is banned by name: it writes an empty-frontmatter file, which parses cleanly, carries a summary and bumps nothing                                                                         | `RELEASING.md`, failure state (b)                                                                                                                             |
| R4  | A changeset must name a real workspace package, must not be all-`none`, must carry a non-empty summary and must carry no em dash                                                                                                                                                                                          | `scripts/changeset-guard.mjs`, `gradeChangeset`                                                                                                               |
| R5  | A release body is derived from the changesets the version commit consumed, never from the changelog, and it must name `<pkg>@<version>`, carry none of the three raw-changelog dump fingerprints, and carry no em dash                                                                                                    | `scripts/release-notes.mjs`, `renderNotes` and `assertNotes`                                                                                                  |
| R6  | The unreleased changelog heading is promoted to a version heading **by hand**, in the pull request that adds the changeset. Nothing does it automatically, and until 2026-08-04 nothing did it at all                                                                                                                     | `RELEASING.md`, "Release bodies"; the note block at the top of every package `CHANGELOG.md`                                                                   |
| R7  | Changelog headings are dated from the release's tag, by hand                                                                                                                                                                                                                                                              | `RELEASING.md`, failure state (c)                                                                                                                             |
| R8  | Changesets resolves a version by applying the highest declared type. On a `0.0.z` version, `minor` resolves to `0.1.0` and `patch` resolves to `0.0.z+1`                                                                                                                                                                  | semver, as `@changesets/cli@2.31.0` applies it; `.changeset/config.json` sets no `fixed`, no `linked` and no `ignore`, so each package resolves independently |

**Rule R8 is what decides the changeset type here, and it is worth stating plainly.** The disposition
(ADR 0002) is that all eight packages land at exactly `0.1.0`. From a `0.0.z` version only a `minor`
entry reaches `0.1.0`; a `patch` entry reaches `0.0.z+1`. So a package classified for this release
carries `minor`, and "is this a feature or a fix" is answered in the summary rather than by the
choice of type. Nothing in this repository at the audited commit says otherwise: the one written
bump rule was `.changeset/README.md`'s "during pre-alpha all bumps are patch", which is the rule ADR
0002 retires and which could not have produced `0.1.0` in any case.

### `S0161-release-frequency-policy` had not landed, and no cadence rule from it was applied

`S0161-release-frequency-policy` (repository `github-profile`) was at `status: ready` and **had not
landed** when this audit was taken. It is not quoted here, nothing here assumes what it will say, and
**no cadence or frequency rule from it was applied to any classification in this document.** Every
rule used is R1 to R8 above, all of which are written in this repository at the audited commit.

What that means for a later reader: any question of the form "how often should these eight ship",
"should this release have waited for a batch" or "is there a release window" is **open** here and is
re-openable once S0161 lands. Questions of the form "what is unreleased", "what does it classify as"
and "what is the resolved version" are closed by this document and do not depend on S0161.

## 3. Per-package audit

Classification vocabulary: `minor` and `patch` are the two bump types this release can use, `none`
means the package has an empty unreleased record and does not move, and `unknown` means the audit
could not establish the package's published version or its unreleased record (section 7).

| package                   | version at the audited commit | registry `latest` (E3) | highest tag (E2) | classification | resolved version |
| ------------------------- | ----------------------------- | ---------------------- | ---------------- | -------------- | ---------------- |
| `@cosyte/eslint-config`   | 0.0.6                         | 0.0.6                  | 0.0.6            | `minor`        | 0.1.0            |
| `@cosyte/prettier-config` | 0.0.4                         | 0.0.4                  | 0.0.4            | `minor`        | 0.1.0            |
| `@cosyte/process`         | 0.0.2                         | 0.0.2                  | 0.0.2            | `minor`        | 0.1.0            |
| `@cosyte/script-utils`    | 0.0.2                         | 0.0.2                  | 0.0.2            | `minor`        | 0.1.0            |
| `@cosyte/test-utils`      | 0.0.4                         | 0.0.4                  | 0.0.4            | `minor`        | 0.1.0            |
| `@cosyte/tsconfig`        | 0.0.4                         | 0.0.4                  | 0.0.4            | `minor`        | 0.1.0            |
| `@cosyte/tsup-config`     | 0.0.3                         | 0.0.3                  | 0.0.3            | `minor`        | 0.1.0            |
| `@cosyte/vitest-config`   | 0.0.4                         | 0.0.4                  | 0.0.4            | `minor`        | 0.1.0            |

### The unreleased record, per package

Two facts have to be separated for every package, because at this commit they disagree.

**Fact one: what moved in the package tree since its release tag (E4).** Six packages have moved
nothing at all. Two have moved something, and in both cases the moved paths are outside the
published tarball, which R2 classifies as needing no changeset on its own account:

- `@cosyte/process`: `test/consumer-vitest.test.ts`, `test/helpers.ts` and three files under
  `test/fixtures/own-vitest/`. Its `files` field is `["dist", "README.md", "CHANGELOG.md"]`, so none
  of them ships.
- `@cosyte/test-utils`: `scripts/attw.mjs` and `test/attw-gate.test.ts`. Its `files` field is
  `["dist", "README.md", "CHANGELOG.md"]`, so neither ships. The root `CHANGELOG.md` entry that
  landed them says so in its own words and records the `npm pack --dry-run --json` measurement
  behind it.

**Fact two: what each package's own changelog carries as unreleased (E5), and whether that is
honest.** Six packages carry an unreleased heading, and in all six the content under it **had
already shipped**. `Version Packages (#46)` (`3766366`, 2026-08-04) consumed
`.changeset/changelog-headings-and-release-gates.md` and bumped six packages; `Version Packages
(#51)` (`3318238`, 2026-08-06) consumed `.changeset/perf-scaling-gate.md` and bumped
`@cosyte/test-utils` again. Neither pull request performed R6's hand promotion, so the released
content stayed under the unreleased heading in the file that shipped. That is the exact defect the
note block at the top of every one of those changelogs describes, recurring one release after it was
written down.

This preparation corrects it, which is why the classification below can be read straight off the
table: the already-shipped content is relabelled to the version that shipped it, and the unreleased
heading is left carrying nothing.

#### `@cosyte/eslint-config` 0.0.6, classified `minor`

- **Moved since `@cosyte/eslint-config@0.0.6` (E4):** nothing.
- **Unreleased record before this preparation (E5):** one `Changed` entry, "The sections below were
  relabelled". It shipped in `0.0.6` on 2026-08-04 and is relabelled to `## [0.0.6] - 2026-08-04`
  here.
- **The concrete unreleased change this classification rests on:** the package's own shipped
  `CHANGELOG.md` changes twice in this preparation. Its preamble stops stating the retired pre-alpha
  version policy and states the `0.1.0` line and its ADR instead, and its already-shipped `0.0.6`
  content stops being headed as unreleased. `CHANGELOG.md` is inside this package's `files`, so both
  edits reach the published tarball. No rule, option, or behaviour change.

#### `@cosyte/prettier-config` 0.0.4, classified `minor`

- **Moved since `@cosyte/prettier-config@0.0.4` (E4):** nothing.
- **Unreleased record before this preparation (E5):** one `Changed` entry, the same relabelling note,
  shipped in `0.0.4` on 2026-08-04 and relabelled to `## [0.0.4] - 2026-08-04` here.
- **The concrete unreleased change this classification rests on:** the same two edits to the
  package's shipped `CHANGELOG.md`, which is inside its `files`. No setting change.

#### `@cosyte/process` 0.0.2, classified `minor`

- **Moved since `@cosyte/process@0.0.2` (E4):** five files under `packages/process/test/`, none of
  them inside `files`. Under R2 those need no changeset of their own and none is written for them.
- **Unreleased record before this preparation (E5):** empty. This package's changelog carries no
  unreleased heading at all; every section is already dated to the version that shipped it.
- **The concrete unreleased change this classification rests on:** the package's shipped
  `CHANGELOG.md` preamble stops stating the retired pre-alpha version policy and states the `0.1.0`
  line and its ADR instead, and the file gains the unreleased heading R6 expects to promote next
  time. `CHANGELOG.md` is inside this package's `files`. No CLI, verb, or configuration change.

#### `@cosyte/script-utils` 0.0.2, classified `minor`

- **Moved since `@cosyte/script-utils@0.0.2` (E4):** nothing.
- **Unreleased record before this preparation (E5):** empty, in the same shape as `@cosyte/process`.
- **The concrete unreleased change this classification rests on:** the same preamble edit plus the
  added unreleased heading, in a `CHANGELOG.md` that is inside this package's `files`. No change to
  `isCliEntrypoint` or to the phi-scan engine, and in particular **no change to
  `packages/script-utils/phi-scan.js` or `phi-scan.d.ts`**, which this preparation does not touch.

#### `@cosyte/test-utils` 0.0.4, classified `minor`

- **Moved since `@cosyte/test-utils@0.0.4` (E4):** `scripts/attw.mjs` and `test/attw-gate.test.ts`,
  neither inside `files`. Under R2 those need no changeset of their own and none is written for them.
- **Unreleased record before this preparation (E5):** two releases' worth of content, and this is
  the package where the R6 gap is widest. The `Added` and `Notes` sections are the PERF-P2 scaling
  gate, which shipped in `0.0.4` on 2026-08-06; the `Changed` section is the relabelling note, which
  shipped in `0.0.3` on 2026-08-04. Both are relabelled here, to `## [0.0.4] - 2026-08-06` and
  `## [0.0.3] - 2026-08-04`.
- **The concrete unreleased change this classification rests on:** the package's shipped
  `CHANGELOG.md` changes twice, as above, and it is inside `files`. No runner or API change, and
  **no change to `packages/test-utils/src/`**, which this preparation does not touch.

#### `@cosyte/tsconfig` 0.0.4, classified `minor`

- **Moved since `@cosyte/tsconfig@0.0.4` (E4):** nothing.
- **Unreleased record before this preparation (E5):** one `Changed` entry, the relabelling note,
  shipped in `0.0.4` on 2026-08-04 and relabelled to `## [0.0.4] - 2026-08-04` here.
- **The concrete unreleased change this classification rests on:** the same two edits to the
  package's shipped `CHANGELOG.md`, which is inside its `files`. No compiler-option change:
  `base.json` and `library.json` are byte-identical to `0.0.4`.

#### `@cosyte/tsup-config` 0.0.3, classified `minor`

- **Moved since `@cosyte/tsup-config@0.0.3` (E4):** nothing.
- **Unreleased record before this preparation (E5):** one `Changed` entry, the relabelling note,
  shipped in `0.0.3` on 2026-08-04 and relabelled to `## [0.0.3] - 2026-08-04` here.
- **The concrete unreleased change this classification rests on:** the same two edits to the
  package's shipped `CHANGELOG.md`, which is inside its `files`. No build-option change.

#### `@cosyte/vitest-config` 0.0.4, classified `minor`

- **Moved since `@cosyte/vitest-config@0.0.4` (E4):** nothing.
- **Unreleased record before this preparation (E5):** one `Changed` entry, the relabelling note,
  shipped in `0.0.4` on 2026-08-04 and relabelled to `## [0.0.4] - 2026-08-04` here.
- **The concrete unreleased change this classification rests on:** the same two edits to the
  package's shipped `CHANGELOG.md`, which is inside its `files`. No config or behaviour change.

### No package is classified `none`

Every one of the eight is classified `minor`, so the `none` disposition is used zero times in this
release. It is named in the vocabulary above rather than dropped, because a package with an empty
unreleased record is the ordinary case in a later release and this audit's shape should not have to
change to express it. Two packages, `@cosyte/process` and `@cosyte/script-utils`, had an **empty
unreleased record** in the sense of E5 and are stated as such above rather than omitted; they are
still classified `minor`, because the `0.1.0` preparation puts a concrete, tarball-reaching change
into each of them.

## 4. Public API stability certification

What each package exposes at the audited commit, and whether `0.1.0` removes, renames or narrows any
of it relative to the version currently published on the registry.

**The comparison is exact rather than argued.** For every package the registry's `latest` (E3) equals
the version at the audited commit (E1) equals the highest tag (E2), and `git diff '<pkg>@<version>'
HEAD -- packages/<dir>` (E4) shows no change to any `package.json`. The surface at the audited commit
**is** the published surface, file for file. This preparation then changes only `CHANGELOG.md` files
and adds changesets, so it moves no entry point either.

| package                   | published version compared against | entry points at the audited commit                                                                                | `bin`                                | removed | renamed | narrowed |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------- | ------- | -------- |
| `@cosyte/eslint-config`   | 0.0.6                              | `.` (`./index.js`)                                                                                                | none                                 | none    | none    | none     |
| `@cosyte/prettier-config` | 0.0.4                              | `.` (`./index.json`)                                                                                              | none                                 | none    | none    | none     |
| `@cosyte/process`         | 0.0.2                              | `.` (types `./dist/index.d.ts`, default `./dist/index.mjs`), `./package.json`                                     | `cosyte-process` to `./dist/cli.mjs` | none    | none    | none     |
| `@cosyte/script-utils`    | 0.0.2                              | `.` (types `./index.d.ts`, default `./index.js`), `./phi-scan` (types `./phi-scan.d.ts`, default `./phi-scan.js`) | none                                 | none    | none    | none     |
| `@cosyte/test-utils`      | 0.0.4                              | `.` (import and require conditions, ESM and CJS with types for each), `./perf` (same shape), `./package.json`     | none                                 | none    | none    | none     |
| `@cosyte/tsconfig`        | 0.0.4                              | `./base.json`, `./library.json`                                                                                   | none                                 | none    | none    | none     |
| `@cosyte/tsup-config`     | 0.0.3                              | `.` (types `./index.d.ts`, default `./index.js`)                                                                  | none                                 | none    | none    | none     |
| `@cosyte/vitest-config`   | 0.0.4                              | `.` (types `./index.d.ts`, default `./index.js`), `./snippets` (types `./snippets.d.ts`, default `./snippets.js`) | none                                 | none    | none    | none     |

**Peer ranges are part of the surface and none of them narrows.** They are unchanged from the
published version in every case: `@cosyte/eslint-config` keeps `eslint: ^9.0.0 || ^10.0.0` and
`typescript: >=5.0.0`; `@cosyte/test-utils` keeps `fast-check: ^3.0.0`; `@cosyte/tsup-config` keeps
`tsup: ^8.0.0`; `@cosyte/vitest-config` keeps `vitest: ^4.0.0`, `vite: ^6.0.0 || ^7.0.0 || ^8.0.0`
and `@vitest/coverage-v8: ^4.0.0`. The other four declare no peers.

**Engine floors are part of the surface and none of them rises.** Three packages declare one and
keep it: `@cosyte/process` and `@cosyte/test-utils` keep `node >=22.0.0`, `@cosyte/script-utils`
keeps `node >=22.14`. The remaining five declare no `engines` block at all, before or after:
`@cosyte/eslint-config`, `@cosyte/prettier-config`, `@cosyte/tsconfig`, `@cosyte/tsup-config` and
`@cosyte/vitest-config`. Three plus five is the eight in the table above; the root manifest's
`node >=22.14` is not a package floor and reaches no consumer, because `cosyte-config` is
`private: true` and is never published.

**Certification.** `0.1.0` removes nothing, renames nothing and narrows nothing on any of the eight
packages. The only observable difference between `<pkg>@<published>` and `<pkg>@0.1.0` is the
`CHANGELOG.md` inside the tarball and the version number itself.

**What this certification does not claim.** It is a comparison of declared surface: entry points,
`bin`, peers and engines, read from the manifests, with the published tree established as identical
by E1 to E4. It is not a behavioural equivalence proof of the built `dist` of `@cosyte/process` and
`@cosyte/test-utils`, which is not re-derived here because no source file in either moved.

## 5. Break candidates

Every change in the `0.1.0` line that would be a breaking change under semver, with a disposition on
each. Dispositions are `deferred`, `accepted-pre-1.0` or `withdrawn`.

**There is no break candidate that is a removal, a rename or a narrowing.** Section 4 certifies that
directly. The two candidates below are consequences of the version line moving at all, and both are
real and observable, so neither is omitted.

### BC-1: a `^0.0.z` range on any of the eight stops receiving releases

- **Packages:** all eight.
- **The observable break:** npm's caret rule treats every `0.0.z` release as its own major, so
  `^0.0.6` matches `0.0.6` and nothing above it. A dependant pinned that way keeps resolving the
  version it has and never resolves `0.1.0`. It does not fail: it silently stops moving, which is
  the harder failure to notice.
- **Disposition:** `accepted-pre-1.0`. This is the intended effect of the release rather than a side
  effect of it, and it is the reason ADR 0002 exists. It costs each dependant one range edit, after
  which `^0.1.0` keeps resolving across the whole `0.1.x` line, which no `^0.0.z` range ever could.

### BC-2: `scripts/parser-template/package.json` pins seven of the eight at `^0.0.z`

- **Packages:** `@cosyte/eslint-config` (`^0.0.4`), `@cosyte/prettier-config` (`^0.0.2`),
  `@cosyte/script-utils` (`^0.0.2`), `@cosyte/test-utils` (`^0.0.1`), `@cosyte/tsconfig` (`^0.0.2`),
  `@cosyte/tsup-config` (`^0.0.1`), `@cosyte/vitest-config` (`^0.0.2`).
- **The observable break:** BC-1 applied to the scaffold. A repository scaffolded after `0.1.0`
  installs the pre-`0.1.0` releases, and so do the thirteen already scaffolded, until each range is
  widened. Nothing reds; the scaffold simply stays on the old line.
- **Disposition:** `deferred`. Widening the template's ranges is a change to the scaffold, which
  reaches every future parser repository and is graded by `drift-manifest.json` and by
  `test/scaffold-*.test.ts`. This item's scope is the eight packages' version line and it is
  deliberately not carrying a scaffold change; the thirteen existing repositories are separate
  repositories and are outside it entirely. The right time to widen is after `0.1.0` is on the
  registry, so the widened range resolves something.
- **Already recorded once.** The root `CHANGELOG.md` entry for the phi-scan consolidation disclosed
  the same shape for `@cosyte/script-utils@^0.0.2` and called it a human gate. BC-2 is that
  disclosure generalised to the other six.

### Not a break candidate, and why, so it is not rediscovered

- **`updateInternalDependencies: "patch"` and the `workspace:^` internal devDependencies.** The four
  `@cosyte/*` devDependencies of `@cosyte/process` and `@cosyte/test-utils` are declared
  `workspace:^` and are resolved by pnpm at publish time. They are devDependencies, so no consumer
  installs them, and nothing about them is a promise to a consumer.
- **The private root manifest.** `cosyte-config` stays at `0.0.0` and is not part of the release set,
  so no range anywhere can be pointed at it.

## 6. The release plan

What `changeset version` will do when the release owner runs it, given the changesets this
preparation lands. It is not run here.

| package                   | from  | changeset type         | to    |
| ------------------------- | ----- | ---------------------- | ----- |
| `@cosyte/eslint-config`   | 0.0.6 | `minor`                | 0.1.0 |
| `@cosyte/prettier-config` | 0.0.4 | `minor`                | 0.1.0 |
| `@cosyte/process`         | 0.0.2 | `minor`                | 0.1.0 |
| `@cosyte/script-utils`    | 0.0.2 | `minor`                | 0.1.0 |
| `@cosyte/test-utils`      | 0.0.4 | `minor`                | 0.1.0 |
| `@cosyte/tsconfig`        | 0.0.4 | `minor`                | 0.1.0 |
| `@cosyte/tsup-config`     | 0.0.3 | `minor`                | 0.1.0 |
| `@cosyte/vitest-config`   | 0.0.4 | `minor`                | 0.1.0 |
| `cosyte-config` (root)    | 0.0.0 | not in the release set | 0.0.0 |

Eight changeset files, one per package, so each package's release body is derived from a summary
written about that package rather than from a shared one. `test/release-0-1-0-plan.test.ts` resolves
this table from the changesets and the manifests rather than reading it here, and asserts the two
agree.

### Release summaries

One per bumped package. These are the account of what `0.1.0` ships for that package, and each is
the same text the package's changeset carries, so `scripts/release-notes.mjs` derives a body that
says the same thing.

#### `@cosyte/eslint-config@0.1.0`

`@cosyte/eslint-config@0.1.0` is the first release on the settled-surface version line. No rule,
option, peer range, or behaviour change: the flat config and its guardrails are byte-identical to
`0.0.6`. What moves is the version policy the package states about itself. Its bundled changelog now
records the `0.1.0` line and points at ADR 0002 for the reasoning, and the `0.0.6` content it was
still heading as unreleased is dated to the release that shipped it. Its bundled README now states
that line in its `## Status` section, in place of the ladder sentence it carried.

#### `@cosyte/prettier-config@0.1.0`

`@cosyte/prettier-config@0.1.0` is the first release on the settled-surface version line. No setting
change: the shared Prettier settings and their overrides are byte-identical to `0.0.4`. Its bundled
changelog now records the `0.1.0` line and points at ADR 0002 for the reasoning, and the `0.0.4`
content it was still heading as unreleased is dated to the release that shipped it. Its bundled
README now states that line in its `## Status` section, in place of the ladder sentence it carried.

#### `@cosyte/process@0.1.0`

`@cosyte/process@0.1.0` is the first release on the settled-surface version line. No CLI, verb,
modifier, or configuration change: the six verbs, the four modifiers, the token partition and
`cosyte-process.config.json` all behave exactly as in `0.0.2`, and the `cosyte-process` bin resolves
to the same entry point. Its bundled changelog now records the `0.1.0` line and points at ADR 0002
for the reasoning. Its bundled README now states that line in its `## Status` section, in place of
the ladder sentence it carried.

#### `@cosyte/script-utils@0.1.0`

`@cosyte/script-utils@0.1.0` is the first release on the settled-surface version line. No change to
`isCliEntrypoint` and no change to the shared phi-scan engine: both subpaths export exactly what
`0.0.2` exports, and the PHI detection rules are untouched. Its bundled changelog now records the
`0.1.0` line and points at ADR 0002 for the reasoning. Its bundled README now states that line in its
`## Status` section, in place of the ladder sentence it carried.

#### `@cosyte/test-utils@0.1.0`

`@cosyte/test-utils@0.1.0` is the first release on the settled-surface version line. No runner, API,
or type change: the conformance runners, the scaling gate on the `./perf` subpath and the frozen
`PERF_CONTRACT` constants are byte-identical to `0.0.4`. Its bundled changelog now records the
`0.1.0` line and points at ADR 0002 for the reasoning, and the two releases' worth of content it was
still heading as unreleased are dated to the releases that shipped them: the scaling gate to `0.0.4`
and the changelog relabelling to `0.0.3`. Its bundled README now states that line in its `## Status`
section, in place of the ladder sentence it carried.

#### `@cosyte/tsconfig@0.1.0`

`@cosyte/tsconfig@0.1.0` is the first release on the settled-surface version line. No compiler-option
change: `base.json` and `library.json` are byte-identical to `0.0.4`. Its bundled changelog now
records the `0.1.0` line and points at ADR 0002 for the reasoning, and the `0.0.4` content it was
still heading as unreleased is dated to the release that shipped it. Its bundled README now states
that line in its `## Status` section, in place of the ladder sentence it carried.

#### `@cosyte/tsup-config@0.1.0`

`@cosyte/tsup-config@0.1.0` is the first release on the settled-surface version line. No build-option
change: `cosyteTsup(overrides)` produces exactly the dual ESM and CJS build `0.0.3` produced. Its
bundled changelog now records the `0.1.0` line and points at ADR 0002 for the reasoning, and the
`0.0.3` content it was still heading as unreleased is dated to the release that shipped it. Its
bundled README now states that line in its `## Status` section, in place of the ladder sentence it
carried.

#### `@cosyte/vitest-config@0.1.0`

`@cosyte/vitest-config@0.1.0` is the first release on the settled-surface version line. No config or
behaviour change: `cosyteVitest(opts)`, its coverage thresholds, its peer ranges and the
`./snippets` doc-agreement harness are byte-identical to `0.0.4`. Its bundled changelog now records
the `0.1.0` line and points at ADR 0002 for the reasoning, and the `0.0.4` content it was still
heading as unreleased is dated to the release that shipped it. Its bundled README now states that
line in its `## Status` section, in place of the ladder sentence it carried.

## 7. Unknowns

**Zero packages are classified `unknown`, and this section records what would have made one.**

A package is `unknown` when this audit cannot establish either its currently published version or
its unreleased record. An `unknown` package is named here with the reason and is **excluded from the
`0.1.0` changeset set**, because a bump computed from a version nobody could read is a guess.

Neither condition fired. The published version of all eight was established three independent ways
that agree (E1, E2, E3), and the unreleased record of all eight was established from the package tree
against its own release tag (E4) and from the package's own changelog (E5). The routes that would
have produced an `unknown`, none of which was taken:

- **A package with no tag and no registry answer.** All eight have both.
- **A registry response this audit could not read.** All eight `dist-tags` responses parsed and are
  deposited with this item's spec, so the answer is re-readable without egress.
- **A disagreement between E1, E2 and E3.** There is none. Had there been one, the package would be
  `unknown` rather than resolved in favour of whichever source was convenient, because a workspace
  ahead of the registry is exactly the state run 30640138565 shipped nothing out of.
- **A package whose release tag is missing, so E4 has nothing to diff against.** All eight tags
  resolve.

## 8. What the repository stated about its own version policy, and where that was corrected

At the audited commit the pre-alpha ladder was asserted in eleven places for the eight published
packages: the preamble of each of the eight package changelogs, the preamble of the root
`CHANGELOG.md`, the `## Versioning` section of `README.md`, and `.changeset/README.md`'s bump rule.
Nine more arrived on the base branch after the audit was taken, when the house README skeleton gave
every one of the nine governed READMEs a `## Status` section opening on the ladder sentence. All
twenty are corrected by this preparation, so the repository states one version policy rather than two
incompatible ones. One further mention, ADR 0001's `Relates to:` citation of an umbrella ADR by
its subject, is corrected too: it is a pointer rather than an assertion, and leaving it would still
have read as one. `test/release-0-1-0-plan.test.ts` sweeps every tracked file for a surviving
assertion.

The nine README corrections are not free text. `scripts/readme-check.mjs` grades each `## Status`
section against the package's EFFECTIVE RELEASE LINE, which it resolves from the manifest version
plus the pending changesets, so the eight `minor` entries this preparation adds put all eight
packages on the `0.1.x` line and the root package with them. That gate then compels the settled-line
sentence and refuses the ladder sentence anywhere in the file, which is the same claim criterion 13
makes, enforced in the required `verify` job on a surface that ships inside every tarball.

**Four sets of mentions are deliberately left alone**, and each is a different set of packages, or a
record, or enforcement machinery, or a statement about something other than this policy:

1. `scripts/parser-template/` and `scripts/scaffold-parser.mjs`. These describe **scaffolded parser
   repositories**, which this repository does not publish and which the template itself calls "not
   yet published to npm". ADR 0002's scope says so explicitly. A repository with no published version
   has nothing to settle, and moving those is a decision about a different set of packages.
2. ADR 0002 itself, and `test/release-0-1-0-plan.test.ts`. A record of what was retired has to name
   what was retired, and the test has to carry the pattern it bans.
3. `scripts/readme-check.mjs` and `test/readme-check.test.ts`. The gate that refuses this assertion
   in every published README cannot refuse a sentence without spelling it out, and its suite cannot
   prove the refusal fires without feeding it one. Neither reaches a consumer: the root manifest is
   `private: true` and neither path is in any published package's `files` array.
4. Two historical entries in the root `CHANGELOG.md` that describe caret-on-`0.0.z` resolution
   semantics in past releases, and one docblock in `test/scaffold-format.test.ts` that does the same.
   Those are statements about how npm resolves a range, which is still true, and they are not
   assertions that any package stays on a ladder. They are also history, and history is not rewritten
   to match a later decision.

Sets 1 to 3 are a declared list in the test rather than an accident of it, and every entry on that
list has to still be covering a real assertion: an exemption the sweep never exercises fails the
case, so a path that moves and a pattern that stops matching are both a red rather than a silently
clean run. Set 4 is exempt by the shape of the pattern rather than by path, which is asserted
directly: the sweep's self-test pins that a sentence about caret resolution does not match it.
