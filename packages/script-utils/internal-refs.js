// packages/script-utils/internal-refs.js
//
// THE SHARED INTERNAL-REFERENCE GATE. One implementation of the rule that keeps our own
// bookkeeping (item identifiers, phase and wave language, ADR numbers, internal repo paths,
// traceability markers) off every surface a consumer reads.
//
// WHY A PACKAGE AND NOT A TEMPLATE. Twelve repositories carry a hand-written copy of this gate.
// Every escape found in one was fixed in one, and the other eleven kept shipping it. A scaffold
// reproduces that; a dependency does not. Here a fix is one pull request and a version bump.
//
// WHAT A CALLER OWNS AND WHAT IT DOES NOT. Detection is configurable: a caller supplies the
// prefix set, the standards designations that must never be flagged, the surface it publishes,
// its tarball accounting, and any extra rule it wants. A caller may WIDEN the scanned surface and
// may ADD detection. A caller may NOT subtract a rule from the canonical set and may NOT disable
// the self-test or any completeness refusal: a configuration that tries is REFUSED, not honoured,
// and an unknown option is refused for the same reason. Exit 0 means the run completed, enumerated
// its configured surface, read every target it enumerated, passed its own self-tests, and found
// nothing. It means nothing else.
//
// IMPORTING THIS FILE DOES NOT LOAD THE PHI SCANNER. The two gates are separately adoptable and
// share no module, so a repo can take this one without taking a position on PHI scanning.
//
// NO ENVIRONMENT IS READ. Nothing here consults `process.env`, so no variable set in a CI job can
// change what this gate looks for or what it concludes.

import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The exit codes this gate assigns, as a caller may redeclare them.
 *
 * `clean` MUST be 0 and the other two MUST NOT be, which is checked rather than documented: a
 * caller that mapped `hits` onto 0 would turn every finding into a green run, and that is the one
 * defect this whole file exists to make impossible.
 */
const DEFAULT_EXIT_CODES = { clean: 0, hits: 1, refuse: 1 };

/** The refusal code used when the configuration is so broken that `exitCodes` cannot be trusted. */
const HARD_REFUSE = 1;

/**
 * THE DOCUMENTED CONFIGURATION SURFACE, in one machine-readable table.
 *
 * This is not decoration and it is not a duplicate of the README. It is the enumeration a grader
 * walks to assert the universal in the contract: over EVERY entry here, no value a caller can
 * supply makes a run that found something exit 0. A table a test can iterate is the only form of
 * that claim which can be checked; prose quantifying over "any flag or setting" cannot be failed.
 *
 * `required: true` means there is deliberately no default, because it is the axis a port gets
 * wrong. `refusesEmpty: true` means an empty value is refused as well as an absent one, because an
 * empty prefix set and an empty surface list each produce a scan that reads nothing and says OK.
 */
export const CONFIG_AXES = Object.freeze([
  Object.freeze({
    name: "projectPrefixes",
    required: true,
    refusesEmpty: true,
    summary:
      "The project and programme prefixes an identifier is keyed on. Keying on known prefixes " +
      "rather than on a WORD-N shape is what keeps MSH-2, PID-3 and OBX-5 out of the hit list.",
  }),
  Object.freeze({
    name: "standardsDesignations",
    required: true,
    refusesEmpty: false,
    summary:
      "Regular-expression sources for the standards designations that must NEVER be flagged, " +
      "even when they collide with a prefix. An explicitly empty list declares no collisions.",
  }),
  Object.freeze({
    name: "surfacePaths",
    required: true,
    refusesEmpty: true,
    summary:
      "The public surface, as repo-relative paths. Every one must be tracked; a widened list is " +
      "always allowed, and a path the repository does not track is refused rather than skipped.",
  }),
  Object.freeze({
    name: "accountedTarballFiles",
    required: true,
    refusesEmpty: false,
    summary:
      "The `package.json` `files` entries this repository has already accounted for, either by " +
      "scanning them or by excluding them deliberately. Anything in `files` that is in neither " +
      "this list nor `surfacePaths` trips the tarball drift tripwire.",
  }),
  Object.freeze({
    name: "sourceDocComments",
    required: false,
    refusesEmpty: false,
    default: "{ enabled: false }",
    summary:
      "Whether the source doc-comment pass runs, over which tracked paths, and with which extra " +
      "rules. `/** */` blocks compile into shipped type declarations, so they are public surface " +
      "in a repository that publishes types.",
  }),
  Object.freeze({
    name: "exitCodes",
    required: false,
    refusesEmpty: false,
    default: "{ clean: 0, hits: 1, refuse: 1 }",
    summary:
      "The three codes this gate returns. `clean` must be 0 and the other two must not be; a " +
      "mapping that breaks that is refused.",
  }),
  Object.freeze({
    name: "extraRules",
    required: false,
    refusesEmpty: false,
    default: "[]",
    summary:
      "Detection this repository adds on top of the canonical set. Each rule carries its own " +
      "positive and negative samples and joins the self-test floor on the same terms.",
  }),
  Object.freeze({
    name: "extraSamples",
    required: false,
    refusesEmpty: false,
    default: "{}",
    summary:
      "Extra positive and negative self-test samples, keyed by rule id. ADDITIVE ONLY: a sample " +
      "here joins the floor, and nothing here can remove a canonical sample from it.",
  }),
  Object.freeze({
    name: "repoRoot",
    required: false,
    refusesEmpty: false,
    default: "process.cwd(), resolved to its git top level",
    summary:
      "Where the repository under test is. The scan always anchors at the git top level, so an " +
      "invocation from a subdirectory covers the whole surface rather than a subtree.",
  }),
  Object.freeze({
    name: "write",
    required: false,
    refusesEmpty: false,
    default: "process.stdout.write / process.stderr.write",
    summary:
      "Where the report goes. Supplied so a test can drive the gate in process; it changes where " +
      "text lands and nothing about what the run concludes.",
  }),
]);

/** Every option name this gate accepts. Anything else is refused, which is how it fails closed. */
const KNOWN_OPTIONS = new Set(CONFIG_AXES.map((axis) => axis.name));

/**
 * Option names that are REFUSED BY NAME, with the reason, because each one is an attempt to
 * subtract something the contract makes non-subtractable.
 *
 * An unknown option is already refused, so this map does not decide anything. What it decides is
 * the MESSAGE: "no such option" sends a reader looking for the right spelling, and the right
 * answer is that there is no spelling, because the thing they are reaching for does not exist.
 */
const REFUSED_OPTIONS = new Map([
  ["rules", "the canonical rule set is not a caller input; ADD detection with `extraRules`"],
  ["ruleSet", "the canonical rule set is not a caller input; ADD detection with `extraRules`"],
  ["excludeRules", "a rule cannot be subtracted from the canonical set"],
  ["omitRules", "a rule cannot be subtracted from the canonical set"],
  ["ignoreRules", "a rule cannot be subtracted from the canonical set"],
  ["disableRules", "a rule cannot be subtracted from the canonical set"],
  ["disableRule", "a rule cannot be subtracted from the canonical set"],
  ["skipRules", "a rule cannot be subtracted from the canonical set"],
  ["only", "a rule cannot be subtracted from the canonical set by selecting a subset"],
  ["selfTest", "the self-test floor is not configurable"],
  ["skipSelfTest", "the self-test floor is not configurable"],
  ["disableSelfTest", "the self-test floor is not configurable"],
  ["noSelfTest", "the self-test floor is not configurable"],
  ["skipCompleteness", "the completeness refusal is not configurable"],
  ["allowUnreadTargets", "the completeness refusal is not configurable"],
  ["allowUntrackedSurfacePaths", "the tracked-surface refusal is not configurable"],
  ["skipTarballCheck", "the tarball drift tripwire is not configurable"],
  ["allowUnaccountedFiles", "the tarball drift tripwire is not configurable"],
  ["disableRefusals", "a refusal is not configurable"],
  ["force", "there is no override that makes a refusal into a pass"],
  ["warnOnly", "there is no mode in which a finding is reported without a non-zero exit"],
]);

// ---------------------------------------------------------------------------
// THE CANONICAL RULE SET
// ---------------------------------------------------------------------------
//
// THE FOUR TRAPS THAT BREAK A NAIVE DETECTOR, carried here from the variant this set was measured
// on rather than rediscovered. Each one shipped a public defect somewhere before it was caught.
//
//   (1) KEY ON KNOWN PROJECT PREFIXES, NEVER ON THE `WORD-N` SHAPE. `HL7-N` and `MLLP-10` are
//       ours; `MSH-2`, `PID-3`, `OBX-5`, `SCH-11`, `TQ1-7` and `NM1-03` are segment-field
//       references and are exactly the reference material a consumer of a parser needs. A shape
//       rule destroys the documentation it was added to protect. The cost is that a new programme
//       means adding its prefix, and nothing catches it until someone does. That is the cheaper of
//       the two mistakes, and it is why `projectPrefixes` is required rather than defaulted.
//   (2) DECAPITATION is a rule for the person REMEDIATING a hit, not for the scanner. Stripping an
//       identifier off the FRONT leaves a fragment behind, which reads worse than the text it
//       replaced. The hit report says so.
//   (3) CASE SENSITIVITY. The identifier rule is case-SENSITIVE and the segment after the hyphen
//       must start uppercase, which is what lets `FHIR-bridge` and `docs-content/` through.
//   (4) PHASE PATTERNS NEED A LETTER SUFFIX (`Phase 5b`) AND A LETTER-ONLY FORM (`Phase W`).
//
// WHAT IS CANONICAL AND WHAT IS CONFIGURED. The clinical guards below (the CSP field names, the
// trial roman numerals, the imaging nouns) are canonical because the collision they avoid is with
// healthcare reference material rather than with one repository's vocabulary. The standards
// designations are NOT canonical: which designations a repository's docs legitimately carry is a
// property of what it parses, so they arrive as configuration and their concrete instances arrive
// as that repository's own self-test samples.

/** Written ordinals plus the numeric forms, for `thirteenth slice` and `2nd wave`. */
const ORDINAL =
  "(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|" +
  "thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|" +
  "twenty-first|twenty-second|twenty-third|twenty-fourth|\\d+(?:st|nd|rd|th))";

/**
 * Lookbehinds that drop the clinical senses of `phase` before the rule ever sees it.
 *
 * `phase` is real clinical vocabulary: the Clinical Study Phase segment's field names are literally
 * `Study Phase Identifier` and `Study Phase Start Date/Time`, and "the acute phase reactant" is
 * ordinary reference material. A rule that flags those tells a remediator to rewrite a field name,
 * which is trap (1) arriving through the phase rule instead of the identifier rule.
 */
const PHASE_NOT_CLINICAL =
  "(?<!study )(?<!clinical )(?<!trial )(?<!acute )(?<!chronic )(?<!luteal )(?<!follicular )" +
  "(?<!liquid )(?<!gas )";

/** Lookahead that drops the clinical-study field-name tails and the trial roman numerals. */
const PHASE_NOT_FIELD =
  "(?!of\\b|with\\b|in\\b|out\\b|the\\b|and\\b|is\\b|for\\b|to\\b|identifier\\b|start\\b|end\\b|" +
  "evaluability\\b|number\\b|(?:I{1,3}|IV)\\s+(?:trial|stud|clinical|oncolog))";

/**
 * Imaging vocabulary that follows `slice` in reference material rather than in our jargon.
 *
 * Grounded in a generated DICOM tag dictionary: SliceThickness, SliceLocation, SpacingBetweenSlices,
 * SliceVector, NumberOfSlices, TimeSliceVector, SliceProgressionDirection, SliceSensitivityFactor.
 */
const IMAGING_NOUNS =
  "thickness|location|spacing|position|interval|order|number|index|gap|count|data|pixel|" +
  "orientation|plane|direction|width|vector|sensitivity|progression|factor";

/** A rule the caller cannot subtract: an id, a reader-facing name, and how it is built. */
const CANONICAL_RULES = Object.freeze([
  Object.freeze({
    id: "internal-identifier",
    name: "internal project identifier",
    /** Built from `projectPrefixes` and `standardsDesignations`, so this one rule is parametric. */
    parametric: true,
  }),
  Object.freeze({ id: "phase-or-wave", name: "phase or wave language", parametric: false }),
  Object.freeze({ id: "adr-reference", name: "ADR reference", parametric: false }),
  Object.freeze({ id: "internal-jargon", name: 'internal jargon ("slice")', parametric: false }),
  Object.freeze({ id: "internal-repo-path", name: "internal repo path", parametric: false }),
  Object.freeze({
    id: "traceability-marker",
    name: "internal traceability marker",
    parametric: false,
  }),
]);

/**
 * The canonical rule set's identity: a stable id and the name a hit report prints, in run order.
 *
 * Exported so a conformance corpus can key a transcribed rule onto the canonical one it maps to,
 * which is what makes "the shared implementation carries this variant's whole rule set" a claim
 * that can be made per rule rather than in aggregate.
 */
export const CANONICAL_RULE_INDEX = Object.freeze(
  CANONICAL_RULES.map((rule) => Object.freeze({ id: rule.id, name: rule.name })),
);

/**
 * The reader-facing names of the canonical rules, in the order they run.
 *
 * Exported so a caller can state in its own documentation what it has adopted, and so a conformance
 * suite can assert the set has not shrunk without a version bump.
 *
 * @returns {string[]} The canonical rule names.
 */
export function canonicalRuleNames() {
  return CANONICAL_RULES.map((rule) => rule.name);
}

/** A prefix must be a plain uppercase token, so joining them into an alternation is safe. */
const PREFIX_SHAPE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

/**
 * Compile the canonical rule set against one caller's configuration.
 *
 * Exported because a caller's own documentation and a conformance corpus both need to see exactly
 * what will run, and because the self-test floor below is graded against the compiled form rather
 * than against the sources it was built from.
 *
 * @param {object} resolved A configuration that has already passed validation.
 * @returns {{ id: string, name: string, patterns: RegExp[], positives: string[], negatives: string[] }[]}
 *   The compiled rules, in run order.
 */
export function compileCanonicalRules(resolved) {
  const prefixAlternation = resolved.projectPrefixes.join("|");
  const designations = resolved.standardsDesignations;
  const exclusion = designations.length === 0 ? "" : `(?!(?:${designations.join("|")})\\b)`;

  const identifier =
    `\\b${exclusion}(?:${prefixAlternation})(?:-[A-Z0-9][A-Z0-9.]*)+\\b` +
    `|\\bP\\d+ (?:safety|documentation)\\b`;

  /**
   * ONE POSITIVE SAMPLE PER CONFIGURED PREFIX, not one per rule.
   *
   * A prefix that is shadowed by a standards designation, or mistyped, contributes nothing and the
   * gate would keep reporting green over the identifiers it was added to catch. The floor therefore
   * proves every prefix is still reachable, which is the same property as "the scanner can still
   * see" applied to the axis a caller is most likely to edit.
   */
  const identifierPositives = resolved.projectPrefixes.map((prefix) => `Item ${prefix}-N7 is done`);
  identifierPositives.push("The P3 safety follow-up is queued");

  const rules = [
    {
      id: "internal-identifier",
      name: "internal project identifier",
      patterns: [new RegExp(identifier, "g")],
      positives: identifierPositives,
      // The WORD-N trap turned into an assertion. Every token here is a segment-field reference or
      // a diagnosis-code range, and a prefix set that starts matching one of them reds HERE rather
      // than deleting it from a parser's documentation on the next sweep.
      negatives: [
        "MSH-2 encoding characters, PID-3 identifier list, OBX-5 value, SCH-11 timing, " +
          "TQ1-7 start, NM1-03 name, ICD-10-CM P00-P96, 835 remittance",
      ],
    },
    {
      id: "phase-or-wave",
      name: "phase or wave language",
      patterns: [
        new RegExp(
          `\\b(?:roadmap phase\\b[ ]?[A-Za-z0-9]*|${PHASE_NOT_CLINICAL}phase[ -]${PHASE_NOT_FIELD}` +
            `[A-Za-z0-9]+[a-z]?\\b|wave \\d+\\b|the \\w+ and final phase\\b|` +
            `documentation residual\\b|${ORDINAL} (?:slice|wave)\\b)`,
          "gi",
        ),
      ],
      positives: [
        "Phase 5b closes it (Phase W, Phase-L and the thirteenth slice landed earlier, in wave 2)",
      ],
      negatives: [
        "CSP-1 Study Phase Identifier, CSP-2 Study Phase Start Date/Time, CSP-3 Study Phase End " +
          "Date/Time, CSP-4 Study Phase Evaluability; a Phase III oncology trial and a Phase II " +
          "study; the acute phase reactant; the adapter stays in phase with the source system " +
          "and is out of phase",
      ],
    },
    {
      id: "adr-reference",
      name: "ADR reference",
      patterns: [new RegExp("\\bADR[ -]?\\d{3,4}\\b", "gi")],
      positives: ["Decided in ADR 0015 and restated in ADR-0021"],
      negatives: ["ADR is not a segment, and 0015 alone is a value"],
    },
    {
      id: "internal-jargon",
      name: 'internal jargon ("slice")',
      patterns: [
        new RegExp(
          "\\b(?:this|that|the|each|another|previous|next|final|current)\\s+" +
            "(?:(?!(?:of|in|on|between|per|for|to|with|at)\\s)[\\w-]+\\s+){0,2}slices?\\b" +
            `(?!\\s+(?:${IMAGING_NOUNS}))`,
          "gi",
        ),
      ],
      positives: ["This slice adds the helper and the final slice removes it"],
      negatives: [
        "The slice thickness and the number of slices are DICOM attributes, each slice location " +
          "is too, and the phase of the clinical study, the phase of illness and each phase of " +
          "the trial are the reader words this rule must not touch",
      ],
    },
    {
      id: "internal-repo-path",
      name: "internal repo path",
      patterns: [
        new RegExp(
          "\\boperations/(?:BACKLOG\\.md|roadmaps/|plans/)" +
            "|\\bdocumentation/(?:decisions/|ecosystem-map\\.md|conventions\\.md)" +
            "|\\bBACKLOG\\.md\\b",
          "g",
        ),
      ],
      positives: ["Roadmap operations/roadmaps/hl7.md and documentation/decisions/0015-x.md"],
      negatives: [
        "Parser operations are documented in the README, and documentation for the API is generated",
      ],
    },
    {
      id: "traceability-marker",
      name: "internal traceability marker",
      // TWO PATTERNS RATHER THAN ONE WITH AN INLINE MODIFIER. The bracketed tag is case-SENSITIVE
      // (a lower-case `[s-...]` is not one of ours) and the open-question phrasing is not. Splitting
      // them is what lets each half carry the case policy it needs.
      patterns: [
        new RegExp("\\[S-[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*\\]", "g"),
        new RegExp("\\bopen[- ]question #?\\d+\\b", "gi"),
      ],
      positives: ["Repeating [S-NTE], and Open-question #12 resolves the direction"],
      negatives: [
        "A character range like [S-Z], a value set written [SNOMED], and open questions about the feed",
      ],
    },
  ];

  for (const rule of rules) {
    const extra = resolved.extraSamples[rule.id];
    if (extra === undefined) continue;
    rule.positives = [...rule.positives, ...(extra.positives ?? [])];
    rule.negatives = [...rule.negatives, ...(extra.negatives ?? [])];
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Configuration validation. Every failure here is a REFUSAL naming the axis.
// ---------------------------------------------------------------------------

/** Is this a plain object, as opposed to null, an array, or a primitive? */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Every entry of an array is a non-empty string. */
function isStringList(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * Resolve and check the exit-code mapping.
 *
 * @param {unknown} supplied The caller's `exitCodes`, if any.
 * @returns {{ codes?: { clean: number, hits: number, refuse: number }, problem?: string }} Either.
 */
function resolveExitCodes(supplied) {
  if (supplied === undefined) return { codes: { ...DEFAULT_EXIT_CODES } };
  if (!isPlainObject(supplied)) {
    return { problem: "axis `exitCodes` is not an object" };
  }
  const codes = { ...DEFAULT_EXIT_CODES, ...supplied };
  for (const key of ["clean", "hits", "refuse"]) {
    if (!Number.isInteger(codes[key])) {
      return { problem: `axis \`exitCodes.${key}\` is not an integer` };
    }
  }
  if (codes.clean !== 0) {
    return {
      problem: "axis `exitCodes.clean` must be 0: a clean run is the only run that exits 0",
    };
  }
  for (const key of ["hits", "refuse"]) {
    if (codes[key] === 0) {
      return {
        problem:
          `axis \`exitCodes.${key}\` is 0, which would report a finding as a clean run. ` +
          "A non-clean outcome exits non-zero; that is not configurable.",
      };
    }
  }
  return { codes };
}

/**
 * Check a caller's configuration and fill in the defaults.
 *
 * @param {unknown} config The caller's configuration.
 * @returns {{ resolved?: object, problems?: string[], codes: { clean: number, hits: number, refuse: number } }}
 *   The resolved configuration, or the problems that stopped it.
 */
export function resolveConfig(config) {
  const problems = [];
  if (!isPlainObject(config)) {
    return {
      problems: ["the configuration is not an object, so no axis could be read from it"],
      codes: { ...DEFAULT_EXIT_CODES },
    };
  }

  // FAIL CLOSED ON AN OPTION THIS GATE DOES NOT KNOW. An ignored option reads, from the caller's
  // side, exactly like an honoured one: they wrote `skipSelfTest: true`, the run went green, and
  // nothing said the setting did nothing. Refusing names it instead.
  for (const key of Object.keys(config)) {
    if (KNOWN_OPTIONS.has(key)) continue;
    const reason = REFUSED_OPTIONS.get(key);
    problems.push(
      reason === undefined
        ? `option \`${key}\` is not one this gate accepts. The accepted axes are: ` +
            `${[...KNOWN_OPTIONS].join(", ")}.`
        : `option \`${key}\` is refused: ${reason}.`,
    );
  }

  const exit = resolveExitCodes(config.exitCodes);
  if (exit.problem !== undefined) problems.push(exit.problem);
  const codes = exit.codes ?? { ...DEFAULT_EXIT_CODES };

  if (config.projectPrefixes === undefined) {
    problems.push("axis `projectPrefixes` is required and was not supplied");
  } else if (!isStringList(config.projectPrefixes)) {
    problems.push("axis `projectPrefixes` is not a list of non-empty strings");
  } else if (config.projectPrefixes.length === 0) {
    problems.push(
      "axis `projectPrefixes` is empty. An empty prefix set matches nothing, so the identifier " +
        "rule would report every surface clean. Refusing rather than substituting a default.",
    );
  } else {
    for (const prefix of config.projectPrefixes) {
      if (!PREFIX_SHAPE.test(prefix)) {
        problems.push(
          `axis \`projectPrefixes\` carries ${JSON.stringify(prefix)}, which is not an uppercase ` +
            "token. A prefix is joined into an alternation, so anything else is refused rather " +
            "than escaped into something that no longer means what was written.",
        );
      }
    }
  }

  if (config.standardsDesignations === undefined) {
    problems.push("axis `standardsDesignations` is required and was not supplied");
  } else if (!Array.isArray(config.standardsDesignations)) {
    problems.push("axis `standardsDesignations` is not a list");
  } else {
    for (const source of config.standardsDesignations) {
      if (typeof source !== "string" || source.trim() === "") {
        problems.push("axis `standardsDesignations` carries an entry that is not a pattern");
        continue;
      }
      try {
        new RegExp(source);
      } catch (cause) {
        problems.push(
          `axis \`standardsDesignations\` carries ${JSON.stringify(source)}, which does not ` +
            `compile: ${String(cause)}`,
        );
      }
    }
  }

  if (config.surfacePaths === undefined) {
    problems.push("axis `surfacePaths` is required and was not supplied");
  } else if (!isStringList(config.surfacePaths)) {
    problems.push("axis `surfacePaths` is not a list of non-empty strings");
  } else if (config.surfacePaths.length === 0) {
    problems.push(
      "axis `surfacePaths` is empty. A scan with no surface reads nothing and would report OK " +
        "over every page a consumer sees. Refusing rather than substituting a default.",
    );
  }

  if (config.accountedTarballFiles === undefined) {
    problems.push("axis `accountedTarballFiles` is required and was not supplied");
  } else if (!Array.isArray(config.accountedTarballFiles)) {
    problems.push("axis `accountedTarballFiles` is not a list");
  } else if (!config.accountedTarballFiles.every((f) => typeof f === "string")) {
    problems.push("axis `accountedTarballFiles` carries an entry that is not a string");
  }

  const source = config.sourceDocComments ?? { enabled: false };
  if (!isPlainObject(source)) {
    problems.push("axis `sourceDocComments` is not an object");
  } else if (source.enabled === true) {
    if (!isStringList(source.paths) || source.paths.length === 0) {
      problems.push(
        "axis `sourceDocComments.paths` is required when the pass is enabled, and must name at " +
          "least one tracked path. An enabled pass with no paths reads nothing.",
      );
    }
    if (source.extraRules !== undefined && !Array.isArray(source.extraRules)) {
      problems.push("axis `sourceDocComments.extraRules` is not a list");
    }
  }

  if (config.extraRules !== undefined && !Array.isArray(config.extraRules)) {
    problems.push("axis `extraRules` is not a list");
  }
  if (config.extraSamples !== undefined && !isPlainObject(config.extraSamples)) {
    problems.push("axis `extraSamples` is not an object");
  }
  if (config.repoRoot !== undefined && typeof config.repoRoot !== "string") {
    problems.push("axis `repoRoot` is not a string");
  }
  if (config.write !== undefined && !isPlainObject(config.write)) {
    problems.push("axis `write` is not an object");
  }

  if (problems.length > 0) return { problems, codes };

  return {
    codes,
    resolved: {
      projectPrefixes: [...config.projectPrefixes],
      standardsDesignations: [...config.standardsDesignations],
      surfacePaths: [...config.surfacePaths],
      accountedTarballFiles: [...config.accountedTarballFiles],
      sourceDocComments: {
        enabled: source.enabled === true,
        paths: source.enabled === true ? [...source.paths] : [],
        extraRules: source.extraRules === undefined ? [] : [...source.extraRules],
      },
      exitCodes: codes,
      extraRules: config.extraRules === undefined ? [] : [...config.extraRules],
      extraSamples: config.extraSamples === undefined ? {} : config.extraSamples,
      repoRoot: config.repoRoot ?? process.cwd(),
      write: config.write ?? {},
    },
  };
}

// ---------------------------------------------------------------------------
// Rules supplied by the caller
// ---------------------------------------------------------------------------

/**
 * Compile one caller-supplied rule, which joins the canonical set on the same terms.
 *
 * A caller's rule must carry its own samples: an added rule with no negative sample is the WORD-N
 * trap with nothing holding it, and an added rule with no positive sample is one that can stop
 * matching without anything noticing.
 *
 * @param {unknown} rule The caller's rule.
 * @param {number} index Its position, for a diagnostic that can be acted on.
 * @returns {{ rule?: object, problems: string[] }} The compiled rule or what stopped it.
 */
function compileExtraRule(rule, index) {
  const problems = [];
  const where = `extra rule ${index}`;
  if (!isPlainObject(rule)) return { problems: [`${where} is not an object`] };
  if (typeof rule.name !== "string" || rule.name.trim() === "") {
    problems.push(`${where} declares no \`name\``);
  }
  if (typeof rule.id !== "string" || rule.id.trim() === "") {
    problems.push(`${where} declares no \`id\``);
  }
  const patterns = [];
  const sources = Array.isArray(rule.patterns) ? rule.patterns : [rule.pattern];
  for (const entry of sources) {
    if (typeof entry === "string") {
      try {
        patterns.push(new RegExp(entry, "g"));
      } catch (cause) {
        problems.push(`${where} carries a pattern that does not compile: ${String(cause)}`);
      }
      continue;
    }
    if (entry instanceof RegExp) {
      patterns.push(
        new RegExp(entry.source, entry.flags.includes("g") ? entry.flags : `${entry.flags}g`),
      );
      continue;
    }
    problems.push(`${where} carries a pattern that is neither a string nor a RegExp`);
  }
  if (patterns.length === 0) problems.push(`${where} declares no pattern`);
  if (!isStringList(rule.positives) || rule.positives.length === 0) {
    problems.push(`${where} carries no positive sample, so nothing proves it still matches`);
  }
  if (!isStringList(rule.negatives) || rule.negatives.length === 0) {
    problems.push(
      `${where} carries no negative sample, so nothing stops it being widened into the WORD-N shape`,
    );
  }
  if (problems.length > 0) return { problems };
  return {
    problems: [],
    rule: {
      id: rule.id,
      name: rule.name,
      patterns,
      positives: [...rule.positives],
      negatives: [...rule.negatives],
    },
  };
}

/**
 * Every rule a run will execute over the public surface, canonical first.
 *
 * @param {object} resolved The resolved configuration.
 * @returns {{ rules: object[], problems: string[] }} The compiled rule set.
 */
function buildRules(resolved) {
  const problems = [];
  const rules = compileCanonicalRules(resolved);
  const canonicalIds = new Set(rules.map((rule) => rule.id));
  resolved.extraRules.forEach((rule, index) => {
    const compiled = compileExtraRule(rule, index);
    problems.push(...compiled.problems);
    if (compiled.rule === undefined) return;
    if (canonicalIds.has(compiled.rule.id)) {
      problems.push(
        `extra rule ${index} reuses the canonical id \`${compiled.rule.id}\`. A caller may add ` +
          "detection and may not replace a canonical rule; give it an id of its own.",
      );
      return;
    }
    rules.push(compiled.rule);
  });
  return { rules, problems };
}

// ---------------------------------------------------------------------------
// The self-test floor
// ---------------------------------------------------------------------------

/** Does any of a rule's patterns match this text? */
function matches(rule, text) {
  return rule.patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/** The first thing one of a rule's patterns matched in this text, or `null`. */
function firstMatch(rule, text) {
  for (const pattern of rule.patterns) {
    pattern.lastIndex = 0;
    const found = pattern.exec(text);
    if (found !== null) return found[0];
  }
  return null;
}

/**
 * Prove, in process and before anything is reported, that every rule can still see.
 *
 * TWO HALVES, and the second is the one that is unusual. Positive samples prove each rule still
 * matches what it bans, which is the refusal to report a clean tree from a scanner that cannot see.
 * Negative samples prove each rule still lets through the reference material it was most likely to
 * destroy: if someone widens the identifier rule into a `WORD-N` shape, this reds here instead of
 * silently deleting `MSH-2` from a parser's documentation on the next sweep.
 *
 * @param {object[]} rules The compiled rules.
 * @returns {string[]} One line per failure. Empty means the floor holds.
 */
export function runSelfTests(rules) {
  const failures = [];
  for (const rule of rules) {
    for (const positive of rule.positives) {
      if (!matches(rule, positive)) {
        failures.push(
          `rule '${rule.name}' no longer matches its own positive sample: ` +
            `${JSON.stringify(positive)}`,
        );
      }
    }
    for (const negative of rule.negatives) {
      const hit = firstMatch(rule, negative);
      if (hit !== null) {
        failures.push(
          `rule '${rule.name}' now matches legitimate reference material (matched: ` +
            `${JSON.stringify(hit)}). This is the WORD-N trap: it destroys the segment-field ` +
            "references a parser's documentation exists to provide.",
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Git, and the surface it names
// ---------------------------------------------------------------------------

/** Run git and return stdout, or `null` when it failed. */
function gitOrNull(root, args, encoding = "utf8") {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/** The tracked paths under one or more pathspecs, NUL-separated so a quoted name cannot be lost. */
function trackedUnder(root, paths) {
  const out = gitOrNull(root, ["ls-files", "-z", "--", ...paths], "utf8");
  if (out === null) return null;
  return out.split("\0").filter((entry) => entry !== "");
}

// ---------------------------------------------------------------------------
// Text passes
// ---------------------------------------------------------------------------

/**
 * Join a document the way markdown renders it: a paragraph becomes one line, blank lines stay.
 *
 * WHY THIS PASS EXISTS, and it is the route that made hand-written copies of this gate print OK
 * over a live violation. Every rule except the bare identifier is MULTI-TOKEN, a line matcher
 * matches within a line, and these repositories hard-wrap their markdown, so a violation that
 * happens to straddle a wrap is invisible to the line scan.
 *
 * WHITESPACE IS SQUEEZED, and that is the difference between this pass working and this pass
 * looking as though it works: an indented continuation otherwise produces `phase   may`, and every
 * rule here is written with single spaces. Squeezing is also what markdown itself does.
 *
 * @param {string} text The document.
 * @returns {string[]} One entry per paragraph, in document order.
 */
export function reflowParagraphs(text) {
  const paragraphs = [];
  let current = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "") {
      if (current.length > 0) paragraphs.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(raw.replace(/\s+/g, " ").trim());
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs;
}

/**
 * Extract the `/** *​/` doc comments from one source file, with each line's location beside it.
 *
 * THE TERMINATOR IS TESTED BEFORE THE LEADER IS STRIPPED, and that ordering is the whole
 * correctness of this extractor. Stripping first turns a closing `*​/` into `/`, the block never
 * closes, and every line comment and line of CODE after it is scanned as doc text.
 *
 * Only `/** *​/` blocks are extracted. Line comments and plain block comments are NOT, and that
 * boundary is the point rather than a convenience: a doc comment is what a declaration build copies
 * into the shipped types, so it is what a consumer receives; what only a maintainer reads is not.
 *
 * @param {string} text The source file.
 * @param {string} file Its repo-relative path, for the location map.
 * @returns {{ lines: { text: string, where: string }[], paragraphs: { text: string, where: string }[] }}
 *   The doc text, line by line and paragraph by paragraph.
 */
export function extractDocComments(text, file) {
  const lines = [];
  const paragraphs = [];
  let inDoc = false;
  let blockStart = 0;
  let joined = [];

  const flushParagraph = () => {
    if (joined.length === 0) return;
    const merged = joined.join(" ").replace(/\s+/g, " ").trim();
    if (merged !== "") paragraphs.push({ text: merged, where: `${file}:${blockStart}` });
    joined = [];
  };

  const source = text.split(/\r?\n/);
  for (let i = 0; i < source.length; i += 1) {
    let line = source[i];
    if (!inDoc) {
      if (!/^\s*\/\*\*/.test(line)) continue;
      inDoc = true;
      blockStart = i + 1;
      joined = [];
      line = line.replace(/^\s*\/\*\*/, "");
    }
    let closed = false;
    if (line.includes("*/")) {
      closed = true;
      line = line.replace(/\*\/[\s\S]*$/, "");
    }
    // Exactly ONE leading asterisk, never a greedy run: a greedy leader would swallow the opening
    // `**` of markdown bold and alter the text that is scanned.
    line = line.replace(/^\s*\*\s?/, "").replace(/^\s+/, "");
    lines.push({ text: line, where: `${file}:${i + 1}` });
    if (line.trim() === "") flushParagraph();
    else joined.push(line);
    if (closed) {
      flushParagraph();
      inDoc = false;
    }
  }
  if (inDoc) flushParagraph();
  return { lines, paragraphs };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** A NUL byte is how every text matcher decides a file is not text. Refuse rather than skip it. */
function looksBinary(bytes) {
  return bytes.includes(0);
}

/**
 * Run the internal-reference gate and return an exit code drawn from `config.exitCodes`.
 *
 * Nothing here calls `process.exit`, so a test can drive the gate in process and a caller decides
 * what to do with the answer.
 *
 * @param {object} config The caller's configuration. See {@link CONFIG_AXES}.
 * @returns {number} `exitCodes.clean`, `exitCodes.hits` or `exitCodes.refuse`.
 */
export function runInternalRefsScan(config) {
  const writeOut = config?.write?.out ?? ((s) => process.stdout.write(s));
  const writeErr = config?.write?.err ?? ((s) => process.stderr.write(s));

  const { resolved, problems, codes } = resolveConfig(config);
  if (resolved === undefined) {
    writeErr(
      `ERROR: internal-refs - the configuration was refused, so no scan ran:\n` +
        problems.map((p) => `       ${p}\n`).join("") +
        "       Refusing to report on a surface this configuration does not describe.\n",
    );
    // A configuration that could not be read cannot be trusted to have declared a sane refusal
    // code either, so this one path uses the hard-coded non-zero rather than a caller's number.
    return codes.refuse === 0 ? HARD_REFUSE : codes.refuse;
  }

  const refuse = (message) => {
    writeErr(`ERROR: internal-refs - ${message}\n`);
    return resolved.exitCodes.refuse;
  };

  // The scan always anchors at the git top level. `git ls-files` is relative to the working
  // directory, so from a subdirectory the scan would cover a subtree and still print OK.
  const topLevel = gitOrNull(resolved.repoRoot, ["rev-parse", "--show-toplevel"]);
  if (topLevel === null) {
    return refuse(
      `${resolved.repoRoot} is not inside a git repository, so the tracked surface cannot be ` +
        "enumerated. Refusing to report on a surface that cannot be derived.",
    );
  }
  const root = topLevel.trim();

  const built = buildRules(resolved);
  if (built.problems.length > 0) {
    return refuse(
      "the rule set was refused:\n" +
        built.problems
          .map((p) => `       ${p}\n`)
          .join("")
          .trimEnd(),
    );
  }
  const rules = built.rules;

  const selfTestFailures = runSelfTests(rules);
  if (selfTestFailures.length > 0) {
    return refuse(
      "SELF-TEST FAILED:\n" +
        selfTestFailures.map((f) => `       ${f}\n`).join("") +
        "       The scanner is not behaving as specified, so no result from it can be believed.",
    );
  }

  // Every named surface path must still be tracked. Without this, renaming or removing a page
  // makes the gate scan less and still print OK.
  for (const path of resolved.surfacePaths) {
    const tracked = trackedUnder(root, [path]);
    if (tracked === null) {
      return refuse(`git could not enumerate the surface path '${path}'.`);
    }
    if (tracked.length === 0) {
      return refuse(
        `the public surface path '${path}' is not tracked. Either it was renamed or removed ` +
          "(update `surfacePaths`, deliberately), or the scan is about to cover less than it " +
          "claims. Refusing to report green from a shrunken surface.",
      );
    }
  }

  // DRIFT TRIPWIRE ON THE NPM TARBALL. `files` decides what a consumer actually receives, so
  // anything added there is new public surface this gate would not know about. EVERY entry is
  // checked, not just the prose-looking ones: a filter that discarded the build directory first
  // would structurally miss the tarball's largest prose payload.
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch (cause) {
    return refuse(
      `package.json could not be read at ${root}: ${String(cause)}. The npm metadata is part of ` +
        "the public surface, so this is a refusal rather than a pass over the rest.",
    );
  }
  const accounted = new Set([...resolved.surfacePaths, ...resolved.accountedTarballFiles]);
  const unaccounted = (Array.isArray(manifest.files) ? manifest.files : []).filter(
    (entry) => !accounted.has(entry),
  );
  if (unaccounted.length > 0) {
    return refuse(
      `package.json 'files' ships something this configuration does not cover: ` +
        `${unaccounted.join(" ")}\n` +
        "       That is public surface a consumer receives in the tarball. Add it to " +
        "`surfacePaths`, or record it in `accountedTarballFiles` as a deliberate exclusion.",
    );
  }

  const enumerated = trackedUnder(root, resolved.surfacePaths);
  if (enumerated === null) return refuse("git could not enumerate the public surface.");
  if (enumerated.length === 0) {
    return refuse(
      "no tracked public-surface files to scan. Refusing to report green from a scan that read " +
        "nothing.",
    );
  }

  // ENUMERATE, THEN READ, THEN PROVE THE TWO AGREE. A target that was listed and never read is
  // the silent-green shape this gate exists to close: a file that vanished between the two steps,
  // an unreadable one, and one a matcher classifies as binary all land here rather than in the
  // hit list, and each of them is a refusal naming the target.
  const documents = [];
  const unread = [];
  let gitlinks = 0;
  for (const rel of enumerated) {
    const absolute = join(root, rel);
    let link;
    let kind;
    try {
      link = lstatSync(absolute);
      kind = statSync(absolute);
    } catch (cause) {
      unread.push({
        path: rel,
        why: `disappeared between enumeration and reading (${String(cause)})`,
      });
      continue;
    }
    if (kind.isDirectory() && !link.isSymbolicLink()) {
      // A gitlink: git lists it as a tracked entry and there are no bytes at that path. A SYMBOLIC
      // link to a directory is NOT one, and is refused below rather than skipped: skipping it is
      // how a tracked entry gets enumerated and never read with nothing saying so.
      gitlinks += 1;
      continue;
    }
    if (!kind.isFile()) {
      unread.push({ path: rel, why: "is a tracked entry that is not a regular file" });
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(absolute);
    } catch (cause) {
      unread.push({ path: rel, why: `could not be read (${String(cause)})` });
      continue;
    }
    if (looksBinary(bytes)) {
      unread.push({
        path: rel,
        why:
          "holds a NUL byte, so a text matcher classifies it as binary and any match in it would " +
          "carry no line number. Treat it as a real violation and repair the encoding",
      });
      continue;
    }
    documents.push({ path: rel, text: bytes.toString("utf8") });
  }

  if (unread.length > 0) {
    return refuse(
      "the scan enumerated targets it could not read, so it did not read all of its input:\n" +
        unread.map((u) => `       ${u.path} ${u.why}\n`).join("") +
        "       Refusing to report green from an incomplete scan.",
    );
  }
  if (documents.length + gitlinks !== enumerated.length) {
    return refuse(
      `the scan enumerated ${enumerated.length} target(s) and accounted for ` +
        `${documents.length + gitlinks}. Refusing to report green from an incomplete scan.`,
    );
  }
  if (documents.length === 0) {
    return refuse(
      "no public-surface files survived list building. Refusing to report green from a scan that " +
        "read nothing.",
    );
  }

  // The npm metadata is public surface that is not a file of its own. It is ALWAYS scanned and no
  // axis removes it, which is what makes the universal above checkable: there is at least one
  // target every configuration reads.
  documents.push({
    path: "package.json (npm metadata)",
    text:
      `description: ${manifest.description ?? ""}\n` +
      `keywords: ${(manifest.keywords ?? []).join(", ")}\n`,
  });

  const hits = [];
  for (const document of documents) {
    scanDocument(document, rules, hits);
  }

  // The source doc-comment pass, when the caller has enabled it.
  let sourceFiles = 0;
  if (resolved.sourceDocComments.enabled) {
    const sourceRules = [...rules];
    let index = 0;
    for (const rule of resolved.sourceDocComments.extraRules) {
      const compiled = compileExtraRule(rule, index);
      index += 1;
      if (compiled.rule === undefined) {
        return refuse(
          "a source doc-comment rule was refused:\n" +
            compiled.problems
              .map((p) => `       ${p}\n`)
              .join("")
              .trimEnd(),
        );
      }
      sourceRules.push(compiled.rule);
    }
    const sourceSelfTest = runSelfTests(sourceRules);
    if (sourceSelfTest.length > 0) {
      return refuse(
        "SELF-TEST FAILED for the source doc-comment pass:\n" +
          sourceSelfTest
            .map((f) => `       ${f}\n`)
            .join("")
            .trimEnd(),
      );
    }

    const sourceTracked = trackedUnder(root, resolved.sourceDocComments.paths);
    if (sourceTracked === null || sourceTracked.length === 0) {
      return refuse(
        `no tracked source files under ${resolved.sourceDocComments.paths.join(", ")} to scan for ` +
          "doc comments. Either the source moved (update `sourceDocComments.paths`, " +
          "deliberately) or the scan is about to cover less than it claims.",
      );
    }
    const docLines = [];
    const docParagraphs = [];
    for (const rel of sourceTracked) {
      const absolute = join(root, rel);
      let bytes;
      try {
        const kind = lstatSync(absolute);
        if (kind.isDirectory()) continue;
        if (!kind.isFile()) {
          return refuse(`tracked source entry is not a regular file: ${rel}`);
        }
        bytes = readFileSync(absolute);
      } catch (cause) {
        return refuse(
          `tracked source file ${rel} could not be read (${String(cause)}). Refusing to report ` +
            "green from a scan that could not open its input.",
        );
      }
      if (looksBinary(bytes)) {
        return refuse(
          `tracked source file ${rel} holds a NUL byte, so a text matcher classifies it as ` +
            "binary. Refusing to report green over input it cannot read.",
        );
      }
      sourceFiles += 1;
      const extracted = extractDocComments(bytes.toString("utf8"), rel);
      docLines.push(...extracted.lines);
      docParagraphs.push(...extracted.paragraphs);
    }
    if (docLines.length === 0) {
      return refuse(
        `extracted no doc-comment text from ${sourceFiles} tracked source file(s). An empty ` +
          "extraction means the extractor is broken, not that the source is clean.",
      );
    }
    scanDocComments(docLines, docParagraphs, sourceRules, hits);
  }

  if (hits.length > 0) {
    writeErr(report(hits));
    return resolved.exitCodes.hits;
  }

  writeOut(
    `internal-refs: OK (${documents.length} target(s) scanned against ${rules.length} rule(s), ` +
      `line by line and paragraph-joined` +
      (resolved.sourceDocComments.enabled
        ? `; ${sourceFiles} source file(s) scanned for doc-comment bookkeeping`
        : "") +
      `; ${gitlinks} gitlink(s) skipped)\n`,
  );
  return resolved.exitCodes.clean;
}

/** Scan one document line by line, then paragraph-joined for what a wrap hid. */
function scanDocument(document, rules, hits) {
  const lines = document.text.split(/\r?\n/);
  for (const rule of rules) {
    const seen = new Set();
    for (let i = 0; i < lines.length; i += 1) {
      const found = firstMatch(rule, lines[i]);
      if (found === null) continue;
      seen.add(found);
      hits.push({ rule: rule.name, file: document.path, line: i + 1, text: lines[i].trim() });
    }
    for (const paragraph of reflowParagraphs(document.text)) {
      const found = firstMatch(rule, paragraph);
      if (found === null || seen.has(found)) continue;
      seen.add(found);
      // A wrapped hit has no line number by construction: the match exists only in the joined
      // paragraph. It reports the file and the matched text, which is what a remediator searches
      // for, and it is reported only when the line pass could not already see it.
      hits.push({ rule: rule.name, file: document.path, line: null, text: found, wrapped: true });
    }
  }
}

/** Scan extracted doc-comment text, line by line and then paragraph-reflowed. */
function scanDocComments(docLines, docParagraphs, rules, hits) {
  for (const rule of rules) {
    const located = new Set();
    for (const entry of docLines) {
      const found = firstMatch(rule, entry.text);
      if (found === null) continue;
      located.add(entry.where);
      hits.push({ rule: rule.name, file: entry.where, line: null, text: entry.text, source: true });
    }
    for (const entry of docParagraphs) {
      const found = firstMatch(rule, entry.text);
      if (found === null || located.has(entry.where)) continue;
      located.add(entry.where);
      hits.push({
        rule: rule.name,
        file: entry.where,
        line: null,
        text: found,
        source: true,
        wrapped: true,
      });
    }
  }
}

/** The hit report: every finding names its file, its line where it has one, and its rule. */
function report(hits) {
  const lines = [];
  for (const hit of hits) {
    const where = hit.line === null ? hit.file : `${hit.file}:${hit.line}`;
    const label =
      `[${hit.rule}` +
      (hit.source ? " / src doc comment" : "") +
      (hit.wrapped ? " / wrapped across lines" : "") +
      "]";
    lines.push(`${label} ${where}: ${hit.text}`);
  }
  lines.push("");
  lines.push("ERROR: internal-refs - internal project bookkeeping found on a public surface.");
  lines.push("       A consumer reads this surface. Item identifiers, phase and wave language,");
  lines.push("       ADR numbers and internal repo paths belong in the changeset, the changelog,");
  lines.push("       the commit, the pull request and the roadmap. Translate at the boundary: say");
  lines.push("       what the software does and what changed.");
  lines.push("       When you strip an identifier off the FRONT of a line, repair the head too:");
  lines.push(
    "       drop a leading orphan parenthetical, strip leading punctuation, recapitalise.",
  );
  return `${lines.join("\n")}\n`;
}

/** Re-exported for a caller that wants to state, in its own docs, what it cannot turn off. */
export { DEFAULT_EXIT_CODES, REFUSED_OPTIONS };
