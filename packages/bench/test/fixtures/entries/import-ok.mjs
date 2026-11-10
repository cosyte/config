// Stands in for the cold import process: `[mode, target, out]`. It reports a fixed time for the
// target and for the empty module, appends each timed import's target to BENCH_IMPORT_LOG when that
// is set, and in files mode reports the target and a source file whose gzip size depends on the
// level, out of order.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [mode, target, out] = process.argv.slice(2);
// A module that is not there cannot be imported: answer nothing, as the real process would fail.
if (!existsSync(target)) process.exit(1);
const empty = target.endsWith("empty.mjs");
if (mode === "time" && process.env.BENCH_IMPORT_LOG) {
  appendFileSync(process.env.BENCH_IMPORT_LOG, `${empty ? "empty" : "target"}\n`);
}
writeFileSync(
  out,
  JSON.stringify(
    mode === "time"
      ? { ms: empty ? 0.25 : 2.5 }
      : { files: [target, join(dirname(target), "..", "..", "src", "results.ts")] },
  ),
);
