#!/usr/bin/env node
// cosyte-docs-content: the docs-content structure check for the repository in the working directory.
// It forwards every argument to the check and exits with the check's own code; `--help` prints what
// it does and exits 0, or 2 under CI.

import { runDocsContentCheck } from "../docs-content.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-docs-content: check docs-content/ against the docs-content standard.

  cosyte-docs-content [--dir <repository root>]

It reads docs-content/ and checks the shape the standard gives it: one "docs" sidebar that opens
with "intro", then the categories Installation, Quickstart, Tutorials, How-to guides, Explanation,
Reference and Troubleshooting in that order (Tutorials and Reference only when a library has them),
then the pages "testing-and-quality" and "performance". Every page is listed once, every listed id
is a page, the required pages exist, every page opens with front matter carrying id (the file
name), title, sidebar_label and description (at most 160 characters), page names are lower-case
and hyphenated, and both quality pages carry a "## Current numbers" section.

It does not read links (the shared CI's docs-content link check does), the generated pages under
api/ (cosyte-docs-reference checks those), or whether a sample runs (the sample runner in
@cosyte/vitest-config does). Exit 0 clean, 1 a finding, 2 the check could not run.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.exitCode = answerHelp("cosyte-docs-content", HELP);
} else {
  process.exitCode = runDocsContentCheck({ argv: args });
}
