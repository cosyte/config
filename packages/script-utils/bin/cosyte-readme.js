#!/usr/bin/env node
// cosyte-readme: the README gate for the library in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-readme`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0.

import { runReadmeGate } from "../readme.js";

const HELP = `cosyte-readme: check a library README against the house skeleton and npm's size limit.

  cosyte-readme [--dir <package directory>]

It reads README.md and package.json. Exit 0 the README follows the skeleton, 1 a finding (each
names its line and rule), 2 the package could not be read.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else {
  process.exitCode = runReadmeGate({ argv: args });
}
