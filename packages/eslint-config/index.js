import eslint from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config for `@cosyte/*` packages.
 *
 * ESLint 10 + unified `typescript-eslint` (`recommendedTypeChecked`), hardened with the cosyte
 * guardrails: no `any`, no unjustified casts, JSDoc + `@example` on public exports, no `console.*`
 * in library code. Tests and build scripts relax the JSDoc/console rules.
 *
 * @param {string} tsconfigRootDir - The consumer's package root; pass `import.meta.dirname`.
 * @param {{ ignores?: string[], files?: string[] }} [opts] - Optional extra `ignores`, or a `files`
 *   override for which globs the type-checked rules apply to (defaults to src/test/scripts/configs).
 * @returns {import("typescript-eslint").ConfigArray} The flat config array.
 * @example
 * // eslint.config.js
 * import cosyte from "@cosyte/eslint-config";
 * export default cosyte(import.meta.dirname);
 */
export default function cosyteConfig(tsconfigRootDir, opts = {}) {
  const files = opts.files ?? ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "*.config.ts"];

  return tseslint.config(
    {
      ignores: [
        "dist/**",
        "coverage/**",
        "node_modules/**",
        "*.config.js",
        ...(opts.ignores ?? []),
      ],
    },
    {
      files,
      extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: { jsdoc },
      rules: {
        // --- No any, no unjustified casts ---
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/consistent-type-assertions": [
          "error",
          { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
        ],
        "@typescript-eslint/no-non-null-assertion": "error",

        // --- Strictness ---
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/switch-exhaustiveness-check": "error",

        // --- No console in library code ---
        "no-console": "error",

        // --- JSDoc + @example on public exports ---
        "jsdoc/require-jsdoc": [
          "error",
          {
            publicOnly: true,
            require: {
              ArrowFunctionExpression: true,
              ClassDeclaration: true,
              ClassExpression: true,
              FunctionDeclaration: true,
              FunctionExpression: true,
              MethodDefinition: true,
            },
            contexts: [
              "ExportNamedDeclaration > VariableDeclaration",
              "ExportNamedDeclaration > TSTypeAliasDeclaration",
              "ExportNamedDeclaration > TSInterfaceDeclaration",
              "ExportNamedDeclaration > TSEnumDeclaration",
            ],
          },
        ],
        "jsdoc/require-example": [
          "error",
          {
            contexts: [
              "ExportNamedDeclaration > VariableDeclaration",
              "ExportNamedDeclaration > FunctionDeclaration",
              "ExportNamedDeclaration > ClassDeclaration",
            ],
            exemptedBy: ["internal", "private"],
          },
        ],
        "jsdoc/check-tag-names": [
          "error",
          { definedTags: ["internal", "remarks", "packageDocumentation", "module", "typeParam"] },
        ],

        // --- General safety ---
        eqeqeq: ["error", "always"],
        "no-var": "error",
        "prefer-const": "error",

        // Byte-protocol parsers legitimately match control characters in regexes
        // (HL7/MLLP/X12 delimiters: VT \x0b, FS \x1c, CR \x0d, …). This rule is noise here.
        "no-control-regex": "off",
      },
      settings: {
        jsdoc: { mode: "typescript" },
      },
    },

    // Tests + build scripts don't need JSDoc/@example.
    {
      files: ["test/**/*.ts", "scripts/**/*.ts"],
      rules: {
        "jsdoc/require-jsdoc": "off",
        "jsdoc/require-example": "off",
      },
    },

    // Build scripts may log.
    {
      files: ["scripts/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },

    // eslint-config-prettier MUST be last — turns off formatting-conflicting rules.
    prettierConfig,
  );
}
