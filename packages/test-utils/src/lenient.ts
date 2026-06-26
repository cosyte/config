/**
 * The lenient-mode invariant runner — the Postel's-Law *parse* side, generalized.
 *
 * Every `@cosyte/*` parser is liberal in what it accepts: hostile, truncated, or
 * vendor-quirky input must be *recovered into warnings*, never thrown — except
 * for a small, fixed set of unrecoverable structural failures (the "fatal"
 * codes). This module turns that contract into a parametric property:
 *
 * - `parse` throws **only** when {@link LenientOptions.isFatal | isFatal} says so;
 * - every recovered warning carries a **registered** `code`
 *   ({@link LenientOptions.isKnownCode | isKnownCode}) — no ad-hoc codes leak;
 * - and, optionally, every warning carries **positional context**
 *   ({@link LenientOptions.hasPositionalContext | hasPositionalContext}).
 *
 * The kit owns the invariant; the parser owns the arbitrary, the warning shape,
 * and the fatal/known-code predicates. There is no format knowledge here.
 *
 * @packageDocumentation
 */

import assert from "node:assert/strict";
import { inspect } from "node:util";

import type { Arbitrary } from "fast-check";
import fc from "fast-check";

import { DEFAULT_NUM_RUNS } from "./internal/config.js";

/**
 * The minimal shape every parser's warning must expose for this runner: a string
 * `code` and an optional positional `position`. Parsers carry richer warnings;
 * the runner only reads these two fields.
 */
export interface LenientWarning {
  /** The stable, registered warning code (e.g. `"UNKNOWN_SEGMENT"`). */
  readonly code: string;
  /** Optional positional context (segment/offset/line — parser-defined). */
  readonly position?: unknown;
}

/**
 * Options for {@link lenientNeverThrowsProperty}.
 *
 * @template TArb - The generated input type (typically `string` or `Uint8Array`).
 */
export interface LenientOptions<TArb> {
  /** Generator of hostile / quirky / malformed inputs (the parser's own arbitrary). */
  readonly arbitrary: Arbitrary<TArb>;
  /** The parser under test, called in its lenient (default) mode. */
  readonly parse: (raw: TArb) => unknown;
  /**
   * Predicate deciding whether a thrown value is an *allowed* fatal. Return
   * `true` only for the parser's sanctioned unrecoverable errors; any throw for
   * which this returns `false` fails the invariant.
   */
  readonly isFatal: (err: unknown) => boolean;
  /** Extract the warnings from a successfully-parsed value. */
  readonly getWarnings: (parsed: unknown) => ReadonlyArray<LenientWarning>;
  /** Predicate: is `code` a member of the parser's public warning-code set? */
  readonly isKnownCode: (code: string) => boolean;
  /**
   * Optional predicate asserting a warning carries positional context. When
   * supplied, every emitted warning must satisfy it.
   */
  readonly hasPositionalContext?: (warning: LenientWarning) => boolean;
  /** Number of generated cases. Defaults to {@link DEFAULT_NUM_RUNS}. */
  readonly numRuns?: number;
}

/**
 * Assert the lenient-mode robustness invariant over generated hostile input.
 *
 * For every generated input the runner calls `parse`. If `parse` **throws**, the
 * thrown value must satisfy `isFatal` — otherwise the property fails (a non-fatal
 * deviation escaped as an exception instead of becoming a warning). If `parse`
 * **returns**, every warning it produced must have a `code` accepted by
 * `isKnownCode`, and — when `hasPositionalContext` is supplied — must satisfy it.
 *
 * Throws an `AssertionError` (via `node:assert/strict`) on the first failure, so
 * any test runner reports it. No test-framework dependency.
 *
 * @template TArb - The generated input type.
 * @param options - The arbitrary, the parser, and the fatal/known-code predicates.
 * @returns Nothing; it throws on the first counterexample.
 * @example
 * ```ts
 * import { lenientNeverThrowsProperty } from "@cosyte/test-utils";
 * import { parseHL7, Hl7ParseError, FATAL_CODES, WARNING_CODES } from "@cosyte/hl7";
 *
 * const fatal = new Set(Object.values(FATAL_CODES));
 * const known = new Set(Object.values(WARNING_CODES));
 *
 * lenientNeverThrowsProperty({
 *   arbitrary: hostileInput(), // the parser's own quirky/malformed generator
 *   parse: (raw: string) => parseHL7(raw),
 *   isFatal: (err) => err instanceof Hl7ParseError && fatal.has(err.code),
 *   getWarnings: (m) => (m as { warnings: { code: string; position?: unknown }[] }).warnings,
 *   isKnownCode: (code) => known.has(code),
 *   hasPositionalContext: (w) => typeof w.position === "object" && w.position !== null,
 * });
 * ```
 */
export function lenientNeverThrowsProperty<TArb>(options: LenientOptions<TArb>): void {
  const {
    arbitrary,
    parse,
    isFatal,
    getWarnings,
    isKnownCode,
    hasPositionalContext,
    numRuns = DEFAULT_NUM_RUNS,
  } = options;

  fc.assert(
    fc.property(arbitrary, (raw) => {
      let parsed: unknown;
      try {
        parsed = parse(raw);
      } catch (err) {
        // The ONLY sanctioned escape hatch is an allowed fatal.
        assert.ok(
          isFatal(err),
          `lenient: parse threw a non-fatal error — only sanctioned fatals may throw, got ${describeThrown(err)}`,
        );
        return;
      }

      for (const warning of getWarnings(parsed)) {
        assert.ok(
          isKnownCode(warning.code),
          `lenient: warning carries an unregistered code ${JSON.stringify(warning.code)} — every emitted code must be in the public warning-code set`,
        );
        if (hasPositionalContext !== undefined) {
          assert.ok(
            hasPositionalContext(warning),
            `lenient: warning ${JSON.stringify(warning.code)} is missing positional context`,
          );
        }
      }
    }),
    { numRuns },
  );
}

/** Render a thrown value for an assertion message without assuming it is an Error. */
function describeThrown(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  // `inspect` safely stringifies any `unknown` (primitives, objects, symbols)
  // without the `[object Object]` trap that `String(err)` would risk.
  return inspect(err, { depth: 1 });
}
