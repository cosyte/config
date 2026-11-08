#!/usr/bin/env node
// cosyte-agent-notes: the agent-notes checker for the repository in the working directory.
// Deprecated (D62): the agent notes were removed from every repository, so it passes a repository
// with no notes file, and stays only until a minor release removes it.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-agent-notes`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0, or 2 under CI.

import { runAgentNotesCheck } from "../agent-notes.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-agent-notes: deprecated (D62). Remove the step that runs it.

  cosyte-agent-notes [--dir <repository root>]

The agent notes, documentation/agent-notes.md, were removed from every Cosyte repository on
2026-11-08 (D62). A CLAUDE.md card stands on its own, and what does not fit on it goes where it is
used: a test, a comment at the code it guards, an ADR, the README or docs, or a runbook
(documentation/claude-card.md in cosyte/config).

Until a minor release removes this bin, a repository with no documentation/agent-notes.md passes
with one line, "no agent notes (retired, D62)", whatever still points at the file. One that still
has the file is checked as before: every documentation/agent-notes.md#<anchor> pointer in a tracked
file must name a heading or an explicit anchor. Exit 0 clean, 1 a finding, 2 the check could not
run.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-agent-notes", HELP);
} else {
  process.exitCode = runAgentNotesCheck({ argv: args });
}
