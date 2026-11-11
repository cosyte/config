import { cosyteStryker } from "@cosyte/vitest-config/stryker";

// Mutation testing for @cosyte/script-utils. It runs from the repository root, not from this
// directory, because most of this package's tests live in the root suite:
//
//   pnpm exec cosyte-mutate full --config packages/script-utils/stryker.config.mjs
//
// The modules under mutation testing so far: the PHI-scan engine, which runs in every parser's
// commit gate, and the ratchet with the git reader it judges changes by. The other gates join as
// their floors are recorded.
//
// Static mutants are kept (the shared config ignores them): the engine's pattern tables are
// module-level code, and they are what it is made of.
export default cosyteStryker({
  mutate: [
    "packages/script-utils/phi-scan.js",
    "packages/script-utils/ratchet.js",
    "packages/script-utils/changes.js",
  ],
  vitestConfig: "packages/script-utils/vitest.mutation.config.ts",
  stryker: {
    jsonReporter: { fileName: "packages/script-utils/reports/mutation/mutation.json" },
    htmlReporter: { fileName: "packages/script-utils/reports/mutation/mutation.html" },
    ignoreStatic: false,
  },
});
