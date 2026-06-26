import { describe, expect, it } from "vitest";

import { roundTripProperty } from "../src/index.js";

import { fakeParse, fakeSerialize, fakeSpecCleanMessage } from "./_fake-parser.js";

describe("roundTripProperty", () => {
  it("passes for a faithful serialize/parse pair (deep-equal default)", () => {
    expect(() =>
      roundTripProperty({
        arbitrary: fakeSpecCleanMessage(),
        serialize: fakeSerialize,
        parse: fakeParse,
        numRuns: 200,
      }),
    ).not.toThrow();
  });

  it("passes with a custom `equals` (structural via canonical serialized form)", () => {
    expect(() =>
      roundTripProperty({
        arbitrary: fakeSpecCleanMessage(),
        serialize: fakeSerialize,
        parse: fakeParse,
        equals: (a, b) => fakeSerialize(a) === fakeSerialize(b),
        numRuns: 200,
      }),
    ).not.toThrow();
  });

  it("FAILS when the serializer is lossy (round-trip equality broken)", () => {
    // A serializer that drops the last field cannot round-trip: parse(serialize(x))
    // is missing a key, so deep-equal against x fails.
    const lossySerialize = (m: ReturnType<typeof fakeParse>): string => {
      const entries = Object.entries(m.fields);
      return entries
        .slice(0, Math.max(0, entries.length - 1))
        .map(([k, v]) => `${k}=${v}`)
        .join(";");
    };
    expect(() =>
      roundTripProperty({
        // force >=2 fields so dropping one is always observable
        arbitrary: fakeSpecCleanMessage().filter((m) => Object.keys(m.fields).length >= 2),
        serialize: lossySerialize,
        parse: fakeParse,
        numRuns: 200,
      }),
    ).toThrow();
  });

  it("FAILS when serialization is not idempotent", () => {
    // A serializer that appends a nonce each call breaks idempotency:
    // serialize(parse(serialize(x))) !== serialize(x). Round-trip equality via a
    // tolerant `equals` still holds, so this isolates the idempotency check.
    let nonce = 0;
    const driftingSerialize = (m: ReturnType<typeof fakeParse>): string => {
      nonce += 1;
      const base = fakeSerialize(m);
      return `${base};__nonce=${String(nonce)}`;
    };
    expect(() =>
      roundTripProperty({
        arbitrary: fakeSpecCleanMessage(),
        serialize: driftingSerialize,
        parse: fakeParse,
        // tolerate the nonce field on the equality axis so only idempotency fails
        equals: () => true,
        numRuns: 50,
      }),
    ).toThrow();
  });
});
