/**
 * PERF-P0 · the SIGNAL side — a deliberately O(n²)-in-length parser.
 *
 * The ceiling constant is an argument with two sides: the false-alarm tail a linear workload
 * produces (`workload.ts`, measured over 3,200 trials) and the value a genuine complexity regression
 * produces. The second number was inherited as "≈16" from `hl7`'s gate comment — arithmetic, not
 * measurement. A ceiling justified by half a measurement is exactly the kind of constant P0 exists
 * to stop P1 from freezing, so this module supplies the other half.
 *
 * **This is a separate module on purpose.** `workload.ts` is the module the 3,200 committed ratio
 * measurements were taken against; adding a function to it would change its bytecode length and its
 * coverage block count, and would silently invalidate that dataset. Nothing here is imported by
 * `ratio-calibration.test.ts`.
 *
 * The quadratic is honest rather than pathological: `parseMessageQuadratic` produces exactly the
 * same output as `parseMessage`, and gets there by re-scanning from the start of the message to find
 * each segment — the shape a real "just use indexOf" refactor regression takes. It does not rely on
 * `slice` being a copy (V8 returns an O(1) SlicedString for long strings, which would have quietly
 * made the obvious implementation linear).
 */

import type { ParsedMessage, Segment } from "./workload.js";

/** Split one segment line into fields → components. Identical to `workload.ts`'s inner loop. */
function splitLine(line: string): Segment {
  const rawFields = line.split("|");
  const fields: string[][] = [];
  for (let i = 1; i < rawFields.length; i++) {
    const f = rawFields[i] ?? "";
    fields.push(f.includes("^") ? f.split("^") : [f]);
  }
  return { id: rawFields[0] ?? "", fields };
}

/**
 * Same result as `parseMessage`, reached in O(segments × length): the start of segment `i` is found
 * by walking the delimiters from offset 0 every time instead of carrying a cursor.
 */
export function parseMessageQuadratic(raw: string): ParsedMessage {
  const segments: Segment[] = [];
  let total = 0;
  for (let p = raw.indexOf("\r"); p !== -1; p = raw.indexOf("\r", p + 1)) total++;

  for (let i = 0; i <= total; i++) {
    let start = 0;
    for (let k = 0; k < i; k++) start = raw.indexOf("\r", start) + 1;
    let end = raw.indexOf("\r", start);
    if (end === -1) end = raw.length;
    if (end <= start) continue;
    segments.push(splitLine(raw.slice(start, end)));
  }
  return { segments };
}
