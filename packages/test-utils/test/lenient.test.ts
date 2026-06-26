import { describe, expect, it } from "vitest";

import { lenientNeverThrowsProperty, type LenientWarning } from "../src/index.js";

import {
  FakeFatalError,
  fakeHostileRaw,
  fakeParse,
  isFakeFatal,
  isKnownFakeCode,
  type FakeMessage,
} from "./_fake-parser.js";

const getWarnings = (parsed: unknown): ReadonlyArray<LenientWarning> =>
  (parsed as FakeMessage).warnings;

describe("lenientNeverThrowsProperty", () => {
  it("passes for a fake that only throws on its defined fatal and emits known codes", () => {
    expect(() =>
      lenientNeverThrowsProperty({
        arbitrary: fakeHostileRaw(),
        parse: fakeParse,
        isFatal: isFakeFatal,
        getWarnings,
        isKnownCode: isKnownFakeCode,
        hasPositionalContext: (w) => typeof w.position === "object" && w.position !== null,
        numRuns: 300,
      }),
    ).not.toThrow();
  });

  it("FAILS loudly when the fake leaks an unknown warning code", () => {
    // Wrap the fake so one input injects an unregistered code — the runner must
    // catch the leak (isKnownCode returns false for it).
    const leakyParse = (raw: string): FakeMessage => {
      const m = fakeParse(raw);
      return {
        fields: m.fields,
        warnings: [...m.warnings, { code: "TOTALLY_MADE_UP", position: { pairIndex: 0 } }],
      };
    };
    expect(() =>
      lenientNeverThrowsProperty({
        arbitrary: fakeHostileRaw().filter((s) => s !== "FATAL"), // avoid the fatal path
        parse: leakyParse,
        isFatal: isFakeFatal,
        getWarnings,
        isKnownCode: isKnownFakeCode,
        numRuns: 50,
      }),
    ).toThrow(/unregistered code/);
  });

  it("FAILS when the fake throws something that is not a sanctioned fatal", () => {
    // A parser that throws a plain Error on some input violates the contract:
    // non-fatal deviations must be recovered into warnings, never thrown.
    const throwyParse = (raw: string): FakeMessage => {
      if (raw === "") throw new Error("boom — should have been a warning");
      return fakeParse(raw);
    };
    expect(() =>
      lenientNeverThrowsProperty({
        arbitrary: fakeHostileRaw(),
        parse: throwyParse,
        isFatal: isFakeFatal,
        getWarnings,
        isKnownCode: isKnownFakeCode,
        numRuns: 300,
      }),
    ).toThrow(/non-fatal error/);
  });

  it("FAILS when hasPositionalContext is supplied but a warning lacks position", () => {
    const noPositionParse = (raw: string): FakeMessage => {
      const m = fakeParse(raw);
      return { fields: m.fields, warnings: [...m.warnings, { code: "EMPTY_PAIR" }] };
    };
    expect(() =>
      lenientNeverThrowsProperty({
        arbitrary: fakeHostileRaw().filter((s) => s !== "FATAL"),
        parse: noPositionParse,
        isFatal: isFakeFatal,
        getWarnings,
        isKnownCode: isKnownFakeCode,
        hasPositionalContext: (w) => typeof w.position === "object" && w.position !== null,
        numRuns: 50,
      }),
    ).toThrow(/positional context/);
  });

  it("accepts a sanctioned fatal thrown for the fatal input", () => {
    // Sanity: the fatal token reliably throws the sanctioned fatal, and the
    // runner treats that as a pass (constant fatal input, every run throws fatal).
    expect(() =>
      lenientNeverThrowsProperty({
        arbitrary: fakeHostileRaw().map(() => "FATAL"),
        parse: fakeParse,
        isFatal: (err) => err instanceof FakeFatalError,
        getWarnings,
        isKnownCode: isKnownFakeCode,
        numRuns: 20,
      }),
    ).not.toThrow();
  });
});
