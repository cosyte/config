/**
 * Type declarations for `@cosyte/script-utils/attw`, the shared `attw` publish gate.
 *
 * The behaviour, every net, every refusal and every measurement behind them are documented in
 * `attw.js`'s own docblock, which is the single authoritative description. Nothing is restated
 * here: a claim written down twice is a claim that drifts.
 */

/** What a caller must tell the gate, and the one thing it may. */
export interface AttwGateOptions {
  /**
   * The CALLER's `import.meta.url`. REQUIRED, and deliberately without a default.
   *
   * `attw` is resolved as `../node_modules/.bin/attw` from this URL, so the binary the gate spawns
   * is the CONSUMING package's own. Defaulted to this module's URL it would resolve inside
   * `node_modules/@cosyte/`, where a consumer has no attw at all. A call that omits it is refused.
   */
  callerUrl: string;
  /**
   * The arguments to grade against the allow-list and forward to attw. Defaults to this process's
   * own (`process.argv.slice(2)`). Only `--profile` (with its value) and `--no-definitely-typed`
   * are accepted; everything else is refused by the allow-list rather than forwarded.
   */
  argv?: string[];
}

/**
 * Run the gate in the current working directory, which must be the package being checked.
 *
 * Nothing here calls `process.exit`: the code is RETURNED, and a caller is expected to set
 * `process.exitCode` from it.
 *
 * @returns 0 when every net passed, attw's own status when attw itself judged the package, and 1
 *   for every refusal the gate raises.
 */
export declare function runAttwGate(options: AttwGateOptions): number;

/** Where the command-line form reads what a package leaves out: `scripts/attw.exclude`. */
export declare const ATTW_EXCLUDE_PATH: "scripts/attw.exclude";

/**
 * Read an attw exclusions file (one resolution per line: `node10`, `node16-cjs`; `#` comments)
 * into the one profile it selects: `node10` alone selects `node16`, both select `esm-only`.
 */
export declare function readAttwExclusions(text: string): {
  profile: "node16" | "esm-only" | null;
  problems: string[];
};

/**
 * The command-line form: run the gate for the package in the working directory, reading
 * `scripts/attw.exclude`, with no caller file. `node node_modules/@cosyte/script-utils/attw.js`.
 */
export declare function runAttwCli(argv: string[]): number;

/**
 * The consuming package's own attw binary, resolved as `../node_modules/.bin/attw` from
 * `callerUrl`, or `../node_modules/.bin/attw.cmd` on Windows, where the extensionless file is a
 * POSIX shell script that Windows cannot start.
 *
 * @param callerUrl The caller's `import.meta.url`.
 * @param platform Defaults to `process.platform`.
 */
export declare function attwBinaryPath(callerUrl: string, platform?: string): string;

/**
 * How the gate starts attw, npm and pnpm. Off Windows: the file and its arguments as they are,
 * with no shell. On Windows, where all three are `.cmd` files that Node will not start without
 * one: a single command line, every part but a bare tool name in double quotes, run through `cmd.exe`. A part carrying
 * a double quote, a percent sign or a line break throws there rather than being escaped.
 *
 * @param file The tool: a path, or a name found on PATH.
 * @param args Its arguments.
 * @param platform Defaults to `process.platform`.
 */
export declare function toolCommand(
  file: string,
  args: string[],
  platform?: string,
): { file: string; args: string[]; shell: boolean };
