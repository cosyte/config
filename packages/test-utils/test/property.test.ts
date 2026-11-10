/**
 * How every runner here runs a property: the depth on a pull request and at night, and a failure
 * that prints the seed and path which replay it exactly. A depth that silently fell back to the
 * default, or a failure that could not be replayed, would make the nightly run a lottery, so the
 * refusals and the replay are pinned first.
 */

import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_NUM_RUNS,
  PROPERTY_ENV,
  assertProperty,
  idempotentNormalizeProperty,
  immutabilityProperty,
  lenientNeverThrowsProperty,
  propertyFailureMessage,
  resolvePropertyRun,
  roundTripProperty,
} from "../src/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePropertyRun", () => {
  it("runs about 100 cases by default, or the runner's own number", () => {
    expect(DEFAULT_NUM_RUNS).toBe(100);
    expect(resolvePropertyRun({}, {})).toStrictEqual({ numRuns: 100 });
    expect(resolvePropertyRun({ numRuns: 7 }, {})).toStrictEqual({ numRuns: 7 });
    expect(resolvePropertyRun({ numRuns: 7 }, { COSYTE_PROPERTY_RUNS: "" })).toEqual({
      numRuns: 7,
    });
  });

  it("lets one environment variable set the depth of every property, over the runner's own", () => {
    expect(PROPERTY_ENV).toEqual({
      runs: "COSYTE_PROPERTY_RUNS",
      seed: "COSYTE_PROPERTY_SEED",
      path: "COSYTE_PROPERTY_PATH",
    });
    expect(Object.isFrozen(PROPERTY_ENV)).toBe(true);
    expect(resolvePropertyRun({ numRuns: 50 }, { COSYTE_PROPERTY_RUNS: "10000" })).toEqual({
      numRuns: 10_000,
    });
    expect(resolvePropertyRun({}, { COSYTE_PROPERTY_RUNS: "1" })).toStrictEqual({ numRuns: 1 });
  });

  it("takes a seed and a path from the environment over the options, to replay a failure", () => {
    expect(
      resolvePropertyRun(
        { seed: 1, path: "9" },
        { COSYTE_PROPERTY_SEED: "-42", COSYTE_PROPERTY_PATH: "0:3:1" },
      ),
    ).toEqual({
      numRuns: 100,
      seed: -42,
      path: "0:3:1",
    });
    expect(resolvePropertyRun({ seed: 5, path: "2:0" }, {})).toEqual({
      numRuns: 100,
      seed: 5,
      path: "2:0",
    });
    expect(resolvePropertyRun({ seed: 5 }, {})).toStrictEqual({ numRuns: 100, seed: 5 });
    expect(
      resolvePropertyRun({}, { COSYTE_PROPERTY_SEED: "1", COSYTE_PROPERTY_PATH: "12:30" }),
    ).toStrictEqual({
      numRuns: 100,
      seed: 1,
      path: "12:30",
    });
    expect(resolvePropertyRun({}, { COSYTE_PROPERTY_SEED: "17" })).toEqual({
      numRuns: 100,
      seed: 17,
    });
    expect(resolvePropertyRun({ seed: 3 }, { COSYTE_PROPERTY_PATH: "4" })).toEqual({
      numRuns: 100,
      seed: 3,
      path: "4",
    });
  });

  it("refuses a value that is set but malformed, rather than running the default depth", () => {
    const cases: [Record<string, string>, string][] = [
      [
        { COSYTE_PROPERTY_RUNS: "0" },
        'COSYTE_PROPERTY_RUNS must be a whole number of cases, 1 or more, got "0"',
      ],
      [
        { COSYTE_PROPERTY_RUNS: "10k" },
        'COSYTE_PROPERTY_RUNS must be a whole number of cases, 1 or more, got "10k"',
      ],
      [
        { COSYTE_PROPERTY_RUNS: " 100" },
        'COSYTE_PROPERTY_RUNS must be a whole number of cases, 1 or more, got " 100"',
      ],
      [
        { COSYTE_PROPERTY_RUNS: "100 " },
        'COSYTE_PROPERTY_RUNS must be a whole number of cases, 1 or more, got "100 "',
      ],
      [
        { COSYTE_PROPERTY_RUNS: "-5" },
        'COSYTE_PROPERTY_RUNS must be a whole number of cases, 1 or more, got "-5"',
      ],
      [
        { COSYTE_PROPERTY_SEED: "1.5" },
        'COSYTE_PROPERTY_SEED must be a whole number, the seed a failure printed, got "1.5"',
      ],
      [
        { COSYTE_PROPERTY_SEED: "x1" },
        'COSYTE_PROPERTY_SEED must be a whole number, the seed a failure printed, got "x1"',
      ],
      [
        { COSYTE_PROPERTY_SEED: "1x" },
        'COSYTE_PROPERTY_SEED must be a whole number, the seed a failure printed, got "1x"',
      ],
      [
        { COSYTE_PROPERTY_SEED: "1", COSYTE_PROPERTY_PATH: "0:" },
        'COSYTE_PROPERTY_PATH must be a path like 0:3:1, as a failure printed it, got "0:"',
      ],
      [
        { COSYTE_PROPERTY_SEED: "1", COSYTE_PROPERTY_PATH: "a0" },
        'COSYTE_PROPERTY_PATH must be a path like 0:3:1, as a failure printed it, got "a0"',
      ],
      [
        { COSYTE_PROPERTY_SEED: "1", COSYTE_PROPERTY_PATH: "0a" },
        'COSYTE_PROPERTY_PATH must be a path like 0:3:1, as a failure printed it, got "0a"',
      ],
      [
        { COSYTE_PROPERTY_PATH: "0:1" },
        "a replay path needs its seed: set COSYTE_PROPERTY_SEED too",
      ],
    ];
    for (const [env, message] of cases) {
      expect(() => resolvePropertyRun({}, env), JSON.stringify(env)).toThrow(
        new RangeError(message),
      );
    }
    expect(() => resolvePropertyRun({ numRuns: 0 }, {})).toThrow(
      new RangeError("numRuns must be a whole number of cases, 1 or more, got 0"),
    );
    expect(() => resolvePropertyRun({ numRuns: 2.5 }, {})).toThrow(/got 2\.5$/);
    expect(() => resolvePropertyRun({ path: "1" }, {})).toThrow(/needs its seed/);
  });

  it("reads process.env when no environment is passed", () => {
    vi.stubEnv("COSYTE_PROPERTY_RUNS", "321");
    expect(resolvePropertyRun({})).toStrictEqual({ numRuns: 321 });
  });
});

describe("assertProperty", () => {
  it("runs the resolved number of cases and passes a property that holds", () => {
    let calls = 0;
    const property = fc.property(fc.integer(), () => {
      calls += 1;
      return true;
    });
    assertProperty("holds", property, {}, {});
    expect(calls).toBe(100);
    calls = 0;
    assertProperty("holds", property, { numRuns: 3 }, { COSYTE_PROPERTY_RUNS: "250" });
    expect(calls).toBe(250);
    calls = 0;
    vi.stubEnv("COSYTE_PROPERTY_RUNS", "12");
    assertProperty("holds", property, {});
    expect(calls).toBe(12);
  });

  it("throws a failure that names the property, the seed and the path, and replays exactly from them", () => {
    const property = fc.property(fc.integer({ min: 0, max: 1000 }), (n) => {
      if (n > 500) throw new Error(`too big: ${n}`);
    });
    let message = "";
    let cause: unknown;
    try {
      assertProperty("small numbers", property, { seed: 42 }, {});
    } catch (error) {
      message = (error as Error).message;
      cause = (error as Error).cause;
    }
    const replay =
      /^Replay exactly: COSYTE_PROPERTY_SEED=(-?\d+) COSYTE_PROPERTY_PATH=(\d+(?::\d+)*)$/m.exec(
        message,
      );
    expect(message).toMatch(
      /^small numbers: property failed after \d+ case\(s\), shrunk \d+ time\(s\)\.\n/,
    );
    expect(replay?.[1]).toBe("42");
    expect(message).toContain(`(or pass { seed: 42, path: "${replay?.[2]}" } to the runner)\n\n`);
    expect(message).toContain("Counterexample: [501]");
    expect(message).toContain("too big: 501");
    expect(cause).toEqual(new Error("too big: 501"));

    // The printed seed and path run the one failing case again, already shrunk.
    const seen: number[] = [];
    const watched = fc.property(fc.integer({ min: 0, max: 1000 }), (n) => {
      seen.push(n);
      if (n > 500) throw new Error(`too big: ${n}`);
    });
    expect(() =>
      assertProperty(
        "small numbers",
        watched,
        {},
        {
          COSYTE_PROPERTY_SEED: replay?.[1] ?? "",
          COSYTE_PROPERTY_PATH: replay?.[2] ?? "",
        },
      ),
    ).toThrow(/Counterexample: \[501\]/);
    expect(seen).toEqual([501]);
  });

  it("passes a property that a different seed would have failed, when the seed says so", () => {
    // The same seed gives the same cases: two runs from one seed see the same values.
    const values = (seed: number) => {
      const seen: number[] = [];
      assertProperty(
        "record",
        fc.property(fc.integer(), (n) => {
          seen.push(n);
        }),
        { seed, numRuns: 5 },
        {},
      );
      return seen;
    };
    expect(values(7)).toEqual(values(7));
    expect(values(7)).not.toEqual(values(8));
  });
});

describe("propertyFailureMessage", () => {
  it("lays out the property, the replay line and fast-check's own report", () => {
    const details = fc.check(
      fc.property(fc.constant(1), () => false),
      { seed: 9, numRuns: 1 },
    );
    expect(propertyFailureMessage("constant", details)).toBe(
      [
        "constant: property failed after 1 case(s), shrunk 0 time(s).",
        `Replay exactly: COSYTE_PROPERTY_SEED=9 COSYTE_PROPERTY_PATH=${details.counterexamplePath}`,
        `(or pass { seed: 9, path: "${details.counterexamplePath}" } to the runner)`,
        "",
        fc.defaultReportMessage(details),
      ].join("\n"),
    );
  });
});

describe("every runner reads the same run options", () => {
  it("round trip, idempotent normalize, lenient and immutability all run COSYTE_PROPERTY_RUNS cases", () => {
    vi.stubEnv("COSYTE_PROPERTY_RUNS", "9");
    const counter = () => {
      let n = 0;
      return { tick: () => (n += 1), get: () => n };
    };
    const a = counter();
    roundTripProperty({
      arbitrary: fc.string(),
      serialize: (s) => (a.tick(), s),
      parse: (s) => s,
      numRuns: 2,
    });
    expect(a.get()).toBe(18);
    const b = counter();
    idempotentNormalizeProperty({
      arbitrary: fc.string(),
      normalize: (s) => (b.tick(), s),
      numRuns: 2,
    });
    expect(b.get()).toBe(18);
    const c = counter();
    lenientNeverThrowsProperty({
      arbitrary: fc.string(),
      parse: () => (c.tick(), {}),
      isFatal: () => false,
      getWarnings: () => [],
      isKnownCode: () => true,
      numRuns: 2,
    });
    expect(c.get()).toBe(9);
    const d = counter();
    immutabilityProperty({
      arbitrary: fc.string(),
      parse: (s) => (d.tick(), s),
      mutate: () => undefined,
      getSnapshot: (s) => s,
      numRuns: 2,
    });
    expect(d.get()).toBe(9);
  });

  it("and each failure names its property and carries the replay line", () => {
    const cases: [string, () => void][] = [
      [
        "round trip",
        () =>
          roundTripProperty({
            arbitrary: fc.constant<string>("a"),
            serialize: () => "b",
            parse: (s) => s,
          }),
      ],
      [
        "idempotent normalize",
        () =>
          idempotentNormalizeProperty({
            arbitrary: fc.constant<string>("a"),
            normalize: (s) => `${s}x`,
          }),
      ],
      [
        "never throws in lenient mode",
        () =>
          lenientNeverThrowsProperty({
            arbitrary: fc.constant<string>("a"),
            parse: () => {
              throw new Error("x");
            },
            isFatal: () => false,
            getWarnings: () => [],
            isKnownCode: () => true,
          }),
      ],
      [
        "immutability",
        () => {
          let n = 0;
          immutabilityProperty({
            arbitrary: fc.constant<string>("a"),
            parse: (s) => s,
            mutate: () => (n += 1),
            getSnapshot: () => n,
          });
        },
      ],
    ];
    for (const [name, fail] of cases) {
      expect(fail, name).toThrow(
        new RegExp(
          `^${name}: property failed after 1 case\\(s\\)[^]*\\nReplay exactly: COSYTE_PROPERTY_SEED=-?\\d+ COSYTE_PROPERTY_PATH=0\\n`,
        ),
      );
    }
  });
});
