import { describe, expect, it } from "vitest";

import { sortedCodeSet } from "../src/index.js";

import { FAKE_WARNING_CODES } from "./_fake-parser.js";

describe("sortedCodeSet", () => {
  it("returns the registry values sorted ascending by code point", () => {
    const codes = { B: "B", A: "A", C: "C" };
    expect(sortedCodeSet(codes)).toEqual(["A", "B", "C"]);
  });

  it("is insensitive to declaration order (same input set → same output)", () => {
    expect(sortedCodeSet({ Z: "Z", M: "M", A: "A" })).toEqual(
      sortedCodeSet({ A: "A", M: "M", Z: "Z" }),
    );
  });

  it("produces a stable snapshot of a fake registry (the consumer pattern)", () => {
    // This is exactly how a parser uses it: snapshot the sorted code set so a
    // rename/removal becomes a failing diff.
    expect(sortedCodeSet(FAKE_WARNING_CODES)).toMatchInlineSnapshot(`
      [
        "DUPLICATE_KEY",
        "EMPTY_PAIR",
      ]
    `);
  });

  it("returns an empty array for an empty registry", () => {
    expect(sortedCodeSet({})).toEqual([]);
  });
});
