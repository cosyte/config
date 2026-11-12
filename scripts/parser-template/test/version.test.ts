import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

// This file must not import the source statically. VERSION is set once, when src/index.ts is first
// evaluated, and the mutation run links a mutant only to the tests that run while its line is
// evaluated. A static import evaluates the module before any test starts, so no test is linked to
// the VERSION string and a changed literal survives: the Version Packages pull request, whose
// mutation run mutates that line, goes red. Here the module cache is reset and the source is
// imported inside the test body, so the evaluation happens in the test. `cosyte-release-pr` checks
// that a test of this shape exists.

/** The `version` field of package.json, read at test time and narrowed without a cast. */
function manifestVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error("package.json did not parse to an object with a `version` field");
  }
  const { version } = manifest;
  if (typeof version !== "string") throw new Error("package.json `version` is not a string");
  return version;
}

describe("VERSION through a fresh import", () => {
  it("equals the version in package.json", async () => {
    vi.resetModules();
    const { VERSION } = await import("../src/index.js");
    expect(VERSION).toBe(manifestVersion());
  });
});
