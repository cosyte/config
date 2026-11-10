/**
 * End to end: real measuring processes, started from this package's sources, on the fixture suite.
 * These check what the processes report, never how fast anything was.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Job } from "../src/child.js";
import { measureImportCost } from "../src/import-cost.js";
import { readResults } from "../src/results.js";
import { flagsFor, runInChild, runNode } from "../src/spawn.js";
import { FIXTURES, here, scratchDir, TS } from "./support/paths.js";

const run = (job: Job, flags: readonly string[] = flagsFor(job)) =>
  runInChild(job, { entry: TS.child, execArgv: [...TS.loader, ...flags] });

const base = { suite: FIXTURES.suite, target: FIXTURES.target };

describe("a real measuring process", () => {
  it("times a case", async () => {
    const result = await run({
      mode: "timing",
      ...base,
      case: { benchmark: "length", size: "small" },
      latency: true,
      inject: 0,
    });
    expect(result).toMatchObject({ mode: "timing", inputsPerPass: 2, bytesPerPass: 5 });
    if (result.mode !== "timing" || result.status !== "measured")
      throw new Error(`not measured: ${JSON.stringify(result)}`);
    expect(result.samplesMsPerOp).toHaveLength(5);
    expect(result.medianMsPerOp).toBeGreaterThan(0);
    expect(result.warmup.elapsedMs).toBeGreaterThanOrEqual(500);
    expect(result.latency).not.toBeNull();
  });

  it("measures allocations with a large young generation", async () => {
    const result = await run({
      mode: "alloc",
      ...base,
      case: { benchmark: "length", size: "large" },
    });
    expect(result).toMatchObject({ mode: "alloc", allocations: { status: "measured" } });
    if (result.mode === "timing" || result.allocations?.status !== "measured")
      throw new Error("not measured");
    // `text.length` allocates nothing: the per-operation figure is near zero.
    expect(Math.abs(result.allocations.heapBytesPerOp)).toBeLessThan(64);
  });

  it("measures the peak heap and the long run", async () => {
    const result = await run({
      mode: "heap",
      ...base,
      case: { benchmark: "length", size: "large" },
      longRun: true,
    });
    expect(result).toMatchObject({
      mode: "heap",
      peak: { status: "measured" },
      longRun: { status: "measured", verdict: "flat" },
    });
  });

  it("skips memory, typed, without --expose-gc", async () => {
    const result = await run(
      { mode: "heap", ...base, case: { benchmark: "length", size: "small" }, longRun: true },
      [],
    );
    expect(result).toMatchObject({
      peak: { status: "skipped", reason: "gc-unavailable" },
      longRun: { status: "skipped", reason: "gc-unavailable" },
    });
  });

  it("refuses, with the case named and the input unquoted, when the measured function throws", async () => {
    const error = await run({
      mode: "timing",
      ...base,
      case: { benchmark: "boom", size: "one" },
      latency: false,
      inject: 0,
    }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(
      /could not measure: @cosyte\/bench: case "boom @ one": the suite's measured function threw \(RangeError\)/,
    );
    expect((error as Error).message).not.toContain("QUOTED-INPUT-VALUE");
  });
});

describe("a real cold import", () => {
  it("records every file the import loads, and only those", async () => {
    const dir = scratchDir("bench-e2e-import-");
    writeFileSync(join(dir, "leaf.mjs"), "export const x = 1;\n");
    writeFileSync(join(dir, "root.mjs"), 'export { x } from "./leaf.mjs";\n');
    const report = await measureImportCost(join(dir, "root.mjs"), TS.importer, TS.loader);
    expect(report.files.map((f) => f.path.split(/[/\\]/).pop())).toEqual(["leaf.mjs", "root.mjs"]);
    expect(report.totalBytes).toBe(20 + 32);
    expect(report.coldImportMs).toHaveLength(20);
    expect(report.medianMs).toBeGreaterThan(0);
  });
});

describe("the built command line", () => {
  // `pnpm test` builds first, so this is the bin a consumer runs, with its processes beside it.
  const cli = here("../dist/cli.mjs");
  const node = (args: readonly string[], cwd: string) =>
    runNode(cli, args, [], 600_000).then((o) => ({ ...o, cwd }));

  it("takes a reading, compares two copies of one build, and checks what it wrote", async () => {
    const dir = scratchDir("bench-e2e-cli-");
    const copy = join(dir, "copy.mjs");
    copyFileSync(FIXTURES.target, copy);
    const out = join(dir, "r.json");
    const read = await node(
      [
        "run",
        "--suite",
        FIXTURES.suite,
        "--target",
        FIXTURES.target,
        "--only",
        "length @ small",
        "--processes",
        "1",
        "--out",
        out,
      ],
      dir,
    );
    expect(read.code).toBe(0);
    const reading = readResults(readFileSync(out, "utf8"));
    expect(reading).toMatchObject({
      kind: "reading",
      reading: { cases: [{ allocations: { status: "measured" }, peak: { status: "measured" } }] },
    });
    if (reading.kind !== "reading") throw new Error("reading");
    expect(reading.reading.importCost?.files.map((f) => f.path.split(/[/\\]/).pop())).toEqual([
      "target.mjs",
    ]);

    const cmp = join(dir, "c.json");
    const compared = await node(
      [
        "compare",
        "--suite",
        FIXTURES.suite,
        "--base",
        FIXTURES.target,
        "--head",
        copy,
        "--only",
        "length @ small",
        "--out",
        cmp,
      ],
      dir,
    );
    const comparison = readResults(readFileSync(cmp, "utf8"));
    if (comparison.kind !== "comparison") throw new Error("comparison");
    // Which verdict two copies of one build get depends on the machine's noise; what must hold is
    // that the exit code follows it. A loaded machine can leave a warmup unsettled: a skip, exit 2.
    const verdict = comparison.comparison.cases[0]?.verdict;
    const codes = {
      regression: 1,
      skipped: 2,
      "no-regression": 0,
      inconclusive: 0,
      improvement: 0,
    } as const;
    expect(compared.code).toBe(codes[verdict ?? "skipped"]);
    if (verdict !== "skipped") expect(comparison.comparison.cases[0]?.ratios).toHaveLength(12);

    const checked = await runNode(cli, ["check", cmp], [], 60_000);
    expect(checked.code).toBe(0);
  }, 600_000);
});
