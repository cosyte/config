import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, ensureBuilt, runCli, useFixture } from "./helpers.js";
import { checkWiring } from "../src/check.js";
import { ENTRY_POINTS } from "../src/entry-points.js";
import { loadOverrides, OVERRIDE_FILE, OverrideError } from "../src/overrides.js";
import { DELEGATED_VERBS, VERBS } from "../src/verbs.js";

/**
 * The no-regression guarantee: the two entry points are reachable through the bin and are invisible
 * to everything else.
 *
 * Every fixture consumer here is one wired against the five verbs alone, unchanged: what changes is
 * the version of this package running against it, which is the whole consumer-side cost of a
 * shared-process change (a dependency version bump plus an install, and no consumer-side edit).
 */

beforeAll(ensureBuilt);
afterAll(cleanupTempDirs);

describe("AC-C7: an unchanged consumer keeps working", () => {
  it("leaves `cosyte-process check` exiting 0 for a consumer wired to the five verbs", () => {
    const result = runCli(["check"], useFixture("wired"));
    expect(result.code, result.stderr).toBe(0);
  });

  it("leaves a consumer carrying none of the reserved variant scripts conforming", () => {
    expect(runCli(["check"], useFixture("minimal")).code).toBe(0);
  });

  it("leaves a previously valid cosyte-process.config.json valid", () => {
    const dir = useFixture("overridden");
    expect(runCli(["check"], dir).code).toBe(0);
    expect(loadOverrides(dir)).toEqual({ lint: { globs: ["lib/**/*.ts"] } });
  });

  it("names no entry point among the violations of a drifted consumer", () => {
    const violations = checkWiring(useFixture("drifted")).join("\n");
    expect(violations.length).toBeGreaterThan(0);
    for (const entry of ENTRY_POINTS) {
      expect(violations).not.toContain(entry);
    }
  });

  it("requires no script for either entry point: the wiring check grades the five verbs", () => {
    // `minimal` carries exactly the five verb scripts and nothing else, and conforms.
    expect(checkWiring(useFixture("minimal"))).toEqual([]);
  });
});

describe("AC-C7: an entry point is not an overridable verb", () => {
  it.each(ENTRY_POINTS)("refuses %s as a top-level override key", (entry) => {
    const dir = useFixture("wired");
    const file = join(dir, OVERRIDE_FILE);
    writeFileSync(file, `${JSON.stringify({ [entry]: { flags: ["--x"] } }, null, 2)}\n`);
    for (const verb of VERBS) {
      const result = runCli([verb], dir);
      expect(result.code, `${verb} must refuse the override file`).not.toBe(0);
      expect(result.stderr).toContain(file);
      expect(result.stderr).toContain(`unknown verb name "${entry}"`);
    }
  });

  it.each(ENTRY_POINTS)("refuses %s the same way it refuses any other unknown key", (entry) => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), `${JSON.stringify({ [entry]: {} })}\n`);
    const refusal = (): unknown => loadOverrides(dir);
    expect(refusal).toThrow(OverrideError);
    writeFileSync(join(dir, OVERRIDE_FILE), '{ "buidl": {} }\n');
    expect(refusal).toThrow(OverrideError);
  });

  it("keeps the accepted top-level keys at exactly the five delegated verbs", () => {
    const dir = useFixture("wired");
    const accepted = Object.fromEntries(DELEGATED_VERBS.map((verb) => [verb, {}]));
    writeFileSync(join(dir, OVERRIDE_FILE), `${JSON.stringify(accepted)}\n`);
    expect(Object.keys(loadOverrides(dir)).sort()).toEqual([...DELEGATED_VERBS].sort());
    expect(runCli(["check"], dir).code).toBe(0);
  });

  it("keeps both entry points out of the verb surface", () => {
    for (const entry of ENTRY_POINTS) {
      expect(VERBS).not.toContain(entry);
      expect(DELEGATED_VERBS).not.toContain(entry);
    }
  });
});

describe("AC-C7: the entry points are reachable through the bin that already exists", () => {
  it.each(ENTRY_POINTS)("%s is dispatched rather than refused as an unknown verb", (entry) => {
    const dir = useFixture("wired");
    const result = runCli([entry], dir);
    expect(result.stderr).not.toContain(`unknown verb "${entry}"`);
    expect(result.stderr).toContain(entry);
  });

  it("lists both entry points in the usage text a refusal prints", () => {
    const result = runCli(["nonsense"], useFixture("wired"));
    expect(result.code).not.toBe(0);
    for (const entry of ENTRY_POINTS) {
      expect(result.stderr).toContain(entry);
    }
  });
});
