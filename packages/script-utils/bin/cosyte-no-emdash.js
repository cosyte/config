#!/usr/bin/env node
// cosyte-no-emdash: the em and en dash gate over the repository in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-no-emdash`. The gate is the shell script beside this
// package's entry points; this runs it with bash, forwards every argument (`--help` included, which
// the gate answers itself) and exits with its code.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const gate = fileURLToPath(new URL("../check-no-emdash.sh", import.meta.url));
const run = spawnSync("bash", [gate, ...process.argv.slice(2)], { stdio: "inherit" });
if (run.error) {
  process.stderr.write(`cosyte-no-emdash: could not run bash ${gate}: ${run.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = run.status ?? 1;
}
