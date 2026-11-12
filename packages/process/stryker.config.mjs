import { cosyteStryker } from "@cosyte/vitest-config/stryker";

// Mutation testing for @cosyte/process, over `src/` with the shared defaults:
// `pnpm exec cosyte-mutate full` (or `changed --base <ref>`) from this directory.
//
// `disableTypeChecks` is narrowed to `src/`. Stryker's default also covers `test/`, so it wrote
// `// @ts-nocheck` into the sandbox copy of every fixture consumer's source, and the e2e test that
// formats `test/fixtures/unformatted/src/messy.ts` then failed the initial run whenever a change
// reached a file it imports.
export default cosyteStryker({
  stryker: { disableTypeChecks: "src/**/*.{js,ts,jsx,tsx,html,vue,cts,mts}" },
});
