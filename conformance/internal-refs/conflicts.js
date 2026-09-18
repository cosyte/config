// conformance/internal-refs/conflicts.js
//
// THE CONFLICT REGISTER: every contradiction the populated corpus entries expose, with both rule
// sets, the rule it is about, and what the contradiction was DECIDED as.
//
// WHY A REGISTER RATHER THAN A DESIGN NOTE. Twelve variants of one gate disagree, and each
// disagreement has exactly two honest resolutions: it is a per-repository difference, in which case
// it becomes a configuration axis, or it is a property of the rule, in which case it becomes
// canonical and the variant that differs is wrong. Deciding case by case in prose produces a shared
// implementation whose shape nobody can account for. Each row here names the decision and the
// evidence it rests on, so the sweep that adopts the next repository can see which decisions were
// taken on one repository's evidence alone.
//
// WHAT COUNTS AS A CONTRADICTION. Two rule sets that disagree about whether a given text is a
// violation, or about whether a rule exists at all. A DISCLOSED RESIDUAL IS NOT ONE: a variant that
// says "this is deliberately not caught" agrees with every other variant that does not catch it.
//
// SCOPE AT THIS SHA, stated rather than implied: exactly one entry is populated, so every row below
// is a contradiction between hl7's variant and a source that variant itself records. There is no
// variant-against-variant row yet, and there will not be until a second entry is populated.

/**
 * One recorded contradiction.
 *
 * @typedef {object} Conflict
 * @property {string} id Stable id, so a later note can cite a row.
 * @property {string} rule The rule the two sides disagree about.
 * @property {string[]} repos The populated corpus entries this contradiction is exposed by.
 * @property {{ source: string, position: string }[]} between The two rule sets, and what each says.
 * @property {"configuration-axis" | "canonical"} resolution Which of the two honest resolutions.
 * @property {string} decidedAs The axis name, or the canonical behaviour, the resolution produced.
 * @property {string} why The reasoning, including whose evidence it rests on.
 */

/** @type {Conflict[]} */
const CONFLICTS = [
  {
    id: "prefix-set-pkg",
    rule: "internal project identifier",
    repos: ["hl7"],
    between: [
      {
        source: "hl7 scripts/check-no-internal-refs.sh @ 086ae193b34375d8a6b7ada711b181f341dc6b62",
        position:
          "`PKG` is DELIBERATELY ABSENT from the prefix set, and the file says so: `PKG` is the " +
          "Item Packaging segment, so `PKG-1` and `PKG-4` are segment-field references a consumer " +
          "legitimately needs, and they are asserted in that rule's negative sample.",
      },
      {
        source:
          "the upstream release-note content rules hl7's variant records itself as transcribed from",
        position: "`PKG` is PRESENT in the prefix list, so `PKG-4` is a violation.",
      },
    ],
    resolution: "configuration-axis",
    decidedAs: "projectPrefixes",
    why:
      "The two sides are both right about their own surface: a release body has no segment-field " +
      "references and a parser's documentation is made of them. That is the definition of a " +
      "per-repository difference, so the prefix set is a required axis with no default rather than " +
      "a list inside the shared implementation. It is also why the axis is REQUIRED: a default " +
      "prefix set would be one repository's answer imposed on eleven others, which is the shape " +
      "this contradiction is an instance of.",
  },
  {
    id: "phase-clinical-guards",
    rule: "phase or wave language",
    repos: ["hl7"],
    between: [
      {
        source: "hl7 scripts/check-no-internal-refs.sh @ 086ae193b34375d8a6b7ada711b181f341dc6b62",
        position:
          "The phase rule carries two guards that are NOT in the rule it was lifted from: " +
          "lookbehinds dropping the clinical senses of `phase`, and a lookahead dropping the " +
          "Clinical Study Phase field-name tails and the clinical-trial roman numerals. " +
          "`CSP-1 Study Phase Identifier` and `a Phase III oncology trial` are reference material.",
      },
      {
        source:
          "the upstream release-note content rules hl7's variant records itself as transcribed from",
        position:
          "The phase rule has no clinical guard, so `Study Phase Identifier` and `Phase III` are " +
          "violations.",
      },
    ],
    resolution: "canonical",
    decidedAs: "the clinical guards on the canonical `phase or wave language` rule",
    why:
      "This is NOT a per-repository difference. The collision is with healthcare reference " +
      "vocabulary, and every repository in this corpus documents a healthcare standard, so a " +
      "guard that only hl7 carries would let the other eleven tell a remediator to rewrite a field " +
      "name. Made canonical, and therefore not subtractable. MEASURED ON ONE VARIANT: hl7's is the " +
      "only populated entry, so the claim that the other eleven need the same guard is inference " +
      "from what they parse rather than from what their rule sets say. The first sweep to populate " +
      "a second entry should check this row before anything else.",
  },
  {
    id: "rules-added-not-lifted",
    rule: "internal repo path, internal traceability marker",
    repos: ["hl7"],
    between: [
      {
        source: "hl7 scripts/check-no-internal-refs.sh @ 086ae193b34375d8a6b7ada711b181f341dc6b62",
        position:
          "Two rules exist here that the upstream set does not have: internal repo paths, and " +
          "bracketed traceability tags with the open-question phrasing. Both were added by reading " +
          "this repository's own pages rather than designed, because a documentation page carries " +
          "citations while a release body carries prose.",
      },
      {
        source:
          "the upstream release-note content rules hl7's variant records itself as transcribed from",
        position: "Neither rule exists, so neither shape is a violation.",
      },
    ],
    resolution: "canonical",
    decidedAs: "both rules are in the canonical set",
    why:
      "The superset is over what the variants FLAG. A rule one variant carries and another does " +
      "not is carried by the shared implementation, because the alternative is a repository that " +
      "adopts the shared gate and stops catching something its own copy caught. Both rules are " +
      "delimiter-anchored rather than shape-keyed, which is what makes them safe to run everywhere: " +
      "the tag rule needs a literal opening bracket and two characters, so a documented character " +
      "range and a bracketed value-set name do not match.",
  },
  {
    id: "changelog-in-the-tarball",
    rule: "the scanned surface",
    repos: ["hl7"],
    between: [
      {
        source: "hl7 scripts/check-no-internal-refs.sh @ 086ae193b34375d8a6b7ada711b181f341dc6b62",
        position:
          "The changelog SHIPS INSIDE THE TARBALL, so it is genuinely public surface, and it is " +
          "excluded from the scan anyway. The file records this as a live contradiction in the " +
          "standard, ecosystem-wide, and not for one repository to settle alone.",
      },
      {
        source: "the same variant's own surface rule",
        position:
          "Anything a consumer receives in the tarball is public surface and is scanned, which is " +
          "what the tarball drift tripwire in that file enforces on every other entry.",
      },
    ],
    resolution: "configuration-axis",
    decidedAs: "accountedTarballFiles",
    why:
      "A contradiction the shared implementation must not silently pick a side in. The axis makes " +
      "the exclusion a DECLARATION: a repository that excludes its changelog writes it down, the " +
      "tripwire refuses anything it has not written down, and a reader can see the whole " +
      "accounting in one list. Settling the underlying question is estate work and is not this " +
      "implementation's to do.",
  },
  {
    id: "built-output-unreadable",
    rule: "the scanned surface",
    repos: ["hl7"],
    between: [
      {
        source: "hl7 scripts/check-no-internal-refs.sh @ 086ae193b34375d8a6b7ada711b181f341dc6b62",
        position:
          "The build directory is the first entry in the tarball manifest and carries the largest " +
          "prose payload a consumer receives, and it is untracked build output that no checked-in " +
          "gate can read without building. Its SOURCE is gated instead, by a separate pass over the " +
          "doc comments the declaration build copies verbatim.",
      },
      {
        source: "the same variant's own surface rule",
        position: "Anything a consumer receives in the tarball is public surface and is scanned.",
      },
    ],
    resolution: "configuration-axis",
    decidedAs: "accountedTarballFiles plus sourceDocComments",
    why:
      "Two axes, because the contradiction has two halves. The build directory is DECLARED in the " +
      "tarball accounting, so the tripwire does not fire on it and a reader can see it was a " +
      "decision. The proxy that makes the decision defensible, a pass over the source of the " +
      "shipped text, is the `sourceDocComments` axis, defaulted OFF because it is only sound for a " +
      "repository whose build copies doc text verbatim. Made an axis rather than canonical for " +
      "exactly that reason: a repository whose build transforms comments would be gating a proxy " +
      "that no longer holds.",
  },
];

export default CONFLICTS;
