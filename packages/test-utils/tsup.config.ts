import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/test-utils — dual ESM + CJS + `.d.ts`/`.d.cts` from the shared
 * @cosyte/tsup-config standard (ES2023, Node platform, `.mjs`/`.cjs` out-extensions). Single
 * `src/index.ts` entry; matches the `exports` map in package.json.
 */
export default cosyteTsup({ entry: ["src/index.ts"] });
