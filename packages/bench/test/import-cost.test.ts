import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { BENCH_CONTRACT } from "../src/contract.js";
import { importMain, loadRecorder, measureImportCost } from "../src/import-cost.js";
import { BenchError } from "../src/spawn.js";
import { entry, FIXTURES, here, scratchDir } from "./support/paths.js";

const scratch = () => scratchDir("bench-import-");

describe("importMain", () => {
  it("times an import", async () => {
    const out = join(scratch(), "out.json");
    const before = performance.now();
    expect(await importMain(["time", FIXTURES.target, out])).toBe(0);
    const outside = performance.now() - before;
    const { ms } = JSON.parse(readFileSync(out, "utf8")) as { ms: number };
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThanOrEqual(outside);
  });

  it("writes the list of files it saw loaded", async () => {
    // Under the test runner an import goes through Vite rather than Node's loader, so the hook sees
    // nothing here; what it records in a real process is checked end to end in e2e.test.ts.
    const out = join(scratch(), "out.json");
    expect(await importMain(["files", FIXTURES.target, out])).toBe(0);
    const { files } = JSON.parse(readFileSync(out, "utf8")) as { files: unknown };
    expect(Array.isArray(files)).toBe(true);
  });

  it("records file modules as they load, and passes every load on", () => {
    const files = new Set<string>();
    const hook = loadRecorder(files);
    const seen: string[] = [];
    const next = ((url: string) => {
      seen.push(url);
      return { format: "module", source: "", shortCircuit: true };
    }) as Parameters<typeof hook>[2];
    const context = {
      conditions: [],
      format: undefined,
      importAttributes: {},
    } as unknown as Parameters<typeof hook>[1];
    hook("file:///tmp/a.mjs", context, next);
    hook("node:fs", context, next);
    expect([...files]).toEqual(["/tmp/a.mjs"]);
    expect(seen).toEqual(["file:///tmp/a.mjs", "node:fs"]);
  });

  it("refuses a mode it does not know", async () => {
    expect(await importMain(["warm", FIXTURES.target, join(scratch(), "out.json")])).toBe(2);
    expect(await importMain([])).toBe(2);
    expect(await importMain(["time", FIXTURES.target])).toBe(2);
  });
});

describe("measureImportCost", () => {
  it("interleaves the target with an empty module and sums the bytes loaded", async () => {
    const log = join(scratch(), "order.log");
    // A temporary directory of this test's own, so other test files' directories cannot interfere.
    const own = scratch();
    const saved = process.env["TMPDIR"];
    process.env["BENCH_IMPORT_LOG"] = log;
    process.env["TMPDIR"] = own;
    let report;
    try {
      report = await measureImportCost(FIXTURES.target, entry("import-ok"));
    } finally {
      delete process.env["BENCH_IMPORT_LOG"];
      if (saved === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = saved;
    }
    // Target first in even runs, the empty module first in odd ones.
    const order = readFileSync(log, "utf8").trim().split("\n");
    expect(order).toHaveLength(2 * BENCH_CONTRACT.IMPORT_RUNS);
    order.forEach((which, i) => {
      const run = Math.floor(i / 2);
      expect(which, `import ${String(i)}`).toBe(
        (run % 2 === 0) === (i % 2 === 0) ? "target" : "empty",
      );
    });
    // Its temporary directory is gone.
    expect(readdirSync(own)).toEqual([]);
    const file = (path: string) => {
      const bytes = readFileSync(path);
      return {
        path: relative(process.cwd(), path),
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
      };
    };
    const [results, target] = [file(here("../src/results.ts")), file(FIXTURES.target)];
    const files = [results, target];
    expect(report).toEqual({
      runs: BENCH_CONTRACT.IMPORT_RUNS,
      coldImportMs: Array.from({ length: BENCH_CONTRACT.IMPORT_RUNS }, () => 2.5),
      medianMs: 2.5,
      p95Ms: 2.5,
      emptyImportMs: Array.from({ length: BENCH_CONTRACT.IMPORT_RUNS }, () => 0.25),
      emptyMedianMs: 0.25,
      files,
      totalBytes: results.bytes + target.bytes,
      totalGzipBytes: results.gzipBytes + target.gzipBytes,
    });
    // Level 9, not the default level, is what the gzip size means: on this file they differ.
    expect(results.gzipBytes).toBeLessThan(
      gzipSync(readFileSync(here("../src/results.ts"))).length,
    );
  });

  it("refuses when the import process writes nothing", async () => {
    const error = await measureImportCost(FIXTURES.target, entry("import-silent")).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BenchError);
    expect((error as Error).message).toMatch(
      /^the cold import of .*target\.mjs wrote no result\. Its stderr ends:\ncould not import\n$/,
    );
  });
});
