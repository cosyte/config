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

- **The package leaves the pre-alpha version ladder for the `0.1.x` line.** No change to
  `isCliEntrypoint` and no change to the shared phi-scan engine: both subpaths export exactly what
  `0.0.2` exports, and the PHI detection rules are untouched. What moves is the version policy this
  package states about itself, and the reasoning is in
  [ADR 0002](../../documentation/decisions/0002-the-0-1-0-version-line.md). A consumer pinned at
  `^0.0.2` does not resolve this release and has to widen its range once. The parser template still
  names `@cosyte/script-utils@^0.0.2`, which this release does not widen; that is recorded as break
  candidate BC-2 in `documentation/release-0.1.0-audit.md`.

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
