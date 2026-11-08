#!/usr/bin/env node
// cosyte-attw: the attw publish gate for the package in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-attw`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0, or 2 under CI.

import { runAttwCli } from "../attw.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-attw: run the attw publish gate for the package in the working directory.

  cosyte-attw [--no-definitely-typed]

It runs this package's own node_modules/.bin/attw over the tarball npm would publish, with four
nets attw lacks. scripts/attw.exclude names the resolutions the package leaves out, one per line:
node10 selects attw's node16 profile, node10 with node16-cjs selects esm-only. Exit 0 every net
passed; attw's own status when attw judged the package; 1 a refusal.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-attw", HELP);
} else {
  process.exitCode = runAttwCli(args);
}
