import { defineConfig } from "tsup";

/**
 * Standard tsup build config for `@cosyte/*` libraries: dual ESM + CJS with `.d.ts`, `ES2023` target,
 * Node platform, treeshake on, splitting off, `.mjs` / `.cjs` out-extensions, sourcemaps. Pass an
 * `entry` (and any other tsup `Options`) per package; everything else is the enforced baseline.
 *
 * @param {import("tsup").Options} [overrides] - tsup options merged over the baseline (e.g. `entry`).
 * @returns {ReturnType<typeof defineConfig>} The tsup config.
 * @example
 * // tsup.config.ts
 * import { cosyteTsup } from "@cosyte/tsup-config";
 * export default cosyteTsup({ entry: ["src/index.ts"] });
 */
export function cosyteTsup(overrides = {}) {
  return defineConfig({
    format: ["esm", "cjs"],
    target: "es2023",
    platform: "node",
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    minify: false,
    skipNodeModulesBundle: true,
    outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
    ...overrides,
  });
}
