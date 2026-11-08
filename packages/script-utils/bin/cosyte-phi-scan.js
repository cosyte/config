#!/usr/bin/env node
// cosyte-phi-scan: the PHI commit-gate over the repository in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-phi-scan`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0.

import { runPhiScanCli } from "../phi-scan.js";

const HELP = `cosyte-phi-scan: run the PHI commit-gate over the repository in the working directory.

  cosyte-phi-scan                 scan the whole repository
  cosyte-phi-scan --staged        scan what is staged, Markdown excepted (the pre-commit route)
  cosyte-phi-scan <path>...       scan these paths

It carries the cross-cutting floor (a dashed SSN shape, an email at an undeclared domain) and
reports a place and a rule, never the matched value. scripts/phi-allow-list.txt declares synthetic
values, and scripts/phi-scan.exclude names literal tracked paths to leave out. Exit 0 clean, 1 hits,
2 the scan could not account for something.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else {
  process.exitCode = runPhiScanCli(args);
}
