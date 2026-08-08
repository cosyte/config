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
 * A HIT IS NEVER SWALLOWED BY THE REFUSAL. Hits are reported first and the
 * refusal follows, so a run that is both incomplete AND carrying hits prints
 * both. The code is 2: the incompleteness is the larger claim, and the hits are
 * already on stderr where a human reads them.
 * ===========================================================================
 *
 * ===========================================================================
 * EXIT CONTRACT, DEFINED HERE AND NOT INHERITED. A scaffolded parser has no
 * history, so this template STATES its contract rather than acquiring one by
 * accident:
 *
 *   0  the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
 *   1  HITS, AND NOTHING ELSE REACHES IT. Reserved exclusively for "this corpus
 *      contains something that looks like PHI".
 *   2  EVERY STATE IN WHICH THE SCAN CANNOT ACCOUNT FOR SOMETHING: a bad
 *      argument, a missing or unreadable allow-list, an unlogged bypass, a
 *      bypass naming a path this run does not enumerate, an in-scope entry that
 *      is not a regular file, an unparseable `git diff --cached` record, a
 *      target whose bytes cannot be read, and a target enumerated but never
 *      read.
 *
 * 1 IS RESERVED BECAUSE CI AND THE PRE-COMMIT HOOK BRANCH ON THE CODE. A caller
 * must be able to tell "PHI was found here" from "this scan is not trustworthy":
 * those need different human responses, and collapsing them makes the second
 * read as the first.
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
 * never reported ignored; and if a scan ROOT is itself replaced by a link the
 * walk follows it (`existsSync`/`readdirSync` both follow) and scans the target
 * directory, where `--staged` refuses the index entry. Those are different
 * answers to the same tree and neither is blind, which is why this narrows the
 * staged one and leaves the walk alone.
 * ===========================================================================
 */

import { readFileSync, statSync, existsSync, readdirSync, type Dirent } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

// Roots walked in "all" mode. test/fixtures gets the full scan; src gets the
// same conservative shape pass because it is hand-written code, not data.
// JSDoc `@example` snippets must not carry real PHI either.
const FIXTURE_ROOT = join(REPO_ROOT, "test", "fixtures");
const SRC_ROOT = join(REPO_ROOT, "src");

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
 * The ROOT half of scope: is this entry the scan's business at all? This is the
 * predicate every non-regular check keys on, and it is deliberately NOT the
 * predicate that decides what gets READ. See the two-predicate note in the
 * header. The bare root names are in scope because git records no index entry
 * for a directory, so `test/fixtures` appearing as an index entry can only mean
 * the corpus root itself has been replaced by a blob or a link.
 */
function isUnderScanRoot(relPath: string): boolean {
  return (
    relPath === "test/fixtures" ||
    relPath.startsWith("test/fixtures/") ||
    relPath === "src" ||
    relPath.startsWith("src/")
  );
}

/**
 * The READ half of scope for `--staged`: which regular blobs get their bytes
 * scanned. Narrower than `isUnderScanRoot` and unchanged by the non-regular
 * work, so the containment `isStagedReadable` implies `isUnderScanRoot` holds:
 * that containment is what guarantees a non-regular entry is refused before it
 * could ever be read.
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
      if (e.name.toLowerCase().endsWith(".md")) continue;
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
 * offender is named, not just the first: a developer who has to re-run the gate
 * once per link learns to distrust it.
 */
function refuseUnscannable(entries: Unscannable[], why: string, remedy: string): void {
  if (entries.length === 0) return;
  const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
  const noun =
    entries.length === 1 ? "entry is not a regular file" : "entries are not regular files";
  throw new InvocationError(
    `refusing the scan: ${String(entries.length)} ${noun}:\n${lines}\n${why} ${remedy}`,
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

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];
  walk(FIXTURE_ROOT, files, unscannable);
  walk(SRC_ROOT, files, unscannable);

  // One `git check-ignore` over both lists. An ignored entry is already out of
  // scope for the file route, so applying the same rule to a link keeps a single
  // boundary rather than inventing a second, stricter one for links alone. Note
  // `git check-ignore` is index-aware, so `git add -f` on an ignored link does
  // not buy a bypass: once tracked it is no longer reported ignored.
  const ignored = gitIgnored([...files.map(normalizePath), ...unscannable.map((u) => u.path)]);

  refuseUnscannable(
    unscannable.filter((u) => !ignored.has(u.path)),
    "The walk can neither read such an entry nor vouch for what is on the other side of it.",
    "Remove it, replace it with a regular file, or (if it is genuinely not part of the " +
      "corpus) untrack it and add it to .gitignore.",
  );

  return files
    .filter((abs) => !ignored.has(normalizePath(abs)))
    .map((abs) => ({ path: normalizePath(abs), read: () => readFileSync(abs) }));
}

function buildTargetsForPaths(paths: string[]): Target[] {
  return paths.map((p) => {
    const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
    if (!existsSync(abs)) throw new InvocationError(`File not found: ${p}`);
    if (!statSync(abs).isFile()) throw new InvocationError(`Not a regular file: ${p}`);
    return { path: normalizePath(abs), read: () => readFileSync(abs) };
  });
}

/** git's file modes for a regular blob. Every other mode is not a file to read. */
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/** Closed-set, engine-owned description of a git file mode. */
function gitModeKind(mode: string): string {
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
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
      .filter((s) => isUnderScanRoot(s.path) && !REGULAR_BLOB_MODES.has(s.mode))
      .map((s) => ({ path: s.path, kind: gitModeKind(s.mode) })),
    "The index holds no file content for such an entry, so scanning it would prove nothing " +
      "about what it refers to.",
    "Unstage it, or replace it with a regular file.",
  );

  // Every remaining readable record is a regular blob: `isStagedReadable` implies
  // `isUnderScanRoot`, so anything non-regular was refused above.
  const list = staged.filter((s) => isStagedReadable(s.path)).map((s) => s.path);
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

function scanTarget(target: Target, allow: AllowList, hits: Hit[]): void {
  let buf: Buffer;
  try {
    buf = target.read();
  } catch (err) {
    throw new InvocationError(
      `could not read ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = buf.toString("utf8");

  // The format-agnostic floor: dashed SSN + non-test email. This runs on every
  // target and is all the starter detects.
  scanCommonShapes(target.path, text, allow, hits);

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
  //       // hits.push({ path: target.path, segment: "<field>", value, reason });
  //     }
  //
  //   Until this section is implemented, treat a green `pnpm phi-scan` as
  //   "no SSN/email shapes found", NOT as "no PHI".
  // ───────────────────────────────────────────────────────────────────────────
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
      return 2;
    }
    throw err;
  }

  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  let allow: AllowList;
  let targets: Target[];
  try {
    // `loadAllowList()` IS INSIDE THIS HANDLER, AND THAT PLACEMENT IS THE POINT.
    // Outside it, a missing allow-list escaped as an uncaught throw and took
    // node's exit 1, which this contract reserves for "hits found". See the
    // EXIT CODES paragraph in the header.
    allow = loadAllowList();
    if (args.mode === "staged") targets = buildTargetsForStaged();
    else if (args.mode === "paths") targets = buildTargetsForPaths(args.paths);
    else targets = buildTargetsForAll();
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  // ENUMERATED: the set of paths this run declared it would read. Everything the
  // read filters dropped upstream (a `.md` file in the walk, a gitignored entry,
  // a staged path outside `isStagedReadable`) never became a target and is not
  // in here, which is why the completeness rule below does not fire on them.
  const enumerated = new Set<string>(targets.map((t) => t.path));

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
    return 2;
  }

  const hits: Hit[] = [];
  // READ: filled in only after a target's bytes have actually been through
  // `scanTarget`. This is evidence of observation, never a plan to observe.
  const read = new Set<string>();
  for (const t of targets) {
    if (allowed.has(t.path)) continue;
    try {
      scanTarget(t, allow, hits);
    } catch (err) {
      if (err instanceof InvocationError) {
        process.stderr.write(`[phi-scan] ${err.message}\n`);
        return 2;
      }
      throw err;
    }
    read.add(t.path);
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
    return 2;
  }

  if (hits.length > 0) return 1;
  process.stdout.write("[phi-scan] OK: no hits\n");
  return 0;
}

process.exit(main());
