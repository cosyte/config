#!/usr/bin/env node
// cosyte-mutate: StrykerJS with the shared config, over everything (`full`) or over the source
// files a change touched (`changed --base <ref>`). It exits with the run's own code: 0 the run
// finished, 2 it could not run. The score is judged by cosyte-ratchet, from @cosyte/script-utils.

import { runMutate } from "../mutate.js";

/**
 * Answer `--help` the way every Cosyte gate does: print it and exit 0 at a terminal; under CI
 * print it to stderr with a refusal and exit 2, because a CI step that only asks for help checks
 * nothing and must not pass.
 *
 * @param {string} help The help text.
 * @returns {number} The exit code.
 */
function answerHelp(help) {
  const ci = process.env.CI;
  if (ci === undefined || ci === "" || ci === "false" || ci === "0") {
    process.stdout.write(help);
    return 0;
  }
  process.stderr.write(help);
  process.stderr.write(
    `cosyte-mutate: refusing --help under CI (CI=${ci}). It prints this text and runs nothing, ` +
      "so a CI step that runs it must not pass.\n",
  );
  return 2;
}

const args = process.argv.slice(2);
const io = {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};
if (args.includes("--help") || args.includes("-h")) {
  let help = "";
  await runMutate({ ...io, argv: ["--help"], out: (text) => (help += text) });
  process.exitCode = answerHelp(help);
} else {
  process.exitCode = await runMutate({ ...io, argv: args });
}
