/**
 * Types for `@cosyte/script-utils/phi-scan`: the shared machinery of the `@cosyte/*` PHI
 * commit-gate.
 *
 * The engine owns enumeration, the union of the working-tree walk with the bytes git carries,
 * content deduplication, the completeness rule, the refusals and the cross-cutting SSN/email floor.
 * The caller owns the five per-repo axes below and the per-standard field detectors.
 */

/** A reported PHI finding. `path` is the LOCUS the engine chose, never a path the caller invents. */
export interface Hit {
  /** The reported locus: the target's repo-relative path, plus an origin label when it has one. */
  path: string;
  /** A locator inside the target: `(ssn)`, `(email)`, or a field id from a per-standard detector. */
  segment: string;
  /** The offending value, as found. */
  value: string;
  /** Why it was raised, in a few words. */
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

/** A per-standard field detector. Throwing REFUSES the scan rather than taking node's exit code. */
export type DetectFn = (ctx: DetectContext) => void;

/** The three codes this repo's own exit contract assigns. All three must differ. */
export interface PhiScanExitCodes {
  /** The scan ran, read every target it enumerated, and found nothing. */
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
   * AXIS 2, REQUIRED: the roots `all` mode walks, repo-relative and forward-slashed. `["."]` means
   * the whole repository, which is the only honest setting for a repo that has not yet decided what
   * its corpus is. A ROOT IS A SCOPE DECISION AND IT IS THE AXIS MOST LIKELY TO BE WRONG IN A PORT:
   * measure what a narrowing stops reading, rather than assuming it stops reading nothing.
   */
  scanRoots: readonly string[];

  /**
   * AXIS 3, REQUIRED: the READ half of scope for `--staged`. Narrower than the root half by
   * construction. Widening it changes what a COMMIT is blocked on, which is a hook decision.
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
