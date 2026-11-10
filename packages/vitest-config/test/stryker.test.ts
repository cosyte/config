/**
 * The shared StrykerJS config. What it must hold: the Vitest runner found under pnpm, every
 * mutant kept (static ones too, which a PHI pattern table is made of), the JSON report at the path
 * the ratchet reads, and no score threshold of its own, so the floor file is the one rule.
 */

import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHANGED_REPORT,
  DEFAULT_MUTATE,
  FULL_REPORT,
  REPORT_DIR,
  cosyteStryker,
  htmlReportFor,
  resolveVitestRunner,
} from "../stryker.js";

describe("cosyteStryker", () => {
  it("returns the shared config", () => {
    const config = cosyteStryker();
    expect(config).toStrictEqual({
      testRunner: "vitest",
      plugins: [resolveVitestRunner()],
      coverageAnalysis: "perTest",
      mutate: [...DEFAULT_MUTATE],
      ignoreStatic: false,
      reporters: ["clear-text", "progress-append-only", "html", "json"],
      jsonReporter: { fileName: "reports/mutation/mutation.json" },
      htmlReporter: { fileName: "reports/mutation/mutation.html" },
      thresholds: { high: 100, low: 90, break: null },
      tempDirName: ".stryker-tmp",
      ignorePatterns: ["coverage", "reports", "dist"],
      vitest: { pool: "forks" },
    });
    expect(config.mutate).not.toBe(DEFAULT_MUTATE);
  });

  it("takes the files to mutate, a Vitest config, and any other option last", () => {
    const config = cosyteStryker({
      mutate: ["lib/*.js"],
      vitestConfig: "vitest.mutation.config.ts",
      stryker: { concurrency: 2, ignoreStatic: true },
    });
    expect(config.mutate).toEqual(["lib/*.js"]);
    expect(config.vitest).toEqual({ pool: "forks", configFile: "vitest.mutation.config.ts" });
    expect(config.concurrency).toBe(2);
    expect(config.ignoreStatic).toBe(true);
  });
});

describe("resolveVitestRunner", () => {
  it("resolves the installed runner to an absolute file", () => {
    const path = resolveVitestRunner();
    expect(isAbsolute(path)).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(path).toMatch(/@stryker-mutator[\\/]vitest-runner[\\/]/);
  });

  it("says what to install when the runner is missing", () => {
    const missing = () => {
      throw new Error("Cannot find package");
    };
    expect(() => resolveVitestRunner(missing)).toThrow(
      "@cosyte/vitest-config/stryker: @stryker-mutator/vitest-runner is not installed. Add it and @stryker-mutator/core as devDependencies.",
    );
    try {
      resolveVitestRunner(missing);
    } catch (error) {
      expect((error as Error).cause).toEqual(new Error("Cannot find package"));
    }
  });
});

describe("the report paths and the default mutate list", () => {
  it("are fixed, so the ratchet and CI can find them", () => {
    expect(REPORT_DIR).toBe("reports/mutation");
    expect(FULL_REPORT).toBe("reports/mutation/mutation.json");
    expect(CHANGED_REPORT).toBe("reports/mutation/changed.json");
    expect(htmlReportFor("a/b.json")).toBe("a/b.html");
    expect(htmlReportFor("a.json.json")).toBe("a.json.html");
    expect(DEFAULT_MUTATE).toEqual([
      "src/**/*.ts",
      "!src/**/*.test.ts",
      "!src/**/*.spec.ts",
      "!src/**/*.d.ts",
      "!src/**/index.ts",
      "!src/**/__fixtures__/**",
      "!src/**/generated/**",
    ]);
    expect(Object.isFrozen(DEFAULT_MUTATE)).toBe(true);
  });
});
