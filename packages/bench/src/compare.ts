/**
 * The base against head comparison, and its calibration.
 *
 * A comparison is `ROUNDS` rounds. In each round every case runs once on the base build and once on
 * the head build, each in a fresh process, back to back; even rounds run the base first, odd rounds
 * the head. A drift in the machine over the run lands on both sides of a round, seconds apart, and
 * cancels in their ratio; an order effect lands on the head in half the rounds and on the base in
 * the other half, so it widens the spread of the ratios instead of biasing their median.
 *
 * Each round gives one ratio per case, `head / base` of the two processes' fastest samples. The
 * fastest, not the median, because the noise on a shared machine is one-sided (another tenant only
 * ever slows a sample down), and ADR 0001 section 1 measured `min` as the one estimator that keeps a
 * stall on one side out of a ratio. The verdict reads the sign test's interval on the median of the
 * per-round ratios, which assumes nothing about the shape of the noise, only that rounds are
 * independent.
 *
 * @packageDocumentation
 */

import type { Job, JobResult } from "./child.js";
import { BENCH_CONTRACT } from "./contract.js";
import {
  median,
  rateUpperBound,
  round,
  signTestInterval,
  trialsForZeroEvents,
  type MedianInterval,
} from "./stats.js";
import { caseId, listCases, type BenchSuite, type CaseRef } from "./suite.js";

/** What a comparison says about one case. */
export type Verdict = "regression" | "improvement" | "no-regression" | "inconclusive" | "skipped";

/**
 * Judge one case from its per-round ratios.
 *
 * - `regression`: the whole interval is above `1 + THRESHOLD`. The head is slower by more than the
 *   threshold, with each end of the interval wrong at most `ALPHA` of the time.
 * - `improvement`: the whole interval is below `1 / (1 + THRESHOLD)`.
 * - `no-regression`: the whole interval is at or below `1 + THRESHOLD`: a slowdown larger than
 *   the threshold is ruled out.
 * - `inconclusive`: the interval straddles `1 + THRESHOLD`, or there are too few rounds for one.
 *   Not a pass and not a failure: the rounds disagreed too much to tell.
 *
 * @example
 * ```ts
 * import { judge } from "@cosyte/bench";
 *
 * judge([1.1, 1.12, 1.09, 1.11, 1.1, 1.13, 1.1, 1.08, 1.12, 1.1, 1.11, 1.09]).verdict; // => "regression"
 * judge([1, 1.01, 0.99, 1, 1.02, 0.98, 1, 1.01, 0.99, 1, 1, 1.01]).verdict; // => "no-regression"
 * ```
 */
export function judge(
  ratios: readonly number[],
  threshold: number = BENCH_CONTRACT.THRESHOLD,
  alpha: number = BENCH_CONTRACT.ALPHA,
): { verdict: Exclude<Verdict, "skipped">; interval: MedianInterval | null; medianRatio: number } {
  const interval = signTestInterval(ratios, alpha);
  const medianRatio = median(ratios);
  if (interval === null) return { verdict: "inconclusive", interval, medianRatio };
  const up = 1 + threshold;
  let verdict: Exclude<Verdict, "skipped">;
  if (interval.low > up) verdict = "regression";
  else if (interval.high < 1 / up) verdict = "improvement";
  else if (interval.high <= up) verdict = "no-regression";
  else verdict = "inconclusive";
  return { verdict, interval, medianRatio };
}

/** One case of a comparison. */
export interface CaseComparison extends CaseRef {
  /** Each round's base process: the fastest of its samples, milliseconds per operation. */
  readonly baseMsPerOp: readonly number[];
  /** Each round's head process: the fastest of its samples, milliseconds per operation. */
  readonly headMsPerOp: readonly number[];
  /** Each round's base samples, whole, so another estimator can be judged on the same runs. */
  readonly baseSamples: readonly (readonly number[])[];
  /** Each round's head samples, whole. */
  readonly headSamples: readonly (readonly number[])[];
  /** Each round's `head / base`. */
  readonly ratios: readonly number[];
  readonly medianRatio: number | null;
  readonly interval: MedianInterval | null;
  readonly verdict: Verdict;
  /** Why the case was skipped, when it was. A skip is not a pass. */
  readonly skipReason: string | null;
}

/** A whole comparison. */
export interface ComparisonBody {
  readonly rounds: number;
  readonly threshold: number;
  readonly alpha: number;
  /** The slowdown injected on the head side, for calibration. Zero in a real comparison. */
  readonly inject: number;
  readonly cases: readonly CaseComparison[];
}

/**
 * How the comparison runs one job. The real one starts a fresh process.
 *
 * @internal
 */
export type JobRunner = (job: Job) => Promise<JobResult>;

/** What {@link compareBuilds} needs. */
export interface CompareOptions {
  /** The suite file, an absolute path. */
  readonly suiteFile: string;
  /** The suite, already loaded from `suiteFile`, to list its cases. */
  readonly suite: BenchSuite<unknown>;
  /** The base build's entry, an absolute path. */
  readonly base: string;
  /** The head build's entry, an absolute path. */
  readonly head: string;
  /** Keep to these benchmarks or cases. */
  readonly only?: readonly string[];
  /** A known slowdown on the head side, for calibration only. */
  readonly inject?: number;
  /** Progress lines, for a person watching. */
  readonly onProgress?: (line: string) => void;
  /** Runs one measuring job: `runInChild` for real. */
  readonly runJob: JobRunner;
}

/**
 * Compare a base build against a head build, interleaved, `ROUNDS` rounds.
 *
 * @internal
 */
export async function compareBuilds(options: CompareOptions): Promise<ComparisonBody> {
  const runJob = options.runJob;
  const inject = options.inject ?? 0;
  const cases = listCases(options.suite, options.only, true);
  const state = cases.map((c) => ({
    c,
    rounds: [] as { base: readonly number[]; head: readonly number[] }[],
    skip: null as string | null,
  }));
  for (let r = 0; r < BENCH_CONTRACT.ROUNDS; r++) {
    for (const s of state) {
      if (s.skip !== null) continue;
      const sides: ("base" | "head")[] = r % 2 === 0 ? ["base", "head"] : ["head", "base"];
      const got = new Map<"base" | "head", readonly number[]>();
      for (const side of sides) {
        const result = await runJob({
          mode: "timing",
          suite: options.suiteFile,
          target: side === "base" ? options.base : options.head,
          case: s.c,
          latency: false,
          inject: side === "head" ? inject : 0,
        });
        if (result.mode !== "timing")
          throw new Error("@cosyte/bench: a timing job returned another kind");
        if (result.status === "skipped") {
          s.skip = `${side}: ${result.reason}`;
          break;
        }
        got.set(side, result.samplesMsPerOp);
      }
      const base = got.get("base");
      const head = got.get("head");
      // Both sides or neither: a round that skipped half way is not a round.
      if (base !== undefined && head !== undefined) s.rounds.push({ base, head });
    }
    options.onProgress?.(`round ${String(r + 1)} of ${String(BENCH_CONTRACT.ROUNDS)} done`);
  }
  return {
    rounds: BENCH_CONTRACT.ROUNDS,
    threshold: BENCH_CONTRACT.THRESHOLD,
    alpha: BENCH_CONTRACT.ALPHA,
    inject,
    cases: state.map(({ c, rounds, skip }) => {
      const recorded = {
        baseMsPerOp: rounds.map((p) => Math.min(...p.base)),
        headMsPerOp: rounds.map((p) => Math.min(...p.head)),
        baseSamples: rounds.map((p) => p.base),
        headSamples: rounds.map((p) => p.head),
      };
      if (skip !== null) {
        return {
          ...c,
          ...recorded,
          ratios: [],
          medianRatio: null,
          interval: null,
          verdict: "skipped",
          skipReason: skip,
        };
      }
      const ratios = rounds.map((p) => round(Math.min(...p.head) / Math.min(...p.base), 6));
      const j = judge(ratios);
      return {
        ...c,
        ...recorded,
        ratios,
        medianRatio: round(j.medianRatio, 6),
        interval: j.interval,
        verdict: j.verdict,
        skipReason: null,
      };
    }),
  };
}

/**
 * The exit code a comparison earns: 1 when any case is a regression, else 2 when any case was
 * skipped (it could not be measured), else 0.
 *
 * @internal
 */
export function comparisonExitCode(body: ComparisonBody): number {
  if (body.cases.some((c) => c.verdict === "regression")) return 1;
  if (body.cases.some((c) => c.verdict === "skipped")) return 2;
  return 0;
}

/** A rate with its exact upper bound. */
export interface CountedRate {
  readonly events: number;
  readonly trials: number;
  readonly rate: number;
  /** The one-sided upper bound at `REQUIRED_CONFIDENCE` (Clopper-Pearson). */
  readonly upperBound: number;
}

function counted(events: number, trials: number): CountedRate {
  return {
    events,
    trials,
    rate: trials === 0 ? 0 : round(events / trials, 6),
    upperBound: round(rateUpperBound(events, trials, BENCH_CONTRACT.REQUIRED_CONFIDENCE), 6),
  };
}

/** A calibration: many comparisons of known outcome. */
export interface CalibrationBody {
  /** The slowdown injected on the head side. Zero is an A/A calibration: every regression is a false alarm. */
  readonly inject: number;
  readonly comparisons: number;
  /** Each comparison's cases, kept whole so a different rule can be judged against the same runs. */
  readonly runs: readonly (readonly CaseComparison[])[];
  /** Case verdicts of `regression`, out of all case verdicts. */
  readonly perCase: CountedRate;
  /** Comparisons with at least one `regression`, out of all comparisons: what a required check sees. */
  readonly perComparison: CountedRate;
  /** Case verdicts by kind. */
  readonly verdicts: Readonly<Record<Verdict, number>>;
  /** For an A/A calibration: whether the timing comparison may now be a required check, and why. */
  readonly requiredRule: {
    readonly applies: boolean;
    readonly met: boolean;
    readonly reason: string;
  };
}

/**
 * Summarize calibration runs. With `inject` zero, every `regression` is a false alarm, and the rule
 * for making the comparison a required check is judged: the upper bound on the per-comparison false
 * alarm rate must be under `REQUIRED_FALSE_ALARM_RATE` at `REQUIRED_CONFIDENCE`. With `inject` above
 * zero every `regression` is a detection, and the rule does not apply.
 *
 * @internal
 */
export function summarizeCalibration(
  inject: number,
  runs: readonly (readonly CaseComparison[])[],
): CalibrationBody {
  const verdicts: Record<Verdict, number> = {
    regression: 0,
    improvement: 0,
    "no-regression": 0,
    inconclusive: 0,
    skipped: 0,
  };
  let caseTrials = 0;
  let caseEvents = 0;
  let compEvents = 0;
  for (const run of runs) {
    let any = false;
    for (const c of run) {
      verdicts[c.verdict]++;
      caseTrials++;
      if (c.verdict === "regression") {
        caseEvents++;
        any = true;
      }
    }
    if (any) compEvents++;
  }
  const perComparison = counted(compEvents, runs.length);
  const line = BENCH_CONTRACT.REQUIRED_FALSE_ALARM_RATE;
  const needed = trialsForZeroEvents(line, BENCH_CONTRACT.REQUIRED_CONFIDENCE);
  const pct = (x: number) => `${String(round(x * 100, 2))}%`;
  // Stryker disable next-line EqualityOperator: an exact Clopper-Pearson bound of exactly 1% is not reached by any whole count of comparisons.
  const under = perComparison.upperBound < line;
  let requiredRule: CalibrationBody["requiredRule"];
  if (inject !== 0) {
    requiredRule = {
      applies: false,
      met: false,
      reason: "a calibration with an injected slowdown measures detection, not false alarms",
    };
  } else if (under) {
    requiredRule = {
      applies: true,
      met: true,
      reason: `${String(compEvents)} false alarm(s) in ${String(runs.length)} A/A comparisons: the rate is under ${pct(line)} with ${pct(BENCH_CONTRACT.REQUIRED_CONFIDENCE)} confidence (upper bound ${pct(perComparison.upperBound)})`,
    };
  } else {
    requiredRule = {
      applies: true,
      met: false,
      reason: `${String(compEvents)} false alarm(s) in ${String(runs.length)} A/A comparisons: the upper bound ${pct(perComparison.upperBound)} is not under ${pct(line)}; a clean record needs at least ${String(needed)} comparisons`,
    };
  }
  return {
    inject,
    comparisons: runs.length,
    runs,
    perCase: counted(caseEvents, caseTrials),
    perComparison,
    verdicts,
    requiredRule,
  };
}

/** What {@link calibrateComparison} needs: a comparison's options and how many to run. */
export interface CalibrateOptions extends CompareOptions {
  readonly comparisons: number;
}

/**
 * Run `comparisons` full comparisons and summarize them. Base and head should be the same build (two
 * copies, ideally in two directories, so a difference in where the code sits is part of what is
 * calibrated); `inject` makes the head side slower by a known fraction.
 *
 * @internal
 */
export async function calibrateComparison(options: CalibrateOptions): Promise<CalibrationBody> {
  const runs: CaseComparison[][] = [];
  for (let k = 0; k < options.comparisons; k++) {
    const { onProgress: _quiet, ...quiet } = options;
    const body = await compareBuilds(quiet);
    runs.push([...body.cases]);
    const alarms = body.cases.filter((c) => c.verdict === "regression").map(caseId);
    options.onProgress?.(
      `comparison ${String(k + 1)} of ${String(options.comparisons)}: ` +
        (alarms.length === 0 ? "no regression verdict" : `regression on ${alarms.join(", ")}`),
    );
  }
  return summarizeCalibration(options.inject ?? 0, runs);
}
