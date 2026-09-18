// conformance/internal-refs/entries/hl7.js
//
// hl7's variant, transcribed from `scripts/check-no-internal-refs.sh` at the sha below. This is the
// only entry populated by the item that created this corpus: an entry is populated by the session
// ADOPTING that repository, from inside its checkout or from a variant a spec manifest names, and
// no session populates an entry for a repository it is not adopting.
//
// WHAT WAS READ: the rule inventory and the embedded self-test material, which sit in a contiguous
// region of that file (the two rule arrays, the prefix set, the standards-designation exclusions,
// the surface path list, the tarball accounting and the four sample arrays). The remediation prose,
// the silent-green route list and the extractor are not transcribed, because a corpus entry records
// what a variant FLAGS, not how it walks a tree.
//
// A RESIDUAL IS NOT A RULE. That variant discloses fourteen residuals of its own, several of them
// rules it deliberately does NOT carry. They are recorded below because the sweep needs to know a
// non-catch was a decision rather than an oversight, and they are deliberately not part of the rule
// inventory: the superset property is over what the variants flag, and a documented non-catch stays
// a non-catch.

/** The prefix set, `PKG` deliberately absent. See the conflict register for why. */
const PROJECT_PREFIXES = [
  "PARSERS-PUBLIC",
  "DOCS-CONTENT",
  "KNOWLEDGEBASE",
  "TERMINOLOGY",
  "PATHWAYS",
  "TRANSFORM",
  "WEBSITE",
  "STAGING",
  "SUPPLY",
  "NCPDP",
  "ASSETS",
  "EMDASH",
  "README",
  "CONFIG",
  "DICOM",
  "SYNTH",
  "DEID",
  "CCDA",
  "ASTM",
  "MLLP",
  "FHIR",
  "CREW",
  "DOCS",
  "PERF",
  "SYNC",
  "VERSION",
  "PUBLIC",
  "HL7",
  "X12",
  "IAC",
  "CLI",
  "KB",
  "PW",
  "PUB",
  "CI",
  "REAL",
  "TERM",
  "WF",
  "VERIFY",
];

/**
 * The standards designations that must never be flagged, split out of one alternation.
 *
 * Eight of the prefixes above are the names of standards this ecosystem parses as well as the names
 * of our projects, and a consumer needs to read `HL7-V2`, `FHIR-R4`, `DICOM-SR`, `NCPDP-SCRIPT`,
 * `X12-837P` and a table number in the documentation. There is no shape that separates those from
 * `HL7-N` and `MLLP-10`, so the separation is an explicit, reviewable exclusion list.
 */
const STANDARDS_DESIGNATIONS = [
  String.raw`HL7-(?:V2|V3|CDA|FHIR|OMG|\d{3,4}[A-Z]?)`,
  String.raw`FHIR-R\d[A-Z]?`,
  String.raw`DICOM-(?:SR|RT|SEG|DIR|PS\d)`,
  String.raw`NCPDP-(?:SCRIPT|TELECOM|D\.\d)`,
  String.raw`X12-\d{3}[A-Z]?`,
  String.raw`X12-\d{6}`,
  String.raw`CCDA-R\d(?:\.\d)?`,
  String.raw`ASTM-E\d+`,
];

/** The variant's markdown-surface samples, indexed the way that file indexes them. */
const POSITIVE = [
  "Item HL7-N is done, and CCDA-P7 with it",
  "Phase 5b closes it (Phase W, Phase-L and the thirteenth slice landed earlier, in wave 2)",
  "Decided in ADR 0015 and restated in ADR-0021",
  "This slice adds the helper and the final slice removes it",
  "Roadmap operations/roadmaps/hl7.md and documentation/decisions/0015-x.md",
  "Repeating [S-NTE], and Open-question #12 resolves the direction",
];

const NEGATIVE = [
  "MSH-2 encoding characters, PID-3 identifier list, OBX-5 value, SCH-11 timing, TQ1-7 start, " +
    "NM1-03 name, PKG-1 and PKG-4 packaging, ICD-10-CM P00-P96, FHIR-bridge stability, " +
    "docs-content/ layout, HL7-defined tables, HL7-0396 and HL7-0003 and HL7-396, HL7-V2 and " +
    "HL7-CDA, FHIR-R4, DICOM-SR and DICOM-RT, NCPDP-SCRIPT and NCPDP-D.0, X12-837P and " +
    "X12-005010, 835 remittance",
  "CSP-1 Study Phase Identifier, CSP-2 Study Phase Start Date/Time, CSP-3 Study Phase End " +
    "Date/Time, CSP-4 Study Phase Evaluability; a Phase III oncology trial and a Phase II study; " +
    "the acute phase reactant; the adapter stays in phase with the source system and is out of " +
    "phase",
  "ADR is not a segment, and 0015 alone is a value",
  "The slice thickness and the number of slices are DICOM attributes, each slice location is too, " +
    "and the phase of the clinical study, the phase of illness and each phase of the trial are " +
    "the reader words this rule must not touch",
  "Parser operations are documented in the README, and documentation for the API is generated",
  "A character range like [S-Z], a value set written [SNOMED], and open questions about the feed",
];

/** The source doc-comment set's samples. It starts identical and is ALLOWED to diverge. */
const SRC_POSITIVE = [...POSITIVE];

const SRC_NEGATIVE = [
  "MSH-2 encoding characters, PID-3 identifier list, OBX-5 value, SCH-11 timing, TQ1-7 start, " +
    "NM1-03 name, PKG-1 and PKG-4 packaging, ICD-10-CM P00-P96, FHIR-bridge stability, " +
    "HL7-defined tables, HL7-0396 and HL7-0211 and HL7-0335, HL7-V2 and HL7-CDA, FHIR-R4, " +
    "DICOM-SR, NCPDP-SCRIPT, X12-837P, RXA-3 and RXE-25 and AL1-6 and DG1-5 and IN1-12 and " +
    "TXA-4 and FT1-4",
  NEGATIVE[1],
  NEGATIVE[2],
  "The slice thickness and the number of slices are DICOM attributes, each slice location is too; " +
    "subcomponents.slice() and path.slice(4, 8) are TypeScript; and the phase of the clinical " +
    "study, the phase of illness and each phase of the trial are the reader words this rule must " +
    "not touch",
  NEGATIVE[4],
  NEGATIVE[5],
];

/** The variant's own rule names, in its own order. */
const RULE_NAMES = [
  "internal project identifier",
  "phase or wave language",
  "ADR reference",
  'internal jargon ("slice")',
  "internal repo path",
  "internal traceability marker",
];

/** The variant's own patterns, transcribed with its interpolations resolved. */
const RULE_PATTERNS = [
  String.raw`\b(?!(?:STANDARDS_DESIGNATION)\b)(?:PROJECT_PREFIXES)(?:-[A-Z0-9][A-Z0-9.]*)+\b|\bP\d+ (?:safety|documentation)\b`,
  String.raw`(?i)\b(?:roadmap phase\b[ ]?[A-Za-z0-9]*|PHASE_NOT_CLINICAL phase[ -]PHASE_NOT_FIELD[A-Za-z0-9]+[a-z]?\b|wave \d+\b|the \w+ and final phase\b|documentation residual\b|ORDINAL (?:slice|wave)\b)`,
  String.raw`(?i)\bADR[ -]?\d{3,4}\b`,
  String.raw`(?i)\b(?:this|that|the|each|another|previous|next|final|current)\s+(?:(?!(?:of|in|on|between|per|for|to|with|at)\s)[\w-]+\s+){0,2}slices?\b(?!\s+(?:IMAGING_NOUNS))`,
  String.raw`\boperations/(?:BACKLOG\.md|roadmaps/|plans/)|\bdocumentation/(?:decisions/|ecosystem-map\.md|conventions\.md)|\bBACKLOG\.md\b`,
  String.raw`\[S-[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*\]|(?i:\bopen[- ]question #?\d+\b)`,
];

/** The canonical rule this variant's rule maps onto, so the superset claim is per-rule. */
const CANONICAL_IDS = [
  "internal-identifier",
  "phase-or-wave",
  "adr-reference",
  "internal-jargon",
  "internal-repo-path",
  "traceability-marker",
];

/** Build one rule-set entry from the parallel arrays the variant keeps them in. */
function ruleSet(id, surface, appliesTo, positives, negatives) {
  return {
    id,
    surface,
    appliesTo,
    rules: RULE_NAMES.map((name, i) => ({
      name,
      canonicalId: CANONICAL_IDS[i],
      pattern: RULE_PATTERNS[i],
      positive: positives[i],
      negative: negatives[i],
    })),
  };
}

/** The extra self-test material this repository's evidence contributes to the canonical floor. */
const extraSamples = {};
CANONICAL_IDS.forEach((id, i) => {
  extraSamples[id] = {
    positives: [POSITIVE[i], SRC_POSITIVE[i]],
    negatives: [NEGATIVE[i], SRC_NEGATIVE[i]],
  };
});

export default {
  repo: "hl7",
  state: "populated",

  /** The submodule sha the variant was read at. A corpus entry with no sha is unattributable. */
  sha: "086ae193b34375d8a6b7ada711b181f341dc6b62",
  sourcePath: "scripts/check-no-internal-refs.sh",
  sourceLines: 1044,
  adoptedBy: "S0331-internal-refs-gate-consolidation",

  /**
   * The configuration this variant resolves to against the shared implementation.
   *
   * This is what the superset grader runs, so the claim it grades is "the shared implementation,
   * configured the way this repository configures it, carries this repository's whole rule set"
   * rather than "the shared implementation carries some rule set".
   */
  canonicalConfig: {
    projectPrefixes: PROJECT_PREFIXES,
    standardsDesignations: STANDARDS_DESIGNATIONS,
    surfacePaths: ["README.md", "TRADEMARKS.md", "LICENSE", "docs-content"],
    accountedTarballFiles: ["CHANGELOG.md", "dist"],
    sourceDocComments: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
    extraSamples,
  },

  /**
   * THE RULE INVENTORY, as two rule sets rather than one.
   *
   * The variant keeps a separate array for the source doc-comment surface. They START identical and
   * are ALLOWED to diverge, and where they do, each side's negative sample is what stops the
   * divergence from being a widening. A corpus shape that collapsed them into one list would lose
   * exactly the fact the next adopter needs.
   */
  ruleSets: [
    ruleSet(
      "surface",
      "public",
      "README.md, TRADEMARKS.md, LICENSE, docs-content/ and the npm description and keywords",
      POSITIVE,
      NEGATIVE,
    ),
    ruleSet(
      "src-doc-comments",
      "source",
      "the doc-comment blocks in src/ that compile into the shipped type declarations",
      SRC_POSITIVE,
      SRC_NEGATIVE,
    ),
  ],

  /**
   * DISCLOSED NON-CATCHES. Recorded so a sweep can tell a decision from an oversight, and kept out
   * of the rule inventory so the superset property is never asked to cover one.
   */
  residuals: [
    { id: "i", what: "the prefix list is duplicated from an upstream Node script and can drift" },
    { id: "ii", what: "file CONTENTS are scanned, never file NAMES" },
    { id: "iii", what: "an identifier inside a fence, a URL or a link target is treated as prose" },
    { id: "iv", what: "the em dash is a different gate's rule and is not checked here" },
    { id: "v", what: "identifiers are caught; ordinary English about our process is not" },
    {
      id: "vi",
      what: "single-letter decision numbers are NOT caught, because the shape collides with legacy SNOMED RT axis codes",
    },
    { id: "vii", what: "`phase` at the end of a clause, with nothing after it, is not caught" },
    {
      id: "viii",
      what: "a known false positive on DICOM MR vocabulary (`phase encoding`), left unfixed rather than widened quietly",
    },
    { id: "ix", what: "a violation split by inline markup rejoins in neither pass" },
    { id: "x", what: "a wrap after a backslash hard break keeps the backslash between the tokens" },
    {
      id: "xi",
      what: "the source pass gates the SOURCE of the shipped declarations, never the built output",
    },
    {
      id: "xii",
      what: "the jargon rule false-positives on `the per-X slice of Y` in code prose; the instances were rewritten and the rule was not narrowed",
    },
    {
      id: "xiii",
      what: "internal decision numbers and item identifiers from nine prefixes the list does not hold still ship in the built declarations",
    },
    {
      id: "xiv",
      what: "the source pass sweeps doc comments that never reach an exported declaration",
    },
  ],

  notes:
    "The two rule arrays are byte-identical in their patterns at this sha and differ only in their " +
    "self-test material. The next adopter should expect that not to hold: the variant's own note " +
    "says the two surfaces have different collision profiles and are allowed to diverge.",
};
