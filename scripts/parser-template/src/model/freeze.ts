/**
 * Freeze a value and everything reachable from it, and return it.
 *
 * A returned model is deep-frozen, so it crosses a pipeline without a copy and nothing downstream
 * can change it. `Object.freeze` alone stops at the first level, which leaves every nested array
 * and segment writable.
 *
 * @internal
 * @param value - A tree of plain objects and arrays.
 * @returns The same value, frozen at every level.
 * @example
 * ```ts no-run an internal helper the package does not export
 * Object.isFrozen(deepFreeze({ a: [1] }).a); // => true
 * ```
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
