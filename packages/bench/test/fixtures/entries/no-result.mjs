import { writeFileSync } from "node:fs";

writeFileSync(process.argv[3], JSON.stringify({ ok: true }));
