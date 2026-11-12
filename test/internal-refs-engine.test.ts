import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  CONFIG_AXES,
  REFUSED_OPTIONS,
  canonicalRuleNames,
  classifyTrackedMode,
  compileCanonicalRules,
  resolveConfig,
  runInternalRefsScan,
} from "@cosyte/script-utils/internal-refs";

import {
  cleanManifest,
  makeScratchRepo,
  runGate,
  type ScratchRepo,
} from "./support/internal-refs-repo";

/**
 * THE SHARED INTERNAL-REFERENCE GATE, graded on what it REFUSES rather than on what it finds.
 *
 * A gate that exits 0 without having checked anything is worse than no gate, because the run
 * conclusion is the only thing anyone reads. Every case below is a route to that conclusion: an
 * axis a caller forgot, a configuration that subtracts a rule, a target enumerated and never
 * opened, an input no text matcher can read. Each one must be a non-zero exit naming the cause.
 *
 * The happy path is here too, and it is the smallest part of the file on purpose.
 */

/** A marker for "delete this axis", so `undefined` can stay a hostile VALUE where one is wanted. */
const MISSING = Symbol("axis absent");

/**
 * Scratch repositories, MEMOISED BY NAME.
 *
 * A `git init` plus a commit per case is measurable: the parameterised blocks below run dozens of
 * cases against a tree that never changes between them, and the earlier shape put this file's own
 * subprocess load on top of every other suite's. Cases that MUTATE their tree take a name of their
 * own, which is what keeps the sharing honest.
 */
const REPOS = new Map<string, ScratchRepo>();

function scratch(name: string, readme?: string): ScratchRepo {
  const existing = REPOS.get(name);
  if (existing !== undefined) return existing;
  const repo = makeScratchRepo(name, readme);
  REPOS.set(name, repo);
  return repo;
}

afterAll(() => {
  for (const repo of REPOS.values()) repo.dispose();
});

/** A configuration that is complete and passes, so a case can mutate exactly one thing. */
function baseConfig(repo: ScratchRepo): Record<string, unknown> {
  return {
    projectPrefixes: ["HL7", "CCDA", "MLLP"],
    standardsDesignations: [
      String.raw`HL7-(?:V2|V3|CDA|FHIR|OMG|\d{3,4}[A-Z]?)`,
      String.raw`FHIR-R\d[A-Z]?`,
    ],
    surfacePaths: ["README.md"],
    accountedTarballFiles: [],
    repoRoot: repo.root,
  };
}

describe("the clean path, and what a clean run is allowed to mean", () => {
  it("exits 0 and states how many targets and how many rules it scanned", () => {
    const repo = scratch("irefs-clean");
    const result = runGate(baseConfig(repo));

    expect(result.err, result.err).toBe("");
    expect(result.code).toBe(0);
    // The two counts the contract requires a clean run to state. `2` is the README plus the npm
    // metadata, which is a target of every run and is named as such.
    expect(result.out).toContain("2 target(s)");
    expect(result.out).toContain(`${canonicalRuleNames().length} rule(s)`);
  });

  it("skips a gitlink and says how many it skipped, rather than counting it as read", () => {
    const repo = scratch("irefs-gitlink");
    // A submodule is a tracked entry with no bytes at that path. It is the one thing enumeration
    // may pass over, so the count is reported rather than left implicit.
    const inner = scratch("irefs-gitlink-inner");
    repo.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.root, "vendor");
    repo.git("commit", "-q", "-m", "submodule");

    const result = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "vendor"] });
    expect(result.err, result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("1 gitlink(s) skipped");
  });
});

describe("a hit names the file, the line and the rule, and exits non-zero", () => {
  it("reports an identifier on a public page", () => {
    const repo = scratch("irefs-hit", "# Scratch\n\nItem HL7-N7 landed here.\n");
    const result = runGate(baseConfig(repo));

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("[internal project identifier]");
    expect(result.err).toContain("README.md:3");
    expect(result.err).toContain("Item HL7-N7 landed here.");
  });

  it("reports a hit in the npm metadata under a name a reader can act on", () => {
    const repo = scratch("irefs-npm");
    repo.write(
      "package.json",
      JSON.stringify({
        name: "scratch",
        version: "0.0.0",
        description: "Ships in Phase 5b",
        keywords: ["scratch"],
        files: ["README.md"],
      }),
    );
    repo.track("package.json");

    const result = runGate(baseConfig(repo));
    expect(result.code).toBe(1);
    expect(result.err).toContain("package.json (npm metadata)");
    expect(result.err).toContain("[phase or wave language]");
  });

  it("sees a violation that straddles a line wrap, which a line matcher cannot", () => {
    // The route that made hand-written copies of this gate print OK over a live violation: every
    // rule but the bare identifier is multi-token, and these repositories hard-wrap their markdown.
    // Neither half of `wave 2` is a violation on its own, so only the joined paragraph can see it.
    const wrapped = scratch("irefs-wrapped", "# Scratch\n\nIt landed in wave\n2 of the work.\n");
    const wrappedResult = runGate(baseConfig(wrapped));
    expect(wrappedResult.code).toBe(1);
    expect(wrappedResult.err).toContain("wrapped across lines");
    expect(wrappedResult.err).toContain("README.md");
    expect(wrappedResult.err).toContain("wave 2");

    // The control, so the case above is not passing for an unrelated reason: the same sentence on
    // ONE line is caught by the line pass, with a line number, and is not reported twice.
    const flat = scratch("irefs-unwrapped", "# Scratch\n\nIt landed in wave 2 of the work.\n");
    const flatResult = runGate(baseConfig(flat));
    expect(flatResult.code).toBe(1);
    expect(flatResult.err).toContain("README.md:3");
    expect(flatResult.err).not.toContain("wrapped across lines");
  });

  it("scans doc comments when that pass is enabled, and not when it is not", () => {
    const repo = scratch("irefs-src");
    repo.write(
      "src/index.ts",
      ["/**", " * Build the thing (roadmap Phase G).", " */", "export const x = 1;", ""].join("\n"),
    );
    repo.track("src/index.ts");

    const off = runGate(baseConfig(repo));
    expect(off.code, off.all).toBe(0);

    const on = runGate({
      ...baseConfig(repo),
      sourceDocComments: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
    });
    expect(on.code).toBe(1);
    expect(on.err).toContain("src doc comment");
    expect(on.err).toContain("src/index.ts:2");
  });

  it("leaves a line comment alone, because it never reaches a consumer", () => {
    // The boundary this pass draws, and it is the point rather than a convenience: doc comments are
    // copied into the shipped declarations, and line comments are not. Identifiers are welcome in
    // what only a maintainer reads.
    const repo = scratch("irefs-src-line");
    repo.write(
      "src/index.ts",
      [
        "/**",
        " * Build the thing a consumer asked for.",
        " */",
        "// Added in Phase G for HL7-N7.",
        "export const x = 1;",
        "",
      ].join("\n"),
    );
    repo.track("src/index.ts");

    const result = runGate({
      ...baseConfig(repo),
      sourceDocComments: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
    });
    expect(result.code, result.all).toBe(0);
  });
});

/**
 * The phase rule's two guards, each with the passage it lets through and one it must still catch.
 *
 * The let-through passages are mllp's: its public source says `connect-phase socket`, `two-phase
 * state`, `All 5 phases are defined` and, in the `ConnectionError.phase` doc comment, `Connection
 * lifecycle phase where the error occurred`. Without the guards each of them is a hit, which is what
 * kept mllp on its own copy of the gate. The still-caught passages put a real phase name beside the
 * same words, so a guard widened past its shape reds here too.
 */
describe("the phase rule's compound-word and sentence guards", () => {
  const { resolved } = resolveConfig({
    projectPrefixes: ["MLLP"],
    standardsDesignations: [],
    surfacePaths: ["README.md"],
    accountedTarballFiles: [],
  });
  if (resolved === undefined) throw new Error("the base configuration did not resolve");
  const phase = compileCanonicalRules(resolved).find((rule) => rule.id === "phase-or-wave");
  if (phase === undefined) throw new Error("the phase rule is missing from the canonical set");

  /** Every hit the phase rule reports in one passage, in order. */
  function hits(text: string): string[] {
    return phase!.patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
  }

  it("lets `phase` through as the second half of a compound word", () => {
    expect(hits("Wrap a connect-phase socket error as an MllpConnectionError.")).toEqual([]);
    expect(hits("An enhanced-mode client gets its two-phase state.")).toEqual([]);
    expect(hits("The read-phase timeout fires once.")).toEqual([]);
  });

  it("still catches a phase named beside a compound word, and a hyphen after the word", () => {
    expect(hits("The connect-phase socket shipped in phase 2.")).toEqual(["phase 2"]);
    expect(hits("The two-phase state lands in Phase-L.")).toEqual(["Phase-L"]);
    // Only a LETTER and a hyphen make a compound, so a digit in front is still a phase name.
    expect(hits("Compare v2-phase 3 with the rest.")).toEqual(["phase 3"]);
  });

  it("lets `phase` through as a noun followed by what it is rather than by its name", () => {
    expect(hits("Connection lifecycle phase where the error occurred.")).toEqual([]);
    expect(hits("All 5 phases are defined even though only two are reachable.")).toEqual([]);
    expect(
      hits(
        "The phase was open and the phases were closed: a phase during which the socket " +
          "failed, and the phase at which it closed.",
      ),
    ).toEqual([]);
  });

  it("still catches a phase named before those words, and a word that only starts like one", () => {
    expect(hits("Phase 3 was where the error occurred.")).toEqual(["Phase 3"]);
    expect(hits("Phases 2 and 3 are defined.")).toEqual(["Phases 2"]);
    // The lookahead ends at a word boundary, so `Phase Atlas` and `Phase Arena` are names.
    expect(hits("Phase Atlas and Phase Arena shipped.")).toEqual(["Phase Atlas", "Phase Arena"]);
  });

  it("carries both guards' passages in the self-test floor, so a caller's run proves them too", () => {
    expect(phase!.negatives.join(" ")).toContain("connect-phase socket");
    expect(phase!.negatives.join(" ")).toContain("phase where the error occurred");
    expect(phase!.positives).toContain("The connect-phase socket shipped in phase 2");
    expect(phase!.positives).toContain("Phase 3 was where the error occurred");
  });
});

/**
 * Clinical study phase wording through the CLI: HL7 table 0003's display texts on a public page
 * exit 0, and a roadmap name put into the same sentence exits 1. The rule's own cases are in
 * `packages/script-utils/test/internal-refs-phase.test.ts`, where the package's coverage sees them.
 */
describe("the phase rule on clinical study phase wording, through the gate", () => {
  it("exits 0 over both display texts on a public page, and 1 over a near miss", () => {
    const clean = scratch(
      "irefs-hl7-0003",
      "# Scratch\n\nCRM - Correct/update phase information\n\n" +
        "MFN/MFK - Clinical study without phases but with schedules master file\n",
    );
    const cleanResult = runGate(baseConfig(clean));
    expect(cleanResult.err, cleanResult.err).toBe("");
    expect(cleanResult.code).toBe(0);

    const near = scratch("irefs-hl7-0003-near", "# Scratch\n\nCRM - Correct/update phase one\n");
    const nearResult = runGate(baseConfig(near));
    expect(nearResult.code).toBe(1);
    expect(nearResult.err).toContain("[phase or wave language]");
  });
});

/**
 * The slice rule's determiners, with the passages the narrowing lets through and the ones it must
 * still catch. The let-through passages are terminology's public documentation of its fixed-width
 * reader, where a field slice is a byte range the caller passes in; with `the` and `each` in the
 * determiner class every one of them was a hit.
 */
describe("the slice rule leaves `the` and `each` to the reader", () => {
  const { resolved } = resolveConfig({
    projectPrefixes: ["TERM"],
    standardsDesignations: [],
    surfacePaths: ["README.md"],
    accountedTarballFiles: [],
  });
  if (resolved === undefined) throw new Error("the base configuration did not resolve");
  const jargon = compileCanonicalRules(resolved).find((rule) => rule.id === "internal-jargon");
  if (jargon === undefined) throw new Error("the slice rule is missing from the canonical set");

  /** Every hit the slice rule reports in one passage, in order. */
  function hits(text: string): string[] {
    return jargon!.patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
  }

  it("lets a fixed-width field slice through after `the` and `each`", () => {
    expect(hits("The consumer supplies the field slices, so the engine is generic.")).toEqual([]);
    expect(hits("The reader takes the slices as a parameter.")).toEqual([]);
    expect(hits("A line too short to contain the code slice is skipped.")).toEqual([]);
    expect(hits("Empty when the slice is entirely past the line's end.")).toEqual([]);
    expect(hits("The slice holding the concept code. The field slice.")).toEqual([]);
    expect(hits("Each slice is a start column and an end column.")).toEqual([]);
  });

  it("still catches the determiners it kept, including after `the`", () => {
    expect(hits("This slice births the invariants.")).toEqual(["This slice"]);
    expect(hits("The next slice moves the parser.")).toEqual(["next slice"]);
    expect(hits("It lands in the final slice.")).toEqual(["final slice"]);
    expect(hits("That slice and another misfiling-prevention slice follow.")).toEqual([
      "That slice",
      "another misfiling-prevention slice",
    ]);
  });
});

/**
 * THE SOURCE STRING-LITERAL PASS. A string literal reaches a consumer as error and warning text
 * (cli once shipped an item id in a diagnostic), so it is public surface; a comment is not, and an
 * item id in a `//` note must stay allowed (synth's source carries roadmap citations in them).
 */
describe("the source string-literal pass", () => {
  const literalsOn = (repo: ScratchRepo) => ({
    ...baseConfig(repo),
    sourceStringLiterals: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
  });

  it("finds bookkeeping in a message a consumer reads, and only when the pass is enabled", () => {
    const repo = scratch("irefs-literal");
    repo.write(
      "src/index.ts",
      [
        "export function run(): never {",
        '  throw new Error("redact is unpublished (MLLP-7 in flight)");',
        "}",
        "",
      ].join("\n"),
    );
    repo.track("src/index.ts");

    const off = runGate(baseConfig(repo));
    expect(off.code, off.all).toBe(0);

    const on = runGate(literalsOn(repo));
    expect(on.code).toBe(1);
    expect(on.err).toContain("[internal project identifier / src string literal]");
    expect(on.err).toContain("src/index.ts:2");
  });

  it("reads single-quoted, template and escaped literals, and a phrase split across two", () => {
    const repo = scratch("irefs-literal-forms");
    repo.write(
      "src/index.ts",
      [
        "export const a = 'fixed by ADR 0018';",
        "export const b = `parser unavailable;",
        "  vendored per ADR 0025 ${'x'} today`;",
        'export const c = "Added in Phase\\u00205b";',
        'export const d = "the final " + "slice of the codec";',
        "",
      ].join("\n"),
    );
    repo.track("src/index.ts");

    const result = runGate(literalsOn(repo));
    expect(result.code).toBe(1);
    expect(result.err).toContain("src/index.ts:1");
    expect(result.err).toContain("src/index.ts:2");
    expect(result.err).toContain("src/index.ts:4");
    expect(result.err).toContain('[internal jargon ("slice") / src string literal] src/index.ts:5');
  });

  it("never reads a comment: line, trailing or block, so an item id there stays allowed", () => {
    const repo = scratch("irefs-literal-comments");
    repo.write(
      "src/index.ts",
      [
        "// Added in Phase G for MLLP-7, per the roadmap.",
        "/* ADR 0015 decided this, in a block comment. */",
        'export const ok = "framing complete"; // "MLLP-7" quoted in a trailing comment',
        'export const re = /"MLLP-7"/;',
        "",
      ].join("\n"),
    );
    repo.track("src/index.ts");

    const result = runGate(literalsOn(repo));
    expect(result.code, result.all).toBe(0);
    expect(result.out).toContain("1 source file(s) scanned for string-literal bookkeeping");
  });

  it("reads a NUL-bearing source file, the byte as a space, rather than refusing it", () => {
    // deid's HMAC separator and dicom's charset table are raw NUL bytes inside literals. A space
    // keeps the word boundary, so an identifier beside the byte is still seen.
    const repo = scratch("irefs-literal-nul");
    repo.write(
      "src/index.ts",
      ['export const key = "a\0b";', 'export const bad = "x\0MLLP-7 shipped this";', ""].join("\n"),
    );
    repo.track("src/index.ts");

    const result = runGate(literalsOn(repo));
    expect(result.code, result.all).toBe(1);
    expect(result.err).toContain("src/index.ts:2");

    const docs = runGate({
      ...baseConfig(repo),
      sourceDocComments: { enabled: true, paths: ["src/*.ts"] },
    });
    expect(docs.err).not.toContain("holds a NUL byte");
  });

  it("refuses an extraction that found no literal at all", () => {
    const repo = scratch("irefs-literal-empty");
    repo.write("src/index.ts", "export const x = 1;\n");
    repo.track("src/index.ts");
    const result = runGate(literalsOn(repo));
    expect(result.code).toBe(1);
    expect(result.err).toContain("extracted no string literals");
  });
});

/**
 * The rules taken from dicom's own gate, where they generalize to every repository. Measured on the
 * pinned libraries before they joined the canonical set: they add 12 hits (6 citations of a
 * planning file and one "subsequent phases" in hl7's source, five citations of the roadmap in x12
 * and ncpdp) and remove none. Each arm has a passage it must catch and one it must let through.
 */
describe("the rules taken from dicom's gate", () => {
  const { resolved } = resolveConfig({
    projectPrefixes: ["DICOM"],
    standardsDesignations: [],
    surfacePaths: ["README.md"],
    accountedTarballFiles: [],
  });
  if (resolved === undefined) throw new Error("the base configuration did not resolve");
  const rules = compileCanonicalRules(resolved);

  /** The ids of the rules that fire on a passage. */
  function fired(text: string): string[] {
    return rules
      .filter((rule) =>
        rule.patterns.some((pattern) => {
          pattern.lastIndex = 0;
          return pattern.test(text);
        }),
      )
      .map((rule) => rule.id);
  }

  it("an umbrella spec id, and not a HCPCS code", () => {
    expect(fired("Tracked as S0228-github-profile-ci-drift.")).toEqual(["internal-identifier"]);
    expect(fired("HCPCS S9083 is a billing code.")).toEqual([]);
  });

  it("the adjective forms of phase and wave, and not their clinical senses", () => {
    expect(fired("The helpers are populated in subsequent phases.")).toEqual(["phase-or-wave"]);
    expect(fired("It arrives in a later wave, after waves 2 and 3.")).toEqual(["phase-or-wave"]);
    expect(fired("A later phase of the disease and the next wave of infections.")).toEqual([]);
  });

  it("a citation of the roadmap, and not the word road", () => {
    expect(fired("Obsolete codes are tracked by the roadmap.")).toEqual(["phase-or-wave"]);
    expect(fired("The road map of the segment grammar.")).toEqual([]);
  });

  it("the plural, # and two-digit forms of an ADR number", () => {
    expect(fired("Superseded by ADRs 0015 and ADR #0018.")).toEqual(["adr-reference"]);
    expect(fired("Decided in ADR 23.")).toEqual(["adr-reference"]);
    expect(fired("ADR here is an adverse drug reaction, and 0015 is a value.")).toEqual([]);
  });

  it("process commentary, and not a specification, a session or a port", () => {
    expect(fired("Landed by a later PR.")).toEqual(["internal-jargon"]);
    expect(fired("This is out of scope for this change.")).toEqual(["internal-jargon"]);
    expect(fired("This specification, this session and this port are the reader's.")).toEqual([]);
  });

  it("a planning file, the umbrella as a place, and its work and card directories", () => {
    expect(fired("Locked by CONTEXT.md.")).toEqual(["internal-repo-path"]);
    expect(fired("Per the meta-repo's work/specs/ entry and cards/hl7.md.")).toEqual([
      "internal-repo-path",
    ]);
    expect(fired("Recorded in decisions/0015-scope.md.")).toEqual(["internal-repo-path"]);
    expect(fired("The context and the requirements are in docs-content.")).toEqual([]);
  });

  it("an image slice in its volume is DICOM's word, and our next slice is not", () => {
    expect(fired("Slice Location describes the next slice in the volume.")).toEqual([]);
    expect(fired("The next slice moves the parser.")).toEqual(["internal-jargon"]);
  });
});

describe("a missing, empty or unusable axis is refused, naming the axis", () => {
  const required = CONFIG_AXES.filter((axis) => axis.required).map((axis) => axis.name);

  it("has a required set worth grading", () => {
    // A control on the enumeration itself. If the required set ever empties, every case below would
    // pass over nothing, and the suite would go green having asserted less than it claims.
    expect(required.length).toBeGreaterThan(0);
  });

  it.each(required)("refuses a configuration that omits `%s`", (axis) => {
    const repo = scratch("irefs-axes");
    const config = baseConfig(repo);
    delete config[axis];

    const result = runGate(config);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain(`\`${axis}\``);
    expect(result.err).toContain("required");
    // A refused configuration means NO SCAN RAN, so nothing may have been reported about the tree.
    expect(result.out).toBe("");
    expect(result.err).not.toContain("OK");
  });

  const emptyRefusing = CONFIG_AXES.filter((axis) => axis.refusesEmpty).map((axis) => axis.name);

  it.each(emptyRefusing)("refuses an empty `%s`", (axis) => {
    const repo = scratch("irefs-axes");
    const result = runGate({ ...baseConfig(repo), [axis]: [] });

    expect(result.code).not.toBe(0);
    expect(result.err).toContain(`\`${axis}\``);
    expect(result.out).toBe("");
  });

  it("refuses a surface path the repository does not track", () => {
    const repo = scratch("irefs-untracked");
    repo.write("docs-content/page.md", "# Page\n");
    // Written and never committed, so git does not know about it.

    const result = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("docs-content");
    expect(result.err).toContain("not tracked");
    expect(result.out).toBe("");
  });

  it("refuses a prefix that is not an uppercase token, rather than escaping it into something else", () => {
    const repo = scratch("irefs-bad-prefix");
    const result = runGate({ ...baseConfig(repo), projectPrefixes: ["HL7", "a|b"] });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("projectPrefixes");
    expect(result.err).toContain('"a|b"');
  });

  it("refuses a standards designation that does not compile", () => {
    const repo = scratch("irefs-bad-designation");
    const result = runGate({ ...baseConfig(repo), standardsDesignations: ["HL7-(?:V2"] });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("standardsDesignations");
  });

  it("refuses when it is not inside a git repository at all", () => {
    const repo = scratch("irefs-nogit");
    rmSync(join(repo.root, ".git"), { recursive: true, force: true });
    const result = runGate(baseConfig(repo));
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("not inside a git repository");
  });
});

describe("a configuration that subtracts a rule or a refusal is refused, not honoured", () => {
  it.each([...REFUSED_OPTIONS.keys()])("refuses the option `%s` by name", (option) => {
    const repo = scratch("irefs-refused");
    const result = runGate({ ...baseConfig(repo), [option]: true });

    expect(result.code).not.toBe(0);
    expect(result.err).toContain(`\`${option}\``);
    expect(result.err).toContain("refused");
    expect(result.out).toBe("");
  });

  it("refuses an option it has never heard of, rather than ignoring it", () => {
    // AN IGNORED OPTION READS EXACTLY LIKE AN HONOURED ONE. They wrote `skipEverything: true`, the
    // run went green, and nothing said the setting did nothing.
    const repo = scratch("irefs-unknown");
    const result = runGate({ ...baseConfig(repo), skipEverything: true });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("`skipEverything`");
    expect(result.err).toContain("not one this gate accepts");
  });

  it("refuses an exit-code mapping that would report a finding as a clean run", () => {
    const repo = scratch("irefs-exitcodes", "# Scratch\n\nItem HL7-N7 landed here.\n");

    const hitsOnZero = runGate({
      ...baseConfig(repo),
      exitCodes: { clean: 0, hits: 0, refuse: 1 },
    });
    expect(hitsOnZero.code).not.toBe(0);
    expect(hitsOnZero.err).toContain("`exitCodes.hits`");

    const refuseOnZero = runGate({
      ...baseConfig(repo),
      exitCodes: { clean: 0, hits: 1, refuse: 0 },
    });
    expect(refuseOnZero.code).not.toBe(0);
    expect(refuseOnZero.err).toContain("`exitCodes.refuse`");

    const cleanNonZero = runGate({
      ...baseConfig(repo),
      exitCodes: { clean: 2, hits: 1, refuse: 1 },
    });
    expect(cleanNonZero.code).not.toBe(0);
    expect(cleanNonZero.err).toContain("`exitCodes.clean`");

    // The mapping a caller MAY set: a distinct refusal code. It still reds on the seeded hit.
    const legitimate = runGate({
      ...baseConfig(repo),
      exitCodes: { clean: 0, hits: 3, refuse: 4 },
    });
    expect(legitimate.code).toBe(3);
  });

  it("refuses an added rule that carries no negative sample", () => {
    const repo = scratch("irefs-extra-rule");
    const noNegative = runGate({
      ...baseConfig(repo),
      extraRules: [
        { id: "local", name: "local rule", pattern: "WIDGET-\\d+", positives: ["WIDGET-1"] },
      ],
    });
    expect(noNegative.code).not.toBe(0);
    expect(noNegative.err).toContain("no negative sample");

    // A well-formed added rule is accepted and runs: a caller may ADD detection.
    const added = scratch("irefs-extra-ok", "# Scratch\n\nSee WIDGET-4 for the shape.\n");
    const result = runGate({
      ...baseConfig(added),
      extraRules: [
        {
          id: "local",
          name: "local widget identifier",
          pattern: "WIDGET-\\d+",
          positives: ["WIDGET-1"],
          negatives: ["a widget on its own"],
        },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("[local widget identifier]");
  });

  it("refuses an added rule that reuses a canonical id", () => {
    const repo = scratch("irefs-shadow");
    const result = runGate({
      ...baseConfig(repo),
      extraRules: [
        {
          id: "internal-identifier",
          name: "mine",
          pattern: "NOTHING",
          positives: ["NOTHING"],
          negatives: ["something"],
        },
      ],
    });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("may add detection and may not replace a canonical rule");
  });
});

describe("the self-test floor runs before anything is reported, and cannot be turned off", () => {
  it("refuses when a rule stops matching its own positive sample", () => {
    // The floor's positive half, reached through the one input a caller controls: a prefix that is
    // shadowed by a standards designation contributes nothing, and the identifier rule would keep
    // reporting green over the identifiers it was added to catch.
    const repo = scratch("irefs-selftest-positive");
    const result = runGate({
      ...baseConfig(repo),
      projectPrefixes: ["HL7", "WIDGET"],
      standardsDesignations: [String.raw`WIDGET-[A-Z0-9]+`],
    });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("SELF-TEST FAILED");
    expect(result.err).toContain("no longer matches its own positive sample");
    expect(result.err).toContain("WIDGET-N7");
  });

  it("refuses when a rule starts matching legitimate reference material", () => {
    // The WORD-N trap turned into an assertion. `MSH` as a project prefix makes `MSH-2` a
    // violation, which would delete segment-field references from a parser's documentation.
    const repo = scratch("irefs-selftest-negative");
    const result = runGate({ ...baseConfig(repo), projectPrefixes: ["HL7", "MSH"] });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("SELF-TEST FAILED");
    expect(result.err).toContain("MSH-2");
    expect(result.err).toContain("WORD-N trap");
  });

  it("refuses when a caller's own sample proves a rule is wrong for its repository", () => {
    const repo = scratch("irefs-selftest-extra");
    const result = runGate({
      ...baseConfig(repo),
      extraSamples: { "adr-reference": { negatives: ["Decided in ADR 0015"] } },
    });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("SELF-TEST FAILED");
    expect(result.err).toContain("ADR reference");
  });
});

describe("a target enumerated and never read is a refusal, never a clean run", () => {
  it("refuses a target that disappears between enumeration and reading", () => {
    const repo = scratch("irefs-vanished");
    repo.write("docs-content/page.md", "# Page\n\nOrdinary prose.\n");
    repo.track("docs-content/page.md");

    const before = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(before.code, before.all).toBe(0);

    // Tracked, so git still enumerates it; gone from the working tree, so nothing can read it.
    rmSync(join(repo.root, "docs-content", "page.md"));
    const after = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(after.code).not.toBe(0);
    expect(after.err).toContain("docs-content/page.md");
    expect(after.err).toContain("Refusing to report green from an incomplete scan");
    expect(after.out).toBe("");
  });

  it("refuses an input a text matcher classifies as binary, rather than skipping it", () => {
    // Skipping it is the silent-green shape: a genuine text file with a broken encoding, or a file
    // whose violation sits beside a NUL byte, would be passed over without a word.
    const repo = scratch("irefs-binary");
    // The NUL is written as an escape rather than as a literal: a source file carrying a raw
    // NUL is itself binary to every tool that reads this repository, this gate included.
    repo.write("docs-content/page.md", Buffer.from("Item HL7-N7 \u0000 landed", "utf8"));
    repo.track("docs-content/page.md");

    const result = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("docs-content/page.md");
    expect(result.err).toContain("binary");
    expect(result.out).toBe("");
  });

  it("refuses a tracked entry that is not a regular file", () => {
    const repo = scratch("irefs-symlink");
    repo.write("docs-content/page.md", "# Page\n");
    symlinkSync("..", join(repo.root, "docs-content", "loop"));
    repo.track("docs-content");

    const result = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("docs-content/loop");
    expect(result.err).toContain("not a regular file");
  });

  it("refuses a target replaced by a directory after enumeration, rather than counting it as a submodule", () => {
    // THE DEFECT THIS PINS, and it is why the read path asks the INDEX what an entry is and the
    // DESCRIPTOR what it holds, never the path twice. A guard that stats the working tree sees a
    // directory here, and a directory at a tracked path is what a submodule looks like. So the
    // entry is skipped as a gitlink, the skip is accounted for against the enumeration, every
    // target is "accounted for", and the run reports a clean tree having never opened the file.
    // That is a silent green produced by a race, on the one seam this gate exists to close.
    const repo = scratch("irefs-swapped");
    repo.write("docs-content/page.md", "# Page\n\nOrdinary prose.\n");
    repo.track("docs-content/page.md");

    const before = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(before.code, before.all).toBe(0);
    expect(before.out).toContain("0 gitlink(s) skipped");

    rmSync(join(repo.root, "docs-content", "page.md"));
    mkdirSync(join(repo.root, "docs-content", "page.md"));

    const after = runGate({ ...baseConfig(repo), surfacePaths: ["README.md", "docs-content"] });
    expect(after.code, after.all).not.toBe(0);
    expect(after.err).toContain("docs-content/page.md");
    expect(after.err).toContain("not a regular file");
    expect(after.out).toBe("");
    // And it is NOT reported as a skipped submodule, which is the wrong branch taken quietly.
    // `skips a gitlink and says how many it skipped` is the other side of this boundary: a REAL
    // submodule is still passed over, so this case cannot be satisfied by refusing everything.
    expect(after.all).not.toContain("1 gitlink(s) skipped");
  });

  it("decides what an entry is from the mode git recorded, and refuses a mode it does not know", () => {
    // THE ONE BRANCH OF THE READ PATH THE REAL ENUMERATOR CANNOT PRODUCE. Git emits four modes, so
    // no scratch repository can hand the loop a fifth, and a branch no case can reach is a branch
    // no evidence covers. It is graded here directly instead of left as a defensive line that
    // cannot fail.
    expect(classifyTrackedMode("160000")).toBe("skip");
    for (const mode of ["100644", "100755", "120000"]) {
      expect(classifyTrackedMode(mode), `${mode} should be read`).toBe("read");
    }
    // A tree, a zeroed entry and a truncated record are each something the scan cannot account
    // for, and fail-closed means refusing them by name rather than reading the path anyway.
    for (const mode of ["040000", "000000", "12000", "", "100644 "]) {
      expect(classifyTrackedMode(mode), `${JSON.stringify(mode)} should be refused`).toBe("refuse");
    }
  });

  it("refuses a surface that enumerated nothing at all", () => {
    const repo = scratch("irefs-empty-surface");
    repo.write("docs-content/.keep", "");
    // `docs-content` is tracked through `.keep`, and then the pathspec is narrowed to a subtree
    // that holds nothing, which is the shape a rename produces.
    repo.track("docs-content/.keep");
    const result = runGate({ ...baseConfig(repo), surfacePaths: ["docs-content/pages"] });
    expect(result.code).not.toBe(0);
    expect(result.out).toBe("");
  });
});

describe("the tarball drift tripwire", () => {
  it("refuses a `files` entry that neither the surface nor the accounting covers", () => {
    const repo = scratch("irefs-tarball");
    repo.write("package.json", cleanManifest(["README.md", "dist", "CHANGELOG.md"]));
    repo.track("package.json");

    const result = runGate(baseConfig(repo));
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("dist");
    expect(result.err).toContain("CHANGELOG.md");
    expect(result.err).toContain("accountedTarballFiles");
    expect(result.out).toBe("");

    // Accounting for them is the DECLARATION the axis exists for, and it clears the tripwire.
    const declared = runGate({
      ...baseConfig(repo),
      accountedTarballFiles: ["dist", "CHANGELOG.md"],
    });
    expect(declared.code, declared.all).toBe(0);
  });

  it("checks every entry, not just the prose-looking ones", () => {
    // An earlier hand-written copy filtered `files` down to markdown first, which discarded the
    // build directory before checking and so structurally could not see the tarball's largest
    // prose payload: the compiled doc comments.
    const repo = scratch("irefs-tarball-nonprose");
    repo.write("package.json", cleanManifest(["README.md", "dist"]));
    repo.track("package.json");

    const result = runGate(baseConfig(repo));
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("dist");
  });
});

describe("no documented configuration value makes a run that found something exit 0", () => {
  /**
   * THE HOSTILE VALUES, one entry per documented axis.
   *
   * The enumeration is `CONFIG_AXES`, the implementation's own documented interface, so an axis
   * added later without a case here reds the control below rather than sliding past ungraded. The
   * universal is bound to that surface: this is not a claim about every conceivable flag, it is a
   * claim about every axis the implementation exposes, and it is checked over all of them.
   */
  const HOSTILE: Record<string, unknown[]> = {
    projectPrefixes: [MISSING, [], ["ZZZ"], ["HL7"]],
    standardsDesignations: [MISSING, [], [String.raw`HL7-[A-Z0-9]+`], [String.raw`[\s\S]*`]],
    surfacePaths: [MISSING, [], ["LICENSE"], ["README.md", "LICENSE"]],
    accountedTarballFiles: [MISSING, ["README.md"], ["dist", "CHANGELOG.md", "everything"]],
    sourceDocComments: [
      MISSING,
      { enabled: false },
      { enabled: true, paths: [] },
      { enabled: true, paths: ["src/*.ts"] },
    ],
    sourceStringLiterals: [
      MISSING,
      { enabled: false },
      { enabled: true, paths: [] },
      { enabled: true, paths: ["src/*.ts"] },
    ],
    exitCodes: [
      { clean: 0, hits: 0, refuse: 0 },
      { clean: 0, hits: 0, refuse: 1 },
      { clean: 7, hits: 0, refuse: 0 },
      { clean: 0, hits: 9, refuse: 9 },
    ],
    extraRules: [MISSING, [], [{ id: "x", name: "x" }]],
    extraSamples: [MISSING, {}, { "adr-reference": { negatives: ["Decided in ADR 0015."] } }],
    // `repoRoot` NAMES THE REPOSITORY UNDER TEST, so pointing it at a different one is not a
    // setting that hides a finding here; it is a run against something else. What is graded is
    // that no value of it can make THIS repository's finding disappear: a subdirectory is widened
    // back to the top level, and a path that is not a repository is refused.
    repoRoot: ["/", "does-not-exist"],
    write: [
      { out: () => {}, err: () => {} },
      // A writer that throws if the CLEAN line is ever printed. The verdict is a return value, so
      // redirecting or discarding the report cannot change it.
      {
        out: () => {
          throw new Error("a clean line was printed for a run that found something");
        },
        err: () => {},
      },
    ],
  };

  it("has a hostile value for every documented axis", () => {
    // The control that keeps the enumeration honest. An axis with no case here would be a hole in
    // the universal, and it would be invisible: the loop below would simply iterate one case fewer.
    expect(Object.keys(HOSTILE).sort()).toEqual(CONFIG_AXES.map((axis) => axis.name).sort());
  });

  /**
   * The seeded violation trips a rule NO AXIS PARAMETERISES, and it sits on four targets.
   *
   * An identifier would have been the wrong seed: the prefix set is a caller's own declaration of
   * what its identifiers look like, so narrowing it changes what a violation IS rather than hiding
   * one. An ADR number is a violation under every accepted configuration. It is written into the
   * README, the npm description, the LICENSE and a source doc comment, so narrowing `surfacePaths`
   * (which a caller is entitled to do) still leaves a target carrying it: the npm metadata is read
   * by every run and no axis removes it.
   */
  function seeded(name = "irefs-ac4"): ScratchRepo {
    const violation = "Decided in ADR 0015.";
    const existing = REPOS.get(name);
    if (existing !== undefined) return existing;
    const repo = scratch(name, `# Scratch\n\n${violation}\n`);
    repo.write(
      "package.json",
      JSON.stringify({
        name: "scratch",
        version: "0.0.0",
        description: violation,
        keywords: ["scratch"],
        files: ["README.md"],
      }),
    );
    repo.write(
      "src/index.ts",
      ["/**", ` * ${violation}`, " */", "export const x = 1;", ""].join("\n"),
    );
    repo.write("LICENSE", `MIT. ${violation}\n`);
    repo.track("package.json", "src/index.ts", "LICENSE");
    return repo;
  }

  const cases = Object.entries(HOSTILE).flatMap(([axis, values]) =>
    values.map((value, index) => [axis, index, value] as const),
  );

  it.each(cases)("%s, hostile value %i, still exits non-zero", (axis, index, value) => {
    const repo = seeded();
    const config: Record<string, unknown> = { ...baseConfig(repo), accountedTarballFiles: [] };
    if (value === MISSING) delete config[axis];
    else if (axis === "repoRoot" && value === "does-not-exist")
      config[axis] = join(repo.root, value);
    else config[axis] = value;

    // `write` is the one axis whose value must reach the implementation rather than the harness,
    // so this case drives the entry point directly and supplies its own capture where it can.
    let reported = "";
    const capture = {
      out: (text: string) => {
        reported += text;
      },
      err: (text: string) => {
        reported += text;
      },
    };
    const code = runInternalRefsScan({
      ...config,
      write: axis === "write" ? (value as object) : capture,
    } as never);

    expect(code, `${axis}[${index}] exited 0:\n${reported}`).not.toBe(0);
    expect(reported, `${axis}[${index}] reported a clean run:\n${reported}`).not.toContain(
      "internal-refs: OK",
    );
  });

  it("reads no environment variable, so nothing in a CI job can change its answer", () => {
    // Asserted by RUNNING it, in a child process whose environment is stuffed with every shape of
    // kill switch, rather than by reading the source for `process.env`.
    const repo = seeded("irefs-ac4-env");
    const driver = join(repo.root, "drive.mjs");
    writeFileSync(
      driver,
      [
        `import { runInternalRefsScan } from ${JSON.stringify(
          join(import.meta.dirname, "..", "packages", "script-utils", "internal-refs.js"),
        )};`,
        `process.exit(runInternalRefsScan(${JSON.stringify({
          projectPrefixes: ["HL7", "CCDA", "MLLP"],
          standardsDesignations: [String.raw`HL7-(?:V2|V3|CDA|FHIR|OMG|\d{3,4}[A-Z]?)`],
          surfacePaths: ["README.md"],
          accountedTarballFiles: [],
          repoRoot: repo.root,
        })}));`,
        "",
      ].join("\n"),
    );

    const hostileEnv = {
      ...process.env,
      CI: "",
      FORCE: "1",
      SKIP_GATES: "1",
      INTERNAL_REFS_SKIP: "1",
      INTERNAL_REFS_DISABLE: "1",
      INTERNAL_REFS_FORCE_CLEAN: "1",
      NO_INTERNAL_REFS: "1",
      COSYTE_SKIP_INTERNAL_REFS: "1",
      NODE_ENV: "production",
    };

    let code = 0;
    try {
      execFileSync(process.execPath, [driver], { env: hostileEnv, stdio: "pipe" });
    } catch (error) {
      code = (error as { status?: number }).status ?? -1;
    }
    expect(code).not.toBe(0);
  });
});

describe("the entry point itself", () => {
  it("returns a code rather than exiting, so a caller decides what to do with it", () => {
    const repo = scratch("irefs-return");
    // Called with no capture at all: the default writers are the real streams, and the important
    // property is that the process is still alive to read the answer.
    const code = runInternalRefsScan({
      ...baseConfig(repo),
      write: { out: () => {}, err: () => {} },
    } as never);
    expect(typeof code).toBe("number");
    expect(code).toBe(0);
  });

  it("refuses a configuration that is not an object at all", () => {
    let err = "";
    const code = runInternalRefsScan({
      write: { out: () => {}, err: (t: string) => (err += t) },
    } as never);
    expect(code).not.toBe(0);
    expect(err).toContain("`projectPrefixes`");
  });
});
