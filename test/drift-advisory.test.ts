/**
 * Grades the ADVISORY half of `scripts/drift-check.js`: the part that stops the baseline arguing
 * from a sentence about an advisory and makes it read the advisory.
 *
 * THE DEFECT THIS SUITE IS WRITTEN AGAINST. `drift-manifest.json` used to name its advisories in
 * English, in a comment key nothing parsed, beside hand-transcribed version ranges. Prose does not
 * decay and transcription does. Measured at the tree this work started from: the baseline pinned
 * js-yaml at 4.3.0 while the advisory it argued from first patches at 4.3.1, config's own
 * package.json pinned 4.2.0 against a manifest that said 4.3.0 with nothing comparing them, and
 * both resolved copies of js-yaml sat inside a cited vulnerable range under a note calling the
 * reach remediated. Every one of those is asserted below as a case, with the real record.
 *
 * NO REQUEST IS MADE HERE, AND THAT IS STRUCTURAL RATHER THAN CAREFUL. The lookup is an injected
 * function; every case hands in a stub over `test/fixtures/advisories/`, which are the response
 * bodies the two sources actually returned, trimmed to the keys under test and not retyped. See
 * that directory's README.md for provenance. A suite that reached the network would be a flaky
 * required gate, and one that could reach it by accident is the same thing waiting to happen, so
 * `test/no-network.setup.ts` refuses `fetch` and DNS across the whole root suite and one case below
 * asserts that guard is live rather than trusting it.
 *
 * SECURITY / PHI: no repository is read but this one, and every fixture is a public advisory.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  advisoryRangesFor,
  compareVersions,
  describeRange,
  fetchAdvisoryFromOsv,
  gradeOverrideAdvisories,
  gradeResolvedDependencies,
  loadAdvisories,
  overridePackageName,
  overrideRequirementsOf,
  parseComparatorRange,
  readLockfilePackages,
  runCheck,
  versionInRange,
} from "../scripts/drift-check.js";
import { DEFAULT_MANIFEST, DEFAULT_SCHEMA } from "../scripts/validate-drift-manifest.mjs";

const REPO_ROOT = process.cwd();
const FIXTURES = join(REPO_ROOT, "test", "fixtures", "advisories");
const RAW_MANIFEST = readFileSync(DEFAULT_MANIFEST, "utf8");
const MANIFEST = JSON.parse(RAW_MANIFEST) as Record<string, any>;

const JS_YAML_DOS = "GHSA-h67p-54hq-rp68";
const JS_YAML_POLLUTION = "GHSA-5p4m-2wfm-xmqj";
const ESBUILD = "GHSA-g7r4-m6w7-qqqr";

const NO_PROBE = () => null;
const CONTROLS_PASS = () => [];

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-advisory-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/** One committed advisory record, in the shape the named source publishes. */
function fixture(source: "github" | "osv", id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, `${source}-${id}.json`), "utf8"));
}

/**
 * A lookup that serves the committed records and nothing else.
 *
 * It also RECORDS what it was asked for, which is how the "cites nothing, so nothing was consulted"
 * case below is asserted as an absence rather than as a message.
 */
function stubLookup(source: "github" | "osv" = "osv", overrides: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const lookup = async (id: string) => {
    asked.push(id);
    if (Object.hasOwn(overrides, id)) return overrides[id] as Record<string, unknown>;
    return { url: `stub:${source}/${id}`, ok: true, record: fixture(source, id) };
  };
  return { lookup, asked };
}

/** The requirements block that carries the overrides, read from the shipped manifest. */
function shippedRequirements(): Record<string, any> {
  return overrideRequirementsOf(MANIFEST["baselines"].package) as Record<string, any>;
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

/**
 * A throwaway umbrella root holding a `config/` that satisfies every rule the subject grades.
 *
 * IT IS SYNTHETIC ON PURPOSE. Pointing these cases at the real checkout would make them assert
 * whatever this repository happens to look like next month; the point of a fixture repo is that the
 * ONLY thing that varies between the cases below is the advisory record.
 */
function umbrellaWithConfig(files: Record<string, string> = {}): string {
  const root = tempDir();
  const overrides = shippedRequirements().pnpmOverrides;
  const contents: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "cosyte-config",
      private: true,
      packageManager: "pnpm@10.34.5",
      engines: { node: ">=22.14" },
      prettier: "@cosyte/prettier-config",
      pnpm: { overrides },
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
    ".changeset/config.json": JSON.stringify({ access: "public", baseBranch: "main" }),
    "pnpm-lock.yaml":
      "lockfileVersion: '9.0'\n\npackages:\n\n  js-yaml@3.15.1: {}\n\n  js-yaml@4.3.1: {}\n\n  esbuild@0.28.1: {}\n",
    // The light baseline holds config too, and its four workflows are the only reason a clean run
    // here would otherwise still red. They are empty because only their filenames are graded.
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

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

// ---------------------------------------------------------------------------

describe("version ordering and range membership", () => {
  it("orders versions numerically, padding missing parts with zero", () => {
    expect(compareVersions("4.2.0", "4.3.1")).toBe(-1);
    expect(compareVersions("4.3.1", "4.3.1")).toBe(0);
    expect(compareVersions("3.15.1", "3.14.2")).toBe(1);
    // OSV writes an open lower bound as the string "0", which has to compare against a real version.
    expect(compareVersions("3.14.2", "0")).toBe(1);
    // Numerically, not as strings: "0.28.1" sorts BELOW "0.9.0" as text and above it as a version,
    // and an esbuild range is exactly where that difference decides a verdict.
    expect(compareVersions("0.28.1", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.28.1")).toBe(-1);
  });

  it("ranks a release above a prerelease of the same core", () => {
    expect(compareVersions("4.3.1", "4.3.1-rc.1")).toBe(1);
    expect(versionInRange("4.3.1-rc.1", { introduced: "4.0.0", fixed: "4.3.1" })).toBe(true);
    expect(versionInRange("4.3.1", { introduced: "4.0.0", fixed: "4.3.1" })).toBe(false);
  });

  it("reads a fixed bound as exclusive and a last-affected bound as inclusive", () => {
    expect(versionInRange("4.1.1", { introduced: "4.0.0", lastAffected: "4.1.1" })).toBe(true);
    expect(versionInRange("4.2.0", { introduced: "4.0.0", lastAffected: "4.1.1" })).toBe(false);
    expect(versionInRange("3.14.2", { introduced: "3.0.0", fixed: "3.15.1" })).toBe(true);
    expect(versionInRange("3.15.1", { introduced: "3.0.0", fixed: "3.15.1" })).toBe(false);
  });

  it("parses GitHub's comparator text, including the shapes with no lower bound", () => {
    expect(parseComparatorRange(">= 4.0.0, < 4.3.1")).toEqual({
      introduced: "4.0.0",
      fixed: "4.3.1",
    });
    expect(parseComparatorRange(">= 4.0.0, <= 4.1.1")).toEqual({
      introduced: "4.0.0",
      lastAffected: "4.1.1",
    });
    expect(parseComparatorRange("< 3.15.0")).toEqual({ fixed: "3.15.0" });
    expect(describeRange({ introduced: "4.0.0", fixed: "4.3.1" })).toBe(">= 4.0.0, < 4.3.1");
  });

  it("names the package an override selects, scoped or not", () => {
    expect(overridePackageName("js-yaml@>=4.0.0 <4.3.1")).toBe("js-yaml");
    expect(overridePackageName("@scope/pkg@>=1.0.0 <2.0.0")).toBe("@scope/pkg");
    expect(overridePackageName("esbuild")).toBe("esbuild");
  });
});

describe("reading a real advisory record, in either published shape", () => {
  it("reads both js-yaml branches out of the GitHub record", () => {
    const read = advisoryRangesFor(fixture("github", JS_YAML_POLLUTION), {
      ecosystem: "npm",
      package: "js-yaml",
    }) as { ok: boolean; shape: string; ranges: any[] };
    expect(read.ok).toBe(true);
    expect(read.shape).toBe("github");
    expect(read.ranges).toEqual([
      { introduced: "4.0.0", fixed: "4.3.1", firstPatched: "4.3.1" },
      { introduced: "3.0.0", fixed: "3.15.1", firstPatched: "3.15.1" },
    ]);
  });

  it("reads the same two branches out of the OSV record", () => {
    const read = advisoryRangesFor(fixture("osv", JS_YAML_POLLUTION), {
      ecosystem: "npm",
      package: "js-yaml",
    }) as { ok: boolean; shape: string; ranges: any[] };
    expect(read.ok).toBe(true);
    expect(read.shape).toBe("osv");
    expect(read.ranges).toEqual([
      { introduced: "4.0.0", fixed: "4.3.1", firstPatched: "4.3.1" },
      { introduced: "3.0.0", fixed: "3.15.1", firstPatched: "3.15.1" },
    ]);
  });

  it("keeps the two sources' DISAGREEMENT visible instead of averaging it", () => {
    // GHSA-h67p-54hq-rp68 is the case that makes "the advisory says" a sentence with no referent:
    // GitHub reports the 4.x branch as <= 4.1.1, OSV as fixed at 4.2.0. Both are read as published.
    const github = advisoryRangesFor(fixture("github", JS_YAML_DOS), {
      ecosystem: "npm",
      package: "js-yaml",
    }) as { ranges: any[] };
    const osv = advisoryRangesFor(fixture("osv", JS_YAML_DOS), {
      ecosystem: "npm",
      package: "js-yaml",
    }) as { ranges: any[] };
    expect(github.ranges[0]).toEqual({
      introduced: "4.0.0",
      lastAffected: "4.1.1",
      firstPatched: "4.2.0",
    });
    expect(osv.ranges[0]).toEqual({ introduced: "4.0.0", fixed: "4.2.0", firstPatched: "4.2.0" });
    // The verdict about 4.1.2 differs between the records, and neither is silently preferred.
    expect(versionInRange("4.1.2", github.ranges[0])).toBe(false);
    expect(versionInRange("4.1.2", osv.ranges[0])).toBe(true);
  });

  it("refuses a record that names no range for the package it is being read for", () => {
    const read = advisoryRangesFor(fixture("osv", ESBUILD), {
      ecosystem: "npm",
      package: "js-yaml",
    }) as { ok: boolean; reason: string };
    expect(read.ok).toBe(false);
    expect(read.reason).toContain("names no vulnerable range for npm js-yaml");
  });

  it("refuses a body that is neither published shape", () => {
    const read = advisoryRangesFor(
      { message: "Not Found" },
      {
        ecosystem: "npm",
        package: "js-yaml",
      },
    ) as { ok: boolean; reason: string };
    expect(read.ok).toBe(false);
    expect(read.reason).toContain("neither a `vulnerabilities` array");
  });
});

describe("AC5: an override that cites no advisory in machine-readable form is drift", () => {
  it("names the override key and does not fall back to the prose provenance", async () => {
    const requirements = shippedRequirements();
    const prose = MANIFEST["baselines"].package.groups.dependencies.provenance as string;
    // The precondition that makes this case interesting: a human reading the group would still find
    // the advisory named in English right beside the override.
    expect(prose.length).toBeGreaterThan(200);

    const stripped = {
      ...requirements,
      pnpmOverrideAdvisories: Object.fromEntries(
        Object.entries(requirements.pnpmOverrideAdvisories).filter(
          ([key]) => !key.startsWith("esbuild@"),
        ),
      ),
    };
    const { lookup, asked } = stubLookup();
    const advisories = await loadAdvisories({
      manifest: {
        configSubject: { baseline: "package" },
        baselines: { package: { groups: { d: { requirements: stripped } } } },
      },
      fetchAdvisory: lookup,
    });

    const findings = gradeOverrideAdvisories({ requirements: stripped, advisories }) as {
      group: string;
      line: string;
    }[];
    const line = findings.map((f) => f.line).join("\n");
    expect(line).toContain('pnpmOverrides["esbuild@>=0.27.3 <0.28.1"]: cites no advisory');
    expect(line).toContain("a prose note beside it is not a citation");
    // Nothing was consulted for it, which is the half a message could otherwise fake.
    expect(asked).not.toContain(ESBUILD);
  });

  it("reds when a citation names a different package than the override selects", async () => {
    const requirements = shippedRequirements();
    const mismatched = {
      ...requirements,
      pnpmOverrideAdvisories: {
        ...requirements.pnpmOverrideAdvisories,
        "esbuild@>=0.27.3 <0.28.1": { ecosystem: "npm", package: "js-yaml", advisories: [ESBUILD] },
      },
    };
    const { lookup } = stubLookup();
    const advisories = await loadAdvisories({
      manifest: { baselines: { package: { groups: { d: { requirements: mismatched } } } } },
      fetchAdvisory: lookup,
    });
    const findings = gradeOverrideAdvisories({ requirements: mismatched, advisories }) as {
      line: string;
    }[];
    expect(findings.map((f) => f.line).join("\n")).toContain("the override selects esbuild");
  });

  it("the shipped manifest cites every one of its own overrides", () => {
    const requirements = shippedRequirements();
    for (const key of Object.keys(requirements.pnpmOverrides)) {
      const citation = requirements.pnpmOverrideAdvisories[key];
      expect(citation, `${key} carries no citation`).toBeDefined();
      expect(citation.ecosystem).toBe("npm");
      expect(citation.advisories.length).toBeGreaterThanOrEqual(1);
      expect(overridePackageName(key)).toBe(citation.package);
    }
  });

  it("carries NO version range from an advisory in the manifest itself", () => {
    // The rule the whole slice turns on: a range written here is a copy that decays. The citation
    // objects may carry an ecosystem, a package and identifiers, and nothing that looks like a
    // bound.
    const citations = shippedRequirements().pnpmOverrideAdvisories as Record<string, any>;
    for (const [key, citation] of Object.entries(citations)) {
      expect(Object.keys(citation).sort(), key).toEqual(["advisories", "ecosystem", "package"]);
      for (const id of citation.advisories) expect(id).toMatch(/^GHSA-[a-z0-9-]+$/);
    }
  });
});

describe("AC2 and AC6: an override pinned below the first patched version fails", () => {
  it("names the advisory, the pinned version and the patched version", async () => {
    // The measured defect: the baseline pinned 4.3.0 while the advisory it cites first patches at
    // 4.3.1. This is that manifest, graded against that record.
    const requirements = shippedRequirements();
    const stale = {
      ...requirements,
      pnpmOverrides: { ...requirements.pnpmOverrides, "js-yaml@>=4.0.0 <4.3.1": "4.3.0" },
    };
    const { lookup } = stubLookup();
    const advisories = await loadAdvisories({
      manifest: { baselines: { package: { groups: { d: { requirements: stale } } } } },
      fetchAdvisory: lookup,
    });
    const lines = (
      gradeOverrideAdvisories({ requirements: stale, advisories }) as { line: string }[]
    )
      .map((f) => f.line)
      .join("\n");

    expect(lines).toContain(JS_YAML_POLLUTION);
    expect(lines).toContain("pins js-yaml@4.3.0");
    expect(lines).toContain("its first patched version is 4.3.1");
  });

  it("passes the override that pins exactly the first patched version", async () => {
    // esbuild is the clean case in the shipped baseline: pinned at 0.28.1, which is where
    // GHSA-g7r4-m6w7-qqqr first patches. A suite of nothing but failures proves nothing.
    const requirements = shippedRequirements();
    const { lookup } = stubLookup();
    const advisories = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
    const findings = gradeOverrideAdvisories({ requirements, advisories }) as { line: string }[];
    expect(findings.map((f) => f.line).filter((l) => l.includes("esbuild"))).toEqual([]);
  });

  it("passes every override the shipped manifest declares, against both sources", async () => {
    for (const source of ["github", "osv"] as const) {
      const { lookup } = stubLookup(source);
      const advisories = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
      const findings = gradeOverrideAdvisories({
        requirements: shippedRequirements(),
        advisories,
      }) as { line: string }[];
      expect(
        findings.map((f) => f.line),
        `graded against the ${source} records`,
      ).toEqual([]);
    }
  });

  it("AC6: the verdict follows the RECORD, with no edit to the manifest or the checker", async () => {
    // The same manifest and the same code, graded twice against two records that differ only in
    // where the advisory says it was first patched. If the checker were reading a transcribed range
    // instead, both runs would agree.
    const requirements = shippedRequirements();
    const asPublished = fixture("osv", ESBUILD) as any;
    const moved = JSON.parse(JSON.stringify(asPublished));
    moved.affected[0].ranges[0].events[1].fixed = "0.29.0";

    const clean = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: stubLookup().lookup });
    expect(gradeOverrideAdvisories({ requirements, advisories: clean })).toEqual([]);

    const { lookup } = stubLookup("osv", {
      [ESBUILD]: { url: "stub:osv/moved", ok: true, record: moved },
    });
    const after = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
    const lines = (
      gradeOverrideAdvisories({ requirements, advisories: after }) as { line: string }[]
    )
      .map((f) => f.line)
      .join("\n");
    expect(lines).toContain("pins esbuild@0.28.1");
    expect(lines).toContain("its first patched version is 0.29.0");
  });
});

describe("AC3: a RESOLVED dependency inside a cited range is reported, not excused", () => {
  it("reads the versions a pnpm lockfile resolves, with no YAML parser", () => {
    const resolved = readLockfilePackages(
      readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8"),
    ) as Map<string, Set<string>>;
    expect([...(resolved.get("js-yaml") ?? [])].sort()).toEqual(["3.15.1", "4.3.1"]);
    expect([...(resolved.get("esbuild") ?? [])]).toEqual(["0.28.1"]);
    // Scoped names are quoted in the lockfile and must survive the quoting.
    expect(resolved.has("@esbuild/linux-x64")).toBe(true);
    // `snapshots:` is a second block with peer-decorated keys and is deliberately not read.
    expect([...(resolved.keys() ?? [])].some((name) => name.includes("("))).toBe(false);
  });

  it("reports the two copies the previous lockfile resolved, naming each range", async () => {
    // The measured state: js-yaml 3.14.2 reached through read-yaml-file and js-yaml 4.2.0, both
    // inside GHSA-5p4m-2wfm-xmqj, under a manifest note calling the 3.x reach an accepted residual.
    const before = new Map([["js-yaml", new Set(["3.14.2", "4.2.0"])]]);
    const { lookup } = stubLookup();
    const advisories = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
    const lines = (
      gradeResolvedDependencies({
        requirements: shippedRequirements(),
        advisories,
        resolved: before,
        lockLabel: "config/pnpm-lock.yaml",
      }) as { line: string }[]
    ).map((f) => f.line);

    expect(lines.some((l) => l.includes("js-yaml@3.14.2") && l.includes(JS_YAML_POLLUTION))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("js-yaml@4.2.0") && l.includes(JS_YAML_POLLUTION))).toBe(
      true,
    );
    expect(lines.join("\n")).toContain("not recorded as an accepted residual");
    expect(lines.join("\n")).toContain(">= 3.0.0, < 3.15.1");
  });

  it("reports nothing over the lockfile this repository resolves today", async () => {
    const { lookup } = stubLookup();
    const advisories = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
    const findings = gradeResolvedDependencies({
      requirements: shippedRequirements(),
      advisories,
      resolved: readLockfilePackages(
        readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8"),
      ) as Map<string, Set<string>>,
      lockLabel: "config/pnpm-lock.yaml",
    }) as { line: string }[];
    expect(findings.map((f) => f.line)).toEqual([]);
  });
});

describe("AC7: a lookup that cannot complete is INCONCLUSIVE and reds", () => {
  const cases: [string, () => Promise<unknown>, RegExp][] = [
    [
      "no network at all",
      () =>
        fetchAdvisoryFromOsv(JS_YAML_POLLUTION, {
          fetchImpl: () => Promise.reject(new Error("getaddrinfo ENOTFOUND api.osv.dev")),
        }),
      /did not complete.*ENOTFOUND/s,
    ],
    [
      "a non-2xx response",
      () =>
        fetchAdvisoryFromOsv(JS_YAML_POLLUTION, {
          fetchImpl: () => Promise.resolve({ status: 500, json: async () => ({}) }),
        }),
      /answered 500/,
    ],
    [
      "a rate-limited response",
      () =>
        fetchAdvisoryFromOsv(JS_YAML_POLLUTION, {
          fetchImpl: () => Promise.resolve({ status: 403, json: async () => ({}) }),
        }),
      /answered 403.*rate limit/s,
    ],
    [
      "an identifier the source does not know",
      () =>
        fetchAdvisoryFromOsv("GHSA-0000-0000-0000", {
          fetchImpl: () => Promise.resolve({ status: 404, json: async () => ({}) }),
        }),
      /answered 404.*does not know this identifier/s,
    ],
    [
      "a body that is not JSON",
      () =>
        fetchAdvisoryFromOsv(JS_YAML_POLLUTION, {
          fetchImpl: () =>
            Promise.resolve({
              status: 200,
              json: () => Promise.reject(new SyntaxError("Unexpected token <")),
            }),
        }),
      /body that is not JSON/,
    ],
  ];

  it.each(cases)("reports %s as a reason rather than throwing", async (_name, call, expected) => {
    const result = (await call()) as { ok: boolean; reason: string; url: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(expected);
    expect(result.url).toContain("api.osv.dev");
  });

  it("AC12: the suite's own network guard is LIVE, and the default lookup lands on it", async () => {
    // Two things at once, and both matter. The guard in test/no-network.setup.ts is asserted to be
    // in force rather than assumed, because a guard nobody has seen fire is indistinguishable from
    // one that cannot. And the DEFAULT lookup, the one with no stub handed in, is shown to answer
    // `ok: false` with a reason instead of throwing: that is the no-network branch of AC7 arriving
    // through the real code path rather than through a fake.
    const result = (await fetchAdvisoryFromOsv(JS_YAML_POLLUTION)) as {
      ok: boolean;
      reason: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("did not complete");
    expect(result.reason).toContain("makes no network request");
  });

  it("makes no request when this runtime has no fetch", async () => {
    const result = (await fetchAdvisoryFromOsv(JS_YAML_POLLUTION, {
      fetchImpl: null as never,
    })) as {
      ok: boolean;
      reason: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no fetch()");
  });

  it("turns an incomplete lookup into an INCONCLUSIVE finding that names the identifier", async () => {
    const { lookup } = stubLookup("osv", {
      [JS_YAML_POLLUTION]: {
        url: "https://api.osv.dev/v1/vulns/GHSA-5p4m-2wfm-xmqj",
        ok: false,
        reason:
          "answered 429, which is how the unauthenticated endpoints report a per-IP rate limit",
      },
    });
    const advisories = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
    const lines = (
      gradeOverrideAdvisories({
        requirements: shippedRequirements(),
        advisories,
      }) as { line: string }[]
    ).map((f) => f.line);

    expect(lines.some((l) => l.includes(`advisory ${JS_YAML_POLLUTION}`))).toBe(true);
    expect(lines.some((l) => l.includes("INCONCLUSIVE") && l.includes("429"))).toBe(true);
    // The advisory that DID resolve is still graded, so one dead lookup does not blank the report.
    expect(lines.some((l) => l.includes(JS_YAML_DOS))).toBe(false);
  });

  it("is INCONCLUSIVE when no lookup was supplied at all, never a pass", () => {
    const lines = (
      gradeOverrideAdvisories({
        requirements: shippedRequirements(),
        advisories: new Map(),
      }) as { line: string }[]
    ).map((f) => f.line);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain("INCONCLUSIVE");
  });
});

describe("AC7 and AC10: the exit code the whole run produces", () => {
  it("exits 0 over a checkout whose pins and resolutions the records clear", async () => {
    const root = umbrellaWithConfig();
    const io = capture();
    const advisories = await loadAdvisories({
      manifest: MANIFEST,
      fetchAdvisory: stubLookup().lookup,
    });
    const code = runCheck({
      root,
      advisories,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(io.out.join("\n")).toContain("✓ config: matches the baseline it publishes");
    expect(code).toBe(0);
  });

  it("exits non-zero, and prints INCONCLUSIVE, when an advisory could not be reached", async () => {
    const root = umbrellaWithConfig();
    const io = capture();
    const { lookup } = stubLookup("osv", {
      [JS_YAML_POLLUTION]: {
        url: "https://api.osv.dev/v1/vulns/x",
        ok: false,
        reason: "no network",
      },
    });
    const advisories = await loadAdvisories({ manifest: MANIFEST, fetchAdvisory: lookup });
    const code = runCheck({
      root,
      advisories,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).toContain("INCONCLUSIVE");
    expect(printed).not.toContain("matches the baseline it publishes");
    expect(code).toBe(1);
  });

  it("exits non-zero when an override pins below what the record reports", async () => {
    const path = manifestFile((draft) => {
      const requirements = draft["baselines"].package.groups.dependencies.requirements;
      requirements.pnpmOverrides["js-yaml@>=4.0.0 <4.3.1"] = "4.3.0";
    });
    const root = umbrellaWithConfig({
      // The subject's own package.json follows the manifest, so the ONLY thing wrong here is that
      // the pin both files agree on is below the advisory's first patched version.
      "package.json": readFileSync(join(umbrellaWithConfig(), "config", "package.json"), "utf8")
        .split('"js-yaml@>=4.0.0 <4.3.1": "4.3.1"')
        .join('"js-yaml@>=4.0.0 <4.3.1": "4.3.0"'),
    });
    const io = capture();
    const advisories = await loadAdvisories({
      manifest: MANIFEST,
      fetchAdvisory: stubLookup().lookup,
    });
    const code = runCheck({
      manifestPath: path,
      root,
      advisories,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).toContain("pins js-yaml@4.3.0");
    expect(printed).toContain("its first patched version is 4.3.1");
    expect(code).toBe(1);
  });

  it("records the re-pin in the manifest's own re-derivation account", () => {
    // `pnpmOverrides` was claimed as carried unchanged from version 1; this slice changed its value,
    // so the claim had to move rather than quietly become false.
    const entry = MANIFEST["reDerivation"].droppedOrChanged.find(
      (e: { was: string }) => e.was === "pnpmOverrides",
    );
    expect(entry, "the re-pin must be accounted for").toBeDefined();
    expect(entry.reason).toMatch(/below the first patched version/i);
    expect(MANIFEST["reDerivation"].carriedUnchanged).not.toContain("pnpmOverrides");
  });
});
