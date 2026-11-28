import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

describe("toolchain sanity", () => {
  it("resolves the public entry point and exports VERSION as a string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("exposes VERSION as a semver-looking string", () => {
    // The regex asserts the shape, not the exact value, so a release can bump it without an edit
    // here.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[.-].+)?$/);
  });
});
