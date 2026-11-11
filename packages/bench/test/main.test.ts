import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import type { AnyJob, AnyJobResult } from "../src/child.js";
import { USAGE, main, parseArgs, type MainIo } from "../src/main.js";
import { readResults } from "../src/results.js";
import { env, fixedRunner, importCost, warmup } from "./support/bodies.js";
import { FIXTURES, scratchDir } from "./support/paths.js";

function harness(over: Partial<MainIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const dir = scratchDir("bench-main-");
  const io: MainIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    cwd: dir,
    env: {},
    runJob: fixedRunner().runJob,
    measureImport: () => Promise.resolve(importCost),
    environment: () => env,
    now: () => new Date("2026-11-10T00:00:00Z"),
    ...over,
  };
  return { io, dir, out: () => out.join(""), err: () => err.join("") };
}

const suite = () => FIXTURES.suite;

describe("parseArgs", () => {
  it("collects values, repeated values, booleans and positionals", () => {
    const parsed = parseArgs(["--suite", "s", "--only", "a", "--only", "b", "--no-memory", "file"]);
    expect(parsed.values.get("--suite")).toEqual(["s"]);
    expect(parsed.values.get("--only")).toEqual(["a", "b"]);
    expect([...parsed.flags]).toEqual(["--no-memory"]);
    expect(parsed.positional).toEqual(["file"]);
  });

  it("refuses an unknown flag and a value flag with no value", () => {
    expect(() => parseArgs(["--fast"])).toThrow("unknown flag --fast");
    expect(() => parseArgs(["--suite"])).toThrow("--suite needs a value");
    expect(() => parseArgs(["--suite", "--target", "t"])).toThrow("--suite needs a value");
  });
});

describe("main", () => {
  it("prints usage and exits 2 with no command, 0 when asked for help", async () => {
    const h = harness();
    expect(await main([], h.io)).toBe(2);
    expect(h.out()).toBe(USAGE);
    expect(USAGE).toContain("cosyte-bench compare --suite <file> --base <file> --head <file>");
    expect(await main(["--help"], harness().io)).toBe(0);
    expect(await main(["help"], harness().io)).toBe(0);
  });

  it("refuses an unknown command, an unexpected argument and a missing flag, with the usage", async () => {
    for (const [argv, message] of [
      [["race"], "unknown command race"],
      [["run", "extra", "--suite", "s"], "unexpected argument extra"],
      [["run", "--target", "t"], "--suite is required"],
      [["run", "--suite", "s"], "--target is required"],
      [["compare", "--suite", "s", "--head", "h"], "--base is required"],
      [["compare", "--suite", "s", "--base", "b"], "--head is required"],
      [["calibrate", "--suite", "s", "--base", "b", "--head", "h"], "--comparisons is required"],
      [["run", "--suite", "s", "--suite", "t", "--target", "x"], "--suite given more than once"],
      [
        ["run", "--suite", "s", "--target", "t", "--processes", "0"],
        "--processes must be a positive integer",
      ],
      [
        ["run", "--suite", "s", "--target", "t", "--processes", "two"],
        "--processes must be a positive integer",
      ],
      [
        [
          "calibrate",
          "--suite",
          "s",
          "--base",
          "b",
          "--head",
          "h",
          "--comparisons",
          "1",
          "--inject",
          "2",
        ],
        "--inject must be a fraction from 0 to 1",
      ],
      [
        [
          "calibrate",
          "--suite",
          "s",
          "--base",
          "b",
          "--head",
          "h",
          "--comparisons",
          "1",
          "--inject",
          "-0.1",
        ],
        "--inject must be a fraction from 0 to 1",
      ],
      [
        [
          "calibrate",
          "--suite",
          "s",
          "--base",
          "b",
          "--head",
          "h",
          "--comparisons",
          "1",
          "--inject",
          "x",
        ],
        "--inject must be a fraction from 0 to 1",
      ],
      [["check"], "check needs a results file"],
      [["check", "r.json", "--out", "x"], "check takes no flags"],
      [["check", "r.json", "--no-memory"], "check takes no flags"],
      [
        ["compare", "--suite", "s", "--base", "b", "--head", "h", "--inject", "0.5"],
        "--inject does not apply to compare",
      ],
      [
        ["compare", "--suite", "s", "--base", "b", "--head", "h", "--comparisons", "3"],
        "--comparisons does not apply to compare",
      ],
      [["run", "--suite", "s", "--target", "t", "--base", "b"], "--base does not apply to run"],
      [
        [
          "calibrate",
          "--suite",
          "s",
          "--base",
          "b",
          "--head",
          "h",
          "--comparisons",
          "1",
          "--no-import",
        ],
        "--no-import does not apply to calibrate",
      ],
    ] as const) {
      const h = harness();
      expect(await main(argv, h.io)).toBe(2);
      expect(h.err()).toBe(`[cosyte-bench] ${message}\n\n${USAGE}`);
    }
  });

  it("takes a reading, writes the JSON and the Markdown, and prints the Markdown", async () => {
    const runner = fixedRunner();
    const h = harness({ runJob: runner.runJob, env: { GITHUB_SHA: "from-env" } });
    const target = join(h.dir, "dist", "index.mjs");
    const code = await main(
      [
        "run",
        "--suite",
        suite(),
        "--target",
        "dist/index.mjs",
        "--only",
        "length @ small",
        "--processes",
        "2",
        "--out",
        "r.json",
        "--summary",
        "r.md",
      ],
      h.io,
    );
    expect(code).toBe(0);
    const doc = readResults(readFileSync(join(h.dir, "r.json"), "utf8"));
    expect(doc).toMatchObject({
      kind: "reading",
      subject: { target: join("dist", "index.mjs"), commit: "from-env" },
      suite: { name: "fixture suite", file: relative(h.dir, suite()) },
    });
    expect(readFileSync(join(h.dir, "r.md"), "utf8")).toBe(h.out());
    expect(h.out()).toContain("### Reading: fixture suite");
    expect(h.err()).toBe("[cosyte-bench] read length @ small\n");
    expect(runner.jobs.filter((j) => j.mode === "timing")).toHaveLength(2);
    expect(runner.jobs[0]?.target).toBe(target);
  });

  it("takes a commit from --commit first, and none when there is none", async () => {
    const h = harness({ env: { GITHUB_SHA: "from-env" } });
    await main(
      [
        "run",
        "--suite",
        suite(),
        "--target",
        "t.mjs",
        "--only",
        "length @ small",
        "--commit",
        "abc",
        "--out",
        "r.json",
        "--no-memory",
        "--no-import",
      ],
      h.io,
    );
    const doc = readResults(readFileSync(join(h.dir, "r.json"), "utf8"));
    expect(doc).toMatchObject({
      subject: { commit: "abc" },
      reading: { importCost: null, cases: [{ allocations: null }] },
    });
    const bare = harness();
    await main(
      [
        "run",
        "--suite",
        suite(),
        "--target",
        "t.mjs",
        "--only",
        "length @ small",
        "--out",
        "r.json",
      ],
      bare.io,
    );
    expect(readResults(readFileSync(join(bare.dir, "r.json"), "utf8"))).toMatchObject({
      subject: { commit: null },
    });
  });

  it("compares, exits 1 on a regression, and records both builds", async () => {
    const runJob = (job: AnyJob): Promise<AnyJobResult> => {
      if (job.mode === "floor") return Promise.reject(new Error("a comparison runs no floor"));
      const ms = job.mode === "timing" && job.target.endsWith("head.mjs") ? 1.2 : 1;
      return Promise.resolve({
        mode: "timing",
        case: job.case,
        inputsPerPass: 1,
        bytesPerPass: null,
        warmup,
        status: "measured",
        samplesMsPerOp: [ms],
        medianMsPerOp: ms,
        latency: null,
      });
    };
    const h = harness({ runJob });
    const code = await main(
      [
        "compare",
        "--suite",
        suite(),
        "--base",
        "base.mjs",
        "--head",
        "head.mjs",
        "--only",
        "length @ small",
        "--base-commit",
        "b1",
        "--head-commit",
        "h1",
        "--out",
        "c.json",
        "--summary",
        "c.md",
      ],
      h.io,
    );
    expect(code).toBe(1);
    const doc = readResults(readFileSync(join(h.dir, "c.json"), "utf8"));
    expect(doc).toMatchObject({
      kind: "comparison",
      base: { target: "base.mjs", commit: "b1" },
      head: { target: "head.mjs", commit: "h1" },
      comparison: { cases: [{ verdict: "regression" }] },
    });
    expect(h.out()).toContain("| length | small |");
    expect(h.err()).toContain("[cosyte-bench] round 12 of 12 done\n");
  });

  it("prints the Markdown and writes nothing when given no files", async () => {
    const h = harness();
    expect(
      await main(
        ["run", "--suite", suite(), "--target", "t.mjs", "--only", "length @ small"],
        h.io,
      ),
    ).toBe(0);
    expect(h.out()).toContain("### Reading: fixture suite");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(h.dir)).toEqual([]);
  });

  it("compares with no commits named", async () => {
    const h = harness();
    expect(
      await main(
        [
          "compare",
          "--suite",
          suite(),
          "--base",
          "b.mjs",
          "--head",
          "h.mjs",
          "--only",
          "length @ small",
          "--out",
          "c.json",
        ],
        h.io,
      ),
    ).toBe(0);
    expect(readResults(readFileSync(join(h.dir, "c.json"), "utf8"))).toMatchObject({
      base: { commit: null },
      head: { commit: null },
    });
  });

  it("takes every case when no --only is given", async () => {
    const runner = fixedRunner();
    const h = harness({ runJob: runner.runJob });
    expect(
      await main(
        [
          "run",
          "--suite",
          suite(),
          "--target",
          "t.mjs",
          "--processes",
          "1",
          "--no-memory",
          "--no-import",
        ],
        h.io,
      ),
    ).toBe(0);
    expect(new Set(runner.jobs.map((j) => j.case.benchmark)).size).toBeGreaterThan(5);
  });

  it("accepts an injected slowdown of exactly 0 or 1", async () => {
    for (const inject of ["0", "1"]) {
      const h = harness();
      const args = [
        "calibrate",
        "--suite",
        suite(),
        "--base",
        "b.mjs",
        "--head",
        "h.mjs",
        "--comparisons",
        "1",
        "--inject",
        inject,
        "--only",
        "length @ small",
        "--out",
        "k.json",
      ];
      expect(await main(args, h.io)).toBe(0);
      expect(readResults(readFileSync(join(h.dir, "k.json"), "utf8"))).toMatchObject({
        calibration: { inject: Number(inject) },
      });
    }
  });

  it("calibrates, with and without an injected slowdown", async () => {
    const h = harness();
    expect(
      await main(
        [
          "calibrate",
          "--suite",
          suite(),
          "--base",
          "b.mjs",
          "--head",
          "h.mjs",
          "--comparisons",
          "2",
          "--only",
          "length @ small",
          "--out",
          "k.json",
          "--summary",
          "k.md",
        ],
        h.io,
      ),
    ).toBe(0);
    expect(readResults(readFileSync(join(h.dir, "k.json"), "utf8"))).toMatchObject({
      kind: "calibration",
      calibration: { comparisons: 2, inject: 0 },
    });
    expect(h.err()).toContain("[cosyte-bench] comparison 2 of 2: no regression verdict\n");
    const i = harness();
    expect(
      await main(
        [
          "calibrate",
          "--suite",
          suite(),
          "--base",
          "b.mjs",
          "--head",
          "h.mjs",
          "--comparisons",
          "1",
          "--inject",
          "0.05",
          "--only",
          "length @ small",
          "--out",
          "k.json",
        ],
        i.io,
      ),
    ).toBe(0);
    expect(readResults(readFileSync(join(i.dir, "k.json"), "utf8"))).toMatchObject({
      calibration: { inject: 0.05 },
    });
  });

  it("checks a results file: 0 valid, 1 not matching, 2 unreadable", async () => {
    const h = harness();
    await main(
      [
        "run",
        "--suite",
        suite(),
        "--target",
        "t.mjs",
        "--only",
        "length @ small",
        "--out",
        "r.json",
      ],
      h.io,
    );
    const check = harness({ cwd: h.dir });
    expect(await main(["check", "r.json"], check.io)).toBe(0);
    expect(check.out()).toBe("r.json: a valid reading document, schema version 1\n");
    writeFileSync(join(h.dir, "bad.json"), '{"schemaVersion": 1}');
    const bad = harness({ cwd: h.dir });
    expect(await main(["check", "bad.json"], bad.io)).toBe(1);
    expect(bad.err()).toMatch(
      /^\[cosyte-bench\] bad\.json: @cosyte\/bench: the results do not match the schema:\n/,
    );
    const missing = harness({ cwd: h.dir });
    expect(await main(["check", "nope.json"], missing.io)).toBe(2);
    expect(missing.err()).toBe("[cosyte-bench] cannot read nope.json\n");
  });

  it("exits 2 with the reason when a run cannot measure", async () => {
    const h = harness();
    expect(await main(["run", "--suite", FIXTURES.notASuite, "--target", "t.mjs"], h.io)).toBe(2);
    expect(h.err()).toBe(
      "[cosyte-bench] @cosyte/bench: a suite must be an object made by defineSuite\n",
    );
    const thrown = harness({
      runJob: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the branch under test is a thrown non-Error
        throw "plain";
      },
    });
    expect(
      await main(
        ["run", "--suite", suite(), "--target", "t.mjs", "--only", "length @ small"],
        thrown.io,
      ),
    ).toBe(2);
    expect(thrown.err()).toBe(
      "[cosyte-bench] could not measure timing of length @ small: plain\n" +
        "[cosyte-bench] could not measure the memory floor: plain\n",
    );
    // What fails outside a measuring process, the import cost here, still stops the run.
    const importThrows = harness({
      measureImport: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the branch under test is a thrown non-Error
        throw "no import";
      },
    });
    expect(
      await main(
        ["run", "--suite", suite(), "--target", "t.mjs", "--only", "length @ small"],
        importThrows.io,
      ),
    ).toBe(2);
    expect(importThrows.err()).toBe(
      "[cosyte-bench] read length @ small\n[cosyte-bench] no import\n",
    );
  });

  it("writes every case it measured when one cannot be, lists that one, and exits 2", async () => {
    const runner = fixedRunner({
      fail: (j) => j.mode === "timing" && j.case.size === "large",
    });
    const h = harness({ runJob: runner.runJob });
    const code = await main(
      [
        "run",
        "--suite",
        suite(),
        "--target",
        "t.mjs",
        "--only",
        "length",
        "--processes",
        "1",
        "--out",
        "r.json",
      ],
      h.io,
    );
    expect(code).toBe(2);
    const doc = readResults(readFileSync(join(h.dir, "r.json"), "utf8"));
    if (doc.kind !== "reading") throw new Error("a reading");
    expect(doc.reading.cases.map((c) => c.size)).toEqual(["small"]);
    expect(doc.reading.failures).toEqual([
      {
        phase: "timing",
        benchmark: "length",
        size: "large",
        message: "the timing job could not measure: synthetic",
      },
    ]);
    expect(doc.reading.memoryFloor).toMatchObject({ status: "measured" });
    expect(h.out()).toContain(
      "- timing of length @ large: the timing job could not measure: synthetic",
    );
    expect(h.err()).toContain(
      "[cosyte-bench] could not measure timing of length @ large: the timing job could not measure: synthetic\nstderr line two\n",
    );
  });
});
