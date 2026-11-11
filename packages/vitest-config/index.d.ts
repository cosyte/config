import type { UserConfig } from "vitest/config";

/** Options for {@link cosyteVitest}. */
export interface CosyteVitestOptions {
  /** `src/<dir>` subdirectories to gate per-directory at >= 90 (e.g. `["parser", "model"]`). */
  coverageDirs?: string[];
  /** Extra or overriding `coverage.thresholds` keys, merged over the defaults. */
  coverageThresholds?: Record<string, unknown>;
  /** Extra Vitest `test` options, merged last. */
  test?: Record<string, unknown>;
  /**
   * The project root whose `src/` is read for barrels (files that hold nothing but re-exports),
   * which coverage leaves out. Defaults to the working directory.
   */
  root?: string;
}

/**
 * Standard Vitest config for `@cosyte/*` packages (v8 coverage, per-directory >= 90 gates).
 *
 * @param opts - Options.
 * @returns The Vitest config.
 */
export declare function cosyteVitest(opts?: CosyteVitestOptions): UserConfig;
