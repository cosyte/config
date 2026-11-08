import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { expectedScriptBody } from "@cosyte/process";
import { describe, expect, it } from "vitest";

import rootVitest from "../vitest.config.ts";

/**
 * The root workspace runs on the packages it publishes, and this file holds the wiring in place.
 *
 * WHY @cosyte/process COMES FROM THE REGISTRY, NOT `workspace:*`. Its bin is `dist/cli.mjs`, which
 * tsup builds. On a clean `pnpm install` that file does not exist yet, so pnpm links no
 * `cosyte-process` bin for a `workspace:*` dependency, and it links one only on a second install
 * after `pnpm build`. Every root verb would then fail on a fresh clone and in CI's first steps. So
 * the root takes the last published release, pinned exactly: a compiler built by its previous
 * release. A new process release reaches the root as an ordinary devDependency bump.
 *
 * WHAT STAYS LOCAL. The root's `build`, `typecheck`, `lint`, `test:packages` and `attw` fan out to
 * each package's own scripts, so they are not a single-project verb `cosyte-process` could run, and
 * `cosyte-process check` is not wired here for the same reason.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

interface Manifest {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
}

const ROOT = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as Manifest;
const require = createRequire(join(REPO_ROOT, "package.json"));
const INSTALLED_PROCESS = JSON.parse(
  readFileSync(require.resolve("@cosyte/process/package.json"), "utf8"),
) as Manifest;

describe("the root dogfoods @cosyte/process", () => {
  it("delegates its own format, format:check and suite to the shared verbs", () => {
    expect(ROOT.scripts["format"]).toBe(expectedScriptBody("format"));
    expect(ROOT.scripts["format:check"]).toBe(`${expectedScriptBody("format")} --check`);
    expect(ROOT.scripts["test:root"]).toBe(expectedScriptBody("test"));
  });

  it("takes @cosyte/process as an exact published version, never workspace:", () => {
    expect(ROOT.devDependencies["@cosyte/process"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(INSTALLED_PROCESS.dependencies?.["vitest"]).toBeDefined();
  });

  it("pins every tool it keeps to the version the installed @cosyte/process runs", () => {
    // The root keeps vitest (tests import it), typescript and prettier (tests import their APIs),
    // tsup (the peer @cosyte/tsup-config imports in test/configs.test.ts) and @vitest/coverage-v8
    // (a peer of @cosyte/vitest-config). A copy at another version would type-check or import one
    // tool while `cosyte-process` runs another.
    const tools = INSTALLED_PROCESS.dependencies ?? {};
    const kept = Object.keys(tools).filter((name) => name in ROOT.devDependencies);
    expect(kept.length).toBeGreaterThan(0);
    for (const name of kept) {
      expect(`${name}@${ROOT.devDependencies[name]}`).toBe(`${name}@${tools[name]}`);
    }
  });
});

describe("the root dogfoods the workspace's own config packages", () => {
  it("takes every other @cosyte package from the workspace", () => {
    const cosyte = Object.entries(ROOT.devDependencies).filter(
      ([name]) => name.startsWith("@cosyte/") && name !== "@cosyte/process",
    );
    expect(cosyte.map(([name]) => name)).toEqual(
      expect.arrayContaining(["@cosyte/vitest-config", "@cosyte/prettier-config"]),
    );
    for (const [name, spec] of cosyte) expect(`${name}@${spec}`).toBe(`${name}@workspace:*`);
  });

  it("builds its Vitest config from @cosyte/vitest-config", () => {
    // The shared gate is present (and inert: the root never runs --coverage).
    expect(rootVitest.test?.coverage?.provider).toBe("v8");
    expect(rootVitest.test?.include).toEqual(["test/**/*.test.ts"]);
    expect(rootVitest.test?.setupFiles).toEqual(["test/no-network.setup.ts"]);
  });
});
