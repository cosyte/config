/**
 * The catalog generator, `scripts/catalog.mjs` (PF1, ST13, ST14), and the committed catalog it
 * writes, `packages/script-utils/catalog.json`.
 *
 * CI checks out config alone, so the full regeneration (`check --root <umbrella>`) cannot run there.
 * What runs here on every `pnpm test`: the committed catalog against the hand-kept tiers file, and
 * the generator against a synthetic umbrella rebuilt from the committed catalog, so a generator that
 * no longer reproduces its own output reds.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCatalog } from "../packages/script-utils/catalog.js";
import {
  CATALOG_PATH,
  NPM_DESCRIPTION_LIMIT,
  TIERS_PATH,
  checkSelf,
  diffCatalogs,
  generate,
  generateFromNpm,
  main,
  npmLatestUrl,
  serialize,
  tieredPackages,
} from "../scripts/catalog.mjs";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "catalog.mjs");
const COMMITTED_TEXT = readFileSync(CATALOG_PATH, "utf8");
const committed = (): Record<string, any> => JSON.parse(COMMITTED_TEXT);
const tiers = JSON.parse(readFileSync(TIERS_PATH, "utf8"));

const temporary: string[] = [];
afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() ?? "", { recursive: true, force: true });
});

/** An umbrella of one package.json per catalog record, rebuilt from the committed catalog. */
function umbrella(edit: (manifests: Map<string, Record<string, any>>) => void = () => {}): string {
  const root = mkdtempSync(join(tmpdir(), "catalog-umbrella-"));
  temporary.push(root);
  const catalog = committed();
  const manifests = new Map<string, Record<string, any>>();
  for (const record of [...catalog.libraries, catalog.engine]) {
    manifests.set(record.name, {
      name: record.name,
      version: `${record.line.includes(".") ? record.line : `${record.line}.0`}.0`,
      description: record.description,
      engines: { node: record.engines.node },
      repository: { type: "git", url: `git+${record.repository}.git` },
    });
  }
  edit(manifests);
  for (const [name, manifest] of manifests) {
    const dir = join(root, name.replace(/^@cosyte\//, ""));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  }
  return root;
}

function run(args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("the committed catalog", () => {
  it("agrees with the hand-kept tiers file", () => {
    expect(checkSelf(committed(), tiers)).toEqual([]);
    expect(run(["check", "--self"]).code).toBe(0);
  });

  it("names every tiered package, 14 libraries and Pathways", () => {
    expect(tieredPackages(tiers)).toHaveLength(15);
  });

  it.each([
    [
      "a library moved out of the tiers' order",
      (c: any) => c.libraries.reverse(),
      /library 1 is "@cosyte\/cli"/,
    ],
    ["a wrong tier", (c: any) => (c.libraries[9].tier = "standard"), /tier "standard"/],
    ["a wrong standard name", (c: any) => (c.libraries[0].standard = "HL7"), /standard is "HL7"/],
    ["a library dropped", (c: any) => c.libraries.pop(), /lists 13 libraries/],
    ["Pathways on npm", (c: any) => (c.engine.onNpm = true), /onNpm is true/],
    ["a docs URL edited", (c: any) => (c.libraries[1].docs = "https://cosyte.com"), /docs is/],
    ["an empty description", (c: any) => (c.libraries[2].description = ""), /no description/],
    ["the generated header removed", (c: any) => delete c.$comment, /generated header/],
  ])("reds on %s", (_label, edit, message) => {
    const catalog = committed();
    edit(catalog);
    expect(checkSelf(catalog, tiers).join("\n")).toMatch(message);
  });
});

describe("the generator", () => {
  it("reproduces the committed catalog byte for byte from the package.json files", () => {
    const generated = generate(umbrella(), tiers, buildCatalog);
    expect(serialize(generated)).toBe(COMMITTED_TEXT);
  });

  it("check exits 0 over an umbrella that matches", () => {
    const r = run(["check", "--root", umbrella()]);
    expect(r.code, r.out).toBe(0);
  });

  it("check exits 1 and names the field when a description moved", () => {
    const root = umbrella((m) => {
      const hl7 = m.get("@cosyte/hl7");
      if (hl7 !== undefined) hl7.description = "A new canonical line.";
    });
    const r = run(["check", "--root", root]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("catalog.libraries.0.description");
    expect(r.out).toContain("A new canonical line.");
  });

  it("check exits 2 when a library's package.json is missing, rather than skipping it", () => {
    const root = umbrella((m) => m.delete("@cosyte/dates"));
    const r = run(["check", "--root", root]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("@cosyte/dates's package.json");
  });

  it("exits 2 on an argument it does not accept", () => {
    expect(run(["publish"]).code).toBe(2);
    expect(run(["check", "--fix"]).code).toBe(2);
  });

  it("diffs field by field", () => {
    const a = { x: { y: 1, z: 2 } };
    expect(diffCatalogs(a, { x: { y: 1, z: 3 } })).toEqual([
      "catalog.x.z: committed 2, package.json says 3",
    ]);
  });
});

/**
 * `check --npm`: freshness is config's job, read from what each library has RELEASED. The registry is
 * never reached here (test/no-network.setup.ts refuses it): every case hands in a fetcher serving
 * manifests rebuilt from the committed catalog, edited one field at a time.
 */
describe("check --npm, against each library's latest release", () => {
  /** A fetcher over each library's `latest` manifest, and the names it was asked for. */
  function npm(edit: (manifests: Map<string, Record<string, any>>) => void = () => {}) {
    const manifests = new Map<string, Record<string, any>>();
    for (const record of committed().libraries) {
      manifests.set(record.name, {
        name: record.name,
        version: `${record.line}.7`,
        description: record.description,
        engines: { node: record.engines.node },
        repository: { type: "git", url: `git+${record.repository}.git` },
      });
    }
    edit(manifests);
    const asked: string[] = [];
    const fetchManifest = async (name: string) => {
      asked.push(name);
      const manifest = manifests.get(name);
      if (manifest === undefined) throw new Error(`the stub registry has no ${name}`);
      return manifest;
    };
    return { fetchManifest, asked };
  }

  /** Run `main` in process, keeping what it writes. */
  async function runMain(argv: string[], fetchManifest: (name: string) => Promise<any>) {
    let out = "";
    const capture = (chunk: unknown) => {
      out += String(chunk);
      return true;
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture);
    try {
      return { code: await main(argv, { fetchManifest }), out };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  it("reads the registry's latest manifest for a scoped name", () => {
    expect(npmLatestUrl("@cosyte/hl7")).toBe("https://registry.npmjs.org/@cosyte%2Fhl7/latest");
  });

  it("exits 0 when every release matches, and never asks npm for Pathways", async () => {
    const { fetchManifest, asked } = npm();
    const r = await runMain(["check", "--npm"], fetchManifest);
    expect(r.code, r.out).toBe(0);
    expect(asked).toHaveLength(14);
    expect(asked).not.toContain("@cosyte/pathways");
  });

  it("regenerates the committed catalog byte for byte from releases that match it", async () => {
    const { catalog } = await generateFromNpm(tiers, committed(), npm().fetchManifest);
    expect(serialize(catalog)).toBe(COMMITTED_TEXT);
  });

  it("exits 1 and names the field when a library released a new description", async () => {
    const { fetchManifest } = npm((m) => {
      m.get("@cosyte/x12")!.description = "A released new line.";
    });
    const r = await runMain(["check", "--npm"], fetchManifest);
    expect(r.code).toBe(1);
    expect(r.out).toContain("catalog.libraries.4.description");
    expect(r.out).toContain('npm\'s latest release says "A released new line."');
    expect(r.out).toContain("write --npm");
  });

  it("exits 1 when a release moved the line or the engines range", async () => {
    const { fetchManifest } = npm((m) => {
      m.get("@cosyte/dates")!.version = "0.2.0";
      m.get("@cosyte/fhir")!.engines = { node: ">=24.0.0" };
    });
    const r = await runMain(["check", "--npm"], fetchManifest);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\.line: committed "0\.1", npm's latest release says "0\.2"/);
    expect(r.out).toContain('npm\'s latest release says ">=24.0.0"');
  });

  it("takes a description npm cut at its limit as fresh, and notes it", async () => {
    const long = `${"A long canonical line, ".repeat(14)}that npm cannot keep whole.`;
    expect(long.length).toBeGreaterThan(NPM_DESCRIPTION_LIMIT);
    const base = committed();
    base.libraries[13].description = long;
    const { fetchManifest } = npm((m) => {
      m.get(base.libraries[13].name)!.description = long.slice(0, NPM_DESCRIPTION_LIMIT);
    });
    const { catalog, notes } = await generateFromNpm(tiers, base, fetchManifest);
    expect(diffCatalogs(base, catalog, "npm")).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(`is ${long.length} characters and npm keeps 255`);

    // A cut that is NOT the committed line's first 255 characters is a real difference.
    const { fetchManifest: other } = npm((m) => {
      m.get(base.libraries[13].name)!.description = `X${long.slice(1, NPM_DESCRIPTION_LIMIT)}`;
    });
    const moved = await generateFromNpm(tiers, base, other);
    expect(diffCatalogs(base, moved.catalog, "npm").join("\n")).toContain(".description");
  });

  it("exits 2 naming the library when its release cannot be read, rather than skipping it", async () => {
    const { fetchManifest } = npm((m) => m.delete("@cosyte/ncpdp"));
    const r = await runMain(["check", "--npm"], fetchManifest);
    expect(r.code).toBe(2);
    expect(r.out).toContain("could not read @cosyte/ncpdp's latest release from npm");
  });

  it("refuses --npm with --self or --root, so one run reads one source", () => {
    expect(run(["check", "--npm", "--self"]).code).toBe(2);
    expect(run(["check", "--npm", "--root", "/tmp"]).code).toBe(2);
  });
});
