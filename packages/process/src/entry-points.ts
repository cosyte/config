/**
 * The bin's entry points that are not verbs.
 *
 * A verb delegates to a tool, is graded by `cosyte-process check`, and can be adjusted by the
 * override file. These two are none of those things: they are canonical scripts a repo used to carry
 * a copy of, reached through the bin it already has. Keeping them out of `VERBS` is what holds that
 * apart, so the wiring check still grades exactly the five verb scripts and the override file still
 * accepts exactly the five verb names.
 */

/** An entry point of the `cosyte-process` bin that is not a verb. */
export type EntryPoint = "sync-version" | "pack-docs";

/**
 * The entry points, in the order the usage text lists them.
 *
 * @example
 * ENTRY_POINTS.includes("sync-version"); // => true
 */
export const ENTRY_POINTS: readonly EntryPoint[] = ["sync-version", "pack-docs"];

/**
 * Narrow an arbitrary string to an entry point.
 *
 * @param value - Candidate name, typically straight off argv.
 * @returns True when `value` is one of the entry points.
 * @example
 * isEntryPoint("build"); // => false
 */
export function isEntryPoint(value: string): value is EntryPoint {
  return (ENTRY_POINTS as readonly string[]).includes(value);
}
