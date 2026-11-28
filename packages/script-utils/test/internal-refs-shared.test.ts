/**
 * The shared id patterns and the default surface of the internal-reference gate.
 *
 * Two things moved into the engine so a repository no longer carries them in its own `extraRules`:
 * one pattern set for the id kinds a public repository must not carry (item, decision and standard
 * ids, tracking rows, plan and roadmap citations, decision numbers, private repository names and
 * paths, and session ids), and a surface every run reads whatever the caller configures (the
 * changesets, `CLAUDE.md`, `AGENTS.md`, the workflows, and every comment and string literal in the
 * source and test folders).
 *
 * Every id in this file is invented for the test. The negatives are the reference material the
 * patterns must leave alone: HL7, X12 and NCPDP field names, standards names, and code values.
 *
 * In the package, so the package's own coverage sees the engine run.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_SOURCE_ROOTS,
  DEFAULT_SURFACE_PATHS,
  canonicalRuleNames,
  compileCanonicalRules,
  extractComments,
  resolveConfig,
  ruleHits,
  runInternalRefsScan,
  runSelfTests,
} from "../internal-refs.js";

const { resolved } = resolveConfig({
  projectPrefixes: ["HL7", "X12", "NCPDP", "MLLP"],
  // The designations hl7's configuration declares for these prefixes.
  standardsDesignations: [
    String.raw`HL7-(?:V2|V3|CDA|FHIR|OMG|\d{3,4}[A-Z]?)`,
    String.raw`X12-\d{3}[A-Z]?`,
    String.raw`X12-\d{6}`,
  ],
  surfacePaths: ["README.md"],
  accountedTarballFiles: [],
});
if (resolved === undefined) throw new Error("the base configuration did not resolve");
const rules = compileCanonicalRules(resolved);

/** The compiled rule with this id. */
function rule(id: string) {
  const found = rules.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no canonical rule ${id}`);
  return found;
}

/** Every hit one rule reports in a passage, as the gate reads it. */
function hits(id: string, text: string): string[] {
  return ruleHits(rule(id), text);
}

const NEW_RULES = [
  "work-item-id",
  "tracking-row-id",
  "plan-citation",
  "decision-number",
  "private-repo",
  "session-id",
];

describe("the shared id patterns", () => {
  it("are canonical, so no caller can leave one out", () => {
    const ids = rules.map((candidate) => candidate.id);
    for (const id of NEW_RULES) expect(ids).toContain(id);
    expect(canonicalRuleNames()).toHaveLength(12);
    expect(runSelfTests(rules)).toEqual([]);
  });

  it("catch item, decision and standard ids in the forms they are written in", () => {
    expect(hits("work-item-id", "Kept by the title rule (ST91) and OW9071, see KD97")).toEqual([
      "ST91",
      "OW9071",
      "KD97",
    ]);
    expect(hits("work-item-id", "Every changeset is a patch (D977, 2026-01-02)")).toEqual(["D977"]);
    expect(hits("work-item-id", "Required here (#9012, D961), and in the bot file (EN93)")).toEqual(
      ["D961", "EN93"],
    );
    expect(hits("work-item-id", "As decision D904 and standard ST94 say")).toEqual([
      "ST94",
      "decision D904",
      "standard ST94",
    ]);
    expect(hits("work-item-id", "Locked by D-971 and D-972/D-973, with T-91-92-93")).toEqual([
      "D-971",
      "D-972",
      "D-973",
      "T-91-92-93",
    ]);
  });

  it("catch a tracking row id from any repository prefix, and an ORG row only when named a row", () => {
    expect(hits("tracking-row-id", "Row UMB-91, then CFG-92a, XFORM-93 and IHE-94")).toEqual([
      "UMB-91",
      "CFG-92a",
      "XFORM-93",
      "IHE-94",
    ]);
    expect(hits("tracking-row-id", "The gap row ORG-96 is open")).toEqual(["row ORG-96"]);
    expect(hits("tracking-row-id", "ORG-6 is the organization unit type")).toEqual([]);
  });

  it("catch plan numbers, roadmap sections and a repository's roadmap", () => {
    expect(hits("plan-citation", "Built by Plan 98-92, then Plans 93 to 94")).toEqual([
      "Plan 98-92",
      "Plans 93",
    ]);
    expect(hits("plan-citation", "Deferred to roadmap § 9, the dates roadmap and Wave-9")).toEqual([
      "roadmap §",
      "dates roadmap",
      "Wave-9",
    ]);
  });

  it("catch a decision number, and leave a repository's own four-digit record alone", () => {
    expect(hits("decision-number", "Under decision 941 and the conductor's decision 907")).toEqual([
      "decision 941",
      "conductor's decision 907",
    ]);
    expect(hits("decision-number", "Decision record 0008 and Decision 0002")).toEqual([]);
    expect(hits("decision-number", "The decision to retry, and decision 3 of the tree")).toEqual(
      [],
    );
  });

  it("catch a private repository by name, link, sibling path and planning path", () => {
    expect(hits("private-repo", "Read cosyte/marketing and github.com/cosyte/consulting")).toEqual([
      "cosyte/marketing",
      "cosyte/consulting",
    ]);
    expect(hits("private-repo", "From ../../iac/stacks and ../hq, in the assets repo")).toEqual([
      "../../iac",
      "../hq",
      "assets repo",
    ]);
    expect(
      hits("private-repo", "Our umbrella's plans/goals.md and conventions/classes/x.md"),
    ).toEqual(["Our umbrella's", "plans/goals.md", "conventions/classes/"]);
    expect(hits("private-repo", "The rule in conventions/README.md")).toEqual([
      "conventions/README.md",
    ]);
  });

  it("let through the address code calls, and the public names beside the private ones", () => {
    const passage =
      "repository: cosyte/docs; repo = 'cosyte/crew'; gh api repos/cosyte/website; --repo=cosyte/hq; " +
      "@cosyte/hl7, cosyte/config, cosyte/.github, cosyte/docs-content and docs.cosyte.com; " +
      "../docs/adr and ../assets/x.svg; the umbrella term and an umbrella trial";
    expect(hits("private-repo", passage)).toEqual([]);
  });

  it("catch a session id, a session path, and a session link", () => {
    expect(
      hits("session-id", "Written in session 11111111-2222-4333-8444-555555555555, so says it"),
    ).toEqual(["session 11111111-2222-4333-8444-555555555555"]);
    expect(
      hits(
        "session-id",
        "From session_0123456789abcdefABCD, ~/.claude/projects/p, /tmp/claude-7/a",
      ),
    ).toEqual(["session_0123456789abcdefABCD", ".claude/projects/", "/tmp/claude-7/"]);
    expect(hits("session-id", "See claude.ai/code/session_x")).toEqual(["claude.ai/code/session"]);
    expect(
      hits("session-id", "An MLLP session, message id 11111111-2222-4333-8444-555555555555"),
    ).toEqual([]);
  });
});

/**
 * THE FALSE POSITIVES THAT MATTER. A library's documentation is made of field names, standards
 * names and code values, and a pattern that flags one tells a remediator to rewrite reference
 * material. None of the shared rules, nor any other canonical rule, may report a hit here.
 */
describe("reference material passes every rule", () => {
  const passages = [
    // Formats and standards names.
    "ISO-8601 dates, UTF-8 text, HL7 v2 and HL7 v2.5.1, RFC-5322 addresses and CVE-2024-12345",
    "HL7-0396 and HL7-0003 tables, X12-837 and X12-005010, HL7-V2, DICOM-SR and FHIR-R4",
    // HL7 v2 fields and components, ORG among them.
    "PID-5 patient name, OBX-5 value, MSH-9 message type, NK1-4 address and CX-1 the id number",
    "ORG-1 set id, ORG-3 organization unit type, PV1-19 visit number, ZDS-1 and DG1-5",
    // X12 elements and qualifiers.
    "ST01 and ST02, ST*837*0001~, NM1-03, CLM-05, DTP*472*D8*20240101 with the D8 qualifier (D8)",
    // NCPDP fields, segments and versions.
    "Field 407-D7, segment AM07, version D.0 (D0), and the code values D30, D530 and D80",
    // Codes and code points.
    "Anemia (D64.9), the range D50-D89, U+D800 to U+DFFF, a D-dimer, vitamin D3, REF*6R*LINE-D-001~",
    // A fixture's message id is a value, quoted or alone.
    'header: { messageId: "SYNTH-1" }',
    "SYNTH-1",
  ];

  it.each(passages)("%s", (passage) => {
    const found = rules.flatMap((candidate) =>
      ruleHits(candidate, passage).map((hit) => `${candidate.id}: ${hit}`),
    );
    expect(found).toEqual([]);
  });

  it("still reports a row id that sits in a sentence, or quoted in backticks", () => {
    expect(hits("tracking-row-id", "Fixed in `SYNTH-1` and in SYNTH-2.")).toEqual([
      "SYNTH-1",
      "SYNTH-2",
    ]);
    expect(hits("tracking-row-id", `"SYNTH-1' is not quoted`)).toEqual(["SYNTH-1"]);
  });
});

describe("extractComments", () => {
  it("joins consecutive line comments into one paragraph, and breaks on a gap or a blank line", () => {
    const source = [
      "// It landed in wave",
      "/// 2 of the work.",
      "const x = 1; // trailing",
      "",
      "// apart",
      "//",
      "// after a blank",
    ].join("\n");
    const { lines, paragraphs } = extractComments(source, "src/a.ts");
    expect(lines.map((line) => line.where)).toEqual([
      "src/a.ts:1",
      "src/a.ts:2",
      "src/a.ts:3",
      "src/a.ts:5",
      "src/a.ts:6",
      "src/a.ts:7",
    ]);
    expect(paragraphs).toEqual([
      { text: "It landed in wave 2 of the work. trailing", where: "src/a.ts:1" },
      { text: "apart", where: "src/a.ts:5" },
      { text: "after a blank", where: "src/a.ts:7" },
    ]);
  });

  it("strips one leader asterisk from a block, and keeps or skips doc blocks as asked", () => {
    const source = [
      "/* A block",
      " * that wraps.",
      " *",
      " * **bold** stays. */",
      "/**",
      " * A doc block.",
      " */",
      "/**/",
    ].join("\n");
    const all = extractComments(source, "src/b.ts");
    expect(all.paragraphs.map((paragraph) => paragraph.text)).toEqual([
      "A block that wraps.",
      "**bold** stays.",
      "A doc block.",
    ]);
    expect(all.lines[1]).toEqual({ text: "that wraps.", where: "src/b.ts:2" });

    const skipped = extractComments(source, "src/b.ts", { skipDocComments: true });
    expect(skipped.paragraphs.map((paragraph) => paragraph.text)).toEqual([
      "A block that wraps.",
      "**bold** stays.",
    ]);
  });

  it("reads no comment inside a string or a regular expression", () => {
    const source = ['const a = "// not a comment";', "const b = /\\/* no */;", "// yes"].join("\n");
    expect(extractComments(source, "src/c.ts").paragraphs).toEqual([
      { text: "yes", where: "src/c.ts:3" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The default surface, run end to end over throwaway repositories
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];

afterAll(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repository with a clean manifest and README, plus these files, all tracked. */
function repoWith(files: Record<string, string>): {
  root: string;
  git: (...args: string[]) => string;
} {
  const root = mkdtempSync(join(tmpdir(), "irefs-shared-"));
  ROOTS.push(root);
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-q", ".");
  git("config", "user.email", "scratch@example.invalid");
  git("config", "user.name", "Scratch");
  git("config", "commit.gpgsign", "false");
  const all: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "scratch",
      version: "0.0.0",
      description: "A throwaway package.",
      files: ["README.md"],
    }),
    "README.md": "# Scratch\n\nNothing here.\n",
    ...files,
  };
  for (const [path, contents] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "scratch");
  return { root, git };
}

/** Run the gate over a repository, capturing both streams. */
function run(root: string, extra: Record<string, unknown> = {}) {
  let out = "";
  let err = "";
  const code = runInternalRefsScan({
    projectPrefixes: ["HL7"],
    standardsDesignations: [],
    surfacePaths: ["README.md"],
    accountedTarballFiles: [],
    repoRoot: root,
    exitCodes: { clean: 0, hits: 1, refuse: 2 },
    write: { out: (text: string) => (out += text), err: (text: string) => (err += text) },
    ...extra,
  } as never);
  return { code, out, err };
}

describe("the default surface", () => {
  it("names the changesets, the card, AGENTS.md and the workflows, and the source roots", () => {
    expect(DEFAULT_SURFACE_PATHS).toEqual([
      ".changeset",
      "CLAUDE.md",
      "AGENTS.md",
      ".github/workflows",
    ]);
    expect(DEFAULT_SOURCE_ROOTS).toEqual(["src", "test", "tests"]);
  });

  it("is clean over clean files, and says how many it read", () => {
    const { root } = repoWith({
      ".changeset/a-change.md": '---\n"scratch": patch\n---\n\nThe parser reads a field.\n',
      "CLAUDE.md": "# scratch\n\nA card.\n",
      "AGENTS.md": "# AGENTS.md\n\nBuild it.\n",
      ".github/workflows/ci.yml": "name: ci\n# Runs the tests.\n",
      "src/index.ts": '// Reads a field.\nexport const x = "a value";\n',
      "test/index.test.ts": '/* A test. */\nit("reads a field", () => {});\n',
      "tests/more.mjs": "// More tests.\n",
    });
    const result = run(root);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("6 target(s)");
    expect(result.out).toContain("4 of them from the default surface");
    expect(result.out).toContain(
      "3 source and test file(s) scanned for comments and string literals",
    );
  });

  it("finds an internal reference in each default file, though surfacePaths names only the README", () => {
    const { root } = repoWith({
      ".changeset/a-change.md": '---\n"scratch": patch\n---\n\nEvery release is a patch (D977).\n',
      "CLAUDE.md": "# scratch\n\nRow CFG-91 is open.\n",
      "AGENTS.md": "# AGENTS.md\n\nSee the umbrella's notes.\n",
      ".github/workflows/ci.yml": "name: ci\n# Pinned by every caller (ST95).\n",
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("[item, decision or standard id] .changeset/a-change.md:5");
    expect(result.err).toContain("[internal tracking row id] CLAUDE.md:3");
    expect(result.err).toContain("[private repository name or path] AGENTS.md:3");
    expect(result.err).toContain("[item, decision or standard id] .github/workflows/ci.yml:2");
    expect(result.err).toContain("Translate at the boundary");
  });

  it("reads a default path the caller also names once, and honours the caller's exclude pathspec", () => {
    const { root } = repoWith({
      "CLAUDE.md": "# scratch\n\nRow CFG-91 is open.\n",
      "AGENTS.md": "# AGENTS.md\n\nRow CFG-92 is open.\n",
    });
    const named = run(root, { surfacePaths: ["README.md", "CLAUDE.md"] });
    expect(named.code).toBe(1);
    expect(named.err.split("[internal tracking row id] CLAUDE.md:3").length - 1).toBe(1);

    const excluded = run(root, { surfacePaths: ["README.md", ":(exclude)AGENTS.md"] });
    expect(excluded.err).toContain("CLAUDE.md:3");
    expect(excluded.err).not.toContain("AGENTS.md");
  });

  it("refuses a default file it could not read, naming it", () => {
    const { root, git } = repoWith({});
    symlinkSync("missing-target.md", join(root, "CLAUDE.md"));
    git("add", "CLAUDE.md");
    git("commit", "-q", "-m", "link");
    const result = run(root);
    expect(result.code).toBe(2);
    expect(result.err).toContain("CLAUDE.md");
    expect(result.err).toContain("incomplete scan");
    expect(result.out).toBe("");
  });
});

describe("the default comment and string-literal passes", () => {
  it("read every comment and string literal in source and tests, and label each", () => {
    const { root } = repoWith({
      "src/index.ts": [
        "// Filed as OW9071.",
        "/* Locked by D-971. */",
        'export const message = "see the dates roadmap";',
        "",
      ].join("\n"),
      "test/index.test.ts": [
        'it("covers row CFG-91", () => {',
        "  // KD97 says so",
        "});",
        "",
      ].join("\n"),
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.err).toContain("[item, decision or standard id / comment] src/index.ts:1");
    expect(result.err).toContain("[item, decision or standard id / comment] src/index.ts:2");
    expect(result.err).toContain("[plan or roadmap citation / src string literal] src/index.ts:3");
    expect(result.err).toContain(
      "[internal tracking row id / src string literal] test/index.test.ts:1",
    );
    expect(result.err).toContain("[item, decision or standard id / comment] test/index.test.ts:2");
  });

  it("catches a reference split across two line comments", () => {
    const { root } = repoWith({
      "src/index.ts": "// It shipped in decision\n// 941, with the rest.\n",
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      "[internal decision number / comment / wrapped across lines] src/index.ts:1: decision 941",
    );
  });

  it("runs the repository's own extraRules over comments and literals too", () => {
    const { root } = repoWith({ "test/index.test.ts": "// The QQ-ALPHA note.\n" });
    const extra = {
      id: "local-note",
      name: "local note id",
      patterns: ["\\bQQ-[A-Z]+\\b"],
      positives: ["See QQ-BETA"],
      negatives: ["QQ alone"],
    };
    const clean = run(root);
    expect(clean.code, clean.err).toBe(0);
    const result = run(root, { extraRules: [extra] });
    expect(result.code).toBe(1);
    expect(result.err).toContain("[local note id / comment] test/index.test.ts:1");
  });

  it("carries the caller's source-pass exclusions into the matching default pass", () => {
    const { root } = repoWith({
      "src/generated.ts": '// Row CFG-91.\nexport const table = "Row CFG-92";\n',
      "src/index.ts": '/** A doc comment. */\nexport const ok = "fine";\n',
    });
    const literalsExcluded = run(root, {
      sourceStringLiterals: { enabled: true, paths: ["src", ":(exclude)src/generated.ts"] },
    });
    expect(literalsExcluded.err).toContain("/ comment] src/generated.ts:1");
    expect(literalsExcluded.err).not.toContain("src string literal");

    const commentsExcluded = run(root, {
      sourceDocComments: { enabled: true, paths: ["src", ":!src/generated.ts"] },
    });
    expect(commentsExcluded.err).toContain("/ src string literal] src/generated.ts:2");
    expect(commentsExcluded.err).not.toContain("/ comment]");
  });

  it("refuses a source file it could not read", () => {
    const { root, git } = repoWith({});
    mkdirSync(join(root, "test"));
    symlinkSync("missing-target.ts", join(root, "test", "gone.ts"), "file");
    git("add", "test/gone.ts");
    git("commit", "-q", "-m", "link");
    const result = run(root);
    expect(result.code).toBe(2);
    expect(result.err).toContain("test/gone.ts");
    expect(result.err).toContain("could not open its input");
  });

  it("skips a gitlink under a source root", () => {
    const inner = repoWith({});
    const { root, git } = repoWith({});
    git("-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.root, "src/vendor.ts");
    git("commit", "-q", "-m", "submodule");
    const result = run(root);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("0 source and test file(s) scanned");
  });
});
