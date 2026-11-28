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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findVersionDeclarations } from "../packages/process/src/sync-version.js";
import { checkReadme } from "../packages/script-utils/readme.js";
import { checkReleasePr, readReleasePrInput } from "../packages/script-utils/release-pr.js";
import { exemptionReasons, parseYamlSubset } from "../scripts/install-hardening.mjs";

import {
  SCOPED_COMMIT,
  SCOPED_REFERENCE,
  SCOPED_TITLE,
  dependabotTitles,
  ecosystemOf,
  updateBlocks,
} from "./support/shared-workflows.js";

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
    // The setting changes here first, so a new repository takes this repository's own file. With
    // `save-exact=true` a plain `pnpm add` writes an exact version rather than a caret.
    expect(read(".npmrc")).toBe(readFileSync(join(REPO_ROOT, ".npmrc"), "utf8"));
    expect(read(".npmrc").split("\n")).toContain("save-exact=true");
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

  it("leaves the commit-pinned cosyte/.github workflows to move by hand", () => {
    // Every shared-workflow caller is pinned to the commit of a published `workflows-*` reference
    // (ST37). Without this ignore, Dependabot offers such a pin the newest commit on cosyte/.github's
    // main, which is not a published reference.
    const actions = config().split(/\n(?= {2}- package-ecosystem:)/)[2] ?? "";
    expect(actions).toMatch(/package-ecosystem: github-actions/);
    expect(actions).toMatch(
      /\n {4}ignore:\n(?:(?: {6}#.*| {6}- dependency-name: .*)\n)*? {6}- dependency-name: "cosyte\/\.github\*"(?:\n|$)/,
    );
  });

  it("titles every Dependabot pull request in the scoped form the title check requires", () => {
    // Dependabot's title is its commit message. Without `prefix: chore` and `include: scope` it is
    // `Bump ...` or `chore: bump ...`, which the shared title check refuses, so every Dependabot
    // pull request in a new repository would open red.
    const blocks = updateBlocks(config());
    expect(blocks.map(ecosystemOf)).toEqual(["npm", "github-actions"]);
    for (const block of blocks) {
      for (const title of dependabotTitles(block))
        expect(title, ecosystemOf(block)).toMatch(SCOPED_TITLE);
    }
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

  it("gives every page a sidebar_label and no sidebar_position, since the sidebar sets the order", () => {
    const pages = readdirSync(join(repo, "docs-content")).filter((f) => f.endsWith(".md"));
    for (const page of pages) {
      const front = /^---\n([\s\S]*?)\n---\n/.exec(read(`docs-content/${page}`))?.[1] ?? "";
      expect(front, page).toMatch(/^sidebar_label: \S/m);
      expect(front, page).not.toMatch(/^sidebar_position:/m);
    }
  });
});

describe("Node and the toolchain", () => {
  it("declares engines >=22.0.0 and runs CI on 22, 24 and 26", () => {
    expect(json("package.json")["engines"]).toEqual({ node: ">=22.0.0" });
    expect(read(".github/workflows/ci.yml")).toContain(`node-versions: '["22", "24", "26"]'`);
  });

  it("pins the shared configs on the 0.1 line and runs the shared dash gate", () => {
    const manifest = json("package.json");
    for (const [name, range] of Object.entries(
      manifest["devDependencies"] as Record<string, string>,
    )) {
      if (name.startsWith("@cosyte/")) expect(range, name).toMatch(/^\^0\.1\.\d+$/);
    }
    expect(manifest["scripts"]["check:no-emdash"]).toBe("cosyte-no-emdash");
  });
});

describe("the package shape", () => {
  // What a released library's manifest carries, so a new parser does not start a version behind.

  it("points its homepage at its page on the docs site", () => {
    expect(json("package.json")["homepage"]).toBe(`https://docs.cosyte.com/${NAME}`);
  });

  it("lists every notice it carries in `files`, and carries every file it lists", () => {
    const files = json("package.json")["files"] as string[];
    expect(files).toEqual(["dist", "README.md", "LICENSE", "TRADEMARKS.md", "CHANGELOG.md"]);
    for (const file of files.filter((f) => f !== "dist")) {
      expect(existsSync(join(repo, file)), file).toBe(true);
    }
  });

  it("runs each shared gate and tool through its published command, under the shared name", () => {
    const scripts = json("package.json")["scripts"] as Record<string, string>;
    expect({
      attw: scripts["attw"],
      "pack:docs": scripts["pack:docs"],
      "check:no-emdash": scripts["check:no-emdash"],
      "check:no-internal-refs": scripts["check:no-internal-refs"],
      "check:readme": scripts["check:readme"],
      "check:claude-card": scripts["check:claude-card"],
      "check:catalog": scripts["check:catalog"],
      "check:docs-content": scripts["check:docs-content"],
      "check:docs-reference": scripts["check:docs-reference"],
      "docs:reference": scripts["docs:reference"],
      "test:perf": scripts["test:perf"],
      "quality:check": scripts["quality:check"],
      "quality:mutation": scripts["quality:mutation"],
      "quality:raise": scripts["quality:raise"],
      mutate: scripts["mutate"],
      "mutate:full": scripts["mutate:full"],
      "api-surface": scripts["api-surface"],
    }).toEqual({
      attw: "cosyte-attw",
      "pack:docs": "cosyte-process pack-docs",
      "check:no-emdash": "cosyte-no-emdash",
      "check:no-internal-refs": "cosyte-internal-refs",
      "check:readme": "cosyte-readme",
      "check:claude-card": "cosyte-claude-card",
      "check:catalog": "cosyte-catalog",
      "check:docs-content": "cosyte-docs-content",
      "check:docs-reference": "cosyte-docs-reference --check",
      "docs:reference": "cosyte-docs-reference",
      "test:perf": "vitest run --config vitest.perf.config.ts",
      "quality:check": "cosyte-ratchet check --skip mutation",
      "quality:mutation": "cosyte-ratchet check --skip coverage",
      "quality:raise": "cosyte-ratchet raise",
      mutate: "cosyte-mutate",
      "mutate:full": "cosyte-mutate full",
      "api-surface": "tsx scripts/api-surface.ts",
    });
    // No local copy of a shared gate or tool rides along beside its command.
    for (const copy of ["scripts/attw.mjs", "scripts/build-docs-artifacts.sh"]) {
      expect(existsSync(join(repo, ...copy.split("/"))), copy).toBe(false);
    }
  });

  it("ends prepublishOnly with the types check, after the gate and the build", () => {
    expect(json("package.json")["scripts"]["prepublishOnly"]).toBe(
      "pnpm clean && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm attw",
    );
  });

  it("carries the configs each script names", () => {
    expect(read("vitest.perf.config.ts")).toContain('include: ["test/perf/**/*.perf.ts"]');
    expect(read("stryker.config.mjs")).toContain('vitestConfig: "vitest.mutation.config.ts"');
    expect(read("vitest.mutation.config.ts")).toContain('"test/perf/**"');
    const refs = json("scripts/internal-refs.json");
    expect((refs["projectPrefixes"] as string[]).length).toBeGreaterThan(0);
    for (const path of refs["surfacePaths"] as string[]) {
      expect(existsSync(join(repo, path)), path).toBe(true);
    }
  });

  it("holds coverage to quality-floor.json, the one place the number is written", () => {
    expect(json("quality-floor.json")["packages"]["."]["coverage"]).toEqual({
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
    });
    const config = read("vitest.config.ts");
    expect(config).toContain('new URL("./quality-floor.json", import.meta.url)');
    expect(config).toContain("coverageThresholds: coverageFloor()");
    expect(config).not.toMatch(/coverageThresholds: \{/);
  });

  it("records its export surface for the root entry point, under the emitted names", () => {
    const record = json("release/public-api.json");
    expect(record["typescript"]).toBe(json("package.json")["devDependencies"]["typescript"]);
    const names = (record["exports"] as { name: string }[]).map((e) => e.name);
    expect(names).toContain("parseProbe");
    expect(record["exportCount"]).toBe(names.length);
    expect(read("release/public-api.json")).not.toContain("{{");
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
    expect(callers).toBe(7);
    expect(refs.size, [...refs].join("\n")).toBe(1);
    expect([...refs][0]).toBe(`${SCOPED_COMMIT} # ${SCOPED_REFERENCE}`);
  });

  it("checks every pull request title with the shared check that requires a scope", () => {
    const check = read(".github/workflows/pr-title.yml");
    expect(check).toContain("types: [opened, synchronize, reopened, edited]");
    expect(check).toContain(
      `uses: cosyte/.github/.github/workflows/pr-title.yml@${SCOPED_COMMIT} # ${SCOPED_REFERENCE}`,
    );
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

  it("runs the internal-reference gate on every pull request, through the installing form", () => {
    const gate = read(".github/workflows/no-internal-refs.yml");
    // The job id is the first half of the context a ruleset requires.
    expect(gate).toMatch(
      /\n {2}no-internal-refs:\n {4}uses: cosyte\/\.github\/\.github\/workflows\/gate-no-internal-refs-install\.yml@/,
    );
    expect(gate).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/);
    expect(gate).not.toMatch(/\n {4}with:/);
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

describe("the install hardening", () => {
  // A fresh scaffold resolves the same toolchain this repository does, so it meets the same
  // packages whose trust evidence fell between releases. Without the same exclusions its first
  // `pnpm install` stops with ERR_PNPM_TRUST_DOWNGRADE. The list is read from this repository's
  // own pnpm-workspace.yaml on every run, so an exclusion added there and not to the template
  // reds this case instead of drifting.
  const own = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");

  it("excludes from the trust policy exactly what this repository's own workspace file excludes", () => {
    const wanted = parseYamlSubset(own).trustPolicyExclude;
    expect(Array.isArray(wanted) && wanted.length > 0, "config's own list must be read").toBe(true);
    const settings = parseYamlSubset(read("pnpm-workspace.yaml"));
    expect(settings.trustPolicy).toBe("no-downgrade");
    expect(settings.trustPolicyExclude).toEqual(wanted);
  });

  it("exempts first-party packages from the release-age floor exactly as this repository does", () => {
    // Without the exemption a new repo cannot install a @cosyte package on the day it is published.
    const wanted = parseYamlSubset(own).minimumReleaseAgeExclude;
    expect(Array.isArray(wanted) && wanted.length > 0, "config's own list must be read").toBe(true);
    const settings = parseYamlSubset(read("pnpm-workspace.yaml"));
    expect(settings.minimumReleaseAge).toBe(1440);
    expect(settings.minimumReleaseAgeExclude).toEqual(wanted);
    const reasons = exemptionReasons(read("pnpm-workspace.yaml"), "minimumReleaseAgeExclude");
    expect(reasons.length).toBeGreaterThan(0);
    for (const { entry, reason } of reasons) {
      expect(reason, `${entry} carries no "# reason:" comment`).toMatch(/^reason:\s*\S/i);
    }
  });

  it("gives every exclusion a recorded reason, as the install-hardening gate requires", () => {
    const reasons = exemptionReasons(read("pnpm-workspace.yaml"), "trustPolicyExclude");
    expect(reasons.length).toBeGreaterThan(0);
    for (const { entry, reason } of reasons) {
      expect(reason, `${entry} carries no "# reason:" comment`).toMatch(/^reason:\s*\S/i);
    }
  });
});

describe("the release pull request", () => {
  // A library's Version Packages pull request went red after the change behind it had merged green:
  // a VERSION mutant no test was linked to, an API reference the version script did not regenerate,
  // and a changeset bullet the release refused. A scaffold is born with the fixes, and graded by the
  // same check its CI runs, `cosyte-release-pr`, on the last two; the release pull request's mutation
  // job proves the first.

  it("passes the release pull request check as it is emitted", () => {
    const input = readReleasePrInput(repo);
    expect(input.declaresVersion, "the scaffold must be graded on the version rules").toBe(true);
    expect(checkReleasePr(input)).toEqual([]);
  });

  it("carries a VERSION test that imports the source afresh inside its test body", () => {
    const text = read("test/version.test.ts");
    expect(text).not.toMatch(/^import [^\n]*from "\.\.\/src/m);
    expect(text).toContain(
      'vi.resetModules();\n    const { VERSION } = await import("../src/index.js");',
    );
  });

  it("declares VERSION in the one form the version script's sync rewrites", () => {
    expect(findVersionDeclarations(read("src/index.ts"))).toHaveLength(1);
    expect(json("package.json")["scripts"]["version"]).toBe(
      "changeset version && cosyte-process sync-version && cosyte-docs-reference && cosyte-process format",
    );
  });

  it("runs the check on every pull request, from the package script", () => {
    expect(json("package.json")["scripts"]["check:release-pr"]).toBe("cosyte-release-pr");
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/\n {2}release-pr:\n/);
    expect(ci).toContain("- run: pnpm check:release-pr");
  });

  it("NEGATIVE CONTROL: the same tree without its reference step fails", () => {
    // Without this, the first case passes for a check that finds nothing. The step is taken out of
    // the emitted input in memory, and nothing else changes.
    const input = readReleasePrInput(repo);
    const scripts = {
      ...input.scripts,
      version: "changeset version && cosyte-process sync-version && cosyte-process format",
    };
    expect(checkReleasePr({ ...input, scripts }).map((f) => f.rule)).toEqual(["version-script"]);
  });
});
