#!/usr/bin/env node
// script-utils: one entry for every gate in @cosyte/script-utils (D56). npx runs the bin named
// after the package, so `npx -y @cosyte/script-utils@<version> <command> [args]` reaches each gate
// from a repository with no package.json. `<command> --help` is the gate's own help; under CI
// every `--help` exits 2, because it checks nothing.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { answerHelp } from "./help.js";

const COMMANDS = {
  "no-emdash": ["cosyte-no-emdash", "the em and en dash gate, over tracked files and their names"],
  attw: ["cosyte-attw", "the attw publish gate, for the package here"],
  "phi-scan": ["cosyte-phi-scan", "the PHI commit-gate, over the repository here"],
  "internal-refs": [
    "cosyte-internal-refs",
    "the internal-reference gate, over the repository here",
  ],
  readme: ["cosyte-readme", "the README gate, for the library here"],
  "claude-card": ["cosyte-claude-card", "the CLAUDE.md card checker"],
  "agent-notes": ["cosyte-agent-notes", "the agent-notes checker, deprecated by D62"],
  catalog: ["cosyte-catalog", "the catalog check, for the library here"],
};

const HELP = `script-utils: run one of the @cosyte/script-utils gates over the working directory.

  script-utils <command> [arguments]
  script-utils <command> --help

${Object.entries(COMMANDS)
  .map(([command, [bin, what]]) => `  ${command.padEnd(14)} ${what} (also the bin ${bin})`)
  .join("\n")}
`;

const [command, ...rest] = process.argv.slice(2);
if (command === undefined) {
  process.stdout.write(HELP);
  process.exitCode = 2;
} else if (command === "--help" || command === "-h") {
  process.exitCode = answerHelp("script-utils", HELP);
} else if (!(command in COMMANDS)) {
  process.stderr.write(`script-utils: ${JSON.stringify(command)} is not a command.\n\n${HELP}`);
  process.exitCode = 2;
} else {
  const bin = fileURLToPath(new URL(`./${COMMANDS[command][0]}.js`, import.meta.url));
  const run = spawnSync(process.execPath, [bin, ...rest], { stdio: "inherit" });
  process.exitCode = run.error ? 2 : (run.status ?? 2);
}
