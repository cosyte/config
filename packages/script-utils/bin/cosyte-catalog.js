#!/usr/bin/env node
// cosyte-catalog: the catalog check for the library in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-catalog`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0.

import { runCatalogCheck } from "../catalog.js";

const HELP = `cosyte-catalog: check that a library's package.json description is the catalog's.

  cosyte-catalog [--dir <package directory>]

The catalog is the one list of our libraries, generated in cosyte/config from each package.json.
Exit 0 the description is the catalog's, 1 it is not (both values printed), 2 the package is not
listed or package.json cannot be read.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else {
  process.exitCode = runCatalogCheck({ argv: args });
}
