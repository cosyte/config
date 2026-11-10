/**
 * Cold import time and the bytes an import loads.
 *
 * Each timed import runs in a fresh process with no compile cache, so nothing is compiled before it
 * starts. The same number of fresh processes import an empty module, interleaved with the target's,
 * so a reader can see how much of the time is the import machinery rather than the package.
 *
 * The bytes are the files Node actually loaded for the import, found by a module hook in one further
 * process that is not timed (the hook itself costs time). This is what a Node consumer loads; it is
 * not what a bundler would keep after tree shaking, which depends on what the consumer imports.
 *
 * @packageDocumentation
 */

import { readFileSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { registerHooks, type LoadHookSync as LoadHook } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import { BENCH_CONTRACT } from "./contract.js";
import { BenchError, ENTRIES, runNode } from "./spawn.js";
import { median, nearestRank, round } from "./stats.js";

/**
 * A module `load` hook that adds each `file:` module it sees to `files`, then loads it as usual.
 *
 * @internal
 */
export function loadRecorder(files: Set<string>): LoadHook {
  return (url, context, nextLoad) => {
    if (url.startsWith("file:")) files.add(fileURLToPath(url));
    return nextLoad(url, context);
  };
}

/**
 * The cold import process's main. `argv` is `[mode, target, outFile]`: mode `time` imports the
 * target and writes `{ ms }`; mode `files` records every `file:` module loaded during the import and
 * writes `{ files }`. Returns the exit code.
 *
 * @internal
 */
export async function importMain(argv: readonly string[]): Promise<number> {
  if (argv.length !== 3) return 2;
  const [mode, target, outFile] = argv as [string, string, string];
  if (mode !== "time" && mode !== "files") return 2;
  const url = pathToFileURL(target).href;
  if (mode === "time") {
    const t0 = performance.now();
    await import(url);
    const ms = performance.now() - t0;
    writeFileSync(outFile, JSON.stringify({ ms }));
    return 0;
  }
  // Stryker disable all: this half runs only in a fresh Node process. Under the test runner an
  // import goes through Vite's loader, which Node's module hooks never see, and mutant switching
  // does not reach a child process; e2e.test.ts checks what it records in a real one.
  const files = new Set<string>();
  const hooks = registerHooks({ load: loadRecorder(files) });
  try {
    await import(url);
  } finally {
    hooks.deregister();
  }
  writeFileSync(outFile, JSON.stringify({ files: [...files] }));
  // Stryker restore all
  return 0;
}

/** One file an import loaded. */
export interface LoadedFile {
  /** Relative to the working directory, so no report carries a home directory. */
  readonly path: string;
  readonly bytes: number;
  /** Gzip at level 9: roughly what it costs to download. */
  readonly gzipBytes: number;
}

/** Cold import time and loaded bytes. */
export interface ImportCostReport {
  readonly runs: number;
  /** One per fresh process, milliseconds, in the order taken. */
  readonly coldImportMs: readonly number[];
  readonly medianMs: number;
  readonly p95Ms: number;
  /** The same for an empty module: the import machinery alone. */
  readonly emptyImportMs: readonly number[];
  readonly emptyMedianMs: number;
  readonly files: readonly LoadedFile[];
  readonly totalBytes: number;
  readonly totalGzipBytes: number;
}

async function oneImport(
  entry: string,
  execArgv: readonly string[],
  mode: "time" | "files",
  target: string,
  dir: string,
): Promise<unknown> {
  const out = join(dir, "import.json");
  rmSync(out, { force: true });
  const outcome = await runNode(entry, [mode, target, out], execArgv, 120_000);
  try {
    return JSON.parse(String(readFileSync(out)));
  } catch {
    throw new BenchError(
      `the cold import of ${relative(process.cwd(), target)} wrote no result. Its stderr ends:\n${outcome.stderr}`,
    );
  }
}

/**
 * Measure a target's cold import time over `IMPORT_RUNS` fresh processes, an empty module's over as
 * many, interleaved, and the bytes one import loads.
 *
 * @internal
 */
export async function measureImportCost(
  target: string,
  entry: string = ENTRIES.importer,
  execArgv: readonly string[] = [],
): Promise<ImportCostReport> {
  // Stryker disable next-line StringLiteral: the prefix only names the temporary directory.
  const dir = mkdtempSync(join(tmpdir(), "cosyte-bench-import-"));
  try {
    const empty = join(dir, "empty.mjs");
    // Stryker disable next-line StringLiteral: an empty file is an empty module too; the text only has to be one.
    writeFileSync(empty, "export {};\n");
    const cold: number[] = [];
    const bare: number[] = [];
    for (let i = 0; i < BENCH_CONTRACT.IMPORT_RUNS; i++) {
      const order = i % 2 === 0 ? [target, empty] : [empty, target];
      for (const which of order) {
        const { ms } = (await oneImport(entry, execArgv, "time", which, dir)) as { ms: number };
        (which === target ? cold : bare).push(round(ms, 3));
      }
    }
    const { files } = (await oneImport(entry, execArgv, "files", target, dir)) as {
      files: string[];
    };
    const loaded = files
      .map((file) => {
        const bytes = readFileSync(file);
        return {
          path: relative(process.cwd(), file),
          bytes: bytes.length,
          gzipBytes: gzipSync(bytes, { level: 9 }).length,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    return {
      runs: BENCH_CONTRACT.IMPORT_RUNS,
      coldImportMs: cold,
      medianMs: round(median(cold), 3),
      p95Ms: round(nearestRank(cold, 0.95), 3),
      emptyImportMs: bare,
      emptyMedianMs: round(median(bare), 3),
      files: loaded,
      totalBytes: loaded.reduce((n, f) => n + f.bytes, 0),
      totalGzipBytes: loaded.reduce((n, f) => n + f.gzipBytes, 0),
    };
  } finally {
    rmSync(dir, { recursive: true });
  }
}
