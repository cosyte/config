import { describe, expect, it } from "vitest";

import {
  caseId,
  checkSuite,
  defineBenchmark,
  defineSuite,
  findCase,
  listCases,
} from "../src/suite.js";

const size = (label: string, extra: Record<string, unknown> = {}) => ({
  label,
  build: () => ({ inputs: [1] }),
  ...extra,
});
const bench = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  sizes: [size("small"), size("large")],
  bind: () => (x: unknown) => x,
  ...extra,
});

describe("defineSuite and checkSuite", () => {
  it("accepts a well-formed suite and freezes it", () => {
    const suite = defineSuite({
      name: "s",
      benchmarks: [defineBenchmark(bench("a", { longRun: "large", weigh: () => 1 }))],
    });
    expect(Object.isFrozen(suite)).toBe(true);
    expect(suite.benchmarks[0]?.name).toBe("a");
  });

  const refusals: [string, unknown, RegExp][] = [
    ["not an object", 42, /must be an object made by defineSuite/],
    ["null", null, /must be an object made by defineSuite/],
    [
      "an empty name",
      { name: " ", benchmarks: [bench("a")] },
      /the suite name must be a non-empty string/,
    ],
    [
      "a name that is not a string",
      { name: 7, benchmarks: [bench("a")] },
      /the suite name must be/,
    ],
    ["no benchmarks", { name: "s", benchmarks: [] }, /suite "s" must have at least one benchmark/],
    [
      "benchmarks that are not a list",
      { name: "s", benchmarks: {} },
      /must have at least one benchmark/,
    ],
    [
      "a benchmark that is not an object",
      { name: "s", benchmarks: [3] },
      /holds a benchmark that is not an object/,
    ],
    [
      "a benchmark with no name",
      { name: "s", benchmarks: [bench("")] },
      /a benchmark name in suite "s"/,
    ],
    [
      "two benchmarks with one name",
      { name: "s", benchmarks: [bench("a"), bench("a")] },
      /two benchmarks named "a"/,
    ],
    ["no bind", { name: "s", benchmarks: [bench("a", { bind: 1 })] }, /"a" has no bind function/],
    [
      "a weigh that is not a function",
      { name: "s", benchmarks: [bench("a", { weigh: 1 })] },
      /"a" has a weigh that is not a function/,
    ],
    ["no sizes", { name: "s", benchmarks: [bench("a", { sizes: [] })] }, /"a" has no sizes/],
    [
      "sizes that are not a list",
      { name: "s", benchmarks: [bench("a", { sizes: "x" })] },
      /"a" has no sizes/,
    ],
    [
      "a size that is not an object",
      { name: "s", benchmarks: [bench("a", { sizes: [null] })] },
      /holds a size that is not an object/,
    ],
    [
      "a size with no label",
      { name: "s", benchmarks: [bench("a", { sizes: [size("")] })] },
      /a size label in benchmark "a"/,
    ],
    [
      "two sizes with one label",
      { name: "s", benchmarks: [bench("a", { sizes: [size("x"), size("x")] })] },
      /two sizes labelled "x"/,
    ],
    [
      "a size with no build",
      { name: "s", benchmarks: [bench("a", { sizes: [{ label: "x" }] })] },
      /size "x" of "a" has no build function/,
    ],
    [
      "a compare that is not a boolean",
      { name: "s", benchmarks: [bench("a", { sizes: [size("x", { compare: "no" })] })] },
      /has a compare that is not true or false/,
    ],
    [
      "a longRun naming no size",
      { name: "s", benchmarks: [bench("a", { longRun: "huge" })] },
      /names a longRun size it does not have/,
    ],
    [
      "a longRun that is not a string",
      { name: "s", benchmarks: [bench("a", { longRun: 1 })] },
      /names a longRun size it does not have/,
    ],
  ];
  it.each(refusals)("refuses %s", (_what, value, message) => {
    expect(() => checkSuite(value)).toThrow(TypeError);
    expect(() => checkSuite(value)).toThrow(message);
    expect(() => checkSuite(value)).toThrow(/^@cosyte\/bench: /);
  });

  it("accepts compare true and false", () => {
    expect(() =>
      checkSuite({
        name: "s",
        benchmarks: [
          bench("a", { sizes: [size("x", { compare: false }), size("y", { compare: true })] }),
        ],
      }),
    ).not.toThrow();
  });
});

describe("cases", () => {
  const suite = checkSuite({
    name: "s",
    benchmarks: [
      bench("a"),
      bench("b", { sizes: [size("small"), size("huge", { compare: false })] }),
    ],
  });

  it("lists every case in suite order", () => {
    expect(listCases(suite).map(caseId)).toEqual([
      "a @ small",
      "a @ large",
      "b @ small",
      "b @ huge",
    ]);
  });

  it("leaves out sizes marked compare: false, for a comparison only", () => {
    expect(listCases(suite, [], true).map(caseId)).toEqual(["a @ small", "a @ large", "b @ small"]);
  });

  it("keeps to whole benchmarks or single cases named by only", () => {
    expect(listCases(suite, ["b"]).map(caseId)).toEqual(["b @ small", "b @ huge"]);
    expect(listCases(suite, ["a @ large", "b @ small"]).map(caseId)).toEqual([
      "a @ large",
      "b @ small",
    ]);
  });

  it("refuses an only that names nothing, so a typo cannot measure less", () => {
    expect(() => listCases(suite, ["a @ medium"])).toThrow(
      /--only "a @ medium" names no benchmark or case in suite "s"/,
    );
  });

  it("finds a case, and refuses a missing one", () => {
    expect(findCase(suite, { benchmark: "a", size: "large" }).size.label).toBe("large");
    expect(() => findCase(suite, { benchmark: "a", size: "medium" })).toThrow(
      /suite "s" has no case "a @ medium"/,
    );
    expect(() => findCase(suite, { benchmark: "z", size: "small" })).toThrow(
      /has no case "z @ small"/,
    );
  });
});
