/**
 * THE BASELINE REQUIRES THE TWO INSTALL CONTROLS OF EVERY PACKAGE REPO, AND SAYS WHAT IT REQUIRED.
 *
 * `scripts/drift-check.js` gains one requirement kind here, `pnpmInstallHardening`, and this suite
 * grades it the way the rest of that file is graded: against a throwaway tree of repositories built
 * for the case, not against whatever happens to be checked out beside `config`.
 *
 * THREE THINGS IT PINS, EACH ONE A WAY THIS COULD BE WRONG WITHOUT LOOKING WRONG.
 *
 *  1. A DEFICIENT REPO IS NAMED, AND A COMPLIANT ONE IS NOT. A check that reported every repo, or
 *     none, would pass a bare "exit non-zero" assertion and be useless as a worklist.
 *  2. AN ABSENT OR GREENFIELD REPO IS STILL SKIPPED. The existing skip behaviour is what stops an
 *     umbrella with three checkouts reading as an estate that is 88 percent clean, and a new
 *     requirement that graded an unread tree would undo it. This is AC-6, and it is asserted rather
 *     than assumed because the skip happens in `evaluateRepo` and a new requirement kind is the
 *     kind of change that quietly moves it.
 *  3. THE REQUIRED VALUE COMES FROM THE MANIFEST AND IS PRINTED. Editing the floor in
 *     drift-manifest.json must re-grade all thirteen repos with NO edit to the checker, and the
 *     drift line must say the number it wanted - otherwise a reader cannot tell a repo that is 60
 *     minutes short from one that has nothing at all. This is AC-7.
 *
 * The phi-scan capability probe is not exercised here and no case includes it in a baseline, so
 * nothing in this file can weaken the controls that gate the whole report.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { evaluateRepo, formatReport, gradeEstate, summarize } from "../scripts/drift-check.js";

const MANIFEST = JSON.parse(readFileSync(join(process.cwd(), "drift-manifest.json"), "utf8"));

/** The requirement as the committed standard states it, never transcribed into this file. */
const REQUIREMENT = MANIFEST.baselines.package.groups.installHardening.requirements
  .pnpmInstallHardening as {
  settingsFile: string;
  minimumReleaseAgeMinutes: number;
  trustPolicy: string;
};

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type RepoSpec = {
  /** Absent entirely: no directory at all. */
  absent?: boolean;
  /** Present, but carrying no package.json: the greenfield case. */
  greenfield?: boolean;
  /** The contents of the settings file, or undefined for a repo that has none. */
  settings?: string;
};

/** Build an umbrella-shaped root holding the named repos. */
function estate(repos: Record<string, RepoSpec>): string {
  const root = mkdtempSync(join(tmpdir(), "drift-hardening-"));
  roots.push(root);
  for (const [name, spec] of Object.entries(repos)) {
    if (spec.absent === true) continue;
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (spec.greenfield === true) {
      // NOT AN EMPTY DIRECTORY: that is the uninitialized-submodule skip, which is a different
      // reason and a different case. A greenfield repo has content and no package.json.
      writeFileSync(join(dir, "README.md"), `# ${name}\n`, "utf8");
    } else {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }), "utf8");
    }
    if (spec.settings !== undefined) {
      writeFileSync(join(dir, REQUIREMENT.settingsFile), spec.settings, "utf8");
    }
  }
  return root;
}

/** A baseline holding ONLY the install-hardening group, so nothing else colours the result. */
function baselineFor(names: string[], requirement = REQUIREMENT) {
  return {
    title: "fixture",
    provenance: "fixture",
    repos: names,
    missingPackageJson: "skip",
    groups: {
      installHardening: {
        provenance: "fixture",
        requirements: { pnpmInstallHardening: requirement },
      },
    },
  };
}

function grade(repos: Record<string, RepoSpec>, requirement = REQUIREMENT) {
  const root = estate(repos);
  const names = Object.keys(repos);
  return gradeEstate({
    manifest: { baselines: { package: baselineFor(names, requirement) } },
    root,
    probe: () => null,
  });
}

const BOTH = `minimumReleaseAge: ${REQUIREMENT.minimumReleaseAgeMinutes}\ntrustPolicy: ${REQUIREMENT.trustPolicy}\n`;
const COOLDOWN_ONLY = `minimumReleaseAge: ${REQUIREMENT.minimumReleaseAgeMinutes}\n`;
const TRUST_ONLY = `trustPolicy: ${REQUIREMENT.trustPolicy}\n`;
const NEITHER = 'packages:\n  - "packages/*"\n';

const linesOf = (result: { findings?: { line: string }[] }) =>
  (result.findings ?? []).map((f) => f.line).join("\n");

describe("AC-3: every target is required to carry both settings, and a target missing either is drift", () => {
  it("names the missing key for each deficient repo and says nothing about the compliant one", () => {
    const results = grade({
      compliant: { settings: BOTH },
      cooldownonly: { settings: COOLDOWN_ONLY },
      trustonly: { settings: TRUST_ONLY },
      neither: { settings: NEITHER },
    });
    const by = Object.fromEntries(results.map((r) => [r.name, r]));

    expect(by.compliant.skipped).toBe(false);
    expect(by.compliant.findings).toEqual([]);

    expect(linesOf(by.cooldownonly)).toContain("trustPolicy");
    expect(linesOf(by.cooldownonly)).not.toContain("minimumReleaseAge:");

    expect(linesOf(by.trustonly)).toContain("minimumReleaseAge");
    expect(linesOf(by.trustonly)).not.toContain("trustPolicy:");

    expect(linesOf(by.neither)).toContain("minimumReleaseAge");
    expect(linesOf(by.neither)).toContain("trustPolicy");

    const summary = summarize(results);
    expect(summary).toMatchObject({ total: 4, matching: 1, drifted: 3, skipped: 0 });
  });

  it("a repo with no settings file at all is drift, and the line says what could not be graded", () => {
    const results = grade({ nofile: {} });
    expect(linesOf(results[0])).toContain(`${REQUIREMENT.settingsFile}: missing`);
    expect(linesOf(results[0])).toContain("could not be graded");
  });

  it("an UNPARSEABLE settings file is drift, never a pass by way of a syntax error", () => {
    const results = grade({
      broken: { settings: "minimumReleaseAge: 1440\ntrustPolicy: {a: 1}\n" },
    });
    expect(linesOf(results[0])).toContain("unparseable");
    expect(results[0].findings).toHaveLength(1);
  });

  it("a cooldown BELOW the floor is drift; one ABOVE it is not", () => {
    const results = grade({
      tooshort: { settings: `minimumReleaseAge: 60\ntrustPolicy: ${REQUIREMENT.trustPolicy}\n` },
      generous: { settings: `minimumReleaseAge: 10080\ntrustPolicy: ${REQUIREMENT.trustPolicy}\n` },
    });
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(linesOf(by.tooshort)).toContain("got 60");
    expect(by.generous.findings).toEqual([]);
  });

  it("the requirement is wired into the COMMITTED baseline for all thirteen package repos", () => {
    // Otherwise every assertion above grades a fixture baseline that ships nowhere.
    expect(REQUIREMENT.settingsFile).toBe("pnpm-workspace.yaml");
    expect(REQUIREMENT.minimumReleaseAgeMinutes).toBeGreaterThanOrEqual(1440);
    expect(REQUIREMENT.trustPolicy).toBe("no-downgrade");
    expect(MANIFEST.baselines.package.repos).toHaveLength(13);
    // The light baseline's own `ceiling` forbids a dependency requirement, so this must not be there.
    for (const group of Object.values(MANIFEST.baselines.light.groups) as {
      requirements: Record<string, unknown>;
    }[]) {
      expect(Object.keys(group.requirements)).not.toContain("pnpmInstallHardening");
    }
  });
});

describe("AC-6: an absent or greenfield target keeps its skip, and contributes no hardening line", () => {
  it("skips both, with the existing reason text, and grades neither", () => {
    const results = grade({
      missingrepo: { absent: true },
      greenfieldrepo: { greenfield: true },
      present: { settings: BOTH },
    });
    const by = Object.fromEntries(results.map((r) => [r.name, r]));

    expect(by.missingrepo.skipped).toBe(true);
    expect(by.missingrepo.reason).toContain("not present");
    expect(by.missingrepo.findings).toBeUndefined();

    expect(by.greenfieldrepo.skipped).toBe(true);
    expect(by.greenfieldrepo.reason).toBe("no package.json (greenfield)");
    expect(by.greenfieldrepo.findings).toBeUndefined();

    const report = formatReport(results).join("\n");
    expect(report).toContain("missingrepo: SKIP");
    expect(report).toContain("greenfieldrepo: SKIP");
    // The decisive assertion: neither skipped repo appears anywhere near a hardening line.
    for (const line of report.split("\n")) {
      if (line.includes("minimumReleaseAge") || line.includes("trustPolicy")) {
        expect(line).not.toContain("missingrepo");
        expect(line).not.toContain("greenfieldrepo");
      }
    }
    expect(summarize(results)).toMatchObject({ skipped: 2, matching: 1, drifted: 0 });
  });

  it("an EMPTY directory is an uninitialized submodule, still skipped and still not graded", () => {
    const root = mkdtempSync(join(tmpdir(), "drift-hardening-empty-"));
    roots.push(root);
    mkdirSync(join(root, "emptyrepo"));
    const result = evaluateRepo({
      name: "emptyrepo",
      baselineName: "package",
      baseline: baselineFor(["emptyrepo"]),
      root,
      probe: () => null,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("not checked out");
  });
});

describe("AC-7: change the baseline value, re-grade with no code change, and the line says what was wanted", () => {
  it("a target carrying the OLD value becomes drift, and the printed line states the new requirement", () => {
    const carriesOld = {
      old: { settings: `minimumReleaseAge: 1440\ntrustPolicy: ${REQUIREMENT.trustPolicy}\n` },
    };

    // Same checker, same tree, ONLY the manifest value changes.
    const before = grade(carriesOld, REQUIREMENT);
    expect(before[0].findings).toEqual([]);

    const raised = { ...REQUIREMENT, minimumReleaseAgeMinutes: 4320 };
    const after = grade(carriesOld, raised);
    expect(after[0].findings).toHaveLength(1);
    expect(linesOf(after[0])).toContain("want at least 4320");
    expect(linesOf(after[0])).toContain("got 1440");

    // And the report a human reads carries the required value too, not only the object.
    expect(formatReport(after).join("\n")).toContain("want at least 4320");
  });

  it("the same holds for the trust policy: the line names the value the baseline required", () => {
    const results = grade(
      { drifted: { settings: "minimumReleaseAge: 1440\ntrustPolicy: off\n" } },
      REQUIREMENT,
    );
    expect(linesOf(results[0])).toContain(`want "${REQUIREMENT.trustPolicy}"`);
    expect(linesOf(results[0])).toContain('got "off"');
  });

  it("a different settings FILE is honoured too, so the baseline decides where to look", () => {
    const requirement = { ...REQUIREMENT, settingsFile: "elsewhere.yaml" };
    const root = mkdtempSync(join(tmpdir(), "drift-hardening-file-"));
    roots.push(root);
    mkdirSync(join(root, "elsewhererepo"));
    writeFileSync(join(root, "elsewhererepo", "package.json"), "{}", "utf8");
    writeFileSync(join(root, "elsewhererepo", "elsewhere.yaml"), BOTH, "utf8");
    const result = evaluateRepo({
      name: "elsewhererepo",
      baselineName: "package",
      baseline: baselineFor(["elsewhererepo"], requirement),
      root,
      probe: () => null,
    });
    expect(result.findings).toEqual([]);
  });
});
