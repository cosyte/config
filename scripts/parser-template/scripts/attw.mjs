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
 * THREE NETS, AND THEY CATCH DIFFERENT THINGS. Keep all three.
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
 *   2. POST-CHECK, ON attw's STRUCTURED OUTPUT AND NEVER ON ITS PROSE. The
 *      preflight cannot see this case: the declaration files can be present on
 *      disk and still be absent from the tarball, because `files` (or
 *      `.npmignore`) left them out. That is the case `attw --pack` exists to
 *      catch, and the whole point here is that it catches it silently.
 *
 *      SO THIS GATE FORCES `--format json` ONTO THE CHILD AND PARSES ITS STDOUT,
 *      then asserts one thing: `analysis.types.kind === "included"`, i.e. the
 *      types came out of THIS package's own tarball. See MEASURED SHAPES below
 *      for the three values that field takes and why each is the answer it is.
 *
 *   WHY STRUCTURE, AND NOT THE SENTENCE IT USED TO MATCH. The post-check used to
 *   look for `attw`'s untyped sentence, a plain un-chalked string from
 *   `dist/render/untyped.js`. Anything that suppressed or reformatted output
 *   deleted that string, and the gate read its ABSENCE as a pass, so every such
 *   route had to be refused BY NAME, one spelling at a time, on the argv side and
 *   the config side both. Parsing the JSON inverts the default: a route that hides
 *   or reformats output leaves stdout unparseable, and UNPARSEABLE FAILS CLOSED.
 *   Routes nobody has enumerated fail closed too, which is the property a
 *   name-scoped refusal could never have.
 *
 *   3. THE TARBALL CHECK (structural, and the only net attw's configuration
 *      cannot reach). It runs LAST, after attw has exited 0 and net 2 has
 *      passed, and it asks NET 1's question one level further out, over NET 1's
 *      OWN SET so the two cannot disagree: every LITERAL relative artifact path
 *      `package.json` promises must be in the TARBALL npm would publish, not
 *      merely on disk. Wildcard `exports` subpaths are skipped there and so are
 *      skipped here; they name a set rather than a file, and the pass line says
 *      "literal" for exactly that reason. The list comes from
 *      `npm pack --dry-run --json` run in this directory, so attw is not
 *      consulted and nothing a committed `.attw.json` sets can change the answer.
 *
 *      WHY IT IS A NET AND NOT A WIDER READING OF NET 2. Net 2's
 *      `kind === "included"` is `containsTypes()`, which is "SOME
 *      TypeScript-extension file is in the tarball" and NOT "the DECLARED
 *      declarations are". A package that packs one stray `.d.ts` and loses every
 *      declared one satisfies it. Net 1 does not see that either, because net 1
 *      reads the WORKING TREE and the loss is in the `files` field. Until this
 *      net the only thing catching it was attw's own EXIT CODE, and a committed
 *      config relaxes exactly that.
 *
 *      MEASURED on the pinned `@arethetypeswrong/cli@0.18.4`, on a package whose
 *      declared `./dist/index.d.ts` is left out of `files` while an undeclared
 *      `./dist/internal.d.ts` is packed. Bare attw exits 1 there. Through this
 *      gate, WITHOUT net 3, each of these committed configs made it exit 0:
 *
 *          {"ignoreRules": [every rule attw fired]}          -> exit 0
 *          {"ignoreResolutions": [all four resolutions]}     -> exit 0
 *          {"entrypoints": []}                               -> exit 0, and attw
 *                                                               reported NO
 *                                                               problems at all
 *
 *      THE THIRD ROW IS WHY THIS NET DOES NOT READ attw's UNFILTERED PROBLEM LIST
 *      INSTEAD. That list is in the document and net 2 already prints it, so
 *      gating on it would close the first two rows. It closes nothing on the
 *      third: an empty `entrypoints` means attw analysed nothing, so there is no
 *      finding to read. AND IT WOULD RED HEALTHY PACKAGES THAT SHIP TODAY, which
 *      is the half that settled it. Measured across the sibling repos that pass
 *      `--profile node16` (`mllp`, `deid`, `synth` and `cli`), ALL FOUR carry a
 *      non-empty unfiltered problem list (`NoResolution`) that their profile
 *      suppresses on purpose, so all four would have gone red on a net reading
 *      that list, against 0 that go red on this one. A net that has to read what
 *      attw was configured to look at sits inside the blast radius of that
 *      configuration.
 *
 *      THIS IS NOT THE KEY LIST THIS FILE HAS RETIRED TWICE, AND IT CANNOT DECAY
 *      INTO ONE. It never reads `.attw.json`, so a key nobody has enumerated is
 *      not a hole in it. The set it checks is derived from THIS package's own
 *      manifest, which is bounded by the manifest rather than by attw's option
 *      surface, and a new attw release cannot add to it.
 *
 *      Measured against `profile`, which the item that asked for this net named
 *      alongside the three above: on that same package `{"profile": "strict"}`,
 *      `{"profile": "node16"}` and `{"profile": "esm-only"}` each still exited 1,
 *      as did `{"entrypoints": ["."]}`. `profile` is therefore recorded here as
 *      NOT MEASURED TO BLIND THIS CASE rather than as a fourth route; the config
 *      was confirmed to be read at all by `{"profile": "bogus-profile"}`, which
 *      attw rejects outright.
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
 * on a package whose tarball carries no types. Each restored the exact false
 * green AGAINST THE SENTENCE-MATCHING NET 2 THIS FILE NO LONGER HAS, by making
 * the untyped sentence absent from what this script can read, while `attw`
 * exits 0:
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
 * EVERY ROW ABOVE NOW FAILS CLOSED ON THE PARSE, because none of them puts
 * parseable JSON on stdout. THE ALLOW-LIST STAYS ANYWAY, and not as ceremony: it
 * refuses these at the door with a sentence that says which argument was wrong,
 * where the parse would only say the output was not JSON. A gate that reds for a
 * legible reason costs the next reader minutes; one that reds for an illegible
 * reason costs an hour. It also keeps this script forwarding only what it can
 * vouch for, which is a smaller promise than "whatever survives the parse".
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
 * THE `.attw.json` DENY-LIST IS GONE, AND NOTHING REPLACED IT BY NAME. It refused
 * exactly two keys, `quiet` and `format`: the same shape this file had just
 * retired on the argument side, and one that could never have been widened
 * honestly. `readConfig()` calls `setOptionValueWithSource` for EVERY key except
 * `configPath`/`help`/`version`, and applies them AFTER argv, so a committed
 * config beats any argument this gate passes and reaches options no list here
 * names. Enumerating keys would have bought exactly one more evasion per round,
 * the way enumerating spellings did.
 *
 * NET 2's STRUCTURAL FORM CLOSES THE THREE CONFIG KEYS THAT BLIND *NET 2*, AND THAT
 * IS ALL IT CLOSES. IT DOES NOT CLOSE "THE CONFIG ROUTE" AND NOTHING HERE MAY SAY
 * SO. See WHAT THIS NET DOES NOT CLAIM below, which names the keys still open and
 * the case they still pass. Measured on the pinned `@arethetypeswrong/cli@0.18.4`,
 * against a package whose tarball carries no types at all:
 *
 *     {"quiet": true}      stdout empty                 -> unparseable -> RED
 *     {"format": "table"}  beats the `--format json` this gate passes, and
 *                          prints prose                 -> unparseable -> RED
 *     {"definitelyTyped": "./x.tgz"}
 *                          parses fine, attw exits 0, AND THE PACKAGE ANALYSES AS
 *                          TYPED. THE PARSE ALONE DOES NOT CATCH THIS ONE; the
 *                          `kind` assertion is what does.
 *
 * THE THIRD ROW IS WHY THE ASSERTION IS ABOUT `kind` AND NOT ABOUT `types` MERELY
 * BEING TRUTHY. `checkPackage` in `@arethetypeswrong/core` sets its `types` from
 * `pkg.typesPackage` ALONE (it never re-reads the tarball once a DefinitelyTyped
 * package has been merged in), so a tarball containing no declaration file
 * anywhere reports `{"kind": "@types"}` and a clean bill of health. Reproduced end
 * to end here: an untyped package plus a committed `.attw.json` naming a
 * `@types/<name>` tarball EXITED 0 through the sentence-matching gate, and reds
 * through this one.
 *
 * MEASURED SHAPES of `analysis.types`, all three read off real runs:
 *
 *     false                  no TS-extension file in the
 *                            tarball                        -> RED, the false green
 *     {"kind": "included"}   SOME TS-extension file is in
 *                            THIS tarball                   -> the only pass
 *     {"kind": "@types"}     types were merged in from a
 *                            DefinitelyTyped tarball        -> RED
 *
 * `kind` CANNOT BE `"@types"` BY ACCIDENT ON THIS GATE'S OWN INVOCATION, so the
 * assertion costs no false reds. Under `--pack`, the merge happens only when
 * `opts.definitelyTyped` is a STRING that looks like a path; the option defaults to
 * the boolean `true`, `--definitely-typed` is refused by the allow-list, and
 * `--no-definitely-typed` sets it false. A committed config file is the only way in.
 *
 * WHAT THESE NETS DO NOT CLAIM, AND MUST NOT BE READ AS CLAIMING. READ THIS BEFORE
 * WRITING ANYWHERE THAT THE CONFIG ROUTE IS CLOSED, BECAUSE IT STILL IS NOT.
 *
 *   (a) `"included"` IS STILL NOT "THE DECLARED DECLARATIONS ARE PRESENT", AND NET
 *       2 STILL DOES NOT SAY IT IS. It is `containsTypes()`, which is
 *       `listFiles("/").some(ts.hasTSFileExtension)`: ANY TypeScript-extension file
 *       anywhere in the tarball. A package that packs one stray `.d.ts` and loses
 *       every DECLARED one satisfies net 2. What refuses it now is NET 3, which
 *       does not ask attw anything. It is NOT a wider reading of `kind`, which has not
 *       changed and cannot be given one.
 *
 *   (b) SO THE CONFIG ROUTE IS NARROWED, NOT CLOSED, AND THE PART STILL OPEN IS
 *       RESOLUTION. `readConfig()` still applies a committed `.attw.json` after
 *       argv, and `ignoreRules`, `ignoreResolutions` (not even validated by
 *       `readConfig()`) and an empty `entrypoints` still relax attw's exit code.
 *       Net 3 makes that stop mattering for one specific failure, a DECLARED path
 *       missing from the tarball, because net 3 never consults that exit code.
 *       Everything else attw judges is still behind it.
 *
 *       MEASURED, so the residue is a fact and not a hedge. A package that declares
 *       `./dist/index.js` + `./dist/index.d.ts`, PACKS BOTH, and ships ESM under a
 *       CJS-default `main` reds on bare attw (exit 1, `UnexpectedModuleSyntax`) and
 *       PASSES THIS GATE, net 3 included, under
 *       `{"ignoreRules": ["unexpected-module-syntax", ...]}`. Net 3 is satisfied
 *       there and is right to be: both declared paths really are in the tarball.
 *       The gate PRINTS the suppressed problem kind rather than swallowing it, but
 *       printing is not gating and this file must never describe it as if it were.
 *
 *       Do not answer that residue by adding keys here. That is the deny-list this
 *       file has retired twice, and net 3 is what it looks like to answer one of
 *       these structurally instead: read something attw's configuration cannot
 *       reach, derived from a set the manifest bounds.
 *
 *   (c) THE PASS LINE IS WORDED TO MATCH (a) AND (b), and must stay that way. Its
 *       net 2 half claims only what `kind === "included"` proves: SOME
 *       TypeScript-extension file is in the tarball, and it was not merged in from
 *       `@types`. IT MUST NOT SAY "the declarations" or "this package's types":
 *       both assert (a)'s missing half, and two earlier drafts of this line did,
 *       the second more strongly than the first. Its net 3 half is bounded twice
 *       over in the same breath, because a count reads like a total: it says
 *       "presence not resolution", which is (b), and it says LITERAL paths, because
 *       `declaredArtifacts` skips wildcard `exports` subpaths, which name a SET
 *       rather than a file and are therefore declared but not checked. Without that
 *       word the count would read as "everything the manifest declares". It never says "no problems"
 *       unless the document really is empty, and it PRINTS any problem kinds attw
 *       reported but did not gate.
 *
 * No repo in the org ships a `.attw.json` today, so everything above, closed and
 * open alike, is LATENT rather than live.
 *
 * THE NESTED `npm pack`, AND THE ONE THING IN THE ENVIRONMENT THAT BREAKS IT.
 * `attw --pack .` shells out to a real `npm pack` and then opens the tarball at a
 * path it COMPUTED from the manifest (`<dir>/<name>-<version>.tgz`, see
 * `dist/index.js`). It never asks npm where the file went. So any inherited npm
 * config that stops that file being written, or writes it somewhere else, turns
 * this gate into `ENOENT: no such file or directory, open '<name>-<version>.tgz'`.
 *
 * MEASURED, NOT PREDICTED, and it is the whole of `CONFIG-PREPUBLISH-ATTW-ENOENT`:
 * `pnpm publish --dry-run` exports `npm_config_dry_run=true` into every lifecycle
 * script it runs, and `npm pack` under that variable prints its listing and writes
 * NOTHING. That is why the failure only ever appears on a version bump, and it is
 * the real mechanism behind the earlier `pnpm attw`-in-`prepublishOnly` incident
 * (#40) that `RELEASING.md` records: `publish --dry-run` SKIPS a version already on
 * npm, so the `prepublishOnly` chain runs on nothing else. A REAL publish does not
 * set the variable (measured on a non-dry-run `pnpm publish`: the lifecycle
 * environment carries `registry`, `cache`, `user_agent` and no `dry_run`), so this
 * class has never broken a release, only the dry run that exists to prove one.
 * `pack-destination` is the same mechanism through the other half: it moves the
 * tarball away from the path attw computed.
 *
 * SO THE attw CHILD DOES NOT INHERIT THOSE TWO KEYS. THE UNDERSCORE SPELLINGS ARE
 * THE ONES THAT ALWAYS ARRIVE, in either case: `npm_config_dry_run`,
 * `NPM_CONFIG_DRY_RUN`, and the same two for `pack-destination`. npm ALSO honours a
 * hyphenated key, and whether that one can reach npm here depends on something
 * outside npm entirely. attw packs with `execSync("npm pack")`, which runs through
 * `/bin/sh`, and `npm_config_dry-run` is not a valid shell variable name: DASH
 * (what Debian and Ubuntu ship as `/bin/sh`, so the runner too) refuses to export
 * it, while BASH, including bash invoked as `sh`, forwards it unchanged. Measured in
 * both directions. So the hyphen is dead on CI and live on a bash-as-`sh` box, and
 * an earlier draft of this paragraph stated dash's answer as though it were a
 * property of shells.
 *
 * THAT IS EXACTLY WHY THE MATCH BELOW IS A SUPERSET rather than the pair that was
 * measured arriving. It costs one character, it is right on either shell, and it
 * stays right if anything ever spawns npm without one. What it must not be read as
 * is evidence that the hyphen is a live route on any given box: the suite MEASURES
 * the shell rather than assuming it, and asserts the counterfactual that shell
 * actually produces.
 *
 * THIS IS NOT THE DENY-LIST THE ARGUMENT GUARD RETIRED, AND THE DIFFERENCE IS THAT
 * THIS SET IS BOUNDED. Argv spellings were unbounded because the option parser
 * accepts fused, clustered and `=`-joined forms, so each round of enumeration
 * bought exactly one more evasion. Here the question is a schema-sized one with a
 * two-key answer: which npm config decides WHETHER and WHERE `npm pack` writes its
 * tarball? Every other npm setting changes what goes INSIDE the tarball, which is
 * the thing this gate exists to read, so stripping more would change what attw
 * analyses rather than fix where npm wrote. `npm_config_registry` in particular is
 * left alone on purpose: dropping it would move where attw RESOLVES from.
 *
 * IT DOES NOT OVERRIDE AN OPERATOR'S `--dry-run`, and it cannot: the pack it
 * un-suppresses is attw's own analysis input, in the directory being checked, and
 * attw deletes it when it is done. Nothing about the outer dry run's "publishes
 * nothing" guarantee is touched. What is restored is only that a gate asked to run
 * gets to read a tarball instead of dying on a file npm was told not to write.
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

/**
 * A readable digest of attw's JSON problem map, or `null` if there is not one.
 *
 * The gate asks for `--format json` because net 2 reads structure, but that costs
 * the human the emoji table attw prints by default, and this file's whole point is
 * that a gate must report its own failure legibly. So the failure path renders the
 * problem KINDS and the subpaths they hit. Returns `null` (caller falls back to the
 * raw bytes) when the document cannot be read at all, which on the failure path
 * includes attw exiting mid-write and truncating its own JSON.
 *
 * @param {string} out attw's stdout.
 * @returns {string | null} A digest, or null if none could be derived.
 */
function summarizeProblems(out) {
  let doc;
  try {
    doc = JSON.parse(out);
  } catch {
    return null;
  }
  const problems = doc?.problems;
  if (!problems || typeof problems !== "object") return null;
  const lines = [];
  for (const [kind, entries] of Object.entries(problems)) {
    const where = (Array.isArray(entries) ? entries : [])
      .map((p) => p?.entrypoint ?? p?.subpath ?? p?.resolutionKind)
      .filter((s) => typeof s === "string");
    lines.push(`  ${kind}${where.length > 0 ? `: ${[...new Set(where)].join(", ")}` : ``}`);
  }
  if (lines.length === 0) return null;
  return [`attw reported ${lines.length} problem kind(s):`, ...lines].join("\n");
}

/**
 * The paths a published tarball of this directory would carry, read from npm
 * rather than recomputed from `files`/`.npmignore` here.
 *
 * `--dry-run` and `--json` are PASSED ON ARGV, NEVER LEFT TO THE ENVIRONMENT.
 * `json` is an ordinary npm config, so an ambient `npm_config_json` /
 * `NPM_CONFIG_JSON` picks npm's output format for any caller that does not pin
 * it, and a sibling test in this package was reading `]` as a tarball name for
 * exactly that reason. Measured here: the flag beats the variable in both
 * spellings. `--dry-run` is what keeps this net from writing a tarball into a
 * directory someone may be about to publish; measured, no `.tgz` appears.
 *
 * Every shape this cannot read comes back as an error rather than as a short
 * file list, because a partial answer graded as a whole one is the false green
 * this whole file exists to refuse.
 *
 * @param {{ name?: string }} pkg The parsed manifest.
 * @param {NodeJS.ProcessEnv} childEnv The environment to hand npm.
 * @returns {{ files: Set<string>, error?: undefined } | { error: string, files?: undefined }}
 */
function packedFiles(pkg, childEnv) {
  const res = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: childEnv,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (res.error) return { error: `could not run \`npm pack\`: ${res.error.message}` };
  if (res.status !== 0) {
    const why = (res.stderr ?? "").trim();
    return {
      error: `\`npm pack --dry-run --json\` exited ${res.status}.${why ? `\n${why}` : ``}`,
    };
  }
  let doc;
  try {
    doc = JSON.parse(res.stdout ?? "");
  } catch {
    return {
      error: `\`npm pack --dry-run --json\` did not print JSON. What it printed:\n\n${res.stdout ?? ""}`,
    };
  }
  // npm reports an ARRAY of tarballs, because the same command run at a workspace
  // root describes several. Only this package's own entry is gradeable here, and
  // anything other than exactly one of them means npm was asked a different
  // question than this net thinks it asked.
  const mine = (Array.isArray(doc) ? doc : []).filter((entry) => entry?.name === pkg.name);
  if (mine.length !== 1) {
    return {
      error:
        `npm described ${mine.length} tarball(s) named ${pkg.name}, and this net can only\n` +
        `  grade exactly one. Something changed what \`npm pack\` was asked to pack.`,
    };
  }
  const listed = mine[0]?.files;
  if (!Array.isArray(listed)) {
    return { error: `npm's pack report for ${pkg.name} carries no "files" array.` };
  }
  const files = new Set();
  for (const entry of listed) {
    if (typeof entry?.path !== "string") {
      return { error: `npm listed a packed file with no "path" string, so the list is unreadable.` };
    }
    files.add(entry.path);
  }
  return { files };
}

let pkg;
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (err) {
  die(`cannot read ./package.json from ${process.cwd()}: ${err.message}`);
}

// ---- Net 1: preflight -------------------------------------------------------
// Net 3 asks this same set of paths a second question, of the tarball rather than
// the working tree, so the set is derived once and shared.
const declared = declaredArtifacts(pkg);
const broken = [];
for (const rel of declared) {
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
// The two npm settings that decide whether and where the nested `npm pack` writes
// its tarball, in every spelling npm honours. attw opens a path it computed, so
// either one leaves this gate dying on ENOENT instead of checking anything. See
// "THE NESTED `npm pack`" above; `pnpm publish --dry-run` sets the first of them
// in every lifecycle script it runs.
const PACK_PLACEMENT_CONFIG = /^npm_config_(dry[_-]run|pack[_-]destination)$/i;
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !PACK_PLACEMENT_CONFIG.test(key)),
);
// `--format json` is APPENDED BY THIS GATE, never accepted from a caller: net 2
// reads structure, so the structure has to be there. A `.attw.json` can still
// override it (config is applied after argv), and that is handled where it lands,
// as an unparseable transcript, rather than by refusing the key by name.
// MAXBUFFER IS SET BECAUSE `--format json` IS 20 TO 50 TIMES THE TABLE'S SIZE, and
// spawnSync's default is 1 MiB. Measured here: ~56 kB for this repo's own
// two-entrypoint package, and ~245 kB for ONE entrypoint over an unbundled
// declaration tree. That puts the default's ceiling at a few dozen entrypoints, at
// which point a package the previous gate passed dies on ENOBUFS instead. A gate
// that reds because its own reader was too small is a false red, so the buffer is
// sized past anything a package here will produce and the failure is named below
// rather than left as `spawnSync ... ENOBUFS`.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const res = spawnSync(ATTW_BIN, ["--pack", ".", ...forwarded, "--format", "json"], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
  env,
  maxBuffer: MAX_OUTPUT_BYTES,
});
if (res.error) {
  const why =
    /** @type {NodeJS.ErrnoException} */ (res.error).code === "ENOBUFS"
      ? `attw's JSON output exceeded this gate's ${MAX_OUTPUT_BYTES}-byte read buffer, so the\n` +
        `  gate could not read what it asked for. This is the GATE's limit, not a problem\n` +
        `  with the package. Raise MAX_OUTPUT_BYTES in this file.`
      : `could not run ${ATTW_BIN}: ${res.error.message}`;
  die(why);
}
const stdout = res.stdout ?? "";
process.stderr.write(res.stderr ?? "");
if (res.status !== 0) {
  // attw judged the package itself. Its own red is a red: forward its status rather
  // than re-deciding it. But `--format json` means the transcript is a document and
  // not the table a human could read, so summarise the problems first and keep the
  // raw bytes as the fallback. attw calls process.exit() straight after writing on
  // this path, so a large document can arrive TRUNCATED and unparseable; that is
  // exactly when the raw dump is the only thing left.
  process.stdout.write(`${summarizeProblems(stdout) ?? stdout}\n`);
  process.exit(res.status ?? 1);
}

// ---- Net 2: post-check, on the structure and never on the prose -------------
// STDOUT ONLY. attw writes its JSON document to stdout and nothing else to it, so
// folding stderr in here would let one warning line turn every run into a parse
// failure. stderr is forwarded to the human above, unread.
let report;
try {
  report = JSON.parse(stdout);
} catch {
  die(
    stdout.trim() === ""
      ? `attw exited 0 and printed nothing to stdout, so nothing was checked.\n` +
          `  This gate passes --format json and reads the document attw prints. An empty\n` +
          `  transcript means something suppressed it. A .attw.json setting "quiet" is the\n` +
          `  measured route. Refused rather than read as a pass: this gate is only as good\n` +
          `  as the output it got to see.`
      : `attw exited 0 but stdout was not the JSON document this gate asked for.\n` +
          `  It passes --format json and parses the result. Anything that reformats or\n` +
          `  intercepts that output lands here. A .attw.json setting "format" beats the\n` +
          `  flag, because readConfig() applies the file after argv. Refused rather than\n` +
          `  read as a pass. What attw actually printed:\n\n` +
          stdout,
  );
}

const types = report?.analysis?.types;
if (types === undefined) {
  // Not a blinding route: attw's own document shape changed under us. Say so,
  // rather than reporting it as an untyped package.
  die(
    `attw's JSON document has no analysis.types field, so this gate could not tell\n` +
      `  whether the tarball carried types. That is an attw shape change, not a\n` +
      `  package problem. Re-read scripts/attw.mjs's docblock against the installed\n` +
      `  @arethetypeswrong/cli before adjusting anything.`,
  );
}
if (types === false) {
  die(
    `attw analysed this package as UNTYPED and exited 0.\n` +
      `  This package ships types, so that means the tarball did not carry them.\n` +
      `  Check the "files" field and .npmignore. Reported as a failure here because\n` +
      `  attw's own exit code cannot: getExitCode() returns 0 whenever the analysis\n` +
      `  found no types at all, before it ever looks at the problem list.`,
  );
}
if (types.kind !== "included") {
  die(
    `attw analysed this package as typed, but the types did NOT come from its own\n` +
      `  tarball: analysis.types.kind is "${types.kind}"` +
      (types.packageName ? `, merged in from ${types.packageName}` : ``) +
      `.\n` +
      `  checkPackage() sets its verdict from pkg.typesPackage alone, so a tarball with\n` +
      `  no declaration file in it at all analyses as typed once a DefinitelyTyped\n` +
      `  package is merged in. A committed .attw.json naming a .tgz is the only way to\n` +
      `  reach this on --pack. This gate exists to prove the types it analysed came out\n` +
      `  of THIS tarball rather than somewhere else, so only "included" passes. (That is\n` +
      `  a claim about ORIGIN, not about the declared declarations being present: see\n` +
      `  "WHAT THIS NET DOES NOT CLAIM" in the docblock.)`,
  );
}

// ---- Net 3: the DECLARED paths must be in the TARBALL -----------------------
// Net 1 asked this of the WORKING TREE. This asks it of the tarball npm would
// publish, which is the one place `files`/`.npmignore` can drop a declared path
// while leaving it on disk for net 1 to find. It reads npm's own pack listing, so
// nothing attw does, and nothing a committed `.attw.json` configures, changes the
// answer. See "THREE NETS" in the docblock for why that independence is the point.
const packed = packedFiles(pkg, env);
if (packed.error) {
  die(
    `this gate could not read which files a tarball of this package would carry, so\n` +
      `  it could not check that the paths package.json declares are among them.\n` +
      `  Refused rather than passed: an answer this net could not read is not a green\n` +
      `  one. ${packed.error}`,
  );
}
const notPacked = declared.filter((rel) => !packed.files.has(rel.replace(/^\.\//, "")));
if (notPacked.length > 0) {
  die(
    `package.json declares paths the published tarball would NOT carry:\n` +
      notPacked.map((rel) => `    ${rel}\n`).join("") +
      `\n  Net 1 found each of these on disk, so this is not an unfinished build. The\n` +
      `  "files" field or .npmignore left them out, and an installer would get a\n` +
      `  package whose own manifest points at paths that are not in it.\n` +
      `  attw exited 0 over this, which is not by itself evidence of a blinding route:\n` +
      `  it never reads "bin" at all, and a lost DECLARATION normally reds it on its own.\n` +
      `  Before this net that exit code was the only thing catching a lost declaration,\n` +
      `  and a committed .attw.json relaxes exactly it: "ignoreRules",\n` +
      `  "ignoreResolutions" and an empty "entrypoints" were each measured to. That is\n` +
      `  why this net reads npm's pack listing rather than attw's verdict.\n`,
  );
}

// WHAT THIS LINE MAY AND MAY NOT SAY. `kind === "included"` is `containsTypes()`,
// which is "some file in the tarball has a TypeScript extension" and NOT "the
// declarations `package.json` declared are the ones present". So the pass claims
// the former only. It also must not say "no problems": `getExitCode` filters
// `analysis.problems` through `ignoreRules`/`ignoreResolutions` (and `--profile`
// sets the latter), so attw can exit 0 with a non-empty problem list, and an
// earlier draft of this line asserted "no problems" over exactly that case. The
// document carries the UNFILTERED list, so the suppressed ones are printed instead
// of being swallowed by the exit code.
const kinds = Object.keys(report.problems ?? {});
process.stdout.write(
  `✓ attw gate: ${report.analysis.packageName}@${report.analysis.packageVersion}\n` +
    `  a TypeScript-extension file is present in this tarball, and no @types package\n` +
    `  was merged in (kind=included).\n` +
    // Net 3's half of the pass line is bounded the same way: it says the declared
    // paths are IN the tarball, never that they resolve. Resolution is attw's
    // problem list, and a config can still relax the exit code that gates it.
    (declared.length === 0
      ? `  package.json declares no literal artifact paths, so net 3 had none to check.\n`
      : `  all ${declared.length} literal path(s) package.json declares are in the tarball npm\n` +
        `  would publish (net 3: presence not resolution, and wildcard subpaths are not\n` +
        `  checked).\n`) +
    (kinds.length === 0
      ? `  attw exited 0 and reported no problems.\n`
      : `  attw exited 0, but it REPORTED ${kinds.length} problem kind(s) that its exit code\n` +
        `  did not gate (--profile / ignoreRules / ignoreResolutions suppress the status,\n` +
        `  not the finding): ${kinds.join(", ")}.\n`),
);
