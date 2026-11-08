#!/usr/bin/env node
// cosyte-claude-card: the CLAUDE.md card checker for the repository in the working directory.
// A bin of @cosyte/script-utils (D56), so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-claude-card`. It forwards every argument to the gate and exits with
// the gate's own code; `--help` prints what it does and exits 0.

import { runClaudeCardGate } from "../claude-card.js";

const HELP = `cosyte-claude-card: check a repository's CLAUDE.md against the card spec.

  cosyte-claude-card [--dir <repository root>]

Gate, Hazard and Rules in order, at most 60 lines of at most 100 characters and 5,120 bytes, and an
@AGENTS.md import when an AGENTS.md sits beside it. Exit 0 the card follows the spec, 1 a finding,
2 CLAUDE.md could not be read.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else {
  process.exitCode = runClaudeCardGate({ argv: args });
}
