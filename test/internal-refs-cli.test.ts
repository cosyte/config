/**
 * The internal-reference gate's command-line form (ST34): a repository runs
 * `node node_modules/@cosyte/script-utils/internal-refs.js` with its axes in
 * `scripts/internal-refs.json`, and no caller script.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeScratchRepo, type ScratchRepo } from "./support/internal-refs-repo.js";

const GATE = join(import.meta.dirname, "..", "packages", "script-utils", "internal-refs.js");

/** The axes a repository keeps in its file: complete, and passing over a clean README. */
const AXES = {
  $comment: "Notes like this one are ignored.",
  projectPrefixes: ["HL7", "CCDA", "MLLP"],
  standardsDesignations: [String.raw`HL7-(?:V2|V3|CDA|FHIR|OMG|\d{3,4}[A-Z]?)`],
  surfacePaths: ["README.md"],
  accountedTarballFiles: [],
};

const repos: ScratchRepo[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.dispose();
});

function repo(readme: string, config: unknown = AXES): ScratchRepo {
  const scratch = makeScratchRepo("irefs-cli", readme);
  repos.push(scratch);
  if (config !== null) {
    scratch.write("scripts/internal-refs.json", JSON.stringify(config, null, 2));
    scratch.track("scripts/internal-refs.json");
  }
  return scratch;
}

function cli(cwd: string, args: string[] = []): { code: number; out: string } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("the internal-reference gate from the command line", () => {
  it("exits 0 over a clean repository, reading its axes from scripts/internal-refs.json", () => {
    const r = cli(repo("# Scratch\n\nA parser for HL7-V2 messages.\n").root);
    expect(r.code, r.out).toBe(0);
  });

  it("exits 1 and names the place on an internal identifier", () => {
    const r = cli(repo("# Scratch\n\nItem HL7-N7 landed here.\n").root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("README.md:3");
    expect(r.out).toContain("[internal project identifier]");
  });

  it.each([
    ["an ADR path segment", "Recorded in docs/adr/0001-scope.md.", "[ADR reference]"],
    ["plural phase language", "Phases 1 to 6 shipped together.", "[phase or wave language]"],
  ])("catches %s, which ten of the eleven per-repository copies caught", (_label, line, rule) => {
    const r = cli(repo(`# Scratch\n\n${line}\n`).root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(rule);
  });

  it("takes a case-insensitive extra rule from JSON as { source, flags }", () => {
    const config = {
      ...AXES,
      extraRules: [
        {
          id: "roadmap-citation",
          name: "internal roadmap citation",
          pattern: { source: String.raw`\b(?:our|the|this) roadmap\b`, flags: "i" },
          positives: ["As Our Roadmap says"],
          negatives: ["a roadmap of the standard"],
        },
      ],
    };
    const r = cli(repo("# Scratch\n\nThis Roadmap says so.\n", config).root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("[internal roadmap citation]");
  });

  it("reads another file with --config", () => {
    const scratch = repo("# Scratch\n\nItem HL7-N7 landed here.\n", null);
    scratch.write("gates/irefs.json", JSON.stringify(AXES));
    scratch.track("gates/irefs.json");
    expect(cli(scratch.root, ["--config", "gates/irefs.json"]).code).toBe(1);
  });

  it("exits 2, not 1, when the file is missing, so a broken gate is not read as hits", () => {
    const r = cli(repo("# Scratch\n", null).root);
    expect(r.code).toBe(2);
    expect(r.out).toContain("could not read scripts/internal-refs.json");
  });

  it.each([
    ["exitCodes", { ...AXES, exitCodes: { clean: 0, hits: 0, refuse: 0 } }],
    ["repoRoot", { ...AXES, repoRoot: "/" }],
  ])("refuses a file that sets %s, which the command-line form owns", (key, config) => {
    const r = cli(repo("# Scratch\n", config).root);
    expect(r.code).toBe(2);
    expect(r.out).toContain(`sets ${key}`);
  });

  it("refuses an axis the gate has never heard of, at exit 2", () => {
    const r = cli(repo("# Scratch\n", { ...AXES, skipRules: ["all"] }).root);
    expect(r.code).toBe(2);
  });

  it("refuses an argument it does not accept", () => {
    expect(cli(repo("# Scratch\n").root, ["--fix"]).code).toBe(2);
  });
});
