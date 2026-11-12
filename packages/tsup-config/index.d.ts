import type { Options, defineConfig } from "tsup";

/** The options `cosyteTsup` takes: tsup's own, and the ones it adds. */
export type CosyteTsupOptions = Options & {
  /**
   * Keep each CommonJS entry point's exports as writable data properties when `splitting` is on,
   * as a one-file build has them, and fail the build on any export it cannot keep that way.
   * Default `false`.
   */
  plainCjsExports?: boolean;
};

/**
 * Standard tsup build config for `@cosyte/*` libraries (dual ESM + CJS, ES2023).
 *
 * @param overrides - tsup options merged over the baseline (e.g. `entry`), and `plainCjsExports`.
 * @returns The tsup config.
 */
export declare function cosyteTsup(overrides?: CosyteTsupOptions): ReturnType<typeof defineConfig>;
