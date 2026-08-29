/**
 * Grades CONFIG AS A SUBJECT of the standard config publishes.
 *
 * THE STATE THIS SLICE FOUND. `drift-manifest.json` named thirteen package repos and eleven light
 * ones and graded config only for three workflow requirements; nothing anywhere read config's own
 * package.json against the dependency rules the same file declares. So the repository that writes
 * the baseline was the one repository the baseline had no opinion about, and its own
 * `pnpm.overrides` had drifted away from the manifest's in both the range and the pinned version
 * with no test comparing them.
 *
 * WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. The mechanism is asserted here: that config is
 * graded, that a rule it is not held to must be NAMED in the manifest with a reason, that an
 * exemption naming a rule the baseline does not carry is itself drift, and that an unreadable
 * package.json refuses the run instead of clearing it. Whether the real repository passes today is
 * asserted once, over the real files, at the bottom; the cases in between build their own throwaway
 * estates so that a change to this checkout cannot silently turn a mechanism test into a tautology.
 *
 * OFFLINE: no network and no sibling checkout. Every case supplies its own inputs, and
 * `test/no-network.setup.ts` refuses `fetch` and DNS for the whole root suite, so that is a refusal
 * rather than a habit.
 *
 * SECURITY / PHI: every fixture written here is synthetic.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  configSubjectFileProblem,
  configSubjectRules,
  formatConfigSubject,
  gradeConfigSubject,
  runCheck,
} from "../scripts/drift-check.js";
import { DEFAULT_MANIFEST, DEFAULT_SCHEMA } from "../scripts/validate-drift-manifest.mjs";

const REPO_ROOT = process.cwd();
const RAW_MANIFEST = readFileSync(DEFAULT_MANIFEST, "utf8");
const MANIFEST = JSON.parse(RAW_MANIFEST) as Record<string, any>;
const FIXTURES = join(REPO_ROOT, "test", "fixtures", "advisories");

const NO_PROBE = () => null;
const CONTROLS_PASS = () => [];

/**
 * The advisory lookup, already done, from the records committed under `test/fixtures/advisories`.
 *
 * This suite is about the SUBJECT and not about the lookup, but a run with no lookup leaves every
 * citation INCONCLUSIVE, which is a drift and would mask the thing each case is measuring. Handing
 * in the real records keeps the cases about what they are about, and keeps the suite offline.
 */
function fixtureAdvisories(): Map<string, unknown> {
  const advisories = new Map<string, unknown>();
  for (const id of ["GHSA-5p4m-2wfm-xmqj", "GHSA-h67p-54hq-rp68", "GHSA-g7r4-m6w7-qqqr"]) {
    advisories.set(id, {
      url: `test/fixtures/advisories/osv-${id}.json`,
      ok: true,
      record: JSON.parse(readFileSync(join(FIXTURES, `osv-${id}.json`), "utf8")),
    });
  }
  return advisories;
}

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-self-grade-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/** The overrides the shipped manifest declares, so a fixture repo can agree or disagree on purpose. */
function shippedOverrides(): Record<string, string> {
  return MANIFEST["baselines"].package.groups.dependencies.requirements.pnpmOverrides;
}

/**
 * A throwaway umbrella root holding a `config/` that satisfies every rule the subject grades.
 *
 * Everything a case wants to break, it breaks by passing a replacement file.
 */
function umbrellaWithConfig(files: Record<string, string> = {}): string {
  const root = tempDir();
  const contents: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: "cosyte-config",
        private: true,
        packageManager: "pnpm@10.34.5",
        engines: { node: ">=22.14" },
        prettier: "@cosyte/prettier-config",
        pnpm: { overrides: shippedOverrides() },
        scripts: { changeset: "changeset", release: "changeset publish" },
        devDependencies: {
          "@changesets/cli": "2.31.0",
          "@cosyte/tsconfig": "workspace:*",
          "@cosyte/eslint-config": "workspace:*",
          "@cosyte/prettier-config": "workspace:*",
          "@cosyte/tsup-config": "workspace:*",
          "@cosyte/vitest-config": "workspace:*",
        },
      },
      null,
      2,
    ),
    ".changeset/config.json": JSON.stringify({ access: "public", baseBranch: "main" }),
    "pnpm-lock.yaml":
      "lockfileVersion: '9.0'\n\npackages:\n\n  js-yaml@3.15.1: {}\n\n  js-yaml@4.3.1: {}\n\n  esbuild@0.28.1: {}\n",
    // The LIGHT baseline holds config as well and asks for these four by name. They are empty
    // because only the filenames are graded, and they are here so that a case measuring the SUBJECT
    // is not reading a light-baseline drift by accident.
    ".github/workflows/ci.yml": "",
    ".github/workflows/no-emdash.yml": "",
    ".github/workflows/codeql.yml": "",
    ".github/workflows/scorecard.yml": "",
    ...files,
  };
  for (const [rel, text] of Object.entries(contents)) {
    const abs = join(root, "config", ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
  return root;
}

/** Write a manifest variant to a temp file and hand back its path. */
function manifestFile(mutate: (draft: Record<string, any>) => void): string {
  const draft = JSON.parse(RAW_MANIFEST) as Record<string, any>;
  mutate(draft);
  draft["$schema"] = DEFAULT_SCHEMA;
  const path = join(tempDir(), "drift-manifest.json");
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8");
  return path;
}

function subjectOf(root: string, subject: Record<string, any> = MANIFEST) {
  return gradeConfigSubject({
    manifest: subject,
    root,
    probe: NO_PROBE,
    advisories: fixtureAdvisories() as never,
  }) as {
    skipped: boolean;
    reason?: string;
    exempt: string[];
    findings: { group: string; line: string }[];
  };
}

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

// ---------------------------------------------------------------------------

describe("AC1: config's own package.json is graded against drift-manifest.json", () => {
  it("reports a divergence between the two override blocks as drift, naming both values", () => {
    // The measured defect, rebuilt: the manifest says one thing, config's own manifest says
    // another, and until this slice nothing compared them.
    const stale = { ...shippedOverrides(), "js-yaml@>=4.0.0 <4.3.1": "4.2.0" };
    const root = umbrellaWithConfig({
      "package.json": JSON.stringify({
        name: "cosyte-config",
        packageManager: "pnpm@10.34.5",
        engines: { node: ">=22.14" },
        prettier: "@cosyte/prettier-config",
        pnpm: { overrides: stale },
        scripts: { changeset: "changeset", release: "changeset publish" },
        devDependencies: {
          "@changesets/cli": "2.31.0",
          "@cosyte/tsconfig": "workspace:*",
          "@cosyte/eslint-config": "workspace:*",
          "@cosyte/prettier-config": "workspace:*",
          "@cosyte/tsup-config": "workspace:*",
          "@cosyte/vitest-config": "workspace:*",
        },
      }),
    });

    const graded = subjectOf(root);
    const lines = graded.findings.map((f) => f.line);
    expect(graded.skipped).toBe(false);
    expect(lines.join("\n")).toContain('pnpm.overrides["js-yaml@>=4.0.0 <4.3.1"]');
    expect(lines.join("\n")).toContain('want "4.3.1", got "4.2.0"');
  });

  it("grades the rest of the package baseline too, not the overrides alone", () => {
    const root = umbrellaWithConfig({
      "package.json": JSON.stringify({
        name: "cosyte-config",
        packageManager: "npm@10",
        engines: { node: ">=18" },
        pnpm: { overrides: shippedOverrides() },
      }),
    });
    const lines = subjectOf(root)
      .findings.map((f) => `${f.group}: ${f.line}`)
      .join("\n");
    expect(lines).toContain("packageManager: want pnpm@10.x");
    expect(lines).toContain("engines.node: want >=22");
    expect(lines).toContain("prettier: want");
    expect(lines).toContain("devDep @cosyte/tsconfig: missing");
    expect(lines).toContain("scripts.changeset: missing");
  });

  it("prints config's result in the same report the estate appears in", () => {
    const root = umbrellaWithConfig();
    const io = capture();
    runCheck({
      root,
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).toContain("CONFIG AS THE STANDARD'S OWN SUBJECT");
    expect(printed).toContain("BASELINE package (13 repo(s))");
    expect(printed).toContain("BASELINE light (11 repo(s))");
  });
});

describe("AC4: a rule config is not held to must be NAMED in the manifest", () => {
  it("grades every rule of the named baseline that no exemption covers", () => {
    const { baseline, exempt } = configSubjectRules(MANIFEST) as {
      baseline: Record<string, any>;
      exempt: string[];
    };
    const graded: string[] = [];
    for (const [groupName, group] of Object.entries<any>(baseline.groups)) {
      for (const kind of Object.keys(group.requirements)) graded.push(`${groupName}.${kind}`);
    }
    const declared: string[] = [];
    for (const [groupName, group] of Object.entries<any>(MANIFEST["baselines"].package.groups)) {
      for (const kind of Object.keys(group.requirements)) declared.push(`${groupName}.${kind}`);
    }
    // Every declared rule is either graded or exempt, and never both. There is no third bucket:
    // that is what stops a rule going ungraded without anyone deciding it should.
    expect([...graded, ...exempt].sort()).toEqual([...declared].sort());
    expect(graded.filter((rule) => exempt.includes(rule))).toEqual([]);
    expect(exempt.length).toBeGreaterThan(0);
    expect(graded.length).toBeGreaterThan(0);
  });

  it("makes every exemption carry a reason, and prints every one in the report", () => {
    for (const entry of MANIFEST["configSubject"].exemptions) {
      expect(entry.rule).toMatch(/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/);
      expect(entry.why.length, entry.rule).toBeGreaterThanOrEqual(40);
    }
    const printed = formatConfigSubject(subjectOf(umbrellaWithConfig()) as never).join("\n");
    for (const entry of MANIFEST["configSubject"].exemptions) {
      expect(printed, `${entry.rule} is not visible in the report`).toContain(
        `exempt: ${entry.rule}`,
      );
    }
  });

  it("REPORTS an exemption that names no rule the baseline carries as drift", () => {
    const invented = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    invented["configSubject"].exemptions.push({
      rule: "toolchain.somethingNobodyRequires",
      why: "an exemption for a requirement that does not exist, which must not read as a pass",
    });
    const graded = subjectOf(umbrellaWithConfig(), invented);
    const line = graded.findings.map((f) => f.line).join("\n");
    expect(line).toContain('"toolchain.somethingNobodyRequires" names no rule');
    expect(graded.exempt).not.toContain("toolchain.somethingNobodyRequires");
  });

  it("REPORTS an exemption that outlived the requirement it excused", () => {
    // The same failure arriving the other way round: the rule is deleted from the baseline and the
    // exemption is left behind. Without this the list would quietly excuse nothing forever.
    const orphaned = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    delete orphaned["baselines"].package.groups.scripts.requirements.lintMustInclude;
    const line = subjectOf(umbrellaWithConfig(), orphaned)
      .findings.map((f) => f.line)
      .join("\n");
    expect(line).toContain('"scripts.lintMustInclude" names no rule');
  });

  it("stops grading a rule the moment an exemption for it is added, and no sooner", () => {
    const root = umbrellaWithConfig({
      // No tsconfig.json, which the sharedConfig.tsconfigExtends rule wants.
      "package.json": readFileSync(join(umbrellaWithConfig(), "config", "package.json"), "utf8"),
    });
    const held = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    held["configSubject"].exemptions = held["configSubject"].exemptions.filter(
      (e: { rule: string }) => e.rule !== "sharedConfig.tsconfigExtends",
    );
    expect(
      subjectOf(root, held)
        .findings.map((f) => f.line)
        .join("\n"),
    ).toContain("tsconfig.json: missing");
    // And with the shipped declaration, which does excuse it, the same tree is silent about it.
    expect(
      subjectOf(root)
        .findings.map((f) => f.line)
        .join("\n"),
    ).not.toContain("tsconfig.json: missing");
  });

  it("refuses to grade against a baseline the manifest does not declare", () => {
    const wrong = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    wrong["configSubject"].baseline = "nosuchbaseline";
    const line = subjectOf(umbrellaWithConfig(), wrong)
      .findings.map((f) => f.line)
      .join("\n");
    expect(line).toContain("nosuchbaseline");
    expect(line).toContain("nothing to grade config against");
  });

  it("keeps config OUT of the package baseline's repo roster while grading it by that baseline", () => {
    // The roster is what the phi-scan probe iterates and what an existing suite reads as the parser
    // list. Grading the author must not be achieved by pretending it is a parser.
    expect(MANIFEST["baselines"].package.repos).not.toContain("config");
    expect(MANIFEST["baselines"].light.repos).toContain("config");
    expect(MANIFEST["configSubject"].baseline).toBe("package");
  });
});

describe("AC8: an unreadable manifest or package.json refuses the run", () => {
  it("exits non-zero naming config/package.json when it is present and unparseable", () => {
    const root = umbrellaWithConfig({ "package.json": "{ this is not json" });
    const io = capture();
    const code = runCheck({
      root,
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    // NO VERDICT was printed: a syntax error must not clear the standard's author. The probe's
    // status line is there because the controls run FIRST and passing them is not a verdict about
    // any repo, which is the ordering AC13 pins.
    expect(io.out).toEqual([
      "phi-scan capability probe: controls pass (shipped template ok, rule removed reds)",
    ]);
    const refusal = io.err.join("\n");
    expect(refusal).toContain("config/package.json");
    expect(refusal).toContain("unparseable");
    expect(refusal).not.toContain("matches");
  });

  it("exits non-zero naming config/package.json when config carries none at all", () => {
    const root = tempDir();
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config", "README.md"), "# config\n", "utf8");
    const io = capture();
    const code = runCheck({
      root,
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("config/package.json: missing");
  });

  it("exits non-zero naming drift-manifest.json when the manifest cannot be parsed", () => {
    const path = join(tempDir(), "drift-manifest.json");
    writeFileSync(path, "{ not a manifest", "utf8");
    const io = capture();
    const code = runCheck({
      manifestPath: path,
      root: umbrellaWithConfig(),
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain(path);
    expect(io.err.join("\n")).toMatch(/not parseable JSON/);
  });

  it("exits non-zero when the manifest parses but does not match its schema", () => {
    const path = manifestFile((draft) => {
      delete draft["configSubject"].exemptions;
    });
    const io = capture();
    const code = runCheck({
      manifestPath: path,
      root: umbrellaWithConfig(),
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain('configSubject: missing required property "exemptions"');
  });

  it("does NOT refuse merely because config is not checked out beside the root", () => {
    // An absent repo is skipped with a reason, which is this checker's policy for every repo and
    // is not the same failure as a broken file. The refusal above must not swallow it.
    expect(configSubjectFileProblem(tempDir())).toBe(null);
  });
});

describe("AC9: a run with no sibling target repo still grades config and prints its result", () => {
  it("grades config and says so, rather than reporting only skips", () => {
    const root = umbrellaWithConfig();
    const io = capture();
    const code = runCheck({
      root,
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).toContain("✓ config: matches the baseline it publishes");
    expect(printed).toContain("• hl7: SKIP");
    // The estate said nothing about anyone, and the run still has a verdict about config, so this
    // is NOT the "nothing was graded" refusal.
    expect(io.err.join("\n")).not.toContain("nothing was graded");
    expect(code).toBe(0);
  });

  it("still refuses when config is not there either, since then nothing was read", () => {
    const io = capture();
    const code = runCheck({
      root: tempDir(),
      advisories: fixtureAdvisories() as never,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("nothing was graded");
    expect(io.out.join("\n")).toContain("config: SKIP");
  });
});

describe("AC10: this repository, as it stands, matches the baseline it publishes", () => {
  it("grades the real config checkout against the real manifest with no findings", () => {
    // The one case that reads the real files. It is the claim AC10 makes, and it is deliberately
    // the last thing in this suite: everything above proves the mechanism can fail.
    const graded = gradeConfigSubject({
      manifest: MANIFEST,
      root: dirname(REPO_ROOT),
      probe: NO_PROBE,
      // The committed records, so the pins AND the lockfile this repository actually resolves are
      // both graded here, with no request made.
      advisories: fixtureAdvisories() as never,
    }) as {
      skipped: boolean;
      reason?: string;
      findings: { group: string; line: string }[];
    };

    if (graded.skipped) {
      // config's own CI checks out the repo alone, so there is no umbrella parent to resolve. The
      // claim is unassertable there rather than false, and saying so beats a silent pass.
      expect(graded.reason).toContain("not present");
      return;
    }
    expect(graded.findings.map((f) => `${f.group}: ${f.line}`)).toEqual([]);
  });
});
