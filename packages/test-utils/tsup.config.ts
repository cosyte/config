import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/test-utils: dual ESM + CJS + `.d.ts`/`.d.cts` from the shared
 * @cosyte/tsup-config standard (ES2023, Node platform, `.mjs`/`.cjs` out-extensions).
 *
 * Two entries, matching the two conditions in the `exports` map: the conformance kit on `.`, and
 * the performance kit on `./perf`. The subpath is deliberate rather than a root re-export: the
 * perf kit is a distinct runner family with its own contract, and keeping it off the root entry
 * means a parser importing the conformance runners does not pull `node:perf_hooks` in with them.
 * `entry` is a record so the output paths are pinned (`dist/index.*`, `dist/perf/index.*`) instead
 * of being inferred from a shared prefix, which is what the `exports` map above hard-codes.
 */
export default cosyteTsup({ entry: { index: "src/index.ts", "perf/index": "src/perf/index.ts" } });
