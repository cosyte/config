/**
 * A scaffolded parser is born meeting the repo standards decided on 2026-11-07
 * (plans/standards.md): the community and agent files (RD3, RD6, ST26), the dotfiles (EN9), Dependabot
 * with a cooldown (EN5), generated changelogs (EN7, ST35), docs-content front matter and the
 * "Core concepts" label (RD5), Node 22, 24 and 26 (ST15), shared workflows pinned by commit (ST37,
 * ST38), the house README skeleton (ST36), the legal name in its copyright lines (ST2), and the
 * token grants the shared release workflow needs (plans/open-work.md).
 *
 * It runs the real scaffolder and grades what it emits, because the template is copied and then
 * substituted and formatted: the copy is what a new repository gets.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkReadme } from "../packages/script-utils/readme.js";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const NAME = "probe";

let root: string;
let repo: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-standards-"));
  const r = spawnSync(process.execPath, [SCAFFOLDER, NAME, "--out", root, "--title", "Probe"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`the scaffolder exited ${r.status}:\n${r.stdout ?? ""}${r.stderr ?? ""}`);
  }
  repo = join(root, NAME);
}, 180_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** What the shared release workflow's jobs request, and therefore what the caller must grant. */
const REQUIRED = {
  actions: "read",
  contents: "write",
  "id-token": "write",
  "pull-requests": "write",
};

/**
 * The `permissions:` map of one job under `jobs:`, or `null` when the job has no such block.
 *
 * A reader of this one shape (two-space job keys, four-space job fields, six-space grants), not a
 * YAML parser: the file it reads is generated from a template this repository owns, and a shape it
 * does not recognize reads as no block, which fails the assertion below rather than passing it.
 */
function jobPermissions(workflow: string, job: string): Record<string, string> | null {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return null;
  let inBlock = false;
  const grants: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^ {0,3}\S/.test(line)) break;
    if (/^ {4}permissions:\s*(#.*)?$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      if (inBlock) break;
      continue;
    }
    const grant = /^ {6}([a-z-]+):\s*([a-z]+)\s*(#.*)?$/.exec(line);
    if (inBlock && grant) grants[grant[1]!] = grant[2]!;
  }
  return inBlock ? grants : null;
}

const read = (rel: string): string => readFileSync(join(repo, ...rel.split("/")), "utf8");
const json = (rel: string): Record<string, any> => JSON.parse(read(rel));

describe("community, agent and editor files", () => {
  it("carries TRADEMARKS.md with the legal name", () => {
    expect(read("TRADEMARKS.md")).toContain("independent open-source project from Cosyte LLC");
  });

  it("enables the three crew bundles in .claude/settings.json, as hl7 does", () => {
    const settings = json(".claude/settings.json");
    expect(settings["extraKnownMarketplaces"]["cosyte-crew"]["source"]).toEqual({
      source: "github",
      repo: "cosyte/crew",
    });
    expect(settings["enabledPlugins"]).toEqual({
      "healthcare-integration@cosyte-crew": true,
      "software-engineering@cosyte-crew": true,
      "open-source-maintenance@cosyte-crew": true,
    });
  });

  it("carries the dotfiles: .editorconfig, .gitattributes, the standard .npmrc and CODEOWNERS", () => {
    expect(read(".editorconfig")).toContain("end_of_line = lf");
    expect(read(".gitattributes")).toBe("* text=auto eol=lf\n");
    expect(read(".npmrc")).toBe(
      "engine-strict=true\nsave-exact=false\nauto-install-peers=true\nstrict-peer-dependencies=false\n",
    );
    expect(read(".github/CODEOWNERS").split("\n")).toContain("* @NSchatz");
  });

  it("states the legal name in LICENSE and in the README's License section", () => {
    expect(read("LICENSE")).toContain("Copyright (c) 2026 Cosyte LLC\n");
    expect(read("README.md")).toContain("MIT, Cosyte LLC.");
  });
});

describe("template file names", () => {
  it("emits each `.tmpl` template file under its own name, without the suffix", () => {
    // scripts/parser-template names a file `.tmpl` when it does not parse until generated, so
    // CodeQL does not read it (scripts/scaffold-parser.mjs, TEMPLATE_SUFFIX).
    const emitted = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? emitted(join(dir, entry.name))
          : [join(dir, entry.name).slice(repo.length + 1)],
      );
    const files = emitted(repo).filter((f) => !f.startsWith("node_modules"));
    expect(files.filter((f) => f.endsWith(".tmpl"))).toEqual([]);
    expect(files).toContain(join("src", "index.ts"));
    expect(files).toContain(join("test", "property", "round-trip.property.test.ts"));
  });
});

describe("Dependabot", () => {
  const config = (): string => read(".github/dependabot.yml");

  it("updates npm and GitHub Actions weekly, grouped, a day after a release", () => {
    const text = config();
    const blocks = text.split(/\n(?= {2}- package-ecosystem:)/).slice(1);
    expect(blocks.map((b) => /package-ecosystem: (\S+)/.exec(b)?.[1])).toEqual([
      "npm",
      "github-actions",
    ]);
    for (const block of blocks) {
      expect(block).toMatch(/schedule:\n\s+interval: weekly/);
      expect(block).toMatch(/cooldown:\n\s+default-days: 1/);
      expect(block).toMatch(/\n {4}groups:\n/);
    }
    // Every group takes minor and patch updates only, so a major arrives in a pull request of its
    // own rather than bundled with safe bumps.
    const groups = text.split(/\n {6}(?=[a-z-]+:\n)/).slice(1);
    expect(groups.length).toBe(3);
    for (const group of groups) {
      expect(group, group).toMatch(/update-types:\n\s+- minor\n\s+- patch(?:\n|$)/);
      expect(group, group).not.toMatch(/- major/);
    }
    // reviewdog/action-actionlint installs actionlint through a script from a fork, piped to
    // bash, from v1.75.0; Dependabot must not propose it.
    expect(blocks[1]).toMatch(
      /ignore:\n(?:\s+#.*\n)*\s+- dependency-name: "reviewdog\/action-actionlint"/,
    );
  });
});

describe("releases", () => {
  it("has Changesets write the changelog", () => {
    expect(json(".changeset/config.json")["changelog"]).toBe("@changesets/cli/changelog");
    expect(read("CHANGELOG.md")).toBe("# Changelog\n");
    expect(read(".changeset/README.md")).toContain("do not hand-edit `CHANGELOG.md`");
  });
});

describe("docs-content", () => {
  it("gives every page a description in its front matter", () => {
    const pages = readdirSync(join(repo, "docs-content")).filter((f) => f.endsWith(".md"));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(read(`docs-content/${page}`))?.[1] ?? "";
      expect(front, page).toMatch(/^description: "\S[^"]*"$/m);
    }
  });

  it('labels the concepts category "Core concepts"', () => {
    const labels = JSON.stringify(json("docs-content/sidebars.json"));
    expect(labels).toContain('"label":"Core concepts"');
    expect(labels).not.toContain("Core Concepts");
  });
});

describe("Node and the toolchain", () => {
  it("declares engines >=22 and runs CI on 22, 24 and 26", () => {
    expect(json("package.json")["engines"]).toEqual({ node: ">=22" });
    expect(read(".github/workflows/ci.yml")).toContain(`node-versions: '["22", "24", "26"]'`);
  });

  it("pins the shared configs on the 0.1 line and runs the shared dash gate", () => {
    const manifest = json("package.json");
    for (const [name, range] of Object.entries(
      manifest["devDependencies"] as Record<string, string>,
    )) {
      if (name.startsWith("@cosyte/")) expect(range, name).toMatch(/^\^0\.1\.\d+$/);
    }
    expect(manifest["scripts"]["check:no-emdash"]).toBe(
      "bash node_modules/@cosyte/script-utils/check-no-emdash.sh",
    );
  });
});

describe("workflows", () => {
  const workflows = (): string[] =>
    readdirSync(join(repo, ".github", "workflows")).filter((f) => f.endsWith(".yml"));

  it("calls every shared workflow at one published reference, pinned by commit with its name", () => {
    // ST37. The two security callers included: @cosyte/process's trigger surface accepts any
    // published reference, so they move with the rest.
    const refs = new Set<string>();
    let callers = 0;
    for (const file of workflows()) {
      for (const line of read(`.github/workflows/${file}`).split("\n")) {
        const uses = /^\s*(?:- )?uses: (\S+)(.*)$/.exec(line);
        if (uses === null) continue;
        expect(uses[1], `${file}: ${line.trim()}`).toMatch(/@[0-9a-f]{40}$/);
        expect(uses[2], `${file}: ${line.trim()}`).toMatch(/^ # \S+/);
        if (uses[1]?.startsWith("cosyte/.github/")) {
          callers += 1;
          refs.add(`${uses[1].split("@")[1]}${uses[2]}`);
        }
      }
    }
    expect(callers).toBe(5);
    expect(refs.size, [...refs].join("\n")).toBe(1);
    expect([...refs][0]).toMatch(/ # workflows-\d{4}-\d{2}-\d{2}-[0-9a-f]{12}$/);
  });

  it("puts a timeout on every job that runs steps of its own", () => {
    // A job that calls a reusable workflow cannot carry `timeout-minutes`: the shared workflow
    // sets it on its own jobs. A job with `runs-on` is ours, and must have one.
    for (const file of workflows()) {
      const jobs = read(`.github/workflows/${file}`)
        .split(/\n(?= {2}[a-z][\w-]*:\n)/)
        .slice(1);
      for (const job of jobs) {
        if (/\n {4}runs-on:/.test(job)) expect(job, file).toMatch(/\n {4}timeout-minutes: \d+/);
      }
    }
  });

  it("does not run CodeQL on a private repository, where it needs paid Code Security", () => {
    // The operator's rule: nothing paid is turned on. CodeQL is free on a public repository and
    // needs GitHub Code Security on a private one; Actions minutes are covered by the plan.
    expect(read(".github/workflows/codeql.yml")).toContain(
      "if: ${{ github.event.repository.private != true }}",
    );
  });

  it("runs the em and en dash gate on every pull request, title and body included", () => {
    const gate = read(".github/workflows/no-emdash.yml");
    expect(gate).toContain("types: [opened, synchronize, reopened, edited]");
    expect(gate).toContain("cosyte/.github/.github/workflows/gate-no-emdash-install.yml@");
  });
});

describe("the README", () => {
  it("follows the house skeleton the README gate checks", () => {
    expect(checkReadme(read("README.md"), json("package.json"))).toEqual([]);
  });
});

describe("the Release caller", () => {
  it("grants exactly the four permissions the shared release workflow asks for", () => {
    expect(read(".github/workflows/release.yml")).toContain(
      "uses: cosyte/.github/.github/workflows/release.yml@",
    );
    expect(jobPermissions(read(".github/workflows/release.yml"), "release")).toEqual(REQUIRED);
  });

  it("NEGATIVE CONTROL: the same file without the block reads as having none", () => {
    // Without this, the case above is satisfied by a reader that returns the expected map for any
    // input. The block is cut out of the emitted file, and nothing else is changed.
    const release = read(".github/workflows/release.yml");
    const withoutBlock = release
      .split("\n")
      .filter((line) => !/^ {4}permissions:/.test(line) && !/^ {6}[a-z-]+: (read|write)/.test(line))
      .join("\n");
    expect(withoutBlock).not.toBe(release);
    expect(jobPermissions(withoutBlock, "release")).toBeNull();
  });
});
