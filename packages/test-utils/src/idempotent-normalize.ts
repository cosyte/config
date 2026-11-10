/**
 * The idempotent-normalize invariant runner.
 *
 * A parser that normalizes (canonical delimiters, trimmed padding, ordered fields, a lenient
 * parse written back out) makes a promise: normalizing what it already normalized changes nothing.
 * `normalize(normalize(x))` equals `normalize(x)`. A normalizer that keeps moving its own output
 * (an escape applied twice, a field reordered on every pass) breaks every cache, diff and
 * signature built on its output.
 *
 * The kit owns the invariant; the parser owns the arbitrary and the normalizer. For most parsers
 * the normalizer is `(raw) => serialize(parse(raw))` and the arbitrary is raw input the parser
 * accepts, messy on purpose.
 *
 * @packageDocumentation
 */

import assert from "node:assert/strict";

import type { Arbitrary } from "fast-check";
import fc from "fast-check";

import { assertProperty, type PropertyRunOptions } from "./property.js";

/**
 * Options for {@link idempotentNormalizeProperty}.
 *
 * @template T - The type the arbitrary produces and the normalizer takes and returns.
 */
export interface IdempotentNormalizeOptions<T> extends PropertyRunOptions {
  /** Generator of inputs the normalizer accepts (the parser's own arbitrary). */
  readonly arbitrary: Arbitrary<T>;
  /** The normalizer under test, for example `(raw) => serialize(parse(raw))`. */
  readonly normalize: (value: T) => T;
  /**
   * Equality for two normalized values. Defaults to `node:assert`'s deep strict equality, which
   * for strings is `===`.
   */
  readonly equals?: (a: T, b: T) => boolean;
}

/**
 * Assert that normalizing is idempotent over generated input: for every generated `x`,
 * `normalize(normalize(x))` equals `normalize(x)`.
 *
 * Throws on the first counterexample, with the seed and path that replay it, so any test runner
 * reports it. No test-framework dependency.
 *
 * @template T - The normalized type.
 * @param options The arbitrary, the normalizer, and the run options.
 * @returns Nothing; it throws on the first counterexample.
 * @example
 * ```ts
 * import fc from "fast-check";
 * import { idempotentNormalizeProperty } from "@cosyte/test-utils";
 *
 * idempotentNormalizeProperty({
 *   arbitrary: fc.string(),
 *   normalize: (raw) => raw.trim().replace(/\s+/g, " "),
 * });
 * ```
 */
export function idempotentNormalizeProperty<T>(options: IdempotentNormalizeOptions<T>): void {
  const { arbitrary, normalize, equals } = options;

  assertProperty(
    "idempotent normalize",
    fc.property(arbitrary, (value) => {
      const once = normalize(value);
      const twice = normalize(once);
      if (equals === undefined) {
        assert.deepStrictEqual(
          twice,
          once,
          "idempotent normalize: normalize(normalize(x)) is not deep-equal to normalize(x)",
        );
      } else {
        assert.ok(
          equals(twice, once),
          "idempotent normalize: normalize(normalize(x)) does not satisfy the supplied `equals` against normalize(x)",
        );
      }
    }),
    options,
  );
}
