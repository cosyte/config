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
