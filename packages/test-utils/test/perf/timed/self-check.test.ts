/**
 * PERF-P2's load-bearing acceptance clause: does the gate actually fire on a **real** O(n²) parser,
 * on a **real** clock, at the fixture sizes a **real** package's gate uses?
 *
 * Every other test of this kit runs on an injected clock, because every other question it asks is
 * about arithmetic and ordering. This one cannot be, and running it at some convenient size would be
 * theatre. The roadmap is explicit:
 *
 * > ⚠️ The injected-O(n²) check proves nothing unless run at **the fixture sizes that package's real
 * > gate uses** — the signal is size-dependent and can sit inside the noise.
 *
 * The ceiling of 8 is a global constant derived from two numbers moving in opposite directions: the
 * worst false alarm across 3,200 clean ratios (6.649, container leg — a constant) and the weakest
 * real O(n²) signal, which is *not* a constant. Measured, varying only the fixture:
 *
 * | base OBX → 4× | real O(n²) signal | worst false alarm | usable window |
 * | ------------- | ----------------- | ----------------- | ------------- |
 * | 125 → 500     | 4.69              | 6.649             | **none**      |
 * | 250 → 1000    | 8.09              | 6.649             | 1.22×         |
 * | 500 → 2000    | 8.84              | 6.649             | 1.33×         |
 * | 1000 → 4000   | 10.68             | 6.649             | 1.61×         |
 *
 * At 125 base segments a genuine quadratic parser is *inside the noise*, so a gate calibrated there
 * reads green while broken. The sizes below are `hl7`'s own — count `n = 1000` ADT messages; size
 * `10` ORU messages at 500 → 2000 OBX lines — which are the sizes PERF-P0's whole calibration was
 * taken at and the sizes P4 will migrate `hl7` onto.
 *
 * **This test measures, so it can be defeated by its runner.** On a CPU-quota-throttled container the
 * warmup rule legitimately refuses to settle and the check fails loudly rather than answering
 * wrongly — that is the fail-safe working, not a bug, but it does mean `pnpm test:perf` is a
 * deliberate command run on a machine you have some claim over, not a gate to hang on an arbitrary
 * CI runner. See `experiments/perf-p2-false-alarm/ANALYSIS.md` for the measured behaviour.
 */

import { describe, expect, it } from "vitest";

import {
  PERF_CONTRACT,
  assertScalingGateFires,
  type ScalingGateOptions,
} from "../../../src/perf/index.js";
import {
  admitMessage,
  parseMessage,
  parseMessageQuadratic,
  resultMessage,
  weighSegments,
  type ParsedMessage,
} from "../_workload.js";

const TIMEOUT = 300_000;

describe("assertScalingGateFires — a real O(n²) parser at a real fixture size", () => {
  it(
    "fires: the injected regression clears RATIO_CEILING at `hl7`'s own fixture sizes",
    () => {
      const lines: string[] = [];
      const options: ScalingGateOptions<string, ParsedMessage> = {
        name: "hl7-sized fixture",
        parse: parseMessage,
        weigh: weighSegments,
        count: { n: 1_000, generate: (i) => admitMessage(i) },
        size: { inputs: 10, size: 500, generate: (i, size) => resultMessage(i, size) },
        report: (line) => lines.push(line),
      };

      const report = assertScalingGateFires(options, { regressedParse: parseMessageQuadratic });

      // The signal side. P0 measured 8.84 for this fixture shape at 2 messages per phase; 10
      // messages per phase is the same ratio with more work behind it.
      expect(report.signal).toBeGreaterThan(PERF_CONTRACT.RATIO_CEILING);
      expect(report.margin).toBeGreaterThan(1);
      expect(report.axis).toBe("size");

      // It ran at the sizes the real gate uses, not at a convenient one. This is the assertion that
      // stops the whole exercise from being theatre.
      expect(report.baseSize).toBe(500);
      expect(report.inputs).toEqual([10, 10]);

      // The precondition side: the CLEAN parse — the one the real gate measures — can produce a
      // ratio rather than skipping `phase-too-short` forever, on BOTH axes the gate asserts, not
      // just the one the injected regression exercises.
      expect(report.cleanBaseMinMs.count).toBeGreaterThanOrEqual(PERF_CONTRACT.MIN_PHASE_MS);
      expect(report.cleanBaseMinMs.size).toBeGreaterThanOrEqual(PERF_CONTRACT.MIN_PHASE_MS);

      // Full sample vectors retained, never pre-reduced.
      expect(report.samples.base).toHaveLength(PERF_CONTRACT.REPS);
      expect(report.samples.scaled).toHaveLength(PERF_CONTRACT.REPS);

      // PHI: sizes, counts, ratios and timings only — never what was parsed.
      const emitted = [report.diagnostic, ...lines].join("\n");
      for (const needle of ["MSH", "SYNTHETIC", "Nobody", "Glucose", "OBX|"]) {
        expect(emitted).not.toContain(needle);
      }
      expect(emitted).toContain("10 input(s) @ size 500 vs 2000");
    },
    TIMEOUT,
  );

  it(
    "the injected regression computes byte-identical output to the real parser",
    () => {
      // A "regression" that computes something else is a different program and its timing means
      // nothing. The self-check asserts this before it times anything; asserted separately here
      // because it is the premise the whole measurement rests on.
      for (const size of [1, 7, 125, 500, 2_000]) {
        const raw = resultMessage(3, size);
        expect(JSON.stringify(parseMessageQuadratic(raw))).toBe(JSON.stringify(parseMessage(raw)));
      }
      const adt = admitMessage(11);
      expect(JSON.stringify(parseMessageQuadratic(adt))).toBe(JSON.stringify(parseMessage(adt)));
    },
    TIMEOUT,
  );
});
