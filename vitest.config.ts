import { defineConfig } from "vitest/config";

// Plain config: this repo ships configs, not library source, so there is nothing to gate coverage on.
// The smoke tests in test/ assert each exported config is valid and encodes the cosyte standard.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // `test/no-network.setup.ts` is NOT a `*.test.ts` and so is not collected as a suite; it runs
    // before each file and makes "this suite reaches no network" a refusal rather than a habit.
    // `pnpm test` is the required check, and a required check that can fail on a rate limit is a
    // gate about somebody else's uptime. See that file for what it does and does not block.
    setupFiles: ["test/no-network.setup.ts"],
  },
});
