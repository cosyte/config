/**
 * Self-sizing on a real clock: a fixture far too small for `MIN_PHASE_MS`, which the gate without
 * self-sizing skips on every runner, is measured once the gate sizes its own phases, and a real
 * quadratic is still caught.
 *
 * The fixture is deliberately tiny: four admit messages against sixteen on the count axis, one
 * result message of 50 result lines against 200 on the size axis. One pass over either base corpus
 * takes microseconds, so the unsized gate's base phase is three orders of magnitude under the 4 ms
 * floor wherever it runs. That is the failure the libraries' gates kept hitting as their parsers got
 * faster, here made certain rather than left to the runner.
 *
 * Each case writes one `self-sizing:` line to stderr with the numbers it measured, so a CI log shows
 * the count chosen, the base phase before and after, and the ratio.
 *
 * Like every test in `timed/`, this one measures and so runs outside coverage, under
 * `vitest.perf.config.ts`. The `perf-self-sizing` workflow runs it on GitHub-hosted runners.
 */

import { describe, expect, it } from "vitest";

import {
  PERF_CONTRACT,
  assertScalingGateFires,
  scalingGate,
  type AxisReport,
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

/** The tiny fixture, with the parse under test and the result lines on the size axis. */
function tiny(
  parse: (raw: string) => ParsedMessage,
  resultLines: number,
  selfSize: boolean,
): ScalingGateOptions<string, ParsedMessage> {
  return {
    name: `tiny fixture, ${String(resultLines)} result lines`,
    parse,
    weigh: weighSegments,
    count: { n: 4, generate: (i) => admitMessage(i) },
    size: { inputs: 1, size: resultLines, generate: (i, size) => resultMessage(i, size) },
    report: () => undefined,
    selfSize,
  };
}

function note(label: string, axis: AxisReport): void {
  const ratio = axis.status === "measured" ? String(axis.ratio) : `none (${axis.skipReason})`;
  process.stderr.write(
    `self-sizing: ${label}, ${axis.axis} axis: ${axis.status}, ` +
      `passes ${String(axis.base?.passes)}, base min ${String(axis.base?.min)} ms, ` +
      `scaled min ${String(axis.scaled?.min)} ms, ratio ${ratio}\n`,
  );
}

describe("self-sizing on a real clock", () => {
  it(
    "measures the tiny fixture that the unsized gate skips",
    () => {
      const before = scalingGate(tiny(parseMessage, 50, false));
      note("unsized", before.count);
      note("unsized", before.size);
      for (const axis of [before.count, before.size]) {
        expect(axis.status, axis.diagnostic).toBe("skipped");
        if (axis.status !== "skipped") continue;
        expect(axis.skipReason).toBe("phase-too-short");
        expect(axis.base?.passes).toBe(1);
      }

      const after = scalingGate(tiny(parseMessage, 50, true));
      note("self-sized", after.count);
      note("self-sized", after.size);
      for (const axis of [after.count, after.size]) {
        expect(axis.status, axis.diagnostic).toBe("measured");
        if (axis.status !== "measured") continue;
        // It had to repeat to get there, and it ran the scaled phase the same number of times.
        expect(axis.base.passes).toBeGreaterThan(1);
        expect(axis.scaled.passes).toBe(axis.base.passes);
        expect(axis.base.min).toBeGreaterThanOrEqual(PERF_CONTRACT.MIN_PHASE_MS);
        expect(axis.ratio).toBeGreaterThanOrEqual(PERF_CONTRACT.RATIO_FLOOR);
        expect(axis.ratio).toBeLessThanOrEqual(PERF_CONTRACT.RATIO_CEILING);
      }
    },
    TIMEOUT,
  );

  it(
    "still fails a quadratic parser, sized: the ceiling is not diluted by repetition",
    () => {
      let thrown: (Error & { operator?: string; actual?: number }) | undefined;
      try {
        scalingGate(tiny(parseMessageQuadratic, 1_000, true));
      } catch (error) {
        thrown = error as Error & { operator?: string; actual?: number };
      }
      process.stderr.write(
        `self-sizing: quadratic parse, sized: ${thrown?.operator ?? "no failure"}, ` +
          `ratio ${String(thrown?.actual)}\n`,
      );
      expect(thrown?.operator, thrown?.message).toBe("perf-scaling-ceiling");
      expect(thrown?.message).toContain("size axis");
      expect(thrown?.message).toContain("self-sized:");
    },
    TIMEOUT,
  );

  it(
    "the self-check, sized, passes where a quadratic clears the ceiling",
    () => {
      const report = assertScalingGateFires(tiny(parseMessage, 1_000, true), {
        regressedParse: parseMessageQuadratic,
      });
      process.stderr.write(
        `self-sizing: self-check at 1000 result lines: signal ${String(report.signal)}, ` +
          `margin ${String(report.margin)}, passes ${String(report.passes)}, clean passes ` +
          `${String(report.cleanPasses.count)} (count) / ${String(report.cleanPasses.size)} (size)\n`,
      );
      expect(report.signal).toBeGreaterThan(PERF_CONTRACT.RATIO_CEILING);
      // The count axis of four admit messages could not have cleared the floor in one pass.
      expect(report.cleanPasses.count).toBeGreaterThan(1);
      expect(report.cleanBaseMinMs.count).toBeGreaterThanOrEqual(PERF_CONTRACT.MIN_PHASE_MS);
    },
    TIMEOUT,
  );

  it(
    "the self-check, sized, still fails where the fixture is too small to show a quadratic",
    () => {
      // Repetition lifts a phase over the floor; it cannot lift a signal over the ceiling. At 20
      // result lines the quadratic's extra work is small next to the linear work, so its ratio sits
      // inside the band and this fixture cannot prove its gate can fail. (At 50 lines five
      // GitHub-hosted runners read 6.55 to 6.90, too close to the ceiling of 8 for a case that must
      // fail every time.)
      let thrown: (Error & { operator?: string; actual?: number }) | undefined;
      try {
        assertScalingGateFires(tiny(parseMessage, 20, true), {
          regressedParse: parseMessageQuadratic,
        });
      } catch (error) {
        thrown = error as Error & { operator?: string; actual?: number };
      }
      process.stderr.write(
        `self-sizing: self-check at 20 result lines: ${thrown?.operator ?? "no failure"}, ` +
          `signal ${String(thrown?.actual)}\n`,
      );
      expect(thrown?.operator).toBe("perf-self-check");
      expect(thrown?.message).toContain("does not clear");
    },
    TIMEOUT,
  );
});
