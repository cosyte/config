import { readFileSync } from "node:fs";

import { DEFAULT_NUM_RUNS, resolvePropertyRun } from "@cosyte/test-utils";
import { cosyteVitest } from "@cosyte/vitest-config";

/** The four coverage metrics the floor file holds. */
type CoverageFloor = Readonly<Record<"lines" | "branches" | "functions" | "statements", number>>;

/**
 * The coverage floor from `quality-floor.json`, the one place the number is written. A literal
 * threshold here would be a second copy that could disagree with the floor the ratchet holds.
 */
function coverageFloor(): CoverageFloor {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("./quality-floor.json", import.meta.url), "utf8"),
  );
  const coverage: unknown =
    typeof parsed === "object" && parsed !== null && "packages" in parsed
      ? (parsed.packages as Record<string, { coverage?: unknown } | undefined>)["."]?.coverage
      : undefined;
  if (typeof coverage !== "object" || coverage === null) {
    throw new Error('quality-floor.json has no coverage floor for the package "."');
  }
  const floor = coverage as Record<string, unknown>;
  const metric = (name: keyof CoverageFloor): number => {
    const value = floor[name];
    if (typeof value !== "number") throw new Error(`quality-floor.json has no ${name} floor`);
    return value;
  };
  return {
    lines: metric("lines"),
    branches: metric("branches"),
    functions: metric("functions"),
    statements: metric("statements"),
  };
}

/**
 * How many times deeper than a pull request this run takes every property: 1 by default, 100 when
 * a nightly run sets `COSYTE_PROPERTY_RUNS` to 10,000. A value that is not a whole number of cases
 * throws here, before any test runs.
 */
const propertyDepth = Math.max(1, resolvePropertyRun({}).numRuns / DEFAULT_NUM_RUNS);

/**
 * Vitest config for {{PKG}} from the shared @cosyte/vitest-config standard.
 *
 * Coverage is held to `quality-floor.json` for `src/`, and the shared standard gates each directory
 * in `coverageDirs` on top of it. Add a directory there as the parser grows (`builder`, say).
 */
export default cosyteVitest({
  coverageThresholds: coverageFloor(),
  coverageDirs: ["parser", "model", "serialize", "profiles", "arbitraries"],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // A deeper property run scales the ceiling with its depth, so a nightly run is not cut off by a
    // budget set for the cases a pull request runs.
    testTimeout: 10_000 * propertyDepth,
    hookTimeout: 10_000,
  },
});
