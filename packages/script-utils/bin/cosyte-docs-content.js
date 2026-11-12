#!/usr/bin/env node
// cosyte-docs-content: the docs-content structure check for the repository in the working directory.
// It forwards every argument to the check and exits with the check's own code; `--help` prints what
// it does and exits 0, or 2 under CI.

import { runDocsContentCheck } from "../docs-content.js";
import { answerHelp } from "./help.js";

const HELP = `cosyte-docs-content: check docs-content/ against the docs-content standard.

  cosyte-docs-content [--dir <repository root>] [--write]

It reads docs-content/ and checks the shape the standard gives it: one "docs" sidebar that opens
with "intro", then the categories Installation, Quickstart, Tutorials, How-to guides, Examples,
Explanation, Reference and Troubleshooting in that order (Tutorials, Examples and Reference only
when a library has them),
then the pages "testing-and-quality" and "performance". Every page is listed once, every listed id
is a page, the required pages exist, every page opens with front matter carrying id (the file
name), title, sidebar_label and description (at most 160 characters), page names are lower-case
and hyphenated, and both quality pages carry a "## Current numbers" section.

It also reads whether each page holds what its kind asks, the kind being its sidebar category: a
how-to guide's title begins with an imperative verb and it has no How, Why or alternatives heading;
an explanation has no settings table and no numbered H2; a tutorial's H2s are numbered steps ending
in "What you built" and "Next"; the one limitations page is in Reference; a page id shares a word
with its title; a configuration or command reference names its generator or test in "held_by". A
library's findings under these are held at the counts docs-content-ratchet.json records for it
(the name in package.json), which only fall. A measured number outside "Current numbers" is a
warning and never fails.

Each runnable example at the top of examples/ (a .ts, .mts, .js or .mjs file whose name does not
begin with _ or ., and is not a .d.ts, a test or a *.config.* file) has a page,
docs-content/example-<name>.md, listed under Examples, with the H2 headings "What it shows", "Run
it", "Expected output" (holding a fenced block) and "Code", in that order. The Code section runs to
the end of the page and is the example's file: --write writes it from the file before the check
runs, and without --write a Code section that differs from the file is a finding. --write never
creates a page; what an example shows, how to run it and what it prints are written by hand.

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
