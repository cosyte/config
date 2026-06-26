/**
 * The round-trip invariant runner — the Postel's-Law *serialize* side, generalized.
 *
 * Every `@cosyte/*` parser makes the same promise: a value its builder/serializer
 * can emit must survive `serialize → parse` unchanged, and serialization must be
 * idempotent (re-serializing a parsed value yields byte-identical output). This
 * module turns that promise into a parametric property the parser feeds its own
 * format-specific {@link https://fast-check.dev/ | fast-check} arbitrary into.
 *
 * The kit owns the *invariant*; the parser owns the *arbitrary*. There is no HL7
 * / DICOM / X12 knowledge here.
 *
 * @packageDocumentation
 */

import assert from "node:assert/strict";

import type { Arbitrary } from "fast-check";
import fc from "fast-check";

import { DEFAULT_NUM_RUNS } from "./internal/config.js";

/**
 * Options for {@link roundTripProperty}.
 *
 * @template T - The in-memory value type the arbitrary produces and `parse` returns.
 */
export interface RoundTripOptions<T> {
  /** Generator of spec-valid in-memory values (the parser's own arbitrary). */
  readonly arbitrary: Arbitrary<T>;
  /** Serialize a value to its on-the-wire string form. */
  readonly serialize: (value: T) => string;
  /** Parse a wire string back into an in-memory value. */
  readonly parse: (raw: string) => T;
  /**
   * Structural-equality predicate for two parsed values. Defaults to
   * `node:assert`'s {@link https://nodejs.org/api/assert.html#assertdeepstrictequalactual-expected-message | deepStrictEqual}.
   * Supply a custom one when the model carries identity/order that deep-equal
   * would reject (e.g. cached wrappers, Maps with insertion order).
   */
  readonly equals?: (a: T, b: T) => boolean;
  /** Number of generated cases. Defaults to {@link DEFAULT_NUM_RUNS}. */
  readonly numRuns?: number;
}

/**
 * Assert the round-trip + serialize-idempotency invariant over generated values.
 *
 * For every generated `x` this checks two things:
 *
 * 1. **Round-trip equality** — `parse(serialize(x))` equals `x` (deep-equal by
 *    default, or via the supplied `equals`).
 * 2. **Serialize idempotency** — `serialize(parse(serialize(x))) === serialize(x)`,
 *    i.e. once a value is in canonical serialized form, re-parsing and
 *    re-serializing it is a no-op at the byte level.
 *
 * Throws an `AssertionError` (via `node:assert/strict`) on the first failure, so
 * any test runner — Vitest, `node:test`, Mocha — reports it. This runner does
 * not depend on a test framework.
 *
 * @template T - The in-memory value type.
 * @param options - The arbitrary, serialize/parse pair, and tuning knobs.
 * @returns Nothing; it throws on the first counterexample.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { roundTripProperty } from "@cosyte/test-utils";
 * import { parseHL7 } from "@cosyte/hl7";
 *
 * roundTripProperty({
 *   arbitrary: specCleanMessage(), // the parser's own fast-check arbitrary
 *   serialize: (m) => m.toString(),
 *   parse: (raw) => parseHL7(raw),
 *   equals: (a, b) => a.toString() === b.toString(), // structural via canonical form
 * });
 * ```
 */
export function roundTripProperty<T>(options: RoundTripOptions<T>): void {
  const { arbitrary, serialize, parse, equals, numRuns = DEFAULT_NUM_RUNS } = options;

  fc.assert(
    fc.property(arbitrary, (value) => {
      const once = serialize(value);
      const reparsed = parse(once);

      // 1. Round-trip equality (deep-equal default, or caller's structural check).
      if (equals === undefined) {
        assert.deepStrictEqual(
          reparsed,
          value,
          "round-trip: parse(serialize(x)) is not deep-equal to x",
        );
      } else {
        assert.ok(
          equals(reparsed, value),
          "round-trip: parse(serialize(x)) does not satisfy the supplied `equals` against x",
        );
      }

      // 2. Serialize idempotency from the second pass onward.
      const twice = serialize(reparsed);
      assert.strictEqual(
        twice,
        once,
        "round-trip: serialization is not idempotent — serialize(parse(serialize(x))) !== serialize(x)",
      );
    }),
    { numRuns },
  );
}
