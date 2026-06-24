import { describe, expect, it } from "vitest";

import cosyteEslint from "@cosyte/eslint-config";
import prettierConfig from "@cosyte/prettier-config";
import tsconfigBase from "@cosyte/tsconfig/base.json";
import tsconfigLibrary from "@cosyte/tsconfig/library.json";
import { cosyteTsup } from "@cosyte/tsup-config";
import { cosyteVitest } from "@cosyte/vitest-config";

// Smoke tests: every exported config loads and encodes the ratified cosyte standard.
// This is the config repo "dogfooding" itself — if a config fails to import or drifts off the
// standard, CI fails here.

describe("@cosyte/eslint-config", () => {
  it("returns a non-empty flat config array", () => {
    const cfg = cosyteEslint(import.meta.dirname);
    expect(Array.isArray(cfg)).toBe(true);
    expect(cfg.length).toBeGreaterThan(0);
  });
});

describe("@cosyte/tsup-config", () => {
  it("builds dual ESM + CJS at ES2023 and honors overrides", () => {
    const cfg = cosyteTsup({ entry: ["src/index.ts"] });
    const obj = Array.isArray(cfg) ? cfg[0] : cfg;
    expect(obj?.format).toEqual(["esm", "cjs"]);
    expect(obj?.target).toBe("es2023");
    expect(obj?.dts).toBe(true);
    expect(obj?.entry).toEqual(["src/index.ts"]);
  });
});

describe("@cosyte/vitest-config", () => {
  it("sets enabled, gating per-directory >=90 thresholds", () => {
    const cfg = cosyteVitest({ coverageDirs: ["parser"] });
    const thresholds = cfg.test?.coverage?.thresholds as Record<string, unknown>;
    expect(thresholds?.lines).toBe(90);
    expect(thresholds?.branches).toBe(90);
    expect(thresholds?.["src/parser/**"]).toEqual({
      lines: 90,
      branches: 90,
      functions: 90,
      statements: 90,
    });
  });
});

describe("@cosyte/prettier-config", () => {
  it("uses the cosyte house style", () => {
    expect(prettierConfig.printWidth).toBe(100);
    expect(prettierConfig.singleQuote).toBe(false);
    expect(prettierConfig.semi).toBe(true);
    expect(prettierConfig.trailingComma).toBe("all");
  });
});

describe("@cosyte/tsconfig", () => {
  it("base is strict, ES2023, NodeNext with the full rigor set", () => {
    const o = tsconfigBase.compilerOptions;
    expect(o.target).toBe("ES2023");
    expect(o.module).toBe("NodeNext");
    expect(o.strict).toBe(true);
    expect(o.noUncheckedIndexedAccess).toBe(true);
    expect(o.exactOptionalPropertyTypes).toBe(true);
    expect(o.noPropertyAccessFromIndexSignature).toBe(true);
  });

  it("library extends base and emits declarations", () => {
    expect(tsconfigLibrary.extends).toBe("./base.json");
    expect(tsconfigLibrary.compilerOptions.declaration).toBe(true);
  });
});
