import { cosyteStryker } from "@cosyte/vitest-config/stryker";

// Mutation testing for @cosyte/test-utils, over `src/` with the shared defaults:
// `pnpm exec cosyte-mutate full` (or `changed --base <ref>`) from this directory.
export default cosyteStryker();
