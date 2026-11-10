// Prints 2 MiB to stdout before it answers, as a code under test that logs might. A pipe nobody
// reads fills at about 64 KiB and blocks the writer, so this only finishes when stdout is discarded.
import { writeFileSync } from "node:fs";

process.stdout.write("x".repeat(2 * 1024 * 1024));
writeFileSync(
  process.argv[3],
  JSON.stringify({ ok: true, result: { mode: "timing", chatty: true } }),
);
