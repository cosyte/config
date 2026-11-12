import { defineConfig } from "tsup";

import { plainCjsExportsPlugin } from "./plain-cjs-exports.js";

/**
 * Standard tsup build config for `@cosyte/*` libraries: dual ESM + CJS with `.d.ts`, `ES2023` target,
 * Node platform, treeshake on, splitting off, `.mjs` / `.cjs` out-extensions, sourcemaps. Pass an
 * `entry` (and any other tsup `Options`) per package; everything else is the enforced baseline.
 *
 * `plainCjsExports: true` keeps each CommonJS entry point's exports as writable data properties when
 * `splitting` is on, as a one-file build has them, and fails the build on any export it cannot keep
 * that way. It adds a tsup plugin after any `plugins` given.
 *
 * @param {import("tsup").Options & { plainCjsExports?: boolean }} [overrides] - tsup options merged
 *   over the baseline (e.g. `entry`), and `plainCjsExports`.
 * @returns {ReturnType<typeof defineConfig>} The tsup config.
 * @example
 * // tsup.config.ts
 * import { cosyteTsup } from "@cosyte/tsup-config";
 * export default cosyteTsup({ entry: ["src/index.ts"] });
 */
export function cosyteTsup(overrides = {}) {
  const { plainCjsExports = false, ...options } = overrides;
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
    ...options,
    ...(plainCjsExports ? { plugins: [...(options.plugins ?? []), plainCjsExportsPlugin()] } : {}),
  });
}
