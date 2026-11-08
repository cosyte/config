#!/usr/bin/env node
// cosyte-internal-refs: the internal-reference gate over the repository in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-internal-refs`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0, or 2 under CI.

import { runInternalRefsCli } from "../internal-refs.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-internal-refs: run the internal-reference gate over the repository in the working directory.

  cosyte-internal-refs [--config <path>]

It refuses internal bookkeeping on a public surface: item identifiers, phase and wave language, ADR
numbers, internal repo paths. The axes come from scripts/internal-refs.json (or --config). Exit 0
clean, 1 hits, 2 the gate could not run.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-internal-refs", HELP);
} else {
  process.exitCode = runInternalRefsCli(args);
}
