# Changelog

All notable changes to `@cosyte/script-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically.

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

- **A scan root of `"."` means the whole repository**, with gitignored directories pruned during
  descent and `.git` skipped by literal name. Pruning is exactly equivalent to filtering afterwards,
  because git cannot re-include a path under an excluded directory, and it is what makes a
  whole-repository root usable at all rather than a walk through `node_modules`.

### Changed

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
