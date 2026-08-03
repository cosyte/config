#!/usr/bin/env node
/**
 * scripts/attw.mjs: the `attw` publish gate, made to report its own failure.
 *
 * THIS DOCBLOCK IS THE ONE AUTHORITATIVE DESCRIPTION OF THE GATE. The CHANGELOG
 * entry and the scaffolded repo's `CLAUDE.md` point here rather than restating
 * the rules, deliberately: the previous shape of this guard was described in
 * several committed files at once, and every drift between those copies was a
 * claim that had been edited in some of them and not the others. Edit this
 * docblock; leave the pointers alone.
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
 *      `package.json` promises (`main`, `module`, `types`, `typings`, `bin`, and
 *      every string leaf of `exports`) must exist and be non-empty before `attw`
 *      runs. This is the one that catches the window above, and it names the
 *      missing file instead of leaving the reader to infer it.
 *
 *      TWO THINGS IT USED TO WALK PAST, both closed here. (a) `bin` was never
 *      read, so a package could ship a manifest promising a command that is not
 *      in the tarball and this gate would say nothing: `attw` never looks at
 *      `bin` at all. The template declares no `bin` today; the half is here
 *      because this file is the shape every scaffolded parser inherits, and a
 *      parser that grows a CLI entry point grows the hole with it. (b) A path
 *      written WITHOUT a leading `./` was skipped, silently.
 *      `"types": "dist/index.d.ts"` is legal and is the spelling npm's own
 *      documentation uses, so that dropped a real promise while the gate still
 *      reported it had checked. `exports` leaves are different and are left
 *      alone: Node requires `./` there, so a leaf without it is not a path of
 *      ours.
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
 * WHAT THE PREFLIGHT CANNOT CONCLUDE, AND WHY IT NO LONGER TRIES. This script
 * used to end its preflight failure with a sentence naming the exit code `attw`
 * "would have" produced. It is gone rather than reworded, because THE PREFLIGHT
 * READS THE MANIFEST AND NEVER THE TARBALL, and the tarball is what decides.
 * `analysis.types` comes from `containsTypes()` in `@arethetypeswrong/core`'s
 * `createPackage.js`, which is `listFiles(directory).some(ts.hasTSFileExtension)`:
 * ANY TypeScript-extension file in the PACKED TARBALL, not the set `exports`
 * declares, and computed before any entrypoint is resolved. So a package whose
 * `files` packs a whole `dist/` can lose every DECLARED declaration and still
 * hand `attw` an undeclared chunk declaration to find, at which point it exits 1
 * and any "would have exited 0" sentence here is false. A partial loss `attw`
 * catches by itself; only a total one is the false green. A gate that reds
 * correctly and then explains itself with a falsehood teaches the next reader
 * the wider, wrong story, and this file gets copied into every new parser.
 *
 * BLINDING, AND WHY THE ARGUMENT GUARD IS AN ALLOW-LIST RATHER THAN A DENY-LIST.
 * Each of these was measured against the pinned `@arethetypeswrong/cli@0.18.4`
 * on a package whose tarball carries no types. Each restores the exact false
 * green by making the untyped sentence absent from what this script can read,
 * while `attw` exits 0:
 *
 *     --quiet / -q             output empty, exit 0
 *     --format json / -f json  sentence absent, output NOT empty, exit 0
 *     -fjson / -Pf json / -Pfjson
 *                              same, exit 0: a value fused to a short flag, and
 *                              a short flag inside a cluster
 *     --config-path <file setting quiet or format>
 *                              sentence absent, exit 0
 *     .attw.json {"quiet":true} or {"format":"json"}
 *                              sentence absent, exit 0 (readConfig() applies it
 *                              after argv, so the file beats the flag)
 *     --help / -h / --version / -V
 *                              exit 0, output NOT empty, no sentence: the gate
 *                              cannot tell either from a pass
 *
 * A DENY-LIST DOES NOT HOLD HERE, AND EACH ROUND OF IT BOUGHT EXACTLY ONE MORE
 * EVASION. The first shape refused a fixed set of tokens by `arg.split("=")[0]`,
 * which is token equality rather than option-name matching, so `-fjson` was
 * neither `-f` nor `--format` and walked straight through. The second shape
 * added per-character matching over short clusters, which closed `-fjson`,
 * `-Pfjson` and `-Pf json` and closed nothing else: measured against this gate
 * on an untyped pack, `--help`, `-h`, `--version` and `-V` each still exited 0
 * with the sentence absent and a non-empty transcript, so the empty-output net
 * below could not backstop them either. Enumerating spellings is a ceiling, not
 * a fix.
 *
 * So the guard is total instead: an ALLOW-LIST of the two arguments this gate's
 * own callers pass. Everything else is refused, including a
 * `--format table-flipped` that was measured to still print the sentence and so
 * blinds nothing. "Harmless" is a judgement this script cannot make from an
 * option name, and being over-strict about an argument nobody passes to a repo's
 * own publish gate costs less than a route back to a false green. `-h`,
 * `--version`, `--config-path` and every future spelling fall out of this for
 * free rather than needing a line each. Widening the set is a deliberate
 * one-line edit.
 *
 * NEITHER ALLOWED ARGUMENT IS PASSED BY THIS PACKAGE'S OWN `attw` SCRIPT.
 *   `--profile` selects the resolution profile. The manifest passes none, so the
 *   gate runs `attw`'s default `strict`; several sibling manifests DO pass
 *   `--profile node16`, and the value is forwarded rather than dropped. Its
 *   value is bounded by `attw` itself, which rejects anything outside its own
 *   choices.
 *   `--no-definitely-typed` suppresses the DefinitelyTyped lookup. It is allowed
 *   because the test suites here pass it (it keeps a gate run off the network),
 *   and nothing else does.
 *
 * THE `.attw.json` REFUSAL STAYS, because it is not an argument: `readConfig()`
 * applies it after argv, so no argument guard of any shape can reach it.
 *
 * AND THAT REFUSAL IS NAME-SCOPED WHERE `readConfig()` IS NOT. THIS GUARD CLOSES
 * THE ARGV HALF ONLY, AND NOTHING HERE SHOULD BE READ AS CLOSING THE CONFIG
 * ROUTE. `readConfig()` calls `setOptionValueWithSource` for EVERY key except
 * `configPath`/`help`/`version`, so a committed `.attw.json` reaches options
 * this script does not name, and config wins regardless of the allow-list.
 * `definitelyTyped` pointed at a `.tgz` is one: it merges those types in and can
 * make an untyped tarball analyse as typed. It needs a committed config file,
 * which is a reviewable artifact rather than an argv nobody reads, so it is
 * latent rather than live. Do not answer it by adding a key: that is the
 * deny-list this file just retired on the argument side. Tracked as its own
 * item, not as another round here.
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
const args = process.argv.slice(2);

const die = (msg) => {
  process.stderr.write(`\n✗ attw gate: ${msg}\n`);
  process.exit(1);
};

// ---- Only the arguments this gate can vouch for are forwarded ---------------
// ALLOW-LIST, NOT A DENY-LIST, AND THAT IS THE WHOLE POINT. See BLINDING above.
const ALLOWED = new Set(["--profile", "--no-definitely-typed"]);
const forwarded = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const name = arg.split("=")[0];
  if (!ALLOWED.has(name)) {
    die(
      `${arg} is not an argument this gate accepts.\n` +
        `  It forwards an ALLOW-LIST (${[...ALLOWED].join(", ")}) rather than refusing a\n` +
        `  list of spellings. This gate reads attw's printed output and attw exits 0 on an\n` +
        `  untyped package, so anything that changes what attw prints can hide the one\n` +
        `  sentence net 2 reads. Widening this set is a deliberate one-line edit; check\n` +
        `  first that the option cannot suppress or reformat attw's output.`,
    );
  }
  forwarded.push(arg);
  // `--profile` takes a value. A fused `--profile=node16` carries its own; a
  // separated one must claim the next argument, or that value would be read as
  // an option on the next turn of this loop and refused.
  if (name === "--profile" && !arg.includes("=")) {
    const value = args[++i];
    if (value === undefined) die(`--profile was given with no value.`);
    forwarded.push(value);
  }
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

/**
 * Every relative path `package.json` promises to ship, deduped and normalized to
 * a leading `./` so two spellings of one promise are not checked twice.
 */
function declaredArtifacts(pkg) {
  const found = new Set();
  // `main`, `module`, `types`, `typings` and `bin` are ALWAYS paths, never
  // package specifiers, and the `./` prefix is optional on all of them. Only an
  // absolute path (not ours to promise) or a pattern is skipped.
  const addPath = (v) => {
    if (typeof v !== "string" || v === "") return;
    if (v.startsWith("/") || v.includes("*")) return;
    const rel = v.startsWith(".") ? v : `./${v}`;
    if (rel === "./package.json") return;
    found.add(rel);
  };
  // An `exports` target is required by spec to be `./`-relative, so a leaf that
  // is not one is a package specifier or a pattern, and is not a file of ours.
  const addTarget = (v) => {
    if (typeof v !== "string") return;
    // Skip wildcard subpath patterns (they name a set, not a file) and the
    // manifest itself, which is always in the tarball by definition.
    if (!v.startsWith(".") || v.includes("*") || v === "./package.json") return;
    found.add(v);
  };
  for (const key of ["main", "module", "types", "typings"]) addPath(pkg[key]);
  // `bin` is a bare string, or a flat map of command name to path.
  if (typeof pkg.bin === "string") addPath(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === "object")
    for (const v of Object.values(pkg.bin)) addPath(v);
  const walk = (node) => {
    if (typeof node === "string") addTarget(node);
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
  // No counterfactual about attw's exit code here, on purpose. See "WHAT THE
  // PREFLIGHT CANNOT CONCLUDE" above before adding one back.
  die(
    `package.json promises files the build has not produced:\n` +
      broken.map(({ rel, why }) => `    ${rel} (${why})\n`).join("") +
      `\n  Run the build first. If you DID build, something removed or truncated the\n` +
      `  output underneath this run. A concurrent build or \`clean\` in the same\n` +
      `  working tree will do it, and \`tsup\` writes JS before declarations, so there\n` +
      `  is a window in every build here where the .d.ts files do not exist yet.\n` +
      `  attw was not run: this check reads the manifest, and what attw would have\n` +
      `  reported depends on what the packed tarball carries, which it cannot see.\n`,
  );
}

// ---- Run attw ---------------------------------------------------------------
const res = spawnSync(ATTW_BIN, ["--pack", ".", ...forwarded], {
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
