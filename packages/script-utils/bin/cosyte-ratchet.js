#!/usr/bin/env node
// cosyte-ratchet: the coverage and mutation ratchet over the repository's floor file.
// A bin of @cosyte/script-utils, so a repository with no package.json can run it with
// `npx -y -p @cosyte/script-utils cosyte-ratchet check`. It forwards every argument to the ratchet
// and exits with its code; `--help` prints what it does and exits 0, or 2 under CI.

import { runRatchet } from "../ratchet.js";
import { answerHelp } from "./help.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  let help = "";
  runRatchet({
    argv: ["--help"],
    cwd: process.cwd(),
    out: (text) => (help += text),
    err: () => {},
  });
  process.exitCode = answerHelp("cosyte-ratchet", help);
} else {
  process.exitCode = runRatchet({
    argv: args,
    cwd: process.cwd(),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
