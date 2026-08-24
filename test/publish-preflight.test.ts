import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// THE NEGATIVE CONTROL FOR THE PUBLISH PREFLIGHT.
//
// The defect: `changeset publish` discovers a missing npm token by asking the registry and being
// refused, which happens at the LAST step of a job that has already checked out, installed, built
// eight packages and waited for a human to approve a protected deployment. The approval is spent,
// the build is paid for, and the diagnostic is an `E401` from npm rather than a sentence naming the
// credential and where it is supposed to live.
//
// The preflight is worth exactly what its pair of controls proves, so this suite asserts BOTH
// directions and one boundary:
//
//   NEGATIVE  a required credential that is absent, empty, or whitespace must exit NON-ZERO,
//             name the variable and the credential behind it, and say the registry was not touched.
//   POSITIVE  a fully credentialed environment must exit ZERO.
//   BOUNDARY  a credential the declaration marks OPTIONAL must not fail the publish closed.
//             `RELEASE_PR_TOKEN` is optional by design; failing on its absence would take the
//             release path down to protect against a state this repository is already able to be in,
//             which release.yml calls out explicitly.
//
// It drives the SHIPPED CLI, because what `pnpm run release` depends on is the process exit code.

const REPO = join(import.meta.dirname, "..");
const PREFLIGHT = join(REPO, "scripts", "publish-preflight.mjs");
const DECLARATION = join(".github", "credential-surface.json");

/** A value no message may ever echo. If it appears in the output, the preflight leaked a secret. */
const SENTINEL = "npm_thisvalueMUSTneverBEprinted000000";

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * Run the shipped CLI in a controlled environment.
 *
 * @param root The repository root to check against.
 * @param env The credential environment. Nothing is inherited from this process, so a token that
 *   happens to be set on the developer's machine cannot turn a negative case green.
 * @returns Its exit status and both streams.
 */
function run(root: string, env: Record<string, string>): Run {
  const result = spawnSync(process.execPath, [PREFLIGHT, "--repo", root], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
}

/**
 * Copy this repository's real declaration into a throwaway directory.
 *
 * @returns The fixture root.
 */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "publish-preflight-"));
  temporaryDirs.push(root);
  mkdirSync(join(root, ".github"), { recursive: true });
  copyFileSync(join(REPO, DECLARATION), join(root, DECLARATION));
  return root;
}

/** Every environment variable the committed declaration requires, all present and plausible. */
const FULLY_CREDENTIALED = { NPM_TOKEN: SENTINEL, NODE_AUTH_TOKEN: SENTINEL };

describe("a required credential that is absent or empty (AC8)", () => {
  it("stops before the registry is contacted and names the missing credential", () => {
    const result = run(fixture(), {});
    expect(result.status).toBe(1);
    expect(result.output).toContain("REFUSING TO PUBLISH");
    expect(result.output).toContain("NPM_TOKEN");
    expect(result.output).toContain("NODE_AUTH_TOKEN");
    expect(result.output).toContain("the registry has NOT been contacted");
  });

  it("treats an empty value as absent", () => {
    const result = run(fixture(), { NPM_TOKEN: "", NODE_AUTH_TOKEN: "" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("NPM_TOKEN");
  });

  it("treats a whitespace-only value as absent", () => {
    const result = run(fixture(), { NPM_TOKEN: "   ", NODE_AUTH_TOKEN: "  \t " });
    expect(result.status).toBe(1);
    expect(result.output).toContain("NPM_TOKEN");
  });

  it("catches the half-set case, where one of a credential's two variables is missing", () => {
    const result = run(fixture(), { NPM_TOKEN: SENTINEL });
    expect(result.status).toBe(1);
    expect(result.output).toContain("NODE_AUTH_TOKEN");
  });

  it("tells the operator the token class and the one place it may live", () => {
    const result = run(fixture(), {});
    expect(result.output).toContain("organization");
    expect(result.output).toContain("Automation token");
    expect(result.output).toContain("Credential rotation, revocation, and compensating actions");
  });

  it("never echoes a credential value", () => {
    const result = run(fixture(), { NPM_TOKEN: SENTINEL });
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(SENTINEL);
  });

  it("passes when every required credential is present (positive control)", () => {
    const result = run(fixture(), FULLY_CREDENTIALED);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Proceeding to build and publish");
    expect(result.output).not.toContain(SENTINEL);
  });
});

describe("an optional credential must not fail the publish closed", () => {
  it("passes with RELEASE_PR_TOKEN absent, which is a supported state", () => {
    const declaration = JSON.parse(readFileSync(join(REPO, DECLARATION), "utf8")) as {
      credentials: { name: string; requiredForPublish: boolean }[];
    };
    const optional = declaration.credentials.find((c) => c.name === "RELEASE_PR_TOKEN");
    expect(optional?.requiredForPublish, "RELEASE_PR_TOKEN is optional by design").toBe(false);
    expect(run(fixture(), FULLY_CREDENTIALED).status).toBe(0);
  });
});

describe("the preflight runs before the build is paid for", () => {
  it("is the first thing the release command does", () => {
    const manifest = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const release = manifest.scripts.release;
    expect(release.startsWith("node scripts/publish-preflight.mjs &&")).toBe(true);
    expect(release.indexOf("publish-preflight")).toBeLessThan(release.indexOf("build"));
    expect(release.indexOf("publish-preflight")).toBeLessThan(release.indexOf("changeset publish"));
  });

  it("guards the publish command path rather than one workflow's step list", () => {
    // The release workflow reaches the registry through `publish: pnpm run release`, so the guard
    // sits on that command. A step in release.yml would guard release.yml and nothing else.
    const workflow = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
    expect(workflow).toContain("publish: pnpm run release");
  });
});

describe("a preflight that cannot run is not a preflight that passed", () => {
  it("refuses when the declaration is absent", () => {
    const root = fixture();
    rmSync(join(root, DECLARATION));
    const result = run(root, FULLY_CREDENTIALED);
    expect(result.status).toBe(2);
    expect(result.output).toContain("REFUSING TO PUBLISH");
    expect(result.output).toContain("declaration-absent");
  });

  it("refuses when the declaration is not valid JSON", () => {
    const root = fixture();
    writeFileSync(join(root, DECLARATION), "{ nope", "utf8");
    const result = run(root, FULLY_CREDENTIALED);
    expect(result.status).toBe(2);
    expect(result.output).toContain("declaration-unparseable");
  });

  it("refuses a declaration that requires nothing, rather than passing on any environment at all", () => {
    const root = fixture();
    const path = join(root, DECLARATION);
    const declaration = JSON.parse(readFileSync(path, "utf8")) as {
      credentials: { requiredForPublish: boolean }[];
    };
    for (const credential of declaration.credentials) credential.requiredForPublish = false;
    writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, "utf8");
    const result = run(root, {});
    expect(result.status).toBe(2);
    expect(result.output).toContain("marks no credential as required");
  });

  it("separates a bad invocation from a missing credential", () => {
    const result = spawnSync(process.execPath, [PREFLIGHT, "--nonsense"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not run");
  });
});
