import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/process.
 *
 * ESM only, against the shared @cosyte/tsup-config baseline. The contract (term 1) specifies an ESM
 * package, and the only consumer-facing entry point is a bin that Node runs directly, so a CJS half
 * would ship a second copy of the CLI that nothing can call.
 *
 * Three entries: `index` is the programmatic surface (the baseline table, the override loader, the
 * wiring check), `cli` is the `cosyte-process` bin, and `docs-reference` is the
 * `cosyte-docs-reference` bin. Each bin is a separate entry rather than a shebang on the library
 * entry so that importing the package does not run an argv parser.
 */
export default cosyteTsup({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "docs-reference": "src/docs-reference-cli.ts",
  },
  format: ["esm"],
});
