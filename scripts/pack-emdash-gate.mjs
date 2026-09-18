#!/usr/bin/env node
// scripts/pack-emdash-gate.mjs
//
// PUT THE CANONICAL EM-DASH GATE WHERE A CONSUMER CAN EXECUTE IT, WITHOUT TRACKING A SECOND COPY.
//
// `scripts/check-no-emdash.sh` is the ONE implementation of the em-dash gate for this estate, and
// eleven other repositories are to run THOSE EXACT BYTES rather than a fork of them. The route is
// the `@cosyte/script-utils` tarball: a consumer adds the package and runs
//
//     bash node_modules/@cosyte/script-utils/check-no-emdash.sh
//
// which needs the file to be INSIDE the package directory at pack time. This script is what puts it
// there.
//
// WHY THE PACKED COPY IS BUILD OUTPUT AND NOT A TRACKED FILE. The gate necessarily names the six
// encodings it bans, so any file carrying it carries the banned vocabulary. This repository tracks
// EXACTLY ONE such file and that file is the implementation; a tracked second copy would be a second
// place for the vocabulary to live, a second thing to keep in step, and the exact divergence this
// consolidation exists to end. `packages/script-utils/check-no-emdash.sh` is therefore gitignored,
// regenerated on every build, and byte-identical to its source by construction rather than by
// anyone's discipline. `--self-id` on either copy reports the same digest, which is how a consumer
// proves it at a distance.
//
// WHEN IT RUNS. `packages/script-utils` declares it as `build`, as `prepack` and as
// `prepublishOnly`, which are three independent routes to the same file: `pnpm run release` runs
// `pnpm run build` before `changeset publish`, `pnpm pack` and `npm publish` run `prepack` in the
// package directory, and `npm publish` runs `prepublishOnly` as well. A tarball missing this file
// would be a silent hole (npm omits a `files` entry that does not exist without saying so), so
// every route that produces a tarball has to fill it. `prepack` is the one that covers a bare
// `pnpm pack`, which is what a person reaches for to see what a consumer gets.
//
// ZERO IMPORTS, DELIBERATELY. It runs as `prepack` INSIDE the package it is packing, and a build
// step that imports from the tree it is assembling is one more ordering constraint for no gain.
//
// Exit codes, and they are a contract:
//   0  the packed copy is present and byte-identical to the implementation.
//   1  it is not, and the reason is named on stderr. Nothing partial is left behind.

import { chmodSync, copyFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS_DIR = import.meta.dirname;
const REPO_ROOT = join(SCRIPTS_DIR, "..");
const SOURCE = join(SCRIPTS_DIR, "check-no-emdash.sh");
const DESTINATION = join(REPO_ROOT, "packages", "script-utils", "check-no-emdash.sh");

/** Print a refusal that says what failed and what to do about it, then stop. */
function refuse(lines) {
  for (const line of lines) process.stderr.write(`${line}\n`);
  process.exit(1);
}

let source;
try {
  source = readFileSync(SOURCE);
} catch (error) {
  refuse([
    "ERROR: pack-emdash-gate - the em-dash gate could not be read, so the published copy cannot be",
    `       written: ${SOURCE}`,
    `       ${error instanceof Error ? error.message : String(error)}`,
    "       That file is the canonical implementation. Restore it before building or publishing.",
  ]);
}

if (source.length === 0) {
  refuse([
    "ERROR: pack-emdash-gate - the em-dash gate is empty, and an empty gate would exit 0 over every",
    `       repository that ran it: ${SOURCE}`,
    "       Refusing to publish a gate that checks nothing.",
  ]);
}

try {
  copyFileSync(SOURCE, DESTINATION);
  // The file is executed, so the bit that says so travels with it. npm preserves the executable bit
  // in a tarball, and a consumer invoking it through `bash <path>` does not need it; one invoking it
  // directly does, and the two invocations should not disagree about whether this works.
  chmodSync(DESTINATION, 0o755);
} catch (error) {
  refuse([
    "ERROR: pack-emdash-gate - the published copy could not be written:",
    `       ${DESTINATION}`,
    `       ${error instanceof Error ? error.message : String(error)}`,
    "       `packages/script-utils` must exist and be writable. Run this from a checkout of this",
    "       repository, not from an installed copy of the package.",
  ]);
}

// Assert the OUTCOME rather than trust the copy. A truncated write, a full disk or a stale file left
// by a previous interrupted run would otherwise ship as the gate, and a consumer comparing digests
// would be the first to find out.
const written = readFileSync(DESTINATION);
if (!written.equals(source)) {
  rmSync(DESTINATION, { force: true });
  refuse([
    "ERROR: pack-emdash-gate - the published copy does not match the implementation after writing",
    `       it: ${DESTINATION}`,
    `       source is ${source.length} byte(s), the copy read back as ${written.length}.`,
    "       The partial copy has been removed. Re-run the build; if it persists, check the disk.",
  ]);
}

const mode = statSync(DESTINATION).mode & 0o777;
process.stdout.write(
  `pack-emdash-gate: packages/script-utils/check-no-emdash.sh is ${written.length} byte(s), ` +
    `mode ${mode.toString(8)}, byte-identical to scripts/check-no-emdash.sh.\n`,
);
