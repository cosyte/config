#!/usr/bin/env node
// cosyte-agent-notes: the agent-notes checker for the repository in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-agent-notes`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0, or 2 under CI.

import { runAgentNotesCheck } from "../agent-notes.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-agent-notes: check a repository's agent notes and every pointer into them.

  cosyte-agent-notes [--dir <repository root>]

The notes are one file, documentation/agent-notes.md, and CLAUDE.md points into it as
documentation/agent-notes.md#<anchor>. Every pointer in a tracked file must name a heading or an
explicit anchor. Exit 0 clean, 1 a finding, 2 the check could not run.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-agent-notes", HELP);
} else {
  process.exitCode = runAgentNotesCheck({ argv: args });
}
