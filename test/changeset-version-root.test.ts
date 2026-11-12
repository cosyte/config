import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// A VERSION PACKAGES PULL REQUEST MUST INSTALL AS GENERATED.
//
// The root takes @cosyte/process from the registry, pinned exactly (test/root-dogfood.test.ts says
// why). @changesets/cli 3 rewrites the ROOT package.json's dependency ranges too, which version 2
// never did: a release of @cosyte/process moved the root's pin from 0.1.7 to 0.1.9 without touching
// pnpm-lock.yaml, so `pnpm install --frozen-lockfile` failed on the release pull request and every
// check that installs went red. `bumpVersionsWithWorkspaceProtocolOnly` in .changeset/config.json
// stops that: changesets then rewrites only `workspace:` ranges, and every internal range a
// published package carries is one.
//
// This suite runs the real `changeset version` over a throwaway copy of this workspace's own
// manifests and changesets config, so it fails the day a config edit or a changesets upgrade brings
// the rewrite back.

const REPO_ROOT = join(import.meta.dirname, "..");
const require = createRequire(join(REPO_ROOT, "package.json"));
const CHANGESET_BIN = join(dirname(require.resolve("@changesets/cli/package.json")), "bin.js");
const PACKAGE_DIRS = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Copy the workspace's manifests and changesets config into a throwaway directory, add pending
 * changesets, and run `changeset version` there.
 *
 * @param config The `.changeset/config.json` to run with.
 * @returns The throwaway workspace root, after the version run.
 */
function versionWith(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "changeset-version-root-"));
  temporaryDirs.push(root);
  copyFileSync(join(REPO_ROOT, "package.json"), join(root, "package.json"));
  copyFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), join(root, "pnpm-workspace.yaml"));
  for (const name of PACKAGE_DIRS) {
    mkdirSync(join(root, "packages", name), { recursive: true });
    copyFileSync(
      join(REPO_ROOT, "packages", name, "package.json"),
      join(root, "packages", name, "package.json"),
    );
  }
  const changesetDir = join(root, ".changeset");
  mkdirSync(changesetDir, { recursive: true });
  // `format: false` only: the copy has no Prettier to format the new changelogs with, and the
  // formatting pass runs after every package.json edit, so it changes nothing this suite reads.
  writeFileSync(
    join(changesetDir, "config.json"),
    JSON.stringify({ ...config, format: false }),
    "utf8",
  );
  writeFileSync(
    join(changesetDir, "process-patch.md"),
    '---\n"@cosyte/process": patch\n---\n\nA synthetic process fix.\n',
    "utf8",
  );
  writeFileSync(
    join(changesetDir, "script-utils-patch.md"),
    '---\n"@cosyte/script-utils": patch\n---\n\nA synthetic script-utils fix.\n',
    "utf8",
  );
  execFileSync("node", [CHANGESET_BIN, "version"], { cwd: root, stdio: "pipe" });
  return root;
}

/**
 * Read every published package's manifest and changelog out of a workspace.
 *
 * @param root The workspace root.
 * @returns Each package directory mapped to its manifest and changelog text (empty when none).
 */
function publishedFiles(root: string): Record<string, { manifest: string; changelog: string }> {
  return Object.fromEntries(
    PACKAGE_DIRS.map((name) => [
      name,
      {
        manifest: readFileSync(join(root, "packages", name, "package.json"), "utf8"),
        changelog: existsSync(join(root, "packages", name, "CHANGELOG.md"))
          ? readFileSync(join(root, "packages", name, "CHANGELOG.md"), "utf8")
          : "",
      },
    ]),
  );
}

const REPO_CONFIG = JSON.parse(
  readFileSync(join(REPO_ROOT, ".changeset", "config.json"), "utf8"),
) as Record<string, unknown>;

describe("changeset version and the root manifest", () => {
  it("leaves the root's registry pin of @cosyte/process as it is", () => {
    const root = versionWith(REPO_CONFIG);
    const before = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(before);

    // The run did bump the package the root pins, so the root was left alone on purpose.
    const process = JSON.parse(
      readFileSync(join(root, "packages", "process", "package.json"), "utf8"),
    ) as { version: string };
    const original = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "process", "package.json"), "utf8"),
    ) as { version: string };
    expect(process.version).not.toBe(original.version);
  });

  it("versions the published packages exactly as without the setting", () => {
    const withSetting = versionWith(REPO_CONFIG);
    const { bumpVersionsWithWorkspaceProtocolOnly: _dropped, ...without } = REPO_CONFIG;
    const withoutSetting = versionWith(without);
    expect(publishedFiles(withSetting)).toEqual(publishedFiles(withoutSetting));
  });
});
