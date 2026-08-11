# Changelog

All notable changes to `@cosyte/script-utils` are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are managed with Changesets;
this file is hand-maintained (Changesets' own changelog generation is disabled). The package stays on
the **`0.0.x`-until-first-alpha** ladder.

> Because the generator is disabled, **`[Unreleased]` is promoted to a version heading BY HAND**, in
> the pull request that adds the changeset. Nothing does it automatically.

## [Unreleased]

### Changed

- **`@cosyte/script-utils/phi-scan` now carries ALL of the PHI-scan PROCESS, parameterised, so a
  consuming repo's scanner is a DECLARATIVE PARAMETER FILE.** Founder directive, 2026-08-11: "all
  updates go to script-utils to parameterize the process." Process means walking, reading,
  enumeration, the union with the bytes git carries, staged-blob handling, completeness and its
  bookkeeping, reporting, exit codes, refusals, **and the process tail**. None of it remains in a
  consumer.

  **The design rule, and it comes from a measurement.** All thirteen consuming repos derived
  against `0.0.2`, all thirteen were blocked, and every defect they found made the gate **weaker
  than declared and said nothing**: not one produced a false alarm, all produced false confidence.
  So where the engine **can tell** that a parameter was misdeclared, misparsed or is unsupported, it
  now **refuses** rather than proceeding quietly. That is not a claim every misdeclaration is
  caught: a well-typed but wrong value is not detectable here.

  **This BREAKS the `0.0.2` surface, deliberately and without a compatibility shim.** No repo had
  adopted, all thirteen were verified unadopted, and an additive surface would have preserved the
  defects. `isStagedReadable` and `isWalkReadable` are **removed** and throw a `TypeError` naming
  their replacement, rather than being silently ignored.

- **`isReadable`'s default reads EVERYTHING; the Markdown exemption is now an explicit opt-in.**
  Under `0.0.2`, `scanRoots: ["README.md"]` returned `OK: no hits` at **exit 0** over a live dashed
  identifier, because the default read filter exempted Markdown, a PHI gate reporting clean while
  opening no file, reachable by default. A tracked `.md` was read by **neither** sweeping route,
  while `README.md` and `CHANGELOG.md` ship inside the npm tarball. Six of thirteen repos measured
  that they needed the exemption gone. `exemptsMarkdown` is still exported for a repo that declares
  it deliberately, and a `shape: "file"` root **bypasses the read filter entirely**, which is what
  makes the defect unreachable by construction rather than by remembering an override.

- **`unionScope: "scanRoots" | "repository"` splits the walk from the index union.** Bounding both
  by one root set collapsed two axes: six repos walk a narrow corpus while their index half was
  already repository-wide, so a literal rename of their roots silently stopped reading tracked
  files, while two others need a narrow union because a whole-repository read hits their own
  manifest's author address and, in one case, a vendored archive whose compressed bytes decode to an
  email shape. Those were never in conflict; they are two parameters.

- **`ScanRootSpec` replaces seven live root spellings with one type:**
  `string | { rel, shape?, walk?, require? }`. `shape` is **declared and checked**, deriving it let
  a corpus root replaced by a one-line file go from refusing to clean, and `require` cannot catch
  that because the replacement _is_ read. `require` (default `true`) refuses a declared root that
  yielded no file actually read; two repos measured two silent refuse-to-clean losses it catches.
  `walk: false` keeps a path in scope for the index-keyed rules without enumerating it. **`abs` is
  not a field** and declaring one throws: in every live `{abs, rel}` pair `abs` was derivable and
  carried no information.

- **`stagedRoots` replaces the `isStagedReadable` predicate**, so the containment is a comparison of
  two declared lists at configuration time. A predicate and a root list were two independent keys
  with nothing relating them, and a staged mode-120000 entry the first admitted and the second did
  not cover was enumerated, read, had the link's target path handed to a detector as content, and
  reported clean at exit 0.

- **The clean line carries its denominators, and drops the word `OK` when it cannot earn it.** `OK`
  is a claim; the numbers are a measurement.

### Added

- **`runPhiScanCli(config)`: the process tail, shipped once.** Three tails were measured over 2,000
  hits and **all three were wrong**: `process.exit(runPhiScan(...))` delivered 86 of 2,000 hit lines
  and no summary to a reader that had not drained stderr; `process.exitCode` **hung** against an
  open, never-drained pipe _and_ turned a clean run into this contract's HITS code through an
  uncaught `EPIPE`; the same plus an `EPIPE` guard still hung. A hang in a pre-commit hook is worse
  than a truncated report. `process.exit` discharges four obligations at once, set the status,
  abandon the write queue, swallow `EPIPE`, force termination, and the exit code is computed from
  the findings **before** anything is written, so it never depended on delivery. All four are now
  restored explicitly and separately, with termination bounded by an **unref'd** timer.

- **A declarative vocabulary layer was built for `detectors` and then CUT from this slice**, and
  passing `detectors` is now a `TypeError` rather than a silent no-op. Three consecutive adversarial
  passes each found a blocker in it and each remedy grew a new one: a JSON walk dropped primitives
  inside arrays, so FHIR `HumanName.given` and `Address.line` were invisible at exit 0; delimiter
  discovery was blinded by one line of prose naming a field, and its remedy was blinded by a field
  table; declaring the delimiters instead moved three checked keys into an unchecked nested object,
  so one transposed letter blinded a whole file again. The record splitter also never covered X12,
  whose segments end with a declared character rather than a line break.

  **None of that touched the process**, which is what the founder directive is about, so the process
  ships and the vocabulary layer does not. A repo declares its field vocabulary inside `detect`,
  where its format parsing already lives. The declarative surface is its own slice, with its own
  tests and its own adversarial budget.

  The premise the layer was built on is refuted either way, and is recorded here so it is not
  re-derived: **five universal kinds with only the vocabulary differing** fails on both axes. One
  repo has no address, phone or identifier vocabulary; one declares no field vocabulary at all,
  correctly, because its corpus is code-system content rather than patient demographics; one has no
  address; one has **no date-of-birth detector**, its date tags being study and acquisition dates
  under a wall-clock-relative rule that no token set can hold. And recogniser count is per-repo
  rather than one-per-repo: one repo carries a single synthetic identity in three vocabularies that
  co-occur inside single files.

- **Reserved spaces, so a repo declares a CONVENTION instead of literals**: `nanp-fictional`,
  `ssa-never-issued`, `reserved-domain`, on the floor and on a field rule. Declaring five
  never-issued SSN literals as `ID` entries is exactly the hand-maintenance this work deletes.

- **A declared allow-list tag namespace, and an unknown tag REFUSES.** The parser had a
  `default: break`, so `ADDR`, `PHONE` and `EMAIL` were parsed, matched nothing and vanished with no
  diagnostic, five repos measured the cost as hits over values their own allow-list already
  declared synthetic. The buckets are now `names`, `dobs`, `ids`, `addresses`, `cities`, `zips`,
  `phones`, `emails`, `scopedEmails` and `emailDomains`. `EMAIL` also takes a path-scoped two-field
  form, because widening a whole domain to clear one address is a real subtraction on the
  commit-blocking route. **`DOB` is stored verbatim and compared verbatim**: one repo declares a
  deliberately truncated date pinning a partial-timestamp fixture, and any normalising
  implementation silently drops it.

- **`textViews`**, a `source-literals` view whose escape decoding is shipped here, derived
  independently by three repos, and it replaces two siblings' hand-written embedded-payload
  extractors. Strictly additive, and **the floor runs over every view**, which it did not before.
  `appliesTo` has no default, because a repo whose wire format is itself source-shaped would have
  its payload decoded, which fabricates content.

- **`ctx.partial({ bytes, reason })`**, a completeness sink against a caller-declared **closed**
  reason table. It does **not** move the exit code by default: in the one repo that needs it, a halt
  reason is reachable by a conformant file, so refusing would red-lock legal input and mask a real
  hit whenever both were present. It always removes the word `OK` from the clean line.

- **`detectorExemptPaths`** (read and accounted for, judged by nothing), it cannot fold into
  `excludedPaths`, which withdraws before the read; only the second stays inside completeness
  accounting. **`unreadablePrefixes`** as data, for vendored paths whose names carry versions.
  **`excludedPaths` declares its routes**, making a previously undeclared fixed policy explicit.
  **`vanishedUntrackedWalkTarget`**, defaulting to refusal, with tolerance requiring all three of
  its halves or none.

### Fixed

- **The named-path route followed symlinks.** `existsSync` + `statSync` both dereference, so a link
  at an in-repo path pointing at a clean file **outside** the repository reported `OK: no hits` at
  exit 0, vouching for an in-repo path over bytes git does not carry; pointed at a payload, hits
  were reported under the **link's** path. Now `lstat`, and a link named on argv is refused.

- **`--staged` omitted `--ignore-submodules=none`.** With `diff.ignoreSubmodules=all` in a user's
  git config, a staged gitlink under a scan root vanished from `--raw` and the **pre-commit gate
  reported clean**, measured 2 to 0 by two repos, one of which had already closed it by hand. A git
  config must not be able to move the commit-blocking route.

- **An unreadable path took node's exit 1, this contract's HITS code.** Seven distinct instances
  across four repos: a directory the walk cannot open, an allow-list at mode 000, an override log at
  mode 000. All are refusals now. The catch is **bare** rather than an errno allow-list, because a
  deny-list of spellings buys exactly one more evasion per round.

- **Override-log entries are now section-scoped**: a `### <path>` heading counts only under
  `## Entries`, and headings inside fenced blocks are skipped. One repo's committed log holds five
  `###` headings above its own `## Entries` section, and an unscoped reading turns all five into
  honoured bypass paths.

- **`--staged` diagnosed an unmerged path as "the index holds no file content for such an
  entry"**, which is true of a link and false here. It now has its own sentence, keyed on the `U`
  status letter.

- **A declared format that fails to parse REFUSES instead of falling back to the floor alone.** A
  sibling's shipped scanner does the latter and reports 0 hits at exit 0 over a fragmentary resource
  carrying a name, a date of birth and a street address.

- **The union's `git cat-file blob` ran at node's default 1 MiB `maxBuffer`, and the locus was
  computed after the read**, so a large tracked blob refused while naming the bare path. The locus
  is now computed first, and the bound matches the index listing's.

- **Declared subtractions are announced on every run.** An exclusion nobody sees is an exclusion
  nobody reviews, and a sibling's superseded scanner announced its exclusions where the engine
  dropped them silently.

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
