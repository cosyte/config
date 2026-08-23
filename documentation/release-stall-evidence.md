# Release stall evidence: why Version Packages PRs sit, measured

Commissioned by umbrella spec `S0074-npm-git-release-process`. This file is the evidence behind the
process in [`RELEASING.md`](../RELEASING.md), and it is the thing to argue with if you disagree with
that process. Every number below names the query it came from.

## The answer in four sentences

Across the whole `cosyte` organization, **185 Version Packages PRs** have ever been opened, in 14 of
the 18 repositories in scope. **183 of them merged, at a median of 3.0 minutes after their last
push.** Exactly **two** have ever sat longer than 72 idle hours, and both are open right now:
`fhir#73` (294.8 idle hours) and `terminology#62` (269.8 idle hours). Both have **every required
check green and nothing blocking the merge button**, and for both, a `Release` run for that same
repository has been sitting in `waiting` on the single protected-environment reviewer across the
whole stall, which is one of **62 such held runs** across the organization at the observation window.

So the operator's "constantly made and left stale" is true about the ORG-WIDE RELEASE PIPELINE and
not about the PR count: the thing that accumulates is held release runs, and a Version Packages PR is
what that backlog looks like from the outside. The process change follows from that and nothing else.

## Method

### The scan window, and which mechanic (AC40)

**Mechanic: DISCLOSE.** This record is **not as of a single instant**. The scan ran across real time
and every row carries the instant it is as of.

- **Window start:** `2026-08-22T21:13:00Z` (the first authorized read, the branch protection probe on
  `cosyte/config`).
- **Window end:** `2026-08-22T21:55:00Z`.
- **Per row:** every population row and every PR row carries `row_as_of`, the instant the response it
  was derived from answered. AC1's reproduction claim is read against the window on that basis: a
  later re-run legitimately differs where a PR, run or repository has since changed state.

FREEZE was considered and not elected. FREEZE requires every query bounded so it admits no event
after the declared instant, and the GitHub surfaces this measurement needs (repository objects, pull
requests, check runs, workflow runs) return current state with no `as-of` parameter, so that limb
could not have been met for them. DISCLOSE states the truth instead of asserting a bound that does
not exist.

**The comparability sweep, and its result.** Under DISCLOSE, any still-open PR whose idle time
computed at its own instant lands within the window's span (42 minutes, 0.70 hours) of the 72-hour
bar has to be re-observed as of the window end and carried there, because those are the only rows the
choice of instant could move across the bar. The band is therefore 71.30 to 72.70 idle hours. **Two
PRs were open at capture; their idle times are 294.76 and 269.77 hours. No row falls in the band, so
no re-observation was owed and none was performed.** Every other row is terminal (merged or closed),
and a terminal PR's idle time is fixed by its own merge or close stamp, which no choice of instant
can move.

**Two referents this record fixes rather than leaving to be argued.** DISCLOSE substitutes "that
row's own recorded as-of instant" for "the observation timestamp". Two places say something close to
it without being in that list, so they are settled here: (i) the required check set is "determined
per repository at the observation timestamp", which here means the instant that repository's rule
read answered, recorded per repository below; (ii) wherever a query is offered below as bounded, the
bound is to **the window end**, `2026-08-22T21:55:00Z`, not to the instant the query was issued.
Bounding to the later instant returns a superset and is the conservative direction.

### The credential, limb by limb (AC38)

Established **before** any population, row or share was recorded, and this is the check that decided
whether the measurement was permitted to begin. A limb is established by an authorized read that
ANSWERS, never by what the answer contains.

| limb                                           | read                                                                                                  | answered                                          | result                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| branch protection **(tested first)**           | `GET /repos/cosyte/config/branches/main/protection`                                                   | **yes, HTTP 404 `Branch not protected`**, not 403 | `main` carries no legacy branch protection. This is an enumeration result, not a denial: the same credential reads `permissions.admin = true` on `cosyte/config` (`GET /repos/cosyte/config`), which is the role the endpoint requires, so a 403 would have been the denial answer and was not returned. |
| repository rulesets (the other disjunct)       | `GET /repos/cosyte/config/rulesets`                                                                   | yes, HTTP 200                                     | two ACTIVE org-level rulesets, `baseline-branch-protection` and `config-ci-required-checks`                                                                                                                                                                                                              |
| named identity                                 | `GET /user`                                                                                           | yes                                               | `NSchatz`, id `26444422`, type `User`                                                                                                                                                                                                                                                                    |
| listing issued to include private repositories | `GET /orgs/cosyte/repos?type=all&per_page=100`                                                        | yes                                               | 36 repositories returned, **19 of them private**. Issuance confirmed by exposure, so this is not the `capability-held-none-exposed` case.                                                                                                                                                                |
| repository contents                            | `GET /repos/cosyte/config/contents/.changeset?ref=main`                                               | yes                                               | tree returned                                                                                                                                                                                                                                                                                            |
| pull requests                                  | `GET /repos/cosyte/config/pulls?state=all`                                                            | yes                                               | PR objects returned                                                                                                                                                                                                                                                                                      |
| check runs                                     | `GET /repos/cosyte/config/commits/2c00b91.../check-runs`                                              | yes                                               | 11 check runs                                                                                                                                                                                                                                                                                            |
| workflow runs                                  | `GET /repos/cosyte/config/actions/runs`                                                               | yes                                               | 533 runs                                                                                                                                                                                                                                                                                                 |
| deployments and their approvals                | `GET /repos/cosyte/config/deployments`, `GET /repos/cosyte/config/actions/runs/31662474079/approvals` | yes                                               | `release` deployments; one approval record naming `NSchatz` and the `release` environment                                                                                                                                                                                                                |

**Every limb holds. No AC38 stop was owed.** The protection limb specifically was tested FIRST and on
`cosyte/config`, and it is the PROTECTION read that answered, not only the rulesets read: had the
protection read returned 403 while only the rulesets read answered, the limb would have been treated
as absent and this item would have exited as a blocked report before any scan.

Once a limb holds, a denial on some OTHER repository is not a capability stop; it is that
repository's own determination. No such denial occurred: every rule read below answered.

### Retrieval plan, and what it cost (AC41)

**Shape.** A batched GraphQL graph query per concern wherever one existed, and paged REST only where
GraphQL has no equivalent (workflow runs, check runs, pending deployments, branch protection). The
per-PR "last push" is read inside the PR list query as `commits(last: 1)`, so the whole 185-row
history cost 18 documents rather than 185 follow-up requests.

The AC29 column says, per query, whether re-issuing it reproduces what this record derived from it.
It is the honest three-way answer, not a two-way one: **bounded** (a re-run returns the same thing,
because the query admits no event after the window), **live** (the query is a read of current state
and a re-run returns whatever is true then), or **bounded set, live fields** (the set of objects the
query returns is fixed by a date bound, but a field this record read off them is current state).

| #   | query                                                                                                                                                                | surface | requests | AC29 limb                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| q00 | capability probes (the table above)                                                                                                                                  | REST    | 15       | **live** (identity, permissions and rule state as they stand)                                                                                                                                     |
| q01 | `GET /orgs/cosyte/repos?type=all&per_page=100` (paginated)                                                                                                           | REST    | 1        | **live** (the org listing as it stands)                                                                                                                                                           |
| q02 | GraphQL: 36 repository objects, `defaultBranchRef.target.oid`, `pullRequests.totalCount`                                                                             | GraphQL | 1        | **live**, and it is what resolved the default-branch shas that make qB, qC and qD bounded                                                                                                         |
| qB  | GraphQL: `object(expression: "<oid>:.changeset")` and `"<oid>:.github/workflows"` for all 34 repositories that have a default branch                                 | GraphQL | 1        | **bounded** (pinned to an immutable commit sha)                                                                                                                                                   |
| qC  | GraphQL: `"<oid>:package.json"`, `"<oid>:pnpm-workspace.yaml"`, `"<oid>:packages"`, `"<oid>:.github/workflows/release.yml"` for the 16 members plus `cosyte/.github` | GraphQL | 1        | **bounded** (same)                                                                                                                                                                                |
| qD  | GraphQL: every workspace `packages/<name>/package.json` for `config` and `pathways`, plus `config`'s `ci.yml`                                                        | GraphQL | 1        | **bounded** (same)                                                                                                                                                                                |
| q03 | GraphQL: `branchProtectionRules` and `rulesets(includeParents: true)` for all 18 in-scope repositories                                                               | GraphQL | 1        | **live** (the effective rules as they stand)                                                                                                                                                      |
| q04 | GraphQL: every pull request (all states, `CREATED_AT` ascending, `commits(last: 1)`) for all 18 in-scope repositories                                                | GraphQL | 21       | **bounded set, live fields**: the 185 rows are re-selected from a re-run by `opened_at <= 2026-08-22T21:55:00Z`, a column on every row; each row's terminal state and last push are current state |
| q05 | REST: `pulls/{n}`, `commits/{head}/check-runs` and `actions/runs/{id}/pending_deployments` for `fhir#73` and `terminology#62`                                        | REST    | 6        | **live**, but every object is cited below by id, so each is re-readable one at a time                                                                                                             |
| q06 | REST: `actions/runs?status=waiting&created=<=2026-08-22T21:50:00Z&per_page=100`, once per member repository                                                          | REST    | 16       | **bounded set, live fields**, and here the live field IS the filter: see the note on the 62 below                                                                                                 |
| q07 | REST: `actions/runs?created=2026-08-05..2026-08-22T21:55:00Z` for `fhir` and `terminology` (the held-run identification)                                             | REST    | 2        | **bounded set, live fields** as restated; **it was ISSUED as `created=>2026-08-05`, which bounds below only**, and the upper bound was added here. See the note under the table                   |
| q08 | REST: `GET /repos/cosyte/config/rules/branches/main` (corroborating the effective rule set on the enumerating surface)                                               | REST    | 1        | **live**, and it establishes nothing on its own: q03 is the enumerating surface for `config` and this only agreed with it                                                                         |

**The one query whose stated form is not the form that was issued: q07.** It went out as
`created=>2026-08-05`, which bounds the listing below and not above, so as issued it does not admit
"no event after the window". It is restated above with the upper bound because that is the form a
reader should re-run, and the restatement is sound rather than cosmetic: every run this record cites
from q07 carries a `created_at` inside the window (`31497105267` 2026-08-11, `31701709401`
2026-08-13, `32495980284` 2026-08-21, `32462897354` 2026-08-21, `31269174845` 2026-08-08), so the
bounded form returns all of them and drops only runs created after the window, which this record does
not use. The bounded form was **not** itself issued: re-issuing it now would be a read outside the
declared window, which a DISCLOSE record may not quietly fold into the window it declared.

**Cost, reported honestly.** REST: 41 requests against a 5,000/hour limit. GraphQL: 27 documents,
costing roughly 30 points. **A further ~4,940 GraphQL points were burned by a defect in the scan
itself**: `gh api graphql --paginate` only advances a cursor variable literally named `endCursor`,
the first query named it `after`, and for the three repositories with more than 100 pull requests
(`ccda`, `dicom`, `x12`) that produced a loop re-fetching page one. It was detected from output file
sizes, the three queries were re-issued with the correct variable name, and **the looped output was
discarded and is not the source of any number here** (every q04-derived number comes from the
re-issued responses). Reported because a retrieval plan that hides what it actually spent is not a
plan.

**Resume point.** The scan is resumable per query at the granularity of the table above: each row is
an independent document or request set, and q04 additionally resumes per repository. No interruption
occurred, so no AC34 stop was reported under this head.

### There is no raw deposit, and this is exactly what that costs (AC41, AC29)

**Total raw response bytes committed: none.** The first implementation pass of this work deposited
six base64-encoded blobs, about 1.4 MB, under `documentation/release-stall-evidence/raw/`. They were
**removed** on operator decision, recorded in the commissioning spec folder as
`operator-decision-drop-the-raw-deposit.md` (2026-08-23): the payload was judged too large for what
it bought, and base64 makes it undiffable and ungreppable besides, so a later reader could not see
what changed between two scans anyway. The readable record and the per-PR CSV stay.

That is a real cost and it is stated here rather than left for a reader to discover. AC41's deposit
clause is conditional ("where raw responses are committed") and no longer applies; its closing clause
directs what is left: "where neither route is open, AC29's query-bounding limb is used for those
queries instead." So the table above is the reproduction route, and it does not reach everywhere.

**Where it reaches.** qB, qC and qD are pinned to immutable commit shas, so every tree fact in this
record, every membership decision and every workflow divergence re-reads identically forever. q04's
185 rows are re-selected from a re-run by an `opened_at` bound, and the derived per-PR table is
committed as `version-packages-prs.csv`, so AC3's rows, AC4's distributions and the stalled set are
checkable against a re-run column by column rather than on trust.

**Where it does not, named individually rather than summarised.** For q00, q01, q02, q03, q05 and
q08 this record supplies neither a bounded query nor a committed response, so for those six it does
not satisfy AC29's second limb. What stands in their place is weaker and is not offered as
equivalent: every capability answer, every listing count, every default-branch sha, every required
check set and every attribution observation is reproduced IN THIS DOCUMENT as a literal value with
the endpoint that produced it, and every object behind an attribution is cited by id (PR numbers,
run ids `31497105267` and `31701709401`, deployment environment ids `18532539175` and `18532353981`,
head shas, check names) so a reader can re-read each one individually and compare. That makes the
record contestable point by point; it does not make it byte-reproducible.

**The 62 held runs are the weakest-supported number in this record, and here is why.** q06 is
bounded on `created`, so it satisfies AC29's letter, but the filter that produces the count is
`status=waiting`, which is **current state evaluated at request time**: a run approved or cancelled
after `2026-08-22T21:50:00Z` simply drops out of a re-run, so re-issuing the identical bounded query
does not return 62 and is not expected to. Nothing anywhere in this repository records an individual
held run. What re-derives from this document alone is the SHAPE of the finding, not the integer: the
per-repository breakdown below sums to exactly 62; the two runs that carry the two attributions
(`31497105267`, `31701709401`) are cited by id with their `created_at`, their environment id and
their single required reviewer, and each is still re-readable by id; and the mechanism that produces
held runs (`environment: release` at job level, so GitHub holds the whole job before step one) is a
tree fact read at a pinned sha and therefore permanently checkable. **Treat 62 as a census taken once
at a stated instant, not as a reproducible measurement.** It is quoted in this record's opening, in
D1, in follow-ons F1 and F6, in `RELEASING.md` and in `release.yml`, and everywhere it is quoted it
is dated. Re-take the census before relying on it:
`gh run list --repo cosyte/<repo> --workflow Release --status waiting`.

**Why re-depositing is not a one-line fix, if anyone reconsiders.** `pnpm check:no-emdash` sweeps
**every tracked file** in this repository (`git ls-files`, not a glob) and bans U+2014 in literal and
encoded form, and historical pull request titles across the organization carry U+2014 in quantity
(`ASTM-1 <U+2014> record foundation`, `CLI-1 <U+2014> cosyte parse`, dozens more). A plain-text
deposit reds the brand gate on arrival and there is no glob to exclude it from, which is why the
first pass encoded it. Any future deposit has to solve that again.

### Which mechanism read which fact (AC28)

Every tree fact below (the `.changeset/` membership probe, the release-workflow column, the
publishable-package column, every workflow divergence) came from the **read-only GitHub contents
graph addressing the REMOTE default branch**, pinned to a commit sha, and the sha is recorded per
repository in the population table. No tree fact here is inferred from run metadata, and no tree fact
here comes from a checked-out working tree standing at an umbrella pin: a pin-dated read answers as
of the pin and cannot satisfy a predicate fixed at the observation window.

Where a repository's tree could not be read, its tree-derived columns say `content-unreadable` with
the reason. An absent read and an absent file are different findings and are never conflated.

## The population (AC2, AC27, AC34, AC36)

### How it was enumerated (AC27)

- **Listing method:** `GET /orgs/cosyte/repos?type=all&per_page=100`, paginated, as `NSchatz`.
- **Private capability:** issued and exercised. 36 repositories returned, of which **19 are
  private**. This is not `capability-held-none-exposed`.
- **Private repositories are inside the population.** Two of the 16 members are private
  (`pathways`, `bridgelink-mcp`), and both are reported below like any other.
- **Completeness claim:** the listing returned 36 repositories. `GET /orgs/cosyte` independently
  reports `public_repos: 17` and `total_private_repos: 19`, which is 36. **The set is claimed
  complete for the organization**, not merely complete for the credential.
- **Visibility per repository comes from the repository object's own `visibility` field**, never
  inferred from a manifest's `private: true`. That distinction is load-bearing here: `cosyte/config`
  is a PUBLIC repository whose ROOT manifest is `private: true`. The manifest flag is npm
  publishability and says nothing about visibility, and reading it as visibility is exactly the error
  that made this repository look like a non-publisher.
- **No AC34 stop was owed.** The listing did not fail, was not truncated, was not rate-limited, and a
  membership probe was attempted against every one of the 36 repositories it returned.

### Members: repositories carrying `.changeset/` (AC2)

Sixteen. Probed at the commit sha in the third column, which is the default branch head resolved
inside the window.

| repository              | visibility  | as-of ref (default branch)                          | probe instant | release workflow                        | publishes >= 1 public package                                                         | Version Packages PRs |
| ----------------------- | ----------- | --------------------------------------------------- | ------------- | --------------------------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| `cosyte/astm`           | public      | `main` @ `c5f61095be94a79111135f5c4c874179505a4bb0` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/astm`                                                                   | 23                   |
| `cosyte/bridgelink-mcp` | **private** | `main` @ `0bbe287b9a83f6dbbf941918ae9838f6989a1b5f` | 21:20:31Z     | **no** (`.github/workflows` absent)     | **no** (root `@cosyte/bridgelink-mcp` is `private: true`; no workspace)               | 0                    |
| `cosyte/ccda`           | public      | `main` @ `0151ab92a92498d41b95ba2fdba061f5e7458331` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/ccda`                                                                   | 16                   |
| `cosyte/cli`            | public      | `main` @ `fcdd00ff1bff9aa90404bcb65decf6b00a56814d` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/cli`                                                                    | 6                    |
| `cosyte/config`         | public      | `main` @ `2c00b91e4a8064f6e9fd9bda9e3b07eea66d6952` | 21:20:31Z     | yes, **hand-rolled**                    | **yes, eight** (see below)                                                            | 10                   |
| `cosyte/deid`           | public      | `main` @ `49eaefb506dceadb0ed4431fcbab9ee0c3464405` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/deid`                                                                   | 9                    |
| `cosyte/dicom`          | public      | `main` @ `372bacd889180f8516868278cd8f0e7d2670b84a` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/dicom`                                                                  | 21                   |
| `cosyte/fhir`           | public      | `main` @ `642f9b60879eef3ffe91f824d09d686947fe7df3` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/fhir`                                                                   | 11                   |
| `cosyte/hl7`            | public      | `main` @ `ce1171e43f0ef945643147b85ccd07cc8085cb6d` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/hl7`                                                                    | 12                   |
| `cosyte/mllp`           | public      | `main` @ `da0d385bfa8fddb0bdbc5f3a407a7b530bb101a0` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/mllp`                                                                   | 11                   |
| `cosyte/ncpdp`          | public      | `main` @ `4e072f5cd4518107844fbe3d5dba893508531cbb` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/ncpdp`                                                                  | 13                   |
| `cosyte/pathways`       | **private** | `main` @ `8b745ca3e11b0b494eac6fc5eaeb1a54a4539fb4` | 21:20:31Z     | **no** (`ci.yml`, `no-emdash.yml` only) | **no** (root `private: true`; all 7 workspace packages `@pathways/*` `private: true`) | 0                    |
| `cosyte/synth`          | public      | `main` @ `f6d18d7e6204b380ff93b77b686e0e6b2f9d2c28` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/synth`                                                                  | 9                    |
| `cosyte/terminology`    | public      | `main` @ `e8836a77ec90e5120344374e0e10a9876e608dfb` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/terminology`                                                            | 15                   |
| `cosyte/transform`      | public      | `main` @ `673890c7b0aaeed2458a93c5ad0b4bc77c88a63e` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/transform`                                                              | 9                    |
| `cosyte/x12`            | public      | `main` @ `ab0e7a38c34b79ddb2e76ad2c2b297422df0f4cf` | 21:20:31Z     | yes, thin caller                        | yes, `@cosyte/x12`                                                                    | 20                   |

The publishable column is read over the **root manifest and every workspace manifest the repository
declares**, never the root alone. That is why `config` is in the yes column: its root
`cosyte-config` is `private: true`, and `pnpm-workspace.yaml` declares `packages/*`, all eight of
which are public `@cosyte/*` packages. `pathways` declares `packages/*` and `apps/*` and every one of
its seven `packages/*` manifests is `private: true`, so it is in the no column on evidence rather
than by assumption.

### Membership-undecidable (AC36)

Two, listed here and **never** inside the member list above. Both are counted **inside the
population** for every coverage denominator.

| repository       | visibility | why undecided                                                                                                                         | mechanism that failed                       |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `cosyte/web`     | private    | `defaultBranchRef` is `null`: the repository has no commits, so no ref resolves and no `<sha>:.changeset` expression can be evaluated | contents graph, default branch unresolvable |
| `cosyte/minions` | private    | same                                                                                                                                  | contents graph, default branch unresolvable |

Neither is recorded as a non-member. Each is also a not-measured entry for the tree columns. **Their
PR history WAS readable** (`pullRequests.totalCount` answered `0` for each), so each counts as
measured for history and takes a zero row below.

### Non-members

The remaining 18 repositories the listing returned answered the probe with an absent `.changeset/`
and are not in the population: `website`, `iac`, `pims`, `docs`, `innovar`, `claude-containers`,
`bridgelink-website`, `crew`, `knowledgebase`, `cosyte`, `demo-repository`, `.github`,
`innovarhealthcare-website`, `contractor-websites`, `workflow`, `assets`, `consulting`, `BridgeLink`.

`cosyte/.github` is a non-member and is read anyway, by name, because it owns the shared reusable
release workflow that thirteen members call.

## Coverage (AC8, AC9, AC10)

**Denominator: 18** = 16 members + 2 membership-undecidable.

| limb                                   | numerator | denominator | coverage   |
| -------------------------------------- | --------- | ----------- | ---------- |
| repositories measurable for PR history | 18        | 18          | **100.0%** |
| repositories with a readable tree      | 16        | 18          | **88.9%**  |

Membership-undecidable count sitting beside them: **2**. Each adds 1 to the denominator and 0 to the
tree-read numerator, so the tree limb's 88.9% is entirely explained by `web` and `minions` and not by
any member going unmeasured.

**Both limbs are at or above 80%, so no coverage stop was owed and the revised process is
deliverable.** No population repository was excluded as not-measured for PR history: nothing was
access-denied, rate-limited, archived, or history-unreadable.

**Zero rows (AC10).** Four measured repositories have never had a Version Packages PR and are
recorded rather than omitted: `cosyte/pathways` (0), `cosyte/bridgelink-mcp` (0), `cosyte/web` (0),
`cosyte/minions` (0).

## The identifying rule, and the stall clock

### One identifying rule, applied uniformly

**A Version Packages PR is a pull request whose title is exactly `Version Packages` and whose head
branch is exactly `changeset-release/main`.** Both conditions, every repository, no exceptions.

**What the rule excluded that a reader might reasonably have counted: nothing.** Both directions were
checked over **all 1,157 pull requests q04 returned** across the 18 in-scope repositories, which is
every pull request those repositories have ever had and is also the sum of `pullRequests.totalCount`
over the same 18 in q02:

- pull requests raised from `changeset-release/main` carrying some other title: **0**
- pull requests titled `Version Packages` raised from some other branch: **0**

There are therefore no retitled, renamed, reopened or non-standard-branch cases to list. **185** PRs
match, in 14 repositories.

### Last push: the observable, named once (AC35)

**The single observable is `pullRequest.commits(last: 1).nodes[0].commit.committedDate`: the
COMMITTER date of the newest commit the PULL REQUEST ITSELF lists as its own.** It was read for every
PR in every repository from the same field of the same query.

It is deliberately **not** the head branch's current tip. `changeset-release/main` is one reused
branch that the automation force-pushes at every release, so its tip is a fact about the latest PR
alone; reading it would date every merged PR's last push after its own merge and empty the stalled
set.

Two integrity checks on that choice, both run over all 185 rows:

- rows whose recorded last push is later than that PR's own merge or close timestamp: **0**. No row
  was branch-scoped, so no row was invalid and none was discarded.
- rows with a negative idle time: **0**.
- PRs whose last push could not be retrieved: **0**. So there are **no stall-clock-unreadable PRs**,
  the count of them is **zero** wherever the size of the stalled set is reported below, and no row is
  missing from the idle-time distribution.

### Stalled

**Idle time greater than 72 hours**, where idle time runs from the last push above to the PR's merge
or close timestamp, or to that row's own as-of instant where the PR is still open. The bar runs on
the last push and never on `opened-at`. `opened-at` and elapsed open time are on every row and no
threshold is applied to them.

## History (AC3), and the idle distribution (AC4)

The full per-PR table is [`release-stall-evidence/version-packages-prs.csv`](release-stall-evidence/version-packages-prs.csv):
185 rows, one per PR, carrying repository, PR number, state, author, `opened_at`,
`last_push_committer_date`, PR commit count, `merged_at`, `closed_at`, `terminal_at`,
`elapsed_open_hours`, `idle_hours`, `row_as_of`, and whether it is stalled.

### Overall

| statistic | idle time            | elapsed open time |
| --------- | -------------------- | ----------------- |
| count     | 185                  | 185               |
| median    | **0.05 h** (3.0 min) | 0.07 h (4.2 min)  |
| maximum   | 294.76 h             | 353.27 h          |
| minimum   | 0.01 h               | 0.01 h            |
| p90       | 2.83 h               | not reported      |
| p99       | 269.77 h             | not reported      |

Terminal states at the window: **183 merged, 0 closed unmerged, 2 still open.**

### Per repository

| repository              | PRs | median idle | max idle   | median open | max open | stalled |
| ----------------------- | --- | ----------- | ---------- | ----------- | -------- | ------- |
| `cosyte/astm`           | 23  | 0.04        | 2.29       | 0.05        | 6.93     | 0       |
| `cosyte/bridgelink-mcp` | 0   | n/a         | n/a        | n/a         | n/a      | 0       |
| `cosyte/ccda`           | 16  | 0.05        | 6.87       | 0.07        | 48.78    | 0       |
| `cosyte/cli`            | 6   | 0.05        | 0.26       | 0.32        | 15.17    | 0       |
| `cosyte/config`         | 10  | 0.07        | 22.35      | 0.17        | 22.35    | 0       |
| `cosyte/deid`           | 9   | 0.04        | 3.60       | 0.04        | 189.79   | 0       |
| `cosyte/dicom`          | 21  | 0.04        | 6.52       | 0.07        | 20.95    | 0       |
| `cosyte/fhir`           | 11  | 0.08        | **294.76** | 0.14        | 353.27   | **1**   |
| `cosyte/hl7`            | 12  | 0.05        | 20.38      | 1.45        | 20.38    | 0       |
| `cosyte/minions`        | 0   | n/a         | n/a        | n/a         | n/a      | 0       |
| `cosyte/mllp`           | 11  | 0.06        | 6.67       | 0.07        | 7.00     | 0       |
| `cosyte/ncpdp`          | 13  | 0.06        | 6.87       | 0.07        | 6.93     | 0       |
| `cosyte/pathways`       | 0   | n/a         | n/a        | n/a         | n/a      | 0       |
| `cosyte/synth`          | 9   | 0.07        | 3.60       | 0.13        | 21.14    | 0       |
| `cosyte/terminology`    | 15  | 0.06        | **269.77** | 0.10        | 269.77   | **1**   |
| `cosyte/transform`      | 9   | 0.05        | 0.08       | 0.07        | 186.94   | 0       |
| `cosyte/web`            | 0   | n/a         | n/a        | n/a         | n/a      | 0       |
| `cosyte/x12`            | 20  | 0.05        | 11.19      | 0.06        | 11.19    | 0       |

### The full idle-time distribution, so the bar is re-derivable

Every one of the 185 rows is in exactly one bucket. Nothing is omitted, because no idle time was
unretrievable.

| idle time            | PRs   | share    |
| -------------------- | ----- | -------- |
| <= 1 h               | 164   | 88.6%    |
| 1 to 6 h             | 9     | 4.9%     |
| 6 to 24 h            | 10    | 5.4%     |
| 24 to 48 h           | 0     | 0.0%     |
| 48 to 72 h           | 0     | 0.0%     |
| **> 72 h (stalled)** | **2** | **1.1%** |

The gap between 24 and 72 hours is empty, so the 72-hour bar is not a knife edge here: any bar
between about 23 hours and about 269 hours selects the same two PRs.

### Elapsed open time, published alongside, and why the clock choice matters

| elapsed open time | PRs |
| ----------------- | --- |
| <= 1 h            | 134 |
| 1 to 6 h          | 22  |
| 6 to 24 h         | 24  |
| 24 to 48 h        | 0   |
| 48 to 72 h        | 1   |
| > 72 h            | 4   |

**At the 72-hour bar the two clocks disagree about exactly two PRs, and the disagreement is the
reason the last-push clock was chosen.** `deid#14` (189.79 h open, 0.06 h idle) and `transform#10`
(186.94 h open, 0.03 h idle) each sat open for days and then merged within two minutes of a fresh
force-push. An `opened-at` bar at 72 hours counts them as stalls; the last-push bar does not, because
the automation was refreshing them and a human merged promptly once it settled. `ccda#61` (48.78 h
open, 0.03 h idle) is the same pattern one bucket down and **is not a disagreement at 72 hours**: it
clears neither bar, which is what the `48 to 72 h: 1` row above says.

**What the rejected clock would have produced, arithmetically.** An `opened-at` bar at 72 hours
selects **4** PRs, not 5: `deid#14`, `transform#10`, `fhir#73` (353.27 h) and `terminology#62`
(269.77 h). Four is still below AC32 clause 1's threshold of 5 stalled PRs, so **the rejected clock
would not have cleared the weakening threshold either**, and nothing in the disposition below turns
on the choice. The clock is fixed by operator decision in any case
(`operator-decision-stalled-is-measured-from-the-last-commit.md`), and NARROW is not a publish-gate
weakening, so AC32 is reported rather than relied on. This paragraph exists so nobody reads the
clock choice as having been load-bearing for the outcome. It was not.

## The stalled set (AC5, AC6, AC7, AC26, AC33, AC39)

Two PRs. Both open at their as-of instant.

### Required check sets, per repository, at that repository's rule-read instant

The **enumerating surface** is the repository ruleset graph
(`Repository.rulesets(includeParents: true)` with `RequiredStatusChecksParameters`) plus
`Repository.branchProtectionRules`, read for all 18 in-scope repositories in one document at
`2026-08-22T21:44Z`. **Both surfaces answered for every one of the 18; none was denied.** For
`cosyte/config` the ruleset answer was independently corroborated by
`GET /repos/cosyte/config/rules/branches/main`, which returned the identical three contexts. A PR
object's own mergeability state was used only as corroboration and never as the enumerating surface,
because it names no check.

This set is **determined in the present and applied to that repository's whole history as a declared
proxy**. No granted surface returns the required set as it stood during a stall in April, so an
attribution resting on it is discountable rather than mistakeable for a contemporaneous observation.

| repository              | required checks                                                                                                                                                                       | determination                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `cosyte/astm`           | `ci / actionlint`, `ci / verify (22, ubuntu-latest)`, `ci / verify (24, ubuntu-latest)`, `no-internal-refs`                                                                           | determined                                                 |
| `cosyte/bridgelink-mcp` | **EMPTY**                                                                                                                                                                             | determined (both surfaces answered and enumerated nothing) |
| `cosyte/ccda`           | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `no-emdash`                                                                                                      | determined                                                 |
| `cosyte/cli`            | `ci / actionlint`, `ci / prepublish`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `codeql / analyze (javascript-typescript)`, `no-emdash`, `no-internal-refs`                   | determined                                                 |
| `cosyte/config`         | `actionlint`, `verify (22)`, `verify (24)`                                                                                                                                            | determined                                                 |
| `cosyte/deid`           | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `codeql / analyze (javascript-typescript)`, `no-internal-refs`, `smoke (22)`, `smoke (24)`                       | determined                                                 |
| `cosyte/dicom`          | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `no-emdash`                                                                                                      | determined                                                 |
| `cosyte/fhir`           | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `no-emdash`, `no-internal-refs`                                                                                  | determined                                                 |
| `cosyte/hl7`            | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `no-emdash`, `no-internal-refs`                                                                                  | determined                                                 |
| `cosyte/minions`        | **EMPTY**                                                                                                                                                                             | determined                                                 |
| `cosyte/mllp`           | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `no-emdash`, `no-internal-refs`                                                                                  | determined                                                 |
| `cosyte/ncpdp`          | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `codeql / analyze (javascript-typescript)`, `no-emdash`, `no-internal-refs`, `release-dry-run`, `test-selection` | determined                                                 |
| `cosyte/pathways`       | `demo-smoke`, `gitleaks`, `supply-chain`, `verify`                                                                                                                                    | determined                                                 |
| `cosyte/synth`          | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `codeql / analyze (javascript-typescript)`, `no-internal-refs`                                                   | determined                                                 |
| `cosyte/terminology`    | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `codeql / analyze (javascript-typescript)`, `no-emdash`, `no-internal-refs`                                      | determined                                                 |
| `cosyte/transform`      | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `codeql / analyze (javascript-typescript)`, `no-emdash`, `no-internal-refs`                                      | determined                                                 |
| `cosyte/web`            | **EMPTY**                                                                                                                                                                             | determined                                                 |
| `cosyte/x12`            | `ci / actionlint`, `ci / verify (22, ...)`, `ci / verify (24, ...)`, `no-emdash`                                                                                                      | determined                                                 |

**No repository is `required-set-undetermined`**, so no repository's stalled PRs were restricted to
causes 3, 5 and 6. The three EMPTY entries are determinations, not denials: both the protection
surface and the ruleset surface answered for each, and each would have enumerated a nonempty set had
one existed. None of the three has any Version Packages PR, so the EMPTY finding decides nothing
here; it is recorded because the criterion asks for it per repository.

### The two attributions

#### `cosyte/fhir` PR 73

- **Primary cause: `approval-wait`.**
- **`approval-wait-observed`: TRUE.**
- Stall interval: `2026-08-10T14:41:34Z` (last push, committer date of `20805433a747...`) to
  `2026-08-22T21:26:52Z` (row as-of). 294.76 hours.
- **Observation cited:** workflow run **`31497105267`**, workflow `Release`, `head_branch: main`,
  `created_at: 2026-08-11T13:37:02Z`, `status: waiting` at the observation window, with
  `GET /repos/cosyte/fhir/actions/runs/31497105267/pending_deployments` returning environment
  `release` (id `18532539175`) and a single required reviewer, user `NSchatz`. That run has been held
  since 2026-08-11, inside the stall, so a release run for this repository was awaiting a
  protected-environment reviewer over an interval overlapping the stall. A second held run,
  `32495980284` (`2026-08-21T15:08:29Z`), is also inside the stall.
- **Definitions that also held, and were displaced by precedence:** cause 4 `unowned`. The PR is
  `mergeable: true`, `mergeable_state: clean`, `comments: 0`, `review_comments: 0`, no requested
  reviewers, no labels, not a draft, and its `updated_at` (`2026-08-10T14:41:38Z`) shows no
  interaction of any kind inside the stall. All five required checks reported success on the head sha
  `20805433a747...` (`ci / actionlint`, `ci / verify (22, ubuntu-latest)`,
  `ci / verify (24, ubuntu-latest)`, `no-emdash`, `no-internal-refs`), so the mergeable-across-the-
  stall proxy is satisfied on evidence rather than by default. `approval-wait` wins because it is the
  earlier entry in the precedence order.
- **Causes 1 and 2 do NOT hold, and this corrects a standing assumption.** This PR was expected to be
  the textbook `checks-never-reported` case: a `GITHUB_TOKEN`-authored head that starts no runs. It
  is not. The PR's author is `NSchatz`, so `RELEASE_PR_TOKEN` was wired, ten check runs reported on
  the head sha, and every one of them concluded `success`. Nothing on this PR is failing and nothing
  is pending.

#### `cosyte/terminology` PR 62

- **Primary cause: `approval-wait`.**
- **`approval-wait-observed`: TRUE.**
- Stall interval: `2026-08-11T15:50:53Z` (last push, committer date of `5f967cc4dc5a...`) to
  `2026-08-22T21:37:12Z` (row as-of). 269.77 hours.
- **Observation cited:** workflow run **`31701709401`**, workflow `Release`, `head_branch: main`,
  `created_at: 2026-08-13T12:47:22Z`, `status: waiting`, with
  `GET /repos/cosyte/terminology/actions/runs/31701709401/pending_deployments` returning environment
  `release` (id `18532353981`) and a single required reviewer, user `NSchatz`. Held since
  2026-08-13, inside the stall. A second held run, `32462897354` (`2026-08-21T08:22:38Z`), is also
  inside the stall.
- **Definitions that also held, and were displaced by precedence:** cause 4 `unowned`, on the same
  evidence shape: `mergeable: true`, `mergeable_state: clean`, zero comments, zero review comments,
  no reviewers, no labels, and all six required checks reporting `success` on head sha
  `5f967cc4dc5a...` (`ci / actionlint`, `ci / verify (22, ubuntu-latest)`,
  `ci / verify (24, ubuntu-latest)`, `codeql / analyze (javascript-typescript)`, `no-emdash`,
  `no-internal-refs`).
- Causes 1 and 2 do not hold, for the same reason: author `NSchatz`, nine check runs, all green.

**No stalled PR was recorded `unknown`.** Both have a retrievable observation supporting their
assignment, and neither borrowed a cause from the other.

### Cause summary (AC7)

**Denominator: 2 stalled Version Packages PRs.** Stall-clock-unreadable PRs excluded from this
denominator: **0**.

| primary cause             | count | share of 2                                           |
| ------------------------- | ----- | ---------------------------------------------------- |
| 1 `checks-never-reported` | 0     | 0.0%                                                 |
| 2 `guard-refusal`         | 0     | 0.0%                                                 |
| 3 `approval-wait`         | **2** | **100.0%**                                           |
| 4 `unowned`               | 0     | 0.0% (held of both, displaced by precedence in both) |
| 5 `other`                 | 0     | 0.0%                                                 |
| 6 `unknown`               | 0     | 0.0%                                                 |

**`approval-wait-observed`, reported separately over the same denominator and never reconciled with
the row above: 2 of 2, 100.0%.** The two summaries happen to agree here; they are still reported
separately, because they answer different questions and neither is derived from the other.

**Surface readability behind the `approval-wait-observed` column.** A `false` value on that attribute
would be ambiguous if the deployment and approval surface could not be read, because a measured
absence and an unmeasurable one would record identically. So it is stated: **the deployment and
approval surface was readable for 2 of 2 stalled PRs, and the count of stalled PRs whose deployment
or approval surface could not be read is ZERO.** No row here carries a `false` at all, so no row is
marked unobservable, and no count in this section mixes measured falses with unmeasurable ones.

### The current snapshot is not the answer (AC26)

Two Version Packages PRs are open at the window, which is also the entire stalled set. That
coincidence is not what this record rests on: the historical measurement above covers all 185 PRs
ever opened, and the attributions are made against observations from 2026-08-10 onward. Had the
snapshot been empty, the history and the attributions would still stand.

## Gap analysis (AC11, AC12, AC13, AC37)

**Coverage: trees read over population = 16 / 18 = 88.9%.** Every divergence below names the
repositories, the observed behaviour, the documented behaviour it contradicts, and the read that
established it.

### D1. Both release steps sit behind the human acknowledgment, in every repository that publishes

- **Diverging repositories: all 14 with a release workflow** (`astm`, `ccda`, `cli`, `config`,
  `deid`, `dicom`, `fhir`, `hl7`, `mllp`, `ncpdp`, `synth`, `terminology`, `transform`, `x12`).
- **Observed:** `environment: release` is declared at JOB level in both the shared reusable workflow
  `cosyte/.github/.github/workflows/release.yml` (single job `release`, line 212 onward, `environment:
release` at line 223) and in `config`'s hand-rolled `release.yml` at the pin. GitHub therefore
  holds the ENTIRE job in `Waiting` before step one, so a human must approve a run merely to have a
  Version Packages PR opened or refreshed.
- **Documented behaviour it contradicts:** `RELEASING.md` at the pin says both release gates run
  "first in `release.yml`, before install and **before an approver is asked for anything**". With the
  environment at job level that is false of `release.yml`: only the `ci.yml` copy runs before the
  approval. (`release.yml`'s own inline comment already conceded this; the prose did not.)
- **Read that established it:** tree reads of `<oid>:.github/workflows/release.yml` for all 14, plus
  `<oid>:.github/workflows/release.yml` in `cosyte/.github` at `fba38347b190...`.
- **Consequence, measured:** **62 `Release` runs were sitting in `status: waiting` at
  `2026-08-22T21:50:00Z`**, per repository: `fhir` 12, `x12` 10, `dicom` 9, `terminology` 6, `hl7` 4,
  `mllp` 4, `transform` 4, `deid` 4, `ccda` 3, `cli` 2, `ncpdp` 2, `astm` 1, `synth` 1, `config` 0,
  `pathways` 0, `bridgelink-mcp` 0. The oldest was created `2026-08-04T15:02:54Z`. **This is a census
  at that instant and does not re-derive from a re-run**, for the reason set out under the retrieval
  plan: `status=waiting` is current state, so an approved or cancelled run leaves the count. The
  divergence itself does not depend on the integer; it is established by the tree read.
- **Disposition: REQUIRED CHANGE.** `cosyte/config`: split into an ungated version job and a gated
  publish job. Done in this branch. The other 13: follow-on F1 below, because it lives in
  `cosyte/.github` and this work may not edit it.
- **One thing the split breaks and this branch repairs, disclosed because a silent regression here
  would be worse than the stall.** The `Every bumped package must be published, tagged and released`
  accounting used to sit in the single job and therefore covered both arms. Moving it into `publish`
  leaves one push uncovered: a version commit that ALSO carries a changeset landed since the Version
  PR was last refreshed is both `is-release` and `has-changesets`, takes the ungated arm, and would
  have gone green with packages bumped on `main` and nothing on the registry. `release.yml` on this
  branch carries a second copy of the accounting in the `version` job for exactly that push, and
  `RELEASING.md` failure state (c) carries its terminal action. **Anyone adopting F1 must port that
  step with the split, not just the split.**

### D2. `config` is the one hand-rolled release workflow

- **Diverging repository: `cosyte/config`.**
- **Observed:** 13 of the 14 release workflows are thin callers of
  `cosyte/.github/.github/workflows/release.yml@main` (25 to 47 lines each); `config`'s is 419 lines
  of its own pipeline.
- **Documented behaviour it contradicts:** nothing in `RELEASING.md`, which argues at length that
  `config` structurally cannot be a caller. It contradicts `config/.github/workflows/ci.yml`, which
  carries `NOTE: Phase C of the standardization campaign replaces this hand-rolled workflow with a
thin caller of the reusable workflow in cosyte/.github`.
- **Read that established it:** tree reads of each `release.yml`, matched against
  `uses: cosyte/.github/.github/workflows/release.yml`; and `<2c00b91>:.github/workflows/ci.yml`.
- **Disposition: ACCEPTED DIVERGENCE.** The two structural reasons still hold and were re-verified:
  the shared notes gate reads the ROOT manifest version, and `config`'s root is `private: true` at
  `0.0.0` and is never versioned by Changesets, so adopting the shared workflow would withhold every
  `config` publish on a green run; and the shared workflow tags `v<version>`, which collides when
  eight packages publish in one run. The stale `ci.yml` NOTE is corrected in this branch.

### D3. `pathways` carries `.changeset/` and has no release workflow

- **Diverging repository: `cosyte/pathways`.**
- **Observed:** `.changeset/` present; `.github/workflows` holds `ci.yml` and `no-emdash.yml` only.
- **Documented behaviour it contradicts:** `RELEASING.md` describes one pipeline for every
  `.changeset/`-carrying repository.
- **Read that established it:** `<8b745ca>:.changeset` and `<8b745ca>:.github/workflows`.
- **Disposition: ACCEPTED DIVERGENCE.** `pathways` publishes nothing: its root manifest and all seven
  `packages/*` manifests are `private: true`. Changesets is used there for version bookkeeping, not
  for a registry, so there is no publish to gate and no Version Packages PR has ever been opened (0).

### D4. `bridgelink-mcp` carries `.changeset/` and has no workflows at all

- **Diverging repository: `cosyte/bridgelink-mcp`.**
- **Observed:** `.changeset/` present; `<0bbe287>:.github/workflows` resolves to `null`, so the
  directory does not exist. Its required check set is EMPTY.
- **Documented behaviour it contradicts:** the same single-pipeline description.
- **Read that established it:** `<0bbe287>:.changeset` and `<0bbe287>:.github/workflows`.
- **Disposition: ACCEPTED DIVERGENCE.** Private root manifest, no workspace, nothing published, one
  pull request in the repository's whole history. It is a new repository that has scaffolded
  `.changeset/` ahead of needing it. Revisit when it first publishes; recorded here so the next
  measurement does not read it as a regression.

### D5. The `GITHUB_TOKEN` version-PR trap is real, was closed, and never actually produced a stall

- **Repositories: all 14 publishers.**
- **Observed:** of 185 Version Packages PRs, 44 were authored by `github-actions` and 141 by
  `NSchatz`. The last `github-actions`-authored one was opened `2026-07-31T14:33:40Z`; every Version
  Packages PR since is authored by the token owner, which is what `RELEASE_PR_TOKEN` being wired
  looks like from outside.
- **Documented behaviour it contradicts:** nothing. `RELEASING.md` documents the trap correctly. What
  it does not say is what it cost, and the answer is: the **maximum idle time over all 44
  `GITHUB_TOKEN`-authored PRs is 22.35 hours**, well under the bar. The trap was closed before it
  ever produced a stall.
- **Read that established it:** the `author.login` and `commits(last: 1)` fields of q04.
- **Disposition: ACCEPTED DIVERGENCE.** Nothing to change. Recorded because it retires the leading
  hypothesis this item started with, and because `RELEASING.md`'s warning should stay: the trap is
  closed by a secret that can be unset, not by code.

### D6. `deid` has no em-dash workflow while every other publisher does

- **Diverging repository: `cosyte/deid`.**
- **Observed:** `<49eaefb>:.github/workflows` holds no `no-emdash.yml`, and `no-emdash` is absent
  from its required check set, while 12 of the other 13 publishers carry one or both.
- **Documented behaviour it contradicts:** nothing in `RELEASING.md`. Recorded because the tree read
  surfaced it and a gap analysis that silently drops what it saw is not one.
- **Read that established it:** `<49eaefb>:.github/workflows` and the ruleset read.
- **Disposition: ACCEPTED DIVERGENCE for this work.** It is not a release-process divergence and
  fixing it means editing `cosyte/deid`, which is out of scope here. Filed as follow-on F5 so it is
  not lost.

### The four claims this work was required to re-check (AC12)

**Claim 1: the set of packages `config` publishes. CONFIRMED as stated, and corrected here.** At the
pin, `RELEASING.md`'s opening list named seven packages; `packages/` holds eight; `@cosyte/process`
`0.0.2` is publishable (`publishConfig.access: public`, no `private` flag) and was unnamed; and other
passages still said "six packages". All eight workspace manifests were read at `<2c00b91>` and every
one is a public `@cosyte/*` package: `eslint-config` `0.0.6`, `prettier-config` `0.0.4`, `process`
`0.0.2`, `script-utils` `0.0.2`, `test-utils` `0.0.4`, `tsconfig` `0.0.4`, `tsup-config` `0.0.3`,
`vitest-config` `0.0.4`. **Correction made:** `RELEASING.md` now names all eight, and every
"six packages" passage is gone.

**Claim 2: where the release gates run relative to the approval. CONFIRMED.** At the pin
`RELEASING.md` said both gates run "first in `release.yml`, before install and before an approver is
asked for anything", while `release.yml` declared `environment: release` at job level, so that copy
ran AFTER the approval. **Correction made, and it is a real one rather than a wording fix:** the
gates now run in an ungated `preflight` job, so the sentence is true of `release.yml` as well as of
`ci.yml`. See D1.

**Claim 3: whether `config` is a caller of the shared reusable workflow. CONFIRMED.** It is not, and
`release.yml` and `RELEASING.md` were right that it structurally cannot be; `ci.yml`'s Phase C NOTE
was the stale one. **Correction made:** the NOTE in `ci.yml` now records that Phase C was measured
and declined for `config`, and points at the two structural reasons. See D2.

**Claim 4: whether the documented commands are the invoked ones. CONFIRMED.** `RELEASING.md` named
`pnpm changeset:guard` and `pnpm release:notes prepare`; both workflows invoke
`node scripts/changeset-guard.mjs` and `node scripts/release-notes.mjs prepare ...` directly. The
behaviour is identical (the `package.json` scripts are thin wrappers), but a reader following the
document could not find the string it names in the workflow. **Correction made:** `RELEASING.md` now
names the invoked commands and says the `pnpm` aliases are the local equivalents.

### Every primary cause with a nonzero share, sorted (AC37)

Exactly one cause has a nonzero share.

| cause           | share  | list                                 | entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval-wait` | 100.0% | **change the revised process makes** | The step that changes is the version-PR step: it moves out of the gated job into an ungated `version` job, so a pending changeset produces a Version Packages PR with no human in front of it, while the publish keeps its acknowledgment. **How it would have altered the two PRs attributed to it:** `fhir#73` and `terminology#62` would each have been created and refreshed by a run that never entered `waiting`, and the held runs `31497105267` and `31701709401` (which are version-arm runs, not publish-arm runs, since a Version Packages PR was open in both repositories) would not exist. The wait budget and the escalation in `RELEASING.md` then bound how long the merge itself may sit. |

`checks-never-reported`, `guard-refusal`, `unowned`, `other` and `unknown` all have a zero share and
are therefore not owed an entry. For completeness, and placed in exactly one list: `unowned` held of
both stalled PRs as a displaced definition, and it is in the **change** list too, addressed by the
named merge owner and 24-hour wait budget in `RELEASING.md`, which is what gives an unowned Version
Packages PR an owner.

## The acknowledgment disposition (AC18 to AC22, AC30 to AC32)

### The disposition: NARROW

**Exactly one disposition is recorded: NARROW. The protected `release` environment acknowledgment is
retained on the PUBLISHING step only. The version-bump step stops waiting on a human.**

- **Count and share of stalled PRs carrying `approval-wait-observed: true`: 2 of 2, 100.0%** (the
  AC33 attribute, not the primary-cause count, though here they coincide). Stall-clock-unreadable PRs
  excluded from that denominator: 0.
- **The control that remains:** the protected `release` environment itself, unchanged. Required
  reviewer `NSchatz`, `main`-only deployment-branch policy, and it now guards a job whose only
  purpose is to publish. Nothing else changes about it: no reviewer is added, no automation identity
  is admitted, `wait_timer` stays 0, and `prevent_self_review` stays off.
- **What additionally stands behind it, as defence in depth rather than as a replacement:** the
  ungated `version` job is given no `publish:` input and no `NPM_TOKEN` / `NODE_AUTH_TOKEN`, and no
  `id-token: write` permission, so an ungated job reaching the registry would need two independent
  mistakes rather than one.
- **The procedure that reverses this disposition** (one edit, no other repository involved): in
  `config/.github/workflows/release.yml`, delete the `version` job, move its
  `Open or refresh the Version Packages PR` step back into the `publish` job as the single
  `changesets/action` call with both `version:` and `publish:` inputs, and delete the `if:` on the
  `publish` job so it runs on every push. That restores the single gated job exactly. The
  organization-wide equivalent is to not adopt follow-on F1.

### This is not publish-gate weakening, tested explicitly (AC32, AC30)

A publish-gate weakening is any disposition whose effect is that a step publishing to npm can proceed
without a human acknowledgment standing in front of it today. **NARROW is expressly not one:**
narrowing the acknowledgment to cover only the publishing step, while the version-bump step stops
waiting on a human, leaves nothing reaching npm any more easily than it does today. The publish job
still declares `environment: release`.

The weakening threshold is nevertheless reported, because it was tested before anything was enacted
and because reporting it is what makes "we did not weaken the gate" checkable rather than asserted:

| clause | requirement                                                   | measured                          | verdict                                                     |
| ------ | ------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| 1      | at least 5 stalled PRs measured in total                      | 2                                 | **FAILS**                                                   |
| 2      | `approval-wait-observed: true` on at least half of them       | 2 of 2 (100%)                     | passes                                                      |
| 3      | at least 3 such PRs across at least 2 population repositories | 2 such PRs, across 2 repositories | **FAILS** on the count of PRs; the repository spread is met |

**Clauses 1 and 3 fail, so a publish-gate weakening could not have rested on this measurement.** It
could not have rested on an operator decision either: **no operator decision artifact deciding the
npm publish acknowledgment exists.** Three `operator-decision-*.md` files are committed under the
spec folder and each was checked against all three content tests. Each names the spec and each quotes
a decision, but each decides a MEASUREMENT question (which clock defines a stall; what surface
establishes an EMPTY required set; which criterion narrows which for a DISCLOSE record), and none
decides the npm publish acknowledgment. The spec's own approval is expressly not such an artifact
either. So the weakening route was closed from both directions, and would have been closed even if
the arithmetic had cleared.

**What would have been recommended had the threshold cleared, recorded as the follow-on it must be:**
follow-on F4 below. Nothing of the kind is enacted here.

### AC20 and AC31 do not fire, and why that is stated rather than assumed

AC20 (the permanence statement and the named replacement controls) and AC31 (blocking-check evidence
for each named control) fire on publish-gate weakening, including a narrowing that loosens the
publishing step's own gate. Under NARROW the publishing step keeps its acknowledgment, so neither
fires, and no control is being named "in the acknowledgment's place" because the acknowledgment has
not moved. The permanence fact is stated in `RELEASING.md` anyway, because it is the reason the gate
stays where it is: **a published npm version is permanent and cannot be withdrawn by this process.**

### Against the autonomy position in force (AC21)

**The disposition is NOT GOVERNED by the autonomy position, and the scope statement is this.**

`documentation/adr/0021-autonomous-development.md` and the operator decree of 2026-08-17
(`documentation/operator-decree-auto-land-routine-on.md`, with `process/autonomy.json`) govern
exactly one thing: **who approves an SDD SPEC and when CI may land it on the umbrella repository's
own `main`**. ADR-0021's decision is about `process/autonomy.json` listing tiers,
`scripts/approve_auto.py` being the only writer of that flip, and `resume.py` deriving
`approve-auto`; its four refusals are about tiers, the spec gate, and CI on HEAD. Neither document
mentions npm, the registry, Changesets, the `release` environment, or any package publication, and
neither delegates a position on them. So there is no proposition in either document that this
disposition could follow or depart from.

What ADR-0021 does supply is the warning that decided the shape of this disposition. It accepted
removing a human gate on the explicit ground that `just rollback` "is accepted at any point
afterward and never expires". **A published npm version has no such remedy.** The asymmetry is why
the acknowledgment stays exactly where the irreversible step is, and moves off the step that is
merely a pull request anyone can close.

## The two named PRs (AC23, AC24, AC25)

Both were still open at the observation window, so the AC24 branch does not fire; the general rule is
stated anyway, because the rule and not the two PRs is the deliverable.

### `cosyte/fhir` PR 73

- **State observed: OPEN**, `mergeable: true`, `mergeable_state: clean`, all five required checks
  green on head `20805433a747...`, zero comments, zero reviews.
- **Observation timestamp: `2026-08-22T21:26:52Z`** (this row's as-of instant).
- **Action the revised process prescribes:** it is past the 24-hour merge budget, so the release
  owner **merges it**. It is mergeable and green, so merging is a one-click act that needs no
  approval; the publish run it triggers is the thing that waits for the acknowledgment, which is
  correct and stays. The stall ends in the terminal state `merged and published`.

### `cosyte/terminology` PR 62

- **State observed: OPEN**, `mergeable: true`, `mergeable_state: clean`, all six required checks
  green on head `5f967cc4dc5a...`, zero comments, zero reviews.
- **Observation timestamp: `2026-08-22T21:37:12Z`**.
- **Action the revised process prescribes:** the same. Merge it; approve the publish run it triggers.

### The general rule, for a PR in any state

- **Open, green, past budget:** merge and publish. This is the case both named PRs are in.
- **Open, red or unmergeable:** fix forward on the release branch, or close it with its changesets
  preserved on `main` so the next release consumes them. Never delete a changeset to clear a PR.
- **Merged since the observation:** nothing is owed; check the publish run it triggered is not still
  sitting in `waiting`.
- **Closed unmerged, renumbered, or absent:** confirm the changesets it would have consumed are still
  in `.changeset/` on `main`. If they are, the next release picks them up and no action is owed. If
  they are not, they were consumed by a version commit that never published, which is the partial
  publish failure state in `RELEASING.md`.

**Neither PR is acted on by this work.** Both actions require a merge inside `cosyte/fhir` and
`cosyte/terminology`, which are outside this work's write scope, so they are recorded as follow-ons
F2 and F3 rather than performed.

## Follow-on list: every change this process implies outside `config` (AC17, AC25)

No file outside the `config` checkout is modified by this work. Everything below is filed, not done.

| #      | repository                                                                                                                                                                                                    | change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | `cosyte/.github`                                                                                                                                                                                              | Split `.github/workflows/release.yml` the way `config`'s is split in this branch: an ungated preflight job running the release gates, an ungated `version` job with no `publish:` input and no npm credentials, and a gated `publish` job keeping `environment: release`. This is the change that matters, because 13 of the 14 publishing repositories inherit their pipeline from this one file. **What it removes, stated precisely: the wait on every push that carries a pending changeset**, which is the class both stalled PRs sit in. It does NOT remove all 62 held runs. The `publish` job is gated on `has-changesets != 'true'`, so every ordinary push to `main` with no pending changeset still enters `waiting` and still needs a human, which is correct and deliberate: that arm is the one that can reach npm. The residue is what `RELEASING.md`'s step 5 budget and lapsed-budget rule exist to bound. `config`'s `release.yml` on this branch is the reference implementation, including the `has-changesets` arm condition, the argument for why that condition is not the `is-release` classifier, and the version-arm copy of the release accounting that the split makes necessary (see D1). |
| **F2** | `cosyte/fhir`                                                                                                                                                                                                 | Merge PR 73. It is green, mergeable, and 294 idle hours old. Then approve the publish run it triggers, and clear the 12 held `Release` runs (the oldest, `31269174845`, dates from 2026-08-08).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **F3** | `cosyte/terminology`                                                                                                                                                                                          | Merge PR 62, on the same terms. Then clear the 6 held `Release` runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **F4** | organization (npm and GitHub settings, not a repository edit)                                                                                                                                                 | If the release backlog persists after F1, the next lever is a `wait_timer`-plus-second-reviewer arrangement on the `release` environment, or npm Trusted Publishers with OIDC so no long-lived `NPM_TOKEN` exists. **Neither is enacted and neither may be**, since either would touch the publish acknowledgment and there is no operator decision artifact deciding it. Raise it with the operator; do not infer it from this record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **F5** | `cosyte/deid`                                                                                                                                                                                                 | Add `no-emdash.yml` and make `no-emdash` a required check, matching the other twelve publishers. Not a release-process change; filed so D6 is not lost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **F6** | `cosyte/astm`, `cosyte/ccda`, `cosyte/cli`, `cosyte/deid`, `cosyte/dicom`, `cosyte/fhir`, `cosyte/hl7`, `cosyte/mllp`, `cosyte/ncpdp`, `cosyte/synth`, `cosyte/terminology`, `cosyte/transform`, `cosyte/x12` | After F1 lands, clear the 50 remaining held `Release` runs (62 minus fhir's 12 and terminology's 6, plus those two once F2 and F3 are done). Each is a decision about a specific publish, so they are approved or cancelled one at a time by the release owner, not swept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Reproducing this

Every query is in the retrieval table with its exact endpoint and filters, and that table is the
whole reproduction route: **no raw responses are committed**, by the operator decision recorded
above. Re-running a **bounded** query reproduces its answer exactly. Re-running a **live** one
returns current state, and this record's answer for it is the literal value printed here beside the
endpoint that produced it, which is a claim a reader can contradict but not re-derive. Rows will
legitimately differ where a PR, run or repository has changed state since `2026-08-22T21:55:00Z`,
which is what a DISCLOSE record means, and the two things most likely to have moved by the time you
read this are the 62-run census and the state of `fhir#73` and `terminology#62`.
