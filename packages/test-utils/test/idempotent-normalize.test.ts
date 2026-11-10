import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { idempotentNormalizeProperty } from "../src/index.js";

import { fakeParse, fakeSerialize } from "./_fake-parser.js";

describe("idempotentNormalizeProperty", () => {
  it("passes a normalizer that settles after one pass (deep-equal default)", () => {
    expect(() =>
      idempotentNormalizeProperty({
        arbitrary: fc.string(),
        normalize: (raw) => fakeSerialize(fakeParse(raw === "FATAL" ? "" : raw)),
      }),
    ).not.toThrow();
  });

  it("passes with a custom `equals`, and compares objects deeply by default", () => {
    expect(() =>
      idempotentNormalizeProperty({
        arbitrary: fc.string(),
        normalize: (raw) => raw.trim().toLowerCase(),
        equals: (a, b) => a === b,
      }),
    ).not.toThrow();
    expect(() =>
      idempotentNormalizeProperty({
        arbitrary: fc.record({ a: fc.string() }),
        normalize: (v) => ({ a: v.a.trim() }),
      }),
    ).not.toThrow();
  });

  it("FAILS a normalizer that keeps changing its own output, naming the check", () => {
    expect(() =>
      idempotentNormalizeProperty({
        arbitrary: fc.string(),
        normalize: (raw) => raw.replaceAll("\\", "\\\\") + ";",
      }),
    ).toThrow(
      /idempotent normalize: normalize\(normalize\(x\)\) is not deep-equal to normalize\(x\)/,
    );
  });

  it("FAILS through a custom `equals` that rejects, naming the check", () => {
    expect(() =>
      idempotentNormalizeProperty({
        arbitrary: fc.string(),
        normalize: (raw) => raw,
        equals: () => false,
      }),
    ).toThrow(
      /idempotent normalize: normalize\(normalize\(x\)\) does not satisfy the supplied `equals` against normalize\(x\)/,
    );
  });

  it("passes the second pass the first pass's output, and compares the two", () => {
    const seen: [string, string][] = [];
    idempotentNormalizeProperty({
      arbitrary: fc.constant<string>("a"),
      normalize: (raw) => `${raw}!`,
      equals: (twice, once) => {
        seen.push([twice, once]);
        return true;
      },
      numRuns: 1,
    });
    expect(seen).toEqual([["a!!", "a!"]]);
  });
});
