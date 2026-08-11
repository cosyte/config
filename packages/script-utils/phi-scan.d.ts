/**
 * Types for `@cosyte/script-utils/phi-scan`: the `@cosyte/*` PHI commit-gate.
 *
 * THE ENGINE OWNS THE PROCESS AND THE CALLER DECLARES DATA. Process is walking, reading,
 * enumeration, the union of the walk with the bytes git carries, staged-blob handling, completeness
 * and its bookkeeping, reporting, exit codes, refusals, and the process TAIL. A consuming repo
 * declares roots, exclusions, allow-list conventions, views and detector vocabularies.
 *
 * THE DESIGN RULE, from a measurement rather than a taste: twelve repos derived against 0.0.2 and
 * every defect they found made the gate WEAKER THAN DECLARED and said nothing. So wherever a
 * parameter can be misdeclared, misparsed, unsupported or ignored, the engine REFUSES.
 */

/** A reported PHI finding. `path` is the LOCUS the engine chose, never a path the caller invents. */
export interface Hit {
  /** The reported locus: the target's repo-relative path, plus an origin label when it has one. */
  path: string;
  /** A locator inside the target: `(ssn)`, `(email)`, or an id from a declared vocabulary entry. */
  segment: string;
  /** The offending value, as found. */
  value: string;
  /** Why it was raised, in a few words. */
  reason: string;
}

/**
 * The positive declaration that specific identifiers are synthetic, parsed from the allow-list file.
 *
 * EVERY BUCKET ALWAYS EXISTS. Which TAG fills which bucket is `allowListTags`, and a tag no entry
 * names is a REFUSAL rather than a silent drop — the parser used to have a `default: break`, and
 * five repos measured the cost as hits over values their own allow-list already declared synthetic.
 */
export interface AllowList {
  /** Uppercase synthetic person-name tokens. */
  names: Set<string>;
  /**
   * Synthetic dates of birth, STORED VERBATIM AND COMPARED VERBATIM. One repo declares a
   * deliberately truncated date pinning a partial-timestamp fixture, and any normalising
   * implementation silently drops that declaration and every fixture behind it.
   */
  dobs: Set<string>;
  /** Synthetic id values, uppercased. Also read by the SSN floor, in both renderings. */
  ids: Set<string>;
  /** Synthetic street-address lines, lowercased. */
  addresses: Set<string>;
  /** Uppercase synthetic locality tokens. */
  cities: Set<string>;
  /** Synthetic postal codes, verbatim. */
  zips: Set<string>;
  /** Synthetic telephone numbers, reduced to digits. */
  phones: Set<string>;
  /** Whole synthetic mailboxes, lowercased. */
  emails: Set<string>;
  /**
   * Path-scoped mailboxes, keyed `<repo-relative path> <lowercased address>`. Widening a whole
   * domain to clear one address is a real subtraction on the commit-blocking route, and one repo
   * correctly refused to take it.
   */
  scopedEmails: Set<string>;
  /** Allowed email domains, lowercased. Anything else is a hit. */
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
  /** Where these bytes came from, when it is not simply the file at `path`. Decorates the LOCUS. */
  origin?: string;
}

/** An entry the enumeration reached and cannot scan. Both fields are safe to print. */
export interface Unscannable {
  path: string;
  /** A token from the engine's own closed set. Never text off the other side of a link. */
  kind: string;
}

/** The three codes this repo's own exit contract assigns. All three must differ. */
export interface PhiScanExitCodes {
  /** The scan ran, read every target it enumerated, and found nothing. */
  clean: number;
  /** This corpus contains something that looks like PHI. */
  hits: number;
  /** Every state the engine RAISES in which the scan cannot account for something. */
  refuse: number;
}

/**
 * A scan root. ONE TYPE REPLACING SEVEN LIVE SPELLINGS.
 *
 * `abs` IS NOT A FIELD and declaring one is a `TypeError`. In every live `{abs, rel}` pair
 * `abs === join(repoRoot, rel)`, so it carried no information: `abs` fed the directory read and
 * `rel` fed the git pathspec and the refusal text, and both are process. Two repos re-derived this
 * independently.
 */
export type ScanRootSpec =
  | string
  | {
      /** Repo-relative, normalised the way every other path is. */
      rel: string;
      /**
       * What this root IS. DECLARED AND CHECKED, NEVER DERIVED: deriving is what let a corpus root
       * replaced by a one-line file through, where the sweep read the file, the per-root observation
       * rule saw something read, and a run went from refusing to clean. A mismatch REFUSES.
       *
       * A `"file"` root BYPASSES the read filter, because naming a file as a root is the same
       * explicit act as naming it on the command line.
       *
       * @default "directory"
       */
      shape?: "directory" | "file";
      /**
       * Walk it. `false` keeps the path in scope for every index-keyed rule without enumerating it,
       * which is the second root list one repo keeps for directories that must EXIST and must not be
       * walked. A flat list merges two roles.
       *
       * @default true
       */
      walk?: boolean;
      /**
       * Refuse when this root yields no file the run actually READ. Derived independently by two
       * repos, which between them measured two silent refuse-to-clean losses it catches: a root
       * absent with its files untracked, and a root starved by gitignore.
       *
       * @default true
       */
      require?: boolean;
    };

/** What a caller's own `detect` is handed for one target. */
export interface DetectContext {
  /**
   * The reported LOCUS, already carrying any origin label. Raise hits against this and nothing else.
   */
  path: string;
  /**
   * The UNDECORATED repo-relative path. Key path- and extension-dependent logic on THIS.
   *
   * SIX REPOS DERIVED THIS INDEPENDENTLY, and two measured what its absence costs: an
   * extension-keyed detector stops matching once the origin label is appended, so one repo silently
   * lost a whole detector class on the union half (a tracked blob carrying a name and a birthdate
   * went from three hits to a clean exit 0) and another gained a wrong one. Two of them REFUSED to
   * strip the label caller-side, correctly: parsing engine-owned text narrows silently.
   */
  targetPath: string;
  /** The origin label, when these bytes are not the file at `targetPath`. */
  origin?: string;
  /** The target's bytes decoded as UTF-8, raw. */
  text: string;
  /** The target's bytes, for a byte-strict format. */
  bytes: Buffer;
  /** Every view the engine produced, `raw` first. Additive: a view can only add a finding. */
  views: { id: string; text: string }[];
  /** The parsed allow-list. */
  allow: AllowList;
  /** Raise a hit. The locus is filled in by the engine. */
  hit: (h: Omit<Hit, "path">) => void;
  /**
   * Report that this target was READ but not read TO THE END.
   *
   * `reason` must come from `partialReasons`; anything else throws, which is what stops
   * payload-derived text reaching a diagnostic. The tally is printed uncapped, and it demotes the
   * clean line's wording. It does NOT move the exit code unless `partialExit` says so.
   */
  partial: (p: { bytes: number; reason: string }) => void;
}

/**
 * A per-repo detector the declarative surface cannot express, and the boundary is deliberate.
 *
 * 🛑 THE THROWN MESSAGE IS PRINTED VERBATIM, so it reaches CI logs. Name the position, never the
 * content: a parser that interpolates the record it choked on turns a diagnostic into a PHI surface.
 */
export type DetectFn = (ctx: DetectContext) => void;

/**
 * A named reserved space: a region of a value's domain that is itself a provenance marker, so a
 * value inside it cannot belong to a person and needs no per-literal declaration.
 *
 * 🛑 THERE IS NO RESERVED DATE-OF-BIRTH SPACE, which is a stated limit of this gate rather than an
 * omission: the `dob` kind can only ever be a declaration check.
 */
export type ReservedSpace = "nanp-fictional" | "ssa-never-issued" | "reserved-domain";

/** The buckets an allow-list tag can fill. */
export type AllowBucket = keyof AllowList;

/**
 * A value rule the engine ships.
 *
 * 🛑 THE KIND SET IS DECLARED AND OPEN, AND SEVERAL REPOS LEGITIMATELY FILL NONE. The premise this
 * work began from — five universal kinds, only the vocabulary differing — was refuted on both axes:
 * one repo has no address, phone or identifier vocabulary; one declares no field vocabulary at all,
 * correctly, because its corpus is code-system content rather than patient demographics; one has no
 * address; and one has no date-of-birth detector, its date tags being study and acquisition dates
 * under a wall-clock-relative rule that no token set can hold.
 */
export type FieldKind =
  | "name"
  | "dob"
  | "id"
  | "address"
  | "city"
  | "postal-code"
  | "phone"
  | "email";

/**
 * A guard: an equality test over a SIBLING POSITION in the same record, and nothing else.
 *
 * This is where the parameterization stops on purpose. Conjunctive equality over a position is a
 * table; conditionals, arithmetic and negation would be an expression language, and a PHI detector
 * written in a hand-rolled DSL is harder to review than a function. Anything beyond this stays in
 * `detect`.
 */
export interface FieldGuard {
  field?: number;
  component?: number;
  attr?: string;
  oneOf: string[];
}

/** One vocabulary entry: a POSITION, an optional guard, and a named value rule. */
export interface FieldSpec {
  /** The record id this entry keys on. Omitted means every record. */
  record?: string;
  /** The field index within the record. @default 0 */
  field?: number;
  /** The component index within the field. Omitted means every component. */
  component?: number;
  /** An attribute name, for the `xml` grammar. */
  attr?: string;
  guard?: FieldGuard[];
  kind: FieldKind;
  /** Which allow-list bucket answers this entry. Defaults to the kind's own bucket. */
  bucket?: AllowBucket;
  /** Reserved spaces that answer this entry without a per-value declaration. */
  reservedSpaces?: ReservedSpace[];
  /** The shape a value must have before the declaration is consulted. */
  pattern?: RegExp;
  minDigits?: number;
  maxDigits?: number;
  digitsOnly?: boolean;
  /** Tokens that are not name evidence. Defaults to the shared honorific/credential set. */
  noise?: Iterable<string>;
  /** The locator printed on a hit. */
  id?: string;
  reason?: string;
}

/** A declared detector: a grammar, what it applies to, and its vocabulary. */
export interface DetectorSpec {
  id: string;
  /**
   * `delimited-record` covers HL7 v2, X12 and ASTM — the same shape with different numbers, so one
   * parameter serves three repos. `json` REFUSES a target it cannot parse.
   */
  grammar:
    | {
        kind: "delimited-record";
        /** Records whose id declares the delimiters. @default ["MSH"] */
        headerRecordIds?: string[];
        /** @default 3 */
        recordIdLength?: number;
        /** @default recordIdLength */
        fieldSeparatorOffset?: number;
        componentSeparatorOffset?: number;
        fallback?: { field: string; component: string };
        /** @default 4 */
        minRecordLength?: number;
      }
    | { kind: "xml" }
    | { kind: "json" };
  /**
   * Which targets carry this format. REQUIRED for a grammar that can refuse, checked at
   * configuration time: without it a strict grammar would refuse on every file in the corpus.
   */
  appliesTo?: {
    pathSuffixes?: string[];
    pathPrefixes?: string[];
    contentMarker?: RegExp;
  };
  fields: FieldSpec[];
  /**
   * Restrict this detector's vocabulary to the records BEFORE the first record of this kind. One
   * repo measured that without it the same element name means a patient in the header and a drug in
   * the body, and checking both makes the gate fire on purpose-built fixtures until someone turns
   * it off.
   */
  regionEndsAt?: string;
}

export interface PhiScanConfig {
  /**
   * AXIS 1, REQUIRED. There is deliberately no default: the sibling `@cosyte/*` scanners do not
   * agree on these numbers, and a caller that branches on the code (CI does) must read this repo's
   * own contract rather than an inherited one.
   */
  exitCodes: PhiScanExitCodes;

  /**
   * AXIS 2, REQUIRED, AND IT HAS NO SAFE DEFAULT IN EITHER DIRECTION. Five repos need the whole
   * repository; two measured that the whole repository exits on their own manifest's author
   * address, and both remedies are worse than the narrow roots. Five more measured that copying a
   * sibling's narrow roots silently drops tracked files their index union already read — 18, 19 and
   * 49 files in three of them. DERIVE it; never port it.
   */
  scanRoots: readonly ScanRootSpec[];

  /**
   * AXIS 3: the roots `--staged` reads, which is what a COMMIT is blocked on.
   *
   * IT REPLACES `isStagedReadable`, AND THAT IS A CONTAINMENT FIX RATHER THAN A RENAME. A predicate
   * and a root list were two independent keys with nothing relating them, and a reviewer measured
   * what that cost: a staged mode-120000 entry the predicate admitted and no root covered was
   * enumerated, read, had the link's TARGET PATH handed to a detector as content, and reported clean
   * at exit 0. Two declared lists are compared at configuration time instead.
   *
   * @default the `rel` of every `scanRoots` entry
   */
  stagedRoots?: readonly string[];

  /**
   * AXIS 2, the subtractive half: paths NO route reads. EXCLUDE A LITERAL PATH, NEVER A CLASS — a
   * "skip binary blobs" predicate was measured dropping two of a repo's hand-written sources, which
   * embed NUL bytes as domain separators.
   *
   * `routes` DECLARES what was previously an undeclared fixed policy: consulted by the walk, the
   * index and `--staged`, and by none of them for a path named on argv. Every exclusion is
   * ANNOUNCED on every run.
   *
   * @default { paths: new Set(), routes: ["walk", "index", "staged"] }
   */
  excludedPaths?:
    | ReadonlySet<string>
    | { paths: ReadonlySet<string>; routes?: ("walk" | "index" | "staged" | "named")[] };

  /**
   * Read this file and ACCOUNT for it, but run no detector and no floor over it.
   *
   * IT CANNOT FOLD INTO `excludedPaths`, which withdraws the path before the read: one says "this
   * run has no verdict here", the other says "read it, and choose not to judge it", and only the
   * second stays inside completeness accounting. Measured: an exempt path at mode 000 went from
   * refusing to clean when the two were conflated.
   *
   * @default new Set()
   */
  detectorExemptPaths?: ReadonlySet<string>;

  /**
   * Repo-relative prefixes whose bytes are never read, as DATA.
   *
   * `excludedPaths` cannot cover it: it is exact-match, and one repo's six vendored tarball names
   * carry versions, so a re-pack silently renames one out of the list. Note the polarity — this
   * subtracts a READ, never SCOPE, so a link named under such a prefix is still refused rather than
   * buying a pass on its name.
   *
   * @default []
   */
  unreadablePrefixes?: readonly string[];

  /**
   * AXIS 2, the READ half of scope, for every sweeping route.
   *
   * 🛑 THE DEFAULT READS EVERYTHING, AND THAT IS A FLIP FROM 0.0.2. The old default exempted
   * Markdown, so a Markdown scan root read nothing and reported clean at exit 0 over a live dashed
   * identifier, and a tracked `.md` was read by NEITHER sweeping route while `README.md` and
   * `CHANGELOG.md` ship inside the npm tarball. Six of thirteen repos measured they needed it gone.
   * `exemptsMarkdown` is still exported for a repo that declares the exemption deliberately.
   *
   * @default readsEverything
   */
  isReadable?: (relPath: string) => boolean;

  /**
   * AXIS 4: git's modes for a regular blob. Every other mode names something with no bytes to read
   * at that path, and is refused rather than skipped.
   *
   * @default new Set(["100644", "100755"])
   */
  regularBlobModes?: ReadonlySet<string>;

  /**
   * A second VIEW of a target's bytes: the string-escape sequences a TypeScript or JavaScript source
   * uses, decoded, so a wire payload written as a literal is judged as the bytes it stands for.
   * Derived independently by three repos, and it replaces two siblings' hand-written
   * embedded-payload extractors. Strictly ADDITIVE: the raw view is scanned too.
   *
   * 🛑 `appliesTo` IS REQUIRED AND HAS NO DEFAULT. A repo whose WIRE FORMAT is itself source-shaped
   * would have its payload escape-decoded, which fabricates content: one repo needs `.json` in the
   * list and another needs it out, for exactly this reason.
   *
   * @default []
   */
  textViews?: { kind: "source-literals"; appliesTo: string[]; holePattern?: RegExp }[];

  /**
   * The cross-cutting floor. A branch may be turned off with `false`, which is a real subtraction
   * and is therefore spelled at the call site.
   *
   * `reservedSpaces` is how a repo declares a CONVENTION rather than literals: declaring five
   * never-issued SSN literals as `ID` entries is exactly the hand-maintenance this work deletes.
   */
  floor?: {
    ssn?: false | { reservedSpaces?: ReservedSpace[] };
    email?: false | { reservedSpaces?: ReservedSpace[] };
  };

  /** The declared vocabularies. A repo may declare several; one repo carries three. */
  detectors?: readonly DetectorSpec[];

  /** The closed table of reasons `ctx.partial` may name. @default [] */
  partialReasons?: readonly string[];

  /**
   * Whether a partial read moves the exit code.
   *
   * 🛑 `"clean"` IS THE DEFAULT AND IT IS DELIBERATE. In the one repo that needs this channel, a
   * halt reason is reachable by a CONFORMANT file, so refusing on it would red-lock legal input and
   * would MASK a real hit whenever both were present in one run. What a partial read always does is
   * remove the word `OK` from the clean line.
   *
   * @default "clean"
   */
  partialExit?: "clean" | "refuse";

  /**
   * What to do when an UNTRACKED walk target vanishes between enumeration and the read.
   *
   * 🛑 THE DEFAULT REFUSES, AND TOLERANCE IS OPT-IN. Tolerating is only defensible with ALL THREE of
   * its halves — tracked paths never tolerated, ENOENT and nothing else, and a post-sweep re-check
   * that refuses on a path which came back — and carrying one or two of the three is worse than
   * refusing. The repo that authored the tolerance accepts refusal for itself.
   *
   * @default "refuse"
   */
  vanishedUntrackedWalkTarget?: "refuse" | "report-unobserved";

  /** The allow-list tag namespace. An undeclared tag REFUSES. @default the nine canonical tags */
  allowListTags?: readonly { tag: string; bucket: AllowBucket; fold?: string; arity?: 1 | 2 }[];

  /** @default process.cwd() */
  repoRoot?: string;
  /** @default process.argv.slice(2) */
  argv?: string[];
  /** @default <repoRoot>/scripts/phi-allow-list.txt */
  allowListPath?: string;
  /** @default <repoRoot>/phi-scan-overrides.md */
  overrideLogPath?: string;

  /** The residue the declarative surface deliberately cannot express. */
  detect?: DetectFn;
}

/**
 * Run the PHI scan and return an exit code drawn from `config.exitCodes`. Nothing here calls
 * `process.exit`, so a test can drive the engine in-process.
 *
 * @throws {TypeError} When an axis is missing or malformed. That is a misconfigured scanner rather
 *   than a scan result, it lands on the author's first run, and it must not be reportable as clean.
 */
export declare function runPhiScan(config: PhiScanConfig): number;

/**
 * THE PROCESS TAIL, SHIPPED ONCE. Run the scan, deliver its report in full, and end the process with
 * the right status. Every repo's scanner is one call to this.
 *
 * 🛑 IT EXISTS BECAUSE THE OBVIOUS TAIL IS WRONG AND SO IS THE OBVIOUS FIX. Measured over 2,000
 * hits against two consumer shapes: `process.exit(runPhiScan(...))` delivered 86 of 2,000 hit lines
 * and no summary to a reader that had not drained stderr; `process.exitCode = runPhiScan(...)` hung
 * against an open, never-drained pipe AND turned a clean run into the HITS code through an uncaught
 * `EPIPE`; the same plus an `EPIPE` guard still hung. A hang in a pre-commit hook is worse than a
 * truncated report.
 *
 * `process.exit` discharges four obligations at once — set the status, abandon the write queue,
 * swallow `EPIPE`, force termination. The exit code is computed from the findings BEFORE anything is
 * written, so it never depended on delivery. This restores all four explicitly and separately, so
 * the report is delivered in full when the reader drains, and the run still terminates when it does
 * not, with the same status on every path.
 */
export declare function runPhiScanCli(config: PhiScanConfig & { drainGraceMs?: number }): void;

/** The read filter that reads everything, and the default value of `isReadable`. */
export declare function readsEverything(relPath: string): boolean;

/**
 * The Markdown read-exemption, kept as an EXPLICIT OPT-IN rather than as the default. A repo
 * declaring this chooses not to read its own `.md` on the sweeping routes, which is the third of
 * this item's three escape classes.
 */
export declare function exemptsMarkdown(relPath: string): boolean;

/** The named reserved spaces, exported so a repo can assert against the same table the engine uses. */
export declare const RESERVED_SPACES: Record<ReservedSpace, (value: string) => boolean>;
