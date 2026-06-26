import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for {{PKG}} — dual ESM + CJS + `.d.ts` from the shared @cosyte/tsup-config standard
 * (ES2023, Node platform, `.mjs`/`.cjs` out-extensions). Matches the `exports` map in package.json.
 */
export default cosyteTsup({ entry: ["src/index.ts"] });
