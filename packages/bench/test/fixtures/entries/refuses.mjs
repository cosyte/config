import { writeFileSync } from "node:fs";

writeFileSync(process.argv[3], JSON.stringify({ ok: false, error: "the suite is not a suite" }));
process.exitCode = 2;
