/**
 * PERF-P0 calibration workload: a deliberately ordinary, deliberately LINEAR parser.
 *
 * The calibration measures the *measurement technique*, not a parser. So the workload has to be
 * a stand-in for "a `@cosyte/*` parser doing its normal job": string scanning, delimiter splitting,
 * small object construction, one array per segment. It is O(total input bytes) by construction.
 * Every ratio this experiment records is therefore a measurement of harness noise, JIT state and
 * coverage instrumentation, never of a real algorithmic regression. Any spread we see is the
 * false-alarm distribution the gate's ceiling has to clear.
 *
 * It lives in its own module (rather than inline in the test file) on purpose: `hl7`'s shipped gate
 * imports its parser from `../../src/index.js`, which Vite's SSR transform rewrites into namespace
 * property accesses (V4) and which `@vitest/coverage-v8` instruments (V1). A workload defined inside
 * the test file would dodge both effects and calibrate the wrong thing.
 *
 * PHI: every value below is fabricated. No fixture files, no corpus; the generators are the only
 * input source, which is the shape §6 of the roadmap requires of the eventual kit.
 */

export interface Segment {
  readonly id: string;
  readonly fields: readonly (readonly string[])[];
}

export interface ParsedMessage {
  readonly segments: readonly Segment[];
}

/**
 * Split an HL7-shaped message into segments → fields → components. Single forward pass, one split
 * per level, no backtracking and no regex: linear in the total byte length.
 */
export function parseMessage(raw: string): ParsedMessage {
  const segments: Segment[] = [];
  for (const line of raw.split("\r")) {
    if (line.length === 0) continue;
    const rawFields = line.split("|");
    const fields: string[][] = [];
    for (let i = 1; i < rawFields.length; i++) {
      const f = rawFields[i] ?? "";
      fields.push(f.includes("^") ? f.split("^") : [f]);
    }
    segments.push({ id: rawFields[0] ?? "", fields });
  }
  return { segments };
}

/** Synthetic ADT^A01, 5 segments, fixed size. Mirrors the shape `hl7`'s own gate parses. */
export function adtMessage(i: number): string {
  const id = String(i).padStart(6, "0");
  return (
    `MSH|^~\\&|SENDAPP|SENDFAC|RECVAPP|RECVFAC|20260101120000||ADT^A01|A${id}|P|2.5\r` +
    `EVN|A01|20260101120000\r` +
    `PID|1||FAKE${id}^^^HOSP^MR||Doe^Jane^Q||19800101|F|||123 Main St^^Anytown^CA^90001\r` +
    `NK1|1|Doe^John^R|SPO|123 Main St^^Anytown^CA^90001\r` +
    `PV1|1|I|WARD^101^A|||||DOC123^Smith^Robert\r`
  );
}

/** Synthetic ORU^R01 with `obxCount` result lines: the size axis's knob. */
export function oruMessage(i: number, obxCount = 8): string {
  const id = String(i).padStart(6, "0");
  const obx = Array.from(
    { length: obxCount },
    (_v, k) =>
      `OBX|${String(k + 1)}|NM|GLU^Glucose^LN||${String(80 + (k % 40))}|mg/dL|70-110|N|||F|||20260101120000`,
  ).join("\r");
  return (
    `MSH|^~\\&|LAB|SENDFAC|EHR|RECVFAC|20260101120000||ORU^R01|R${id}|P|2.5\r` +
    `PID|1||FAKE${id}^^^HOSP^MR||Roe^Sam^T||19750615|M\r` +
    `OBR|1||ACC${id}|CBC^Complete Blood Count^LN|||20260101120000\r` +
    `${obx}\r`
  );
}

/**
 * Accumulator the parse results are summed into. Exported and read back by the caller so neither
 * Turboshaft's use-based dead-code-elimination reducer (W5) nor escape analysis can drop the parse.
 */
export const sink = { value: 0 };

/**
 * Parse `msgs` `reps` times, returning the FULL sample vector in milliseconds: never a reduced
 * statistic. Which estimator to headline is exactly what P1 has to decide (W2 says min-of-N is
 * unbacked), so P0 must not pre-reduce the data.
 */
export function timePhase(msgs: readonly string[], reps: number): number[] {
  const samples: number[] = [];
  for (let r = 0; r < reps; r++) {
    let local = 0;
    const t0 = performance.now();
    for (const m of msgs) local += parseMessage(m).segments.length;
    samples.push(performance.now() - t0);
    sink.value += local;
  }
  return samples;
}
