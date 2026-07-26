/**
 * The synthetic workload the perf kit's own tests measure, in **its own module** on purpose.
 *
 * A workload defined inside a test file is called through a plain local binding; one imported from
 * another module is called through a Vite-SSR namespace getter (V4). A consumer's `parse` comes from
 * its own `src/`, so it is the second shape — and it is the shape PERF-P0's calibration was taken
 * against. Defining these inline would test the kit under a host no adopting package runs under.
 *
 * Both parsers are lifted from `experiments/perf-calibration/` so the kit's own tests exercise
 * exactly the code the constants in ADR 0001 were measured against. `parseMessage` is linear in the
 * total byte length; `parseMessageQuadratic` computes **the same output** in O(segments × length) by
 * re-scanning from offset 0 for every segment — the shape a real "just use `indexOf`" refactor
 * regression takes, not a pathological sleep. It deliberately does not lean on `slice` being a copy:
 * V8 returns an O(1) SlicedString for long strings, which would quietly make the naive
 * implementation linear again.
 *
 * PHI: every value below is fabricated and generated in-process. There are no fixture files and no
 * corpus on disk — the generators are the only input source, which is the shape the kit requires of
 * its callers.
 */

/** One parsed segment: its id, and its fields split into components. */
export interface Segment {
  readonly id: string;
  readonly fields: readonly (readonly string[])[];
}

/** A parsed message. */
export interface ParsedMessage {
  readonly segments: readonly Segment[];
}

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
 * Split a segment-oriented message into segments → fields → components. Single forward pass, one
 * split per level, no backtracking and no regex: **linear** in the total byte length.
 */
export function parseMessage(raw: string): ParsedMessage {
  const segments: Segment[] = [];
  for (const line of raw.split("\r")) {
    if (line.length === 0) continue;
    segments.push(splitLine(line));
  }
  return { segments };
}

/**
 * The injected regression: the same result as {@link parseMessage}, reached in
 * O(segments × length) because the start of segment `i` is found by walking the delimiters from
 * offset 0 every time instead of carrying a cursor.
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

/** Synthetic admit message, five segments, **fixed** size — the count axis's corpus. */
export function admitMessage(i: number): string {
  const id = String(i).padStart(6, "0");
  return (
    `MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20260101120000||ADT^A01|A${id}|P|2.5\r` +
    `EVN|A01|20260101120000\r` +
    `PID|1||SYNTHETIC${id}^^^HOSP^MR||Nobody^Nemo^Q||19800101|F|||1 Fake St^^Nowhere^ZZ^00000\r` +
    `NK1|1|Nobody^Noone^R|SPO|1 Fake St^^Nowhere^ZZ^00000\r` +
    `PV1|1|I|WARD^101^A|||||SYNTH999^Nobody^Robert\r`
  );
}

/**
 * Synthetic result message with `resultLines` repeated result segments — the size axis's knob.
 * `resultLines` is what the gate scales 4×.
 */
export function resultMessage(i: number, resultLines: number): string {
  const id = String(i).padStart(6, "0");
  const obx = Array.from(
    { length: resultLines },
    (_v, k) =>
      `OBX|${String(k + 1)}|NM|GLU^Glucose^LN||${String(80 + (k % 40))}|mg/dL|70-110|N|||F|||20260101120000`,
  ).join("\r");
  return (
    `MSH|^~\\&|LAB|SENDFAC|EHR|RECVFAC|20260101120000||ORU^R01|R${id}|P|2.5\r` +
    `PID|1||SYNTHETIC${id}^^^HOSP^MR||Nobody^Sam^T||19750615|M\r` +
    `OBR|1||ACC${id}|CBC^Complete Blood Count^LN|||20260101120000\r` +
    `${obx}\r`
  );
}

/** Count the segments a parse produced — the `weigh` these tests hand the runner. */
export function weighSegments(parsed: ParsedMessage): number {
  return parsed.segments.length;
}
