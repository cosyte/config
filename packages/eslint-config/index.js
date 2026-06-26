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
 * The type-safety guardrails (no `any`, no unjustified casts, exhaustiveness, strict imports) apply
 * to **every** consumer. The documentation-surface guardrails — the JSDoc + `@example` gate and
 * `no-console` — are *library* defaults: a published `@cosyte/*` package owes its callers documented,
 * `console`-free public exports. Applications (e.g. the `pathways` engine) are first-class consumers
 * too, but they have no published API surface to document and legitimately log, so they opt out with
 * `{ library: false }`. Everything else — strictness, type-checking, Prettier interop — is identical.
 *
 * @param {string} tsconfigRootDir - The consumer's package root; pass `import.meta.dirname`.
 * @param {{ ignores?: string[], files?: string[], library?: boolean }} [opts] - Optional extra
 *   `ignores`; a `files` override for which globs the type-checked rules apply to (defaults to
 *   src/test/scripts/configs); and `library` (default `true`) — set `false` for an application to
 *   drop the JSDoc/`@example` gate and `no-console`, keeping every type-safety rule.
 * @returns {import("typescript-eslint").ConfigArray} The flat config array.
 * @example
 * // eslint.config.js — a published @cosyte/* library (the default)
 * import cosyte from "@cosyte/eslint-config";
 * export default cosyte(import.meta.dirname);
 * @example
 * // eslint.config.js — an application (no public API to document, may log)
 * import cosyte from "@cosyte/eslint-config";
 * export default cosyte(import.meta.dirname, { library: false });
 */
export default function cosyteConfig(tsconfigRootDir, opts = {}) {
  const files = opts.files ?? ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "*.config.ts"];
  const library = opts.library ?? true;

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

    // --- Library-only documentation-surface gates ---
    // A published @cosyte/* package owes its callers documented, console-free public exports.
    // Applications opt out with `{ library: false }` (they have no published API and may log).
    ...(library
      ? [
          {
            files,
            rules: {
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
                {
                  definedTags: [
                    "internal",
                    "remarks",
                    "packageDocumentation",
                    "module",
                    "typeParam",
                  ],
                },
              ],
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
        ]
      : []),

    // eslint-config-prettier MUST be last — turns off formatting-conflicting rules.
    prettierConfig,
  );
}
