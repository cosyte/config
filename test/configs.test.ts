import { describe, expect, it } from "vitest";

import cosyteEslint from "@cosyte/eslint-config";
import prettierConfig from "@cosyte/prettier-config";
import tsconfigBase from "@cosyte/tsconfig/base.json";
import tsconfigLibrary from "@cosyte/tsconfig/library.json";
import { cosyteTsup } from "@cosyte/tsup-config";
import { cosyteVitest } from "@cosyte/vitest-config";

// Smoke tests: every exported config loads and encodes the ratified Cosyte standard.
// This is the config repo "dogfooding" itself: if a config fails to import or drifts off the
// standard, CI fails here.

describe("@cosyte/eslint-config", () => {
  it("returns a non-empty flat config array", () => {
    const cfg = cosyteEslint(import.meta.dirname);
    expect(Array.isArray(cfg)).toBe(true);
    expect(cfg.length).toBeGreaterThan(0);
  });

  it("library mode (default) enables the JSDoc + no-console gate", () => {
    const cfg = cosyteEslint(import.meta.dirname);
    const hasDocGate = cfg.some((block) =>
      block.rules?.["jsdoc/require-jsdoc"] === "off"
        ? false
        : block.rules?.["jsdoc/require-jsdoc"] != null || block.rules?.["no-console"] === "error",
    );
    expect(hasDocGate).toBe(true);
  });

  it("app mode ({ library: false }) drops the JSDoc + no-console gate but keeps type safety", () => {
    const cfg = cosyteEslint(import.meta.dirname, { library: false });
    // No block turns the doc-surface gates on.
    const docGateOn = cfg.some(
      (block) =>
        block.rules?.["jsdoc/require-jsdoc"] === "error" ||
        block.rules?.["jsdoc/require-example"] === "error" ||
        block.rules?.["no-console"] === "error",
    );
    expect(docGateOn).toBe(false);
    // Type-safety guardrails still present.
    const noAnyOn = cfg.some(
      (block) => block.rules?.["@typescript-eslint/no-explicit-any"] === "error",
    );
    expect(noAnyOn).toBe(true);
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
  it("accepts Vitest 4 and 5, with the coverage provider on the same major", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(new URL("../packages/vitest-config/package.json", import.meta.url), "utf8"),
    ) as { peerDependencies: Record<string, string> };
    expect(manifest.peerDependencies["vitest"]).toBe("^4.0.0 || ^5.0.0");
    expect(manifest.peerDependencies["@vitest/coverage-v8"]).toBe(
      manifest.peerDependencies["vitest"],
    );
  });

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

  it("writes the json-summary and lcov reports the coverage ratchet reads", () => {
    const coverage = cosyteVitest().test?.coverage as {
      reporter: string[];
      reportsDirectory: string;
    };
    expect(coverage.reporter).toEqual(["text", "html", "lcov", "json-summary"]);
    expect(coverage.reportsDirectory).toBe("./coverage");
  });

  it("leaves out of coverage only the files that hold nothing but re-exports", async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { dirname, join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "configs-barrels-"));
    try {
      const files: Record<string, string> = {
        "src/index.ts": 'export * from "./parser/index.js";\nexport type { T } from "./t.js";\n',
        "src/parser/index.ts":
          'import { tokenize } from "./tokenize.js";\nexport { tokenize };\n' +
          "export function parse(text: string): string[] {\n  return tokenize(text);\n}\n",
        "src/profiles/index.ts": 'import { a } from "./a.js";\nexport const all = [a];\n',
        "src/model/all.ts": 'export * from "./message.js";\n',
      };
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      const coverage = cosyteVitest({ root: dir }).test?.coverage as { exclude: string[] };
      expect(coverage.exclude).toEqual([
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.d.ts",
        "**/__fixtures__/**",
        "**/generated/**",
        "src/index.ts",
        "src/model/all.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("@cosyte/prettier-config", () => {
  it("uses the Cosyte house style", () => {
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
