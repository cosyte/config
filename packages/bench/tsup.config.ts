import { cosyteTsup } from "@cosyte/tsup-config";

/**
 * tsup build for @cosyte/bench: ESM only, like @cosyte/process, because the surface is mostly a
 * bin Node runs directly.
 *
 * Four entries. `index` is the library, `cli` the `cosyte-bench` bin, and `child-entry` and
 * `import-entry` the measuring processes, which `spawn.ts` starts by their paths beside it in
 * `dist`, so their output names are load-bearing.
 */
export default cosyteTsup({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "child-entry": "src/child-entry.ts",
    "import-entry": "src/import-entry.ts",
  },
  format: ["esm"],
});
