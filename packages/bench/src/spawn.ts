/**
 * Starting measuring processes and reading what they measured.
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Job, JobResult } from "./child.js";
import { BENCH_CONTRACT } from "./contract.js";

/**
 * A run that could not produce a measurement. The command line reports it and exits 2.
 *
 * @example
 * ```ts
 * import { BenchError } from "@cosyte/bench";
 *
 * new BenchError("no result").name; // => "BenchError"
 * ```
 */
export class BenchError extends Error {
  override readonly name = "BenchError";
}

/**
 * Where the built measuring processes live, beside this module in `dist`.
 *
 * @internal
 */
export const ENTRIES = Object.freeze({
  child: fileURLToPath(new URL("./child-entry.mjs", import.meta.url)),
  importer: fileURLToPath(new URL("./import-entry.mjs", import.meta.url)),
});

/**
 * How measuring processes are started. The defaults are the real ones; tests point `entry` at a
 * stand-in.
 *
 * @internal
 */
export interface SpawnOptions {
  /** The script the process runs. */
  readonly entry?: string;
  /** Flags for `node` before the script. */
  readonly execArgv?: readonly string[];
  /** Killed after this long, in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * The environment a measuring process gets: this one's, less what would change what it measures.
 * `NODE_V8_COVERAGE` would instrument it (a test runner sets it) and `NODE_COMPILE_CACHE` would
 * make a cold import warm.
 *
 * @internal
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out["NODE_V8_COVERAGE"];
  delete out["NODE_COMPILE_CACHE"];
  return out;
}

/** What a process said, raw. */
interface ProcessOutcome {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const STDERR_LIMIT = 16 * 1024;

/**
 * Run `node <execArgv> <entry> <args>` with stdout discarded (the code under test may print), and
 * keep the last 16 KiB of stderr for a diagnostic.
 *
 * @internal
 */
export function runNode(
  entry: string,
  args: readonly string[],
  execArgv: readonly string[],
  timeoutMs: number,
  execPath: string = process.execPath,
): Promise<ProcessOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, [...execArgv, entry, ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      env: childEnv(),
    });
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      // Stryker disable next-line all: an uncleared timer only keeps the event loop alive until it fires; killing a process that is gone does nothing.
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      // Stryker disable next-line all: as above, the timer's only effect after the process ended is to hold the event loop.
      clearTimeout(timer);
      resolve({ code, signal, stderr, timedOut });
    });
  });
}

/**
 * The flags a job's process starts with. Memory jobs need `gc()`; the allocation job also gets a
 * young generation large enough that a window of operations rarely collects.
 *
 * @internal
 */
export function flagsFor(job: Job): string[] {
  if (job.mode === "timing") return [];
  if (job.mode === "heap") return ["--expose-gc"];
  const mib = String(BENCH_CONTRACT.ALLOC_SEMI_SPACE_MIB);
  return ["--expose-gc", `--min-semi-space-size=${mib}`, `--max-semi-space-size=${mib}`];
}

function describe(job: Job): string {
  return `${job.mode} job for "${job.case.benchmark} @ ${job.case.size}"`;
}

/**
 * Run one job in a fresh process and return what it measured. Throws {@link BenchError} when the
 * process timed out, died, or wrote no result, with the tail of its stderr.
 *
 * @internal
 */
export async function runInChild(job: Job, options: SpawnOptions = {}): Promise<JobResult> {
  // Stryker disable next-line StringLiteral: the prefix only names the temporary directory.
  const dir = mkdtempSync(join(tmpdir(), "cosyte-bench-"));
  try {
    const jobFile = join(dir, "job.json");
    const outFile = join(dir, "out.json");
    writeFileSync(jobFile, JSON.stringify(job));
    const outcome = await runNode(
      options.entry ?? ENTRIES.child,
      [jobFile, outFile],
      options.execArgv ?? flagsFor(job),
      options.timeoutMs ?? 600_000,
    );
    if (outcome.timedOut) throw new BenchError(`the ${describe(job)} timed out`);
    let text: string;
    try {
      text = String(readFileSync(outFile));
    } catch {
      const how = outcome.signal === null ? `exit ${String(outcome.code)}` : outcome.signal;
      throw new BenchError(
        `the ${describe(job)} ended (${how}) without a result. Its stderr ends:\n${outcome.stderr}`,
      );
    }
    const out = JSON.parse(text) as { ok: boolean; result?: JobResult; error?: string };
    if (!out.ok || out.result === undefined) {
      throw new BenchError(`the ${describe(job)} could not measure: ${String(out.error)}`);
    }
    return out.result;
  } finally {
    rmSync(dir, { recursive: true });
  }
}
