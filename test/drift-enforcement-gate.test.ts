/**
 * THE DRIFT CHECK IS NOW A GATE, AND THIS SUITE GRADES THE FAILURE IT GAINED AND THE ONES IT KEPT.
 *
 * THE FAILURE IT GAINED. A repo the standard declares BINDING is a repo the run is a verdict ABOUT.
 * Absent, present and empty, or present and unreadable, the checker used to report it `SKIP` and the
 * run could still exit 0: a corpus holding one green repo and missing the other twenty-three was a
 * green. That is the hole a gate wired to this would have inherited, and it is what AC6 closes.
 *
 * THE FAILURES IT KEPT, WHICH MATTER JUST AS MUCH. The declaration only ever ADDS a failure. A
 * DEFERRED repo present with drift still reds the run through the ordinary worklist, because
 * deferral is exclusion from a corpus rather than forgiveness; and all three exit-2 refusals (a
 * manifest that does not validate, a phi-scan probe whose controls misbehave, config's own
 * package.json present and unparseable) still grade nothing and still refuse.
 *
 * THE CONTROLS ARE THE BLAST RADIUS AND ARE TREATED AS SUCH. `scripts/drift-check.js` holds the
 * phi-scan capability probe whose two controls gate the WHOLE report; if they could be made vacuous,
 * thirteen PHI assertions would become silent passes and a green gate would be evidence of nothing.
 * So the cases below do not merely assert that the controls pass today: each misbehaviour is
 * SIMULATED and required to refuse, and the generic grader behind them is required to red on each,
 * so a control that cannot fail cannot hide here.
 *
 * OFFLINE BY CONSTRUCTION. Every case builds its own throwaway estate and drives `runCheck` through
 * its `root`, `controls`, `probe`, `advisories`, `out` and `err` injection points. No sibling
 * checkout is read and no request is made; the advisory records come from `test/fixtures/advisories`.
 *
 * SECURITY / PHI: no real repository is read and every fixture written here is synthetic.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  enforcementFrom,
  formatReport,
  gradeEstate,
  gradeProbeControls,
  runCheck,
  ungradedBinding,
} from "../scripts/drift-check.js";
import { DEFAULT_MANIFEST, DEFAULT_SCHEMA } from "../scripts/validate-drift-manifest.mjs";

const REPO_ROOT = process.cwd();
const RAW_MANIFEST = readFileSync(DEFAULT_MANIFEST, "utf8");
const MANIFEST = JSON.parse(RAW_MANIFEST) as Record<string, any>;
const FIXTURES = join(REPO_ROOT, "test", "fixtures", "advisories");

const ESTATE: string[] = MANIFEST["estate"].submodulePaths;
const ENFORCEMENT = MANIFEST["enforcement"] as {
  binding: string[];
  deferred: Record<string, { why: string }>;
};

/** A deferred PACKAGE-baseline repo, used everywhere a case needs one to promote. */
const PROMOTABLE = "hl7";

const NO_PROBE = () => null;
const CONTROLS_PASS = () => [];

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-enforcement-gate-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/**
 * The advisory lookup, already done, from the records committed under `test/fixtures/advisories`.
 *
 * A run with no lookup leaves every citation INCONCLUSIVE, which is a drift of the config subject
 * and would red every case here for a reason none of them is about. Handing in the real records
 * keeps each case about what it is about, and keeps the suite offline.
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

/** The install-hardening settings file the shipped standard asks for, from the standard's numbers. */
function shippedHardeningSettings(): string {
  const want = MANIFEST["baselines"].package.groups.installHardening.requirements
    .pnpmInstallHardening as { minimumReleaseAgeMinutes: number; trustPolicy: string };
  return (
    `packages:\n  - "packages/*"\n\n` +
    `minimumReleaseAge: ${want.minimumReleaseAgeMinutes}\ntrustPolicy: ${want.trustPolicy}\n`
  );
}

function writeRepo(root: string, name: string, files: Record<string, string>): string {
  const repoDir = join(root, name);
  mkdirSync(repoDir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(repoDir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
  return repoDir;
}

/**
 * A throwaway umbrella root holding a `config/` that satisfies every rule the subject grades, and
 * whatever else a case asks for. This is the shape AC12 names: the repository at `<root>/config`
 * with every other estate repo absent.
 */
function umbrellaWithConfig(others: Record<string, Record<string, string>> = {}): string {
  const root = tempDir();
  writeRepo(root, "config", {
    "package.json": JSON.stringify(
      {
        name: "cosyte-config",
        private: true,
        packageManager: "pnpm@10.34.5",
        engines: { node: ">=22.14" },
        prettier: "@cosyte/prettier-config",
        pnpm: {
          overrides: MANIFEST["baselines"].package.groups.dependencies.requirements.pnpmOverrides,
        },
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
    "pnpm-workspace.yaml": shippedHardeningSettings(),
    "pnpm-lock.yaml":
      "lockfileVersion: '9.0'\n\npackages:\n\n  js-yaml@3.15.1: {}\n\n  js-yaml@4.3.1: {}\n\n  esbuild@0.28.1: {}\n",
    // The light baseline holds config too and asks for these four by name. Empty because only the
    // filenames are graded.
    ".github/workflows/ci.yml": "",
    ".github/workflows/no-emdash.yml": "",
    ".github/workflows/codeql.yml": "",
    ".github/workflows/scorecard.yml": "",
  });
  for (const [name, files] of Object.entries(others)) writeRepo(root, name, files);
  return root;
}

/** A package-baseline repo that is present and definitely drifted. */
const DRIFTED_PACKAGE_REPO = {
  "package.json": JSON.stringify({ name: "@cosyte/fixture", packageManager: "npm@10" }),
};

/** Write a mutated copy of the shipped manifest and hand back its path. */
function manifestFile(mutate: (draft: Record<string, any>) => void): string {
  const draft = JSON.parse(RAW_MANIFEST) as Record<string, any>;
  mutate(draft);
  draft["$schema"] = DEFAULT_SCHEMA;
  const path = join(tempDir(), "drift-manifest.json");
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8");
  return path;
}

/**
 * The ONE edit AC13 is about: move a repo from `deferred` into `binding`, changing the standard and
 * nothing else. No JavaScript file is touched by this and none is reloaded.
 */
function promoting(repo: string): string {
  return manifestFile((draft) => {
    draft["enforcement"].binding = [...draft["enforcement"].binding, repo];
    delete draft["enforcement"].deferred[repo];
  });
}

type Run = { code: number; out: string; err: string; lines: string[] };

function gate(options: Record<string, unknown> = {}): Run {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCheck({
    root: tempDir(),
    advisories: fixtureAdvisories() as never,
    controls: CONTROLS_PASS,
    probe: NO_PROBE,
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    ...options,
  }) as unknown as number;
  return { code, out: out.join("\n"), err: err.join("\n"), lines: out };
}

// ---------------------------------------------------------------------------
// The baseline behaviour the whole suite is measured against.
// ---------------------------------------------------------------------------

describe("AC12: config alone in the corpus, and config the only binding repo, exits 0", () => {
  it("exits 0 over an estate holding this repository and nothing else", () => {
    const r = gate({ root: umbrellaWithConfig() });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ config: matches the baseline it publishes");
    // Every other estate repo is absent and DEFERRED, which is exactly the state the declaration
    // exists to state out loud rather than leave to a silent SKIP.
    expect(r.out).toContain(`• ${PROMOTABLE}: SKIP`);
  });
});

// ---------------------------------------------------------------------------
// AC5: a binding repo that drifts reds the run.
// ---------------------------------------------------------------------------

describe("AC5: a BINDING repo carrying drift exits 1", () => {
  it("reds when the sole binding repo, config, carries a drift", () => {
    const root = umbrellaWithConfig();
    // config's own package.json disagreeing with the standard it publishes is a drift of the
    // subject, and the subject is the binding repo here.
    writeFileSync(
      join(root, "config", "package.json"),
      JSON.stringify({ name: "cosyte-config", packageManager: "npm@10" }),
      "utf8",
    );
    const r = gate({ root });
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ config:");
  });

  it("reds when a repo PROMOTED into the binding set is present and drifted", () => {
    const root = umbrellaWithConfig({ [PROMOTABLE]: DRIFTED_PACKAGE_REPO });
    // Before the promotion the same corpus reds too, through the ordinary worklist (AC7).
    expect(gate({ root }).code).toBe(1);
    const r = gate({ root, manifestPath: promoting(PROMOTABLE) });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ ${PROMOTABLE}:`);
    expect(r.out).toContain(`  ${PROMOTABLE} (package baseline):`);
  });
});

// ---------------------------------------------------------------------------
// AC6: the failure this item exists to create.
// ---------------------------------------------------------------------------

describe("AC6: a BINDING repo the run reached no verdict about is a named failure", () => {
  it("was a SKIP that still exited 0 before this change, over the very same corpus", () => {
    // THE BEFORE STATE, asserted rather than described. With the shipped standard, hl7 is DEFERRED
    // and absent, the run reports it SKIP, and the run is green.
    const before = gate({ root: umbrellaWithConfig() });
    expect(before.code).toBe(0);
    expect(before.out).toContain(`• ${PROMOTABLE}: SKIP (not present:`);
  });

  it("reds and names the repo when a BINDING repo is ABSENT from the corpus", () => {
    const r = gate({ root: umbrellaWithConfig(), manifestPath: promoting(PROMOTABLE) });
    expect(r.code).not.toBe(0);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `✗ ${PROMOTABLE}: BINDING, and NO VERDICT was reached for it (not present:`,
    );
    expect(r.err).toContain(
      `✗ ${PROMOTABLE} is declared BINDING and no verdict was reached for it`,
    );
  });

  it("reds and names the repo when a BINDING repo is PRESENT AND EMPTY", () => {
    // An uninitialized submodule leaves a bare mount point behind, which is the umbrella's ordinary
    // state and the likeliest way a corpus silently loses a repo.
    const root = umbrellaWithConfig();
    mkdirSync(join(root, PROMOTABLE), { recursive: true });
    const r = gate({ root, manifestPath: promoting(PROMOTABLE) });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ ${PROMOTABLE}: BINDING, and NO VERDICT was reached for it`);
    expect(r.out).toContain("an uninitialized submodule");
  });

  it("reds and names the repo when a BINDING repo is PRESENT but nothing in it could be read", () => {
    // A package-baseline repo with no package.json is skipped as greenfield: present, and still no
    // verdict. Deferred that is a skip; binding it is a failure.
    const root = umbrellaWithConfig({ [PROMOTABLE]: { "README.md": "# fixture\n" } });
    expect(gate({ root }).code).toBe(0);
    const r = gate({ root, manifestPath: promoting(PROMOTABLE) });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ ${PROMOTABLE}: BINDING, and NO VERDICT was reached for it`);
    expect(r.out).toContain("greenfield");
  });

  it("reds when a BINDING repo is present and its package.json is unreadable", () => {
    const root = umbrellaWithConfig({ [PROMOTABLE]: { "package.json": "{ broken" } });
    const r = gate({ root, manifestPath: promoting(PROMOTABLE) });
    expect(r.code).toBe(1);
    expect(r.out).toContain("package.json: unparseable");
    expect(r.out).not.toContain(`✓ ${PROMOTABLE}`);
  });

  it("says NO VERDICT rather than anything a reader could mistake for a pass", () => {
    const r = gate({ root: umbrellaWithConfig(), manifestPath: promoting(PROMOTABLE) });
    const line = r.lines.find((l) => l.includes(`${PROMOTABLE}: BINDING`))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/matches|satisfies|clean/i);
  });

  it("is decided per repo, so a graded binding repo beside an ungraded one still reds", () => {
    const ungraded = ungradedBinding(
      ["config", PROMOTABLE],
      gradeEstate({
        manifest: MANIFEST,
        root: umbrellaWithConfig(),
        probe: NO_PROBE,
      }) as never,
    ) as { name: string }[];
    expect(ungraded.map((entry) => entry.name)).toEqual([PROMOTABLE]);
  });

  it("names a binding repo no baseline holds rather than passing over it in silence", () => {
    const ungraded = ungradedBinding(["nosuchrepo"], []) as { name: string; reason: string }[];
    expect(ungraded.map((entry) => entry.name)).toEqual(["nosuchrepo"]);
    expect(ungraded[0]!.reason).toContain("never looked for it");
  });
});

// ---------------------------------------------------------------------------
// AC7: the declaration adds failures and never subtracts one.
// ---------------------------------------------------------------------------

describe("AC7: a DEFERRED repo present with drift still reds, exactly as before", () => {
  it("reports it in the WORKLIST and exits 1", () => {
    const root = umbrellaWithConfig({ [PROMOTABLE]: DRIFTED_PACKAGE_REPO });
    const r = gate({ root });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ ${PROMOTABLE}:`);
    expect(r.out).toContain("WORKLIST (what each repo owes, in manifest order)");
    expect(r.out).toContain(`  ${PROMOTABLE} (package baseline):`);
  });

  it("is deferred and NOT forgiven: the report says both things about the same repo", () => {
    const root = umbrellaWithConfig({ [PROMOTABLE]: DRIFTED_PACKAGE_REPO });
    const r = gate({ root });
    expect(r.out).toContain(`  ${PROMOTABLE}: DEFERRED,`);
    expect(r.out).toContain(`  ${PROMOTABLE} (package baseline):`);
  });

  it("keeps every red the checker produced before the declaration existed", () => {
    // The same corpus graded with the enforcement block stripped out of the manifest entirely:
    // the estate verdicts and the exit code are unchanged, so nothing was subtracted.
    const root = umbrellaWithConfig({ [PROMOTABLE]: DRIFTED_PACKAGE_REPO });
    const results = gradeEstate({ manifest: MANIFEST, root, probe: NO_PROBE }) as {
      name: string;
      skipped: boolean;
      findings?: unknown[];
    }[];
    const drifted = results.filter((r) => !r.skipped && (r.findings ?? []).length > 0);
    expect(drifted.map((r) => r.name)).toEqual([PROMOTABLE]);
    expect(gate({ root }).code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC8: the report states who binds and who does not, with reasons.
// ---------------------------------------------------------------------------

describe("AC8: the report prints the binding set and every deferral with its reason", () => {
  it("prints the binding set from a real run", () => {
    const r = gate({ root: umbrellaWithConfig() });
    expect(r.out).toMatch(/ENFORCEMENT \(declared in drift-manifest\.json/);
    expect(r.out).toContain(
      `  BINDING (${ENFORCEMENT.binding.length}): ${ENFORCEMENT.binding.join(", ")}`,
    );
  });

  it("prints every deferred repo and that repo's own reason, not a count", () => {
    const r = gate({ root: umbrellaWithConfig() });
    const deferred = Object.entries(ENFORCEMENT.deferred);
    expect(deferred.length).toBe(ESTATE.length - ENFORCEMENT.binding.length);
    for (const [repo, entry] of deferred) {
      expect(r.out, `${repo} is not visible in the report`).toContain(
        `  ${repo}: DEFERRED, ${entry.why}`,
      );
    }
  });

  it("reports the manifest it was POINTED AT, never the one the module imported", () => {
    const r = gate({ root: umbrellaWithConfig(), manifestPath: promoting(PROMOTABLE) });
    expect(r.out).toContain(`  BINDING (2): config, ${PROMOTABLE}`);
    expect(r.out).not.toContain(`  ${PROMOTABLE}: DEFERRED,`);
  });

  it("says so plainly when a manifest declares no deferral at all", () => {
    const everything = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    everything["enforcement"].binding = [...ESTATE];
    everything["enforcement"].deferred = {};
    const report = formatReport(
      [],
      everything["optionalWorkflows"],
      [],
      enforcementFrom(everything) as never,
    ).join("\n");
    expect(report).toContain("  DEFERRED: none; every repo the estate carries binds");
  });

  it("says so plainly when a manifest binds nobody, rather than printing an empty line", () => {
    // Unreachable through the schema, which refuses an empty binding set. Printed anyway, because a
    // formatter that renders an invalid state as blank is how a reader learns nothing.
    const report = formatReport([], MANIFEST["optionalWorkflows"], [], {
      binding: [],
      deferred: [],
    } as never).join("\n");
    expect(report).toContain("  BINDING: none declared");
  });
});

// ---------------------------------------------------------------------------
// AC9: every exit-2 refusal is preserved, and 2 is a failure.
// ---------------------------------------------------------------------------

describe("AC9: nothing was graded still means exit 2, and exit 2 is not a pass", () => {
  it("refuses a manifest that does not match its schema, grading nothing", () => {
    const path = manifestFile((draft) => {
      delete draft["configSubject"].exemptions;
    });
    const r = gate({ root: umbrellaWithConfig(), manifestPath: path });
    expect(r.code).toBe(2);
    expect(r.lines).toEqual([]);
    expect(r.err).toContain('configSubject: missing required property "exemptions"');
  });

  it("refuses when the phi-scan probe's controls misbehave, grading nothing", () => {
    const r = gate({
      root: umbrellaWithConfig(),
      controls: () => ["POSITIVE CONTROL (phi-scan completeness) is vacuous: fabricated"],
    });
    expect(r.code).toBe(2);
    expect(r.lines).toEqual([]);
    expect(r.err).toContain("cannot be trusted, so nothing was graded");
  });

  it("refuses when config's own package.json is present and unparseable, grading nothing", () => {
    const root = umbrellaWithConfig();
    writeFileSync(join(root, "config", "package.json"), "{ this is not json", "utf8");
    const r = gate({ root });
    expect(r.code).toBe(2);
    expect(r.lines).toEqual([
      "phi-scan capability probe: controls pass (shipped template ok, rule removed reds)",
    ]);
    expect(r.err).toContain("config/package.json");
    expect(r.err).toContain("unparseable");
  });

  it("still refuses a run that read nothing at all, ahead of the binding check", () => {
    const r = gate({ root: tempDir() });
    expect(r.code).toBe(2);
    expect(r.err).toContain("nothing was graded");
  });

  it("never reports 0 for any of them, which is what the CI step's exit status consumes", () => {
    const refusals = [
      gate({
        root: umbrellaWithConfig(),
        manifestPath: manifestFile((draft) => {
          delete draft["configSubject"].exemptions;
        }),
      }),
      gate({ root: umbrellaWithConfig(), controls: () => ["fabricated control failure"] }),
      gate({ root: tempDir() }),
    ];
    for (const r of refusals) expect(r.code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC10: the probe's controls gate the whole report and cannot be made vacuous here.
// ---------------------------------------------------------------------------

describe("AC10: a misbehaving control refuses to report on any repo", () => {
  const MISBEHAVIOURS: [string, () => string[]][] = [
    ["the negative control failed", () => ["NEGATIVE CONTROL (phi-scan completeness): got drift"]],
    [
      "the positive control was vacuous",
      () => ["POSITIVE CONTROL (phi-scan completeness) is vacuous: x"],
    ],
    [
      "the positive control did not red",
      () => ["POSITIVE CONTROL (phi-scan completeness): got ok"],
    ],
  ];

  it.each(MISBEHAVIOURS)("refuses and grades nothing when %s", (_label, controls) => {
    // The corpus is the one that otherwise exits 0, so the ONLY thing under test is the control.
    const r = gate({ root: umbrellaWithConfig(), controls });
    expect(r.code).toBe(2);
    expect(r.lines).toEqual([]);
    for (const repo of ESTATE) expect(r.out).not.toContain(repo);
  });

  it("cannot reach exit 0 with a misbehaving control, whatever the binding set says", () => {
    for (const [, controls] of MISBEHAVIOURS) {
      for (const manifestPath of [undefined, promoting(PROMOTABLE)]) {
        const r = gate({
          root: umbrellaWithConfig(),
          controls,
          ...(manifestPath ? { manifestPath } : {}),
        });
        expect(r.code).toBe(2);
      }
    }
  });

  it("keeps the generic control grader able to FAIL, which is what makes it evidence", () => {
    const ok = () => ({ status: "ok", detail: "shipped" });
    const drift = () => ({ status: "drift", detail: "weakened" });
    // Both controls behaving is the only combination that reports no problem.
    expect(
      gradeProbeControls({ capability: "c", shipped: ok, weakened: drift, vacuous: "v" }),
    ).toEqual([]);
    // The negative control failing.
    expect(
      gradeProbeControls({ capability: "c", shipped: drift, weakened: drift, vacuous: "v" }).join(
        "\n",
      ),
    ).toContain("NEGATIVE CONTROL");
    // The positive control not redding.
    expect(
      gradeProbeControls({ capability: "c", shipped: ok, weakened: ok, vacuous: "v" }).join("\n"),
    ).toContain("POSITIVE CONTROL");
    // The positive control unable to run at all, which is vacuous rather than passing.
    expect(
      gradeProbeControls({
        capability: "c",
        shipped: ok,
        weakened: () => null,
        vacuous: "the line the control removes is gone",
      }).join("\n"),
    ).toContain("is vacuous: the line the control removes is gone");
  });

  it("still runs the controls BEFORE any verdict, which is the ordering the refusal depends on", () => {
    const order: string[] = [];
    const r = gate({
      root: umbrellaWithConfig(),
      controls: () => {
        order.push("controls");
        return [];
      },
      probe: () => {
        order.push("probe");
        return null;
      },
    });
    expect(r.code).toBe(0);
    expect(order[0]).toBe("controls");
  });
});

// ---------------------------------------------------------------------------
// AC13: promotion is an edit to the standard, never to the evaluator.
// ---------------------------------------------------------------------------

describe("AC13: a deferred repo joins the binding set by a manifest edit alone", () => {
  it("changes the verdict over one unchanged corpus, with no JavaScript touched", () => {
    const absent = umbrellaWithConfig();
    // The SAME checker, the SAME tree, and only the standard changes.
    expect(gate({ root: absent }).code).toBe(0);
    expect(gate({ root: absent, manifestPath: promoting(PROMOTABLE) }).code).toBe(1);

    const drifted = umbrellaWithConfig({ [PROMOTABLE]: DRIFTED_PACKAGE_REPO });
    const promotedRun = gate({ root: drifted, manifestPath: promoting(PROMOTABLE) });
    expect(promotedRun.code).toBe(1);
    expect(promotedRun.out).toContain(`  BINDING (2): config, ${PROMOTABLE}`);
  });

  it("reads the roster out of the manifest it was handed, not out of the module's copy", () => {
    const shipped = enforcementFrom(MANIFEST) as { binding: string[] };
    expect(shipped.binding).toEqual(ENFORCEMENT.binding);
    const other = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    other["enforcement"].binding = [...ESTATE];
    other["enforcement"].deferred = {};
    expect((enforcementFrom(other) as { binding: string[] }).binding).toEqual(ESTATE);
  });

  it("survives a manifest that declares no enforcement block at all, without inventing one", () => {
    // Unreachable through the schema. It matters anyway: a reader of `enforcementFrom` must not be
    // handed a default roster invented by the evaluator.
    const flat = enforcementFrom({}) as { binding: string[]; deferred: unknown[] };
    expect(flat.binding).toEqual([]);
    expect(flat.deferred).toEqual([]);
  });

  it("keeps the checker free of the roster, which is where a gate must never carry one", () => {
    const code = readFileSync(join(REPO_ROOT, "scripts", "drift-check.js"), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const repo of ESTATE) {
      if (repo === "config") continue; // The pre-existing configSubject anchor, declared once.
      const quoted = new RegExp(`["'\`]${repo}["'\`]`, "g");
      for (const line of code.split("\n")) {
        if (!quoted.test(line)) continue;
        // The one exception, and it exists to REFUSE name-addressing rather than to encode a roster.
        expect(line, `${repo} is named in the evaluator`).toContain("PATHED");
      }
    }
    // And the one repo literal the evaluator does carry is the config-subject anchor, unchanged.
    expect([...code.matchAll(/const CONFIG_REPO = "config";/g)].length).toBe(1);
  });
});
