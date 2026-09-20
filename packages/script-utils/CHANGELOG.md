# Changelog

All notable changes to `@cosyte/script-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package is on the
**`0.1.x`** line: its surface is settled, and bump types follow ordinary semver rather than a
pre-alpha rule. See
[ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md).

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically.

## [Unreleased]

## [0.1.0] - Unreleased

### Changed

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** `isCliEntrypoint`
  exports exactly what `0.0.2` exports. The phi-scan engine does NOT: see the entries below, which
  are what this release actually carries on that subpath. The version policy itself is unchanged in
  substance and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.2` does not resolve this release and has to widen its range once, which is recorded as break
  candidate BC-2 in `documentation/release-0.1.0-audit.md`.
- **`phi-scan`: `all` mode refuses unless EVERY scan root yielded a file that was read**, naming the
  starved roots. The completeness rule asks whether every target was read; nothing asked whether a
  root produced a target at all, and one productive root made the whole run look productive.
  Measured before the change: a caller supplying an `isWalkReadable` that admits nothing read no
  file on either sweeping route and printed `OK: no hits` at the CLEAN code over a tracked file
  carrying a live dashed identifier.
- **`phi-scan`: an UNTRACKED file removed mid-run is reported SKIPPED rather than refusing.** A
  target the walk listed and that was gone by read time refused unconditionally, which made an
  ordinary mid-run deletion look like an unaccounted-for file. Git carries no bytes at such a path,
  so nothing the repository holds went unread. The exception is bounded: a tracked file, a
  non-`ENOENT` failure, a path named on argv and a path that came BACK before the run ended all
  still refuse.
- **`phi-scan`: a finding names a position and stops there.** A hit report prints the locus, the
  locator inside it and the rule that fired, and no longer the token that matched:
  `segment=(ssn) (dashed SSN pattern)` where it used to carry the identifier as well. stderr is a CI
  log, and a diagnostic ABOUT a PHI leak that quotes the leak is a second copy of it somewhere with
  no retention policy. `Hit.value` is now optional, a hit the engine reports never carries one, and
  **a gate test asserting that the matched identifier reaches stderr asserts on the locator and the
  rule instead.**
- **`phi-scan`: `all` mode reads the bytes git carries at EVERY tracked path.** `scanRoots` bounds
  the WALK, which answers what is on disk under the roots you declared; the index answers what your
  repository CARRIES, and a root list was narrowing that too. Measured on the first consumer to
  adopt this engine: three real messages under an undeclared top-level directory were read by
  neither route, and a tracked symbolic link outside every root was reached by neither. **A
  repository whose roots are narrower than itself has more of it read after this release.** The two
  READ filters are unchanged and still apply on both sweeping routes, so a tracked `.md` and an
  `excludedPaths` entry mean what they meant. `--staged` is untouched.
- **`phi-scan`: the `--staged` route refuses what `isStagedReadable` admits, and nothing else.** Its
  non-regular and unmerged refusals used to fire for any path under a scan root, so a repository
  whose staged scope is narrower than its roots had commits blocked that its own gate had always let
  through: what a commit is blocked on is a hook decision each repository takes for itself. **This
  refuses LESS at the pre-commit hook.** A staged entry your staged scope declines is still refused
  by `all` mode on both of its routes, so your own sweep catches it; widen `isStagedReadable` if you
  want the hook to refuse it too. Recorded with its compensating control as N1 in
  [ADR 0003](../../documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md).
- **`phi-scan`: a hit in the bytes git carries says WHICH kind it is.** The single
  `(as git carries it)` label becomes `(git index)` for a path whose working-tree copy the run never
  read and `(git index; the working tree differs)` for one whose disk copy carries other bytes, with
  a footer counting how many reported hits are in those bytes. The second kind reads clean in the
  file a developer opens, so re-staging is part of its remedy and one label hid that. **A gate test
  asserting the old label asserts one of the two new ones.**
- **`phi-scan`: an index-route refusal no longer discards the hits already in hand.** An unmerged
  index entry or a tracked link refused the whole sweep before anything was read, so a consumer saw
  a refusal with no indication that PHI had already been found. The walk sweeps first, prints what
  it found, and the refusal follows at the same code.
- **`phi-scan`: a clean run that skipped a file says so on stdout**, as
  `OK: no hits (N untracked file(s) skipped, see stderr)`. With nothing skipped the line is
  byte-identical to what it was.
- **`phi-scan`: a scan root has one settled outcome per KIND.** A regular file is scanned as one
  target, a symbolic link is refused rather than followed, and a directory that cannot be listed is
  refused at your `refuse` code naming the path: that one used to escape `readdirSync` uncaught and
  take node's own exit 1, the code this contract reserves for HITS FOUND. The kind stays DERIVED
  from the filesystem rather than declared, and what that gives up is recorded as N2 in ADR 0003.
- **`phi-scan`: two refusals reworded because their remedies differ.** "git could not read this
  repository's git index" and "the git index holds no entries" were one sentence. The starved-root
  refusal says how many of how many roots went unobserved and names them.
- **`phi-scan`: which tier refuses `--allow-fixture` follows the MODE.** A bypass beside a positional
  path names something the run does not enumerate; a lone bypass declares a path an `all`-mode run
  would have read and is refused by the completeness rule. Both name the path, and neither reaches a
  clean run, which is unchanged.
- The `README.md` in the tarball now opens its `## Status` section on the settled-line sentence
  instead of the pre-alpha ladder one, so the policy text a consumer reads agrees with the version
  printed beside it. `scripts/readme-check.mjs` grades that sentence against the release line the
  pending changesets resolve to.

## [0.0.2] - 2026-08-11

### Added

- **`@cosyte/script-utils/phi-scan`: the shared machinery of the `@cosyte/*` PHI commit-gate, as a
  parameterised engine.** `scripts/parser-template/` is a SCAFFOLD rather than a dependency, so
  `scripts/phi-scan.ts` was COPIED into every parser repo. **Thirteen repos, thirteen byte-distinct
  copies**, so a newly-found escape cost one pull request and one adversarial review PER REPO, and
  three escape classes had already been paid for that way. `runPhiScan(config)` owns argument
  parsing, the allow-list and override log, target enumeration on all three routes, the union of the
  working-tree walk with the bytes git carries, content deduplication under git's own
  `blob <len>\0` framing, the completeness rule, every refusal, and the cross-cutting SSN/email
  floor.

  **THE FIVE PER-REPO AXES ARE PARAMETERS, NOT FORKS**, and which ones are required is itself the
  design. `exitCodes`, `scanRoots` and `isStagedReadable` are **REQUIRED**: the siblings genuinely
  disagree on all three, and a default would be the porting mistake the gate exists to catch (at
  least one sibling uses 2 where another uses 1). `excludedPaths`, `isWalkReadable` (the Markdown
  read exemption) and `regularBlobModes` are **DEFAULTED**, so moving one of those boundaries is a
  change to this package plus a version bump rather than an edit in thirteen repos. EOL
  normalization has **no parameter at all** and stays machinery: the walk/index deduplication is by
  CONTENT, so where a `text` attribute or `core.autocrlf` makes the index carry LF and the working
  tree CRLF, BOTH forms are scanned.

  **Per-standard field detection stays with the caller**, through `detect`. It is handed the
  reported LOCUS rather than the target path, so a hit found in the bytes git carries cannot be
  reported against a working-tree copy a developer would open and find clean. That used to be a
  sentence in a comment; it is now the only path a caller can reach.

- **A scan root may name a regular FILE, and the kind is DERIVED from the filesystem rather than
  declared**, which is what keeps the parameter a plain `string[]`. Measured against the thirteen
  live copies: they declare roots in at least six different shapes, and one declares
  `{ rel, shape: "directory" | "file" }` with a single file among them. An earlier draft fed every
  root to `readdirSync`, so such a root threw `ENOTDIR`, uncaught, and the run took node's exit 1,
  the code this contract reserves for HITS FOUND. **What deriving gives up is stated rather than
  left to be found**: a declaration can notice a root is not the KIND it was meant to be and
  derivation cannot. A root that is neither a file nor a directory is still refused, a root naming a
  symbolic link is refused rather than followed, and a MISSING root is skipped, which is unchanged
  from the copied scanners and is named as the one remaining silently-empty root state.
- **A scan root of `"."` means the whole repository**, with gitignored directories pruned during
  descent and `.git` skipped by literal name, which is what makes a whole-repository root usable at
  all rather than a walk through `node_modules`. Pruning is equivalent to filtering afterwards
  because **`git check-ignore` is index-aware at directory granularity**, measured both ways on git
  2.39.5: with nothing tracked underneath, a gitignored directory is reported ignored and pruned;
  with one file force-added underneath it is reported NOT ignored, so the walk descends and still
  reads it. An earlier draft justified this with the gitignore-pattern rule that a path under an
  excluded directory cannot be re-included, which does not settle it, because the filter being
  replaced asked `check-ignore` too.

### Changed

- **Two containments the first draft ASSERTED are now ENFORCED**, both falsified by this slice's
  adversarial review and both reproduced against the pre-consolidation scanner too, so neither is a
  regression this package introduced. What was introduced was the sentence claiming they held, on the
  API contract thirteen migrations are about to be written against.
  - **A staged path `isStagedReadable` admits that no scan root covers is REFUSED.** The type said
    the `--staged` filter was "narrower than the root half by construction"; nothing constructed it,
    because they are two independent keys. Measured with roots at `["src"]` and the filter at the
    shared Markdown exemption: a STAGED mode-120000 entry under `test/fixtures/` was outside every
    scan root, so the non-regular refusal never saw it, and the route enumerated it, READ it, handed
    the link's TARGET PATH to the detector as if it were content, counted the scan complete and
    printed `OK: no hits` at exit 0. Narrowing silently to the intersection would have been the wrong
    repair: it hides a misconfiguration in the one place the gate blocks a commit.
  - **A scan root is normalised the way every other path is, and one resolving outside the repository
    is refused.** `"./src"` is a spelling the type documents as valid; it walked correctly while
    `isUnderScanRoot` compared it against the normalized index path and never matched, emptying the
    union, the index non-blob refusal and the unmerged refusal in silence. Measured: `["src"]`
    refused a tracked mode-120000 entry at exit 2 while `["./src"]` reported clean at exit 0 over the
    same repository.
- **The optional axes are shape-checked.** `excludedPaths: ["a"]`, a plausible reading of
  "repo-relative paths", used to survive normalization, reach `.has(...)` inside enumeration, and
  take node's exit 1 from there, which the exit contract reserves for HITS FOUND.
- **The floor's dashed-SSN branch now consults `allow.ids`, in either rendering.** This is a
  correction rather than a port: with the whole-file `--allow-fixture` bypass closed, a detector
  that consults nothing leaves a developer with a hit and **no remedy at all**, and a sibling
  shipped a footer claiming the token allow-list was the only remedy that reaches a clean run while
  that was false for exactly this branch. One `ID` entry now covers both the dashed and the undashed
  rendering, so a repo does not have to guess which one a fixture uses.
- **A fatal partway through the sweep prints the hits already found BEFORE the refusal**, instead of
  discarding them. Measured on a mutant that throws after the reads: the old ordering produced a
  refusal with **zero** `HIT:` lines over a corpus containing a real hit. The refusal still wins the
  exit code and the clean line is still unreachable from there, so nothing is reported as accounted
  for that is not.
- **The hit footer is scoped to what the engine can know.** It says the cross-cutting floor consults
  the allow-list and that a repo's own detectors are answerable that way **only if** they consult
  it. The engine cannot see inside a caller's `detect`, so a wider claim would be one it has no
  evidence for.
- **A detector that throws REFUSES the scan** rather than escaping to node's own exit code, which
  this contract reserves for HITS FOUND. A misconfigured scanner throws a `TypeError` rather than
  returning a code: at the point a required axis is missing, `exitCodes` is itself the thing that
  was not supplied, so there is no trustworthy code to return.

## [0.0.1] - 2026-08-05

### Added

- First release. `isCliEntrypoint(import.meta.url)` answers "is this module the file Node was
  pointed at", for the `scripts/*.mjs` gates that must not run their CLI body when a test imports
  them for their exports.

  It replaces the raw string comparison those gates were spelling by hand,
  `` import.meta.url === `file://${resolve(process.argv[1])}` ``, which compares two strings rather
  than two paths and therefore answers `false` for three ordinary invocations: an extension-less
  specifier that Node or `tsx` resolved (`node scripts/gate` running `scripts/gate.js`), a checkout
  under a path containing a space (`import.meta.url` percent-encodes and the concatenation does
  not), and a symlinked invocation (Node resolves the main module to its real path). In each the
  gate exits 0 having checked nothing.

  Those three forms also COMBINE, and the combination is the one that hides: an extension-less
  `argv[1]` names no file, so it cannot be resolved directly, and any symlinked ancestor then puts
  the two sides in different places. `isCliEntrypoint` resolves the deepest ancestor that does
  exist and keeps the rest verbatim, so `tsx scripts/gate` answers correctly under a symlinked
  checkout.

  The package carries no runtime dependencies and no build step, because the gates that import it
  run before `pnpm install` on purpose.
