/**
 * The phase rule on clinical study phase wording in a standard's own data, against roadmap wording
 * put into the same sentences.
 *
 * HL7 Terminology gives two display texts in table 0003 that a parser vendors as data:
 * `CRM - Correct/update phase information` and `MFN/MFK - Clinical study without phases but with
 * schedules master file`. The rule's patterns are left exactly as they were and still name every
 * candidate; one narrow excuse lets a candidate through when it is `phase` or `phases`, one space,
 * and a word of lowercase ASCII letters that is not a number word, ordinal, Greek letter name,
 * roman numeral with at most one letter after it, or single letter. Each passage is decided by the
 * words around the match, never by where it sits.
 *
 * The proof that nothing else moved: over a generated corpus, what the rule refuses now is exactly
 * what the frozen copy of the old patterns refused, minus what the excuse, written out again here
 * from its definition, lets through.
 *
 * In the package, not only at the root, so the package's own coverage sees the rule run: the root
 * suites drive the same module, but this package's coverage counts its own suite only.
 */

import { describe, expect, it } from "vitest";

import { compileCanonicalRules, resolveConfig, ruleHits, runSelfTests } from "../internal-refs.js";

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

/** Every hit the phase rule reports in one passage, as the gate reads it. */
function hits(text: string): string[] {
  return ruleHits(phase!, text);
}

/**
 * The phase rule's two patterns as they stood before the excuse, frozen. The rule must still carry
 * them byte for byte: they decide what is a candidate, and only the excuse may let one through.
 */
const OLD_PATTERNS: readonly { source: string; flags: string }[] = [
  {
    source:
      "\\b(?:roadmap phases?\\b[ ]?[A-Za-z0-9]*|(?<!study )(?<!clinical )(?<!trial )(?<!acute )" +
      "(?<!chronic )(?<!luteal )(?<!follicular )(?<!liquid )(?<!gas )(?<![A-Za-z]-)phases?[ -]" +
      "(?!of\\b|with\\b|in\\b|out\\b|the\\b|and\\b|is\\b|for\\b|to\\b|identifier\\b|start\\b|" +
      "end\\b|evaluability\\b|number\\b|where\\b|are\\b|was\\b|were\\b|during\\b|at\\b|" +
      "(?:I{1,3}|IV)\\s+(?:trial|stud|clinical|oncolog))[A-Za-z0-9]+[a-z]?\\b|wave \\d+\\b|" +
      "the \\w+ and final phase\\b|documentation residual\\b|(?:first|second|third|fourth|fifth|" +
      "sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|" +
      "sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|" +
      "twenty-third|twenty-fourth|\\d+(?:st|nd|rd|th)) (?:slice|wave)\\b)",
    flags: "gi",
  },
  {
    source:
      "\\b(?:subsequent|later|earlier|future|upcoming|next|previous|remaining)\\s+" +
      "(?:phases?|waves?)\\b(?!\\s+of\\b)|\\bwaves\\s+\\d+\\b|" +
      "\\b(?:the|this|its|our)\\s+(?:\\w+\\s+)?roadmaps?\\b",
    flags: "gi",
  },
];

/** The old patterns, sticky, so each one can be tried at every position of a text. */
const OLD_STICKY = OLD_PATTERNS.map(
  (pattern) => new RegExp(pattern.source, `${pattern.flags.replace("g", "")}y`),
);

/** Every match the old patterns make at any start position, with what follows it. */
function oldCandidates(text: string): { match: string; after: string }[] {
  const found: { match: string; after: string }[] = [];
  for (const pattern of OLD_STICKY) {
    for (let start = 0; start <= text.length; start += 1) {
      pattern.lastIndex = start;
      const match = pattern.exec(text);
      if (match === null) continue;
      found.push({ match: match[0], after: text.slice(start + match[0].length) });
    }
  }
  return found;
}

/** Every English number word from zero to nineteen, the tens and hundred. */
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

/** The hyphenated number words. */
const HYPHENATED_NUMBERS = ["twenty-one", "thirty-two", "forty-three", "ninety-nine"];

/** The written ordinals the rule already knows for `slice` and `wave`. */
const ORDINAL_WORDS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
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

/** A number from 1 to 49 as a lowercase roman numeral. */
function roman(value: number): string {
  const tens = ["", "x", "xx", "xxx", "xl"][Math.floor(value / 10)]!;
  const units = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"][value % 10]!;
  return tens + units;
}

const ROMAN_NUMERALS = Array.from({ length: 49 }, (_unused, index) => roman(index + 1));

/**
 * The excuse, written out again from its definition rather than imported, so the test does not
 * grade the code with itself: `phase` or `phases` in any case, one space, then a word of lowercase
 * ASCII letters that ends where the match ends and names no phase.
 */
function excusedBySpec(match: string, after: string): boolean {
  if (match.slice(0, 5).toLowerCase() !== "phase") return false;
  const rest = match.slice(5);
  let word: string;
  if (rest.startsWith(" ")) word = rest.slice(1);
  else if (/^[sS] /.test(rest)) word = rest.slice(2);
  else return false;
  if (!/^[a-z]+$/.test(word)) return false;
  if (/^[-\p{L}\p{N}\p{M}]/u.test(after)) return false;
  if (word.length === 1) return false;
  if (/^[ivxlcdm]+[a-z]?$/.test(word)) return false;
  return ![...NUMBER_WORDS, ...ORDINAL_WORDS, ...GREEK_LETTERS].includes(word);
}

/** What the old patterns refused, minus what the excuse lets through. */
function refusedByOldMinusExcused(text: string): boolean {
  return oldCandidates(text).some(({ match, after }) => !excusedBySpec(match, after));
}

const HL7_CRM = "CRM - Correct/update phase information";
const HL7_MFN = "MFN/MFK - Clinical study without phases but with schedules master file";

describe("the phase rule on clinical study phase wording", () => {
  it("carries the old patterns unchanged, so they still decide every candidate", () => {
    expect(
      phase!.patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags })),
    ).toEqual(OLD_PATTERNS);
  });

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
    ["the word at the end of the text", "Correct/update phase information"],
    ["a capitalized or capital phase", "PHASE information, Phases but and PHASES but"],
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
    ["a roman numeral", "The master file lands in phase iv", "phase iv"],
    ["a lowercase roman numeral with a letter", "the work ships in phase iib", "phase iib"],
    ["a one-letter roman numeral with a letter", "It ships in phase ib", "phase ib"],
    ["a lowercase roman numeral over four letters", "It ships in phase xxiii", "phase xxiii"],
    ["a capitalized phase before a lowercase numeral", "Phase iib ships", "Phase iib"],
    ["a capital phase before a lowercase numeral", "PHASE iia ships", "PHASE iia"],
    ["a Greek letter name", "The master file lands in phase beta", "phase beta"],
    ["an ordinal", "It ships in phase second", "phase second"],
    ["a lowercase phase before a name", "It ships in phase Atlas", "phase Atlas"],
    ["a mixed-case phase before a name", "It ships in pHaSe Atlas", "pHaSe Atlas"],
    ["a name in capitals", "It ships in PHASE ATLAS", "PHASE ATLAS"],
    ["a hyphen after phase", "The master file lands phase-by-phase from here", "phase-by"],
    ["a hyphen after the word", "It lands in phase information-based form", "phase information"],
    ["a capital inside the word", "It lands in phase coNTRAST form", "phase coNTRAST"],
    [
      "a roadmap phase before a word",
      "Per a roadmap phases foundations",
      "roadmap phases foundations",
    ],
    ["a wave count", "The master file ships in wave 3", "wave 3"],
    ["an adjective form", "The schedules arrive in a later phase", "later phase"],
  ])("still refuses roadmap wording: %s", (_label, text, hit) => {
    expect(hits(text)).toEqual([hit]);
  });

  it.each([
    ["via", "phase via"],
    ["mix", "phase mix"],
    ["did", "phase did"],
  ])(
    "keeps refusing an ordinary word made only of roman numeral letters, as before: %s",
    (_label, hit) => {
      expect(hits(`The work lands in ${hit} the queue`)).toEqual([hit]);
    },
  );

  it.each([
    ["a letter outside ASCII", "phase informaçion", "phase informa"],
    ["a digit outside ASCII", "phase abc٢", "phase abc"],
    ["a combining mark", "phase informatión", "phase informatio"],
  ])("does not excuse a word that goes on past the match: %s", (_label, text, hit) => {
    expect(hits(`Correct the ${text} now`)).toEqual([hit]);
  });

  it("finds a hit that starts inside an excused one", () => {
    expect(hits("Two phases phase 2 shipped")).toEqual(["phase 2"]);
  });

  it.each([
    ...NUMBER_WORDS,
    ...HYPHENATED_NUMBERS,
    ...ORDINAL_WORDS,
    ...GREEK_LETTERS,
    ...ROMAN_NUMERALS,
  ])("still refuses a phase named %s in lowercase", (word) => {
    expect(hits(`The master file ships in phase ${word}.`)).toHaveLength(1);
  });

  it("refuses exactly what the old patterns refused, minus what the excuse lets through", () => {
    const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
    const names = [
      ...NUMBER_WORDS,
      ...HYPHENATED_NUMBERS,
      ...ORDINAL_WORDS,
      ...GREEK_LETTERS,
      ...ROMAN_NUMERALS,
    ];
    const words: string[] = [];
    for (const name of names) {
      for (const suffix of ["", "a", "b"]) {
        const word = name + suffix;
        words.push(word, cap(word), word.toUpperCase());
      }
    }
    const frames = [
      (word: string) => `The work ships in phase ${word}.`,
      (word: string) => `Phase ${word} closes it`,
      (word: string) => `PHASE ${word}`,
      (word: string) => `Clinical study without phases ${word} but with schedules`,
      (word: string) => `Correct/update phase-${word} now`,
      (word: string) => `It lands in phase ${word}-based form`,
    ];
    const corpus = words.flatMap((word) => frames.map((frame) => frame(word)));
    corpus.push(...REVIEW_CASES, HL7_CRM, HL7_MFN);

    const disagreements = corpus.filter(
      (text) => hits(text).length > 0 !== refusedByOldMinusExcused(text),
    );
    expect(disagreements).toEqual([]);
    // The corpus reaches both sides: names the excuse leaves refused, and words it lets through.
    expect(corpus.filter((text) => hits(text).length > 0).length).toBeGreaterThan(5000);
    expect(
      corpus.filter((text) => oldCandidates(text).length > 0 && hits(text).length === 0),
    ).not.toEqual([]);
  });

  it("carries both display texts and the near misses in the self-test floor, which holds", () => {
    expect(phase!.negatives).toContain(HL7_CRM);
    expect(phase!.negatives).toContain(HL7_MFN);
    expect(phase!.positives).toContain("The work ships in phase iib");
    expect(phase!.positives).toContain("CRM - Correct/update phase one");
    expect(runSelfTests(rules)).toEqual([]);
  });
});

describe("ruleHits", () => {
  it("reads a rule with no excuse as matchAll does, empty matches included", () => {
    expect(ruleHits({ patterns: [/a*/g] }, "ba")).toEqual(["", "a", ""]);
    expect(ruleHits({ patterns: [/x/g, /y/g] }, "yxy")).toEqual(["x", "y", "y"]);
  });

  it("drops what a rule's excuse returns true for, and keeps the rest", () => {
    const rule = { patterns: [/\w+/g], excuse: (found: RegExpExecArray) => found[0] === "b" };
    expect(ruleHits(rule, "a b c")).toEqual(["a", "c"]);
  });
});

/**
 * The inputs two earlier reviews of this rule ran against it, carried so the corpus above keeps
 * every case they raised.
 */
const REVIEW_CASES = [
  "ships in phase two-b",
  "phase 2a",
  "phase-2",
  "phase 2",
  "PHASE TWO",
  "phase ii",
  "phase  2",
  "phase\n2",
  "phase:2",
  "phases 1 and 2",
  "the next phase",
  "in a later phase",
  "second phase",
  "in the second phase",
  "phase after next",
  "phase zero",
  "phase **2**",
  "phase <b>2</b>",
  "phase `2`",
  "phase thirteen",
  "phase twenty",
  "phase omega",
  "phase epsilon",
  "phase final",
  "phase foundations",
  "phase next",
  "phase later",
  "the next phase ships",
  "Phase two",
  "phase Two",
  "phase II",
  "phase iii",
  "phase xi",
  "phase v",
  "phase 2.0",
  "phase #2",
  "phase (2)",
  "phase_2",
  "phase two.",
  "we will do this in phase two",
  "phase one-and-a-half",
  "phase-one",
  "phase-alpha",
  "phase gamma",
  "phase delta",
  "phase eta",
  "phase beta2",
  "PHASE 2",
  "PhAsE 2",
  "phase\t2",
  "phases two and three",
  "phase three",
  "Phase Three",
  "phase onboarding",
  "phase cleanup",
  "phase hardening",
  "phase rollout",
  "phase mvp",
  "phase MVP",
  "phase v2",
  "phase 1b",
  "later phases",
  "phase later this year",
  "phase first",
  "phase last",
  "phase final release",
  "phase thirteen ships",
  "phase fourteen",
  "phase lambda",
  "phase omega lands",
  "phase sigma",
  "phase kappa",
  "phase theta",
  "phase iota",
  "phase zeta",
  "phase encoding",
  "Phase contrast",
  "PHASE INFORMATION",
  "Phase Information",
  "Correct/update Phase Information",
  "STUDY PHASE IDENTIFIER",
  "a Phase I trial",
  "Phase 1 clinical trial",
  "a phase 2 study",
  "a Phase 3 trial",
  "phase I/II trial",
  "Phase IIb trial",
  "Phase 2b study",
  "Phase I clinical study",
  "Phase III randomized trial",
  "phase 3 oncology trial",
  "in phase I of the trial",
  "the drug entered Phase 3",
  "Phase Contrast",
  "Phase Encoding Direction",
  "PHASE ENCODING",
  "phase-contrast",
  "Clinical Trial Phase",
  "Study phase",
  "trial phase 2",
  "phase 2 trial",
  "phase II/III",
  "phase-out",
  "Phase-out",
  "phase in",
  "phases out",
  "phase angle",
  "Phase Angle",
  "Phase of Care",
  "phase of care",
  "Phase Thirteen",
  "pHaSe xi",
  "phase 2nd",
  "phase 3rd",
  "phase second",
  "phase third",
  "phase 2b",
  "phase b2",
  "phase etal",
  "phase information",
  "phases but",
  "phase mu-opioid",
  "phase pi-pulse",
  "phase chi-square",
  "phase Mu-opioid",
  "pHaSe Atlas",
  "PhAsE Atlas",
  "PHASE Atlas",
  "PHASE atlas",
  "Phase atlas",
  "phase-Atlas",
  "phase Atlas",
  "phase\tAtlas",
  "phase Atlas",
  "phase 2",
  "phase　2",
  "phase\r2",
  "phase\v2",
  "phase\f2",
  "phase-by-phase",
  "Phase-by-phase",
  "PHASE-BY-PHASE",
  "phase by phase",
  "phase-by-Phase",
  "phases-by-phase",
  "phase X",
  "phase x",
  "phase a",
  "phase I",
  "phase iv",
  "phase IIb",
  "phase IIIa",
  "phase iiib",
  "phase Ib/II",
  "phase GA",
  "phase Beta",
  "phase Alpha",
  "Phase Omega",
  "phase ω",
  "phase β",
  "phase Ⅱ",
  "phase ２",
  "phase twenty-one",
  "phase twenty one",
  "phase onehundred",
  "phase thousand",
  "phase million",
  "phase zeroth",
  "phase eleventh",
  "phase twelfth",
  "phase thirteenth",
  "phase twentieth",
  "wave 3",
  "Wave 3",
  "wave three",
  "waves 2",
  "in later phases",
  "in phase two",
  "phase 0",
  "phase-0",
  "phase.2",
  "phase Two-B",
  "study phase two",
  "trial phase III",
  "acute phase reactant",
  "Study Phase Atlas",
  "Clinical Phase Information",
  "Study Phase Identifier",
  "acute Phase Two",
  "ACUTE PHASE Atlas",
  "Phase Contrast angiography",
  "Phase Encoding",
  "phase Information",
  "Correct/Update Phase Information",
  "Phase Shift",
  "phase Shift",
  "phases But",
  "Phase III clinical trial",
  "phase ii study",
  "Phase IV Oncology",
  "phase iv TRIAL",
  "phase I  trial",
  "phase the",
  "Phase The",
  "Phase And",
  "phase Of",
  "Phase Where",
  "Phase Of Care",
  "phase ib",
  "phase iia",
  "phase iib",
  "phase iiia",
  "phase iva",
  "phase ivb",
  "phase ia",
  "phase va",
  "phase Ib",
  "PHASE IIB",
  "PHASE iib",
  "phase xii",
  "phase xiii",
  "phase xiv",
  "phase xx",
  "phase xxi",
  "phase xxiii",
  "phase xxiv",
  "phase xxxviii",
  "phase XXXVIII",
  "phase ab",
  "phase rc",
  "phase poc",
  "Phase iib",
  "Phase ib",
  "the work ships in phase iib",
  "pHASE Atlas",
  "PHAse Atlas",
  "phASES Atlas",
];
