/**
 * Types for `@cosyte/script-utils/internal-refs`: the shared internal-reference gate.
 *
 * The engine owns the canonical rule set, the self-test floor, enumeration, the completeness rule,
 * the tarball drift tripwire, every refusal and the hit report. The caller owns the axes below: what
 * its prefixes are, which standards designations must never be flagged, what its public surface is,
 * what its tarball already accounts for, and whether the source doc-comment pass runs.
 */

/** One entry of the documented configuration surface. */
export interface ConfigAxis {
  /** The option name a caller writes. */
  name: string;
  /** `true` when there is deliberately no default, because it is the axis a port gets wrong. */
  required: boolean;
  /** `true` when an empty value is refused as well as an absent one. */
  refusesEmpty: boolean;
  /** What the default is, in words, for a defaulted axis. */
  default?: string;
  /** What the axis decides. */
  summary: string;
}

/**
 * THE DOCUMENTED CONFIGURATION SURFACE, enumerable rather than only readable.
 *
 * A grader walks this table to assert that no value of any axis makes a run which found something
 * exit 0. Prose quantifying over "any flag or setting" cannot be failed by a test; a table can.
 */
export declare const CONFIG_AXES: readonly ConfigAxis[];

/** The three codes this gate returns. */
export interface InternalRefsExitCodes {
  /** The run completed, read every target it enumerated, passed its self-tests and found nothing. */
  clean: number;
  /** This surface carries internal bookkeeping. */
  hits: number;
  /** The run could not account for something, so its answer is not a verdict on the tree. */
  refuse: number;
}

/** A rule a caller ADDS. It joins the canonical set and the self-test floor on the same terms. */
export interface ExtraRule {
  /** A stable id of the caller's own. Reusing a canonical id is refused. */
  id: string;
  /** What a hit report calls it. */
  name: string;
  /** One pattern, as a source string or a `RegExp`. */
  pattern?: string | RegExp;
  /** Several patterns, when one rule needs two case policies. */
  patterns?: (string | RegExp)[];
  /** Text this rule MUST match. At least one is required. */
  positives: string[];
  /** Text this rule must NOT match. At least one is required: it is what stops a widening. */
  negatives: string[];
}

/** Additive self-test material, keyed by rule id. Nothing here can remove a canonical sample. */
export type ExtraSamples = Record<string, { positives?: string[]; negatives?: string[] }>;

/** Whether the source doc-comment pass runs, over what, and with which extra rules. */
export interface SourceDocCommentsAxis {
  /** @default false */
  enabled: boolean;
  /** Tracked pathspecs holding the source whose doc comments compile into shipped declarations. */
  paths?: string[];
  /** Detection that applies to the source surface only. */
  extraRules?: ExtraRule[];
}

export interface InternalRefsConfig {
  /**
   * AXIS 1, REQUIRED. The project and programme prefixes an identifier is keyed on, and an empty
   * set is refused.
   *
   * KEYING ON KNOWN PREFIXES RATHER THAN ON A `WORD-N` SHAPE IS THE WHOLE DESIGN. A shape rule
   * flags `MSH-2`, `PID-3` and `OBX-5`, which are segment-field references a consumer of a parser
   * needs, and so destroys the documentation the gate was added to protect. The cost is that a new
   * programme means adding its prefix here by hand; that is the cheaper of the two mistakes.
   */
  projectPrefixes: string[];

  /**
   * AXIS 2, REQUIRED. Regular-expression sources for standards designations that must NEVER be
   * flagged, even where they collide with a prefix.
   *
   * An explicitly empty list is accepted and declares that this repository's docs carry no
   * designation that collides. Omitting the axis is refused, because "there are none" and "nobody
   * thought about it" must not look the same.
   */
  standardsDesignations: string[];

  /**
   * AXIS 3, REQUIRED. The public surface, as repo-relative paths, and an empty list is refused.
   * Every entry must be tracked: a renamed page otherwise shrinks the scan in silence.
   */
  surfacePaths: string[];

  /**
   * AXIS 4, REQUIRED. The `package.json` `files` entries this repository has already accounted for,
   * by scanning them or by excluding them deliberately.
   *
   * `surfacePaths` counts as accounted, so this axis carries the DELIBERATE EXCLUSIONS. Anything in
   * `files` that appears in neither list trips the tarball drift tripwire, because it is public
   * surface a consumer receives that this gate does not read.
   */
  accountedTarballFiles: string[];

  /**
   * AXIS 5, DEFAULTED OFF. The source doc-comment pass.
   *
   * @default { enabled: false }
   */
  sourceDocComments?: SourceDocCommentsAxis;

  /**
   * AXIS 6, DEFAULTED. `clean` must be 0 and the other two must not be, which is checked: a mapping
   * that put `hits` on 0 would turn every finding into a green run.
   *
   * @default { clean: 0, hits: 1, refuse: 1 }
   */
  exitCodes?: InternalRefsExitCodes;

  /**
   * Detection this repository ADDS. A caller may add and may not subtract.
   *
   * @default []
   */
  extraRules?: ExtraRule[];

  /**
   * Extra self-test samples for the canonical rules, keyed by rule id. This is where a repository's
   * own measured reference material lives: the concrete designations, field names and phrasings its
   * documentation legitimately carries.
   *
   * @default {}
   */
  extraSamples?: ExtraSamples;

  /**
   * Where the repository under test is. The scan anchors at its git top level either way.
   *
   * @default process.cwd()
   */
  repoRoot?: string;

  /**
   * Where the report goes. It changes where text lands and nothing about what the run concludes.
   *
   * @default process.stdout.write / process.stderr.write
   */
  write?: { out?: (text: string) => void; err?: (text: string) => void };
}

/** A compiled rule, as the self-test floor and a conformance corpus see it. */
export interface CompiledRule {
  id: string;
  name: string;
  patterns: RegExp[];
  positives: string[];
  negatives: string[];
}

/**
 * Run the gate and return an exit code drawn from `config.exitCodes`. Nothing here calls
 * `process.exit`, so a test can drive it in process.
 *
 * @example
 *   process.exit(
 *     runInternalRefsScan({
 *       projectPrefixes: ["HL7", "CCDA"],
 *       standardsDesignations: ["HL7-(?:V2|V3|CDA)"],
 *       surfacePaths: ["README.md", "docs-content"],
 *       accountedTarballFiles: ["CHANGELOG.md", "dist"],
 *     }),
 *   );
 */
export declare function runInternalRefsScan(config: InternalRefsConfig): number;

/** The canonical rule set's identity: a stable id and the name a hit report prints, in run order. */
export declare const CANONICAL_RULE_INDEX: readonly { id: string; name: string }[];

/**
 * What the scan may do with one tracked entry, from the mode `git ls-files -s` recorded for it.
 *
 * `skip` is a gitlink and is the only entry the scan may pass over; `read` is a regular blob or a
 * symbolic link; `refuse` is everything else, including a mode this version has never seen.
 */
export declare function classifyTrackedMode(mode: string): "skip" | "read" | "refuse";

/** The reader-facing names of the canonical rules, in the order they run. */
export declare function canonicalRuleNames(): string[];

/** Compile the canonical rule set against one resolved configuration. */
export declare function compileCanonicalRules(resolved: InternalRefsConfig): CompiledRule[];

/** Check a caller's configuration and fill in the defaults, without running anything. */
export declare function resolveConfig(config: unknown): {
  resolved?: InternalRefsConfig;
  problems?: string[];
  codes: InternalRefsExitCodes;
};

/** Prove every rule still matches its positives and still lets its negatives through. */
export declare function runSelfTests(rules: CompiledRule[]): string[];

/** Join a document the way markdown renders it, so a violation that straddles a wrap is visible. */
export declare function reflowParagraphs(text: string): string[];

/** Extract doc-comment text from one source file, with each line's location beside it. */
export declare function extractDocComments(
  text: string,
  file: string,
): {
  lines: { text: string; where: string }[];
  paragraphs: { text: string; where: string }[];
};

/** The defaulted exit-code mapping. */
export declare const DEFAULT_EXIT_CODES: InternalRefsExitCodes;

/** Option names refused by name, with the reason each one is not something a caller may supply. */
export declare const REFUSED_OPTIONS: ReadonlyMap<string, string>;
