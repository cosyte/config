/**
 * Fixture construction, input validation, and the PHI rule: all reachable without a clock.
 *
 * Two things are proved here that the timed tests cannot prove as cleanly:
 *
 * 1. **The size axis genuinely scales size.** The count axis holds input length constant and varies
 *    the number of inputs; the size axis holds the number of inputs constant and varies each one's
 *    length by `SCALE_STEP`. That distinction is the entire reason size-scaling is non-optional:
 *    an O(n²)-in-length tokenizer is invisible to the count axis by construction, because at fixed
 *    message size a quadratic parser still scores ≈4 there. Asserting it on the corpora rather than
 *    on a timing means it cannot be satisfied by a coincidence of the clock.
 * 2. **A diagnostic never echoes input content.** Every healthcare input is PHI by default, so the
 *    kit's failure paths carry sizes, counts and ratios only.
 *
 * Clock-free, so it runs in the default `pnpm test`.
 */

import { describe, expect, it } from "vitest";

import { PERF_CONTRACT, type ScalingGateOptions } from "../../src/perf/index.js";
import { buildAxisCorpora } from "../../src/perf/scaling-gate.js";
import { assertScalingGateFires } from "../../src/perf/self-check.js";
import {
  parseMessage,
  parseMessageQuadratic,
  admitMessage,
  resultMessage,
  weighSegments,
  type ParsedMessage,
} from "./_workload.js";

const options: ScalingGateOptions<string, ParsedMessage> = {
  name: "fixture shapes",
  parse: parseMessage,
  weigh: weighSegments,
  count: { n: 12, generate: (i) => admitMessage(i) },
  size: { inputs: 6, size: 20, generate: (i, size) => resultMessage(i, size) },
  report: () => {},
};

describe("buildAxisCorpora: the count axis", () => {
  const { base, scaled, baseSize, scaledSize } = buildAxisCorpora("count", options);

  it("scales the NUMBER of inputs by SCALE_STEP", () => {
    expect(base).toHaveLength(12);
    expect(scaled).toHaveLength(12 * PERF_CONTRACT.SCALE_STEP);
  });

  it("holds each input's length constant, so the ratio isolates count", () => {
    const lengths = new Set([...base, ...scaled].map((m) => m.length));
    expect(lengths.size).toBe(1);
  });

  it("reports no size knob, because this axis has none", () => {
    expect(baseSize).toBeNull();
    expect(scaledSize).toBeNull();
  });

  it("varies the generated input, so the corpus is not one object repeated", () => {
    // A corpus of N references to one string would let V8 cache and would make the floor's
    // "both phases got the same workload" check meaningless.
    expect(new Set(base).size).toBe(base.length);
  });
});

describe("buildAxisCorpora: the size axis", () => {
  const { base, scaled, baseSize, scaledSize } = buildAxisCorpora("size", options);

  it("holds the input COUNT constant on both phases, so the ratio isolates length", () => {
    expect(base).toHaveLength(6);
    expect(scaled).toHaveLength(6);
  });

  it("scales each input's length by SCALE_STEP", () => {
    expect(baseSize).toBe(20);
    expect(scaledSize).toBe(20 * PERF_CONTRACT.SCALE_STEP);
    // The generator's size knob is repeated segments, so bytes scale with it but not exactly 4x
    // (the fixed header is not repeated). What must hold is that the scaled input is materially
    // longer: this is the axis a quadratic-in-length parser blows up on.
    const baseLen = base[0]?.length ?? 0;
    const scaledLen = scaled[0]?.length ?? 0;
    expect(scaledLen).toBeGreaterThan(baseLen * 3.5);
  });

  it("scales the parsed segment count by SCALE_STEP, which is what the parser walks", () => {
    const baseSegments = parseMessage(base[0] ?? "").segments.length;
    const scaledSegments = parseMessage(scaled[0] ?? "").segments.length;
    // 3 header segments + `size` result segments on each side.
    expect(baseSegments).toBe(3 + 20);
    expect(scaledSegments).toBe(3 + 80);
  });

  it("is an axis the count axis structurally cannot stand in for", () => {
    // The count axis's inputs are all one fixed length; the size axis's differ by 4x. No count-axis
    // corpus can exercise a length-dependent regression, which is why the gate runs both and offers
    // no way to ask for one.
    const countCorpora = buildAxisCorpora("count", options);
    expect(new Set(countCorpora.scaled.map((m) => m.length)).size).toBe(1);
    expect(new Set([base[0]?.length, scaled[0]?.length]).size).toBe(2);
  });
});

describe("buildAxisCorpora: input validation", () => {
  it.each([
    ["count.n", { ...options, count: { ...options.count, n: 0 } }, "count" as const],
    ["count.n", { ...options, count: { ...options.count, n: 1.5 } }, "count" as const],
    ["size.inputs", { ...options, size: { ...options.size, inputs: 0 } }, "size" as const],
    ["size.size", { ...options, size: { ...options.size, size: -4 } }, "size" as const],
  ])("rejects a non-positive-integer %s", (label, bad, axis) => {
    expect(() => buildAxisCorpora(axis, bad)).toThrow(new RegExp(`${label.replace(".", "\\.")}`));
    expect(() => buildAxisCorpora(axis, bad)).toThrow(TypeError);
  });
});

describe("the self-check refuses a regression that computes something else", () => {
  // Checked BEFORE anything is timed, so this whole case is clock-free. A "regression" whose output
  // differs from the real parse is not a slower version of the program, it is a different program,
  // and its timing means nothing.
  const wrong = (raw: string): ParsedMessage => ({
    segments: parseMessage(raw).segments.slice(0, 1),
  });

  it("throws, naming the injection rather than the fixture contents", () => {
    expect(() => assertScalingGateFires(options, { regressedParse: wrong })).toThrow(
      /does not compute the same output/,
    );
  });

  it("accepts an honest regression that agrees with the real parse", () => {
    const first = options.size.generate(0, options.size.size);
    expect(JSON.stringify(parseMessageQuadratic(first))).toBe(JSON.stringify(parseMessage(first)));
  });

  it("supports a custom `equals` for models JSON does not round-trip", () => {
    const seen: number[] = [];
    expect(() =>
      assertScalingGateFires(options, {
        regressedParse: wrong,
        equals: (a, b) => {
          seen.push(a.segments.length + b.segments.length);
          return false;
        },
      }),
    ).toThrow(/does not compute the same output/);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("PHI: diagnostics carry sizes and counts, never input content", () => {
  // Every value in `_workload.ts` is fabricated, but the rule is structural: the kit takes a
  // generator function and never a file path, and no failure path may echo what it parsed. These
  // needles are the distinctive literals the generators emit.
  const needles = ["MSH", "SYNTHETIC", "Nobody", "Fake St", "OBX", "Glucose"];

  it("keeps input content out of the injection-mismatch failure", () => {
    let message = "";
    try {
      assertScalingGateFires(options, {
        regressedParse: (raw) => ({ segments: parseMessage(raw).segments.slice(0, 1) }),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    for (const needle of needles) expect(message).not.toContain(needle);
    // It still says enough to act on, which fixture, and what to do about it.
    expect(message).toMatch(/6 input\(s\) @ size 20 vs 80/);
  });

  it("keeps input content out of the validation failure", () => {
    let message = "";
    try {
      buildAxisCorpora("count", { ...options, count: { ...options.count, n: 0 } });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const needle of needles) expect(message).not.toContain(needle);
  });
});
