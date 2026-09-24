/**
 * Types for `@cosyte/script-utils/phi-scan`: the shared machinery of the `@cosyte/*` PHI
 * commit-gate.
 *
 * The engine owns enumeration, the union of the working-tree walk with the bytes git carries,
 * content deduplication, the completeness rule, the refusals and the cross-cutting SSN/email floor.
 * The caller owns the five per-repo axes below and the per-standard field detectors.
 */

/**
 * A reported PHI finding: a POSITION and a RULE, never the token that matched. `path` is the LOCUS
 * the engine chose, never a path the caller invents.
 *
 * 🛑 THE MATCHED VALUE IS NOT PART OF A FINDING. The report goes to stderr, stderr is a CI log, and
 * a diagnostic about a PHI leak that quotes the leak is a second copy of it somewhere worse
 * (`phi-safety` P4). A detector may pass `value`; the engine drops it at the boundary rather than
 * storing it, so no reporting path downstream can print what no record carries.
 */
export interface Hit {
  /** The reported locus: the target's repo-relative path, plus an origin label when it has one. */
  path: string;
  /** A locator inside the target: `(ssn)`, `(email)`, or a field id from a per-standard detector. */
  segment: string;
  /**
   * The offending value, as a detector found it. ACCEPTED AND DISCARDED: the engine neither stores
   * nor prints it, and a hit the engine reports never carries one. It stays in the surface so a
   * detector that has the token in hand can keep saying so at its own call site without the engine
   * becoming the place that publishes it.
   */
  value?: string;
  /** Why it was raised, in a few words. This is what the report prints beside the locator. */
  reason: string;
}

/** The positive declaration that specific identifiers are synthetic. */
export interface AllowList {
  /** Uppercase synthetic person-name tokens. Consumed by a caller's structured name detector. */
  names: Set<string>;
  /** Synthetic dates of birth, in whatever form the caller's detector normalises to. */
  dobs: Set<string>;
  /** Synthetic id values (SSN / MRN / member-id shapes), uppercased. Also read by the SSN floor. */
  ids: Set<string>;
  /** Allowed email domains, lowercased. Anything else is a hit. Read by the email floor. */
  emailDomains: Set<string>;
}

/** A stage-0 index entry: the mode git records, and the object it points at. */
export interface IndexEntry {
  mode: string;
  oid: string;
}

/** One thing the scan will read, and where its bytes come from. */
export interface Target {
  /** Repo-relative, forward-slashed. Every filter, exclusion and completeness tier keys on this. */
  path: string;
  read: () => Buffer;
  /**
   * Where these bytes came from, when it is not simply the file at `path`. Set only by the index
   * union, and it decorates the REPORTED LOCUS ONLY.
   *
   * TWO VALUES, BECAUSE THE REMEDY DIFFERS. `git index` is a path whose working-tree copy this run
   * did not read at all; `git index; the working tree differs` is one whose disk copy WAS read and
   * carries other bytes, so the file a developer opens is clean and re-staging is part of the fix.
   */
  origin?: string;
}

/** An entry the enumeration reached and cannot scan. Both fields are safe to print. */
export interface Unscannable {
  path: string;
  /** A token from the engine's own closed set. Never text off the other side of a link. */
  kind: string;
}

/** What a per-standard field detector is handed for one target. */
export interface DetectContext {
  /**
   * The reported LOCUS, already carrying any origin label. Raise hits against this and nothing else:
   * a hit naming a bare path whose working-tree copy is clean sends a developer to the wrong file.
   */
  path: string;
  /** The target's bytes decoded as UTF-8. */
  text: string;
  /** The target's bytes, for a byte-strict format. */
  bytes: Buffer;
  /** The parsed allow-list, so a detector can honour a positive synthetic declaration. */
  allow: AllowList;
  /** Raise a hit. The locus is filled in by the engine. */
  hit: (h: Omit<Hit, "path">) => void;
}

/**
 * A per-standard field detector. Throwing REFUSES the scan rather than taking node's exit code.
 *
 * 🛑 THE THROWN MESSAGE IS PRINTED VERBATIM, so it reaches CI logs. Name the position, never the
 * content: a parser that interpolates the record it choked on turns a diagnostic into a PHI
 * surface. This is the one place the engine prints text it cannot vouch for, and it is disclosed
 * rather than suppressed, because a refusal nobody can diagnose is its own defect.
 */
export type DetectFn = (ctx: DetectContext) => void;

/** The three codes this repo's own exit contract assigns. All three must differ. */
export interface PhiScanExitCodes {
  /**
   * The scan ran, read every target it enumerated, and found nothing. The ONE subtraction is the
   * enumeration TOCTOU window: an UNTRACKED file the walk listed, in `all` mode, that was gone by
   * read time and is still gone at the end of the run, is reported SKIPPED. Git carries no bytes
   * at such a path, so nothing this repository holds went unread. WHEN THAT HAPPENS THE CLEAN LINE
   * ITSELF SAYS SO on stdout, counting the skipped files, so the subtraction is visible to a reader
   * who never sees stderr; with nothing skipped the line is byte-identical to what it always was.
   */
  clean: number;
  /** This corpus contains something that looks like PHI. */
  hits: number;
  /** Every state the engine RAISES in which the scan cannot account for something. */
  refuse: number;
}

export interface PhiScanConfig {
  /**
   * AXIS 1, REQUIRED. There is deliberately no default: the sibling `@cosyte/*` scanners do not
   * agree on these numbers, and a caller that branches on the code (CI does) must read this repo's
   * own contract rather than an inherited one.
   */
  exitCodes: PhiScanExitCodes;

  /**
   * AXIS 2, REQUIRED: the roots `all` mode walks. `["."]` means the whole repository, which is the
   * only honest setting for a repo that has not yet decided what its corpus is. A ROOT IS A SCOPE
   * DECISION AND IT IS THE AXIS MOST LIKELY TO BE WRONG IN A PORT: measure what a narrowing stops
   * reading, rather than assuming it stops reading nothing.
   *
   * Each entry is normalised the way every other path is, so `src`, `./src`, `src/` and an absolute
   * path to it are one root. That normalization is a fix rather than a convenience: `["./src"]`
   * used to walk correctly while matching no index path, which emptied the union, the index
   * non-blob refusal and the unmerged refusal in silence. A root resolving OUTSIDE the repository
   * is refused for the same reason.
   *
   * A ROOT MAY NAME A REGULAR FILE, AND THE KIND IS DERIVED FROM THE FILESYSTEM RATHER THAN
   * DECLARED. This parameter is a plain `string[]` on purpose. One sibling declares its roots as
   * `{ rel, shape: "directory" | "file" }` and lists a single file among them, and that shape is
   * expressible here without the richer type: such a root is scanned as one target. It is a
   * measured decision rather than a preference, because an earlier draft fed every root to
   * `readdirSync` and a file root threw `ENOTDIR`, uncaught, taking node's exit 1, the code this
   * contract reserves for HITS FOUND.
   *
   * WHAT DERIVING GIVES UP: a declaration can notice that a root is not the KIND it was meant to be
   * and derivation cannot, so a root that changes kind is silently treated as what it now is. That
   * is a recorded narrowing rather than an oversight, with its compensating control named:
   * `documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md`, N2. Every TRACKED file
   * that lived under such a root is still read, because the index half of `all` mode is not narrowed
   * by this parameter at all.
   *
   * ALL THREE KINDS HAVE ONE SETTLED OUTCOME. A REGULAR FILE is scanned as one target. A SYMBOLIC
   * LINK is refused rather than followed, and so is anything that is neither a file nor a directory.
   * A DIRECTORY THAT CANNOT BE ENUMERATED is refused at the caller's `refuse` code, naming the path
   * and the errno; it used to escape `readdirSync` uncaught and take node's own exit 1, the code
   * this contract reserves for HITS FOUND. A MISSING root is skipped by the WALK, which is unchanged
   * from the copied scanners, and is then caught by the rule below.
   *
   * 🛑 EVERY ROOT MUST YIELD AT LEAST ONE FILE THE WALK READ, OR `all` MODE REFUSES AND NAMES THE
   * STARVED ROOTS. That is what closes the class the paragraph above used to end with: a root that
   * contributes nothing WITHOUT SAYING SO. All three of the known members are in it - a missing
   * root, an UNREADABLE root (reported the same way a missing one is), and a root whose every file
   * the read filter drops, which is what a `.md` file root does under the default
   * `isWalkReadable`. A root is a scope decision, and a scope decision that silently selected
   * nothing is the sweep reporting on a corpus it never had.
   *
   * THE INDEX HALF NEVER CREDITS A ROOT. A root that is missing or empty on disk is starved even
   * when git tracks files under it: those files are still read from the bytes git carries, and any
   * hit in them is reported before the refusal, but what git carries cannot vouch for a directory
   * on disk.
   */
  scanRoots: readonly string[];

  /**
   * AXIS 3, REQUIRED: the READ half of scope for `--staged`. Widening it changes what a COMMIT is
   * blocked on, which is a hook decision each repo takes for itself.
   *
   * IT MUST STAY INSIDE `scanRoots`, AND THE ENGINE ENFORCES THAT RATHER THAN ASSUMING IT. This
   * doc used to say "narrower than the root half by construction", and nothing constructed it:
   * these are two independent keys. A reviewer measured the gap with roots at `["src"]` and this
   * filter at `exemptsMarkdown`: a STAGED symbolic link under `test/fixtures/` was outside every
   * scan root, so the non-regular refusal never saw it, and the route read the link's TARGET PATH
   * as if it were content and reported clean at exit 0. A staged path this admits and no scan root
   * covers is now REFUSED, naming the path.
   *
   * 🛑 THIS PREDICATE ALSO DECIDES WHAT THE `--staged` ROUTE REFUSES, which is a change. Its
   * non-regular and unmerged refusals used to key on the ROOT half of scope, so a caller whose
   * staged scope is narrower than its roots had commits blocked that its own gate had always let
   * through. What a commit is blocked on is this key's job. THE COST: a staged non-regular entry
   * this predicate declines is no longer refused HERE. `all` mode still refuses it twice over (the
   * walk classifies it under a scan root, and the index route refuses the tracked record wherever it
   * sits), so a repository's own sweep still does. Recorded as N1 in
   * `documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md`; widen this predicate if
   * you want the wider refusal.
   */
  isStagedReadable: (relPath: string) => boolean;

  /**
   * AXIS 2, the subtractive half. Repo-relative paths NO route reads: not the walk, not the index
   * union, not `--staged`.
   *
   * EXCLUDE A LITERAL PATH, NEVER A CLASS. A "skip binary blobs" predicate was measured to drop two
   * of a sibling's hand-written sources, which embed NUL bytes as HMAC domain separators. A literal
   * path is reviewable in a diff; a class quietly grows new members. Each entry is a file the scan
   * has NO verdict about, so each one wants a comment saying why.
   *
   * @default new Set()
   */
  excludedPaths?: ReadonlySet<string>;

  /**
   * AXIS 2, the READ half of scope for the two SWEEPING routes. Defaults to the shared Markdown
   * exemption, and the default is the point: moving that boundary is then one change here rather
   * than one edit per repo.
   *
   * @default exemptsMarkdown
   */
  isWalkReadable?: (relPath: string) => boolean;

  /**
   * AXIS 4: git's modes for a regular blob. Every other mode names something with no bytes to read
   * at that path, and is refused rather than skipped.
   *
   * @default new Set(["100644", "100755"])
   */
  regularBlobModes?: ReadonlySet<string>;

  /** @default process.cwd() */
  repoRoot?: string;

  /** @default process.argv.slice(2) */
  argv?: string[];

  /** @default <repoRoot>/scripts/phi-allow-list.txt */
  allowListPath?: string;

  /** @default <repoRoot>/phi-scan-overrides.md */
  overrideLogPath?: string;

  /**
   * The per-standard, field-level detection this engine deliberately does not own: names, DOB,
   * MRN / member id, address, phone. Parse the wire format properly rather than bolting a blind text
   * regex onto it; coded values produce false confidence.
   */
  detect?: DetectFn;
}

/**
 * Run the PHI scan and return an exit code drawn from `config.exitCodes`. Nothing here calls
 * `process.exit`, so a test can drive the engine in-process.
 *
 * @throws {TypeError} When a required axis is missing or malformed. That is a misconfigured scanner
 *   rather than a scan result, it lands on the author's first run, and it must not be reportable as
 *   a clean pass.
 * @example
 *   process.exit(
 *     runPhiScan({
 *       exitCodes: { clean: 0, hits: 1, refuse: 2 },
 *       scanRoots: ["."],
 *       isStagedReadable: (p) => p.startsWith("test/fixtures/"),
 *     }),
 *   );
 */
export declare function runPhiScan(config: PhiScanConfig): number;

/**
 * The shared Markdown read-exemption, and the default value of `isWalkReadable`.
 *
 * Markdown is documentation rather than fixture data and may legitimately describe a violator value.
 * The consequence, stated because it is route-dependent rather than file-dependent: a tracked `.md`
 * is read by NEITHER sweeping route, while a `.md` named explicitly on argv IS scanned.
 */
export declare function exemptsMarkdown(relPath: string): boolean;
