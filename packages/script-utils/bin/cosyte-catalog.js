#!/usr/bin/env node
// cosyte-catalog: the catalog check for the library in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-catalog`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0, or 2 under CI.

import { runCatalogCheck } from "../catalog.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-catalog: check that a library's package.json description is the catalog's.

  cosyte-catalog [--dir <package directory>] [--strict]

The catalog is the one list of our libraries, generated in cosyte/config, which keeps it fresh
against npm. This check is advisory: exit 0 when the description is the catalog's, and 0 with both
values printed when it is not or the package is unlisted; 2 when package.json cannot be read. With
--strict a disagreement exits 1 and an unlisted package 2.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-catalog", HELP);
} else {
  process.exitCode = runCatalogCheck({ argv: args });
}
