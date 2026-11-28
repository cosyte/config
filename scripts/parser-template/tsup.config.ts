import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for {{PKG}}: dual ESM + CJS + `.d.ts` from the shared @cosyte/tsup-config standard
 * (ES2023, Node platform, `.mjs`/`.cjs` out-extensions). Matches the `exports` map in package.json.
 * `fast-check` stays external: it is the optional peer the `/arbitraries` entry needs, and the root
 * entry never loads it.
 */
export default cosyteTsup({
  entry: { index: "src/index.ts", arbitraries: "src/arbitraries/index.ts" },
  external: ["fast-check"],
});
