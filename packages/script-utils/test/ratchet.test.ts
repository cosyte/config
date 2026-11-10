/**
 * The coverage and mutation ratchet. Its whole job is to say no: a score below its floor, a changed
 * line that never ran, a surviving mutant in changed code, an exception with no reason. A ratchet
 * that says yes by mistake is worse than none, because the floor file then claims a standard nobody
 * holds. So every refusal is pinned here first, then the passes, with the exact lines it prints.
 *
 * Fixtures are throwaway directories and git repositories in a temp directory; every report and
 * source file is synthetic.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COVERAGE_METRICS,
  FLOOR_FILE,
  REPORTS,
  RatchetUnreadable,
  compareFloors,
  findExceptionComments,
  hintRange,
  judgeChangedCode,
  mutationScore,
  parseArgs,
  parseFloor,
  parseLcov,
  readCoverageSummary,
  readMutants,
  runRatchet,
  toFloor,
} from "../ratchet.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "script-utils-ratchet-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

type Mutant = {
  status: string;
  line: number;
  endLine?: number;
  mutatorName?: string;
  statusReason?: string;
};

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

let fixtures = 0;
function dir(files: Record<string, string> = {}): string {
  fixtures += 1;
  const d = join(root, `f${fixtures}`);
  mkdirSync(d, { recursive: true });
  write(d, files);
  return d;
}

function summary(lines: number, branches = lines, functions = lines, statements = lines): string {
  const m = (pct: number) => ({ total: 10, covered: 9, skipped: 0, pct });
  return JSON.stringify({
    total: {
      lines: m(lines),
      branches: m(branches),
      functions: m(functions),
      statements: m(statements),
    },
  });
}

function report(files: Record<string, Mutant[]>, projectRoot?: string): string {
  return JSON.stringify({
    schemaVersion: "2",
    ...(projectRoot === undefined ? {} : { projectRoot }),
    files: Object.fromEntries(
      Object.entries(files).map(([file, mutants]) => [
        file,
        {
          language: "typescript",
          source: "",
          mutants: mutants.map((m, i) => ({
            id: String(i),
            mutatorName: m.mutatorName ?? "ConditionalExpression",
            status: m.status,
            ...(m.statusReason === undefined ? {} : { statusReason: m.statusReason }),
            location: {
              start: { line: m.line, column: 1 },
              end: { line: m.endLine ?? m.line, column: 2 },
            },
          })),
        },
      ]),
    ),
  });
}

function run(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = runRatchet({
    argv,
    cwd,
    out: (t) => (out += t),
    err: (t) => (err += t),
  });
  return { code, out, err };
}

function floor(packages: Record<string, unknown>): string {
  return `${JSON.stringify({ packages }, null, 2)}\n`;
}

describe("parseFloor", () => {
  it("accepts a floor with coverage and mutation, a partial one, and a comment", () => {
    const value = {
      $comment: "why",
      packages: {
        ".": {
          coverage: { lines: 90, branches: 80.5, functions: 100, statements: 0 },
          mutation: 70,
        },
        "packages/a": {},
        "packages/b": { coverage: { lines: 1 } },
      },
    };
    expect(parseFloor(value)).toBe(value);
  });

  it("refuses every shape it does not know, saying which", () => {
    const cases: [unknown, string][] = [
      [null, "the floor file has no `packages` object"],
      [[], "the floor file has no `packages` object"],
      [{}, "the floor file has no `packages` object"],
      [{ packages: [] }, "the floor file has no `packages` object"],
      [{ packages: null }, "the floor file has no `packages` object"],
      [{ packages: {}, extra: 1 }, 'the floor file has an unknown key "extra"'],
      [{ packages: { a: 1 } }, 'the floor file entry "a" is not an object'],
      [{ packages: { a: null } }, 'the floor file entry "a" is not an object'],
      [{ packages: { a: [] } }, 'the floor file entry "a" is not an object'],
      [
        { packages: { a: { mutaton: 1 } } },
        'the floor file entry "a" has an unknown key "mutaton"',
      ],
      [
        { packages: { a: { mutation: "70" } } },
        'the floor file entry "a" has a mutation floor that is not a score from 0 to 100',
      ],
      [
        { packages: { a: { mutation: -0.01 } } },
        'the floor file entry "a" has a mutation floor that is not a score from 0 to 100',
      ],
      [
        { packages: { a: { mutation: 100.01 } } },
        'the floor file entry "a" has a mutation floor that is not a score from 0 to 100',
      ],
      [{ packages: { a: { coverage: 90 } } }, 'the floor file entry "a" coverage is not an object'],
      [
        { packages: { a: { coverage: null } } },
        'the floor file entry "a" coverage is not an object',
      ],
      [
        { packages: { a: { coverage: { line: 90 } } } },
        'the floor file entry "a" has a bad coverage floor "line"',
      ],
      [
        { packages: { a: { coverage: { lines: 101 } } } },
        'the floor file entry "a" has a bad coverage floor "lines"',
      ],
      [
        { packages: { a: { coverage: { lines: Number.NaN } } } },
        'the floor file entry "a" has a bad coverage floor "lines"',
      ],
    ];
    for (const [value, message] of cases) {
      expect(() => parseFloor(value), message).toThrow(new RatchetUnreadable(message));
    }
  });

  it("accepts the edges of a score", () => {
    expect(() =>
      parseFloor({ packages: { a: { mutation: 0, coverage: { lines: 100 } } } }),
    ).not.toThrow();
    expect(() =>
      parseFloor({ packages: { a: { mutation: 100, coverage: { lines: 0 } } } }),
    ).not.toThrow();
  });
});

describe("compareFloors", () => {
  it("lists each floor lowered or removed, and nothing raised, kept or new", () => {
    const before = {
      packages: {
        b: { coverage: { lines: 50, functions: 20 }, mutation: 40 },
        a: { coverage: { branches: 10, statements: 10 } },
        gone: { mutation: 5 },
        empty: {},
        c: { coverage: { lines: 1 } },
      },
    };
    const after = {
      packages: {
        a: { coverage: { branches: 10, statements: 9.99, lines: 1 } },
        b: { coverage: { lines: 50.01 }, mutation: 39 },
        fresh: { mutation: 1 },
        c: { mutation: 2 },
      },
    };
    expect(compareFloors(before, after)).toEqual([
      { dir: "a", metric: "statements", before: 10, after: 9.99 },
      { dir: "b", metric: "functions", before: 20, after: null },
      { dir: "b", metric: "mutation", before: 40, after: 39 },
      { dir: "c", metric: "lines", before: 1, after: null },
      { dir: "gone", metric: "mutation", before: 5, after: null },
    ]);
    expect(compareFloors(after, after)).toEqual([]);
    expect(compareFloors({ packages: {} }, after)).toEqual([]);
  });
});

describe("toFloor", () => {
  it("cuts to two decimals toward zero, without float noise pushing it down", () => {
    expect(toFloor(98.056)).toBe(98.05);
    expect(toFloor(98.05)).toBe(98.05);
    expect(toFloor(0.29)).toBe(0.29);
    expect(toFloor(100)).toBe(100);
    expect(toFloor((2 / 3) * 100)).toBe(66.66);
    expect(toFloor(57.99999999)).toBe(58);
  });
});

describe("readCoverageSummary", () => {
  it("reads the four total percentages", () => {
    const d = dir({ "s.json": summary(98.5, 80, 100, 97.25) });
    expect(readCoverageSummary(join(d, "s.json"))).toEqual({
      lines: 98.5,
      branches: 80,
      functions: 100,
      statements: 97.25,
    });
  });

  it("refuses a missing, malformed or incomplete summary", () => {
    const d = dir({
      "bad.json": "{",
      "partial.json": JSON.stringify({
        total: { lines: { pct: 1 }, branches: { pct: 1 }, functions: { pct: 1 } },
      }),
      "word.json": JSON.stringify({ total: { lines: { pct: "Unknown" } } }),
      "null.json": "null",
      "empty.json": "{}",
      "bare.json": JSON.stringify({ total: {} }),
    });
    for (const file of ["empty.json", "bare.json"]) {
      expect(() => readCoverageSummary(join(d, file)), file).toThrow(
        new RatchetUnreadable(
          `the coverage summary ${join(d, file)} has no total lines percentage`,
        ),
      );
    }
    expect(() => readCoverageSummary(join(d, "none.json"))).toThrow(
      new RatchetUnreadable(`the coverage summary ${join(d, "none.json")} could not be read`),
    );
    expect(() => readCoverageSummary(join(d, "bad.json"))).toThrow(
      new RatchetUnreadable(`the coverage summary ${join(d, "bad.json")} is not JSON`),
    );
    expect(() => readCoverageSummary(join(d, "partial.json"))).toThrow(
      new RatchetUnreadable(
        `the coverage summary ${join(d, "partial.json")} has no total statements percentage`,
      ),
    );
    expect(() => readCoverageSummary(join(d, "word.json"))).toThrow(
      /has no total lines percentage$/,
    );
    expect(() => readCoverageSummary(join(d, "null.json"))).toThrow(
      /has no total lines percentage$/,
    );
  });
});

describe("mutationScore", () => {
  it("scores killed and timed-out mutants over every mutant that ran or had no test", () => {
    const parsed = JSON.parse(
      report({
        "a.ts": [
          { status: "Killed", line: 1 },
          { status: "Killed", line: 1 },
          { status: "Timeout", line: 1 },
          { status: "Survived", line: 1 },
          { status: "NoCoverage", line: 1 },
          { status: "Ignored", line: 1 },
          { status: "CompileError", line: 1 },
          { status: "RuntimeError", line: 1 },
        ],
        "b.ts": [{ status: "Survived", line: 1 }],
      }),
    );
    parsed.files["c.ts"] = { language: "typescript", source: "" };
    expect(mutationScore(parsed, "r.json")).toEqual({
      score: 50,
      counts: {
        Killed: 2,
        Timeout: 1,
        Survived: 2,
        NoCoverage: 1,
        Ignored: 1,
        CompileError: 1,
        RuntimeError: 1,
      },
    });
    expect(
      mutationScore(JSON.parse(report({ "a.ts": [{ status: "Timeout", line: 1 }] })), "r").score,
    ).toBe(100);
    expect(
      mutationScore(JSON.parse(report({ "a.ts": [{ status: "NoCoverage", line: 1 }] })), "r").score,
    ).toBe(0);
    const third = report({
      "a.ts": [
        { status: "Killed", line: 1 },
        { status: "Survived", line: 1 },
        { status: "Survived", line: 1 },
      ],
    });
    expect(mutationScore(JSON.parse(third), "r").score).toBe(33.33);
  });

  it("refuses a report with no files or no mutant to score", () => {
    expect(() => mutationScore({}, "r.json")).toThrow(
      new RatchetUnreadable("the mutation report r.json has no files"),
    );
    expect(() => mutationScore({ files: null }, "r.json")).toThrow(/has no files$/);
    expect(() => mutationScore(null, "r.json")).toThrow(/has no files$/);
    expect(() =>
      mutationScore(JSON.parse(report({ "a.ts": [{ status: "Ignored", line: 1 }] })), "r.json"),
    ).toThrow(new RatchetUnreadable("the mutation report r.json has no mutant to score"));
  });
});

describe("parseLcov", () => {
  it("reads each file's line hits, keeping the higher count when a file repeats", () => {
    const text = [
      "DA:1,5",
      "TN:",
      "SF:src/a.ts",
      "FN:1,f",
      "DA:1,0",
      "DA:2,3",
      "end_of_record",
      "SF:/abs/b.ts",
      "DA:4,0",
      "end_of_record",
      "SF:src/a.ts",
      "DA:1,2",
      "DA:2,1",
      "end_of_record",
    ].join("\r\n");
    const files = parseLcov(text, "/pkg");
    expect([...files.keys()]).toEqual(["/pkg/src/a.ts", "/abs/b.ts"]);
    expect([...(files.get("/pkg/src/a.ts") ?? [])]).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect([...(files.get("/abs/b.ts") ?? [])]).toEqual([[4, 0]]);
  });
});

describe("findExceptionComments", () => {
  it("finds coverage hints and Stryker directives, with the reason each names", () => {
    const text = [
      "/* v8 ignore next -- the caller never passes zero */",
      "  // v8 ignore next",
      "/* c8 ignore start -- a platform branch */",
      "/* c8 ignore stop */",
      "/*istanbul ignore else--   spaced   */",
      "/* v8  ignore   next -- spaced out */",
      "/* v8 ignore next because -- not a reason */",
      "/* v8 ignore file -- generated */",
      "/* v8 ignore next -- */",
      "// v8 ignore nextline -- not a hint",
      "// Stryker disable next-line all: equivalent, both sides are equal",
      "// Stryker disable StringLiteral,ConditionalExpression",
      "//Stryker disable all:   ",
      "// Stryker restore all",
      "x(); // v8 ignore if -- trailing",
      "// Stryker disable next-line all : the spaced form",
      "// Stryker disable 4ll: not a mutator list",
      "// Stryker disable all4: digits are not in a mutator name",
      "// Stryker disable : no mutators",
    ].join("\n");
    expect(findExceptionComments(text)).toEqual([
      {
        line: 1,
        tool: "coverage",
        directive: "ignore next",
        reason: "the caller never passes zero",
      },
      { line: 2, tool: "coverage", directive: "ignore next", reason: null },
      { line: 3, tool: "coverage", directive: "ignore start", reason: "a platform branch" },
      { line: 5, tool: "coverage", directive: "ignore else", reason: "spaced" },
      { line: 6, tool: "coverage", directive: "ignore next", reason: "spaced out" },
      { line: 7, tool: "coverage", directive: "ignore next", reason: null },
      { line: 8, tool: "coverage", directive: "ignore file", reason: "generated" },
      { line: 9, tool: "coverage", directive: "ignore next", reason: null },
      {
        line: 11,
        tool: "mutation",
        directive: "disable all",
        reason: "equivalent, both sides are equal",
      },
      {
        line: 12,
        tool: "mutation",
        directive: "disable StringLiteral,ConditionalExpression",
        reason: null,
      },
      { line: 13, tool: "mutation", directive: "disable all", reason: null },
      { line: 15, tool: "coverage", directive: "ignore if", reason: "trailing" },
      { line: 16, tool: "mutation", directive: "disable all", reason: "the spaced form" },
    ]);
  });

  it("finds nothing in ordinary code", () => {
    expect(findExceptionComments("const ignore = 'v8 ignore next';\n// a v8 note\n")).toEqual([]);
  });
});

describe("hintRange", () => {
  const lines = [
    "a",
    "/* v8 ignore start */",
    "b",
    "/* v8 ignore stop */",
    "c",
    "/* v8 ignore stop */",
    "d",
  ];

  it("reaches the whole file for `file`, and up to the next stop for `start`", () => {
    expect(hintRange({ line: 3, directive: "ignore file" }, lines, undefined)).toEqual([1, 7]);
    expect(hintRange({ line: 2, directive: "ignore start" }, lines, undefined)).toEqual([2, 4]);
    expect(hintRange({ line: 4, directive: "ignore start" }, lines, undefined)).toEqual([4, 6]);
    expect(hintRange({ line: 6, directive: "ignore start" }, lines, undefined)).toEqual([6, 7]);
    // A stop on the very next line ends it there, and a spaced-out stop is a stop.
    expect(hintRange({ line: 3, directive: "ignore start" }, lines, undefined)).toEqual([3, 4]);
    const spaced = ["/* v8 ignore start */", "x", "/* c8  ignore  stop */", "y"];
    expect(hintRange({ line: 1, directive: "ignore start" }, spaced, undefined)).toEqual([1, 3]);
  });

  it("reaches up to the next counted line for `next`, `if` and `else`, or the end", () => {
    const counted = new Map([
      [1, 1],
      [5, 0],
      [7, 1],
    ]);
    expect(hintRange({ line: 2, directive: "ignore next" }, lines, counted)).toEqual([2, 4]);
    expect(hintRange({ line: 5, directive: "ignore if" }, lines, counted)).toEqual([5, 6]);
    expect(hintRange({ line: 7, directive: "ignore else" }, lines, counted)).toEqual([7, 7]);
    expect(hintRange({ line: 2, directive: "ignore next" }, lines, undefined)).toEqual([2, 7]);
  });
});

describe("judgeChangedCode", () => {
  const source = [
    "export function f(x) {", // 1
    "  if (x) return 1;", // 2
    "  /* v8 ignore next -- the caller checks first */", // 3
    "  if (x === 0) return 0;", // 4
    "  // Stryker disable next-line all: equal either way", // 5
    "  return x + 0;", // 6
    "  /* v8 ignore next */", // 7
    "  return 2;", // 8
    "}", // 9
  ].join("\n");
  const read = () => source;
  const lines = new Map([
    [
      "/r/a.ts",
      new Map([
        [1, 1],
        [2, 1],
        [6, 0],
        [9, 1],
      ]),
    ],
  ]);

  it("finds changed lines that never ran, and nothing on lines it does not count", () => {
    const verdict = judgeChangedCode({
      changed: new Map([
        ["/r/a.ts", new Set([9, 6, 1, 8])],
        ["/r/README.md", new Set([1])],
      ]),
      lines,
      mutants: null,
      read,
    });
    expect(verdict).toEqual({
      uncovered: [{ file: "/r/a.ts", line: 6 }],
      survived: [],
      exceptions: [
        { file: "/r/a.ts", line: 7, tool: "coverage", what: "ignore next", reason: null },
      ],
      unmutated: [],
    });
  });

  it("lists the exceptions whose reach a change touches, and only those", () => {
    const verdict = judgeChangedCode({
      changed: new Map([["/r/a.ts", new Set([4, 5])]]),
      lines,
      mutants: null,
      read,
    });
    expect(verdict.exceptions).toEqual([
      {
        file: "/r/a.ts",
        line: 3,
        tool: "coverage",
        what: "ignore next",
        reason: "the caller checks first",
      },
      {
        file: "/r/a.ts",
        line: 5,
        tool: "mutation",
        what: "disable all",
        reason: "equal either way",
      },
    ]);
    const none = judgeChangedCode({
      changed: new Map([["/r/a.ts", new Set([2])]]),
      lines,
      mutants: null,
      read,
    });
    expect(none.exceptions).toEqual([]);
  });

  it("finds surviving mutants in changed code, lists ignored ones, and passes killed ones", () => {
    const mutants = new Map([
      [
        "/r/a.ts",
        [
          {
            status: "Survived",
            mutatorName: "BooleanLiteral",
            location: { start: { line: 2 }, end: { line: 2 } },
          },
          {
            status: "NoCoverage",
            mutatorName: "BlockStatement",
            location: { start: { line: 1 }, end: { line: 9 } },
          },
          {
            status: "Killed",
            mutatorName: "ConditionalExpression",
            location: { start: { line: 2 }, end: { line: 2 } },
          },
          {
            status: "Timeout",
            mutatorName: "ConditionalExpression",
            location: { start: { line: 2 }, end: { line: 2 } },
          },
          {
            status: "Survived",
            mutatorName: "StringLiteral",
            location: { start: { line: 8 }, end: { line: 8 } },
          },
          {
            status: "Ignored",
            mutatorName: "ArithmeticOperator",
            statusReason: " equal either way ",
            location: { start: { line: 6 }, end: { line: 6 } },
          },
          {
            status: "Ignored",
            mutatorName: "ArithmeticOperator",
            statusReason: "Ignored using a comment",
            location: { start: { line: 2 }, end: { line: 2 } },
          },
          {
            status: "Ignored",
            mutatorName: "EqualityOperator",
            location: { start: { line: 2 }, end: { line: 2 } },
          },
        ],
      ],
    ]);
    const verdict = judgeChangedCode({
      changed: new Map([["/r/a.ts", new Set([2, 6])]]),
      lines,
      mutants,
      read,
    });
    expect(verdict.survived).toEqual([
      { file: "/r/a.ts", line: 2, mutator: "BooleanLiteral", status: "Survived" },
      { file: "/r/a.ts", line: 1, mutator: "BlockStatement", status: "NoCoverage" },
    ]);
    expect(verdict.uncovered).toEqual([{ file: "/r/a.ts", line: 6 }]);
    expect(verdict.exceptions).toEqual([
      {
        file: "/r/a.ts",
        line: 6,
        tool: "mutation",
        what: "ArithmeticOperator mutant ignored",
        reason: "equal either way",
      },
      {
        file: "/r/a.ts",
        line: 2,
        tool: "mutation",
        what: "ArithmeticOperator mutant ignored",
        reason: null,
      },
      {
        file: "/r/a.ts",
        line: 2,
        tool: "mutation",
        what: "EqualityOperator mutant ignored",
        reason: null,
      },
    ]);
  });

  it("names a changed file coverage counts that no run mutated, but not one whose changes it does not count", () => {
    const changed = new Map([
      ["/r/a.ts", new Set([2])],
      ["/r/b.ts", new Set([3])],
    ]);
    const both = new Map([
      ["/r/a.ts", new Map([[2, 1]])],
      ["/r/b.ts", new Map([[1, 1]])],
    ]);
    const verdict = judgeChangedCode({ changed, lines: both, mutants: new Map(), read: () => "" });
    expect(verdict.unmutated).toEqual(["/r/a.ts"]);
    const some = judgeChangedCode({
      changed: new Map([["/r/a.ts", new Set([2, 3])]]),
      lines: new Map([["/r/a.ts", new Map([[2, 1]])]]),
      mutants: new Map(),
      read: () => "",
    });
    expect(some.unmutated).toEqual(["/r/a.ts"]);
  });

  it("reports files in path order and lines in number order, whatever order they came in", () => {
    const zero = (...ns: number[]) => new Map(ns.map((n) => [n, 0]));
    const verdict = judgeChangedCode({
      changed: new Map([
        ["/r/b.ts", new Set([10, 3, 7, 1])],
        ["/r/a.ts", new Set([2])],
      ]),
      lines: new Map([
        ["/r/b.ts", zero(1, 3, 7, 10)],
        ["/r/a.ts", zero(2)],
      ]),
      mutants: null,
      read: () => "",
    });
    expect(verdict.uncovered.map((u) => `${u.file}:${u.line}`)).toEqual([
      "/r/a.ts:2",
      "/r/b.ts:1",
      "/r/b.ts:3",
      "/r/b.ts:7",
      "/r/b.ts:10",
    ]);
  });

  it("reaches only its own line with a Stryker directive, however far the next counted line is", () => {
    const verdict = judgeChangedCode({
      changed: new Map([["/r/a.ts", new Set([3])]]),
      lines: new Map([["/r/a.ts", new Map([[9, 1]])]]),
      mutants: null,
      read: () => "x\n// Stryker disable next-line all: equal\ny\n",
    });
    expect(verdict.exceptions).toEqual([]);
  });

  it("judges the mutants of a file coverage does not count when coverage is skipped", () => {
    const verdict = judgeChangedCode({
      changed: new Map([
        ["/r/z.ts", new Set([1])],
        ["/r/m.ts", new Set([1, 2])],
      ]),
      lines: new Map(),
      mutants: new Map([
        [
          "/r/m.ts",
          [
            {
              status: "Survived",
              mutatorName: "X",
              location: { start: { line: 1 }, end: { line: 1 } },
            },
          ],
        ],
      ]),
      read: () => "// Stryker disable all\n/* v8 ignore start */\n",
    });
    expect(verdict).toEqual({
      uncovered: [],
      survived: [{ file: "/r/m.ts", line: 1, mutator: "X", status: "Survived" }],
      exceptions: [
        { file: "/r/m.ts", line: 1, tool: "mutation", what: "disable all", reason: null },
        { file: "/r/m.ts", line: 2, tool: "coverage", what: "ignore start", reason: null },
      ],
      unmutated: [],
    });
  });
});

describe("readMutants", () => {
  it("reads paths against the report's project root, or the package directory", () => {
    const d = dir({
      "with.json": report({ "src/a.ts": [{ status: "Killed", line: 1 }] }, "/project"),
      "without.json": report({ "src/a.ts": [{ status: "Killed", line: 1 }] }),
      "bare.json": JSON.stringify({ files: { "x.ts": {} } }),
    });
    expect([...readMutants(join(d, "with.json"), "/pkg").keys()]).toEqual(["/project/src/a.ts"]);
    const without = readMutants(join(d, "without.json"), "/pkg");
    expect([...without.keys()]).toEqual(["/pkg/src/a.ts"]);
    expect(without.get("/pkg/src/a.ts")).toHaveLength(1);
    expect(readMutants(join(d, "bare.json"), "/pkg").get("/pkg/x.ts")).toEqual([]);
  });

  it("refuses a report with no files", () => {
    const d = dir({ "r.json": "{}", "n.json": "null", "fn.json": '{"files":null}' });
    expect(() => readMutants(join(d, "fn.json"), "/pkg")).toThrow(/has no files$/);
    expect(new RatchetUnreadable("x").name).toBe("RatchetUnreadable");
    expect(() => readMutants(join(d, "r.json"), "/pkg")).toThrow(
      new RatchetUnreadable(`the changed-files mutation report ${join(d, "r.json")} has no files`),
    );
    expect(() => readMutants(join(d, "n.json"), "/pkg")).toThrow(/has no files$/);
    expect(() => readMutants(join(d, "gone.json"), "/pkg")).toThrow(
      new RatchetUnreadable(
        `the changed-files mutation report ${join(d, "gone.json")} could not be read`,
      ),
    );
  });
});

describe("parseArgs", () => {
  it("reads the command and its options", () => {
    expect(parseArgs(["check"])).toEqual({
      command: "check",
      floor: FLOOR_FILE,
      base: null,
      skip: new Set(),
    });
    expect(
      parseArgs([
        "check",
        "--floor",
        "f.json",
        "--base",
        "origin/main",
        "--skip",
        "mutation",
        "--skip",
        "coverage",
      ]),
    ).toEqual({
      command: "check",
      floor: "f.json",
      base: "origin/main",
      skip: new Set(["mutation", "coverage"]),
    });
    expect(parseArgs(["raise", "--skip", "coverage"]).command).toBe("raise");
  });

  it("refuses what it does not know", () => {
    const cases: [string[], string][] = [
      [[], "the command must be check or raise, not undefined"],
      [["lower"], 'the command must be check or raise, not "lower"'],
      [["check", "--force"], 'unknown argument "--force"'],
      [["check", "--base"], "--base needs a value"],
      [["check", "--base", "--skip"], "--base needs a value"],
      [["check", "--skip", "speed"], '--skip takes coverage or mutation, not "speed"'],
      [
        ["raise", "--base", "main"],
        "raise takes no --base: it moves floors, it does not judge a change",
      ],
    ];
    for (const [argv, message] of cases) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(new RatchetUnreadable(message));
    }
  });
});

describe("runRatchet check", () => {
  it("passes at the floor and above, printing each metric, its floor and its gap to 100", () => {
    const d = dir({
      [FLOOR_FILE]: floor({
        "packages/a": {
          coverage: { lines: 90, branches: 80, functions: 100, statements: 95.5 },
          mutation: 60,
        },
      }),
      "packages/a/coverage/coverage-summary.json": summary(90.25, 80, 100, 95.5),
      "packages/a/reports/mutation/mutation.json": report({
        "a.ts": [
          { status: "Killed", line: 1 },
          { status: "Killed", line: 1 },
          { status: "Survived", line: 1 },
        ],
      }),
    });
    const r = run(d, "check");
    expect(r).toEqual({
      code: 0,
      err: "",
      out: [
        `cosyte-ratchet check: ${FLOOR_FILE}, 1 package(s)`,
        "",
        "packages/a",
        "  metric      measured     floor  gap to 100",
        "  lines          90.25     90.00      9.75",
        "  branches       80.00     80.00     20.00",
        "  functions     100.00    100.00      0.00",
        "  statements     95.50     95.50      4.50",
        "  mutation       66.66     60.00     33.34",
        "",
        "cosyte-ratchet: OK, nothing dropped below its floor.",
        "",
      ].join("\n"),
    });
  });

  it("fails on any drop, saying by how much", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": { coverage: { lines: 90.5, branches: 50 }, mutation: 70 } }),
      "coverage/coverage-summary.json": summary(90.49, 60, 70, 80),
      "reports/mutation/mutation.json": report({
        "a.ts": [
          { status: "Killed", line: 1 },
          { status: "Survived", line: 1 },
        ],
      }),
    });
    const r = run(d, "check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("\n.\n");
    expect(r.out).toContain(
      "  lines          90.49     90.50      9.51  DROPPED 0.01 below the floor\n",
    );
    expect(r.out).toContain("  branches       60.00     50.00     40.00\n");
    expect(r.out).toContain("  functions      70.00      none     30.00  (no floor yet)\n");
    expect(r.out).toContain(
      "  mutation       50.00     70.00     50.00  DROPPED 20.00 below the floor\n",
    );
    expect(r.out.endsWith("\ncosyte-ratchet: FAIL, 2 finding(s) above.\n")).toBe(true);
  });

  it("reports packages in directory order, whatever order the floor file lists them in", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ "packages/b": {}, "packages/a": {} }),
      "packages/a/coverage/coverage-summary.json": summary(1),
      "packages/b/coverage/coverage-summary.json": summary(2),
    });
    const r = run(d, "check");
    expect(r.code).toBe(0);
    expect(r.out.indexOf("\npackages/a\n")).toBeLessThan(r.out.indexOf("\npackages/b\n"));
    expect(r.out.indexOf("\npackages/a\n")).toBeGreaterThan(0);
  });

  it("never writes the floor file on a check, even when a score rose", () => {
    const text = floor({ ".": { coverage: { lines: 10 } } });
    const d = dir({ [FLOOR_FILE]: text, "coverage/coverage-summary.json": summary(90) });
    expect(run(d, "check").code).toBe(0);
    expect(readFileSync(join(d, FLOOR_FILE), "utf8")).toBe(text);
  });

  it("reads the floor file from --floor, relative to the working directory, and packages relative to it", () => {
    const d = dir({
      "q/floor.json": floor({ pkg: { coverage: { lines: 1 } } }),
      "q/pkg/coverage/coverage-summary.json": summary(2),
    });
    const r = run(d, "check", "--floor", "q/floor.json", "--skip", "mutation");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("cosyte-ratchet check: floor.json, 1 package(s)\n\npkg\n");
    expect(r.out).toContain("  mutation      skipped (--skip mutation)\n");
  });

  it("skips coverage when told, and scores a mutation report that has no floor yet", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": {} }),
      "reports/mutation/mutation.json": report({ "a.ts": [{ status: "Killed", line: 1 }] }),
    });
    const r = run(d, "check", "--skip", "coverage");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "  coverage      skipped (--skip coverage)\n  mutation      100.00      none      0.00  (no floor yet)\n",
    );
  });

  it("does not ask for a mutation report a package neither holds a floor for nor has", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": {} }),
      "coverage/coverage-summary.json": summary(5),
    });
    const r = run(d, "check");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("mutation");
  });

  it("exits 2 when the floor file or a report it needs is missing, never passing", () => {
    const none = dir();
    expect(run(none, "check")).toEqual({
      code: 2,
      out: "",
      err: `cosyte-ratchet: could not run: the floor file ${join(none, FLOOR_FILE)} could not be read\n`,
    });
    const noSummary = dir({ [FLOOR_FILE]: floor({ ".": { coverage: { lines: 1 } } }) });
    expect(run(noSummary, "check", "--skip", "mutation").code).toBe(2);
    const noMutation = dir({
      [FLOOR_FILE]: floor({ ".": { mutation: 1 } }),
      "coverage/coverage-summary.json": summary(5),
    });
    const r = run(noMutation, "check");
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `cosyte-ratchet: could not run: the mutation report ${join(noMutation, REPORTS.mutation)} could not be read\n`,
    );
    expect(run(dir({ [FLOOR_FILE]: "[]" }), "check").code).toBe(2);
    expect(run(none, "frobnicate").err).toBe(
      'cosyte-ratchet: could not run: the command must be check or raise, not "frobnicate"\n',
    );
  });

  it("prints its help with --help or -h and exits 0", () => {
    for (const flag of ["--help", "-h"]) {
      const r = run(root, "check", flag);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(
        /^cosyte-ratchet: hold coverage and mutation score to a floor that only rises\./,
      );
      expect(r.out).toContain(
        "coverage/coverage-summary.json, coverage/lcov.info,\nreports/mutation/mutation.json",
      );
    }
  });

  it("lets an error that is not about its inputs through, rather than calling it unreadable", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": {} }),
      "coverage/coverage-summary.json": summary(5),
      "coverage/lcov.info": "",
    });
    const boom = () => {
      throw new TypeError("a bug");
    };
    expect(() =>
      runRatchet({
        argv: ["check", "--base", "main"],
        cwd: d,
        out: () => {},
        err: () => {},
        git: boom,
      }),
    ).toThrow("a bug");
  });
});

describe("runRatchet raise", () => {
  it("moves floors up to what was measured, adds missing ones, and never lowers one", () => {
    const d = dir({
      [FLOOR_FILE]: floor({
        "packages/a": { coverage: { lines: 90, branches: 85 }, mutation: 50 },
        "packages/b": {},
      }),
      "packages/a/coverage/coverage-summary.json": summary(95.5, 85, 70, 99),
      "packages/a/reports/mutation/mutation.json": report({
        "a.ts": [
          { status: "Killed", line: 1 },
          { status: "Survived", line: 1 },
        ],
      }),
      "packages/b/coverage/coverage-summary.json": summary(10),
    });
    const r = run(d, "raise");
    expect(r.code, r.out).toBe(0);
    expect(r.out.endsWith("\ncosyte-ratchet: raised 7 floor(s); none was lowered.\n")).toBe(true);
    expect(JSON.parse(readFileSync(join(d, FLOOR_FILE), "utf8"))).toEqual({
      packages: {
        "packages/a": {
          coverage: { lines: 95.5, branches: 85, functions: 70, statements: 99 },
          mutation: 50,
        },
        "packages/b": { coverage: { lines: 10, branches: 10, functions: 10, statements: 10 } },
      },
    });
    expect(readFileSync(join(d, FLOOR_FILE), "utf8").endsWith("}\n")).toBe(true);
  });

  it("raises a mutation floor, and with a drop raises the rest, leaves the drop and exits 1", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": { coverage: { lines: 90 }, mutation: 10 } }),
      "reports/mutation/mutation.json": report({
        "a.ts": [
          { status: "Killed", line: 1 },
          { status: "Survived", line: 1 },
        ],
      }),
      "coverage/coverage-summary.json": summary(80),
    });
    const r = run(d, "raise");
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "\ncosyte-ratchet: raised 4 floor(s); none was lowered.\ncosyte-ratchet: FAIL, 1 metric(s) below the floor, left where they were.\n",
    );
    expect(JSON.parse(readFileSync(join(d, FLOOR_FILE), "utf8")).packages["."]).toEqual({
      coverage: { lines: 90, branches: 80, functions: 80, statements: 80 },
      mutation: 50,
    });
  });

  it("raises nothing it skipped", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": {} }),
      "reports/mutation/mutation.json": report({ "a.ts": [{ status: "Killed", line: 1 }] }),
    });
    expect(run(d, "raise", "--skip", "coverage", "--skip", "mutation").code).toBe(0);
    expect(JSON.parse(readFileSync(join(d, FLOOR_FILE), "utf8"))).toEqual({
      packages: { ".": {} },
    });
  });
});

describe("runRatchet check --base: a pull request's own code", () => {
  const src = [
    "export function f(x: number): number {", // 1
    "  if (x > 0) return 1;", // 2
    "  /* v8 ignore next -- the caller never passes zero */", // 3
    "  if (x === 0) return 0;", // 4
    "  return -1;", // 5
    "}", // 6
    "",
  ].join("\n");

  /** A repo whose main has packages/a/src/a.ts at version 1, and whose change edits lines 2 to 5. */
  function change(files: Record<string, string>): string {
    const d = dir();
    git(d, "init", "-q", "-b", "main", ".");
    git(d, "config", "user.email", "test@example.com");
    git(d, "config", "user.name", "Test");
    write(d, { "packages/a/src/a.ts": "export function f(x: number): number {\n  return 1;\n}\n" });
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "base");
    git(d, "checkout", "-q", "-b", "feature");
    write(d, {
      ".gitignore": "coverage/\nreports/\n",
      "packages/a/src/a.ts": src,
      [FLOOR_FILE]: floor({ "packages/a": { coverage: { lines: 50 } } }),
      "packages/a/coverage/coverage-summary.json": summary(75),
      ...files,
    });
    return d;
  }

  const lcov = (hits: Record<number, number>) =>
    [
      "SF:src/a.ts",
      ...Object.entries(hits).map(([n, h]) => `DA:${n},${h}`),
      "end_of_record",
      "",
    ].join("\n");

  it("passes when every changed line ran and every mutant in it was killed, and lists the exceptions", () => {
    const d = change({
      "packages/a/coverage/lcov.info": lcov({ 1: 1, 2: 2, 5: 1 }),
      "packages/a/reports/mutation/changed.json": report(
        {
          "src/a.ts": [
            { status: "Killed", line: 2 },
            { status: "Survived", line: 1 },
            {
              status: "Ignored",
              line: 4,
              mutatorName: "EqualityOperator",
              statusReason: "the caller never passes zero",
            },
          ],
        },
        undefined,
      ),
    });
    const r = run(d, "check", "--base", "main");
    expect(r.err).toBe("");
    expect(r.code, r.out).toBe(0);
    const mergeBase = git(d, "rev-parse", "main").trim().slice(0, 12);
    expect(r.out).toContain(
      [
        `Changed code against main (merge base ${mergeBase}):`,
        "  uncovered changed lines: 0",
        "  surviving mutants in changed code: 0",
        "",
        `Floors in ${FLOOR_FILE} against the merge base:`,
        "  the floor file is new in this change; there is no earlier floor to hold",
        "",
        "Exceptions in changed code (list each one in the pull request):",
        "  - packages/a/src/a.ts:3 coverage, ignore next: the caller never passes zero",
        "  - packages/a/src/a.ts:4 mutation, EqualityOperator mutant ignored: the caller never passes zero",
        "",
        "cosyte-ratchet: OK, nothing dropped below its floor.",
        "",
      ].join("\n"),
    );
  });

  it("fails on a changed line that never ran, a surviving mutant, and an exception with no reason", () => {
    const d = change({
      "packages/a/coverage/lcov.info": lcov({ 1: 1, 2: 1, 5: 0 }),
      "packages/a/reports/mutation/changed.json": report({
        "src/a.ts": [
          { status: "Survived", line: 2, mutatorName: "ConditionalExpression" },
          {
            status: "Ignored",
            line: 4,
            mutatorName: "EqualityOperator",
            statusReason: "Ignored using a comment",
          },
        ],
      }),
    });
    const r = run(d, "check", "--base", "main");
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "  uncovered changed lines: 1\n    packages/a/src/a.ts:5 did not run\n",
    );
    expect(r.out).toContain(
      "  surviving mutants in changed code: 1\n    packages/a/src/a.ts:2 ConditionalExpression (Survived)\n",
    );
    expect(r.out).toContain(
      "  - packages/a/src/a.ts:4 mutation, EqualityOperator mutant ignored: NO REASON GIVEN (name one after the directive)\n",
    );
    expect(r.out.endsWith("\ncosyte-ratchet: FAIL, 3 finding(s) above.\n")).toBe(true);
  });

  it("says when nothing in changed code is an exception, and names a changed file no run mutated", () => {
    const d = change({
      "packages/a/src/a.ts": "export function f(x: number): number {\n  return 2;\n}\n",
      "packages/a/coverage/lcov.info": lcov({ 1: 1, 2: 1 }),
      "packages/a/reports/mutation/changed.json": report({}),
    });
    const r = run(d, "check", "--base", "main");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(
      "  not mutated (outside the package's mutate patterns): packages/a/src/a.ts\n",
    );
    expect(r.out).toContain(
      "Exceptions in changed code (list each one in the pull request):\n  none\n",
    );
  });

  it("exits 2 when a package with changes has no changed-files report, and not when it has no changes", () => {
    const d = change({ "packages/a/coverage/lcov.info": lcov({ 2: 1 }) });
    const r = run(d, "check", "--base", "main");
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `cosyte-ratchet: could not run: packages/a has changes but no changed-files mutation report at ${join(d, "packages/a", REPORTS.changed)}; run cosyte-mutate changed\n`,
    );
    write(d, {
      [FLOOR_FILE]: floor({ "packages/a": {}, "packages/b": {} }),
      "packages/b/coverage/coverage-summary.json": summary(1),
      "packages/b/coverage/lcov.info": "",
      "packages/a/reports/mutation/changed.json": report({}),
    });
    expect(run(d, "check", "--base", "main").code).toBe(0);
  });

  it("exits 2 when a package's lcov report is missing or the base is unknown", () => {
    const d = change({});
    const r = run(d, "check", "--base", "main");
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `cosyte-ratchet: could not run: the lcov report ${join(d, "packages/a", REPORTS.lcov)} is missing\n`,
    );
    write(d, { "packages/a/coverage/lcov.info": lcov({ 2: 1 }) });
    const unknown = run(d, "check", "--base", "nowhere", "--skip", "mutation");
    expect(unknown.code).toBe(2);
    expect(unknown.err).toBe(
      'cosyte-ratchet: could not run: the base ref "nowhere" names no commit git can find\n',
    );
  });

  it("compares the full mutation score only when a full report is there, and says so when it is not", () => {
    const d = change({
      "packages/a/coverage/lcov.info": lcov({ 2: 1 }),
      "packages/a/reports/mutation/changed.json": report({
        "src/a.ts": [{ status: "Killed", line: 2 }],
      }),
    });
    write(d, { [FLOOR_FILE]: floor({ "packages/a": { coverage: { lines: 50 }, mutation: 90 } }) });
    const none = run(d, "check", "--base", "main");
    expect(none.code, none.err).toBe(0);
    expect(none.out).toContain(
      "  mutation      no full run here (a change is judged on its own mutants below)\n",
    );
    write(d, {
      "packages/a/reports/mutation/mutation.json": report({
        "src/a.ts": [
          { status: "Killed", line: 2 },
          { status: "Survived", line: 1 },
        ],
      }),
    });
    const full = run(d, "check", "--base", "main");
    expect(full.code).toBe(1);
    expect(full.out).toContain(
      "  mutation       50.00     90.00     50.00  DROPPED 40.00 below the floor\n",
    );
  });

  it("judges only what was not skipped", () => {
    const d = change({ "packages/a/coverage/lcov.info": lcov({ 5: 0 }) });
    const noMutation = run(d, "check", "--base", "main", "--skip", "mutation");
    expect(noMutation.code).toBe(1);
    expect(noMutation.out).toContain("  uncovered changed lines: 1\n");
    expect(noMutation.out).toContain("  mutants in changed code: not judged (--skip mutation)\n");
    write(d, {
      "packages/a/reports/mutation/changed.json": report({
        "src/a.ts": [{ status: "Killed", line: 5 }],
      }),
    });
    const noCoverage = run(d, "check", "--base", "main", "--skip", "coverage");
    expect(noCoverage.code, noCoverage.out).toBe(0);
    expect(noCoverage.out).toContain(
      "  changed lines: not judged (--skip coverage)\n  surviving mutants in changed code: 0\n",
    );
    expect(noCoverage.out).toContain(
      "  - packages/a/src/a.ts:3 coverage, ignore next: the caller never passes zero\n",
    );
  });
});

describe("runRatchet check --base: the floor file only rises", () => {
  /** A repo whose main holds `before` as the floor file, and whose change makes it `after`. */
  function floorChange(
    before: string | null,
    after: Record<string, unknown>,
    measured = 75,
  ): string {
    const d = dir();
    git(d, "init", "-q", "-b", "main", ".");
    git(d, "config", "user.email", "test@example.com");
    git(d, "config", "user.name", "Test");
    write(d, { "packages/a/src/a.ts": "export const a = 1;\n" });
    if (before !== null) write(d, { [FLOOR_FILE]: before });
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "base");
    git(d, "checkout", "-q", "-b", "feature");
    write(d, {
      ".gitignore": "coverage/\nreports/\n",
      [FLOOR_FILE]: floor(after),
      "packages/a/coverage/coverage-summary.json": summary(measured),
      "packages/a/coverage/lcov.info": "",
    });
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "change");
    return d;
  }

  it("fails when a change lowers a floor or removes one the merge base held, naming each", () => {
    // A real drop (lines measured 40 against a floor of 70) hidden by lowering the floor to 30.
    const d = floorChange(
      floor({
        "packages/a": { coverage: { lines: 70, branches: 30 }, mutation: 60 },
        "packages/b": { coverage: { lines: 10 } },
      }),
      { "packages/a": { coverage: { lines: 30 } } },
      40,
    );
    const r = run(d, "check", "--base", "main", "--skip", "mutation");
    expect(r.err).toBe("");
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      [
        `Floors in ${FLOOR_FILE} against the merge base:`,
        "  packages/a lines lowered from 70.00 to 30.00",
        "  packages/a branches removed (was 30.00)",
        "  packages/a mutation removed (was 60.00)",
        "  packages/b lines removed (was 10.00)",
        "",
      ].join("\n"),
    );
    expect(r.out.endsWith("\ncosyte-ratchet: FAIL, 4 finding(s) above.\n")).toBe(true);
  });

  it("passes a change that only raises floors or adds them, and one that leaves them alone", () => {
    const before = floor({ "packages/a": { coverage: { lines: 50, branches: 50 } } });
    const raised = floorChange(before, {
      "packages/a": { coverage: { lines: 60, branches: 50, functions: 10 }, mutation: 1 },
    });
    const r = run(raised, "check", "--base", "main", "--skip", "mutation");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(
      `Floors in ${FLOOR_FILE} against the merge base:\n  none lowered or removed\n`,
    );
    const same = floorChange(before, { "packages/a": { coverage: { lines: 50, branches: 50 } } });
    expect(run(same, "check", "--base", "main", "--skip", "mutation").code).toBe(0);
  });

  it("holds nothing when the floor file is new in the change, saying so", () => {
    const d = floorChange(null, { "packages/a": { coverage: { lines: 50 } } });
    const r = run(d, "check", "--base", "main", "--skip", "mutation");
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toContain(
      `Floors in ${FLOOR_FILE} against the merge base:\n  the floor file is new in this change; there is no earlier floor to hold\n`,
    );
  });

  it("reads the floor file at the merge base, not at the base's tip", () => {
    const d = floorChange(floor({ "packages/a": { coverage: { lines: 50 } } }), {
      "packages/a": { coverage: { lines: 50 } },
    });
    git(d, "checkout", "-q", "main");
    write(d, { [FLOOR_FILE]: floor({ "packages/a": { coverage: { lines: 99 } } }) });
    git(d, "commit", "-q", "-am", "main moved on");
    git(d, "checkout", "-q", "feature");
    expect(run(d, "check", "--base", "main", "--skip", "mutation").code).toBe(0);
  });

  it("exits 2 when the floor file at the merge base is not JSON or not a floor", () => {
    for (const [before, why] of [
      ["not json", "is not JSON"],
      ['{ "packages": [] }', "has no `packages` object"],
    ]) {
      const d = floorChange(before, { "packages/a": {} });
      const mergeBase = git(d, "rev-parse", "main").trim();
      const r = run(d, "check", "--base", "main", "--skip", "mutation");
      expect(r.code).toBe(2);
      expect(r.err).toBe(
        `cosyte-ratchet: could not run: the floor file ${FLOOR_FILE} at the merge base ${mergeBase} ${why}\n`,
      );
    }
  });

  it("exits 2 when the floor file is outside the repository git names", () => {
    const d = dir({
      [FLOOR_FILE]: floor({ ".": {} }),
      "coverage/coverage-summary.json": summary(5),
      "coverage/lcov.info": "",
    });
    const sha = "a".repeat(40);
    const fake = (args: string[]) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: "/elsewhere\n", stderr: "" };
      if (args[0] === "cat-file" || args[0] === "merge-base") {
        return { status: 0, stdout: `${sha}\n`, stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    let err = "";
    const code = runRatchet({
      argv: ["check", "--base", "main", "--skip", "mutation"],
      cwd: d,
      out: () => {},
      err: (t) => (err += t),
      git: fake,
    });
    expect(code).toBe(2);
    expect(err).toBe(
      `cosyte-ratchet: could not run: the floor file ${join(d, FLOOR_FILE)} is outside the repository at /elsewhere\n`,
    );
  });
});

describe("the constants", () => {
  it("name the four coverage metrics and the report paths the shared configs write", () => {
    expect(COVERAGE_METRICS).toEqual(["lines", "branches", "functions", "statements"]);
    expect(REPORTS).toEqual({
      summary: "coverage/coverage-summary.json",
      lcov: "coverage/lcov.info",
      mutation: "reports/mutation/mutation.json",
      changed: "reports/mutation/changed.json",
    });
    expect(Object.isFrozen(COVERAGE_METRICS) && Object.isFrozen(REPORTS)).toBe(true);
  });
});
