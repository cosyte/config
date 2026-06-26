/**
 * Warning-code stability helper.
 *
 * The set of codes a parser can emit is part of its **public contract** —
 * consumers narrow on `warning.code`, so renaming or removing a code is a
 * breaking change. The convention is to snapshot the full sorted code set so any
 * such change shows up as a reviewable diff in a single test. This helper
 * produces the stable, sorted list that snapshot asserts against.
 *
 * The kit deliberately stops at producing the sorted array — the actual snapshot
 * (`toMatchSnapshot` / `toMatchInlineSnapshot`) belongs in the consumer's test,
 * because snapshots are a test-framework feature and this kit takes no
 * test-framework dependency.
 *
 * @packageDocumentation
 */

/**
 * Return the **values** of a warning/fatal code registry, sorted with a stable
 * locale-independent ordering, ready to feed a snapshot assertion.
 *
 * Pass the registry object (the `{ CODE: "CODE", … }` map parsers export); the
 * sorted list of its values is returned. Sorting makes the result insensitive to
 * declaration order, so the snapshot only changes when a code is genuinely added,
 * removed, or renamed.
 *
 * @param codes - A registry mapping code keys to code-string values.
 * @returns The registry's values, sorted ascending by Unicode code point.
 * @example
 * ```ts
 * import { expect, it } from "vitest";
 * import { sortedCodeSet } from "@cosyte/test-utils";
 * import { WARNING_CODES } from "@cosyte/hl7";
 *
 * it("warning-code surface is stable", () => {
 *   // A rename/removal turns into a failing snapshot diff — a deliberate tripwire.
 *   expect(sortedCodeSet(WARNING_CODES)).toMatchSnapshot();
 * });
 * ```
 */
export function sortedCodeSet(codes: Record<string, string>): string[] {
  // Localeless, deterministic order: compare by code point so the snapshot is
  // identical across machines/locales (unlike the default or localeCompare).
  return Object.values(codes).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
