#!/usr/bin/env node
/**
 * scripts/attw.mjs: the `attw` publish gate, made to report its own failure.
 *
 * WHY THIS WRAPPER EXISTS. `attw` PRINTS "This package does not contain types."
 * AND EXITS 0. That is not a bug in `attw`: an untyped package is a legitimate
 * npm package, so the CLI treats "no types at all" as a *description*, not a
 * problem. From `@arethetypeswrong/cli@0.18.4`,
 * `node_modules/@arethetypeswrong/cli/dist/getExitCode.js`, first statement:
 *
 *     export function getExitCode(analysis, opts) {
 *         if (!analysis.types) {
 *             return 0;
 *         }
 *
 * The problem list is consulted only *after* that early return, so no
 * `--profile`, `--ignore-rules` or config setting can reach it. For a package
 * that ships types, "does not contain types" does not mean "fine, untyped": it
 * means THE TYPES WERE NOT IN THE TARBALL, which is a broken publish. The gate
 * says nothing, and its caller reads the 0. A false red costs an hour. A FALSE
 * GREEN MERGES.
 *
 * REPRODUCED HERE, ON THIS REPO'S OWN PACKAGE, WITH ZERO CONCURRENCY. Against
 * `@cosyte/test-utils` at `0.0.2`, on a quiet box, both states print the untyped
 * sentence and exit 0:
 *
 *     rm -f dist/index.d.ts dist/index.d.cts && attw --pack .   -> exit 0
 *     rm -rf dist && attw --pack .                              -> exit 0
 *
 * CONCURRENCY SUPPLIES THE CONDITION AND IS NOT THE DEFECT, WHICH IS WHY THE
 * ANSWER IS NOT A LOCK, A LEASE OR A BUILD QUEUE. `tsup` emits JS in one pass
 * and the declaration files in a later pass, so there is a window in every build
 * where `dist/` holds `.mjs`/`.cjs` and no `.d.ts`. Polling clean `tsup` runs on
 * this package, the JS landed first in EVERY run measured (12 of 12, across two
 * independent sets).
 *
 * DO NOT PIN A WIDTH HERE, NOT EVEN A RANGE. Two measurement sets on the same
 * idle box disagreed about the spread, and an earlier draft of this comment
 * quoted a range that the next set did not reproduce. The load-bearing fact is
 * the ORDER (JS, then declarations); the width is whatever the box was doing.
 * Anything that lands `attw` inside that window (a concurrent build, a
 * `pnpm clean`, a half-finished build) gets the false green, and a gate has to be
 * able to say its own inputs were missing, whatever removed them.
 *
 * TWO NETS, AND THEY CATCH DIFFERENT THINGS. Keep both.
 *
 *   1. PREFLIGHT (structural, no string matching). Every relative artifact path
 *      `package.json` promises (`main`, `module`, `types`, `typings`, and every
 *      string leaf of `exports`) must exist and be non-empty before `attw` runs.
 *      This is the one that catches the window above, and it names the missing
 *      file instead of leaving the reader to infer it.
 *
 *   2. POST-CHECK. If `attw` still reports an untyped package, fail. The
 *      preflight cannot see this case: the declaration files can be present on
 *      disk and still be absent from the tarball, because `files` (or
 *      `.npmignore`) left them out. That is the case `attw --pack` exists to
 *      catch, and the whole point here is that it catches it silently.
 *
 *   The post-check matches `attw`'s untyped sentence, which is a plain,
 *   un-chalked string in `dist/render/untyped.js`. That makes it blindable, so
 *   the arguments and config that would blind it are REFUSED rather than
 *   tolerated. See BLINDING below.
 *
 * BLINDING. These routes were measured on this repo to restore the exact false
 * green, each by making the untyped sentence absent from what this script can
 * read. Against the same untyped pack, each exits 0 with the sentence gone:
 * `--quiet`, `--format json`, its ATTACHED SHORT FORM `-fjson`, and a
 * `.attw.json` setting either (`readConfig()` calls
 * `setOptionValueWithSource(..., "config")` inside the command action, AFTER
 * argv is parsed, so the file beats the flag).
 *
 * `--config-path` IS REFUSED FOR A DIFFERENT AND WEAKER REASON, AND THE
 * DISTINCTION IS NOT PEDANTRY. On its own it blinds NOTHING: pointed at a file
 * that does not exist, the untyped sentence still prints (measured). What it
 * does is choose WHICH file `readConfig()` applies, so pointed at one that sets
 * `quiet` it blinds exactly like `.attw.json` does (also measured). It is
 * refused because this script cannot check a file whose path it is being told to
 * ignore, not because the flag alone is dangerous. An upstream copy of this
 * comment recorded the refusal as inferred rather than measured; both halves
 * above are measured here, and neither says the flag blinds by itself.
 *
 * SHORT OPTIONS ARE MATCHED PER CHARACTER, NOT PER TOKEN, AND THAT IS THE WHOLE
 * POINT. Commander accepts an attached value (`-fjson`) and a cluster (`-Pq`),
 * so an exact-token set containing `-f` and `-q` lets BOTH straight through.
 * `-fjson` was measured handing back exit 0 over an untyped pack through an
 * earlier draft of this very guard. attw's short options are `-P/--pack`,
 * `-f/--format`, `-p/--from-npm` and `-q/--quiet`, so refusing any cluster
 * containing `f` or `q` refuses nothing legitimate: `-P` and `-p` still pass.
 *
 * THE REFUSAL IS BY OPTION, WHOLESALE, NOT BY VALUE. `--format table-flipped`
 * was measured to still print the sentence, so it blinds nothing, and it is
 * refused anyway. That is the deliberate trade: value-parsing these would be a
 * third moving part in the guard, and being over-strict about an argument nobody
 * passes to a repo's own publish gate costs less than a route back to a false
 * green.
 *
 * Other arguments are forwarded, so `--profile node16` and friends still work.
 *
 * THIS FILE IS KEPT BYTE-IDENTICAL IN TWO PLACES, and a test asserts it:
 * `packages/test-utils/scripts/attw.mjs` (the gate this repo runs on its own
 * published package) and `scripts/parser-template/scripts/attw.mjs` (the copy
 * `scripts/scaffold-parser.mjs` mints every NEW parser repo from). Porting only
 * the first would leave the defect being re-minted into every future parser.
 * Edit one, copy it to the other, or the drift test reds.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ATTW_BIN = fileURLToPath(new URL("../node_modules/.bin/attw", import.meta.url));
const UNTYPED = "This package does not contain types.";
const DECLARATION = /\.d\.[cm]?ts$/;
const args = process.argv.slice(2);

const die = (msg) => {
  process.stderr.write(`\n✗ attw gate: ${msg}\n`);
  process.exit(1);
};

// ---- Refuse what would blind the post-check --------------------------------
// Long options match on the name before `=`. SHORT options match per CHARACTER,
// because commander accepts an attached value (`-fjson`) and a cluster (`-Pq`),
// and an exact-token set lets both through. See BLINDING in the header.
const BLINDING_LONG = new Set(["--quiet", "--format", "--config-path"]);
const BLINDING_SHORT = new Set(["q", "f"]);

/** The blinding option `arg` carries, or null. Deliberately over-strict. */
const blindingIn = (arg) => {
  if (arg.startsWith("--")) {
    const name = arg.split("=")[0];
    return BLINDING_LONG.has(name) ? name : null;
  }
  // A single leading dash is a short cluster; every character in it is an option
  // letter until one takes an attached value, and we do not need to know which.
  if (arg.startsWith("-") && arg.length > 1) {
    for (const ch of arg.slice(1)) if (BLINDING_SHORT.has(ch)) return `-${ch}`;
  }
  return null;
};

const blinding = args.map(blindingIn).filter((name) => name !== null);
if (blinding.length > 0) {
  die(
    `${[...new Set(blinding)].join(", ")} is refused wholesale, by option and not by value.\n` +
      `  This gate reads attw's printed output, attw exits 0 on an untyped package,\n` +
      `  and some values of these options hide that output. Short options are matched\n` +
      `  per character, so an attached value (-fjson) or a cluster (-Pq) is refused\n` +
      `  too. Run it without them.`,
  );
}
try {
  const config = JSON.parse(readFileSync(".attw.json", "utf8"));
  const set = ["quiet", "format"].filter((k) => k in config);
  if (set.length > 0) {
    die(
      `.attw.json sets ${set.join(", ")}. These keys are refused wholesale, by name and\n` +
        `  not by value: readConfig() applies them after argv, this gate reads attw's\n` +
        `  printed output, and attw exits 0 on an untyped package.`,
    );
  }
} catch {
  // No .attw.json, or unreadable/invalid. attw itself reports the latter.
}

/** Every relative path `package.json` promises to ship, deduped. */
function declaredArtifacts(pkg) {
  const found = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    // Skip wildcard subpath patterns (they name a set, not a file) and the
    // manifest itself, which is always in the tarball by definition.
    if (!v.startsWith(".") || v.includes("*") || v === "./package.json") return;
    found.add(v);
  };
  for (const key of ["main", "module", "types", "typings"]) add(pkg[key]);
  const walk = (node) => {
    if (typeof node === "string") add(node);
    else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
  };
  walk(pkg.exports);
  return [...found];
}

let pkg;
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (err) {
  die(`cannot read ./package.json from ${process.cwd()}: ${err.message}`);
}

// ---- Net 1: preflight -------------------------------------------------------
const broken = [];
for (const rel of declaredArtifacts(pkg)) {
  let size;
  try {
    size = statSync(rel).size;
  } catch {
    broken.push({ rel, why: "missing" });
    continue;
  }
  if (size === 0) broken.push({ rel, why: "empty" });
}
if (broken.length > 0) {
  // Only claim the exit-0 counterfactual when a DECLARATION file is among the
  // casualties. With the declarations intact and only JS missing, attw reports
  // no problems at all and still exits 0, which is a different silence.
  const declarationsHit = broken.some(({ rel }) => DECLARATION.test(rel));
  die(
    `package.json promises files the build has not produced:\n` +
      broken.map(({ rel, why }) => `    ${rel} (${why})\n`).join("") +
      `\n  Run the build first. If you DID build, something removed or truncated the\n` +
      `  output underneath this run. A concurrent build or \`clean\` in the same\n` +
      `  working tree will do it, and \`tsup\` writes JS before declarations, so there\n` +
      `  is a window where the .d.ts files do not exist yet.\n` +
      (declarationsHit
        ? `  attw would have reported "${UNTYPED}" and EXITED 0 on this tree.\n`
        : `  attw does not gate these: it analyses types, and exits 0 here.\n`),
  );
}

// ---- Run attw ---------------------------------------------------------------
const res = spawnSync(ATTW_BIN, ["--pack", ".", ...args], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});
if (res.error) die(`could not run ${ATTW_BIN}: ${res.error.message}`);
const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
process.stdout.write(res.stdout ?? "");
process.stderr.write(res.stderr ?? "");
if (res.status !== 0) process.exit(res.status ?? 1);

// ---- Net 2: post-check ------------------------------------------------------
// An empty transcript means the post-check read nothing, by some route not listed
// under BLINDING above. Treat that as a failure rather than as a pass: this gate
// is only as good as the output it got to see.
if (output.trim() === "") {
  die(`attw exited 0 but printed nothing, so nothing was checked.`);
}
if (output.includes(UNTYPED)) {
  die(
    `attw reported "${UNTYPED}" and exited 0.\n` +
      `  This package ships types, so that means the tarball did not carry them.\n` +
      `  Check the "files" field and .npmignore. Reported as a failure here because\n` +
      `  attw's own exit code cannot: getExitCode() returns 0 whenever the analysis\n` +
      `  found no types at all, before it ever looks at the problem list.`,
  );
}
