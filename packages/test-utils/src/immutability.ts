/**
 * The immutability invariant runner — generalized.
 *
 * The parsed model of every `@cosyte/*` parser is immutable by default: the only
 * sanctioned way to change it is an explicit mutation method, and any such method
 * must leave previously-read state untouched (it rebuilds rather than edits in
 * place). This module turns that contract into a parametric property.
 *
 * **The contract a parser opts into by using this runner:**
 *
 * - `getSnapshot(parsed)` returns a *value snapshot* of the part of the model
 *   under scrutiny — something deep-equal will compare structurally (a string,
 *   a plain object, an array of leaves). It must capture the state by value, not
 *   hand back a live reference into the model.
 * - `mutate(parsed)` attempts to change the model. A correct immutable model
 *   responds in one of two ways: it **throws** (the field is frozen / read-only),
 *   or it **returns a new instance** and leaves the original alone. Either way,
 *   the snapshot taken *before* the attempt must still hold *after* it.
 *
 * The runner asserts exactly that: snapshot, attempt `mutate`, re-snapshot, and
 * require the two snapshots to be deep-equal. A model that mutates the original
 * in place fails. There is no format knowledge here.
 *
 * @packageDocumentation
 */

import assert from "node:assert/strict";

import type { Arbitrary } from "fast-check";
import fc from "fast-check";

import { DEFAULT_NUM_RUNS } from "./internal/config.js";

/**
 * Options for {@link immutabilityProperty}.
 *
 * @template T - The parsed model type returned by `parse`.
 */
export interface ImmutabilityOptions<T> {
  /** Generator of inputs that parse cleanly into a model (the parser's own arbitrary). */
  readonly arbitrary: Arbitrary<string>;
  /** Parse an input string into the model under test. */
  readonly parse: (raw: string) => T;
  /**
   * Attempt to mutate the parsed model. A correct immutable model either throws
   * here or returns a new instance without touching the original — both are
   * accepted. The return value is ignored; only the effect on the original
   * (via `getSnapshot`) is asserted.
   */
  readonly mutate: (parsed: T) => unknown;
  /**
   * Capture the scrutinized state of the model *by value*. The runner compares
   * the snapshot from before the mutation attempt with the one after it using
   * deep-equality, so this must not return a live reference into the model.
   */
  readonly getSnapshot: (parsed: T) => unknown;
  /** Number of generated cases. Defaults to {@link DEFAULT_NUM_RUNS}. */
  readonly numRuns?: number;
}

/**
 * Assert the immutability invariant over generated models.
 *
 * For every generated input the runner parses a model, snapshots it via
 * `getSnapshot`, attempts `mutate` (tolerating a throw — that is a valid frozen
 * response), then snapshots again and asserts the two snapshots are deep-equal.
 * A model whose original state changed as a side effect of `mutate` fails.
 *
 * Throws an `AssertionError` (via `node:assert/strict`) on the first failure, so
 * any test runner reports it. No test-framework dependency.
 *
 * @template T - The parsed model type.
 * @param options - The arbitrary, the parse/mutate/snapshot triple, and tuning.
 * @returns Nothing; it throws on the first counterexample.
 * @example
 * ```ts
 * import { immutabilityProperty } from "@cosyte/test-utils";
 * import { parseHL7 } from "@cosyte/hl7";
 *
 * immutabilityProperty({
 *   arbitrary: specCleanMessage(), // the parser's own generator of valid inputs
 *   parse: (raw: string) => parseHL7(raw),
 *   // The frozen warnings array must reject a push (throws) — a valid response.
 *   mutate: (m) => (m.warnings as unknown[]).push({ code: "X" }),
 *   getSnapshot: (m) => m.warnings.map((w) => w.code),
 * });
 * ```
 */
export function immutabilityProperty<T>(options: ImmutabilityOptions<T>): void {
  const { arbitrary, parse, mutate, getSnapshot, numRuns = DEFAULT_NUM_RUNS } = options;

  fc.assert(
    fc.property(arbitrary, (raw) => {
      const parsed = parse(raw);
      const before = getSnapshot(parsed);

      // A frozen/read-only model may throw on a mutation attempt — that is a
      // sanctioned response, not a failure. We only care that the original is
      // unchanged afterward, so swallow the throw and fall through to compare.
      try {
        mutate(parsed);
      } catch {
        // Intentionally ignored: throwing is one of the two correct outcomes.
      }

      const after = getSnapshot(parsed);
      assert.deepStrictEqual(
        after,
        before,
        "immutability: the original model's snapshot changed after a mutation attempt — mutation must throw or return a new instance, never edit in place",
      );
    }),
    { numRuns },
  );
}
