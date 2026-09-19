# 0003: How the shared phi-scan engine settles the eight gaps its first consumer found

- **Status:** Accepted (2026-09-19)
- **Scope:** the `./phi-scan` export of `@cosyte/script-utils`, and every repository that consumes
  it. It does not reach the per-repo axes (`exitCodes`, `scanRoots`, `isStagedReadable`, the
  per-standard `detect`, the allow-list and override-log files), which stay each repository's own.
- **Relates to:** [`packages/script-utils/phi-scan.js`](../../packages/script-utils/phi-scan.js)
  (the engine this decides the behaviour of) ·
  [`packages/script-utils/CHANGELOG.md`](../../packages/script-utils/CHANGELOG.md) (the release that
  carries it) · ADR 0002 (the version line it ships on).

## Context

The engine was written against thirteen copied scanners and then adopted by one of them. Walking
that consumer's committed corpus against the engine produced eight differences. Some are plain
absences in the engine. Some are choices the engine made deliberately, documented in its own source,
that disagree with what the consumer's gate has always done. Every one of them has to end with ONE
settled behaviour, because the whole point of a shared engine is that a repository cannot have its
own.

Two of the eight cannot be settled without giving something up, and this decision records what,
rather than letting the loss arrive as a surprise in a later review. The estate's tie-breaker is
PHI safety before developer convenience, and the compensating control for each narrowing is named
below with the route that still refuses.

## Decision

### 1. A root's KIND is derived from the filesystem, and the per-root observation rule carries the rest (AC-10)

The alternative was a root-kind axis: the caller declares `directory` or `file` per root and a root
that is not the kind it was declared refuses. We do not take it.

- A scope declaration in thirteen callers' hands is thirteen chances to declare the wrong thing, and
  a wrong declaration is exactly the porting mistake the required axes exist to catch. `scanRoots`
  stays a plain `string[]`.
- The state a declaration would have caught and derivation cannot is a root that WAS a directory and
  is now a regular file: it is scanned as one target rather than refused. That is a narrowing for a
  consumer whose own scanner refuses it, and it is recorded under AC-8 below.

All three kinds now have one settled outcome each, and the engine's own suite carries a case per
kind:

| kind                                  | outcome                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a regular file                        | scanned as ONE target, through the same read filter every other file goes through. A root the filter drops yields nothing, so the per-root rule refuses.                                              |
| a directory that cannot be enumerated | REFUSED at the caller's `refuse` code, naming the path and the errno. It used to escape `readdirSync` uncaught and take node's own exit 1, the code the contract reserves for HITS FOUND.             |
| a symbolic link                       | REFUSED rather than followed, named with its kind. A root is the one place a link could have been followed by construction, because the walk starts there instead of meeting it as a directory entry. |

Above those, the per-root observation rule stands: an `all`-mode sweep refuses unless EVERY scan root
yielded at least one file that was actually READ, and the refusal names every starved root. That is
what makes "whatever its kind" true. A missing root, an unreadable one and a root whose every file
the read filter drops all reach it.

### 2. The index route is not narrowed by `scanRoots` (AC-12)

`scanRoots` is the WALK's scope: it answers what is on disk under the roots a repository declared.
The index answers a different question, what this repository CARRIES, and a root list is not
entitled to narrow that. Measured on the first consumer: three real messages under an undeclared
top-level directory were read by neither route, and a tracked symbolic link outside every root was
reached by neither.

So `all` mode considers every path the index carries. The two READ filters still apply on both
sweeping routes, so the Markdown exemption and `excludedPaths` mean one thing rather than two.
`--staged` is untouched: it keeps its own scope, which is what a COMMIT is blocked on.

### 3. The remaining absences (AC-11, AC-13, AC-14, AC-15, AC-18)

- A starved root refuses, naming every starved root and how many of how many roots went unobserved.
- A skipped target now qualifies the CLEAN LINE on stdout, not only the report on stderr. A reader
  watching stdout could otherwise take an unqualified OK from a sweep that skipped a file.
- A hit in the bytes git carries is labelled `(git index)` or `(git index; the working tree
differs)`, and a footer counts how many of the reported hits are in those bytes. One label hid
  that re-staging is part of the remedy for the second kind.
- An index-route refusal prints the hits the walk already found BEFORE refusing. Refusing at
  enumeration time discarded them, so a consumer saw a refusal with no indication that PHI had
  already been found. The refusal still wins the exit code.
- "git could not read the index" and "the index holds no entries" carry different sentences, because
  they have different remedies.

### 4. Which tier refuses a bypass is decided by the MODE (AC-17)

`--allow-fixture` still cannot reach a clean run in any mode. What changes is which refusal fires,
and it now follows the run's declared scope rather than the flag:

- In `paths` mode the declared scope is argv, so a bypass naming something argv does not carry
  subtracts nothing and is refused by the UNMATCHED tier, which says so and names it.
- In `all` mode the declared scope is the whole corpus, so a bypass declares a path the run would
  have read: it joins the enumerated set and is refused by the COMPLETENESS tier.

The flag still does not choose the MODE. Letting it made `--allow-fixture X` scan exactly `X`, then
withdraw it, then report a clean whole run over a corpus it never touched.

## What this narrows, and what still refuses it (AC-8)

`phi-safety` P1 is blocking, so a settlement that makes a commit gate refuse LESS is recorded here
with its compensating control rather than left in a diff. Both narrowings below are pinned by a case
in the engine's own suite that names AC-8.

### N1. The `--staged` route keys on `isStagedReadable`, not on the root half of scope (AC-16)

The staged route's non-regular and unmerged refusals used to fire for any path under a scan root. A
caller whose staged scope is NARROWER than its roots therefore had commits blocked that its own gate
had always let through: the first consumer admits `src/**.ts` and `test/fixtures/**` on that route,
and a staged `src/notes.txt` symbolic link was refused at the refuse code where that repository's own
scanner exits 0. What a commit is blocked on is a hook decision each repository takes for itself, and
widening it from inside a shared engine takes that decision away.

**What is given up:** a staged non-regular entry that the caller's own staged scope declines is no
longer refused by the pre-commit route. A symbolic link's blob is its TARGET PATH, and a target path
can itself carry PHI, so this is not nothing.

**What still refuses it:** `all` mode, twice over. The walk classifies the entry with
`Dirent.isSymbolicLink()` when it sits under a scan root, and the index route refuses the tracked
mode-120000 record wherever it sits, now that that route is not narrowed to the roots either. A
repository's own sweep, which is what CI runs, still refuses it. The residual is the window between
the commit and that sweep.

**What would reverse it:** a caller that wants the wider refusal widens `isStagedReadable`, which is
the axis that decides it, in its own repository, deliberately.

### N2. A root that is now a regular file is scanned rather than refused (AC-10)

Derivation cannot tell a root that was always a file from one that was a directory yesterday. The
first consumer's own scanner refuses the second state with `could not enumerate`, and the engine
scans the file.

**What is given up:** the corpus that used to live under that root is no longer walked, and the
sweep does not say so as long as the file itself is read.

**What still refuses it:** nothing on the walk side, and this is stated plainly rather than argued
away. What covers the corpus is the index route: every TRACKED file that lived under that root is
still read, from the bytes git carries, because that route is no longer narrowed by `scanRoots`
(decision 2 above). What is lost is UNTRACKED content under the old root, which git carries nothing
for and which no scan of the repository can vouch for anyway.

## Consequences

- A consumer whose committed corpus pins any of the behaviours above updates the affected case to
  the settled outcome and cites this decision on it. A case may change its expected outcome; it may
  not vanish, be skipped, or stop asserting.
- A consumer adopting the published engine gets a WIDER `all`-mode sweep (the whole index) and a
  NARROWER `--staged` route (its own scope) than the engine gave before. Both directions are
  deliberate and both are graded here.
- The engine's own suite carries a case per settlement, named for the criterion it grades, so a
  later change that reopens one reds rather than arriving silently.
