// The fixture build for test/tsup-plain-cjs-exports.test.ts. The test names the entry points in
// FIXTURE_ENTRIES (comma separated), whether to split in FIXTURE_SPLIT, and the output folder with
// tsup's own --out-dir.
import { cosyteTsup } from "@cosyte/tsup-config";

const entries = (process.env.FIXTURE_ENTRIES ?? "index,parse").split(",");

export default cosyteTsup({
  entry: Object.fromEntries(entries.map((name) => [name, `src/${name}.ts`])),
  splitting: process.env.FIXTURE_SPLIT !== "0",
  plainCjsExports: process.env.FIXTURE_PLAIN !== "0",
  dts: false,
  sourcemap: true,
  silent: true,
});
