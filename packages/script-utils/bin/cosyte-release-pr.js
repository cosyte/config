#!/usr/bin/env node
// cosyte-release-pr: the release pull request check for the library in the working directory.
// It forwards every argument to the check and exits with the check's own code; `--help` prints what
// it does and exits 0, or 2 under CI.

import { runReleasePrCheck } from "../release-pr.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-release-pr: check that a release pull request made from this tree passes its own checks.

  cosyte-release-pr [--dir <package root>]

When src/ declares an exported VERSION, it reads two things the Version Packages pull request
needs. The "version" script runs \`changeset version\`, then the VERSION sync
(\`cosyte-process sync-version\`), then \`cosyte-docs-reference\` without --check, in that order, so
the API reference that prints VERSION is regenerated in the same commit. And one test file pins
VERSION where the mutation run can link it: it has no static import of the source, calls
\`vi.resetModules()\`, imports the source inside the test body and compares VERSION with
package.json's version.

On every package it reads each pending changeset under .changeset/: its opening sentence becomes a
release bullet, and the release refuses one over 400 characters after the Version Packages pull
request has merged. A changeset with no front matter, or one that releases a package with no
summary, is refused too.

Exit 0 clean, 1 a finding (each names its file and rule), 2 the package could not be read.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-release-pr", HELP);
} else {
  process.exitCode = runReleasePrCheck({ argv: args });
}
