// conformance/internal-refs/repos.js
//
// THE TWELVE REPOSITORIES THAT CARRY A HAND-WRITTEN INTERNAL-REFERENCE GATE.
//
// The list is here rather than derived, because deriving it would mean reading twelve repositories
// this repository does not contain. It is the roster the conformance corpus is keyed on: one entry
// per repository, present whether or not anybody has adopted the shared implementation yet. A key
// that is absent is a repository nobody can see is missing, which is the state this list exists to
// make impossible.
//
// `dicom` IS DELIBERATELY NOT HERE. It is the thirteenth published package repository and it
// carries no variant of this gate at all, which the estate's own drift baseline records. Adding it
// as a pending key would assert that a variant exists there to adopt.

/** The repositories carrying a variant, in the order the estate's drift baseline lists them. */
export const REPOS = Object.freeze([
  "hl7",
  "mllp",
  "x12",
  "ccda",
  "ncpdp",
  "fhir",
  "astm",
  "terminology",
  "transform",
  "cli",
  "deid",
  "synth",
]);
