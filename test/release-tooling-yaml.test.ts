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
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

  it("runs the real `changeset` binary over this workspace and it exits 0", () => {
    // The end to end shape: the tool this repo actually releases with, started the way its own
    // `release` script starts it, over this tree. `status` enumerates and reports without writing
    // anything, which is the one release subcommand that is safe to run in a test.
    const bin = join(REPO_ROOT, "node_modules", "@changesets", "cli", "bin.js");
    const run = spawnSync(process.execPath, [bin, "status"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(`${run.stdout ?? ""}${run.stderr ?? ""}`).not.toMatch(/safeLoad|is not a function/);
    expect(run.status).toBe(0);
  });
});
