import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, makeTempDir } from "./helpers.js";
import { loadOverrides, OVERRIDE_FILE, OverrideError } from "../src/overrides.js";

/**
 * Term 7's schema, and the rule that any violation makes EVERY verb fail naming the file and the
 * first violation.
 */

afterAll(cleanupTempDirs);

/** A directory carrying the given override file content, valid JSON or not. */
function withOverrideFile(content: string): string {
  const dir = makeTempDir("cosyte-process-override-");
  writeFileSync(join(dir, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(join(dir, OVERRIDE_FILE), content);
  return dir;
}

/** The OverrideError a load threw, or a failure if it did not throw. */
function violationOf(content: string): OverrideError {
  const dir = withOverrideFile(content);
  try {
    loadOverrides(dir);
  } catch (error: unknown) {
    if (error instanceof OverrideError) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected a term-7 violation for: ${content}`);
}

describe("valid override files", () => {
  it("treats an absent file as no overrides", () => {
    const dir = makeTempDir("cosyte-process-no-override-");
    expect(loadOverrides(dir)).toEqual({});
  });

  it("accepts an empty object", () => {
    expect(loadOverrides(withOverrideFile("{}"))).toEqual({});
  });

  it("accepts globs, flags, both, and neither, per verb", () => {
    const parsed = loadOverrides(
      withOverrideFile(
        JSON.stringify({
          build: {},
          test: { flags: ["--coverage"] },
          lint: { globs: ["lib/**/*.ts"] },
          format: { globs: ["docs/**/*.md"], flags: ["--log-level=warn"] },
        }),
      ),
    );
    expect(parsed).toEqual({
      build: {},
      test: { flags: ["--coverage"] },
      lint: { globs: ["lib/**/*.ts"] },
      format: { globs: ["docs/**/*.md"], flags: ["--log-level=warn"] },
    });
  });

  it("accepts empty arrays, which is how a verb drops its baseline tokens", () => {
    expect(loadOverrides(withOverrideFile('{"lint":{"flags":[]}}'))).toEqual({
      lint: { flags: [] },
    });
  });
});

describe("term-7 violations, each naming the file and the first violation", () => {
  it("rejects malformed JSON", () => {
    const error = violationOf("{ not json");
    expect(error.violation).toContain("malformed JSON");
    expect(error.message).toContain(OVERRIDE_FILE);
  });

  it("rejects a non-object top level", () => {
    expect(violationOf('["lint"]').violation).toBe("the top level must be a JSON object");
    expect(violationOf('"lint"').violation).toBe("the top level must be a JSON object");
    expect(violationOf("null").violation).toBe("the top level must be a JSON object");
  });

  it("rejects an unknown top-level key by naming it", () => {
    const error = violationOf('{"buidl":{}}');
    expect(error.violation).toContain('unknown verb name "buidl"');
    expect(error.violation).toContain("build, test, lint, typecheck, format");
  });

  it("rejects overriding check", () => {
    expect(violationOf('{"check":{}}').violation).toBe('"check" is not overridable');
  });

  it("rejects a non-object verb value", () => {
    expect(violationOf('{"lint":["lib/**/*.ts"]}').violation).toBe(
      'the value of "lint" must be an object',
    );
  });

  it("rejects an unknown key under a verb", () => {
    const error = violationOf('{"lint":{"tool":"biome"}}');
    expect(error.violation).toContain('unknown key "tool" under "lint"');
    expect(error.violation).toContain("globs, flags");
  });

  it("rejects non-array globs and flags", () => {
    expect(violationOf('{"lint":{"globs":"lib/**/*.ts"}}').violation).toBe(
      '"lint.globs" must be an array of strings',
    );
    expect(violationOf('{"test":{"flags":{"0":"--coverage"}}}').violation).toBe(
      '"test.flags" must be an array of strings',
    );
  });

  it("rejects an array holding a non-string", () => {
    expect(violationOf('{"lint":{"globs":["ok",7]}}').violation).toBe(
      '"lint.globs" must be an array of strings',
    );
  });

  it("reports the FIRST violation in file order", () => {
    const error = violationOf('{"lint":{"tool":"biome"},"buidl":{}}');
    expect(error.violation).toContain('unknown key "tool" under "lint"');
  });

  it("names the offending file by absolute path", () => {
    const dir = withOverrideFile('{"check":{}}');
    try {
      loadOverrides(dir);
      throw new Error("expected a violation");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(OverrideError);
      expect((error as OverrideError).file).toBe(join(dir, OVERRIDE_FILE));
    }
  });
});
