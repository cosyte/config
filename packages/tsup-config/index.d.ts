import type { Options, defineConfig } from "tsup";

/**
 * Standard tsup build config for `@cosyte/*` libraries (dual ESM + CJS, ES2023).
 *
 * @param overrides - tsup options merged over the baseline (e.g. `entry`).
 * @returns The tsup config.
 */
export declare function cosyteTsup(overrides?: Options): ReturnType<typeof defineConfig>;
