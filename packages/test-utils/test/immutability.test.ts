import { describe, expect, it } from "vitest";

import { immutabilityProperty } from "../src/index.js";

import { fakeParse, fakeParseImmutable, fakeSpecCleanRaw } from "./_fake-parser.js";

describe("immutabilityProperty", () => {
  it("passes when a mutation attempt THROWS (frozen fields) and the snapshot holds", () => {
    expect(() =>
      immutabilityProperty({
        arbitrary: fakeSpecCleanRaw(),
        parse: fakeParseImmutable,
        // `fields` is frozen; assigning throws in strict mode (ESM is strict).
        mutate: (m) => {
          m.fields["__injected"] = "x";
        },
        getSnapshot: (m) => ({ ...m.fields }),
        numRuns: 200,
      }),
    ).not.toThrow();
  });

  it("passes when a mutation returns a NEW instance without touching the original", () => {
    expect(() =>
      immutabilityProperty({
        arbitrary: fakeSpecCleanRaw(),
        parse: fakeParseImmutable,
        // Non-mutating: builds and returns a fresh object; original untouched.
        mutate: (m) => ({ ...m, fields: { ...m.fields, extra: "1" } }),
        getSnapshot: (m) => ({ ...m.fields }),
        numRuns: 200,
      }),
    ).not.toThrow();
  });

  it("FAILS when the model mutates in place (snapshot changes)", () => {
    // `fakeParse` (non-immutable) leaves `fields` writable, so an in-place edit
    // sticks and the post-mutation snapshot diverges from the pre-mutation one.
    expect(() =>
      immutabilityProperty({
        arbitrary: fakeSpecCleanRaw().filter((raw) => raw.length > 0),
        parse: fakeParse,
        mutate: (m) => {
          m.fields["__injected"] = "x";
        },
        getSnapshot: (m) => ({ ...m.fields }),
        numRuns: 200,
      }),
    ).toThrow(/snapshot changed/);
  });
});
