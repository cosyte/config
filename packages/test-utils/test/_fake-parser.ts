/**
 * A deliberately tiny, self-contained "parser" used only to exercise the kit's
 * generic runners. It is NOT a real cosyte parser — it stands in for one so the
 * runner tests can prove the invariants fire (and fail) correctly, and it doubles
 * as runnable documentation of the contract each runner expects.
 *
 * Format: a flat record serialized as `key=value;key=value`. Keys are drawn from
 * a safe alphabet; values avoid `=` and `;` so the grammar stays unambiguous.
 */

import fc from "fast-check";

/** The fake's parsed model: a flat string→string record plus recovered warnings. */
export interface FakeMessage {
  readonly fields: Record<string, string>;
  readonly warnings: FakeWarning[];
}

/** A recovered warning — mirrors the minimal shape the lenient runner reads. */
export interface FakeWarning {
  readonly code: string;
  readonly position?: { readonly pairIndex: number };
}

/** The fake's public warning-code registry (keys equal values, like the real ones). */
export const FAKE_WARNING_CODES = {
  EMPTY_PAIR: "EMPTY_PAIR",
  DUPLICATE_KEY: "DUPLICATE_KEY",
} as const;

/** Set of known codes for `isKnownCode`. */
const KNOWN_CODES = new Set<string>(Object.values(FAKE_WARNING_CODES));

/** The single fatal condition: the literal input `"FATAL"` is unrecoverable. */
export class FakeFatalError extends Error {
  constructor() {
    super("fake: unrecoverable input");
    this.name = "FakeFatalError";
  }
}

/** Is `code` a registered fake warning code? */
export function isKnownFakeCode(code: string): boolean {
  return KNOWN_CODES.has(code);
}

/** Is a thrown value the fake's sanctioned fatal? */
export function isFakeFatal(err: unknown): boolean {
  return err instanceof FakeFatalError;
}

/** Serialize a flat record to `k=v;k=v`, in a canonical (insertion) order. */
export function fakeSerialize(message: FakeMessage): string {
  return Object.entries(message.fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}

/**
 * Parse `k=v;k=v` leniently. Throws only on the one fatal input; everything else
 * is recovered: empty pairs become an `EMPTY_PAIR` warning (and are skipped),
 * duplicate keys become a `DUPLICATE_KEY` warning (last value wins).
 */
export function fakeParse(raw: string): FakeMessage {
  if (raw === "FATAL") throw new FakeFatalError();

  const fields: Record<string, string> = {};
  const warnings: FakeWarning[] = [];

  const pairs = raw.split(";");
  pairs.forEach((pair, pairIndex) => {
    if (pair === "") {
      warnings.push({ code: FAKE_WARNING_CODES.EMPTY_PAIR, position: { pairIndex } });
      return;
    }
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      warnings.push({ code: FAKE_WARNING_CODES.DUPLICATE_KEY, position: { pairIndex } });
    }
    fields[key] = value;
  });

  return { fields, warnings: Object.freeze(warnings) as FakeWarning[] };
}

/** Build an immutable (frozen `fields`) message from a parse. */
export function fakeParseImmutable(raw: string): FakeMessage {
  const m = fakeParse(raw);
  return { fields: Object.freeze({ ...m.fields }), warnings: m.warnings };
}

/**
 * A spec-clean arbitrary: a non-empty flat record whose keys/values avoid `=`
 * and `;`, so `parse(serialize(x))` is exactly `x` with zero warnings. Keys are
 * unique by construction (a record from a key set).
 */
export function fakeSpecCleanMessage(): fc.Arbitrary<FakeMessage> {
  const token = fc
    .stringMatching(/^[A-Za-z0-9_]{1,8}$/)
    .filter((s) => s.length > 0 && !s.includes("=") && !s.includes(";"));
  return fc
    .dictionary(token, token, { minKeys: 1, maxKeys: 5 })
    .map((fields) => ({ fields, warnings: [] }));
}

/**
 * A spec-clean arbitrary as the serialized STRING (the input a round-trip /
 * immutability runner parses). Guaranteed warning-free and round-trip-exact.
 */
export function fakeSpecCleanRaw(): fc.Arbitrary<string> {
  return fakeSpecCleanMessage().map(fakeSerialize);
}

/**
 * A hostile arbitrary for the lenient runner: a grab-bag of empty pairs,
 * duplicate keys, the fatal token, missing `=`, and random binary. The fake
 * recovers all but the fatal token.
 */
export function fakeHostileRaw(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant("FATAL"),
    fc.constant(""),
    fc.constant("a=1;;b=2"),
    fc.constant("k=1;k=2;k=3"),
    fc.constant("novalue"),
    fc.string({ unit: "binary", maxLength: 40 }),
  );
}
