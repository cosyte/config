/**
 * Grades the two agent-doc artifacts THIS repo ships against the shape requirement the checker
 * applies to a target repo.
 *
 * WHY THIS SUITE EXISTS. `drift-manifest.json` declares an agent-doc SHAPE (accepted filenames,
 * five required headings, a line ceiling) and `scripts/drift-check.js` grades the other repos
 * against it. Two things behind that requirement were ungraded until this file:
 *
 *   1. NOTHING WAS ADOPTABLE. A repo told it is missing `## Standing disciplines` had no
 *      content-free artifact to copy. The only shaped agent doc in this checkout is
 *      `scripts/parser-template/CLAUDE.md`, a parser-specific document; copying it would mirror
 *      CONTENT, which the operator decision of 2026-08-29 keeps forbidden (it overturned decision
 *      15 for SHAPE alone). `templates/agent-doc-shape.md` is the content-free counterpart, and
 *      the census below is what makes "content-free" a fact rather than an intention.
 *   2. THE SCAFFOLD THAT SEEDED THE SHAPE WAS ITSELF UNGRADED. The five headings and the 300-line
 *      ceiling were read off `scripts/parser-template/CLAUDE.md` by hand, and its own provenance
 *      note says the ceiling is DECLARED rather than measured. Rename a heading there, or let the
 *      file grow past the ceiling, and every repo generated from the scaffold is born shape-red -
 *      13 worklists away from the edit that caused it. Grading the scaffold here moves that
 *      failure into config's own CI.
 *
 * THE REQUIREMENT IS READ AT RUN TIME, NEVER COPIED. Every grading below is `gradeAgentDoc()`, the
 * function the checker itself calls, applied to the object at
 * `baselines.package.groups.agentDoc.requirements.agentDoc` in `drift-manifest.json`. A test that
 * wrote the headings into itself would keep passing after the manifest changed, which is the exact
 * shape of gate this repo has already paid for. The one place the landed VALUES are written down
 * is the pin at the bottom, whose job is the opposite: to fail when they move.
 *
 * SECURITY / PHI: no repository outside this checkout is read, and every synthetic document below
 * is written here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { gradeAgentDoc } from "../scripts/drift-check.js";
import {
  DEFAULT_MANIFEST,
  DEFAULT_SCHEMA,
  validateValue,
} from "../scripts/validate-drift-manifest.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");

/** The skeleton this item ships, and the scaffold every parser repo's agent doc descends from. */
const SKELETON = "templates/agent-doc-shape.md";
const SCAFFOLD = "scripts/parser-template/CLAUDE.md";

/**
 * THE ONE PLACEHOLDER MARKER, declared here and nowhere else.
 *
 * A line of the skeleton is legitimate only if it is a Markdown heading, blank, or carries this
 * marker. `{{...}}` is the vocabulary `scripts/scaffold-parser.mjs` already substitutes in
 * `scripts/parser-template`, and prettier leaves both it and a single-line HTML comment verbatim,
 * so the skeleton stays `format:check`-clean without being added to `.prettierignore`.
 */
const PLACEHOLDER_MARKER = "{{REPLACE}}";

/** The shape of the requirement, as `gradeAgentDoc()` and the schema both describe it. */
type AgentDocSpec = { files: string[]; requiredHeadings: string[]; maxLines: number };

/** Where the requirement lives, quoted in every failure so the reader is sent to the right file. */
const REQUIREMENT_PATH = "baselines.package.groups.agentDoc.requirements.agentDoc";

const MANIFEST = JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8")) as Record<string, any>;
const SCHEMA = JSON.parse(readFileSync(DEFAULT_SCHEMA, "utf8")) as Record<string, any>;

/**
 * Read a file that is about to be graded, or fail naming the path.
 *
 * A grader handed `""` for a file it could not open reports a doc that is missing every heading,
 * or - worse, if the caller skips on read failure - reports nothing at all. Both are a verdict
 * about a file nobody read. This throws instead, and every green below goes through it.
 */
function readGraded(relative: string): string {
  const path = join(REPO_ROOT, ...relative.split("/"));
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(
      `cannot read ${relative} (looked at ${path}): ${String(cause)}. Nothing was graded: an ` +
        `unreadable file is not a green one.`,
    );
  }
}

/**
 * Pull the `agentDoc` requirement out of a manifest, refusing an absent or schema-invalid one.
 *
 * The refusal is the point. A missing requirement must not degrade to "skip the grading" and must
 * not degrade to a default written into this file: either would report green over a shape nobody
 * declared. The validation is the SAME sub-schema `pnpm run drift:validate` applies, reached
 * through the same hand-rolled validator, so this cannot pass a requirement that gate would reject.
 */
function readAgentDocRequirement(manifest: unknown, schema: Record<string, any>): AgentDocSpec {
  const spec = (manifest as any)?.baselines?.package?.groups?.agentDoc?.requirements?.agentDoc;
  if (spec === undefined) {
    throw new Error(
      `${REQUIREMENT_PATH} is missing from the manifest. Refusing to grade an agent doc against a ` +
        `default: the manifest is the standard, and a shape it does not declare is not a shape.`,
    );
  }
  const subSchema = schema.$defs?.requirements?.properties?.agentDoc;
  if (subSchema === undefined) {
    throw new Error(
      `drift-manifest.schema.json has no $defs.requirements.properties.agentDoc, so ` +
        `${REQUIREMENT_PATH} cannot be validated. Refusing to grade against an unchecked shape.`,
    );
  }
  const errors: string[] = [];
  validateValue(spec, subSchema, REQUIREMENT_PATH, schema, errors);
  if (errors.length > 0) {
    throw new Error(
      `${REQUIREMENT_PATH} does not validate against drift-manifest.schema.json:\n  - ` +
        `${errors.join("\n  - ")}\nNothing was graded.`,
    );
  }
  return spec as AgentDocSpec;
}

/**
 * The requirement every grading below uses, read once, at run time, from the shipped manifest.
 *
 * Reading it at module scope means a manifest that lost or broke the requirement fails THIS FILE
 * loudly with the message above, rather than letting the cases underneath quietly grade nothing.
 */
const REQUIREMENT = readAgentDocRequirement(MANIFEST, SCHEMA);

/** `gradeAgentDoc()` splits this way (`wc -l`: one trailing newline ends a line, it starts none). */
function linesOf(text: string): string[] {
  return text.replace(/\n$/, "").split("\n");
}

function isHeading(line: string): boolean {
  return /^#{1,6} /.test(line);
}

function isPlaceholder(line: string): boolean {
  return line.includes(PLACEHOLDER_MARKER);
}

/**
 * The census: every line that is neither a heading, nor blank, nor a placeholder, named.
 *
 * Anything this returns is a line of prose the skeleton would be teaching someone to copy, which
 * is precisely what the umbrella must not ship. The line is quoted along with its number because a
 * count alone does not tell the reader what to delete; the skeleton is content-free by
 * construction, so quoting it leaks nothing.
 */
function contentLines(text: string): string[] {
  return linesOf(text)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !isHeading(line) && line.trim() !== "" && !isPlaceholder(line))
    .map(({ line, number }) => `line ${number}: ${line}`);
}

/** Body lines: what is left once headings and blanks are removed, trimmed for comparison. */
function bodyLines(text: string): string[] {
  return linesOf(text)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !isHeading(line));
}

/** Form a candidate agent doc by replacing every placeholder line with a repo's own text. */
function adopt(text: string, body: (index: number) => string): string {
  let seen = 0;
  return linesOf(text)
    .map((line) => (isPlaceholder(line) ? body(seen++) : line))
    .join("\n");
}

// ---------------------------------------------------------------------------

describe("AC1: the skeleton exists and carries no content", () => {
  it("is readable, and is not empty", () => {
    expect(readGraded(SKELETON).length).toBeGreaterThan(0);
  });

  it("carries nothing but headings, blank lines and placeholder lines", () => {
    const offenders = contentLines(readGraded(SKELETON));
    expect(
      offenders,
      `${SKELETON} carries lines that are neither a heading, nor blank, nor marked ` +
        `${PLACEHOLDER_MARKER}. A skeleton the estate copies must state no repo's content:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("names the offending line when a document carries one, rather than counting it", () => {
    // The negative control for the census itself. Without it, a census that silently returned []
    // for every input would clear the skeleton by never looking at it.
    expect(contentLines("## Project\n\nthis line states a fact about some repo\n")).toEqual([
      "line 3: this line states a fact about some repo",
    ]);
  });

  it("writes every placeholder as a single-line HTML comment carrying the one marker", () => {
    // Stronger than the census, and deliberately so: `includes(marker)` would also accept
    // "we parse HL7 v2 {{REPLACE}}", which is prose wearing a marker. Every non-heading line of
    // the skeleton has to be a comment, so the RENDERED skeleton is headings and nothing else.
    const shape = /^<!-- \{\{REPLACE\}\}(: [^<>]*)? -->$/;
    const wrong = linesOf(readGraded(SKELETON))
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.trim() !== "" && !isHeading(line) && !shape.test(line))
      .map(({ line, number }) => `line ${number}: ${line}`);
    expect(wrong, `every placeholder must read <!-- ${PLACEHOLDER_MARKER}: ... -->`).toEqual([]);
  });

  it("shares no body line with the scaffold, so it mirrors no repo's content", () => {
    const scaffold = new Set(bodyLines(readGraded(SCAFFOLD)));
    const shared = bodyLines(readGraded(SKELETON)).filter((line) => scaffold.has(line));
    expect(
      shared,
      `${SKELETON} repeats ${shared.length} body line(s) of ${SCAFFOLD}. The shape may be shared; ` +
        `the content may not.`,
    ).toEqual([]);
  });
});

describe("AC2: the skeleton and the scaffold are graded by the checker's own evaluator", () => {
  it("uses the requirement object out of the manifest, not a copy written into this test", () => {
    // Identity, not equality: `toBe` fails the moment someone replaces the run-time read with a
    // literal, which is the failure mode this whole suite is built to avoid.
    expect(REQUIREMENT).toBe(MANIFEST["baselines"].package.groups.agentDoc.requirements.agentDoc);
  });

  it("grades the skeleton with zero violations", () => {
    expect(gradeAgentDoc(readGraded(SKELETON), REQUIREMENT, SKELETON)).toEqual([]);
  });

  it("grades the scaffold every parser repo is born from with zero violations", () => {
    // The guard that moves a scaffold heading rename from "13 repos are born red" to "config's
    // own CI is red on the commit that renamed it".
    expect(gradeAgentDoc(readGraded(SCAFFOLD), REQUIREMENT, SCAFFOLD)).toEqual([]);
  });

  it("reports exactly one named violation for a heading the skeleton does not carry", () => {
    // The negative control proving the greens above are graded rather than assumed. The synthetic
    // requirement is a widened copy, so the shipped one is untouched.
    const absent = "## A Section Nobody Declared";
    const widened: AgentDocSpec = {
      ...REQUIREMENT,
      requiredHeadings: [...REQUIREMENT.requiredHeadings, absent],
    };
    const violations = gradeAgentDoc(readGraded(SKELETON), widened, SKELETON);
    expect(violations).toEqual([`${SKELETON}: missing the required section heading "${absent}"`]);
  });

  it("reds the skeleton when the ceiling is below its length, naming only the count", () => {
    // The other half of the requirement is the budget, so it gets its own control: a ceiling of 1
    // must red, and the line it emits must be a count rather than anything from the document.
    const tight: AgentDocSpec = { ...REQUIREMENT, maxLines: 1 };
    const violations = gradeAgentDoc(readGraded(SKELETON), tight, SKELETON);
    expect(violations).toEqual([
      `${SKELETON}: ${linesOf(readGraded(SKELETON)).length} lines, over the declared ceiling of 1`,
    ]);
  });
});

describe("AC3: an absent or invalid requirement fails the run, naming it", () => {
  /** A deep copy of the shipped manifest, so a mutation cannot reach the object under grading. */
  function draft(): Record<string, any> {
    return JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8")) as Record<string, any>;
  }

  it("refuses a manifest whose package baseline declares no agentDoc group", () => {
    const manifest = draft();
    delete manifest["baselines"].package.groups.agentDoc;
    expect(() => readAgentDocRequirement(manifest, SCHEMA)).toThrow(
      /baselines\.package\.groups\.agentDoc\.requirements\.agentDoc is missing/,
    );
  });

  it("refuses a group that exists but declares no agentDoc requirement", () => {
    const manifest = draft();
    manifest["baselines"].package.groups.agentDoc.requirements = {};
    expect(() => readAgentDocRequirement(manifest, SCHEMA)).toThrow(/is missing from the manifest/);
  });

  it("says it is refusing rather than falling back to a default shape", () => {
    const manifest = draft();
    delete manifest["baselines"].package.groups.agentDoc;
    expect(() => readAgentDocRequirement(manifest, SCHEMA)).toThrow(/Refusing to grade/);
  });

  it.each([
    ["maxLines", (spec: any) => (spec.maxLines = 0), /maxLines: want at least 1/],
    [
      "requiredHeadings",
      (spec: any) => (spec.requiredHeadings = ["Project"]),
      /requiredHeadings\[0\]: "Project" does not match/,
    ],
    ["files", (spec: any) => (spec.files = []), /files: want at least 1 item/],
    ["an undeclared key", (spec: any) => (spec.minLines = 10), /minLines: unexpected property/],
  ])("refuses a requirement whose %s does not validate, naming the key", (_name, break_, shape) => {
    const manifest = draft();
    break_(manifest["baselines"].package.groups.agentDoc.requirements.agentDoc);
    expect(() => readAgentDocRequirement(manifest, SCHEMA)).toThrow(shape);
    expect(() => readAgentDocRequirement(manifest, SCHEMA)).toThrow(/Nothing was graded/);
  });

  it("accepts the requirement the repo actually ships, so the refusals above are not vacuous", () => {
    expect(() => readAgentDocRequirement(draft(), SCHEMA)).not.toThrow();
  });
});

describe("AC4: a file that cannot be read fails the run, naming the path", () => {
  it("refuses a path that does not exist rather than grading an empty string", () => {
    const absent = "templates/no-such-agent-doc.md";
    expect(() => readGraded(absent)).toThrow(new RegExp(`cannot read ${absent}`));
    expect(() => readGraded(absent)).toThrow(/Nothing was graded/);
  });

  it("refuses a path that exists but cannot be read as a file", () => {
    // A directory is readable as an entry and not as a document. Skipping on this would report a
    // repo green for a doc that was never opened.
    expect(() => readGraded("templates")).toThrow(/cannot read templates/);
  });

  it("would have graded an unreadable file as missing every heading, which is why it refuses", () => {
    // States the alternative outcome plainly: this is what `gradeAgentDoc("")` says, and it is a
    // verdict about a file nobody read.
    expect(gradeAgentDoc("", REQUIREMENT, SKELETON).length).toBe(
      REQUIREMENT.requiredHeadings.length,
    );
  });
});

describe("AC5: the shape is adoptable without adopting anyone's content", () => {
  it("grades a candidate whose every placeholder is replaced with the repo's own text", () => {
    const candidate = adopt(readGraded(SKELETON), (i) => `Line ${i} of a repo's own prose.`);
    expect(candidate).not.toContain(PLACEHOLDER_MARKER);
    expect(linesOf(candidate).length).toBeLessThanOrEqual(REQUIREMENT.maxLines);
    expect(gradeAgentDoc(candidate, REQUIREMENT, "CLAUDE.md")).toEqual([]);
  });

  it("grades a candidate that qualifies the declared headings, since the match is a prefix", () => {
    const qualified = linesOf(readGraded(SKELETON))
      .map((line) =>
        isHeading(line) && line.startsWith("## ") ? `${line} (this repo's own)` : line,
      )
      .join("\n");
    expect(
      gradeAgentDoc(
        adopt(qualified, () => "body"),
        REQUIREMENT,
        "AGENTS.md",
      ),
    ).toEqual([]);
  });

  it("returns the same verdict for two candidates whose bodies differ completely", () => {
    const a = adopt(readGraded(SKELETON), () => "alpha alpha alpha");
    const b = adopt(readGraded(SKELETON), () => "SHAPE-CANARY-7714 and nothing like alpha");
    expect(gradeAgentDoc(a, REQUIREMENT, "CLAUDE.md")).toEqual(
      gradeAgentDoc(b, REQUIREMENT, "CLAUDE.md"),
    );
    expect(JSON.stringify(gradeAgentDoc(b, REQUIREMENT, "CLAUDE.md"))).not.toContain("CANARY");
  });

  it("returns the same verdict for two failing candidates whose bodies differ completely", () => {
    // Equality on two greens is satisfiable by returning [] for everything. The pair below reds,
    // so the identical verdicts are identical VIOLATIONS, and neither quotes a body line.
    const stripped = linesOf(readGraded(SKELETON))
      .filter((line) => !line.startsWith("## Standing disciplines"))
      .join("\n");
    const a = adopt(stripped, () => "alpha alpha alpha");
    const b = adopt(stripped, () => "SHAPE-CANARY-7714 and nothing like alpha");
    const verdict = gradeAgentDoc(a, REQUIREMENT, "CLAUDE.md");
    expect(verdict).toEqual([
      'CLAUDE.md: missing the required section heading "## Standing disciplines"',
    ]);
    expect(gradeAgentDoc(b, REQUIREMENT, "CLAUDE.md")).toEqual(verdict);
  });
});

describe("AC6: no requirement widens", () => {
  it("pins the agentDoc requirement to exactly the values S0226 landed", () => {
    // The one place the values are written down. Editing the manifest is allowed; editing it
    // WITHOUT noticing that 13 repos are graded against the result is not, and this line is the
    // notice. Widening the shape is a new operator decision, not a manifest tweak.
    expect(REQUIREMENT.files).toEqual(["CLAUDE.md", "AGENTS.md"]);
    expect(REQUIREMENT.requiredHeadings).toEqual([
      "## Project",
      "## Status",
      "## Tech Stack",
      "## Engineering Guardrails",
      "## Standing disciplines",
    ]);
    expect(REQUIREMENT.maxLines).toBe(300);
  });

  it("keeps every group of baselines.light free of an agent-doc requirement", () => {
    // The light baseline's own `ceiling` says no agent-doc requirement belongs there and that
    // nothing may be added without a new operator decision. Reaching the 11 light repos with the
    // shape is that decision's business, not this suite's.
    const light = MANIFEST["baselines"].light;
    const groups = Object.entries(light.groups) as [
      string,
      { requirements: Record<string, any> },
    ][];
    expect(groups.length).toBeGreaterThan(0);
    const offenders = groups
      .filter(([name, group]) => name === "agentDoc" || "agentDoc" in (group.requirements ?? {}))
      .map(([name]) => `baselines.light.groups.${name}`);
    expect(offenders, `${light.ceiling}`).toEqual([]);
    expect(JSON.stringify(light)).not.toContain("requiredHeadings");
  });
});
