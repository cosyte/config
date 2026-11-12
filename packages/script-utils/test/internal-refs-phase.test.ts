/**
 * The phase rule on clinical study phase wording in a standard's own data, against roadmap wording
 * put into the same sentences.
 *
 * HL7 Terminology gives two display texts in table 0003 that a parser vendors as data:
 * `CRM - Correct/update phase information` and `MFN/MFK - Clinical study without phases but with
 * schedules master file`. An ordinary lowercase word after `phase` makes it a noun in a sentence; a
 * roadmap phase is named by a number, a number word, a letter, a roman numeral, or a capitalized
 * word. Each passage is decided by the words around the match, never by where it sits.
 *
 * In the package, not only at the root, so the package's own coverage sees the rule run: the root
 * suites drive the same module, but this package's coverage counts its own suite only.
 */

import { describe, expect, it } from "vitest";

import { compileCanonicalRules, resolveConfig, runSelfTests } from "../internal-refs.js";

const { resolved } = resolveConfig({
  projectPrefixes: ["HL7"],
  standardsDesignations: [],
  surfacePaths: ["README.md"],
  accountedTarballFiles: [],
});
if (resolved === undefined) throw new Error("the base configuration did not resolve");
const rules = compileCanonicalRules(resolved);
const phase = rules.find((rule) => rule.id === "phase-or-wave");
if (phase === undefined) throw new Error("the phase rule is missing from the canonical set");

/** Every hit the phase rule reports in one passage, in pattern order. */
function hits(text: string): string[] {
  return phase!.patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
}

const HL7_CRM = "CRM - Correct/update phase information";
const HL7_MFN = "MFN/MFK - Clinical study without phases but with schedules master file";

describe("the phase rule on clinical study phase wording", () => {
  it("lets both table 0003 display texts through", () => {
    expect(hits(HL7_CRM)).toEqual([]);
    expect(hits(HL7_MFN)).toEqual([]);
  });

  it.each([
    ["the phase information a sender corrects", "Correct the phase information before it is sent."],
    ["a study without phases", "A study without phases but with schedules."],
    ["MR phase encoding", "The phase encoding direction is a DICOM attribute."],
    ["phase contrast imaging", "Phase contrast angiography and phase contrast flow."],
    ["a phase shift", "The signal shows a phase shift and a phase angle."],
    ["phases that follow a dose", "Two phases follow each dose, and the phases differ."],
    ["a phase lag", "The trace has a phase lag of a few samples."],
    ["the clinical field names in any case", "STUDY PHASE IDENTIFIER and Study Phase Start"],
    ["a trial roman numeral in any case", "A PHASE III TRIAL and a phase ii study"],
  ])("lets clinical and imaging phase wording through: %s", (_label, text) => {
    expect(hits(text)).toEqual([]);
  });

  it.each([
    ["a number in the CRM text", "CRM - Correct/update phase 2", "phase 2"],
    ["a number word in the CRM text", "CRM - Correct/update phase one", "phase one"],
    [
      "a capitalized name in the CRM text",
      "CRM - Correct/update Phase Information",
      "Phase Information",
    ],
    ["a number after the plural", "Clinical study without phases 2 and 3", "phases 2"],
    [
      "a number word after the plural",
      "A study without phases two but with schedules",
      "phases two",
    ],
    ["a letter", "The schedules master file lands in phase b", "phase b"],
    ["a roman numeral with no trial after it", "The master file lands in phase iv", "phase iv"],
    ["a Greek letter name", "The master file lands in phase beta", "phase beta"],
    ["a lowercase phase before a name", "It ships in phase Atlas", "phase Atlas"],
    ["a name in capitals", "It ships in PHASE ATLAS", "PHASE ATLAS"],
    ["a wave count", "The master file ships in wave 3", "wave 3"],
    ["an adjective form", "The schedules arrive in a later phase", "later phase"],
    ["a phase-by-phase ladder", "The master file lands phase-by-phase from here", "phase-by-phase"],
    ["a phase-by-phase ladder in capitals", "It ships PHASE-BY-PHASE", "PHASE-BY-PHASE"],
  ])("still refuses roadmap wording: %s", (_label, text, hit) => {
    expect(hits(text)).toEqual([hit]);
  });

  /** Every English number word a phase could be named by, zero to twenty, the tens and hundred. */
  const NUMBER_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "hundred",
  ];

  /** All 24 Greek letter names. */
  const GREEK_LETTERS = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
    "iota",
    "kappa",
    "lambda",
    "mu",
    "nu",
    "xi",
    "omicron",
    "pi",
    "rho",
    "sigma",
    "tau",
    "upsilon",
    "phi",
    "chi",
    "psi",
    "omega",
  ];

  it.each([...NUMBER_WORDS, ...GREEK_LETTERS])("still refuses a phase named %s", (word) => {
    expect(hits(`The master file ships in phase ${word}.`)).toEqual([`phase ${word}`]);
    expect(hits(`PHASE ${word.toUpperCase()} ships`)).toEqual([`PHASE ${word.toUpperCase()}`]);
  });

  it.each([...NUMBER_WORDS, ...GREEK_LETTERS])(
    "lets %s through as a near miss: the name before phase, or inside a longer word",
    (word) => {
      expect(hits(`A ${word} phase offset is a signal property.`)).toEqual([]);
      expect(hits(`The phase ${word}ish drift is a signal property.`)).toEqual([]);
    },
  );

  it.each([
    "twenty-one",
    "thirty-two",
    "forty-three",
    "fifty-four",
    "sixty-five",
    "seventy-six",
    "eighty-seven",
    "ninety-nine",
  ])("still refuses the whole hyphenated number word %s", (word) => {
    expect(hits(`It ships in phase ${word}, after the rest`)).toEqual([`phase ${word}`]);
  });

  it.each([
    ["a no-break space", "phase 2"],
    ["two spaces", "phase  2"],
    ["a tab", "phase\t2"],
    ["spaces and a tab before a word", "phases \t two"],
    ["a no-break space before a name", "Phase Atlas"],
  ])("still refuses a phase name after %s", (_label, name) => {
    expect(hits(`It ships in ${name} next`)).toEqual([name]);
  });

  it.each([
    ["a no-break space", "phase information"],
    ["two spaces", "phase  encoding"],
    ["a tab", "phases\tbut with schedules"],
  ])("lets clinical wording through after %s", (_label, text) => {
    expect(hits(`Correct the ${text} first.`)).toEqual([]);
  });

  it("reports one name once, though two patterns could each read it", () => {
    expect(hits("Phase 3 and Phase W shipped, then Phase Atlas")).toEqual([
      "Phase 3",
      "Phase W",
      "Phase Atlas",
    ]);
  });

  it("carries both display texts and the near misses in the self-test floor, which holds", () => {
    expect(phase!.negatives.join(" ")).toContain(HL7_CRM);
    expect(phase!.negatives.join(" ")).toContain(HL7_MFN);
    expect(phase!.positives).toContain("CRM - Correct/update phase one, then phases 2 and 3");
    expect(phase!.positives).toContain("Phase Information and phase Atlas shipped");
    expect(runSelfTests(rules)).toEqual([]);
  });
});
