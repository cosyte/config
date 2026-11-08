import { cosyteVitest } from "@cosyte/vitest-config";

// The shared config, from this workspace's own packages/vitest-config. Its coverage block (v8, the
// >= 90 gates) is inert here: the root never runs `--coverage`, because this repo ships configs and
// gates, not library source under `src/`, so there is nothing to gate coverage on. Each package
// runs its own suite, and its own coverage, from its own directory.
export default cosyteVitest({
  test: {
    // Root-specific: the suites live in test/, and `test/fixtures/` holds data, not suites.
    include: ["test/**/*.test.ts"],
    // `test/no-network.setup.ts` is NOT a `*.test.ts` and so is not collected as a suite; it runs
    // before each file and makes "this suite reaches no network" a refusal rather than a habit.
    // `pnpm test` is the required check, and a required check that can fail on a rate limit is a
    // gate about somebody else's uptime. See that file for what it does and does not block.
    setupFiles: ["test/no-network.setup.ts"],
  },
});
