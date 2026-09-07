/**
 * Guards the ONE irreversible-shaped hazard in re-pinning js-yaml: the RELEASE PATH.
 *
 * WHAT THE PREVIOUS MANIFEST CLAIMED, AND WHY IT MATTERED. `drift-manifest.json` version 1 recorded
 * the js-yaml 3.x reach as a KNOWN RESIDUAL that was "not pinnable": js-yaml 3.14.2 arrives through
 * `read-yaml-file@1.1.0` (`@manypkg/get-packages`, `@changesets/cli`) and calls `yaml.safeLoad`,
 * which js-yaml 4 removed, so forcing it up was said to break the release tooling. That reasoning
 * is true of the 4.x MAJOR and false of the 3.x BRANCH, which still ships `safeLoad`; the residual
 * outlived its own premise and the branch stayed inside a cited advisory's vulnerable range.
 *
 * WHY IT IS ASSERTED RATHER THAN ARGUED. A release path that cannot load its YAML reader fails
 * AFTER a version commit has already been made, which is a state no test after the fact can undo.
 * So this suite RUNS the enumeration rather than reading the pinned version and reasoning about it:
 * the argument is exactly the kind that reads true while being wrong.
 *
 * OFFLINE BY CONSTRUCTION. Everything here reads this checkout and this checkout's `node_modules`.
 * No request is made.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

/**
 * Resolve a module the way `@changesets/cli` itself resolves it.
 *
 * `@manypkg/get-packages` is the cli's OWN dependency, not this workspace's, and pnpm's strict
 * `node_modules` is what makes that distinction real: resolving from the repo root would fail, and
 * papering over that with a hoist would test a tree the release path does not have. So the require
 * is created FROM the cli's manifest, which is the tree `changeset` runs in.
 */
const requireFromChangesets = createRequire(
  fileURLToPath(import.meta.resolve("@changesets/cli/package.json")),
);

const scratches: string[] = [];

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway git repository carrying THIS workspace's manifests, ready for the real `changeset`
 * binary to be pointed at.
 *
 * WHY A COPY RATHER THAN THIS CHECKOUT, AND IT IS NOT SQUEAMISHNESS. `changeset status` answers a
 * question about GIT before it answers one about YAML: it resolves the configured `baseBranch`,
 * diffs against it, and exits 1 when packages changed with no changeset pending. None of those
 * inputs are properties of the js-yaml pin, and all of them differ between a developer's clone and
 * a CI checkout, which has no local `main` branch at all. Grading the pin through that exit code is
 * how the FIRST attempt at this change went red in CI while passing locally: the tooling had
 * enumerated the workspace perfectly and the assertion was about something else.
 *
 * So the git state is CONSTRUCTED and the YAML stays real: `pnpm-workspace.yaml` and every
 * package.json are copied byte for byte out of this checkout, so the file the release tooling
 * parses with read-yaml-file (and therefore with js-yaml 3.x) is the one this repository ships.
 *
 * @returns The scratch repository's path.
 */
function scratchWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "release-tooling-yaml-"));
  scratches.push(dir);

  copyFileSync(join(REPO_ROOT, "package.json"), join(dir, "package.json"));
  // Byte for byte: this is the file whose parse is under test.
  copyFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), join(dir, "pnpm-workspace.yaml"));
  mkdirSync(join(dir, ".changeset"), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, ".changeset", "config.json"),
    join(dir, ".changeset", "config.json"),
  );

  for (const entry of readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(REPO_ROOT, "packages", entry.name, "package.json");
    mkdirSync(join(dir, "packages", entry.name), { recursive: true });
    copyFileSync(source, join(dir, "packages", entry.name, "package.json"));
  }
  return dir;
}

/** Commit the scratch tree on the branch `.changeset/config.json` names as the base. */
function commitScratch(dir: string): void {
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8", timeout: 60_000 });
  git("init", "-q", "-b", "main", ".");
  git("config", "user.email", "release-tooling-probe@example.com");
  git("config", "user.name", "release tooling probe");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  const committed = git("commit", "-qm", "workspace manifests", "--no-verify");
  expect(committed.status, `scratch commit failed: ${committed.stderr}`).toBe(0);
}

describe("AC11: the release tooling still enumerates this workspace on the new js-yaml pins", () => {
  it("enumerates every workspace package through the pnpm workspace file", async () => {
    // `getPackages` is the call `changeset version`, `changeset status` and `changeset publish` all
    // reach the workspace through, and for a pnpm workspace it gets there by READING
    // pnpm-workspace.yaml with read-yaml-file, which is the js-yaml 3.x consumer in question. If
    // the pinned 3.x release had dropped `safeLoad`, this throws.
    const { getPackages } = requireFromChangesets("@manypkg/get-packages");
    const found = await getPackages(REPO_ROOT);

    expect(found.tool).toBe("pnpm");
    expect(found.root.packageJson.name).toBe("cosyte-config");
    // Enumerated, not merely non-empty: a reader that returned the root alone would also "succeed".
    expect(found.packages.length).toBeGreaterThanOrEqual(8);
    expect(
      found.packages.map((p: { packageJson: { name: string } }) => p.packageJson.name),
    ).toEqual(
      expect.arrayContaining([
        "@cosyte/eslint-config",
        "@cosyte/prettier-config",
        "@cosyte/script-utils",
        "@cosyte/tsconfig",
        "@cosyte/tsup-config",
        "@cosyte/vitest-config",
      ]),
    );
  });

  it("resolves js-yaml 3.x for read-yaml-file, and that copy still exports safeLoad", () => {
    // The residual's stated blocker, checked at the exact resolution the release path gets rather
    // than at the version the lockfile says. `safeLoad`, `safeLoadAll` and `safeDump` are the three
    // js-yaml 4 removed; read-yaml-file calls the first.
    const readYamlFile = requireFromChangesets.resolve("read-yaml-file");
    const requireFromReader = createRequire(readYamlFile);
    const version = requireFromReader("js-yaml/package.json").version as string;
    const yaml = requireFromReader("js-yaml") as Record<string, unknown>;

    expect(version.startsWith("3.")).toBe(true);
    expect(typeof yaml.safeLoad, `js-yaml ${version} must still export safeLoad`).toBe("function");
    // It has to WORK, not merely be present: an exported stub that throws would pass a typeof check
    // and fail a release.
    expect((yaml.safeLoad as (text: string) => unknown)('packages:\n  - "packages/*"\n')).toEqual({
      packages: ["packages/*"],
    });
  });

  it("runs the real `changeset` binary over this workspace's manifests and names a package it could only have enumerated", () => {
    // The end to end shape: the tool this repo actually releases with, started the way its own
    // `release` script starts it. `status` enumerates and reports without writing anything, which
    // is the one release subcommand that is safe to run in a test.
    //
    // THE ASSERTION IS THE PACKAGE NAME, NOT ONLY THE EXIT CODE. A pending changeset names
    // `@cosyte/script-utils`; for `status` to report it, the binary had to read pnpm-workspace.yaml
    // through read-yaml-file, resolve `packages/*`, and match the changeset against a package it
    // found there. An exit code alone cannot tell that apart from a run that enumerated nothing.
    const dir = scratchWorkspace();
    writeFileSync(
      join(dir, ".changeset", "release-tooling-probe.md"),
      '---\n"@cosyte/script-utils": patch\n---\n\nrelease tooling enumeration probe\n',
      "utf8",
    );
    commitScratch(dir);

    const bin = join(REPO_ROOT, "node_modules", "@changesets", "cli", "bin.js");
    const run = spawnSync(process.execPath, [bin, "status"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    expect(output).not.toMatch(/safeLoad|is not a function/);
    expect(run.status, output).toBe(0);
    expect(output).toContain("@cosyte/script-utils");
  });
});
