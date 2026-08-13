import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, useFixture } from "./helpers.js";
import { checkWiring, expectedScriptBody, RESERVED_VARIANTS } from "../src/check.js";
import { OVERRIDE_FILE } from "../src/overrides.js";

/**
 * Term 8: `check`'s scope is the five delegated verb scripts, any PRESENT reserved variant script,
 * and the override file. Nothing else in a consumer's package.json is graded.
 */

afterAll(cleanupTempDirs);

/** Rewrite one script body in a fixture copy, the way a hand edit would. */
function editScript(dir: string, name: string, body: string | undefined): void {
  const path = join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { scripts: Record<string, string> };
  if (body === undefined) {
    delete manifest.scripts[name];
  } else {
    manifest.scripts[name] = body;
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("conforming wiring", () => {
  it("passes a consumer carrying all five verbs and all four reserved variants", () => {
    expect(checkWiring(useFixture("wired"))).toEqual([]);
  });

  it("passes a consumer carrying NONE of the four reserved variants (term 8)", () => {
    const dir = useFixture("minimal");
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const name of Object.keys(RESERVED_VARIANTS)) {
      expect(manifest.scripts[name]).toBeUndefined();
    }
    expect(checkWiring(dir)).toEqual([]);
  });

  it("passes a consumer carrying SOME of the reserved variants", () => {
    const dir = useFixture("wired");
    editScript(dir, "test:watch", undefined);
    editScript(dir, "format:check", undefined);
    expect(checkWiring(dir)).toEqual([]);
  });

  it("ignores scripts outside the term-8 scope", () => {
    const dir = useFixture("wired");
    editScript(dir, "release", "changeset publish");
    editScript(dir, "phi-scan", "tsx scripts/phi-scan.ts");
    expect(checkWiring(dir)).toEqual([]);
  });

  it("passes with a valid override file present", () => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), '{"lint":{"globs":["lib/**/*.ts"]}}\n');
    expect(checkWiring(dir)).toEqual([]);
  });
});

describe("drifted wiring", () => {
  it("names every drifted script, verbs and present variants alike", () => {
    const violations = checkWiring(useFixture("drifted"));
    // test was hand-edited back to `vitest run`, lint grew a flag, test:coverage was hand-edited.
    expect(violations).toHaveLength(3);
    expect(violations.join("\n")).toContain('script "test" is "vitest run"');
    expect(violations.join("\n")).toContain(
      'script "lint" is "cosyte-process lint --max-warnings=0"',
    );
    expect(violations.join("\n")).toContain('script "test:coverage" is "vitest run --coverage"');
    // The variant that is absent is conforming, and the one that is right is not reported.
    expect(violations.join("\n")).not.toContain('"test:watch"');
    expect(violations.join("\n")).not.toContain('"lint:fix"');
  });

  it("names a missing delegated verb script", () => {
    const dir = useFixture("wired");
    editScript(dir, "typecheck", undefined);
    const violations = checkWiring(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('script "typecheck" is missing');
    expect(violations[0]).toContain("cosyte-process typecheck");
  });

  it("rejects a body that merely contains the delegation", () => {
    const dir = useFixture("wired");
    editScript(dir, "build", "pnpm clean && cosyte-process build");
    expect(checkWiring(dir)).toHaveLength(1);
  });

  it("reports an invalid override file as a violation", () => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), '{"check":{}}\n');
    const violations = checkWiring(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(OVERRIDE_FILE);
    expect(violations[0]).toContain('"check" is not overridable');
  });

  it("reports every violation at once rather than the first", () => {
    const dir = useFixture("wired");
    editScript(dir, "build", "tsup");
    editScript(dir, "lint", undefined);
    writeFileSync(join(dir, OVERRIDE_FILE), "{ not json");
    expect(checkWiring(dir)).toHaveLength(3);
  });
});

describe("the expected bodies themselves", () => {
  it("spells a verb script and a variant script exactly as term 6 does", () => {
    expect(expectedScriptBody("build")).toBe("cosyte-process build");
    expect(expectedScriptBody("test", "--watch")).toBe("cosyte-process test --watch");
  });

  it("reserves exactly the four variant names", () => {
    expect(Object.keys(RESERVED_VARIANTS)).toEqual([
      "test:watch",
      "test:coverage",
      "lint:fix",
      "format:check",
    ]);
  });
});
