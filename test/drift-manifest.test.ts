/**
 * Guards `drift-manifest.json`, the file that calls itself the standard.
 *
 * WHY THIS SUITE EXISTS AT ALL. The manifest used to name a prose document in the umbrella as its
 * authority, and that document was deleted: every requirement in the file was then inherited from
 * something nobody could read, and nothing noticed for months. The remedy is that the manifest now
 * carries its own provenance, its own schema, and its own record of what it used to say. Those are
 * claims a file makes about itself, so each one is asserted here rather than trusted.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. Whether any real repo matches the baseline. A full
 * `pnpm drift` run needs the sibling repos checked out beside `config` and this repo's CI has none,
 * so every case below either builds its own throwaway estate in a temp directory or reads the
 * manifest as data. A test that quietly needed a sibling checkout would pass on one machine and
 * report nothing on another.
 *
 * SECURITY / PHI: no real repository is read, and every fixture written here is synthetic.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  REQUIREMENT_KINDS,
  evaluateRepo,
  formatReport,
  gradeAgentDoc,
  gradeEstate,
  phiScanProbeSpec,
  repoDirFor,
  runCheck,
  summarize,
} from "../scripts/drift-check.js";
import {
  DEFAULT_MANIFEST,
  DEFAULT_SCHEMA,
  SUPPORTED_KEYWORDS,
  checkInvariants,
  collectKeys,
  validateManifest,
  validateValue,
} from "../scripts/validate-drift-manifest.mjs";

const REPO_ROOT = process.cwd();
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-drift-manifest.mjs");
const RAW_MANIFEST = readFileSync(DEFAULT_MANIFEST, "utf8");
const MANIFEST = JSON.parse(RAW_MANIFEST) as Record<string, any>;
const SCHEMA = JSON.parse(readFileSync(DEFAULT_SCHEMA, "utf8")) as Record<string, any>;

/** The 13 and the 11, written out here so the manifest is graded against a list it does not own. */
const PACKAGE_REPOS = [
  "hl7",
  "mllp",
  "dicom",
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
];
const LIGHT_REPOS = [
  "crew",
  "pathways",
  "website",
  "iac",
  "docs",
  "knowledgebase",
  "assets",
  "claude-containers",
  "github-profile",
  "dates",
  "config",
];

/**
 * Every top-level key `drift-manifest.json` carried BEFORE this re-derivation, at commit a396756.
 *
 * It is written down here rather than read out of git, because the point of the list is to be a
 * fact about the past that the manifest's own account can be checked against. Reading it from the
 * file under test would make the check circular; reading it from git would make this suite depend
 * on history depth, which `actions/checkout` controls and CI has already got wrong once.
 */
const PRE_CHANGE_KEYS = [
  "$comment",
  "targets",
  "packageManagerPrefix",
  "nodeEngineMinMajor",
  "tsconfigExtends",
  "prettier",
  "requiredScripts",
  "lintMustInclude",
  "devDepVersions",
  "caretAllowed",
  "pnpmOverridesComment",
  "pnpmOverrides",
  "phiScanProbeComment",
  "phiScanProbe",
  "requiredCosyteConfigDeps",
  "requiredWorkflows",
];

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-manifest-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/** Write a throwaway repo beside a throwaway umbrella root. */
function makeRepo(root: string, name: string, files: Record<string, string>): string {
  const repoDir = join(root, name);
  mkdirSync(repoDir, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(repoDir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf8");
  }
  return repoDir;
}

/** Write a manifest variant to a temp file and hand back its path. */
function manifestFile(mutate: (draft: Record<string, any>) => void): string {
  const draft = JSON.parse(RAW_MANIFEST) as Record<string, any>;
  mutate(draft);
  const dir = tempDir();
  // The schema is named by a relative `$schema`, so the copy has to point back at the real one.
  draft["$schema"] = DEFAULT_SCHEMA;
  const path = join(dir, "drift-manifest.json");
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8");
  return path;
}

function runValidator(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A capture pair for runCheck, so a report can be read rather than printed. */
function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

const NO_PROBE = () => null;
const CONTROLS_PASS = () => [];

// ---------------------------------------------------------------------------

describe("AC1: the manifest's own standing", () => {
  it("names no external prose document as its authority", () => {
    // The dangling reference itself. Version 1 called this file the machine-checkable shadow of a
    // prose document in the umbrella that no longer exists.
    expect(RAW_MANIFEST).not.toMatch(/conventions\.md/i);
  });

  it("states that it is itself the baseline, and points at no prose to prove it", () => {
    const standing = MANIFEST["standing"] as string;
    expect(typeof standing).toBe("string");
    expect(standing).toMatch(/THIS FILE IS THE STANDARD/);
    expect(standing).toMatch(/inherits its authority from no other document/i);
    // A standing statement that cited a document would be the same defect wearing a new path.
    expect(standing).not.toMatch(/\.md\b/);
  });

  it("carries the dropped authority claim in the re-derivation record instead of deleting it", () => {
    const entry = MANIFEST["reDerivation"].droppedOrChanged.find(
      (e: { was: string }) => e.was === "$comment",
    );
    expect(entry, "the $comment authority claim must be accounted for").toBeDefined();
    expect(entry.reason).toMatch(/no longer exists/i);
  });
});

describe("AC2 and AC4: validation of the shipped manifest", () => {
  it("validates against the schema that ships beside it", () => {
    const result = validateManifest();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.schemaPath).toBe(DEFAULT_SCHEMA);
  });

  it("exits 0 from the CLI, which is what `pnpm drift:validate` runs", () => {
    const r = runValidator([]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/drift:validate: OK/);
  });

  it("needs nothing installed: it imports node stdlib and one relative module", () => {
    // AC2 requires this to run on a checkout with no `node_modules`. A bare specifier would
    // resolve here (this suite runs after an install) and fail there, so the imports are asserted
    // rather than the absence of a directory that the test runner itself depends on.
    const source = readFileSync(VALIDATOR, "utf8");
    const specifiers = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        specifier.startsWith("node:") || specifier.startsWith("."),
        `${specifier} would need an install to resolve`,
      ).toBe(true);
    }
  });

  it("every requirement group carries a provenance note", () => {
    for (const [baselineName, baseline] of Object.entries<any>(MANIFEST["baselines"])) {
      for (const [groupName, group] of Object.entries<any>(baseline.groups)) {
        expect(typeof group.provenance, `${baselineName}.${groupName}`).toBe("string");
        expect(group.provenance.length, `${baselineName}.${groupName}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("REFUSES a group with no provenance note, naming the group", () => {
    const path = manifestFile((draft) => {
      delete draft["baselines"].light.groups.emdashGate.provenance;
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      'baselines.light.groups.emdashGate: missing required property "provenance"',
    );
  });

  it("REFUSES a provenance note too short to name a source", () => {
    const path = manifestFile((draft) => {
      draft["baselines"].package.groups.toolchain.provenance = "because";
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("baselines.package.groups.toolchain.provenance: want at least 40");
  });
});

describe("AC3: an invalid manifest grades nothing", () => {
  it("exits non-zero on unparseable JSON and names the file", () => {
    const dir = tempDir();
    const path = join(dir, "drift-manifest.json");
    writeFileSync(path, "{ this is not json", "utf8");
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(path);
    expect(r.stderr).toMatch(/not parseable JSON/);
  });

  it("exits non-zero on a schema violation and names the offending key path", () => {
    const path = manifestFile((draft) => {
      draft["baselines"].package.repos.push("Not A Path");
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/baselines\.package\.repos\[13\]: "Not A Path" does not match/);
  });

  it("refuses an unknown requirement kind rather than ignoring it", () => {
    // A requirement the checker cannot evaluate must not be expressible: silently ignored, it would
    // read as a requirement that passed.
    const path = manifestFile((draft) => {
      draft["baselines"].package.groups.toolchain.requirements.mustBeNice = true;
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "baselines.package.groups.toolchain.requirements.mustBeNice: unexpected property",
    );
  });

  it("refuses a schema keyword it does not implement, rather than skipping the constraint", () => {
    expect(() => validateValue(3, { type: "integer", multipleOf: 2 }, "", {}, [])).toThrow(
      /does not implement/,
    );
  });

  it("reports NO repo as matching when the manifest does not validate", () => {
    const path = manifestFile((draft) => {
      delete draft["baselines"].light.groups.emdashGate.provenance;
    });
    const io = capture();
    const code = runCheck({
      manifestPath: path,
      root: REPO_ROOT,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain("does not validate, so nothing was graded");
    for (const repo of [...PACKAGE_REPOS, ...LIGHT_REPOS]) {
      expect(io.out.join("\n")).not.toContain(repo);
    }
  });
});

describe("AC5: the two baselines cover all 24 submodule paths, once each", () => {
  it("holds the 13 package repos and the 11 light repos", () => {
    expect(MANIFEST["baselines"].package.repos).toEqual(PACKAGE_REPOS);
    expect(MANIFEST["baselines"].light.repos).toEqual(LIGHT_REPOS);
  });

  it("assigns every submodule path to exactly one baseline", () => {
    const estate = MANIFEST["estate"].submodulePaths as string[];
    expect(estate.length).toBe(24);
    expect([...estate].sort()).toEqual([...PACKAGE_REPOS, ...LIGHT_REPOS].sort());
    const overlap = PACKAGE_REPOS.filter((r) => LIGHT_REPOS.includes(r));
    expect(overlap).toEqual([]);
    expect(checkInvariants(MANIFEST)).toEqual([]);
  });

  it("records config as the eleventh light repo the decision counted but did not name", () => {
    const provenance = MANIFEST["baselines"].light.provenance as string;
    expect(provenance).toMatch(/CONFIG IS THE ELEVENTH LIGHT REPO/);
    expect(provenance).toMatch(/24 submodules, minus the 13 package repos/);
    expect(MANIFEST["baselines"].light.repos).toContain("config");
    expect(MANIFEST["baselines"].package.repos).not.toContain("config");
  });

  it("REFUSES a repo held by both baselines, or by neither", () => {
    const both = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    both["baselines"].light.repos.push("hl7");
    expect(checkInvariants(both).join("\n")).toMatch(/already held by the package baseline/);

    const neither = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    neither["baselines"].light.repos = neither["baselines"].light.repos.filter(
      (r: string) => r !== "dates",
    );
    expect(checkInvariants(neither).join("\n")).toMatch(
      /estate\.submodulePaths\[7\]: "dates" is assigned to no baseline/,
    );
  });

  it("keeps the light baseline at its declared ceiling of three groups", () => {
    // The decision authorises no-emdash, ONE CI entry point and the security workflows. A fourth
    // group here would be a requirement no operator asked these repos for.
    expect(Object.keys(MANIFEST["baselines"].light.groups)).toEqual([
      "emdashGate",
      "ciEntryPoint",
      "securityWorkflows",
    ]);
    expect(MANIFEST["baselines"].light.ceiling).toMatch(/Exactly three groups/);
  });
});

describe("AC6: the package baseline reaches beyond build config", () => {
  const groups = () => MANIFEST["baselines"].package.groups;

  it("still declares the build, lint and format requirements", () => {
    expect(Object.keys(groups())).toEqual(
      expect.arrayContaining(["toolchain", "sharedConfig", "scripts", "dependencies"]),
    );
  });

  it.each(["ciWorkflows", "phiScan", "releaseTooling", "agentDoc"])(
    "declares the %s group with at least one requirement and a provenance note",
    (name) => {
      const group = groups()[name];
      expect(group, `${name} is missing`).toBeDefined();
      expect(Object.keys(group.requirements).length).toBeGreaterThanOrEqual(1);
      expect(group.provenance.length).toBeGreaterThanOrEqual(40);
    },
  );

  it("derives the CI workflow baseline from the measured common core, not from the scaffold", () => {
    expect(groups().ciWorkflows.requirements.requiredWorkflows).toEqual([
      "ci.yml",
      "release.yml",
      "codeql.yml",
      "scorecard.yml",
      "no-emdash.yml",
      "no-internal-refs.yml",
    ]);
    expect(groups().ciWorkflows.provenance).toMatch(/no-internal-refs/);
  });
});

describe("AC7: the agent-doc check judges shape and never content", () => {
  const spec = { requiredHeadings: ["## Project", "## Status"], maxLines: 5 };

  it("passes a doc that carries the declared headings within the budget", () => {
    expect(gradeAgentDoc("# T\n## Project\n## Status\n", spec, "CLAUDE.md")).toEqual([]);
  });

  it("gives the same verdict for two docs whose bodies differ completely", () => {
    const a = "# T\n## Project\nalpha alpha\n## Status\n";
    const b = "# T\n## Project\nSECRET-CANARY-9182\n## Status\n";
    expect(gradeAgentDoc(a, spec, "CLAUDE.md")).toEqual(gradeAgentDoc(b, spec, "CLAUDE.md"));
  });

  it("never quotes a line that is not a heading, even when it reds", () => {
    const doc = ["# T", "SECRET-CANARY-9182", "## Status", "more body"].join("\n");
    const violations = gradeAgentDoc(doc, spec, "CLAUDE.md");
    expect(violations).toEqual(['CLAUDE.md: missing the required section heading "## Project"']);
    expect(JSON.stringify(violations)).not.toContain("SECRET-CANARY");
  });

  it("reports the line count and nothing about what is on those lines", () => {
    const doc = ["## Project", "## Status", "a", "b", "c", "d"].join("\n");
    const violations = gradeAgentDoc(doc, spec, "CLAUDE.md");
    expect(violations).toEqual(["CLAUDE.md: 6 lines, over the declared ceiling of 5"]);
  });

  it("matches a heading a repo has qualified, since the rule is `starts with`", () => {
    const doc = "## Project overview\n## Status: pre-alpha\n";
    expect(gradeAgentDoc(doc, spec, "CLAUDE.md")).toEqual([]);
  });

  it("counts lines the way wc -l does, so a trailing newline is not a line", () => {
    const spec1 = { requiredHeadings: ["## Project"], maxLines: 1 };
    expect(gradeAgentDoc("## Project\n", spec1, "CLAUDE.md")).toEqual([]);
    expect(gradeAgentDoc("## Project\n\n", spec1, "CLAUDE.md")).toEqual([
      "CLAUDE.md: 2 lines, over the declared ceiling of 1",
    ]);
  });
});

describe("AC8: a repo with no agent-context doc is one drift line, not an abort", () => {
  it("reports the expected path once and keeps grading the rest of the repo", () => {
    const root = tempDir();
    makeRepo(root, "hl7", { "package.json": JSON.stringify({ name: "@cosyte/hl7" }) });
    const result = evaluateRepo({
      name: "hl7",
      baselineName: "package",
      baseline: MANIFEST["baselines"].package,
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; findings: { group: string; line: string }[] };

    expect(result.skipped).toBe(false);
    const agentDoc = result.findings.filter((f) => f.group === "agentDoc");
    expect(agentDoc.length).toBe(1);
    expect(agentDoc[0]?.line).toContain("CLAUDE.md: missing");
    expect(agentDoc[0]?.line).toContain("AGENTS.md");
    // The rest of the baseline was still graded, which is what "continue" means here.
    expect(result.findings.some((f) => f.group === "ciWorkflows")).toBe(true);
  });

  it("does not throw, and grades the repos after it", () => {
    const root = tempDir();
    makeRepo(root, "hl7", { "package.json": "{}" });
    makeRepo(root, "mllp", { "package.json": "{}", "CLAUDE.md": "## Project\n" });
    const manifest = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    manifest["baselines"].package.repos = ["hl7", "mllp"];
    manifest["baselines"].light.repos = [];

    const results = gradeEstate({ manifest, root, probe: NO_PROBE }) as any[];
    expect(results.map((r) => r.name)).toEqual(["hl7", "mllp"]);
    // hl7 has no doc at all and mllp has one, so only the first carries the file-absent line. The
    // second still reds on its missing headings, which is the shape check doing its other half.
    expect(results[0].findings.some((f: any) => f.line.includes("(agent-context doc"))).toBe(true);
    expect(results[1].findings.some((f: any) => f.line.includes("(agent-context doc"))).toBe(false);
    expect(results[1].findings.some((f: any) => f.line.includes('heading "## Status"'))).toBe(true);
  });

  it("accepts AGENTS.md as the alternative filename", () => {
    const root = tempDir();
    makeRepo(root, "hl7", {
      "package.json": "{}",
      "AGENTS.md":
        "## Project\n## Status\n## Tech Stack\n## Engineering Guardrails\n## Standing disciplines\n",
    });
    const result = evaluateRepo({
      name: "hl7",
      baselineName: "package",
      baseline: MANIFEST["baselines"].package,
      root,
      probe: NO_PROBE,
    }) as { findings: { group: string }[] };
    expect(result.findings.filter((f) => f.group === "agentDoc")).toEqual([]);
  });
});

describe("AC9: a light repo with no package.json is evaluated, never skipped", () => {
  it("grades it against the light baseline and reports its result", () => {
    const root = tempDir();
    makeRepo(root, "crew", { ".github/workflows/ci.yml": "name: CI\n" });
    const result = evaluateRepo({
      name: "crew",
      baselineName: "light",
      baseline: MANIFEST["baselines"].light,
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; findings: { group: string; line: string }[] };

    expect(result.skipped).toBe(false);
    const lines = result.findings.map((f) => f.line);
    expect(lines).toContain(".github/workflows/no-emdash.yml: missing");
    expect(lines).toContain(".github/workflows/codeql.yml: missing");
    expect(lines).toContain(".github/workflows/scorecard.yml: missing");
    // The one it HAS is not reported, which is what makes this a result rather than a template.
    expect(lines).not.toContain(".github/workflows/ci.yml: missing");
    expect(lines.join("\n")).not.toMatch(/greenfield/);
  });

  it("still skips a package-baseline repo with no package.json, which is the policy per baseline", () => {
    const root = tempDir();
    makeRepo(root, "hl7", { "README.md": "# hl7\n" });
    const result = evaluateRepo({
      name: "hl7",
      baselineName: "package",
      baseline: MANIFEST["baselines"].package,
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; reason: string };
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("greenfield");
    expect(MANIFEST["baselines"].package.missingPackageJson).toBe("skip");
    expect(MANIFEST["baselines"].light.missingPackageJson).toBe("evaluate");
  });

  it("never skips a repo whose package.json is present and broken", () => {
    // A syntax error must not clear a repo the way an absent file does.
    const root = tempDir();
    makeRepo(root, "hl7", { "package.json": "{ broken" });
    const result = evaluateRepo({
      name: "hl7",
      baselineName: "package",
      baseline: MANIFEST["baselines"].package,
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; findings: { line: string }[] };
    expect(result.skipped).toBe(false);
    expect(result.findings.some((f) => f.line.includes("package.json: unparseable"))).toBe(true);
  });
});

describe("AC10: a repo with no directory beside config is skipped with a reason", () => {
  it("says why, does not throw, and is not counted as matching", () => {
    const root = tempDir();
    const result = evaluateRepo({
      name: "hl7",
      baselineName: "package",
      baseline: MANIFEST["baselines"].package,
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; reason: string };
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("not present");
    expect(result.reason).toContain("nothing was read");

    const summary = summarize([result as any]);
    expect(summary).toEqual({ total: 1, matching: 0, drifted: 0, skipped: 1 });
  });

  it("skips an EMPTY directory too, which is an uninitialized submodule and not a repo", () => {
    const root = tempDir();
    mkdirSync(join(root, "dates"));
    const result = evaluateRepo({
      name: "dates",
      baselineName: "light",
      baseline: MANIFEST["baselines"].light,
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; reason: string };
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("not checked out");
  });

  it("runs the whole estate over an empty root without an exception, and claims nothing", () => {
    const root = tempDir();
    const io = capture();
    const code = runCheck({
      root,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).not.toMatch(/matches the/);
    expect(printed).toContain("0 matching, 0 with drift, 24 skipped, of 24 repo(s)");
    expect(io.err.join("\n")).toContain("nothing was graded");
    expect(code).toBe(2);
  });
});

describe("AC11: the org profile repo is addressed by path, never by submodule name", () => {
  it("is named `github-profile` in the light baseline, and no repo name is a dotfile", () => {
    expect(MANIFEST["baselines"].light.repos).toContain("github-profile");
    for (const repo of [
      ...MANIFEST["baselines"].package.repos,
      ...MANIFEST["baselines"].light.repos,
      ...MANIFEST["estate"].submodulePaths,
    ]) {
      expect(repo.startsWith("."), `${repo} is a submodule NAME, not a PATH`).toBe(false);
    }
    expect(RAW_MANIFEST).not.toMatch(/"\.github"/);
  });

  it("cannot even be written as `.github`: the schema refuses the name", () => {
    const errors: string[] = [];
    validateValue(".github", SCHEMA["$defs"].repoName, "baselines.light.repos[8]", SCHEMA, errors);
    expect(errors.join("\n")).toMatch(/baselines\.light\.repos\[8\]: "\.github" does not match/);
  });

  it("cannot be resolved as `.github` either: the checker refuses the name", () => {
    const root = tempDir();
    expect(repoDirFor(root, "github-profile")).toBe(join(root, "github-profile"));
    expect(() => repoDirFor(root, ".github")).toThrow(/github-profile/);
    expect(() => repoDirFor(root, "../elsewhere")).toThrow(/addressed by their/);
  });

  it("reads github-profile/ and not the umbrella's own .github/", () => {
    // The trap, built: the umbrella root carries a `.github/workflows/no-emdash.yml` of its own and
    // the repo carries none. A checker that resolved by submodule name would report the repo clean.
    const root = tempDir();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "no-emdash.yml"), "name: umbrella\n", "utf8");
    makeRepo(root, "github-profile", { ".github/workflows/ci.yml": "name: CI\n" });

    const result = evaluateRepo({
      name: "github-profile",
      baselineName: "light",
      baseline: MANIFEST["baselines"].light,
      root,
      probe: NO_PROBE,
    }) as { findings: { line: string }[] };
    expect(result.findings.map((f) => f.line)).toContain(
      ".github/workflows/no-emdash.yml: missing",
    );
  });
});

describe("AC12: the phi-scan probe still gates the report, and its parameters still hold", () => {
  it("grades no repo when the probe's controls misbehave", () => {
    const io = capture();
    const code = runCheck({
      root: REPO_ROOT,
      controls: () => ["POSITIVE CONTROL (phi-scan completeness) is vacuous: fabricated"],
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain("cannot be trusted, so nothing was graded");
  });

  it("keeps the probe declared as a requirement of the package baseline", () => {
    expect(MANIFEST["baselines"].package.groups.phiScan.requirements.phiScanCapabilityProbe).toBe(
      true,
    );
  });

  it("keeps the default parameters sufficient for the controls", () => {
    const spec = phiScanProbeSpec("__control__") as Record<string, unknown>;
    expect(spec).toEqual({
      violator: "test/fixtures/phi-scan-probe-violator.txt",
      decoy: "test/fixtures/phi-scan-probe-decoy.txt",
      payload: "patient ssn 123-45-6789 on file\n",
      marker: "123-45-6789",
      clean: "nothing to see here\n",
      scaffoldFiles: ["src/index.ts", "README.md"],
    });
  });

  it("keeps the per-repo entry that makes the probe's premise hold for dicom", () => {
    // Without this entry the default payload scans CLEAN in dicom, the probe cannot tell an unread
    // target from a clean one, and it answers `inconclusive` instead of grading the repo.
    const dicom = phiScanProbeSpec("dicom") as Record<string, unknown>;
    expect(dicom["payload"]).toBe("PatientName: RIVERA^JORDAN\n");
    expect(dicom["marker"]).toBe("RIVERA^JORDAN");
    expect(dicom["violator"]).toBe("test/fixtures/phi-scan-probe-violator.txt");
    expect(dicom["scaffoldFiles"]).toContain("docs-content/intro.md");
    expect(MANIFEST["phiScanProbe"].perRepo.dicom.$why).toMatch(/tiers by EXTENSION|synthetic PN/);
    expect(MANIFEST["baselines"].package.repos).toContain("dicom");
  });

  it("leaves every other repo on the default parameters", () => {
    expect(phiScanProbeSpec("hl7")).toEqual(phiScanProbeSpec("__control__"));
  });

  it("REFUSES a per-repo override for a repo no baseline holds", () => {
    const orphan = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    orphan["phiScanProbe"].perRepo.bridgelink = { payload: "x", marker: "x" };
    expect(checkInvariants(orphan).join("\n")).toMatch(/phiScanProbe\.perRepo\.bridgelink/);
  });
});

describe("AC15: nothing the previous manifest required vanishes unmentioned", () => {
  it("declares exactly the pre-change key set", () => {
    expect([...MANIFEST["reDerivation"].preChangeKeys].sort()).toEqual([...PRE_CHANGE_KEYS].sort());
  });

  it("accounts for every pre-change key exactly once", () => {
    const kept: string[] = MANIFEST["reDerivation"].carriedUnchanged;
    const changed: string[] = MANIFEST["reDerivation"].droppedOrChanged.map(
      (e: { was: string }) => e.was,
    );
    for (const key of PRE_CHANGE_KEYS) {
      const inKept = kept.includes(key);
      const inChanged = changed.includes(key);
      expect([inKept, inChanged], `${key} is accounted for exactly once`).toContain(true);
      expect(inKept && inChanged, `${key} is in both lists`).toBe(false);
    }
  });

  it("still declares every key it claims to have carried unchanged", () => {
    const present = collectKeys(MANIFEST) as Set<string>;
    for (const key of MANIFEST["reDerivation"].carriedUnchanged) {
      expect(present.has(key), `${key} is claimed as carried but is not in the file`).toBe(true);
    }
  });

  it("gives a reason for each dropped or changed requirement", () => {
    for (const entry of MANIFEST["reDerivation"].droppedOrChanged) {
      expect(entry.reason.length, entry.was).toBeGreaterThanOrEqual(40);
      expect(entry.now.length, entry.was).toBeGreaterThan(0);
    }
    const changed = MANIFEST["reDerivation"].droppedOrChanged.map((e: { was: string }) => e.was);
    expect(changed).toEqual(
      expect.arrayContaining(["$comment", "targets", "pnpmOverridesComment", "requiredWorkflows"]),
    );
  });

  it("REFUSES a record that leaves a pre-change key unaccounted for", () => {
    const forgetful = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    forgetful["reDerivation"].carriedUnchanged = forgetful["reDerivation"].carriedUnchanged.filter(
      (k: string) => k !== "lintMustInclude",
    );
    expect(checkInvariants(forgetful).join("\n")).toMatch(
      /"lintMustInclude" appears in neither carriedUnchanged nor droppedOrChanged/,
    );
  });

  it("REFUSES a claim that a key was carried when it is no longer there", () => {
    const liar = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    delete liar["baselines"].package.groups.scripts.requirements.lintMustInclude;
    expect(checkInvariants(liar).join("\n")).toMatch(
      /"lintMustInclude" is claimed to be carried unchanged but appears nowhere/,
    );
  });

  it("carries the version-1 requirement VALUES that it says are unchanged", () => {
    const groups = MANIFEST["baselines"].package.groups;
    expect(groups.toolchain.requirements.packageManagerPrefix).toBe("pnpm@10");
    expect(groups.toolchain.requirements.nodeEngineMinMajor).toBe(22);
    expect(groups.sharedConfig.requirements.tsconfigExtends).toBe("@cosyte/tsconfig/base.json");
    expect(groups.sharedConfig.requirements.prettier).toBe("@cosyte/prettier-config");
    expect(groups.scripts.requirements.lintMustInclude).toBe("--max-warnings=0");
    expect(groups.scripts.requirements.requiredScripts).toEqual([
      "build",
      "typecheck",
      "lint",
      "lint:fix",
      "format",
      "format:check",
      "test",
      "test:watch",
      "test:coverage",
      "phi-scan",
      "attw",
      "clean",
      "prepublishOnly",
    ]);
    expect(groups.dependencies.requirements.caretAllowed).toEqual(["@types/node"]);
    expect(groups.dependencies.requirements.pnpmOverrides).toEqual({
      "esbuild@>=0.27.3 <0.28.1": "0.28.1",
      "js-yaml@>=4.0.0 <4.3.0": "4.3.0",
    });
    expect(groups.sharedConfig.requirements.requiredCosyteConfigDeps).toEqual([
      "@cosyte/tsconfig",
      "@cosyte/eslint-config",
      "@cosyte/prettier-config",
      "@cosyte/tsup-config",
      "@cosyte/vitest-config",
    ]);
  });
});

describe("the manifest and the checker cannot drift apart", () => {
  it("shares one closed set of requirement kinds with the schema", () => {
    const declared = Object.keys(SCHEMA["$defs"].requirements.properties).sort();
    expect(Object.keys(REQUIREMENT_KINDS).sort()).toEqual(declared);
  });

  it("has an evaluator for every kind any baseline actually uses", () => {
    for (const baseline of Object.values<any>(MANIFEST["baselines"])) {
      for (const group of Object.values<any>(baseline.groups)) {
        for (const kind of Object.keys(group.requirements)) {
          expect(Object.keys(REQUIREMENT_KINDS)).toContain(kind);
        }
      }
    }
  });

  it("renders a report that separates skipped repos from matching ones", () => {
    const root = tempDir();
    makeRepo(root, "crew", {
      ".github/workflows/ci.yml": "name: CI\n",
      ".github/workflows/no-emdash.yml": "name: no-emdash\n",
      ".github/workflows/codeql.yml": "name: codeql\n",
      ".github/workflows/scorecard.yml": "name: scorecard\n",
    });
    const manifest = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    manifest["baselines"].package.repos = ["hl7"];
    manifest["baselines"].light.repos = ["crew"];
    const results = gradeEstate({ manifest, root, probe: NO_PROBE });
    const report = formatReport(results as any).join("\n");

    expect(report).toContain("✓ crew: matches the light baseline");
    expect(report).toContain("• hl7: SKIP (not present");
    expect(report).toContain("1 matching, 0 with drift, 1 skipped, of 2 repo(s)");
    expect(report).toContain("nothing: every repo that could be read matches its baseline");
  });
});

// ---------------------------------------------------------------------------
// S0228. Three workflows the estate carries and no baseline requires were, until this change,
// answered only by silence: the checker asks whether a REQUIRED workflow is present, so an extra
// produced no line either way and a reader could not tell a settled question from an unasked one.
// The manifest now DECLARES them, the report prints the declaration, and the validator refuses a
// manifest that calls the same file optional and required. The same change carries two provenance
// corrections, both about this file's own account of itself.
// ---------------------------------------------------------------------------

/**
 * The three, and the carriers measured on 2026-08-29.
 *
 * Written out here rather than read from the manifest, for the same reason PRE_CHANGE_KEYS is:
 * grading a file against a list it owns is not grading it.
 */
const OPTIONAL_WORKFLOWS: Record<string, string[]> = {
  "fuzz.yml": ["x12", "ncpdp", "astm", "synth", "cli"],
  "test-selection.yml": ["ncpdp", "deid", "synth"],
  "smoke.yml": ["deid"],
};

/** A light-baseline repo that carries everything the light baseline asks for. */
const LIGHT_COMPLETE: Record<string, string> = {
  ".github/workflows/ci.yml": "name: CI\n",
  ".github/workflows/no-emdash.yml": "name: no-emdash\n",
  ".github/workflows/codeql.yml": "name: codeql\n",
  ".github/workflows/scorecard.yml": "name: scorecard\n",
};

function gradeLight(
  root: string,
  name: string,
): { skipped: boolean; findings: { line: string }[] } {
  return evaluateRepo({
    name,
    baselineName: "light",
    baseline: MANIFEST["baselines"].light,
    root,
    probe: NO_PROBE,
  }) as { skipped: boolean; findings: { line: string }[] };
}

describe("S0228 AC6: fuzz, test-selection and smoke are DECLARED optional", () => {
  it("declares exactly the three, each with the repos measured as carrying it", () => {
    const declared = MANIFEST["optionalWorkflows"].workflows as {
      workflow: string;
      carriedBy: string[];
    }[];
    expect(declared.map((entry) => entry.workflow)).toEqual(Object.keys(OPTIONAL_WORKFLOWS));
    for (const entry of declared) {
      expect(entry.carriedBy, entry.workflow).toEqual(OPTIONAL_WORKFLOWS[entry.workflow]);
    }
  });

  it("gives each one a provenance that names its carriers and why it is not a requirement", () => {
    for (const entry of MANIFEST["optionalWorkflows"].workflows) {
      expect(entry.provenance.length, entry.workflow).toBeGreaterThanOrEqual(40);
      // The prose has to name the same repos the machine-readable list does. Two halves of one
      // claim that can disagree is how a reader ends up believing whichever half they read first.
      for (const repo of entry.carriedBy) {
        expect(entry.provenance, `${entry.workflow} provenance omits ${repo}`).toContain(repo);
      }
      expect(entry.provenance, entry.workflow).toMatch(/NOT A REQUIREMENT/);
    }
    expect(MANIFEST["optionalWorkflows"].provenance).toMatch(/NEW OPERATOR DECISION/);
  });

  it("names none of the three in any baseline group's required workflows", () => {
    const bare = Object.keys(OPTIONAL_WORKFLOWS).map((file) => file.replace(/\.yml$/, ""));
    for (const [baselineName, baseline] of Object.entries<any>(MANIFEST["baselines"])) {
      for (const [groupName, group] of Object.entries<any>(baseline.groups)) {
        for (const workflow of group.requirements.requiredWorkflows ?? []) {
          expect(bare, `${baselineName}.${groupName} requires ${workflow}`).not.toContain(
            workflow.replace(/\.yml$/, ""),
          );
        }
      }
    }
  });
});

describe("S0228 AC7: an optional workflow is neither drift when present nor owed when absent", () => {
  it("does not report the presence of all three as drift", () => {
    const root = tempDir();
    makeRepo(root, "crew", {
      ...LIGHT_COMPLETE,
      ".github/workflows/fuzz.yml": "name: fuzz\n",
      ".github/workflows/test-selection.yml": "name: test-selection\n",
      ".github/workflows/smoke.yml": "name: smoke\n",
    });
    const result = gradeLight(root, "crew");
    expect(result.skipped).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("reports no missing requirement for any of the three when a repo carries none", () => {
    const root = tempDir();
    makeRepo(root, "crew", { ".github/workflows/ci.yml": "name: CI\n" });
    const result = gradeLight(root, "crew");
    const lines = result.findings.map((finding) => finding.line).join("\n");
    // The contrast is the point: this repo IS told about the three workflows it owes, so the
    // silence about the optional three is a decision rather than a checker that reported nothing.
    expect(lines).toContain(".github/workflows/codeql.yml: missing");
    expect(lines).toContain(".github/workflows/scorecard.yml: missing");
    expect(lines).toContain(".github/workflows/no-emdash.yml: missing");
    for (const workflow of Object.keys(OPTIONAL_WORKFLOWS)) {
      expect(lines, `${workflow} was reported as a missing requirement`).not.toContain(workflow);
    }
  });

  it("says so in the report, so silence is not the only evidence", () => {
    const root = tempDir();
    makeRepo(root, "crew", LIGHT_COMPLETE);
    const manifest = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    manifest["baselines"].package.repos = ["hl7"];
    manifest["baselines"].light.repos = ["crew"];
    const results = gradeEstate({ manifest, root, probe: NO_PROBE });
    const report = formatReport(results as any, manifest["optionalWorkflows"]).join("\n");

    expect(report).toMatch(/OPTIONAL WORKFLOWS .*required by no baseline/);
    expect(report).toContain("carrying one is NOT drift");
    for (const [workflow, carriers] of Object.entries(OPTIONAL_WORKFLOWS)) {
      expect(report).toContain(`${workflow}: OPTIONAL, carried by ${carriers.join(", ")}`);
    }
  });

  it("prints it from a real run too, not only from formatReport", () => {
    const root = tempDir();
    const io = capture();
    runCheck({
      root,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    for (const [workflow, carriers] of Object.entries(OPTIONAL_WORKFLOWS)) {
      expect(printed).toContain(`${workflow}: OPTIONAL, carried by ${carriers.join(", ")}`);
    }
  });

  it("reports the manifest it was POINTED AT, never the one this module imported", () => {
    // A run pointed at another manifest must print that manifest's declarations, or the report
    // would describe a standard the run did not grade against.
    const path = manifestFile((draft) => {
      draft["optionalWorkflows"].workflows = [draft["optionalWorkflows"].workflows[0]];
    });
    const io = capture();
    runCheck({
      manifestPath: path,
      root: tempDir(),
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).toContain("fuzz.yml: OPTIONAL");
    expect(printed).not.toContain("smoke.yml: OPTIONAL");
  });
});

describe("S0228: the validator refuses an optional declaration that contradicts itself", () => {
  it("REFUSES a workflow declared optional AND required", () => {
    const both = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    both["baselines"].light.groups.securityWorkflows.requirements.requiredWorkflows.push(
      "fuzz.yml",
    );
    expect(checkInvariants(both).join("\n")).toMatch(
      /"fuzz\.yml" is declared OPTIONAL here and REQUIRED by baselines\.light\.groups\.securityWorkflows/,
    );
  });

  it("exits 1 from the CLI on that contradiction, rather than grading either claim", () => {
    const path = manifestFile((draft) => {
      draft["baselines"].package.groups.ciWorkflows.requirements.requiredWorkflows.push(
        "smoke.yml",
      );
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("declared OPTIONAL here and REQUIRED by");
  });

  it("REFUSES a carrier no baseline holds, so a carrier list cannot outlive its repo", () => {
    const orphan = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    orphan["optionalWorkflows"].workflows[0].carriedBy.push("bridgelink-mcp");
    expect(checkInvariants(orphan).join("\n")).toMatch(
      /optionalWorkflows\.workflows\[0\]\.carriedBy\[5\]: no baseline holds a repo named "bridgelink-mcp"/,
    );
  });

  it("REFUSES the same workflow declared optional twice", () => {
    const twice = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    twice["optionalWorkflows"].workflows.push({
      ...twice["optionalWorkflows"].workflows[0],
      carriedBy: ["deid"],
    });
    expect(checkInvariants(twice).join("\n")).toMatch(
      /already declared optional at optionalWorkflows\.workflows\[0\]/,
    );
  });

  it("grades NO repo and exits non-zero when the optional declaration does not validate", () => {
    // The invariant this change must not break: a manifest that does not validate cannot say what
    // any repo owes, so drift-check reports on none of them rather than on some of them.
    const path = manifestFile((draft) => {
      draft["optionalWorkflows"].workflows[0].carriedBy = [];
    });
    const io = capture();
    const code = runCheck({
      manifestPath: path,
      root: REPO_ROOT,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain(
      "optionalWorkflows.workflows[0].carriedBy: want at least 1 item(s), got 0",
    );
    for (const repo of [...PACKAGE_REPOS, ...LIGHT_REPOS]) {
      expect(io.out.join("\n")).not.toContain(repo);
    }
  });

  it("REFUSES a manifest that drops the declaration entirely", () => {
    const path = manifestFile((draft) => {
      delete draft["optionalWorkflows"];
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('(root): missing required property "optionalWorkflows"');
  });
});

describe("S0228: the declaration is written in keywords the hand-written validator implements", () => {
  /**
   * Every keyword the schema uses, walked keyword-aware so that a PROPERTY NAME is never mistaken
   * for one. The subschema positions are the six the validator itself recurses through.
   */
  function schemaKeywords(node: unknown, into = new Set<string>()): Set<string> {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return into;
    for (const [key, sub] of Object.entries(node as Record<string, unknown>)) {
      into.add(key);
      if (key === "properties" || key === "patternProperties" || key === "$defs") {
        if (typeof sub === "object" && sub !== null) {
          for (const child of Object.values(sub)) schemaKeywords(child, into);
        }
      } else if (key === "items" || key === "propertyNames" || key === "additionalProperties") {
        schemaKeywords(sub, into);
      }
    }
    return into;
  }

  it("uses no keyword the validator would have to skip or refuse", () => {
    // validateValue throws on an unknown keyword rather than ignoring it, but only along a path a
    // value actually reaches: a subschema guarding a key no manifest exercises would never be
    // walked, and its unsupported keyword would sit there reading as a constraint. So the whole
    // schema is graded against the implemented set directly.
    const used = schemaKeywords(SCHEMA);
    expect(used.has("properties"), "the walk found nothing, so it proves nothing").toBe(true);
    for (const keyword of used) {
      expect(
        SUPPORTED_KEYWORDS.has(keyword),
        `the schema uses ${keyword}, which the validator does not implement`,
      ).toBe(true);
    }
  });

  it("still validates the shipped manifest, which exercises every branch of the new subschema", () => {
    const errors: string[] = [];
    expect(() =>
      validateValue(
        MANIFEST["optionalWorkflows"],
        SCHEMA["$defs"].optionalWorkflows,
        "optionalWorkflows",
        SCHEMA,
        errors,
      ),
    ).not.toThrow();
    expect(errors).toEqual([]);
  });
});

describe("S0228: the two provenance corrections", () => {
  it("answers from the light baseline's provenance why config is not asked for no-internal-refs", () => {
    const provenance = MANIFEST["baselines"].light.provenance as string;
    expect(provenance).toMatch(/no-internal-refs\.yml/);
    expect(provenance).toMatch(/EXACTLY THREE GROUPS/);
    expect(provenance).toMatch(/new operator decision/i);
  });

  it("records the answer without turning it into a requirement", () => {
    // The correction says config is NOT asked for the gate. A group that then required it would
    // make the note false in the same file that carries it.
    for (const [name, group] of Object.entries<any>(MANIFEST["baselines"].light.groups)) {
      expect(group.requirements.requiredWorkflows ?? [], name).not.toContain(
        "no-internal-refs.yml",
      );
    }
    expect(Object.keys(MANIFEST["baselines"].light.groups)).toEqual([
      "emdashGate",
      "ciEntryPoint",
      "securityWorkflows",
    ]);
    expect(
      MANIFEST["baselines"].package.groups.ciWorkflows.requirements.requiredWorkflows,
    ).toContain("no-internal-refs.yml");
  });

  it("records the scaffold's four-of-six gap in the CI-workflows group's provenance", () => {
    const provenance = MANIFEST["baselines"].package.groups.ciWorkflows.provenance as string;
    expect(provenance).toMatch(/scripts\/parser-template/);
    expect(provenance).toMatch(/NO no-emdash\.yml and NO no-internal-refs\.yml/);
    expect(provenance).toMatch(/SEPARATE WORK/);
  });

  it("is a claim about a tree in this checkout, so it is measured rather than asserted", () => {
    const shipped = readdirSync(
      join(REPO_ROOT, "scripts", "parser-template", ".github", "workflows"),
    ).sort();
    const required = MANIFEST["baselines"].package.groups.ciWorkflows.requirements
      .requiredWorkflows as string[];
    expect(shipped).toEqual(["ci.yml", "codeql.yml", "release.yml", "scorecard.yml"]);
    expect(required.filter((workflow) => !shipped.includes(workflow))).toEqual([
      "no-emdash.yml",
      "no-internal-refs.yml",
    ]);
  });
});

describe("S0228: config's own two security-workflow callers", () => {
  const WORKFLOWS = join(REPO_ROOT, ".github", "workflows");
  const SCAFFOLD = join(REPO_ROOT, "scripts", "parser-template", ".github", "workflows");
  const SECURITY = ["codeql.yml", "scorecard.yml"];

  /** The comment lines stripped, so a sentence ABOUT a `run:` cannot be read as one. */
  function wiring(text: string): string {
    return text
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
  }

  /** The job-level `name: value` grants, which sit two levels below `jobs:` in every caller here. */
  function jobGrants(text: string): string[] {
    return text
      .split("\n")
      .map((line) => /^ {6}([a-z-]+): (read|write|none)\b/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => `${match[1]}: ${match[2]}`)
      .sort();
  }

  it("carries both workflows the light baseline's securityWorkflows group requires", () => {
    const required = MANIFEST["baselines"].light.groups.securityWorkflows.requirements
      .requiredWorkflows as string[];
    expect(required).toEqual(SECURITY);
    const present = readdirSync(WORKFLOWS);
    for (const workflow of required) expect(present, workflow).toContain(workflow);
  });

  it.each(SECURITY)(
    "%s calls the org profile repo's reusable of the same name, at @main",
    (name) => {
      expect(wiring(readFileSync(join(WORKFLOWS, name), "utf8"))).toContain(
        `uses: cosyte/.github/.github/workflows/${name}@main`,
      );
    },
  );

  it.each(SECURITY)("%s carries no analysis logic and nothing that makes it unfailable", (name) => {
    const text = wiring(readFileSync(join(WORKFLOWS, name), "utf8"));
    expect(text).not.toMatch(/^\s*steps:/m);
    expect(text).not.toMatch(/^\s*-?\s*run:/m);
    expect(text).not.toMatch(/continue-on-error/);
    expect(text).not.toMatch(/\|\| true/);
  });

  it.each(SECURITY)("%s grants at the JOB exactly what the scaffold caller declares", (name) => {
    // A called workflow can only DOWNGRADE its caller's token, so a grant the reusable needs and
    // this file omits is simply absent at run time. The scaffold caller in this same repository is
    // the checkout's statement of that set, and it is what these two are derived from.
    const scaffold = jobGrants(readFileSync(join(SCAFFOLD, name), "utf8"));
    expect(
      scaffold.length,
      "the scaffold declares no grants, so this proves nothing",
    ).toBeGreaterThan(0);
    expect(jobGrants(readFileSync(join(WORKFLOWS, name), "utf8"))).toEqual(scaffold);
  });
});
