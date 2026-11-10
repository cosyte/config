#!/usr/bin/env node
// cosyte-phi-scan: the PHI commit-gate over the repository in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-phi-scan`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0, or 2 under CI.

import { runPhiScanCli } from "../phi-scan.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-phi-scan: run the PHI commit-gate over the repository in the working directory.

  cosyte-phi-scan                 scan the whole repository
  cosyte-phi-scan --staged        scan what is staged, Markdown excepted (the pre-commit route)
  cosyte-phi-scan <path>...       scan these paths

  --allow-list <path>             use this allow list instead of scripts/phi-allow-list.txt;
                                  it goes with any of the three forms above

It carries the cross-cutting floor (a dashed SSN shape, an email at an undeclared domain) and
reports a place and a rule, never the matched value. scripts/phi-allow-list.txt declares synthetic
values, and scripts/phi-scan.exclude names literal tracked paths to leave out. Without that allow
list the scan refuses, unless --allow-list names another: an empty file there scans a repository
that keeps no list with no exceptions. A path --allow-list names that does not exist or cannot be
read refuses. Exit 0 clean, 1 hits, 2 the scan could not account for something.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-phi-scan", HELP);
} else {
  process.exitCode = runPhiScanCli(args);
}
