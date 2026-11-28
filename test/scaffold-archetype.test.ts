/**
 * A scaffolded parser is born with the parser archetype in its source: a parse that returns the
 * model with `.warnings` on it, codes that carry the package's prefix, a strict mode, a vendor
 * profile hook, an `/arbitraries` entry point with `fast-check` as an optional peer, the three
 * property tests on the shared runners plus the immutability one, a deep freeze, and an
 * export-surface record for each entry point. And its public surface passes the internal-reference
 * gate from this repository's own source, the version every repository moves to next.
 *
 * It runs the real scaffolder, on a name with a hyphen too, because the prefix token is derived
 * from the name and the template is substituted and then formatted.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const INTERNAL_REFS = join(REPO_ROOT, "packages", "script-utils", "bin", "cosyte-internal-refs.js");
const CASES = [
  { name: "probe", pascal: "Probe", prefix: "PROBE" },
  { name: "x-ray", pascal: "XRay", prefix: "X_RAY" },
] as const;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-archetype-"));
  for (const { name } of CASES) {
    const r = spawnSync(process.execPath, [SCAFFOLDER, name, "--out", root], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`the scaffolder exited ${r.status}:\n${r.stderr ?? ""}`);
  }
}, 240_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Every file under a directory, relative to it. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path, base) : [path.slice(base.length + 1)];
  });
}

describe.each(CASES)("a parser scaffolded as $name", ({ name, pascal, prefix }) => {
  const read = (rel: string): string => readFileSync(join(root, name, ...rel.split("/")), "utf8");

  it("returns the model with its warnings on it, under strict mode and a profile hook", () => {
    const parse = read("src/parser/parse.ts");
    expect(parse).toMatch(new RegExp(`export function parse${pascal}\\(`));
    expect(parse).toMatch(/\): \w+Document \{/);
    expect(parse).toContain("readonly strict?: boolean;");
    expect(parse).toContain(`readonly profile?: ${pascal}Profile;`);
    expect(parse).toContain("readonly onWarning?:");
    expect(parse).toContain(
      "deepFreeze({ segments, fieldSeparator, trailingTerminator, warnings })",
    );
    expect(read("src/model/document.ts")).toContain(
      `readonly warnings: readonly ${pascal}Warning[];`,
    );
    expect(read("src/profiles/define.ts")).toContain(`export function define${pascal}Profile(`);
  });

  it("gives every code the package's prefix, in registries named for it", () => {
    expect(read("src/parser/warnings.ts")).toContain(`export const ${prefix}_WARNING_CODES = {`);
    expect(read("src/errors.ts")).toContain(`export const ${prefix}_FATAL_CODES = {`);
    expect(read("src/errors.ts")).toContain(`export const ${prefix}_PROFILE_CODES = {`);
    const source = files(join(root, name, "src"))
      .map((rel) => read(`src/${rel}`))
      .join("\n");
    const codes = [...source.matchAll(/^\s+(\w+): "(\w+)",$/gm)].filter(([, key]) =>
      /^[A-Z0-9_]+$/.test(key ?? ""),
    );
    expect(codes.length).toBe(6);
    for (const [, key, value] of codes) {
      expect(value).toBe(key);
      expect(value?.startsWith(`${prefix}_`), value).toBe(true);
    }
  });

  it("publishes /arbitraries with fast-check as an optional peer the root never loads", () => {
    const manifest = JSON.parse(read("package.json"));
    expect(Object.keys(manifest.exports)).toEqual([".", "./arbitraries", "./package.json"]);
    expect(manifest.typesVersions).toEqual({
      "*": { arbitraries: ["./dist/arbitraries.d.ts"] },
    });
    expect(manifest.peerDependencies).toEqual({ "fast-check": "^4.0.0" });
    expect(manifest.peerDependenciesMeta).toEqual({ "fast-check": { optional: true } });
    for (const rel of files(join(root, name, "src")).filter((f) => !f.startsWith("arbitraries"))) {
      expect(read(`src/${rel}`), rel).not.toContain("fast-check");
    }
    expect(read("tsup.config.ts")).toContain('arbitraries: "src/arbitraries/index.ts"');
  });

  it("proves the three archetype properties and immutability with the shared runners", () => {
    const property = (file: string): string => read(`test/property/${file}.property.test.ts`);
    expect(property("round-trip")).toContain("roundTripProperty({");
    expect(property("idempotent-normalize")).toContain("idempotentNormalizeProperty({");
    expect(property("lenient")).toContain("lenientNeverThrowsProperty({");
    expect(property("immutability")).toContain("immutabilityProperty({");
    for (const file of files(join(root, name, "test", "property"))) {
      expect(read(`test/property/${file}`), file).not.toMatch(/fc\.assert|numRuns/);
    }
  });

  it("records the export surface of each entry point under its emitted names", () => {
    const record = (file: string): string[] =>
      (JSON.parse(read(`release/${file}`)).exports as { name: string }[]).map((e) => e.name);
    expect(record("public-api.json")).toEqual(
      expect.arrayContaining([`parse${pascal}`, `${prefix}_WARNING_CODES`, `${pascal}ParseError`]),
    );
    expect(record("public-api-arbitraries.json")).toContain(`specClean${pascal}Text`);
    expect(read("test/scripts/api-surface.test.ts")).toContain("public-api-arbitraries.json");
  });

  it("describes no work in phases in its source or its documents", () => {
    // A timed phase of the scaling gate (test/perf, vitest.perf.config.ts) is the perf kit's own
    // word for a measurement, and the gate below lets it through; this holds what a reader reads.
    const read_ = ["README.md", "AGENTS.md", "CLAUDE.md"];
    for (const dir of ["src", "docs-content"]) {
      for (const rel of files(join(root, name, dir))) read_.push(`${dir}/${rel}`);
    }
    for (const rel of read_) expect(read(rel), rel).not.toMatch(/\bphases?\b/i);
  });

  it("passes the internal-reference gate from this repository's source", () => {
    const repo = join(root, name);
    for (const args of [
      ["init", "-q"],
      ["add", "--", "."],
    ]) {
      const git = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      expect(git.status, `${git.stdout ?? ""}${git.stderr ?? ""}`).toBe(0);
    }
    const r = spawnSync(process.execPath, [INTERNAL_REFS], { cwd: repo, encoding: "utf8" });
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
  });
});
