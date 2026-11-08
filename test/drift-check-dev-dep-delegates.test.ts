/**
 * `devDepDelegates`: the standard's declaration that a repo delegating its verbs to @cosyte/process
 * need not declare the tools that package runs for it.
 *
 * Three things are held here. The declaration is TRUE of the package it names: every covered tool
 * is a dependency of packages/process (or, for vite, a non-optional peer of one), and the versions
 * `devDepVersions` asks for are the ones that package pins. The scaffold every parser is born from
 * grades CLEAN against the shipped dependencies group, so a new repo is not born in drift. And the
 * parameter widens nothing else: a repo without the delegate is still asked for every tool, and a
 * covered tool a wired repo does declare is still graded on its version.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { evaluateRepo } from "../scripts/drift-check.js";

const REPO_ROOT = process.cwd();
const MANIFEST = JSON.parse(readFileSync(join(REPO_ROOT, "drift-manifest.json"), "utf8"));
const GROUP = MANIFEST.baselines.package.groups.dependencies;
const REQUIREMENTS = GROUP.requirements as {
  devDepVersions: Record<string, string>;
  devDepDelegates: { package: string; covers: string[] }[];
};
const PROCESS_DIR = join(REPO_ROOT, "packages", "process");

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function readJson(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

const PROCESS = readJson(join(PROCESS_DIR, "package.json"));
const TEMPLATE = readJson(join(REPO_ROOT, "scripts", "parser-template", "package.json"));

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

/** Grade one package.json against the shipped dependencies group alone. */
function gradeDependencies(pkg: Manifest): string[] {
  const root = mkdtempSync(join(tmpdir(), "drift-delegates-"));
  TEMP_DIRS.push(root);
  mkdirSync(join(root, "subject"));
  writeFileSync(join(root, "subject", "package.json"), JSON.stringify(pkg), "utf8");
  const result = evaluateRepo({
    name: "subject",
    baselineName: "package",
    baseline: {
      repos: ["subject"],
      missingPackageJson: "skip",
      groups: { dependencies: GROUP },
    },
    root,
    probe: () => null,
  });
  expect(result.skipped, "the subject must be GRADED, not skipped").toBe(false);
  return (result.findings as { line: string }[]).map((f) => f.line);
}

function withDevDeps(pkg: Manifest, devDependencies: Record<string, string>): Manifest {
  return { ...pkg, devDependencies };
}

describe("the declaration is true of @cosyte/process", () => {
  const delegate = REQUIREMENTS.devDepDelegates.find((d) => d.package === "@cosyte/process");

  it("names @cosyte/process, the package in this workspace", () => {
    expect(delegate).toBeDefined();
    expect(PROCESS.name).toBe("@cosyte/process");
  });

  it("covers only names devDepVersions asks for", () => {
    for (const name of delegate?.covers ?? []) {
      expect(Object.keys(REQUIREMENTS.devDepVersions), name).toContain(name);
    }
  });

  it("covers only a dependency of the package, or a non-optional peer of one", () => {
    const deps = PROCESS.dependencies ?? {};
    for (const name of delegate?.covers ?? []) {
      if (deps[name] !== undefined) continue;
      const carriers = Object.keys(deps).filter((dep) => {
        const installed = readJson(join(PROCESS_DIR, "node_modules", dep, "package.json"));
        return (
          installed.peerDependencies?.[name] !== undefined &&
          installed.peerDependenciesMeta?.[name]?.optional !== true
        );
      });
      expect(
        carriers,
        `${name} is neither a dependency of @cosyte/process nor a peer of one`,
      ).not.toEqual([]);
    }
  });

  it("asks a repo for the versions @cosyte/process pins", () => {
    // A repo declaring exactly what the runner runs is not version drift, so the standard cannot
    // lag the runner it delegates to.
    const pins = Object.fromEntries(
      Object.entries(PROCESS.dependencies ?? {}).filter(
        ([name]) => name in REQUIREMENTS.devDepVersions,
      ),
    );
    expect(Object.keys(pins).sort()).toEqual([
      "@vitest/coverage-v8",
      "eslint",
      "prettier",
      "tsup",
      "typescript",
      "vitest",
    ]);
    const versionLines = gradeDependencies({ devDependencies: pins }).filter((line) =>
      /^devDep \S+: want .*, got /.test(line),
    );
    expect(versionLines).toEqual([]);
  });
});

describe("the scaffold is born wired and clean", () => {
  it("declares @cosyte/process and, of the tools it covers, only vitest, at exactly its pin", () => {
    const dev = TEMPLATE.devDependencies ?? {};
    expect(dev["@cosyte/process"]).toBeDefined();
    const covered = REQUIREMENTS.devDepDelegates.flatMap((d) => d.covers);
    expect(covered.filter((name) => dev[name] !== undefined)).toEqual(["vitest"]);
    expect(dev["vitest"]).toBe(PROCESS.dependencies?.["vitest"]);
  });

  it("grades clean against the shipped dependencies group", () => {
    expect(gradeDependencies(TEMPLATE)).toEqual([]);
  });
});

describe("the parameter widens nothing else", () => {
  it("NEGATIVE CONTROL: the scaffold without @cosyte/process is asked for every covered tool", () => {
    const dev = { ...(TEMPLATE.devDependencies ?? {}) };
    delete dev["@cosyte/process"];
    const lines = gradeDependencies(withDevDeps(TEMPLATE, dev));
    for (const name of [
      "typescript",
      "eslint",
      "vite",
      "@vitest/coverage-v8",
      "tsup",
      "prettier",
    ]) {
      expect(lines, name).toContain(
        `devDep ${name}: missing (want ${REQUIREMENTS.devDepVersions[name]})`,
      );
    }
  });

  it("still grades a covered tool the wired repo declares, on its version", () => {
    const lines = gradeDependencies(
      withDevDeps(TEMPLATE, {
        ...(TEMPLATE.devDependencies ?? {}),
        vitest: "4.1.12",
        tsup: "8.5.1",
      }),
    );
    expect(lines).toContain("devDep vitest: want 5.x, got 4.1.12");
    expect(lines).toContain("devDep tsup: want 9.x, got 8.5.1");
  });

  it("still asks a wired repo for a tool no delegate covers", () => {
    const dev = { ...(TEMPLATE.devDependencies ?? {}) };
    delete dev["@arethetypeswrong/cli"];
    expect(gradeDependencies(withDevDeps(TEMPLATE, dev))).toContain(
      "devDep @arethetypeswrong/cli: missing (want any)",
    );
  });
});
