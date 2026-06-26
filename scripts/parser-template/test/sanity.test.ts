import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

describe("toolchain sanity", () => {
  it("resolves the public entry point and exports VERSION as a string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("exposes VERSION as a semver-looking string", () => {
    // At this stage VERSION is "0.0.0"; the regex only asserts the shape, not the exact value, so
    // future phases can bump it without breaking.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[.-].+)?$/);
  });
});
