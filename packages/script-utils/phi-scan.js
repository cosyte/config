// @cosyte/script-utils/phi-scan
//
// THE SHARED MACHINERY OF THE `@cosyte/*` PHI COMMIT-GATE, PARAMETERISED.
//
// WHY THIS FILE EXISTS, IN ONE SENTENCE: `scripts/parser-template/` is a SCAFFOLD, not a
// dependency, so `scripts/phi-scan.ts` was COPIED into every parser repo, and a newly-found escape
// therefore cost one pull request and one adversarial review PER REPO. Three escape classes have
// been closed that way already (the index union, the completeness rule, and the read filters), and
// each one was paid for thirteen times. The machinery lives here so the next one is paid for once.
//
// WHAT IS SHARED AND WHAT IS NOT. This module owns the ENGINE: argument parsing, the allow-list and
// override log, target enumeration on all three routes, the union of the working-tree walk with the
// bytes git carries, content deduplication under git's own `blob <len>\0` framing, the completeness
// rule, the refusals, and the cross-cutting SSN/email FLOOR. It does NOT own the per-standard,
// field-level detectors (names, DOB, MRN / member id, address, phone), which genuinely differ per
// healthcare standard and are supplied by the caller through `detect`.
//
// THE FIVE PER-REPO AXES ARE PARAMETERS, NOT FORKS. They differ between repos, which is an argument
// for parameters and not against sharing:
//
//   1. EXIT CODES        `exitCodes`, REQUIRED. The siblings deliberately disagree; a default here
//                        would be the porting mistake this whole campaign exists to catch.
//   2. ROOTS+EXCLUSIONS  `scanRoots` (REQUIRED), `excludedPaths` and `isWalkReadable` (both
//                        DEFAULTED, so a change to the shared default reaches every consumer
//                        through a version bump instead of thirteen edits).
//   3. `--staged` SCOPE  `isStagedReadable`, REQUIRED. Widening it changes what a COMMIT is blocked
//                        on, which is a hook decision each repo takes for itself.
//   4. GITLINKS          `regularBlobModes`, DEFAULTED to git's two regular-blob modes.
//   5. EOL NORMALIZATION No parameter. The walk/index deduplication is BY CONTENT, so where a `text`
//                        attribute or `core.autocrlf` makes the index carry LF and the working tree
//                        CRLF, BOTH forms are scanned rather than one being assumed to stand for the
//                        other. It is listed because a port must CHECK it, not skip it.
//
// ZERO DEPENDENCIES AND NO BUILD STEP, the same constraint the rest of this package carries. `git`
// is the only subprocess, always through `execFileSync` with array args, never shell-form.
//
// PHI DISCIPLINE INSIDE THIS FILE ITSELF: no literal identifier-shaped value appears anywhere in
// this source, not even as an example in a comment. A repo that widens its scan roots to the whole
// repository reads its own `node_modules` copy of this file only if it is not gitignored, and a
// diagnostic ABOUT a PHI leak is itself a PHI surface. Describe the shape; never write one down.

import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

/**
 * Every state in which the scan cannot account for something. Raised throughout, caught in `run`,
 * and turned into the caller's REFUSE code there.
 *
 * IT IS NOT EXPORTED, DELIBERATELY. A consumer that could catch it could also swallow it, and every
 * one of these states must reach a non-zero exit.
 */
class InvocationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "InvocationError";
  }
}

/** git's file modes for a regular blob. Every other mode names something with no bytes to read. */
const DEFAULT_REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/**
 * AXIS 2's shared default read filter for the two SWEEPING routes: Markdown is documentation rather
 * than fixture data and may legitimately describe a violator value.
 *
 * IT IS A DEFAULT RATHER THAN A CONSTANT SO THAT MOVING IT IS ONE CHANGE. Every `@cosyte/*` scanner
 * carries this exemption today, and a tracked `.md` is therefore read by NEITHER sweeping route
 * (the union inherits this filter on purpose, so `all` mode's verdict cannot depend on which copy of
 * a file it reached). Whether that boundary should move is a real question with a real cost on both
 * sides: `README.md` and `CHANGELOG.md` ship inside the npm tarball, and a `.md` named explicitly on
 * argv IS scanned today, so the escape is route-dependent rather than file-dependent. Moving it is a
 * deliberate change to THIS line, with its own measurement, and it then reaches every consumer
 * through a version bump.
 *
 * @param {string} relPath A repo-relative, forward-slashed path.
 * @returns {boolean} `true` when the sweeping routes may read this path's bytes.
 */
export function exemptsMarkdown(relPath) {
  return !relPath.toLowerCase().endsWith(".md");
}

/**
 * Normalise and CHECK the caller's configuration.
 *
 * A MISCONFIGURED SCANNER MUST NOT BE ABLE TO REPORT CLEAN, and that is the only property this
 * function is for. It throws a `TypeError` rather than returning a code, because at the point a
 * required axis is missing there is no trustworthy code to return: `exitCodes` is itself the thing
 * that was not supplied. A `TypeError` escapes to node's own exit 1 with a stack, which is loud,
 * lands on the author's very first run of their own scanner, and is not something CI can read as a
 * clean pass. It is NOT the caller's HITS code by coincidence: this state is unreachable once the
 * scanner runs at all.
 *
 * @param {import("./phi-scan.js").PhiScanConfig} config
 * @returns {Required<Omit<import("./phi-scan.js").PhiScanConfig, "detect">> & { detect?: import("./phi-scan.js").DetectFn }}
 */
function normalizeConfig(config) {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("runPhiScan(config) expects a configuration object.");
  }

  const repoRoot = config.repoRoot ?? process.cwd();
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new TypeError("runPhiScan: `repoRoot` must be a non-empty string when given.");
  }

  const codes = config.exitCodes;
  if (typeof codes !== "object" || codes === null) {
    throw new TypeError(
      "runPhiScan: `exitCodes` is REQUIRED ({ clean, hits, refuse }). There is deliberately no " +
        "default: the sibling @cosyte/* scanners do not agree on these numbers, and a caller that " +
        "branches on the code (CI does) must read this repo's own contract, never an inherited one.",
    );
  }
  for (const key of /** @type {const} */ (["clean", "hits", "refuse"])) {
    const value = codes[key];
    if (!Number.isInteger(value) || value < 0 || value > 125) {
      throw new TypeError(
        `runPhiScan: exitCodes.${key} must be an integer in 0..125, got ${String(value)}.`,
      );
    }
  }
  if (codes.clean === codes.hits || codes.clean === codes.refuse || codes.hits === codes.refuse) {
    throw new TypeError(
      "runPhiScan: exitCodes.clean, .hits and .refuse must be three DIFFERENT numbers. A caller " +
        "has to be able to tell `this corpus contains something that looks like PHI` from `this " +
        "scan is not trustworthy`: those need different human responses, and collapsing them makes " +
        "the second read as the first.",
    );
  }

  const rawRoots = config.scanRoots;
  if (!Array.isArray(rawRoots) || rawRoots.length === 0) {
    throw new TypeError(
      'runPhiScan: `scanRoots` is REQUIRED and must name at least one root. Use `["."]` for the ' +
        "whole repository.",
    );
  }
  /** @type {string[]} */
  const scanRoots = [];
  for (const root of rawRoots) {
    if (typeof root !== "string" || root === "") {
      throw new TypeError("runPhiScan: every entry in `scanRoots` must be a non-empty string.");
    }
    const trimmed = root.replace(/\/+$/, "");
    scanRoots.push(trimmed === "" ? "." : trimmed);
  }

  if (typeof config.isStagedReadable !== "function") {
    throw new TypeError(
      "runPhiScan: `isStagedReadable` is REQUIRED. It decides which staged blobs a COMMIT is " +
        "blocked on, which is a per-repo hook decision and must not be inherited silently.",
    );
  }

  return {
    repoRoot,
    argv: config.argv ?? process.argv.slice(2),
    exitCodes: { clean: codes.clean, hits: codes.hits, refuse: codes.refuse },
    scanRoots,
    excludedPaths: config.excludedPaths ?? new Set(),
    isWalkReadable: config.isWalkReadable ?? exemptsMarkdown,
    isStagedReadable: config.isStagedReadable,
    regularBlobModes: config.regularBlobModes ?? DEFAULT_REGULAR_BLOB_MODES,
    allowListPath: config.allowListPath ?? join(repoRoot, "scripts", "phi-allow-list.txt"),
    overrideLogPath: config.overrideLogPath ?? join(repoRoot, "phi-scan-overrides.md"),
    detect: config.detect,
  };
}

/**
 * Run the PHI scan and RETURN an exit code. Nothing here calls `process.exit`, so a test can drive
 * the engine in-process; the scanner script is the one that exits.
 *
 * ===========================================================================================
 * MODES
 *   `--staged`            scan only the blobs `git diff --cached` names.
 *   `<path> [<path>...]`  scan specific paths.
 *   (no args)             `all` mode: sweep the scan roots, as a union with the bytes git carries.
 *
 * `--allow-fixture <path>` IS A MODIFIER, NOT A MODE. A bypass is subtractive, so it must not also
 * decide what gets scanned: a lone `--allow-fixture X` used to select `paths` mode over exactly
 * `X`, then withdraw `X`, then report a clean whole run having opened nothing. The mode is chosen by
 * positional paths alone, and in `paths` mode the flag is UNCONDITIONALLY UNIONED into the target
 * list, deduped by repo-relative path, so it means the same thing in every argv.
 * ===========================================================================================
 * THE COMPLETENESS RULE: a target this run ENUMERATED and NEVER READ refuses, IN EVERY MODE, NAMING
 * THE PATHS. The comparison is a SET DIFFERENCE, never a size: a count counts the targets that DID
 * get read, so a plausible-looking total hides exactly the paths that did not.
 *
 * ENUMERATION IS THE RUN'S OWN DECLARATION OF WHAT IT WILL READ, so the read filters upstream of it
 * are not weakened by the rule: a path the read filter dropped, a gitignored entry, an excluded
 * path and a staged path outside `isStagedReadable` never become targets at all. What the rule
 * catches is a path that BECAME a target and then did not get opened.
 *
 * A BYPASS NAMING A PATH THIS RUN DOES NOT ENUMERATE ALSO REFUSES: such a flag subtracts nothing, so
 * honouring it silently would let a developer believe a file was acknowledged when the run never had
 * it in scope.
 *
 * WHAT IT COSTS, STATED RATHER THAN LEFT TO BE DISCOVERED: `--allow-fixture` CANNOT REACH THE CLEAN
 * CODE IN ANY MODE. The flag, the override log and the rejection gate are all kept, so an attempt is
 * RECORDED AND REFUSED rather than silently honoured.
 * ===========================================================================================
 * `all` MODE READS THE BYTES GIT CARRIES AS A UNION WITH THE WALK.
 *
 * The walk answers "what is on disk under the scan roots", which is not the question "what does this
 * repository carry". Three states were measured in which the walk alone reported clean at exit 0
 * over a TRACKED file carrying a live, detectable hit: the path OCCUPIED BY A DIRECTORY (a path-SET
 * reconciliation cannot see this one, because the path IS present: only reading the OBJECT closes
 * it), the working tree SHORT of a tracked file, and the two copies simply DIFFERING.
 *
 * So `git ls-files -s -z` is read for the whole index, and every in-scope tracked path whose bytes
 * the walk did not already read VERBATIM is scanned through `git cat-file blob <sha>`. It is a union
 * and never a replacement: the walk still runs first and still reaches UNTRACKED files, which git
 * cannot name at all.
 *
 * DEDUPLICATION IS BY CONTENT, NOT BY PATH, AND THAT IS THE EOL AXIS. A walk target is skipped by
 * the union only when the bytes it read hash to the index entry's own object id, so on a clean
 * checkout the union adds ZERO reads and NEVER invokes `git cat-file`. The exact fixed cost is ONE
 * `git rev-parse --show-object-format` per `all`-mode run, because the deduplication needs the
 * algorithm before it can compare anything. Where the two copies of a path DIFFER, BOTH are scanned.
 *
 * A HIT FROM THE UNION IS LABELLED `(as git carries it)`, ON THE REPORTED LOCUS ONLY. A hit naming
 * the bare path would send a developer to open a file that is clean, or not there at all. The
 * target's `path` stays undecorated because every filter, exclusion and completeness tier keys on it.
 * The `detect` callback is handed the LOCUS as `path`, so a caller cannot get this wrong.
 *
 * `all` MODE REFUSES WHEN GIT CANNOT NAME THE INDEX, OR NAMES IT EMPTY, and the two arrive through
 * DIFFERENT branches. Measured on git 2.39.5: a directory that is no repository at all FATALS (exit
 * 128), so the `catch` is what turns it into a refusal, and WITHOUT that catch the throw escapes and
 * the run takes node's own exit 1, which this contract reserves for HITS FOUND. A repository whose
 * index is empty, and a directory inside a repository with nothing tracked under it, both print
 * nothing and exit 0, which is what the size check is for. A scaffolded repo must therefore
 * `git init` and commit before an `all`-mode run means anything.
 * ===========================================================================================
 *
 * @param {import("./phi-scan.js").PhiScanConfig} config
 * @returns {number} The exit code, drawn from `config.exitCodes`.
 * @example
 *   process.exit(
 *     runPhiScan({
 *       exitCodes: { clean: 0, hits: 1, refuse: 2 },
 *       scanRoots: ["."],
 *       isStagedReadable: (p) => p.startsWith("test/fixtures/"),
 *     }),
 *   );
 */
export function runPhiScan(config) {
  return new PhiScan(normalizeConfig(config)).run();
}

class PhiScan {
  /** @param {ReturnType<typeof normalizeConfig>} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    /** Does any scan root name the repository root itself? Then everything is in scope. */
    this.wholeRepo = cfg.scanRoots.includes(".");
  }

  // -------------------------------------------------------------------------
  // Paths
  // -------------------------------------------------------------------------

  /**
   * A repo-relative, forward-slashed path: the key every filter, exclusion, dedupe and completeness
   * tier uses, and the only spelling that appears in a diagnostic.
   *
   * @param {string} p
   * @returns {string}
   */
  normalizePath(p) {
    const abs = isAbsolute(p) ? p : resolve(this.cfg.repoRoot, p);
    return relative(this.cfg.repoRoot, abs).split(sep).join("/");
  }

  /**
   * AXIS 2, the ROOT half of scope: is this entry the scan's BUSINESS at all?
   *
   * THERE ARE TWO SCOPE PREDICATES AND COLLAPSING THEM REOPENS A MEASURED HOLE. This one decides
   * whether an entry is in scope; the READ filters (`isWalkReadable`, `isStagedReadable`) decide
   * whether a REGULAR FILE's bytes get read. Every non-regular and non-blob check keys on THIS one.
   * Two sibling ports independently shipped a single shared predicate and both had the routes
   * disagree about the same entry: a `.md`-named link fell out through the read filter on one route
   * while the other refused it. A link's NAME is no evidence at all about what is on the other side
   * of it, which is exactly what a read filter is entitled to assume about a file and is not
   * entitled to assume about a link.
   *
   * A bare root name is in scope because git records no index entry for a directory, so a scan root
   * appearing as an index entry can only mean the root itself has been replaced by a blob or a link.
   *
   * @param {string} relPath
   * @returns {boolean}
   */
  isUnderScanRoot(relPath) {
    if (this.wholeRepo) return true;
    return this.cfg.scanRoots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
  }

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  /**
   * @param {string[]} argv
   * @returns {{ mode: "all" | "staged" | "paths", paths: string[], allowFixtures: string[] }}
   */
  parseArgs(argv) {
    let staged = false;
    /** @type {string[]} */
    const paths = [];
    /** @type {string[]} */
    const allowFixtures = [];
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

    // THE MODE IS CHOSEN BY POSITIONAL PATHS ALONE. Letting a bypass select the mode made
    // `--allow-fixture X` scan exactly `X`, then withdraw it, then report a clean whole run over a
    // corpus it never touched.
    /** @type {"all" | "staged" | "paths"} */
    let mode;
    if (staged) mode = "staged";
    else if (paths.length > 0) mode = "paths";
    else mode = "all";

    // UNCONDITIONAL, DEDUPED SEEDING, so the flag has ONE meaning in every argv. The old form was
    // `paths.length > 0 ? paths : [...allowFixtures]`, which seeded the target list ONLY when no
    // positional path was given: with one present the bypass was a silent no-op and the named file
    // was never ADMITTED to the run rather than withdrawn from it. Unioning admits it in every case,
    // so the withdrawal below is always a withdrawal of something enumerated and is therefore always
    // caught by the completeness rule. Dedupe is by repo-relative path, so a file named both as a
    // positional and as a bypass is one target, not two.
    const seed = [...paths, ...allowFixtures];
    const scanPaths = mode === "paths" ? this.dedupeByRepoPath(seed) : paths;

    return { mode, paths: scanPaths, allowFixtures };
  }

  /**
   * Dedupe argument paths by the repo-relative path each resolves to, keeping the caller's original
   * spelling for the first occurrence: that spelling is what gets resolved and echoed back.
   *
   * @param {string[]} paths
   * @returns {string[]}
   */
  dedupeByRepoPath(paths) {
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    for (const p of paths) {
      const key = this.normalizePath(p);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Allow-list + override log
  // -------------------------------------------------------------------------

  /**
   * The positive declaration that specific identifiers are synthetic.
   *
   * ONE ESCAPE IS DISCLOSED RATHER THAN CLOSED: an allow-list that EXISTS but cannot be READ (a
   * directory at that path, or mode 000) makes `readFileSync` throw a plain `Error`, which is not an
   * `InvocationError` and is therefore rethrown, and the run takes node's own exit 1 with a stack. A
   * caller reads that as "hits found". `loadOverrideLog` has the identical shape. Both are left
   * alone deliberately rather than papered over by widening a catch or enumerating `EACCES`/
   * `EISDIR`: a deny-list of spellings buys exactly one more evasion per round, and this repo
   * retired that shape once already on the `attw` gate. The exit contract below therefore says
   * MISSING rather than "missing or unreadable", and says 1 is reserved but NOT exclusive.
   *
   * @returns {import("./phi-scan.js").AllowList}
   */
  loadAllowList() {
    if (!existsSync(this.cfg.allowListPath)) {
      throw new InvocationError(`allow-list not found at ${this.cfg.allowListPath}`);
    }
    const raw = readFileSync(this.cfg.allowListPath, "utf8");
    /** @type {Set<string>} */ const names = new Set();
    /** @type {Set<string>} */ const dobs = new Set();
    /** @type {Set<string>} */ const ids = new Set();
    /** @type {Set<string>} */ const emailDomains = new Set();
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

  /** @returns {Set<string>} Every path the override log records, repo-relative. */
  loadOverrideLog() {
    if (!existsSync(this.cfg.overrideLogPath)) return new Set();
    const raw = readFileSync(this.cfg.overrideLogPath, "utf8");
    /** @type {Set<string>} */
    const out = new Set();
    for (const lineRaw of raw.split(/\r?\n/)) {
      const m = /^###\s+(.+?)\s*$/.exec(lineRaw);
      if (m && m[1] !== undefined) out.add(this.normalizePath(m[1]));
    }
    return out;
  }

  /** @param {string[]} allowFixtures */
  validateAllowFixtures(allowFixtures) {
    if (allowFixtures.length === 0) return;
    const overrides = this.loadOverrideLog();
    const missing = allowFixtures
      .map((p) => this.normalizePath(p))
      .filter((p) => !overrides.has(p));
    if (missing.length > 0) {
      const lines = missing.map((p) => `  - ${p}`).join("\n");
      throw new InvocationError(
        `--allow-fixture rejected: no matching entry in ${this.relOverrideLog()} for:\n${lines}\n` +
          `Add a "### <path>" subsection to ${this.relOverrideLog()} and commit it.`,
      );
    }
  }

  /** @returns {string} The override log's repo-relative path, for a diagnostic. */
  relOverrideLog() {
    return this.normalizePath(this.cfg.overrideLogPath);
  }

  /** @returns {string} The allow-list's repo-relative path, for a diagnostic. */
  relAllowList() {
    return this.normalizePath(this.cfg.allowListPath);
  }

  // -------------------------------------------------------------------------
  // git
  // -------------------------------------------------------------------------

  /**
   * Which of these paths git considers ignored.
   *
   * ONE BOUNDARY, NOT TWO: an ignored entry is already out of scope for the file route, so applying
   * the same rule to a link keeps a single boundary rather than inventing a second, stricter one for
   * links alone. `git check-ignore` is INDEX-AWARE, so `git add -f` on an ignored link does not buy
   * a bypass: once tracked it is no longer reported ignored.
   *
   * @param {string[]} paths Repo-relative or absolute paths.
   * @returns {Set<string>} The repo-relative paths git reports ignored.
   */
  gitIgnored(paths) {
    /** @type {Set<string>} */
    const ignored = new Set();
    if (paths.length === 0) return ignored;
    try {
      // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding, because
      // `encoding: "buffer"` together with `input` is rejected by Node.
      const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
        cwd: this.cfg.repoRoot,
        input: paths.map((p) => this.normalizePath(p)).join("\0"),
        stdio: ["pipe", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
      for (const p of out.toString("utf8").split("\0")) {
        if (p.length > 0) ignored.add(p);
      }
    } catch {
      // `git check-ignore` exits 1 when nothing matches, and fatals outside a repository. Treat both
      // as "none ignored": in `all` mode the missing index is refused separately and loudly, and
      // pruning nothing can only ever make the sweep read MORE.
    }
    return ignored;
  }

  /**
   * The repository's object format as a Node hash name, or `null` when git says something we do not
   * recognise. `null` disables the union's content deduplication, which scans MORE, never less.
   *
   * WHEN GIT WILL NOT SAY AT ALL THE ANSWER IS `sha1`, NOT `null`, and the two cases are stated
   * apart. A git too old to know `--show-object-format` predates sha256 repositories entirely, so
   * the fallback is a derivation rather than a guess; an answer we do not recognise is a git NEWER
   * than this file, and there the honest move is to stop deduplicating.
   *
   * @returns {string | null}
   */
  gitObjectHash() {
    let answer;
    try {
      // SECURITY: array-form execFileSync, no shell.
      answer = execFileSync("git", ["rev-parse", "--show-object-format"], {
        cwd: this.cfg.repoRoot,
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
   * The object id git would record for these bytes, under its own `blob <len>\0` framing.
   *
   * Used only to answer "did the walk already read EXACTLY the bytes the index carries here", so a
   * wrong answer can only ever cost a second scan of the same content. THIS IS THE EOL AXIS: where a
   * `text` attribute or `core.autocrlf` makes the index carry LF and the working tree CRLF, the two
   * ids differ and BOTH copies are scanned.
   *
   * @param {string} algorithm
   * @param {Buffer} bytes
   * @returns {string | null}
   */
  blobOid(algorithm, bytes) {
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
   * Every stage-0 index entry keyed by repo-relative path, plus the paths that have a record but NO
   * stage-0 record, or `null` when git could not answer.
   *
   * AN EMPTY ANSWER COUNTS AS NO ANSWER: an empty map would make every tracked path untracked, which
   * is the one state in which the union silently stops existing.
   *
   * 🛑 THE STAGE DIGIT IS READ, AND KEYING ON IT IS NOT OPTIONAL. THE RULE IS THE ABSENCE OF STAGE 0.
   * Do NOT re-derive it from a record count or from a mode, and do NOT port it from the `--staged`
   * route: that route spots an unmerged path from `--raw`'s status `U` and a destination mode of
   * `000000`, and NOTHING IN `ls-files -s` LOOKS LIKE THAT. An unmerged path is reported here only at
   * stages 1, 2 and/or 3, with ORDINARY BLOB MODES, so the mode rule cannot see it. A sibling's draft
   * took the FIRST record per path and never looked at the stage: it scanned STAGE 1, THE MERGE BASE,
   * labelled it as the bytes git carries, and printed a clean line over a marker living only in
   * stage 3.
   *
   * @returns {{ entries: Map<string, import("./phi-scan.js").IndexEntry>, unmerged: string[] } | null}
   */
  gitIndexEntries() {
    let out;
    try {
      // SECURITY: array-form execFileSync, no shell. `-z` is NUL-separated and unquoted, so it
      // matches the walk's forward-slash relative paths exactly. `maxBuffer` is raised because a
      // TRUNCATED list is a SHORT list, and a short list is the unscanned corpus this whole rule is
      // about; Node throws `ENOBUFS` rather than truncating, so the bound refuses either way.
      out = execFileSync("git", ["ls-files", "-s", "-z"], {
        cwd: this.cfg.repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      // LOAD-BEARING. A directory that is no repository FATALS at 128; without this catch the throw
      // escapes and the run takes node's exit 1, which this contract reserves for HITS FOUND.
      return null;
    }
    /** @type {Map<string, import("./phi-scan.js").IndexEntry>} */
    const entries = new Map();
    /** @type {Set<string>} */
    const higherStages = new Set();
    for (const rec of out.toString("utf8").split("\0")) {
      if (rec.length === 0) continue;
      // `<mode> <oid> <stage>\t<path>`; a path may contain anything but NUL.
      const m = /^(\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(rec);
      const mode = m?.[1];
      const oid = m?.[2];
      const stage = m?.[3];
      const path = m?.[4];
      if (mode === undefined || oid === undefined || stage === undefined || path === undefined) {
        // An unparseable record means the list may be SHORT in a way we cannot see, which is the one
        // thing this sweep must never scan past.
        return null;
      }
      if (stage === "0") entries.set(path, { mode, oid });
      else higherStages.add(path);
    }
    // A path is unmerged when it has a record and none of them is stage 0. The set difference is
    // taken rather than assuming the two are disjoint.
    const unmerged = [...higherStages].filter((p) => !entries.has(p));
    if (entries.size === 0 && unmerged.length === 0) return null;
    return { entries, unmerged };
  }

  // -------------------------------------------------------------------------
  // Enumeration: the walk
  // -------------------------------------------------------------------------

  /**
   * Enumerate the scan roots.
   *
   * `Dirent`'s predicates are lstat answers and are not exhaustive: an entry that is neither a
   * directory nor a regular file is collected into `unscannable` rather than dropped, so the caller
   * can refuse instead of reporting clean over it.
   *
   * IGNORED DIRECTORIES ARE PRUNED DURING DESCENT, ONE `git check-ignore` PER LEVEL. That is not an
   * optimisation bolted onto a filter: `scanRoots: ["."]` is the only honest default for a freshly
   * scaffolded repo, and without pruning such a sweep descends into `node_modules`. It is exactly
   * equivalent to filtering afterwards, because git cannot re-include a path under an excluded
   * directory, and the file-level filter still runs below.
   *
   * A DIRECTORY NAMED `.git` IS SKIPPED BY NAME, at any depth. It is git's own object store rather
   * than the corpus, git does not report it ignored, and the union already reads what the repository
   * carries. This is a literal name, never a predicate over content.
   *
   * The result is SORTED by repo-relative path, so a report and a refusal read the same way twice.
   *
   * @returns {{ files: string[], unscannable: import("./phi-scan.js").Unscannable[] }}
   */
  walkRoots() {
    /** @type {string[]} */
    const files = [];
    /** @type {import("./phi-scan.js").Unscannable[]} */
    const unscannable = [];

    let frontier = this.cfg.scanRoots.map((root) =>
      root === "." ? this.cfg.repoRoot : join(this.cfg.repoRoot, ...root.split("/")),
    );
    const visited = new Set(frontier);

    while (frontier.length > 0) {
      /** @type {string[]} */
      const nextDirs = [];
      for (const dir of frontier) {
        if (!existsSync(dir)) continue;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === ".git") continue;
            if (visited.has(full)) continue;
            visited.add(full);
            nextDirs.push(full);
          } else if (e.isFile()) {
            // A READ filter. The branch below is deliberately NOT subject to it: that exemption is a
            // judgement about a file whose bytes the walk could have read, and a link's name is no
            // evidence at all about what is on the other side.
            if (!this.cfg.isWalkReadable(this.normalizePath(full))) continue;
            files.push(full);
          } else {
            unscannable.push({ path: this.normalizePath(full), kind: direntKind(e) });
          }
        }
      }
      frontier = this.pruneIgnoredDirs(nextDirs);
    }

    files.sort((a, b) => (this.normalizePath(a) < this.normalizePath(b) ? -1 : 1));
    unscannable.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { files, unscannable };
  }

  /**
   * @param {string[]} dirs
   * @returns {string[]} The subset git does not report ignored.
   */
  pruneIgnoredDirs(dirs) {
    if (dirs.length === 0) return dirs;
    const ignored = this.gitIgnored(dirs);
    return dirs.filter((d) => !ignored.has(this.normalizePath(d)));
  }

  // -------------------------------------------------------------------------
  // Enumeration: the three routes
  // -------------------------------------------------------------------------

  /**
   * `all` mode's enumeration: the walk, PLUS the in-scope index the union half reads.
   *
   * @returns {{ targets: import("./phi-scan.js").Target[], index: Map<string, import("./phi-scan.js").IndexEntry> }}
   */
  buildTargetsForAll() {
    const { files, unscannable } = this.walkRoots();

    // One `git check-ignore` over both lists, so a link and a file get the same boundary.
    const ignored = this.gitIgnored([
      ...files.map((f) => this.normalizePath(f)),
      ...unscannable.map((u) => u.path),
    ]);

    this.refuseUnscannable(
      unscannable.filter((u) => !ignored.has(u.path) && !this.cfg.excludedPaths.has(u.path)),
      "The walk can neither read such an entry nor vouch for what is on the other side of it.",
      "Remove it, replace it with a regular file, or (if it is genuinely not part of the corpus) " +
        "untrack it and add it to .gitignore.",
    );

    const listed = this.gitIndexEntries();
    if (listed === null) {
      throw new InvocationError(
        "refusing the sweep: git could not name this repository's index, or named it empty, so the " +
          "sweep would be the working-tree walk's word alone and could report clean over tracked " +
          "bytes it never opened. Run it inside a git repository with a readable index.",
      );
    }

    // Unmerged first, and under its OWN sentence: an unmerged path is not a link and not a gitlink,
    // and reporting it as one sends a developer looking for something that is not there.
    this.refuseUnscannable(
      listed.unmerged
        .filter((p) => this.isUnderScanRoot(p) && !this.cfg.excludedPaths.has(p))
        .map((p) => ({ path: p, kind: "no stage-0 blob" })),
      "An unmerged path has no single merged blob, so there is no one set of bytes git carries here " +
        "for the sweep to read, only the conflicting sides and, when there is one, their base.",
      "Resolve the conflict and stage the result, then re-run.",
      { one: "path is unmerged", many: "paths are unmerged" },
    );

    // The index's own non-blob entries, refused BEFORE anything is read so a developer is not made
    // to wait out a whole sweep for it. `120000` is a symbolic link, whose blob is its TARGET PATH
    // and not any content; `160000` is a gitlink, which carries a commit id and no bytes at this
    // path at all.
    this.refuseUnscannable(
      [...listed.entries]
        .filter(
          ([p, e]) =>
            this.isUnderScanRoot(p) &&
            !this.cfg.regularBlobModes.has(e.mode) &&
            !this.cfg.excludedPaths.has(p),
        )
        .map(([p, e]) => ({ path: p, kind: gitModeKind(e.mode) })),
      "Git records no readable content at such a path, so scanning it would prove nothing about " +
        "what it stands for.",
      "Untrack it, or replace it with a regular file.",
      // Its own noun: the offender is an INDEX RECORD, and a gitlink's working tree may not exist at
      // all, so "not a regular file" would send a developer to a path where there is nothing to see.
      { one: "index entry is not a regular blob", many: "index entries are not regular blobs" },
    );

    const targets = files
      .map((abs) => ({ abs, rel: this.normalizePath(abs) }))
      .filter(({ rel }) => !ignored.has(rel) && !this.cfg.excludedPaths.has(rel))
      .map(({ abs, rel }) => ({ path: rel, read: () => readFileSync(abs) }));
    return { targets, index: listed.entries };
  }

  /**
   * The in-scope tracked paths the union half is entitled to read.
   *
   * IT IS COMPUTED BEFORE THE FIRST BYTE IS READ, AND THAT IS LOAD-BEARING. This set is part of what
   * `all` mode ENUMERATES, so both completeness tiers see it: a bypass naming a tracked-but-absent
   * path subtracts something real rather than being refused as naming nothing, and a target that
   * ends up unread is named by the unread refusal whichever route would have read it.
   *
   * @param {Map<string, import("./phi-scan.js").IndexEntry>} index
   * @returns {string[]}
   */
  unionCandidatePaths(index) {
    return [...index]
      .filter(
        ([p, e]) =>
          this.cfg.regularBlobModes.has(e.mode) &&
          this.isUnderScanRoot(p) &&
          this.cfg.isWalkReadable(p),
      )
      .filter(([p]) => !this.cfg.excludedPaths.has(p))
      .map(([p]) => p);
  }

  /**
   * THE UNION HALF of `all` mode: the bytes git carries at every in-scope tracked path whose bytes
   * the walk did not already read VERBATIM.
   *
   * `readOids` maps a path the walk actually READ to the object id of what it read. A path absent
   * from it was never opened, whatever the reason, so its blob is scanned; a path present with a
   * DIFFERENT id had a different copy read, so its blob is scanned too. That second case is the EOL
   * axis.
   *
   * @param {Map<string, import("./phi-scan.js").IndexEntry>} index
   * @param {Map<string, string>} readOids
   * @returns {import("./phi-scan.js").Target[]}
   */
  buildTargetsForGitIndex(index, readOids) {
    /** @type {import("./phi-scan.js").Target[]} */
    const targets = [];
    for (const path of this.unionCandidatePaths(index)) {
      const entry = index.get(path);
      if (entry === undefined) continue;
      if (readOids.get(path) === entry.oid) continue;
      targets.push({
        path,
        origin: "as git carries it",
        // SECURITY: array-form execFileSync, no shell. The object id is git's own output, and naming
        // the OBJECT rather than the path is the whole point: it cannot be redirected by whatever
        // the working tree currently holds. `maxBuffer` defaults to 1 MiB, so a larger tracked blob
        // fails the read and REFUSES rather than reporting a truncated scan clean.
        read: () =>
          execFileSync("git", ["cat-file", "blob", entry.oid], {
            cwd: this.cfg.repoRoot,
            encoding: "buffer",
            stdio: ["ignore", "pipe", "pipe"],
          }),
      });
    }
    return targets;
  }

  /**
   * @param {string[]} paths
   * @returns {import("./phi-scan.js").Target[]}
   */
  buildTargetsForPaths(paths) {
    return paths.map((p) => {
      const abs = isAbsolute(p) ? p : resolve(this.cfg.repoRoot, p);
      if (!existsSync(abs)) throw new InvocationError(`File not found: ${p}`);
      if (!statSync(abs).isFile()) throw new InvocationError(`Not a regular file: ${p}`);
      return { path: this.normalizePath(abs), read: () => readFileSync(abs) };
    });
  }

  /**
   * `--staged`: exactly the blobs a commit would carry.
   *
   * `--raw` rather than `--name-only` because the DESTINATION MODE is the only thing that
   * distinguishes a staged regular file from a staged symlink or gitlink. `git show :<path>` does not
   * stand in for it: for a symbolic link it hands back the target path as if it were content, and it
   * is the mode, not the answer, that says so.
   *
   * `--diff-filter=d` IS AN EXCLUSION ("everything EXCEPT deletions"), NOT AN ALLOW-LIST OF STATUS
   * LETTERS, AND THE POLARITY IS THE WHOLE POINT. An allow-list drops every letter it does not name,
   * silently; that polarity is what made sibling scanners miss `R` (rename) and then `T`
   * (typechange), each found by a separate refuter pass one round apart. An unfamiliar or future
   * status letter can now only ever cost a wasted scan or a loud refusal, never a missed file.
   * Against an `AMT` allow-list, what `d` newly enumerates is `U` (unmerged), `X` (unknown) and `B`
   * (broken pairing). Measured on git 2.39.5, a conflicted path lists as one record with destination
   * mode `000000`, so the stride is unaffected and the mode is not a regular blob, which puts it
   * through the refusal below instead of past it.
   *
   * `T` (TYPECHANGE) IS ENUMERATED, AND LEAVING IT OUT MAKES THE MODE CHECK UNREACHABLE WHENEVER THE
   * FILE IS ALREADY TRACKED: replacing a TRACKED regular file with a link is not an add and not a
   * modify, so an `AM` allow-list deletes the record before any mode can be read.
   *
   * `--no-renames` IS SEPARATELY LOAD-BEARING. Rename detection is on by default, so `git mv <link>
   * <scan root>/<name>` stages as one record carrying TWO paths, which desyncs the two-field stride.
   * Turning detection off makes the destination arrive as an ordinary single-path `A` and the source
   * a `D` the filter drops, which makes the stride STRUCTURAL rather than conditional on the
   * caller's `diff.renames` setting.
   *
   * @returns {import("./phi-scan.js").Target[]}
   */
  buildTargetsForStaged() {
    let listBuf;
    try {
      // SECURITY: array-form execFileSync, no shell.
      listBuf = execFileSync(
        "git",
        ["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=d"],
        {
          cwd: this.cfg.repoRoot,
          encoding: "buffer",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    } catch (err) {
      throw new InvocationError(
        `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // `--raw -z` emits `<info>\0<path>\0` per record. `R` and `C` are the only statuses carrying a
    // SECOND path and `--no-renames` means git cannot emit either, so the stride is two fields. A
    // record that does not parse REFUSES rather than being skipped: a silently shortened list is
    // exactly the shape this scan must never report clean over.
    const fields = listBuf.toString("utf8").split("\0");
    /** @type {{ path: string, mode: string }[]} */
    const staged = [];
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

    // THE REFUSAL KEYS ON THE ROOT HALF OF SCOPE, NOT ON THE READ FILTER. Running `isStagedReadable`
    // first would let a link whose NAME the read filter drops fall out through a filter that exists
    // to judge a file's BYTES, and this route would then disagree with the walk about the same entry.
    this.refuseUnscannable(
      staged
        .filter(
          (s) =>
            this.isUnderScanRoot(s.path) &&
            !this.cfg.regularBlobModes.has(s.mode) &&
            !this.cfg.excludedPaths.has(s.path),
        )
        .map((s) => ({ path: s.path, kind: gitModeKind(s.mode) })),
      "The index holds no file content for such an entry, so scanning it would prove nothing about " +
        "what it refers to.",
      "Unstage it, or replace it with a regular file.",
    );

    // Every remaining readable record is a regular blob: anything non-regular was refused above.
    return staged
      .filter((s) => this.cfg.isStagedReadable(s.path) && !this.cfg.excludedPaths.has(s.path))
      .map((s) => s.path)
      .map((relPath) => ({
        path: relPath,
        // SECURITY: array-form execFileSync, no shell. `:<path>` is a git pathspec.
        read: () =>
          execFileSync("git", ["show", `:${relPath}`], {
            cwd: this.cfg.repoRoot,
            encoding: "buffer",
            stdio: ["ignore", "pipe", "pipe"],
          }),
      }));
  }

  /**
   * Refuse over entries the enumeration reached and cannot scan. EVERY offender IN THE GROUP is
   * named, not just the first: a developer who has to re-run the gate once per link learns to
   * distrust it.
   *
   * A refusal names the entry's own repo-relative path and an engine-owned token for its kind. IT
   * NEVER REPORTS A LINK TARGET, which is text off the working tree and can itself carry PHI.
   *
   * `noun` is overridable because the refusal must say something TRUE about what it refused: an
   * unmerged path is not a non-regular file, it is a path with no single blob.
   *
   * @param {import("./phi-scan.js").Unscannable[]} entries
   * @param {string} why
   * @param {string} remedy
   * @param {{ one: string, many: string }} [noun]
   */
  refuseUnscannable(
    entries,
    why,
    remedy,
    noun = { one: "entry is not a regular file", many: "entries are not regular files" },
  ) {
    if (entries.length === 0) return;
    const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
    const phrase = entries.length === 1 ? noun.one : noun.many;
    throw new InvocationError(
      `refusing the scan: ${String(entries.length)} ${phrase}:\n${lines}\n${why} ${remedy}`,
    );
  }

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  /**
   * The format-agnostic FLOOR: a dashed Social Security Number shape, and an email at a domain the
   * allow-list does not declare.
   *
   * BOTH BRANCHES CONSULT THE ALLOW-LIST, AND THE SSN BRANCH DOING SO IS A CORRECTION. A sibling's
   * refuter measured that its dashed-SSN branch consulted nothing, so the footer's claim that the
   * token allow-list "is the only remedy that reaches a clean run" was FALSE for exactly that
   * branch: a developer meeting it had no remedy at all, the bypass having been closed. Declaring an
   * identifier is a reviewed, committed act, which is the mechanism this gate is built on; a
   * detector that cannot be answered is a detector people route around.
   *
   * The declared form is matched BOTH as written and with its separators removed, so one `ID` entry
   * covers both renderings rather than requiring a repo to guess which one a fixture uses.
   *
   * @param {string} path The reported LOCUS.
   * @param {string} content
   * @param {import("./phi-scan.js").AllowList} allow
   * @param {import("./phi-scan.js").Hit[]} hits
   */
  scanCommonShapes(path, content, allow, hits) {
    for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
      const value = m[0];
      if (allow.ids.has(value.toUpperCase())) continue;
      if (allow.ids.has(value.replace(/\D/g, ""))) continue;
      hits.push({ path, segment: "(ssn)", value, reason: "dashed SSN pattern" });
    }
    for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
      const domain = (m[1] ?? "").toLowerCase();
      if (!allow.emailDomains.has(domain)) {
        hits.push({ path, segment: "(email)", value: m[0], reason: "email with non-test domain" });
      }
    }
  }

  /**
   * Scan one target and RETURN THE BYTES IT OBSERVED. The bytes are returned rather than a boolean
   * so `all` mode can ask whether the walk already read exactly what the index carries at this path.
   *
   * THE CALLER'S DETECTOR IS HANDED THE LOCUS, NOT THE TARGET PATH, so a hit from the union half
   * cannot be reported against a bare path a developer would open and find clean. That used to be a
   * sentence in a comment; here it is the only path a caller can reach.
   *
   * A DETECTOR THAT THROWS REFUSES THE SCAN rather than escaping to node's own exit code. A
   * per-standard parser meeting input it cannot handle is an ordinary event, and the code node would
   * pick is the one this contract reserves for HITS FOUND.
   *
   * @param {import("./phi-scan.js").Target} target
   * @param {import("./phi-scan.js").AllowList} allow
   * @param {import("./phi-scan.js").Hit[]} hits
   * @returns {Buffer}
   */
  scanTarget(target, allow, hits) {
    let buf;
    try {
      buf = target.read();
    } catch (err) {
      throw new InvocationError(
        `could not read ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const text = buf.toString("utf8");
    // Scope is decided on the target's own path; only the REPORTED locus carries the origin label,
    // so a labelled target is never a differently-scoped one.
    const locus = target.origin === undefined ? target.path : `${target.path} (${target.origin})`;

    this.scanCommonShapes(locus, text, allow, hits);

    const detect = this.cfg.detect;
    if (detect !== undefined) {
      try {
        detect({
          path: locus,
          text,
          bytes: buf,
          allow,
          hit: (h) => {
            hits.push({ path: locus, segment: h.segment, value: h.value, reason: h.reason });
          },
        });
      } catch (err) {
        throw new InvocationError(
          `the field detector threw on ${locus}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return buf;
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  /**
   * Print the hits.
   *
   * SPLIT FROM THE CLEAN LINE ON PURPOSE. Every refusal that can follow a read prints the hits
   * FIRST, so a run that is both incomplete and carrying hits prints both. The clean line is printed
   * only once every tier has passed, so it can never appear beside a refusal.
   *
   * THE FOOTER IS SCOPED TO WHAT THIS ENGINE KNOWS. It does not claim the allow-list reaches a clean
   * run for every hit, because a per-repo detector supplied through `detect` may raise one without
   * consulting the allow-list at all, and a sibling shipped exactly that claim and had it refuted.
   * What is true, and all that is said: the two branches of the cross-cutting floor consult it, a
   * whole-file bypass is recorded and then refused, and a detector that consults nothing has to be
   * changed rather than argued with.
   *
   * @param {import("./phi-scan.js").Hit[]} hits
   */
  reportHits(hits) {
    if (hits.length === 0) return;
    /** @type {Map<string, import("./phi-scan.js").Hit[]>} */
    const byPath = new Map();
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
    process.stderr.write(
      `[phi-scan] ${String(hits.length)} hit(s) across ${String(byPath.size)} file(s). ` +
        `The cross-cutting floor (SSN and email shapes) consults ${this.relAllowList()}, so a ` +
        `genuinely synthetic identifier is declared there: a token-level, reviewed declaration. A ` +
        `hit raised by this repo's own field detectors is answerable that way only if that detector ` +
        `consults the allow-list; one that does not has to be changed rather than declared around. ` +
        `A whole-file --allow-fixture bypass is recorded and then REFUSED, because a scan that ` +
        `never opened a file has no clean verdict to give about it.\n`,
    );
  }

  // -------------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------------

  /**
   * ===========================================================================================
   * THE EXIT CONTRACT IS THE CALLER'S, NOT THIS FILE'S. The three codes come from `exitCodes`, and
   * their meanings are:
   *
   *   clean   the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
   *   hits    this corpus contains something that looks like PHI. Nothing this engine RAISES ever
   *           takes it. It is NOT exclusive, and the escapes are named rather than left to be
   *           discovered: an allow-list or an override log that EXISTS but cannot be READ throws a
   *           plain `Error`, which is rethrown, and the run takes node's own exit 1.
   *   refuse  every state this engine RAISES in which the scan cannot account for something: a bad
   *           argument, a MISSING allow-list, an unlogged bypass, a bypass naming a path this run
   *           does not enumerate, an in-scope entry that is not a regular file, an unparseable
   *           `git diff --cached` record, an index git cannot name or names empty, an in-scope index
   *           entry that is not a regular blob, an in-scope path with no stage-0 blob (unmerged), a
   *           target whose bytes cannot be read, a field detector that threw, and a target
   *           enumerated but never read.
   * ===========================================================================================
   *
   * @returns {number}
   */
  run() {
    const { clean: EXIT_CLEAN, hits: EXIT_HITS, refuse: EXIT_REFUSE } = this.cfg.exitCodes;

    /** @type {{ mode: "all" | "staged" | "paths", paths: string[], allowFixtures: string[] }} */
    let args;
    try {
      args = this.parseArgs(this.cfg.argv);
      this.validateAllowFixtures(args.allowFixtures);
    } catch (err) {
      if (err instanceof InvocationError) {
        process.stderr.write(`[phi-scan] ${err.message}\n`);
        return EXIT_REFUSE;
      }
      throw err;
    }

    const allowed = new Set(args.allowFixtures.map((p) => this.normalizePath(p)));

    /** @type {import("./phi-scan.js").AllowList} */
    let allow;
    /** @type {import("./phi-scan.js").Target[]} */
    let targets;
    /** `all` mode's index, read once: it is the union half's whole enumeration. */
    /** @type {Map<string, import("./phi-scan.js").IndexEntry> | null} */
    let index = null;
    try {
      // `loadAllowList()` IS INSIDE THIS HANDLER, AND THAT PLACEMENT IS THE POINT. Outside it, a
      // missing allow-list escaped as an uncaught throw and took node's exit 1, which this contract
      // reserves for "hits found".
      allow = this.loadAllowList();
      if (args.mode === "staged") targets = this.buildTargetsForStaged();
      else if (args.mode === "paths") targets = this.buildTargetsForPaths(args.paths);
      else {
        const built = this.buildTargetsForAll();
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

    // ENUMERATED: the set of paths this run declared it would read. Everything the read filters
    // dropped upstream never became a target and is not in here, which is why the completeness rule
    // does not fire on them. In `all` mode it is the walk's targets UNION the in-scope tracked paths.
    const enumerated = new Set(targets.map((t) => t.path));
    if (index !== null) for (const p of this.unionCandidatePaths(index)) enumerated.add(p);

    // TIER: A BYPASS MUST NAME A PATH THIS RUN ENUMERATES. Otherwise it subtracts nothing, and a
    // flag that subtracts nothing lets a developer believe a file was acknowledged when the run
    // never had it in scope. Compared by DIFFERENCE, and every offender is named.
    //
    // THIS TIER FIRES BEFORE ANY TARGET IS READ, so no hit exists for it to swallow. That is a
    // narrower guarantee than the unread tier's and is stated as such rather than generalised.
    const unmatched = [...allowed].filter((p) => !enumerated.has(p));
    if (unmatched.length > 0) {
      process.stderr.write(
        `[phi-scan] --allow-fixture names ${String(unmatched.length)} path(s) this run does not ` +
          `enumerate, so the flag subtracts nothing:\n${unmatched.map((p) => `  - ${p}`).join("\n")}\n` +
          `Scan a corpus that contains the path, or drop the flag.\n`,
      );
      return EXIT_REFUSE;
    }

    /** @type {import("./phi-scan.js").Hit[]} */
    const hits = [];
    // READ: filled in only after a target's bytes have actually been through `scanTarget`. This is
    // evidence of observation, never a plan to observe.
    /** @type {Set<string>} */
    const read = new Set();
    /** Path -> object id of the bytes the walk actually read, so the union can skip a re-scan. */
    /** @type {Map<string, string>} */
    const readOids = new Map();
    const objectHash = index === null ? null : this.gitObjectHash();

    /**
     * @param {import("./phi-scan.js").Target[]} batch
     * @returns {number | null} A refusal code, or `null` when the batch completed.
     */
    const sweep = (batch) => {
      for (const t of batch) {
        if (allowed.has(t.path)) continue;
        let bytes;
        try {
          bytes = this.scanTarget(t, allow, hits);
        } catch (err) {
          if (err instanceof InvocationError) {
            // HITS FOUND SO FAR ARE PRINTED BEFORE THIS REFUSAL, DELIBERATELY, AND THIS IS A CHANGE
            // FROM THE COPIED SCANNERS. A refuter measured the old ordering: a fatal partway through
            // the sweep discarded every hit found before it, so a consumer saw a refusal with no
            // indication that PHI had already been found. The refusal still wins the exit code, and
            // the clean line is still unreachable from here, so nothing is reported as accounted for
            // that is not; what changes is that a finding already made is not thrown away.
            this.reportHits(hits);
            process.stderr.write(`[phi-scan] ${err.message}\n`);
            return EXIT_REFUSE;
          }
          throw err;
        }
        read.add(t.path);
        if (objectHash !== null && t.origin === undefined) {
          const oid = this.blobOid(objectHash, bytes);
          if (oid !== null) readOids.set(t.path, oid);
        }
      }
      return null;
    };

    const walkFailure = sweep(targets);
    if (walkFailure !== null) return walkFailure;

    // THE UNION. It runs AFTER the walk, not instead of it, and only over the paths the walk did not
    // already read verbatim.
    if (index !== null) {
      const unionFailure = sweep(this.buildTargetsForGitIndex(index, readOids));
      if (unionFailure !== null) return unionFailure;
    }

    // THE COMPLETENESS RULE. A SET DIFFERENCE, NEVER A SIZE COMPARISON: a count counts the targets
    // that DID get read, so `n read of n targets` is exactly the arithmetic that hides which ones did
    // not. Names every offender.
    const unread = [...enumerated].filter((p) => !read.has(p));

    // Hits FIRST, so the refusal below can never swallow one.
    this.reportHits(hits);

    if (unread.length > 0) {
      process.stderr.write(
        `[phi-scan] refusing the scan: ${String(unread.length)} target(s) were enumerated and ` +
          `never read:\n${unread.map((p) => `  - ${p}`).join("\n")}\n` +
          `A scan that did not open a file has no clean verdict to give about it. If the file is ` +
          `genuinely synthetic, declare its identifiers in ${this.relAllowList()} rather than ` +
          `withdrawing the file from the scan.\n`,
      );
      return EXIT_REFUSE;
    }

    if (hits.length > 0) return EXIT_HITS;
    process.stdout.write("[phi-scan] OK: no hits\n");
    return EXIT_CLEAN;
  }
}

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>`: the info half of a `--raw -z` record. */
const RAW_RECORD = /^:(?:\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]\d*$/;

/**
 * Closed-set, engine-owned description of a directory entry's kind. Nothing off the other side of a
 * link is ever recorded.
 *
 * @param {import("node:fs").Dirent} e
 * @returns {string}
 */
function direntKind(e) {
  if (e.isSymbolicLink()) return "a symbolic link";
  if (e.isFIFO()) return "a FIFO";
  if (e.isSocket()) return "a socket";
  if (e.isBlockDevice()) return "a block device";
  if (e.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * Closed-set, engine-owned description of a git file mode.
 *
 * @param {string} mode
 * @returns {string}
 */
function gitModeKind(mode) {
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
}
