#!/usr/bin/env tsx
/**
 * `{{PKG}}` PHI scanner: the CI / pre-commit half of the PHI commit-gate.
 *
 * Pure Node. Zero runtime deps. `git` is the only subprocess, always via
 * `execFileSync` with array args (never shell-form). Walks the synthetic test
 * fixtures (and a conservative text pass over `src/`) and REFUSES anything that
 * looks like real PHI, so a developer cannot commit a real-looking fixture by
 * accident.
 *
 * ===========================================================================
 * ██  STARTER: READ BEFORE YOU RELY ON THIS  ████████████████████████████████
 * ===========================================================================
 *
 *   This file is the SHARED MACHINERY only. As shipped it detects EXACTLY TWO
 *   cross-cutting PHI shapes that apply to ANY format:
 *
 *       (1) a dashed Social Security Number   (\d{3}-\d{2}-\d{4})
 *       (2) an email at a non-test domain
 *
 *   That is a FLOOR, not a gate. It does NOT understand {{TITLE}}. It will NOT
 *   catch a patient name, a date of birth, an MRN / member id, an address, or a
 *   phone number sitting in a structured {{TITLE}} field: the PHI that a real
 *   {{TITLE}} message actually carries.
 *
 *   ⚠  A scanner that silently ships SSN/email-only detection is a FALSE-
 *      CONFIDENCE RISK: it reports green on fixtures stuffed with real names and
 *      DOBs. Before you trust `pnpm phi-scan` as a safety gate for {{TITLE}},
 *      YOU MUST add structured, field-level detection for THIS standard's PHI
 *      (names, DOB, MRN / member id, address, phone) in the clearly-fenced
 *      TODO section inside `scanTarget` below.
 *
 *   Worked examples of structured, format-aware detection live in the sibling
 *   parsers: read one before you start:
 *       ../hl7/scripts/phi-scan.ts     (segment → field → component aware)
 *       ../x12/scripts/phi-scan.ts     (ISA-delimited NM1 / DMG / PER aware)
 *       ../dicom/scripts/phi-scan.ts   (binary tag-aware)
 *       ../ccda/scripts/phi-scan.ts    (XML element aware)
 *       ../ncpdp/scripts/phi-scan.ts   (fixed-field aware)
 *
 *   The mechanism for declaring genuinely-synthetic identifiers is the
 *   allow-list (`scripts/phi-allow-list.txt`): a positive declaration that a
 *   fixture's identifiers are fake. Byte-strict formats cannot carry an inline
 *   `# synthetic: true` header, so the allow-list is the proven substitute
 *   (same approach every sibling uses). IT IS THE ONLY MECHANISM THAT REACHES A
 *   CLEAN RUN. A whole-file bypass (`--allow-fixture <path>`) still exists and
 *   still needs a logged entry in `phi-scan-overrides.md`, but it is now
 *   RECORDED AND REFUSED rather than honored: see THE COMPLETENESS RULE below.
 * ===========================================================================
 *
 * Modes:
 *   --staged                 - scan only files staged in `git diff --cached`
 *   <path> [<path>...]       - scan specific paths
 *   (no args)                - scan all in-scope working-tree files
 *
 * `--allow-fixture <path>` IS A MODIFIER, NOT A MODE, and that is load-bearing
 * rather than cosmetic. A bypass is subtractive, so it must not also be the
 * thing that decides what gets scanned: this file used to let a lone
 * `--allow-fixture X` select `paths` mode over exactly `X`, which then withdrew
 * `X` and reported a clean whole run having opened nothing at all. The flag is
 * rejected unless `phi-scan-overrides.md` logs the same path, and in `paths`
 * mode it is UNCONDITIONALLY UNIONED INTO THE TARGET LIST, deduped by
 * repo-relative path, so it means the same thing in every argv.
 *
 * ===========================================================================
 * THE COMPLETENESS RULE: A TARGET THIS RUN ENUMERATED AND NEVER READ REFUSES
 * (exit 2), IN EVERY MODE, NAMING THE PATHS.
 *
 * THE DEFECT IT CLOSES, MEASURED IN THIS FILE AND NOT INHERITED AS A STORY.
 * Four argv shapes reported `[phi-scan] OK: no hits` and exit 0 over a corpus
 * carrying a live, detectable hit:
 *
 *   phi-scan README.md --allow-fixture <violator>   the violator was never
 *       ADMITTED to the run rather than withdrawn from it: the seed read
 *       `paths.length > 0 ? paths : [...allowFixtures]`, so the flag seeded the
 *       target list ONLY when no positional path was given and was a silent
 *       no-op the moment one was;
 *   phi-scan <violator> --allow-fixture <violator>  a floor of one at whole-run
 *       scope: the run's entire target list was withdrawn and the empty result
 *       reported clean;
 *   phi-scan --allow-fixture <violator>             the same floor with no
 *       positional at all, which is the worst of the four because it reads to a
 *       caller like a full-corpus sweep;
 *   phi-scan --staged --allow-fixture <violator>    the identical floor on the
 *       route a commit is actually blocked on.
 *
 * In every one of them the file was validated, checked against the override log,
 * and OPENED NEVER. A scan that did not open a file has no clean verdict to give
 * about it, so the only true thing left to say is that the scan is incomplete.
 *
 * THE COMPARISON IS A SET DIFFERENCE, NEVER A SIZE. Counting reads against
 * targets and comparing two numbers is a different and weaker test, because a
 * count counts the targets that DID get read: a plausible-looking total hides
 * exactly the paths that did not. The refusal names the paths because no number
 * can.
 *
 * ENUMERATION IS THIS RUN'S OWN DECLARATION OF WHAT IT WILL READ, so the read
 * filters upstream of it do not violate the rule and are not weakened by it: a
 * `.md` file the walk skips, a gitignored entry, and a staged path outside
 * `isStagedReadable` are never enumerated in the first place. What the rule
 * catches is a path that BECAME a target and then did not get opened.
 *
 * A BYPASS NAMING A PATH THIS RUN DOES NOT ENUMERATE ALSO REFUSES. It is the
 * other half of the same claim: such a flag subtracts nothing, so honoring it
 * silently would let a developer believe a file was acknowledged when the run
 * never had it in scope.
 *
 * WHAT THIS COSTS, STATED RATHER THAN LEFT TO BE DISCOVERED: `--allow-fixture`
 * CAN NO LONGER REACH EXIT 0 IN ANY MODE. The flag, the override log and the
 * rejection gate are all kept, so an attempt is RECORDED AND REFUSED rather than
 * silently honored, and the token-level allow-list is the mechanism that reaches
 * a clean run. THE HIT FOOTER THEREFORE DOES NOT ADVERTISE `--allow-fixture` AS
 * A REMEDY: a printed remedy that leads to exit 2 is the same defect as a
 * printed remedy that leads to a false green, with the sign flipped.
 *
 * A HIT IS NEVER SWALLOWED BY THE UNREAD REFUSAL. Hits are reported first and
 * that refusal follows, so a run that is both incomplete AND carrying hits
 * prints both. The code is 2: the incompleteness is the larger claim, and the
 * hits are already on stderr where a human reads them. IT IS A GUARANTEE ABOUT
 * THAT REFUSAL AND NOT ABOUT REFUSALS IN GENERAL, and the others are named here
 * rather than left to be assumed: the unmatched-bypass refusal fires BEFORE any
 * target is read, so no hit exists for it to swallow; and a target whose bytes
 * cannot be read refuses from INSIDE the loop, which does discard the hits found
 * before it. That last one is pre-existing and is left alone deliberately: it
 * exits 2, so it is loud rather than green, and re-ordering the loop to salvage
 * a partial hit list would be a claim about a corpus the scan just said it could
 * not account for.
 * ===========================================================================
 *
 * ===========================================================================
 * `all` MODE READS THE BYTES GIT CARRIES AS A UNION WITH THE WALK. This
 * paragraph is the ONE authoritative statement of that rule.
 *
 * The walk answers "what is on disk under the scan roots". That is not the same
 * question as "what does this repository carry", and where the two disagree the
 * walk was the only voice, so the sweep reported `OK: no hits` at exit 0 over
 * tracked bytes it never opened. THREE SUCH STATES WERE REPRODUCED AGAINST THIS
 * FILE'S OWN PRE-UNION SHAPE, each over a tracked file carrying a live,
 * detectable hit (`cosyte/config`'s `test/phi-scan-scaffold.test.ts` pins each
 * one, and reproduces it on a weakened copy of the shipped scanner):
 *
 *   1. THE PATH IS OCCUPIED BY A DIRECTORY. `git ls-files` still names the
 *      path, `Dirent.isFile()` is false for the directory, the walk descends
 *      into it and scans whatever is inside. The tracked blob is never read.
 *      This is the decoy-contents shape, and a path-SET reconciliation does not
 *      see it either, because the path IS present: only reading the OBJECT
 *      closes it.
 *   2. THE WORKING TREE IS SHORT. A tracked fixture deleted from the working
 *      tree (not from the index) is enumerated by nothing, and a sweep that
 *      still finds other files has no count that can notice.
 *   3. THE TWO COPIES DIFFER. A tracked blob carrying a hit, with a clean file
 *      of the same name on disk, read clean: the walk answers with the disk
 *      copy and nothing asked git what it was carrying.
 *
 * WHAT THE UNION IS. `git ls-files -s -z` is read for the whole index, and for
 * every IN-SCOPE tracked path whose bytes the walk did not already read, the
 * STAGE-0 BLOB is scanned through `git cat-file blob <sha>`. It is a union and
 * never a replacement: the walk still runs first and still reaches UNTRACKED
 * files, which git cannot name at all. Widening makes it narrower, not worse.
 *
 * WHY `cat-file blob` AND NOT A RE-READ OF THE PATH. Re-reading the path is
 * exactly what the walk already did, and state 1 is the case where the path
 * resolves to something else entirely. `cat-file blob` names the OBJECT, so the
 * bytes are the ones git carries whatever the working tree currently says.
 *
 * DEDUPLICATION IS BY CONTENT, NOT BY PATH, AND THAT IS THE EOL AXIS. A walk
 * target is skipped by the union only when the bytes it read hash to the index
 * entry's own object id, so on a clean checkout the union adds ZERO reads and
 * NEVER INVOKES `git cat-file`. BE EXACT ABOUT THE FIXED COST RATHER THAN
 * SAYING "no subprocess": it adds ONE `git rev-parse --show-object-format` per
 * `all`-mode run, always, because the deduplication needs the algorithm before
 * it can compare anything. Where the two copies of a path DIFFER, BOTH are
 * scanned. That is what makes this correct under EOL normalization rather than
 * merely untested by it: with a `text` attribute or `core.autocrlf` the index
 * carries LF and the working tree CRLF, the ids differ, and both forms are read
 * instead of one being assumed to stand for the other.
 *
 * A HIT FROM THE UNION IS LABELLED `(as git carries it)`, and the label is on
 * the REPORTED LOCUS ONLY. A hit that named the bare path would send a
 * developer to open a file that is clean, or not there at all. The target's
 * `path` stays undecorated because every filter, exclusion and completeness
 * tier is keyed on it.
 *
 * A NON-BLOB INDEX MODE UNDER A SCAN ROOT REFUSES (exit 2), the same rule and
 * the same reason as the `--staged` route: `120000` is a symbolic link, whose
 * blob is its TARGET PATH and not any content, and `160000` is a gitlink, which
 * carries a commit id and no bytes at this path at all. Neither can be scanned,
 * so neither may be reported clean.
 *
 * `all` MODE REFUSES WHEN GIT CANNOT NAME THE INDEX, OR NAMES IT EMPTY. Without
 * the index the union cannot run and the sweep is back to being the walk's word
 * alone, which is the state this whole rule exists to end. AN EMPTY ANSWER
 * COUNTS AS NO ANSWER, and be exact about WHICH states answer that way, because
 * the two halves arrive through DIFFERENT branches and a reader who merges them
 * will delete the wrong one. MEASURED ON git 2.39.5:
 *
 *   - a directory that is no repository at all FATALS (`fatal: not a git
 *     repository`, exit 128). It is the `catch` that turns that into `null`, so
 *     that handler is load-bearing rather than defensive: without it the throw
 *     escapes and the run takes node's own exit 1, which this contract reserves
 *     for HITS FOUND;
 *   - a repository whose index is empty, and a directory INSIDE a repository
 *     with nothing tracked under it, both print nothing and exit 0. That is
 *     what the size check is for, and an empty map would make every tracked
 *     path untracked, which is the one state in which the union silently stops
 *     existing.
 *
 * A SCAFFOLDED PARSER MUST THEREFORE
 * `git init` AND COMMIT BEFORE `pnpm phi-scan` MEANS ANYTHING, which is a
 * one-line cost stated here rather than discovered.
 *
 * THE OTHER TWO ROUTES ARE UNCHANGED, AND THAT IS DERIVED RATHER THAN
 * INHERITED. `--staged` already reads stage-0 blobs (`git show :<path>`) for
 * exactly the records a commit carries, so it already reads the bytes git
 * carries; widening its SCOPE is a hook decision about what a commit is blocked
 * on, not this one. `paths` is bounded by an argv a human typed. Neither is a
 * sweep.
 *
 * RESIDUALS, DISCLOSED RATHER THAN CLOSED:
 *
 *   - `git cat-file blob` runs through `execFileSync`, whose `maxBuffer`
 *     defaults to 1 MiB, so a tracked blob larger than that fails the read and
 *     REFUSES (exit 2) rather than reporting a truncated scan clean. Identical
 *     bound, and identical trade, to the `git show` call `--staged` makes.
 *   - The union is keyed on STAGE 0, and an unmerged path has none, so it is
 *     refused under its OWN sentence rather than under the mode rule. Be exact
 *     about why it needs one: `ls-files -s` reports such a path only at stages
 *     1, 2 and/or 3, its records carry ORDINARY BLOB MODES, and so the mode
 *     rule cannot see it. `--staged` distinguishes the same state from
 *     `--raw`'s status `U` and a destination mode of `000000`, which is a
 *     DIFFERENT signal from a different command: the axis is re-derived here
 *     rather than ported, and a sibling's draft that ported it scanned the
 *     MERGE BASE and labelled it as the bytes git carries.
 *   - The union inherits the walk's READ filter (`isWalkReadable`) and its
 *     exclusions, so a tracked `.md` is still not read by either sweeping
 *     route. That is one boundary rather than two, and moving it is an AXIS 2
 *     decision.
 * ===========================================================================
 *
 * ===========================================================================
 * EXIT CONTRACT, DEFINED HERE AND NOT INHERITED. A scaffolded parser has no
 * history, so this template STATES its contract rather than acquiring one by
 * accident:
 *
 *   0  the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
 *   1  HITS. Reserved for "this corpus contains something that looks like PHI",
 *      and nothing this file RAISES ever takes it. It is NOT exclusive, and the
 *      escape is named below rather than left to be discovered.
 *   2  EVERY STATE THIS FILE RAISES IN WHICH THE SCAN CANNOT ACCOUNT FOR
 *      SOMETHING: a bad argument, a MISSING allow-list, an unlogged bypass, a
 *      bypass naming a path this run does not enumerate, an in-scope entry that
 *      is not a regular file, an unparseable `git diff --cached` record, an
 *      index git cannot name or names empty, an in-scope index entry that is
 *      not a regular blob, an in-scope path with no stage-0 blob (unmerged), a
 *      target whose bytes cannot be read, and a target enumerated but never
 *      read.
 *
 * THE THREE CODES ARE `EXIT_CLEAN` / `EXIT_HITS` / `EXIT_REFUSE` IN THE AXES
 * BLOCK BELOW, which is AXIS 1: a port changes a number there, once, and
 * rewrites this table beside it.
 *
 * 1 IS RESERVED BECAUSE CI AND THE PRE-COMMIT HOOK BRANCH ON THE CODE. A caller
 * must be able to tell "PHI was found here" from "this scan is not trustworthy":
 * those need different human responses, and collapsing them makes the second
 * read as the first.
 *
 * ONE SUCH STATE, MEASURED HERE AND NOT CLOSED: an allow-list that EXISTS but
 * cannot be READ (a directory at that path, or mode 000) makes `readFileSync`
 * throw a plain `Error`, which is rethrown rather than handled, and the run
 * takes node's own exit 1 with a stack. A caller reads that as "hits found".
 * `loadOverrideLog()` HAS THE IDENTICAL SHAPE and is named rather than left for
 * the next reader to rediscover: an unreadable `phi-scan-overrides.md` escapes
 * the same way. NO EXHAUSTIVE CLAIM IS MADE ABOUT THIS SET, which is why the
 * table says 1 is reserved but NOT exclusive.
 *
 * Both are pre-existing, and both are deliberately NOT fixed by widening a catch
 * or by enumerating `EACCES`/`EISDIR` (see the paragraph below on why a
 * deny-list of spellings buys one more evasion per round). The table above
 * therefore says MISSING rather than "missing or unreadable". A contract that
 * claimed the state it cannot deliver would be worse than the gap it papers
 * over, because the next reader would branch on it.
 *
 * DO NOT PORT THIS TABLE INTO, OR OUT OF, A SIBLING PARSER. The `@cosyte/*`
 * scanners do not agree on it and are not required to: at least one sibling uses
 * 2 for a state another uses 1 for, and at least one chose 2 precisely because 1
 * was already taken in that repo. Carrying a number across a repo boundary is
 * how a caller ends up branching on a meaning that repo never assigned. Derive
 * the contract from the repo you are in and write the derivation down beside the
 * table, which is what this block is.
 * ===========================================================================
 *
 * EVERY `InvocationError` TAKES 2, INCLUDING THE ONE RAISED BEFORE THE SCAN
 * BEGINS. `loadAllowList()` used to be called OUTSIDE `main`'s handler, so a run
 * that cannot find `scripts/phi-allow-list.txt` threw an uncaught
 * `InvocationError` and took node's own exit 1. That is the code this contract
 * reserves for HITS FOUND, so a caller that branches on the code, and CI is one,
 * read "this corpus contains PHI" from a run that never opened a file. The
 * template ships an allow-list and the scaffolder copies it, so the live trigger
 * is not a fresh scaffold: it is the scanner invoked from the wrong working
 * directory, since `REPO_ROOT` is `process.cwd()`. Every error this file RAISES
 * is an `InvocationError`, and every site that raises one now sits inside a
 * handler in `main`. (The three `throw err` statements are RETHROWS, not raises:
 * each fires only for a value the `instanceof` check above it has already
 * declined.)
 *
 * THAT IS NOT THE SAME AS "NOTHING REACHES NODE'S DEFAULT", AND THE WIDER CLAIM
 * IS NOT MADE. An allow-list that EXISTS but cannot be read (a directory at that
 * path, or mode 000) makes `readFileSync` throw a plain `Error`, which the
 * handler wrapping it rethrows, and the run still takes exit 1. That is unchanged from before
 * this file's handler moved and it is deliberately not "fixed" by widening the
 * catch to swallow any error, or by enumerating `EACCES`/`EISDIR`: this file
 * retired exactly that shape on the argument side of the `attw` gate, where a
 * deny-list of spellings bought one more evasion per round. If it is worth
 * closing it wants a structural answer, and it wants its own slice.
 *
 * ===========================================================================
 * AN IN-SCOPE ENTRY THAT IS NOT A REGULAR FILE REFUSES THE SCAN (exit 2). It is
 * never silently skipped, because BOTH enumerating routes are blind to it in a
 * way that reads as clean:
 *
 *   - the walk enumerates `Dirent.isFile()`, which is an lstat answer, so a
 *     symbolic link is neither a file nor a directory and used to fall out of
 *     the loop silently, whatever it pointed at (`isDirectory()` is false for a
 *     linked directory too, so a whole subtree vanished the same way);
 *   - `--staged` reads content with `git show :<path>`, and git stores a
 *     symbolic link as its TARGET PATH under mode 120000, so that route is
 *     handed the path text and never the target's bytes.
 *
 * So a link under a scan root pointing at a PHI-bearing file scanned CLEAN on
 * both. Neither route is made to follow it: following would read bytes the
 * enumeration does not control (outside the repo, a loop, a device, a FIFO that
 * blocks the gate forever), and git does not carry those bytes anyway, so a hit
 * on them would be a claim about something no commit contains. Refusing states
 * the only true thing available: there is an entry here the scan cannot account
 * for, so the scan is not clean.
 *
 * THERE ARE TWO SCOPE PREDICATES, NOT ONE, AND COLLAPSING THEM REOPENS THE HOLE.
 * `isUnderScanRoot` decides whether an entry is the scan's BUSINESS; the read
 * filters (the `.md` exemption in the walk, the `.ts` suffix on `src/` in
 * `--staged`) decide whether a REGULAR FILE's bytes get read. Every non-regular
 * check keys on the FIRST. Two sibling ports independently shipped the single
 * shared predicate and both had the routes disagree about the same entry: a
 * `.md`-named link fell out through the read filter on one route while the other
 * refused it. A link's NAME is no evidence at all about what is on the other
 * side of it, which is exactly what a read filter is entitled to assume about a
 * file and is not entitled to assume about a link.
 *
 * A refusal names the entry's own repo-relative path and an engine-owned token
 * for its kind. IT NEVER REPORTS THE LINK TARGET, which is text off the working
 * tree and can itself carry PHI: a target path of the shape
 * `../patients/<surname>-<given>-<dob>.txt` is the whole reason. The shape is
 * written out rather than an example, because a diagnostic ABOUT a PHI leak is
 * itself a PHI surface, and that applies to the prose explaining it too.
 *
 * WHAT THIS DOES NOT CLAIM, each stated rather than left to be read
 * charitably. Explicit-path mode still reads THROUGH a link (`statSync` and
 * `readFileSync` both follow, and a human naming one path is asking for that
 * file); the walk's gitignore exemption applies to a link exactly as it applies
 * to a file, so the two get one boundary rather than links getting a second,
 * stricter one; `--staged` applies no gitignore exemption, and does not need
 * one, because `git check-ignore` is index-aware and a staged path is therefore
 * never reported ignored.
 *
 * A SCAN ROOT REPLACED BY A LINK IS ITS OWN CASE, AND IT SPLITS ON WHETHER THE
 * LINK IS TRACKED. Both halves are measured, on a scaffolded repo, because two
 * drafts of this paragraph asserted a shape the tree does not have:
 *
 *   - TRACKED: BOTH routes refuse (exit 2). `all` mode meets a mode-120000
 *     INDEX ENTRY and refuses under the index rule; `--staged` meets the same
 *     mode in a `--raw` record and refuses under its own. Different sentences,
 *     same answer.
 *   - UNTRACKED: there is no index entry at all, so `--staged` has nothing to
 *     refuse and legitimately reports a clean commit; the walk FOLLOWS the link
 *     (`existsSync`/`readdirSync` both follow) and scans the target directory,
 *     reporting any hit it finds there under the in-repo path. THAT ASYMMETRY
 *     IS NOT A HOLE, because an untracked link commits nothing at that path:
 *     `--staged` grades what a commit carries, and a commit carries none of it.
 *
 * The walk itself is unchanged by any of this, which is what the narrowing was
 * ever about; what got stricter is the index the sweep now also reads.
 * ===========================================================================
 */

import { readFileSync, statSync, existsSync, readdirSync, type Dirent } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

// ===========================================================================
// ██  THE FIVE PER-REPO AXES  ███████████████████████████████████████████████
// ===========================================================================
//
// A PORT IS NOT A COPY. Five things genuinely differ between the sibling
// `@cosyte/*` scanners, and every one of them is DECLARED IN THIS BLOCK so a
// port re-derives them HERE rather than by editing the machinery below:
//
//   1. EXIT CODES        `EXIT_CLEAN` / `EXIT_HITS` / `EXIT_REFUSE`.
//   2. ROOTS+EXCLUSIONS  `SCAN_ROOTS`, `EXCLUDED_PATHS`, `isWalkReadable`.
//   3. `--staged` SCOPE  `isStagedReadable`.
//   4. GITLINKS          `REGULAR_BLOB_MODES` + `gitModeKind` (further down,
//                        beside the two routes that read a git mode).
//   5. EOL NORMALIZATION `gitObjectHash` + `blobOid`: the index/working-tree
//                        deduplication is BY CONTENT, so a repo whose index
//                        carries LF and whose working tree carries CRLF scans
//                        BOTH forms rather than assuming one stands for the
//                        other. Nothing to set; it is listed because it is one
//                        of the five and a port must check it, not skip it.
//
// The machinery under this block is SHARED and is not the place to express a
// per-repo decision. What IS per-repo below it is the STANDARD-SPECIFIC FIELD
// DETECTION, and it has its own fenced TODO section inside `scanTarget`.
// ===========================================================================

/**
 * AXIS 1: THE EXIT CONTRACT, as three names rather than three literals. The
 * meanings are stated in the EXIT CONTRACT block in the header; a port that
 * changes a number changes it here, once, and the header block beside it.
 *
 * DO NOT PORT THESE NUMBERS INTO, OR OUT OF, A SIBLING. The siblings do not
 * agree on them: at least one uses 2 where another uses 1.
 */
const EXIT_CLEAN = 0;
const EXIT_HITS = 1;
const EXIT_REFUSE = 2;

/**
 * AXIS 2: the roots walked in `all` mode, repo-relative and forward-slashed.
 * `test/fixtures` gets the full scan; `src` gets the same conservative shape
 * pass because it is hand-written code, not data, and a JSDoc `@example`
 * snippet must not carry real PHI either.
 *
 * A ROOT IS A SCOPE DECISION AND IT IS THE AXIS MOST LIKELY TO BE WRONG IN A
 * PORT. A sibling that widened its walk to the whole repository found tracked
 * files that had never been opened by either route. Widen deliberately, and
 * measure what the widening newly reads rather than assuming it reads nothing.
 */
const SCAN_ROOTS: readonly string[] = ["test/fixtures", "src"];

/**
 * AXIS 2 (the subtractive half): repo-relative paths NO route reads: not the
 * walk, not the index union, not `--staged`.
 *
 * 🛑 EXCLUDE A LITERAL PATH, NEVER A CLASS. It is tempting to write a predicate
 * ("skip binary blobs", "skip generated files") because it needs no
 * maintenance. A sibling measured what that costs: two of its hand-written
 * sources embed NUL bytes as HMAC domain separators, so git's own binary
 * heuristic calls them binary and a "binary blob" predicate would have dropped
 * them out of the corpus silently. A literal path is reviewable in a diff; a
 * class quietly grows new members.
 *
 * Ships EMPTY. An entry here is a file the scan has NO verdict about, so each
 * one wants a comment saying why.
 */
const EXCLUDED_PATHS: ReadonlySet<string> = new Set<string>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hit {
  path: string;
  segment: string; // locator (e.g. "(ssn)" / "(email)" or your field id)
  value: string;
  reason: string;
}

interface AllowList {
  /**
   * Uppercase synthetic person-name tokens. UNUSED by the starter floor: the
   * structured name detector you add in the TODO section consumes these.
   */
  names: Set<string>;
  /**
   * Synthetic dates of birth (raw, format-normalized as you choose). UNUSED by
   * the starter floor: your structured DOB detector consumes these.
   */
  dobs: Set<string>;
  /**
   * Synthetic id values (SSN / MRN / member-id shapes). UNUSED by the starter
   * floor: your structured id detector consumes these.
   */
  ids: Set<string>;
  /** Allowed email domains (anything else is a hit). Used by the starter floor. */
  emailDomains: Set<string>;
}

interface Args {
  mode: "all" | "staged" | "paths";
  paths: string[];
  allowFixtures: string[];
}

class InvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvocationError";
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  let staged = false;
  const paths: string[] = [];
  const allowFixtures: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j += 1) {
        const v = argv[j];
        if (v !== undefined) paths.push(v);
      }
      break;
    } else if (a === "--staged") {
      staged = true;
      i += 1;
    } else if (a === "--allow-fixture") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new InvocationError("--allow-fixture requires a path argument");
      }
      allowFixtures.push(next);
      i += 2;
    } else if (a !== undefined && a.startsWith("--")) {
      throw new InvocationError(`Unknown flag: ${a}`);
    } else if (a !== undefined) {
      paths.push(a);
      i += 1;
    } else {
      i += 1;
    }
  }

  if (staged && paths.length > 0) {
    throw new InvocationError("--staged cannot be combined with positional paths");
  }

  // THE MODE IS CHOSEN BY POSITIONAL PATHS ALONE. A bypass is subtractive, so
  // letting one select the mode made `--allow-fixture X` scan exactly `X`, then
  // withdraw it, then report a clean whole run over a corpus it never touched.
  // With the mode decided here, a lone bypass leaves the run in `all` mode and
  // the two refusal tiers in `main` account for the flag.
  let mode: Args["mode"];
  if (staged) {
    mode = "staged";
  } else if (paths.length > 0) {
    mode = "paths";
  } else {
    mode = "all";
  }

  // UNCONDITIONAL, DEDUPED SEEDING, so the flag has ONE meaning in every argv.
  // The old form was `paths.length > 0 ? paths : [...allowFixtures]`, which
  // seeded the target list ONLY when no positional path was given: with one
  // present the bypass was a silent no-op and the named file was never ADMITTED
  // to the run rather than withdrawn from it. Unioning admits it in every case,
  // so the withdrawal below is always a withdrawal of something enumerated and
  // is therefore always caught by the completeness rule. Dedupe is by
  // repo-relative path, so `X --allow-fixture ./X` is one target, not two.
  const scanPaths = mode === "paths" ? dedupeByRepoPath([...paths, ...allowFixtures]) : paths;

  return { mode, paths: scanPaths, allowFixtures };
}

/**
 * Dedupe argument paths by the repo-relative path each one resolves to, keeping
 * the caller's original spelling for the first occurrence (that spelling is what
 * `buildTargetsForPaths` resolves and what a diagnostic echoes back).
 */
function dedupeByRepoPath(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = normalizePath(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Allow-list + override log
// ---------------------------------------------------------------------------

function loadAllowList(): AllowList {
  if (!existsSync(ALLOW_LIST_PATH)) {
    throw new InvocationError(`allow-list not found at ${ALLOW_LIST_PATH}`);
  }
  const raw = readFileSync(ALLOW_LIST_PATH, "utf8");
  const names = new Set<string>();
  const dobs = new Set<string>();
  const ids = new Set<string>();
  const emailDomains = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const tag = line.slice(0, sp);
    const value = line.slice(sp + 1).trim();
    if (value.length === 0) continue;
    switch (tag) {
      case "NAME":
        names.add(value.toUpperCase());
        break;
      case "DOB":
        dobs.add(value);
        break;
      case "ID":
        ids.add(value.toUpperCase());
        break;
      case "EMAILDOMAIN":
        emailDomains.add(value.toLowerCase());
        break;
      default:
        break;
    }
  }
  return { names, dobs, ids, emailDomains };
}

function normalizePath(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  return rel.split(sep).join("/");
}

function loadOverrideLog(): Set<string> {
  if (!existsSync(OVERRIDE_LOG_PATH)) return new Set();
  const raw = readFileSync(OVERRIDE_LOG_PATH, "utf8");
  const out = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(lineRaw);
    if (m && m[1] !== undefined) out.add(normalizePath(m[1]));
  }
  return out;
}

function validateAllowFixtures(allowFixtures: string[]): void {
  if (allowFixtures.length === 0) return;
  const overrides = loadOverrideLog();
  const missing = allowFixtures.map(normalizePath).filter((p) => !overrides.has(p));
  if (missing.length > 0) {
    const lines = missing.map((p) => `  - ${p}`).join("\n");
    throw new InvocationError(
      `--allow-fixture rejected: no matching entry in phi-scan-overrides.md for:\n${lines}\n` +
        `Add a "### <path>" subsection to phi-scan-overrides.md and commit it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

interface Target {
  path: string; // forward-slash repo-relative path for reporting
  read: () => Buffer;
  /**
   * Where these bytes came from, when it is not simply the file at `path`. Set
   * only by the index union, and it decorates the REPORTED LOCUS ONLY: a hit in
   * a tracked blob whose working-tree copy differs (or is not there) must not
   * read as a hit in the file on disk, which a developer would open and find
   * clean.
   *
   * `path` itself stays undecorated, because the read filters, the exclusions,
   * the dedupe and both completeness tiers are all keyed on it: decorating it
   * would silently re-scope a target rather than re-label it.
   */
  origin?: string;
}

/**
 * An entry the enumeration reached but cannot scan. Both fields are safe to
 * print: `path` is the entry's own repo-relative path (the same locus every hit
 * already carries) and `kind` is a token from the closed set below. Nothing off
 * the other side of a link is ever recorded here.
 */
interface Unscannable {
  path: string;
  kind: string;
}

/** Closed-set, engine-owned description of a directory entry's kind. */
function direntKind(e: Dirent): string {
  if (e.isSymbolicLink()) return "a symbolic link";
  if (e.isFIFO()) return "a FIFO";
  if (e.isSocket()) return "a socket";
  if (e.isBlockDevice()) return "a block device";
  if (e.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * AXIS 2: the ROOT half of scope: is this entry the scan's business at all?
 * This is the predicate every non-regular and non-blob check keys on, and it is
 * deliberately NOT the predicate that decides what gets READ. See the
 * two-predicate note in the header. The bare root names are in scope because
 * git records no index entry for a directory, so `test/fixtures` appearing as
 * an index entry can only mean the corpus root itself has been replaced by a
 * blob or a link.
 */
function isUnderScanRoot(relPath: string): boolean {
  return SCAN_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

/**
 * AXIS 2: the READ half of scope for the two SWEEPING routes (the walk and the
 * index union it is a union with). Markdown is documentation, not fixture data,
 * and may legitimately describe a violator value.
 *
 * THE TWO SWEEPING ROUTES SHARE THIS PREDICATE ON PURPOSE. The union exists to
 * read the bytes git carries at a path the walk did not read; it is the SAME
 * route by another door, so it inherits the same read filter. Giving the union
 * its own, wider filter would make `all` mode's verdict depend on which copy of
 * a file it happened to reach.
 */
function isWalkReadable(relPath: string): boolean {
  return !relPath.toLowerCase().endsWith(".md");
}

/**
 * AXIS 3: the READ half of scope for `--staged`: which regular blobs get their
 * bytes scanned. Narrower than `isUnderScanRoot` and unchanged by the
 * non-regular work, so the containment `isStagedReadable` implies
 * `isUnderScanRoot` holds: that containment is what guarantees a non-regular
 * entry is refused before it could ever be read.
 *
 * 🛑 WIDENING THIS IS A HOOK DECISION, NOT A SWEEP DECISION, and it has been
 * declined in a sibling three times for that reason: it changes what a COMMIT
 * is blocked on. Widen `all` mode first (that is the sweep), and treat this as
 * its own change with its own argument.
 */
function isStagedReadable(relPath: string): boolean {
  return (
    relPath.startsWith("test/fixtures/") || (relPath.startsWith("src/") && relPath.endsWith(".ts"))
  );
}

/**
 * Enumerate a scan root. `Dirent`'s predicates are lstat answers and are not
 * exhaustive: an entry that is neither a directory nor a regular file is
 * collected into `unscannable` rather than dropped, so the caller can refuse
 * instead of reporting clean over it.
 */
function walk(dir: string, out: string[], unscannable: Unscannable[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out, unscannable);
    } else if (e.isFile()) {
      // README/markdown docs may legitimately describe violator values; they
      // are documentation, not fixtures. This is a READ filter, and the branch
      // below is deliberately not subject to it.
      if (!isWalkReadable(normalizePath(full))) continue;
      out.push(full);
    } else {
      // Deliberately NOT subject to the `.md` exemption above. That exemption is
      // a judgement about a file whose bytes the walk could have read; a link's
      // name is no evidence at all about what is on the other side.
      unscannable.push({ path: normalizePath(full), kind: direntKind(e) });
    }
  }
}

/**
 * Refuse (exit 2) over entries the enumeration reached and cannot scan. EVERY
 * offender IN THE GROUP is named, not just the first: a developer who has to
 * re-run the gate once per link learns to distrust it. Each call is one group
 * and the first group that fires throws, so a tree with offenders in more than
 * one group names them a group per run. WRITE NO COUNT OF THE GROUPS HERE.
 *
 * `noun` is overridable because the refusal must say something TRUE about what
 * it refused: an unmerged path is not a non-regular file, it is a path with no
 * single blob, and reporting it as the former sends a developer looking for a
 * symbolic link that is not there.
 */
function refuseUnscannable(
  entries: Unscannable[],
  why: string,
  remedy: string,
  noun: { one: string; many: string } = {
    one: "entry is not a regular file",
    many: "entries are not regular files",
  },
): void {
  if (entries.length === 0) return;
  const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
  const phrase = entries.length === 1 ? noun.one : noun.many;
  throw new InvocationError(
    `refusing the scan: ${String(entries.length)} ${phrase}:\n${lines}\n${why} ${remedy}`,
  );
}

function gitIgnored(paths: string[]): Set<string> {
  const ignored = new Set<string>();
  if (paths.length === 0) return ignored;
  try {
    // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding.
    // `encoding: "buffer"` with `input` is rejected by Node.
    const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      input: paths.map(normalizePath).join("\0"),
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const p of out.toString("utf8").split("\0")) {
      if (p.length > 0) ignored.add(p);
    }
  } catch {
    // `git check-ignore` exits 1 when nothing matches: treat as none ignored.
  }
  return ignored;
}

// ---------------------------------------------------------------------------
// AXIS 4: gitlinks, and every other index mode that is not a file to read.
// Both git-reading routes (`--staged` and `all` mode's union half) key on these.
// ---------------------------------------------------------------------------

/** git's file modes for a regular blob. Every other mode is not a file to read. */
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/** Closed-set, engine-owned description of a git file mode. */
function gitModeKind(mode: string): string {
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
}

/** A stage-0 index entry: the mode git records, and the object it points at. */
interface IndexEntry {
  mode: string;
  oid: string;
}

/**
 * Every stage-0 index entry keyed by repo-relative path, plus the paths that
 * have a record but NO stage-0 record, or `null` when git could not answer.
 *
 * AN EMPTY ANSWER COUNTS AS NO ANSWER. `git ls-files` exits 0 printing nothing
 * for a repository whose index is empty, and for a directory INSIDE a
 * repository with nothing tracked under it; an empty map would make every file
 * untracked, which is the one state in which the union silently stops existing.
 * A directory that is NO repository at all is a different branch and does not
 * arrive here as an empty list at all: it FATALS (exit 128) and the `catch`
 * below is what turns it into `null`. Both reach the same refusal, and BOTH
 * ROUTES ARE NEEDED. Measured on git 2.39.5.
 *
 * `-s` carries the MODE, which is the only thing that distinguishes a regular
 * blob from a symbolic link or a gitlink, and the OBJECT ID, which is what makes
 * the union's content deduplication exact.
 *
 * 🛑 THE STAGE DIGIT IS READ, AND KEYING ON IT IS NOT OPTIONAL. THE RULE IS THE
 * ABSENCE OF STAGE 0. Do NOT re-derive it from a record count or from a mode,
 * and do NOT port it from the `--staged` route: that route spots an unmerged
 * path from `--raw`'s status `U` and a destination mode of `000000`, and
 * NOTHING IN `ls-files -s` LOOKS LIKE THAT. An unmerged path is reported here
 * only at stages 1, 2 and/or 3, with ORDINARY BLOB MODES, so the mode rule
 * cannot see it. A sibling's draft took the FIRST record per path and never
 * looked at the stage: it scanned STAGE 1, THE MERGE BASE, labelled it as the
 * bytes git carries, and printed a clean line over a marker living only in
 * stage 3.
 */
function gitIndexEntries(): { entries: Map<string, IndexEntry>; unmerged: string[] } | null {
  let out: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell. `-z` is NUL-separated and
    // unquoted, so it matches the walk's forward-slash relative paths exactly.
    // `maxBuffer` is raised because a TRUNCATED list is a SHORT list, and a
    // short list is the unscanned corpus this whole rule is about. Node throws
    // `ENOBUFS` rather than truncating, so the bound refuses either way; the
    // headroom keeps a legitimate repo from paying an opaque refusal for it.
    out = execFileSync("git", ["ls-files", "-s", "-z"], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const entries = new Map<string, IndexEntry>();
  const higherStages = new Set<string>();
  for (const rec of out.toString("utf8").split("\0")) {
    if (rec.length === 0) continue;
    // `<mode> <oid> <stage>\t<path>`; a path may contain anything but NUL.
    const m = /^(\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(rec);
    const mode = m?.[1];
    const oid = m?.[2];
    const stage = m?.[3];
    const path = m?.[4];
    if (mode === undefined || oid === undefined || stage === undefined || path === undefined) {
      // An unparseable record means the list may be SHORT in a way we cannot
      // see, which is the one thing this sweep must never scan past.
      return null;
    }
    if (stage === "0") entries.set(path, { mode, oid });
    else higherStages.add(path);
  }
  // A path is unmerged when it has a record and none of them is stage 0. The set
  // difference is taken rather than assuming the two are disjoint: relying on
  // that without saying so is how an assumption becomes a silent short list.
  const unmerged = [...higherStages].filter((p) => !entries.has(p));
  if (entries.size === 0 && unmerged.length === 0) return null;
  return { entries, unmerged };
}

/**
 * AXIS 5: the repository's object format as a Node hash name, or `null` when
 * git says something we do not recognise. `null` disables the union's content
 * deduplication, which scans MORE, never less.
 *
 * WHEN GIT WILL NOT SAY AT ALL THE ANSWER IS `sha1`, NOT `null`, and the two
 * cases are stated apart because an auditor asking "can this silently assume
 * sha1 in a sha256 repository" deserves the right first answer. A git too old
 * to know `--show-object-format` predates sha256 repositories entirely, so the
 * fallback is a derivation rather than a guess; an answer we do not recognise
 * is a git NEWER than this file, and there the honest move is to stop
 * deduplicating.
 */
function gitObjectHash(): string | null {
  let answer: string;
  try {
    // SECURITY: array-form execFileSync, no shell.
    answer = execFileSync("git", ["rev-parse", "--show-object-format"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
  } catch {
    return "sha1";
  }
  if (answer === "sha1") return "sha1";
  if (answer === "sha256") return "sha256";
  return null;
}

/**
 * AXIS 5: the object id git would record for these bytes, under its own
 * `blob <len>\0` framing. Used only to answer "did the walk already read
 * EXACTLY the bytes the index carries here", so a wrong answer can only ever
 * cost a second scan of the same content.
 *
 * THIS IS THE EOL AXIS. Where a `text` attribute or `core.autocrlf` makes the
 * index carry LF and the working tree CRLF, the two ids differ and BOTH copies
 * are scanned, rather than one being assumed to stand for the other.
 */
function blobOid(algorithm: string, bytes: Buffer): string | null {
  try {
    return createHash(algorithm)
      .update(`blob ${String(bytes.length)}\0`)
      .update(bytes)
      .digest("hex");
  } catch {
    return null;
  }
}

/**
 * `all` mode's enumeration: the walk, PLUS the in-scope index the union half
 * reads. See THE UNION block in the header for what it closes and what it costs.
 */
function buildTargetsForAll(): { targets: Target[]; index: Map<string, IndexEntry> } {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, ...root.split("/")), files, unscannable);

  // One `git check-ignore` over both lists. An ignored entry is already out of
  // scope for the file route, so applying the same rule to a link keeps a single
  // boundary rather than inventing a second, stricter one for links alone. Note
  // `git check-ignore` is index-aware, so `git add -f` on an ignored link does
  // not buy a bypass: once tracked it is no longer reported ignored.
  const ignored = gitIgnored([...files.map(normalizePath), ...unscannable.map((u) => u.path)]);

  refuseUnscannable(
    unscannable.filter((u) => !ignored.has(u.path) && !EXCLUDED_PATHS.has(u.path)),
    "The walk can neither read such an entry nor vouch for what is on the other side of it.",
    "Remove it, replace it with a regular file, or (if it is genuinely not part of the " +
      "corpus) untrack it and add it to .gitignore.",
  );

  const listed = gitIndexEntries();
  if (listed === null) {
    throw new InvocationError(
      "refusing the sweep: git could not name this repository's index, or named it empty, so the " +
        "sweep would be the working-tree walk's word alone and could report clean over tracked " +
        "bytes it never opened. Run it inside a git repository with a readable index.",
    );
  }

  // Unmerged first, and under its OWN sentence: an unmerged path is not a link
  // and not a gitlink, and reporting it as one sends a developer looking for
  // something that is not there.
  refuseUnscannable(
    listed.unmerged
      .filter((p) => isUnderScanRoot(p) && !EXCLUDED_PATHS.has(p))
      .map((p) => ({ path: p, kind: "no stage-0 blob" })),
    "An unmerged path has no single merged blob, so there is no one set of bytes git carries " +
      "here for the sweep to read, only the conflicting sides and, when there is one, their base.",
    "Resolve the conflict and stage the result, then re-run.",
    { one: "path is unmerged", many: "paths are unmerged" },
  );

  // The index's own non-blob entries, refused BEFORE anything is read so a
  // developer is not made to wait out a whole sweep for it. Same rule and the
  // same closed-set token as the `--staged` route: git hands back a link's
  // target path rather than content, and a gitlink has no bytes at this path at
  // all. It is scoped to `isUnderScanRoot`, which is AXIS 2's business: a
  // submodule outside the scan roots is none of this scan's.
  refuseUnscannable(
    [...listed.entries]
      .filter(
        ([p, e]) =>
          isUnderScanRoot(p) && !REGULAR_BLOB_MODES.has(e.mode) && !EXCLUDED_PATHS.has(p),
      )
      .map(([p, e]) => ({ path: p, kind: gitModeKind(e.mode) })),
    "Git records no readable content at such a path, so scanning it would prove nothing about " +
      "what it stands for.",
    "Untrack it, or replace it with a regular file.",
    // Its own noun: the offender here is an INDEX RECORD, and a gitlink's
    // working tree may not exist at all, so "not a regular file" would send a
    // developer to look at a path where there is nothing to see.
    { one: "index entry is not a regular blob", many: "index entries are not regular blobs" },
  );

  const targets = files
    .map((abs) => ({ abs, rel: normalizePath(abs) }))
    .filter(({ rel }) => !ignored.has(rel) && !EXCLUDED_PATHS.has(rel))
    .map(({ abs, rel }) => ({ path: rel, read: (): Buffer => readFileSync(abs) }));
  return { targets, index: listed.entries };
}

/**
 * The in-scope tracked paths the union half is entitled to read: every stage-0
 * regular blob under a scan root that the read filter admits and no exclusion
 * names.
 *
 * IT IS COMPUTED BEFORE THE FIRST BYTE IS READ, AND THAT IS LOAD-BEARING, not a
 * refactor. This set is part of what `all` mode ENUMERATES, so both completeness
 * tiers see it: a bypass naming a tracked-but-absent path subtracts something
 * real (rather than being refused as naming nothing), and a target that ends up
 * unread is named by the unread refusal whichever route would have read it.
 */
function unionCandidatePaths(index: Map<string, IndexEntry>): string[] {
  return [...index]
    .filter(([p, e]) => REGULAR_BLOB_MODES.has(e.mode) && isUnderScanRoot(p) && isWalkReadable(p))
    .filter(([p]) => !EXCLUDED_PATHS.has(p))
    .map(([p]) => p);
}

/**
 * THE UNION HALF of `all` mode: the bytes git carries at every in-scope tracked
 * path whose bytes the walk did not already read VERBATIM.
 *
 * `readOids` maps a path the walk actually READ to the object id of what it
 * read. A path absent from it was never opened, whatever the reason, so its blob
 * is scanned; a path present with a DIFFERENT id had a different copy read, so
 * its blob is scanned too. That second case is the EOL axis.
 */
function buildTargetsForGitIndex(
  index: Map<string, IndexEntry>,
  readOids: Map<string, string>,
): Target[] {
  const targets: Target[] = [];
  for (const path of unionCandidatePaths(index)) {
    const entry = index.get(path);
    if (entry === undefined) continue;
    if (readOids.get(path) === entry.oid) continue;
    targets.push({
      path,
      origin: "as git carries it",
      // SECURITY: array-form execFileSync, no shell. The object id is git's own
      // output, and naming the OBJECT rather than the path is the whole point:
      // it cannot be redirected by whatever the working tree currently holds.
      read: (): Buffer =>
        execFileSync("git", ["cat-file", "blob", entry.oid], {
          encoding: "buffer",
          stdio: ["ignore", "pipe", "pipe"],
        }),
    });
  }
  return targets;
}

function buildTargetsForPaths(paths: string[]): Target[] {
  return paths.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
    if (!existsSync(abs)) throw new InvocationError(`File not found: ${p}`);
    if (!statSync(abs).isFile()) throw new InvocationError(`Not a regular file: ${p}`);
    return { path: normalizePath(abs), read: () => readFileSync(abs) };
  });
}

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>`: the info half of a `--raw -z` record. */
const RAW_RECORD = /^:(?:\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]\d*$/;

function buildTargetsForStaged(): Target[] {
  let listBuf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell.
    //
    // `--raw` rather than `--name-only` because the DESTINATION MODE is the only
    // thing that distinguishes a staged regular file from a staged symlink or
    // gitlink. `git show :<path>` does not stand in for it: for a symbolic link
    // it hands back the target path as if it were content, and it is the mode,
    // not the answer, that says so.
    //
    // `--diff-filter=d` IS AN EXCLUSION ("everything EXCEPT deletions"), NOT AN
    // ALLOW-LIST OF STATUS LETTERS, AND THE POLARITY IS THE WHOLE POINT. This
    // template shipped `AMT`, and an allow-list drops every letter it does not
    // name, silently. That polarity is what made sibling scanners miss `R`
    // (rename) and then `T` (typechange), each found by a separate refuter pass
    // one round apart, and `synth` and `ncpdp` both ended on the exclusion form
    // with "do not narrow this back to an allow-list" written down. THIS FILE IS
    // WHAT EVERY FUTURE PARSER INHERITS, so it must not be the copy still
    // carrying the older shape. An unfamiliar or future status letter can now
    // only ever cost a wasted scan or a loud refusal, never a missed file.
    // Deletions stay out because there is no staged blob left to read.
    //
    // THE DELTA AGAINST `AMT` IS SMALL AND IS STATED RATHER THAN IMPLIED, since
    // `--no-renames` below already prevents `R` and `C`: what `d` newly
    // enumerates is `U` (unmerged), `X` (unknown) and `B` (broken pairing).
    // Measured on git 2.39.5, a conflicted path lists as
    // `:100644 000000 <sha> 0000000 U` plus its path: ONE record, two fields,
    // destination mode `000000`, so the stride below is unaffected and the mode
    // is not a regular blob, which puts it through the refusal below (exit 2)
    // instead of past it. Under `AMT` that same record was not listed at all.
    // Refusing is right: an unmerged path has no single staged blob, so there is
    // nothing this scan could honestly report clean over.
    //
    // `T` (TYPECHANGE) IS ENUMERATED, AND LEAVING IT OUT MAKES THE MODE CHECK
    // BELOW UNREACHABLE WHENEVER THE FILE IS ALREADY TRACKED. Replacing a TRACKED
    // regular file with a link is not an add and not a modify: git raises it as
    // `T` (`:100644 120000 <sha> <sha> T`), so an `AM` allow-list deletes the
    // record before any mode can be read and the pre-commit hook passes the link
    // green. The reverse typechange (a link replaced by a real file) is scanned
    // as the file it became.
    //
    // `--no-renames` IS SEPARATELY LOAD-BEARING, AND THE STATUS FILTER DOES NOT
    // STAND IN FOR IT. Rename detection is on by default (and `diff.renames` can
    // turn copy detection on too), so `git mv <link> test/fixtures/<name>` stages
    // as `:120000 120000 <sha> <sha> R100`: ONE record carrying TWO paths. Under
    // the old `AMT` allow-list that record was dropped outright, so an ordinary
    // `git mv`, no crafted input, put a mode-120000 entry under a scan root and
    // this route printed "OK: no hits". Under `d` it would no longer be dropped,
    // but it would desync the two-field stride below instead, which refuses
    // rather than reporting clean and is still not an answer worth having.
    // Turning detection off makes the destination arrive as an ordinary
    // single-path `A` (`:000000 120000 0000000 <sha> A`) and the source a `D` the
    // filter drops, which costs the stride nothing and needs no two-path record
    // shape. It also makes the two-field stride STRUCTURAL rather than
    // conditional: with detection off, no `R` or `C` record can be produced
    // whatever the caller's `diff.renames` setting is.
    listBuf = execFileSync(
      "git",
      ["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=d"],
      {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    throw new InvocationError(
      `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // `--raw -z` emits `<info>\0<path>\0` per record. `R` (rename) and `C` (copy)
  // are the only statuses carrying a SECOND path, and `--no-renames` above means
  // git cannot emit either, so the stride is two fields. The regex still admits a
  // score-suffixed status: if one ever reached here the stride would desync and
  // the next record would fail to parse, which REFUSES, the same outcome as any
  // other unparseable record and the safe one. A record that does not parse
  // REFUSES rather than being skipped: a silently shortened list is exactly the
  // shape this scan must never report clean over.
  //
  // What this route still does NOT enumerate, stated because the boundary is
  // narrower than the path prefix alone: `--diff-filter=d` drops `D` only (a
  // deletion has no staged blob to scan). `U` used to be dropped here too and is
  // now listed and REFUSED rather than skipped, which is the change the filter
  // polarity bought.
  const fields = listBuf.toString("utf8").split("\0");
  const staged: { path: string; mode: string }[] = [];
  let i = 0;
  while (i < fields.length) {
    const info = fields[i];
    if (info === undefined || info.length === 0) {
      i += 1;
      continue;
    }
    const m = RAW_RECORD.exec(info);
    const mode = m?.[1];
    const path = fields[i + 1];
    if (mode === undefined || path === undefined || path.length === 0) {
      throw new InvocationError(
        "could not read the output of `git diff --cached --raw -z`: unrecognized record. " +
          "Refusing rather than scanning a list that may be short.",
      );
    }
    staged.push({ path, mode });
    i += 2;
  }

  // THE REFUSAL KEYS ON THE ROOT HALF OF SCOPE, NOT ON THE READ FILTER. Running
  // `isStagedReadable` first would let a `.md`-named link under `test/fixtures/`
  // or any non-`.ts` link under `src/` fall out through a filter that exists to
  // judge a file's BYTES, and this route would then disagree with the walk about
  // the same entry.
  refuseUnscannable(
    staged
      .filter(
        (s) =>
          isUnderScanRoot(s.path) &&
          !REGULAR_BLOB_MODES.has(s.mode) &&
          !EXCLUDED_PATHS.has(s.path),
      )
      .map((s) => ({ path: s.path, kind: gitModeKind(s.mode) })),
    "The index holds no file content for such an entry, so scanning it would prove nothing " +
      "about what it refers to.",
    "Unstage it, or replace it with a regular file.",
  );

  // Every remaining readable record is a regular blob: `isStagedReadable` implies
  // `isUnderScanRoot`, so anything non-regular was refused above.
  const list = staged
    .filter((s) => isStagedReadable(s.path) && !EXCLUDED_PATHS.has(s.path))
    .map((s) => s.path);
  return list.map((relPath) => ({
    path: relPath,
    // SECURITY: array-form execFileSync, no shell. `:<path>` is a git pathspec.
    read: (): Buffer =>
      execFileSync("git", ["show", `:${relPath}`], {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  }));
}

// ---------------------------------------------------------------------------
// Cross-cutting shape checks: the format-agnostic FLOOR
// ---------------------------------------------------------------------------

function scanCommonShapes(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Dashed SSN anywhere (a dashed \d{3}-\d{2}-\d{4} is always a hit).
  for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
    hits.push({ path, segment: "(ssn)", value: m[0], reason: "dashed SSN pattern" });
  }
  // Emails whose domain is not an allow-listed reserved / test domain.
  for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
    const domain = (m[1] ?? "").toLowerCase();
    if (!allow.emailDomains.has(domain)) {
      hits.push({ path, segment: "(email)", value: m[0], reason: "email with non-test domain" });
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Scan one target and RETURN THE BYTES IT OBSERVED. The bytes are returned
 * rather than a boolean so `all` mode can ask whether the walk already read
 * exactly what the index carries at this path; see `buildTargetsForGitIndex`.
 */
function scanTarget(target: Target, allow: AllowList, hits: Hit[]): Buffer {
  let buf: Buffer;
  try {
    buf = target.read();
  } catch (err) {
    throw new InvocationError(
      `could not read ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = buf.toString("utf8");
  // Scope is decided on the target's own path; only the REPORTED locus carries
  // the origin label, so a labelled target is never a differently-scoped one.
  const locus = target.origin === undefined ? target.path : `${target.path} (${target.origin})`;

  // The format-agnostic floor: dashed SSN + non-test email. This runs on every
  // target and is all the starter detects.
  scanCommonShapes(locus, text, allow, hits);

  // ── TODO: add {{TITLE}}-specific structured field-level PHI detection here ──
  //
  //   The floor above ONLY catches SSN/email shapes. Before you rely on this
  //   scanner as a real safety gate you MUST add structured, field-level
  //   detection for {{TITLE}}'s PHI (at minimum: person NAMES, DATE OF BIRTH,
  //   MRN / MEMBER ID, ADDRESS, and PHONE) parsing `text` according to the
  //   {{TITLE}} wire format and checking each PHI-bearing field against the
  //   allow-list (`allow.names` / `allow.dobs` / `allow.ids`), pushing a `Hit`
  //   for anything not positively declared synthetic.
  //
  //   Parse the format properly (delimiters / segments / elements / tags): do
  //   NOT bolt on a blind text regex for names: coded values (`CBC^Complete
  //   Blood Count`, `Boston^MA`) produce false confidence. See the sibling
  //   parsers named in the STARTER banner at the top of this file for worked,
  //   spec-aware examples you can adapt:
  //
  //     const d = detect{{TITLE}}Delimiters(text);          // if applicable
  //     for (const record of split{{TITLE}}(text, d)) {
  //       // check name / dob / id / address / phone fields against `allow`
  //       // hits.push({ path: locus, segment: "<field>", value, reason });
  //     }
  //
  //   Until this section is implemented, treat a green `pnpm phi-scan` as
  //   "no SSN/email shapes found", NOT as "no PHI".
  //
  //   Report against `locus`, NOT `target.path`: the index union scans bytes
  //   that may not be the ones on disk, and a hit that names an undecorated
  //   path a developer then opens and finds clean is its own defect.
  // ───────────────────────────────────────────────────────────────────────────

  return buf;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Print the hits. SPLIT FROM THE CLEAN LINE ON PURPOSE: `main` reports hits
 * BEFORE it can refuse for incompleteness, so a run that is both incomplete and
 * carrying hits prints both rather than swallowing one. The clean line is
 * printed by `main` only once the completeness tiers have passed, so
 * `OK: no hits` can never appear beside a refusal.
 */
function reportHits(hits: Hit[]): void {
  if (hits.length === 0) return;
  const byPath = new Map<string, Hit[]>();
  for (const h of hits) {
    const arr = byPath.get(h.path);
    if (arr) arr.push(h);
    else byPath.set(h.path, [h]);
  }
  for (const [path, group] of byPath) {
    process.stderr.write(`[phi-scan] HIT: ${path}\n`);
    for (const h of group) {
      process.stderr.write(
        `  segment=${h.segment} value=${JSON.stringify(h.value)} (${h.reason})\n`,
      );
    }
  }
  // THE FOOTER NO LONGER ADVERTISES `--allow-fixture`, AND THAT IS A DECISION,
  // NOT AN OMISSION. A bypass withdraws a file from the read set, and the
  // completeness rule refuses (exit 2) over a target enumerated and never read,
  // so a developer following that printed remedy would be walked from exit 1
  // into exit 2. A printed remedy that cannot reach the state it promises is the
  // same defect as one that reaches a false green, with the sign flipped.
  process.stderr.write(
    `[phi-scan] ${String(hits.length)} hit(s) across ${String(byPath.size)} file(s). ` +
      `If a value is genuinely synthetic, declare it in scripts/phi-allow-list.txt: ` +
      `a token-level, reviewed declaration is the only remedy that reaches a clean run. ` +
      `A whole-file --allow-fixture bypass is recorded and then REFUSED (exit 2), because ` +
      `a scan that never opened a file has no clean verdict to give about it.\n`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
    validateAllowFixtures(args.allowFixtures);
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return EXIT_REFUSE;
    }
    throw err;
  }

  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  let allow: AllowList;
  let targets: Target[];
  // `all` mode's index, read once: it is the union half's whole enumeration.
  // `null` in the other two modes, which are not sweeps and do not have one.
  let index: Map<string, IndexEntry> | null = null;
  try {
    // `loadAllowList()` IS INSIDE THIS HANDLER, AND THAT PLACEMENT IS THE POINT.
    // Outside it, a missing allow-list escaped as an uncaught throw and took
    // node's exit 1, which this contract reserves for "hits found". See the
    // EXIT CODES paragraph in the header.
    allow = loadAllowList();
    if (args.mode === "staged") targets = buildTargetsForStaged();
    else if (args.mode === "paths") targets = buildTargetsForPaths(args.paths);
    else {
      const built = buildTargetsForAll();
      targets = built.targets;
      index = built.index;
    }
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return EXIT_REFUSE;
    }
    throw err;
  }

  // ENUMERATED: the set of paths this run declared it would read. Everything the
  // read filters dropped upstream (a `.md` file on the sweeping routes, a
  // gitignored entry, an excluded path, a staged path outside
  // `isStagedReadable`) never became a target and is not in here, which is why
  // the completeness rule below does not fire on them.
  //
  // IN `all` MODE IT IS THE WALK'S TARGETS UNION THE IN-SCOPE TRACKED PATHS.
  // The union half reads the second set, minus whatever the walk already read
  // verbatim, and that dedupe collapses on the SAME path key: so a path the
  // union skips is a path the walk already put in `read`, and the difference
  // below stays exact either way.
  const enumerated = new Set<string>(targets.map((t) => t.path));
  if (index !== null) for (const p of unionCandidatePaths(index)) enumerated.add(p);

  // TIER: A BYPASS MUST NAME A PATH THIS RUN ENUMERATES. Otherwise it subtracts
  // nothing, and a flag that subtracts nothing lets a developer believe a file
  // was acknowledged when the run never had it in scope. Compared by DIFFERENCE
  // against the enumerated set, and every offender is named.
  const unmatched = [...allowed].filter((p) => !enumerated.has(p));
  if (unmatched.length > 0) {
    process.stderr.write(
      `[phi-scan] --allow-fixture names ${String(unmatched.length)} path(s) this run does not ` +
        `enumerate, so the flag subtracts nothing:\n${unmatched.map((p) => `  - ${p}`).join("\n")}\n` +
        `Scan a corpus that contains the path, or drop the flag.\n`,
    );
    return EXIT_REFUSE;
  }

  const hits: Hit[] = [];
  // READ: filled in only after a target's bytes have actually been through
  // `scanTarget`. This is evidence of observation, never a plan to observe.
  const read = new Set<string>();
  // Path -> object id of the bytes the walk actually read, so the union below
  // can skip a path whose content it would otherwise scan a second time.
  const readOids = new Map<string, string>();
  const objectHash = index === null ? null : gitObjectHash();

  const sweep = (batch: Target[]): number | null => {
    for (const t of batch) {
      if (allowed.has(t.path)) continue;
      let bytes: Buffer;
      try {
        bytes = scanTarget(t, allow, hits);
      } catch (err) {
        if (err instanceof InvocationError) {
          process.stderr.write(`[phi-scan] ${err.message}\n`);
          return EXIT_REFUSE;
        }
        throw err;
      }
      read.add(t.path);
      if (objectHash !== null && t.origin === undefined) {
        const oid = blobOid(objectHash, bytes);
        if (oid !== null) readOids.set(t.path, oid);
      }
    }
    return null;
  };

  const walkFailure = sweep(targets);
  if (walkFailure !== null) return walkFailure;

  // THE UNION. It runs AFTER the walk, not instead of it, and only over the
  // paths the walk did not already read verbatim.
  if (index !== null) {
    const unionFailure = sweep(buildTargetsForGitIndex(index, readOids));
    if (unionFailure !== null) return unionFailure;
  }

  // THE COMPLETENESS RULE. A SET DIFFERENCE, NEVER A SIZE COMPARISON: a count
  // counts the targets that DID get read, so `n read of n targets` is exactly
  // the arithmetic that hides which ones did not. Names every offender.
  const unread = [...enumerated].filter((p) => !read.has(p));

  // Hits FIRST, so the refusal below can never swallow one.
  reportHits(hits);

  if (unread.length > 0) {
    process.stderr.write(
      `[phi-scan] refusing the scan: ${String(unread.length)} target(s) were enumerated and ` +
        `never read:\n${unread.map((p) => `  - ${p}`).join("\n")}\n` +
        `A scan that did not open a file has no clean verdict to give about it. If the file is ` +
        `genuinely synthetic, declare its identifiers in scripts/phi-allow-list.txt rather than ` +
        `withdrawing the file from the scan.\n`,
    );
    return EXIT_REFUSE;
  }

  if (hits.length > 0) return EXIT_HITS;
  process.stdout.write("[phi-scan] OK: no hits\n");
  return EXIT_CLEAN;
}

process.exit(main());
