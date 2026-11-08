/**
 * The catalog, `@cosyte/script-utils/catalog`: the shipped catalog.json, the builder that writes
 * it, and the check every library runs that its package.json description is the catalog's.
 *
 * The manifests here are synthetic, except where a case reads the shipped catalog itself.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATALOG,
  TIERS,
  buildCatalog,
  catalogEntry,
  compareWithCatalog,
  releaseLine,
  runCatalogCheck,
} from "../catalog.js";

const GATE = join(import.meta.dirname, "..", "catalog.js");

/** A manifest of the shape every library's package.json has. */
function manifest(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `@cosyte/${slug}`,
    version: "0.1.4",
    description: `The ${slug} library.`,
    engines: { node: ">=22" },
    repository: { type: "git", url: `git+https://github.com/cosyte/${slug}.git` },
    ...overrides,
  };
}

const TIERS_FIXTURE = {
  standards: [
    { package: "@cosyte/alpha", standard: "Alpha v2" },
    { package: "@cosyte/beta", standard: "BETA" },
  ],
  builtOn: ["@cosyte/gamma"],
  engine: { package: "@cosyte/engine", name: "Engine", status: "in development", onNpm: false },
};

function manifests(overrides: Record<string, Record<string, unknown> | undefined> = {}) {
  const all: Record<string, Record<string, unknown> | undefined> = {
    "@cosyte/alpha": manifest("alpha"),
    "@cosyte/beta": manifest("beta"),
    "@cosyte/gamma": manifest("gamma"),
    "@cosyte/engine": manifest("engine", { version: "0.0.0", engines: { node: ">=24" } }),
    ...overrides,
  };
  return all as Record<string, Record<string, unknown>>;
}

describe("the shipped catalog", () => {
  it("lists the 14 libraries ST13 names, 8 standards then 6 built on them, and Pathways", () => {
    expect(CATALOG.libraries.map((l) => l.slug)).toEqual([
      "hl7",
      "mllp",
      "fhir",
      "ccda",
      "x12",
      "ncpdp",
      "astm",
      "dicom",
      "terminology",
      "transform",
      "deid",
      "synth",
      "dates",
      "cli",
    ]);
    expect(CATALOG.libraries.filter((l) => l.tier === "standard").map((l) => l.standard)).toEqual([
      "HL7 v2",
      "MLLP",
      "FHIR",
      "C-CDA",
      "X12",
      "NCPDP",
      "ASTM",
      "DICOM",
    ]);
    expect(CATALOG.engine).toMatchObject({
      name: "@cosyte/pathways",
      displayName: "Pathways",
      tier: "engine",
      status: "in development",
      onNpm: false,
    });
    expect(TIERS).toEqual(["standard", "built-on", "engine"]);
  });

  it("is frozen, so no consumer edits the shared list in place", () => {
    expect(Object.isFrozen(CATALOG)).toBe(true);
    expect(Object.isFrozen(CATALOG.libraries[0])).toBe(true);
    expect(() => {
      (CATALOG.libraries[0] as { description: string }).description = "edited";
    }).toThrow(TypeError);
  });

  it("finds a record by package name, the engine included", () => {
    expect(catalogEntry("@cosyte/hl7")?.slug).toBe("hl7");
    expect(catalogEntry("@cosyte/pathways")?.tier).toBe("engine");
    expect(catalogEntry("@cosyte/nothing")).toBeUndefined();
  });
});

describe("buildCatalog", () => {
  it("generates every field from package.json and the tier from the tiers file", () => {
    const catalog = buildCatalog(TIERS_FIXTURE, manifests());
    expect(catalog.libraries[0]).toEqual({
      name: "@cosyte/alpha",
      slug: "alpha",
      description: "The alpha library.",
      line: "0.1",
      engines: { node: ">=22" },
      repository: "https://github.com/cosyte/alpha",
      docs: "https://docs.cosyte.com/alpha",
      npm: "https://www.npmjs.com/package/@cosyte/alpha",
      tier: "standard",
      standard: "Alpha v2",
    });
    expect(catalog.libraries[2]).toMatchObject({ slug: "gamma", tier: "built-on" });
    expect(catalog.libraries[2]).not.toHaveProperty("standard");
    expect(catalog.engine).toMatchObject({
      name: "@cosyte/engine",
      line: "0.0",
      engines: { node: ">=24" },
      displayName: "Engine",
      onNpm: false,
    });
    expect(catalog.engine).not.toHaveProperty("npm");
  });

  it.each([
    ["a package with no package.json", { "@cosyte/beta": undefined }, /no package\.json/],
    ["a package.json naming another package", { "@cosyte/beta": manifest("other") }, /names/],
    [
      "no description",
      { "@cosyte/beta": manifest("beta", { description: " " }) },
      /no description/,
    ],
    ["no engines.node", { "@cosyte/beta": manifest("beta", { engines: {} }) }, /engines\.node/],
    [
      "a repository outside github.com/cosyte",
      { "@cosyte/beta": manifest("beta", { repository: "https://example.com/beta" }) },
      /repository/,
    ],
  ])("refuses %s", (_label, overrides, message) => {
    expect(() => buildCatalog(TIERS_FIXTURE, manifests(overrides))).toThrow(message);
  });

  it("refuses a package listed in two tiers", () => {
    const tiers = { ...TIERS_FIXTURE, builtOn: ["@cosyte/gamma", "@cosyte/alpha"] };
    expect(() => buildCatalog(tiers, manifests())).toThrow(/listed twice/);
  });

  it("names the release line", () => {
    expect(releaseLine("0.1.2")).toBe("0.1");
    expect(releaseLine("0.12.0")).toBe("0.12");
    expect(releaseLine("1.4.0")).toBe("1");
    expect(() => releaseLine("latest")).toThrow(TypeError);
  });
});

describe("compareWithCatalog", () => {
  const hl7 = catalogEntry("@cosyte/hl7");

  it("finds nothing when the description is the catalog's", () => {
    expect(compareWithCatalog({ name: "@cosyte/hl7", description: hl7?.description })).toEqual([]);
  });

  it("names the field and both values when they disagree", () => {
    expect(compareWithCatalog({ name: "@cosyte/hl7", description: "Something else." })).toEqual([
      { field: "description", catalog: hl7?.description, packageJson: "Something else." },
    ]);
  });

  it("refuses a package the catalog does not list", () => {
    expect(() => compareWithCatalog({ name: "@cosyte/nothing", description: "x" })).toThrow(
      /does not list/,
    );
  });
});

describe("the CLI", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "catalog-check-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function pkg(label: string, json: unknown): string {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    if (json !== null) writeFileSync(join(dir, "package.json"), JSON.stringify(json));
    return dir;
  }

  function cli(args: string[], cwd: string): { code: number; out: string } {
    const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: "utf8" });
    return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  const description = catalogEntry("@cosyte/dicom")?.description;

  it("exits 0 when the description is the catalog's", () => {
    const r = cli([], pkg("agrees", { name: "@cosyte/dicom", description }));
    expect(r.code, r.out).toBe(0);
  });

  it("is advisory: prints both values as a note and exits 0 when they disagree", () => {
    // Freshness is cosyte/config's job (scripts/catalog.mjs check --npm), so a library that changes
    // its description is not held red until the next script-utils release.
    const r = cli([], pkg("disagrees", { name: "@cosyte/dicom", description: "A DICOM toolkit." }));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("note:");
    expect(r.out).toContain('package.json: "A DICOM toolkit."');
    expect(r.out).toContain(JSON.stringify(description));
  });

  it("exits 1 with --strict when they disagree", () => {
    const dir = pkg("disagrees-strict", { name: "@cosyte/dicom", description: "A DICOM toolkit." });
    const r = cli(["--strict"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('package.json: "A DICOM toolkit."');
    expect(runCatalogCheck({ dir, strict: true })).toBe(1);
  });

  it("reads --dir", () => {
    const dir = pkg("by-dir", { name: "@cosyte/dicom", description });
    expect(cli(["--dir", dir], root).code).toBe(0);
  });

  it("notes an unlisted package and exits 0, or 2 with --strict", () => {
    const dir = pkg("unlisted", { name: "@cosyte/nothing", description: "x" });
    const advisory = cli([], dir);
    expect(advisory.code).toBe(0);
    expect(advisory.out).toContain("does not list");
    expect(cli(["--strict"], dir).code).toBe(2);
  });

  it("exits 2 when it cannot run: no package.json, or a bad argument", () => {
    expect(cli([], pkg("no-manifest", null)).code).toBe(2);
    expect(cli(["--strict"], pkg("no-manifest-strict", null)).code).toBe(2);
    expect(cli(["--fix"], pkg("bad-arg", { name: "@cosyte/dicom", description })).code).toBe(2);
  });
});
