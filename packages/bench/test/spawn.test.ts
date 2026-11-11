import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Job } from "../src/child.js";
import { BenchError, ENTRIES, childEnv, flagsFor, runInChild, runNode } from "../src/spawn.js";
import { entry, FIXTURES, scratchDir } from "./support/paths.js";

const job: Job = {
  mode: "timing",
  suite: FIXTURES.suite,
  target: FIXTURES.target,
  case: { benchmark: "length", size: "small" },
  latency: false,
  inject: 0,
};

describe("childEnv", () => {
  it("drops what would change a measurement, and keeps the rest", () => {
    const env = childEnv({
      PATH: "/bin",
      NODE_V8_COVERAGE: "/tmp/c",
      NODE_COMPILE_CACHE: "/tmp/k",
      NODE_OPTIONS: "--x",
    });
    expect(env).toEqual({ PATH: "/bin", NODE_OPTIONS: "--x" });
  });

  it("reads this process's environment by default", () => {
    expect(childEnv()["PATH"]).toBe(process.env["PATH"]);
  });
});

describe("flagsFor", () => {
  it("gives timing jobs no flags, memory jobs gc and array buffers freed at the collection, and the alloc job a large young generation", () => {
    expect(flagsFor(job)).toEqual([]);
    expect(
      flagsFor({ mode: "heap", suite: "", target: "", case: job.case, longRun: false }),
    ).toEqual(["--expose-gc", "--no-concurrent-array-buffer-sweeping"]);
    // The floor reads its peak the way the heap job does, so it starts the same way.
    expect(flagsFor({ mode: "floor" })).toEqual([
      "--expose-gc",
      "--no-concurrent-array-buffer-sweeping",
    ]);
    expect(flagsFor({ mode: "alloc", suite: "", target: "", case: job.case })).toEqual([
      "--expose-gc",
      "--no-concurrent-array-buffer-sweeping",
      "--min-semi-space-size=64",
      "--max-semi-space-size=64",
    ]);
  });
});

describe("ENTRIES", () => {
  it("points at the built processes beside this module", () => {
    expect(ENTRIES.child).toMatch(/[/\\]child-entry\.mjs$/);
    expect(ENTRIES.importer).toMatch(/[/\\]import-entry\.mjs$/);
  });
});

describe("runInChild", () => {
  it("returns what the process measured, started with the job's flags and without coverage", async () => {
    const result = (await runInChild(
      { mode: "heap", suite: "", target: "", case: job.case, longRun: false },
      { entry: entry("ok") },
    )) as unknown as {
      execArgv: string[];
      coverage: string | null;
      case: unknown;
    };
    expect(result.case).toEqual(job.case);
    expect(result.execArgv).toEqual(["--expose-gc", "--no-concurrent-array-buffer-sweeping"]);
    expect(result.coverage).toBeNull();
  });

  it("does not pass on a compile cache, and leaves no temporary directory behind", async () => {
    // A temporary directory of this test's own, so other test files' directories cannot interfere.
    const scratch = scratchDir("bench-spawn-tmp-");
    const saved = process.env["TMPDIR"];
    process.env["TMPDIR"] = scratch;
    process.env["NODE_COMPILE_CACHE"] = join(scratch, "a-compile-cache");
    let result: unknown;
    try {
      result = await runInChild(job, { entry: entry("ok") });
    } finally {
      delete process.env["NODE_COMPILE_CACHE"];
      if (saved === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = saved;
    }
    expect(result).toMatchObject({ compileCache: null });
    expect(readdirSync(scratch)).toEqual([]);
  });

  it("discards the process's stdout, so a chatty function cannot block it", async () => {
    await expect(
      runInChild(job, { entry: entry("chatty"), timeoutMs: 20_000 }),
    ).resolves.toMatchObject({ chatty: true });
  });

  it("takes the flags it is given instead", async () => {
    const result = (await runInChild(job, {
      entry: entry("ok"),
      execArgv: ["--no-warnings"],
    })) as unknown as { execArgv: string[] };
    expect(result.execArgv).toEqual(["--no-warnings"]);
  });

  it("reports why the process could not measure", async () => {
    await expect(runInChild(job, { entry: entry("refuses") })).rejects.toThrow(
      new BenchError(
        'the timing job for "length @ small" could not measure: the suite is not a suite',
      ),
    );
    await expect(runInChild(job, { entry: entry("no-result") })).rejects.toThrow(
      /could not measure: undefined/,
    );
    // The floor names no case, so its error names the job alone.
    await expect(runInChild({ mode: "floor" }, { entry: entry("refuses") })).rejects.toThrow(
      new BenchError("the floor job could not measure: the suite is not a suite"),
    );
  });

  it("reports a process that ended without a result, with its exit code and stderr", async () => {
    const error = await runInChild(job, { entry: entry("silent") }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BenchError);
    expect((error as Error).message).toBe(
      'the timing job for "length @ small" ended (exit 3) without a result. Its stderr ends:\na diagnostic on stderr\n',
    );
    expect((error as Error).name).toBe("BenchError");
  });

  it("reports a process killed by a signal", async () => {
    await expect(runInChild(job, { entry: entry("crash") })).rejects.toThrow(
      /ended \(SIGKILL\) without a result/,
    );
  });

  it("starts the built measuring process by default, and says so when it is not there", async () => {
    // Under the test runner this module is the source, and no measuring process is built beside it.
    await expect(runInChild(job)).rejects.toThrow(
      /ended \(exit 1\) without a result\. Its stderr ends:\n[\s\S]*child-entry\.mjs/,
    );
  });

  it("kills a process that runs past its time", async () => {
    await expect(runInChild(job, { entry: entry("hang"), timeoutMs: 300 })).rejects.toThrow(
      /the timing job for "length @ small" timed out/,
    );
  });
});

describe("runNode", () => {
  it("rejects when node itself cannot start", async () => {
    await expect(runNode(entry("ok"), [], [], 1000, "/nonexistent/node")).rejects.toThrow(/ENOENT/);
  });

  it("keeps only the last 16 KiB of stderr", async () => {
    const outcome = await runNode(
      "-e",
      ['process.stderr.write("x".repeat(40000) + "END")'],
      [],
      10_000,
    );
    expect(outcome.stderr).toHaveLength(16 * 1024);
    expect(outcome.stderr.endsWith("END")).toBe(true);
    expect(outcome).toMatchObject({ code: 0, signal: null, timedOut: false });
  });
});
