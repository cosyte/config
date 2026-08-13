import { describe, expect, it } from "vitest";

import { applyModifier, MODIFIERS_BY_VERB } from "../src/modifiers.js";
import { applyOverride } from "../src/overrides.js";
import { BASELINE, DELEGATED_VERBS, toArgv } from "../src/verbs.js";

/**
 * Term 4's baseline and token partition, and term 3's composition over it.
 *
 * These assert the EXACT argv, which is the only way "executes exactly that verb's baseline
 * invocation" can be checked: a green tool run proves the tool ran, not that it ran with the tokens
 * the contract names.
 */

describe("term 4: the baseline invocations", () => {
  it("emits build as `tsup`", () => {
    expect(toArgv(BASELINE.build)).toEqual(["tsup"]);
  });

  it("emits test as `vitest run`", () => {
    expect(toArgv(BASELINE.test)).toEqual(["vitest", "run"]);
  });

  it("emits lint as tool, flags, globs, in that order", () => {
    expect(toArgv(BASELINE.lint)).toEqual([
      "eslint",
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "src/**/*.ts",
      "scripts/**/*.ts",
      "test/**/*.ts",
    ]);
  });

  it("emits typecheck as `tsc --noEmit`", () => {
    expect(toArgv(BASELINE.typecheck)).toEqual(["tsc", "--noEmit"]);
  });

  it("emits format as tool, core, globs", () => {
    expect(toArgv(BASELINE.format)).toEqual([
      "prettier",
      "--write",
      "src/**/*.{ts,md}",
      "test/**/*.ts",
      "scripts/**/*.{ts,mjs}",
      "*.{json,md,yml}",
    ]);
  });

  it("partitions every verb into tool, core, flags and globs", () => {
    // The partition is normative for terms 3 and 7, so it is asserted directly rather than only
    // through the argv it produces.
    expect(BASELINE.build).toEqual({ tool: "tsup", core: [], flags: [], globs: [] });
    expect(BASELINE.test).toEqual({ tool: "vitest", core: ["run"], flags: [], globs: [] });
    expect(BASELINE.lint.core).toEqual([]);
    expect(BASELINE.lint.flags).toEqual(["--max-warnings=0", "--no-error-on-unmatched-pattern"]);
    expect(BASELINE.typecheck.core).toEqual(["--noEmit"]);
    expect(BASELINE.typecheck.flags).toEqual([]);
    expect(BASELINE.format.core).toEqual(["--write"]);
    expect(BASELINE.format.flags).toEqual([]);
  });
});

describe("term 3: modifier composition over the baseline", () => {
  it("`test --watch` swaps the core token run for watch", () => {
    expect(toArgv(applyModifier("--watch", BASELINE.test))).toEqual(["vitest", "watch"]);
  });

  it("`test --coverage` appends after the flag tokens, keeping `run`", () => {
    expect(toArgv(applyModifier("--coverage", BASELINE.test))).toEqual([
      "vitest",
      "run",
      "--coverage",
    ]);
  });

  it("`lint --fix` appends after the flag tokens, before the globs", () => {
    expect(toArgv(applyModifier("--fix", BASELINE.lint))).toEqual([
      "eslint",
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "--fix",
      "src/**/*.ts",
      "scripts/**/*.ts",
      "test/**/*.ts",
    ]);
  });

  it("`format --check` swaps the core token --write for --check", () => {
    expect(toArgv(applyModifier("--check", BASELINE.format))).toEqual([
      "prettier",
      "--check",
      "src/**/*.{ts,md}",
      "test/**/*.ts",
      "scripts/**/*.{ts,mjs}",
      "*.{json,md,yml}",
    ]);
  });

  it("does not mutate the baseline it composes over", () => {
    applyModifier("--fix", BASELINE.lint);
    applyModifier("--watch", BASELINE.test);
    expect(BASELINE.lint.flags).toEqual(["--max-warnings=0", "--no-error-on-unmatched-pattern"]);
    expect(BASELINE.test.core).toEqual(["run"]);
  });

  it("pairs exactly four modifiers with their verbs", () => {
    expect(MODIFIERS_BY_VERB).toEqual({
      build: [],
      test: ["--watch", "--coverage"],
      lint: ["--fix"],
      typecheck: [],
      format: ["--check"],
    });
  });
});

describe("term 7: an override replaces glob and flag tokens only", () => {
  it("replaces flags and keeps the tool and core tokens", () => {
    // The contract's own example: never `vitest --coverage`.
    const effective = applyOverride(BASELINE.test, { flags: ["--coverage"] });
    expect(toArgv(effective)).toEqual(["vitest", "run", "--coverage"]);
  });

  it("replaces globs and keeps the baseline flags when only globs are given", () => {
    const effective = applyOverride(BASELINE.lint, { globs: ["lib/**/*.ts"] });
    expect(toArgv(effective)).toEqual([
      "eslint",
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "lib/**/*.ts",
    ]);
  });

  it("replaces both when both are given", () => {
    const effective = applyOverride(BASELINE.lint, {
      flags: ["--max-warnings=5"],
      globs: ["lib/**/*.ts"],
    });
    expect(toArgv(effective)).toEqual(["eslint", "--max-warnings=5", "lib/**/*.ts"]);
  });

  it("keeps format's --write core token under a globs override", () => {
    const effective = applyOverride(BASELINE.format, { globs: ["docs/**/*.md"] });
    expect(toArgv(effective)).toEqual(["prettier", "--write", "docs/**/*.md"]);
  });

  it("leaves the baseline untouched for every verb when there is no override", () => {
    for (const verb of DELEGATED_VERBS) {
      expect(applyOverride(BASELINE[verb], undefined)).toEqual(BASELINE[verb]);
    }
  });
});

describe("terms 3 and 7 together: the modifier composes over the EFFECTIVE invocation", () => {
  it("`lint --fix` under a globs override fixes the overridden globs, not the baseline ones", () => {
    const effective = applyOverride(BASELINE.lint, { globs: ["lib/**/*.ts"] });
    expect(toArgv(applyModifier("--fix", effective))).toEqual([
      "eslint",
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "--fix",
      "lib/**/*.ts",
    ]);
  });

  it("`format --check` under a globs override still finds its core token", () => {
    const effective = applyOverride(BASELINE.format, { globs: ["docs/**/*.md"] });
    expect(toArgv(applyModifier("--check", effective))).toEqual([
      "prettier",
      "--check",
      "docs/**/*.md",
    ]);
  });

  it("`test --watch` under a flags override still finds its core token", () => {
    const effective = applyOverride(BASELINE.test, { flags: ["--reporter=dot"] });
    expect(toArgv(applyModifier("--watch", effective))).toEqual([
      "vitest",
      "watch",
      "--reporter=dot",
    ]);
  });

  it("`test --coverage` appends after an override's flags", () => {
    const effective = applyOverride(BASELINE.test, { flags: ["--reporter=dot"] });
    expect(toArgv(applyModifier("--coverage", effective))).toEqual([
      "vitest",
      "run",
      "--reporter=dot",
      "--coverage",
    ]);
  });
});
