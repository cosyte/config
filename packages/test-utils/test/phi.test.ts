import { describe, expect, it } from "vitest";

import { assertNoSecretLeak } from "../src/index.js";

const SECRET = "123-45-6789"; // a fake SSN — the needle
const MARKER = "[REDACTED]";
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** A correct Secret: redacts through ALL four channels. */
class Secret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** Length is safe to expose; the value is not. */
  get length(): number {
    return this.#value.length;
  }
  toJSON(): string {
    return MARKER;
  }
  toString(): string {
    return MARKER;
  }
  [INSPECT](): string {
    return MARKER;
  }
}

describe("assertNoSecretLeak", () => {
  it("passes for a Secret that redacts through every channel", () => {
    expect(() =>
      assertNoSecretLeak(new Secret(SECRET), { secret: SECRET, redactedMarker: MARKER }),
    ).not.toThrow();
  });

  it("FAILS naming JSON.stringify when toJSON is missing (enumerable value dumped)", () => {
    // Redacts toString + inspect, but stores the secret enumerable with no toJSON.
    const leakyJson = {
      value: SECRET,
      toString: () => MARKER,
      [INSPECT]: () => MARKER,
    };
    expect(() => assertNoSecretLeak(leakyJson, { secret: SECRET, redactedMarker: MARKER })).toThrow(
      /JSON\.stringify/,
    );
  });

  it("FAILS naming String() when toString returns the raw secret", () => {
    const leakyToString = {
      toJSON: () => MARKER,
      toString: () => SECRET,
      [INSPECT]: () => MARKER,
    };
    expect(() =>
      assertNoSecretLeak(leakyToString, { secret: SECRET, redactedMarker: MARKER }),
    ).toThrow(/String\(\)/);
  });

  it("FAILS naming util.inspect when the inspect-custom symbol is missing", () => {
    // Redacts JSON + toString, but has no inspect hook, so inspect dumps the
    // enumerable `value` holding the secret.
    const leakyInspect = {
      value: SECRET,
      toJSON: () => MARKER,
      toString: () => MARKER,
    };
    expect(() =>
      assertNoSecretLeak(leakyInspect, { secret: SECRET, redactedMarker: MARKER }),
    ).toThrow(/util\.inspect/);
  });

  it("FAILS when a channel omits the secret but also omits the marker (no redaction proof)", () => {
    // toString returns "" — the secret is absent, but so is the marker, so the
    // matrix rejects it: redaction must be affirmatively shown, not just absence.
    const blank = {
      toJSON: () => MARKER,
      toString: () => "",
      [INSPECT]: () => MARKER,
    };
    expect(() => assertNoSecretLeak(blank, { secret: SECRET, redactedMarker: MARKER })).toThrow(
      /did not redact/,
    );
  });

  it("rejects an empty secret needle (would match everything)", () => {
    expect(() =>
      assertNoSecretLeak(new Secret(SECRET), { secret: "", redactedMarker: MARKER }),
    ).toThrow(/non-empty/);
  });
});
