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
 * FOUR NETS, AND THEY CATCH DIFFERENT THINGS. Keep all four.
 *
 *   1. PREFLIGHT (structural, no string matching). Every relative artifact path
 *      `package.json` promises (the field set is enumerated once, under "THE
 *      FIELDS THIS READS" below) must exist and be non-empty before `attw` runs.
 *      This is the one that catches the window above, and it names the missing
 *      file instead of leaving the reader to infer it.
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
 *   3. THE TARBALL CHECK (structural, and independent of attw entirely). LIKE NET
 *      1 it never consults attw, so no `.attw.json` reaches either of them; UNLIKE
 *      net 1 it reads the TARBALL rather than the working tree, which is the whole
 *      of what it adds. It runs LAST, after attw has exited 0 and net 2 has
 *      passed, and it asks NET 1's question one level further out, over NET 1's
 *      OWN SET so the two cannot disagree: every relative artifact path
 *      `package.json` promises must be in the TARBALL npm would publish, not
 *      merely on disk. That set is what `declaredArtifacts()` returns, so it
 *      excludes wildcard subpaths (they name a set, not a file), absolute paths
 *      (not ours to promise), `browser` map KEYS (see below), `package.json`
 *      itself (always in the tarball by definition), and, IN THE FIELDS WHOSE
 *      GRAMMAR REQUIRES A RELATIVE TARGET (`exports`, `imports`, `browser` maps),
 *      every leaf that DOES NOT BEGIN WITH A DOT, because there such a leaf is a
 *      package specifier. Read the test literally: it is a leading DOT, not a
 *      leading `./`, so `.hidden.js` and `../outside.js` are kept and reported.
 *      Both are invalid `exports`/`imports` targets to Node itself, so reporting
 *      them is right; what would be wrong is a sentence here implying they are
 *      dropped. That exclusion is field-conditional and the pass line says so: in
 *      `main`, `module`, `types`, `typings`, `bin`, `man`, `unpkg`, `jsdelivr`,
 *      `typesVersions` and the STRING form of `browser` the prefix is optional, so
 *      a bare leaf there IS read as a path. The pass line names those exclusions rather
 *      than printing a count that reads like a total. The list comes from
 *      `npm pack --dry-run --json` run in this directory, so nothing a committed
 *      `.attw.json` sets can change the answer.
 *
 *      THE COST, MEASURED, BECAUSE IT IS NOT FREE AND WAS NOT OBVIOUS: THIS RUNS
 *      EVERY LIFECYCLE SCRIPT `npm pack` FIRES, A SECOND TIME. `npm pack
 *      --dry-run` still runs them; only the tarball write is suppressed. Measured
 *      on a well-formed fixture with `ignore-scripts` off: `prepack` fired ONCE
 *      through the base gate (attw's own nested `npm pack`) and TWICE through this
 *      one, and `prepare` and `postpack` double the same way. `prepublishOnly` does
 *      not run under `npm pack` AT ALL (measured: 0 through either gate), which is
 *      why this cannot recurse into the gate that runs it. Of the three that do
 *      double, every repo here defines only `prepare`, and defines it as the same
 *      `command -v simple-git-hooks … || true` one-liner, so
 *      nothing reds today. IT IS NOT FIXED WITH `--ignore-scripts`, AND THAT IS
 *      DELIBERATE: a `prepack` may GENERATE files that belong in the tarball, so
 *      suppressing it would make this net read a listing the real publish would not
 *      produce, which is a correctness bug wearing a performance fix.
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
 *   4. THE MANIFEST pnpm WOULD PUBLISH (structural, and it does not consult attw
 *      either). NETS 1 AND 3 BOTH GRADE THE MANIFEST ON DISK, AND THAT IS NOT THE
 *      MANIFEST THIS ORG PUBLISHES. pnpm honours `publishConfig` as a set of
 *      PUBLISH-TIME OVERRIDES and rewrites the manifest inside the tarball;
 *      `npm pack`, which is net 3's authority, leaves it alone. Re-measured here on
 *      BOTH pnpm versions this repo can run, `10.34.5` (its own `packageManager`
 *      pin) and `11.20.0` (the `mise` shim), one package, both packers:
 *
 *          manifest: main "./index.js", publishConfig.main "./absent-override.js"
 *          npm pack   -> tarball manifest main = "./index.js"          (NOT applied)
 *          pnpm pack  -> tarball manifest main = "./absent-override.js" (APPLIED, and
 *                        the tarball does not carry that path)
 *
 *      So before this net a package could pass the whole gate green and publish,
 *      THROUGH pnpm, a manifest whose `main`, `exports` and `bin` all name a path
 *      the tarball does not carry. Re-measured directly on this gate before the net
 *      was written: that fixture exited 0.
 *
 *      SO THIS NET ASKS pnpm RATHER THAN MODELLING IT. It runs a real `pnpm pack`
 *      into a temporary directory outside the package, reads `package/package.json`
 *      AND the entry list out of the tarball pnpm just wrote, and runs
 *      `declaredArtifacts()` over that manifest against that entry list. Both
 *      documents are pnpm's own bytes, so nothing here has to predict which keys
 *      pnpm merges, in which order, or what it does to them.
 *
 *      THAT CHOICE IS THE WHOLE DESIGN, AND SYNTHESISING THE MERGE WAS THE
 *      ALTERNATIVE. Applying `publishConfig` over the manifest in this file would be
 *      shorter, and it would have been WRONG in a way measurement caught and
 *      guessing would not: under `publishConfig.directory` pnpm does NOT apply the
 *      root's other overrides at all. It publishes `<directory>/package.json`
 *      verbatim and packs that subtree. Measured on a package with
 *      `publishConfig: { directory: "dist", main: "./absent-in-dist.js" }` whose
 *      `dist/package.json` says `main: "./built.js"`: the published manifest reads
 *      `./built.js`, and `./absent-in-dist.js` never appears. Reading the tarball
 *      gets that for free; a merge in this file would have had to know it.
 *
 *      IT RUNS ONLY WHEN `publishConfig` IS PRESENT, and that is a cost decision
 *      with a measured floor, not an optimisation. A real `pnpm pack` costs
 *      1.01-1.10 s on a throwaway fixture here and 1.48-2.01 s on this repo's own
 *      package, which lands as +0.9 s on the fixture's whole gate run and +1.7 s on
 *      this package's; without a `publishConfig` there is no override to grade. What
 *      the skip is NOT is a claim that pnpm and npm would otherwise pack
 *      identically: see WHAT NET 4 DOES NOT COVER below.
 *
 *      THE COST IN LIFECYCLE SCRIPTS, MEASURED THE SAME WAY NET 3's WAS: this is a
 *      THIRD round of them. On a fixture logging each hook, with `ignore-scripts`
 *      off, `prepack`/`prepare`/`postpack` each fired TWICE through the gate before
 *      this net (attw's own nested `npm pack`, then net 3's) and THREE times after,
 *      when `publishConfig` is present. `prepublishOnly` fired 0 times through
 *      `pnpm pack`, which is what keeps this net from recursing into the gate that
 *      `prepublishOnly` runs. `pnpm pack --dry-run` was measured and REJECTED for
 *      two reasons: it prints no manifest, only a file list, and it fires `prepack`
 *      and `prepare` while SKIPPING `postpack`, so it leaves a package's own
 *      bookkeeping half-run. It is not cheaper either, within the spread measured on
 *      one fixture: 0.92-1.08 s dry, 1.01-1.10 s real.
 *
 *      WHAT NET 4 DOES NOT COVER, AND NONE OF THIS MAY BE READ AS COVERED.
 *      (a) IT IS PRESENCE, NOT RESOLUTION, exactly like net 3.
 *      (b) IT GRADES WHAT pnpm WOULD WRITE ON THE BOX IT RUNS ON. The merge rule is
 *          read out of the pnpm on `PATH`; a publish driven by a different pnpm, or
 *          by npm or yarn, is a different document. Net 3 is the one that grades
 *          npm's.
 *      (c) IT DOES NOT WIDEN THE FIELD SET. The published manifest goes through the
 *          SAME `declaredArtifacts()`, so `directories` is unread in it too, and
 *          `KNOWN_UNREAD_FIELDS` covers both manifests at once.
 *      (d) IT DOES NOT RUN WITHOUT A `publishConfig`, so a difference between what
 *          npm packs and what pnpm packs that `publishConfig` did not cause is
 *          outside it. The suite measures the one case that matters here: on a
 *          package with no `publishConfig`, the manifest in a real `pnpm pack`
 *          tarball declares exactly what the manifest on disk declares.
 *      (e) NETS 1 AND 3 STILL GRADE THE ON-DISK MANIFEST AGAINST THE ROOT TREE, so
 *          under `publishConfig.directory` they are answering about a package that
 *          is not the one published. Net 4 is the net that grades the published one.
 *
 * THE FIELDS THIS READS. Nets 1, 3 and 4 all ask their question of ONE set, the one
 * `declaredArtifacts()` returns, so a declaring field missing from that set is a
 * hole in ALL of them at once and none says anything. Until this was measured
 * the set was `main`, `module`, `types`, `typings`, `bin` and `exports`, and six
 * further fields that name files were walked past:
 *
 *   `typesVersions`   `{ <range>: { <subpath>: [ <path>, ... ] } }`. The values are
 *                     paths with an OPTIONAL `./`, so they are read the lenient way
 *                     `types` is, not the strict way an `exports` target is.
 *   `imports`         Same target grammar as `exports` (`./`-relative or a bare
 *                     specifier). A `#foo` that a SHIPPED file imports and that
 *                     resolves into an unpacked file breaks the package's own
 *                     runtime resolution once installed. Node resolves a `#`
 *                     specifier only when something imports it, so this is read
 *                     STRICTLY on purpose: a `#test-helpers` pointing into an
 *                     unpacked `test/` reds here and is not a broken publish. That
 *                     is a known false red, taken deliberately, because deciding
 *                     the other way means deciding WHICH declarations are load
 *                     bearing, and this gate does not resolve anything.
 *   `browser`         A string entry point, or a replacement map.
 *   `man`             A bare string, or an ARRAY of them. `bin`'s own sibling in
 *                     the npm spec, with the same lenient path grammar, so it is
 *                     read exactly the way `bin` is.
 *   `unpkg`           A string, same grammar as `main`. CDN conventions rather than
 *   `jsdelivr`        npm ones, but a path this manifest promises either way, and
 *                     one the CDN 404s on if the tarball does not carry it.
 *
 * MEASURED, NOT PREDICTED, on one throwaway package per field, each otherwise
 * identical to the well-formed dual ESM/CJS fixture: one path on disk, left out of
 * `files`, and declared ONLY through the field under test. Every one of them passed
 * the whole gate WITHOUT its field being read: nets 1, 2 and 3 green, attw exited 0
 * and reported nothing. That is the same false-green shape net 3 was built for,
 * arriving through a field net 3 did not read.
 *
 * SAY EXACTLY WHAT PRODUCED THAT RED-BEFORE, BECAUSE IT IS NOT A BASE COMMIT.
 * `attw-gate.test.ts` reconstructs the gate by deleting the marked block below out
 * of THIS file at test time and runs the fixtures against that, so the
 * counterfactual is derived from the shipped source rather than pasted beside it.
 * It rebuilds the pre-`#59` field set, which for these fixtures is equivalent to
 * any later base, because each declares its one path through one field and nothing
 * through the others. The literal-base reading is separate and coarser: at
 * `fe2f427` a fixture naming absent paths through all four disclosed fields passed
 * the whole gate.
 *
 * ▶ WHAT IT DID NOT CHANGE, AND THIS IS THE HONEST HALF: nothing in the org moves.
 * `typesVersions` is the only one of the six that any cosyte manifest uses today
 * (`ncpdp` and `@cosyte/test-utils`), and in BOTH of them every `typesVersions`
 * target is already declared through `exports`, so the derived set is byte-for-byte
 * what it was. `imports`, `browser`, `man`, `unpkg` and `jsdelivr` have no users
 * here at all, re-derived over every manifest in the org rather than assumed. This closes
 * a LATENT hole, exactly like the `.attw.json` class above, and the claim is not
 * that anything shipped broken.
 *
 * ▶ `browser` MAP KEYS ARE DELIBERATELY NOT READ, and it is the only exclusion here
 * that is a judgement rather than a grammar. A value is what a browser build LOADS;
 * a key is what it stops loading. Reading keys would red a package that maps a file
 * away precisely because that file is not shipped to browsers, which is a false red
 * bought for no catch. `false` values fall out of the same rule with no case of
 * their own, because `false` is not a `./`-relative string.
 *
 * ▶ TWO MORE `browser` EDGES, MEASURED AND NAMED RATHER THAN CODED AROUND. (a) The
 * STRING form goes through the lenient reading, so `"browser": "some-shim-pkg"`
 * is read as `./some-shim-pkg` and reds net 1. That is the same reading `main`
 * gets and the same risk `main` has always carried; the string form is an entry
 * point by convention, not a specifier slot. (b) Net 1 requires NON-EMPTY, so a
 * 0-byte browser shim (browserify's `_empty.js` convention) reds even when it is
 * packed. Both are new false reds, both were measured, and neither has a user in
 * this org. They are written down here instead of being special-cased, because a
 * per-field exception to net 1's non-empty rule is a bigger surface than the two
 * cases it would buy. THE SAME NON-EMPTY RULE NOW REACHES `man`, `unpkg` AND
 * `jsdelivr`, on the same terms and for the same reason: a 0-byte man page or CDN
 * bundle reds, and that stays one rule rather than becoming three exceptions.
 *
 * ▶ AND THIS IS NOT AN ENUMERATION THAT BUYS ONE EVASION PER ROUND, which is the
 * shape this file has retired twice: the question is schema-sized and bounded by
 * `package.json` rather than by attw's option surface, so nothing a caller passes
 * and nothing an attw release adds can extend it. BUT IT IS NOT COMPLETE, AND AN
 * EARLIER DRAFT OF THIS PARAGRAPH SAID IT WAS. That draft was corrected to disclose
 * four fields it did not read (`man`, `directories`, `unpkg`, `jsdelivr`), with
 * the reason given as "none has a user in this org, and `man` is a LINK-TIME
 * promise rather than a resolution-time one". THAT REASON DOES NOT SURVIVE BEING
 * READ NEXT TO `bin`, WHICH IS ALSO LINK-TIME AND IS READ, so three of the four are
 * now read and the reason is retired rather than restated.
 *
 * ▶ `directories` STAYS UNREAD, AND ON A GRAMMAR GROUND THAT IS MEASURED RATHER
 * THAN A POPULARITY ONE. Its values name DIRECTORIES, and both nets grade FILES.
 * Measured on a package whose `directories.bin`/`directories.man` trees are fully
 * packed: `npm pack --dry-run --json` lists `binscripts/tool.js` and
 * `mandir/page.1` and NO directory entry at all, so net 3's `packed.files.has()`
 * would miss on every user of the field: a false red for the correctly-packed
 * case, which is the worst kind. Net 1 is no better in the other direction:
 * `statSync("./mandir").size` is 60 here, non-zero, so its "missing or empty" test
 * passes a directory without looking inside it. Reading `directories` therefore
 * needs a prefix test against the packed list, which is a second grading rule, not
 * a wider field set. It is out of this slice deliberately, and it is what the
 * KNOWN-UNREAD disclosure below now names.
 *
 * ▶ `publishConfig` IS NO LONGER ON THAT LIST, AND IT DID NOT GET THERE BY BECOMING
 * A KEY IN `declaredArtifacts()`. It is read by NET 4, which is a SECOND SOURCE OF
 * TRUTH rather than a wider field set, and the reasoning for that shape is worth
 * keeping because the short version of it is not true of every key. For a plain
 * override (`publishConfig.main` and its friends) the target has to be packed
 * anyway, so a `packed.files.has()` on it would be a TRUE red rather than a false
 * one; what widening `declaredArtifacts()` gets wrong THERE is the DOCUMENT it
 * grades, since the published manifest is not the one on disk. For
 * `publishConfig.directory` it is worse: pnpm packs a different subtree entirely and
 * publishes that subtree's own manifest, so every path net 3 holds goes wrong at
 * once, and THAT one really would be false reds. Net 4 answers both by reading
 * pnpm's tarball instead of predicting it. See net 4 above for the measurements and
 * for the five things it does not cover.
 *
 * ▶ THE DISCLOSURE IS NOW ONE STRING, READ BY THE PASS LINE AND BY THE SUITE.
 * `KNOWN_UNREAD_FIELDS` is the single copy; the pass line prints it, and
 * `attw-gate.test.ts` parses it out of this file and builds a fixture declaring an
 * absent path through each name, proving each really is unread. The sentence has
 * drifted ahead of the behaviour three rounds running because every guard on it so
 * far compared one copy of the prose to another copy of the prose. This one
 * compares the prose to the gate. It still is NOT a completeness proof: the list
 * is KNOWN-INCOMPLETE and says so, but a name on it can no longer be false.
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
 *       over in the same breath, BECAUSE A COUNT READS LIKE A TOTAL: it says
 *       "presence, not resolution", which is (b), and it NAMES THE THREE THINGS
 *       `declaredArtifacts()` LEAVES OUT of the set it counted (wildcard `exports`
 *       subpaths, absolute paths, and `package.json` itself). Without that clause a
 *       reader takes "all N paths package.json declares" for "everything the
 *       manifest declares", and for a manifest with wildcard subpaths that is
 *       false. It never says "no problems"
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
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

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
 * The fields that CAN name a file and that `declaredArtifacts()` deliberately does
 * not read. THIS IS THE ONLY COPY OF THAT CLAIM: the pass line prints it, and
 * `attw-gate.test.ts` parses this literal out of this file and proves, per name,
 * that the gate really is blind to a path declared only through it.
 *
 * That is deliberate machinery for one recurring defect. The disclosure sentence
 * has drifted ahead of `declaredArtifacts()` three rounds running, and every guard
 * on it so far compared one copy of the prose to another copy of the prose. A name
 * added here without the behaviour to match it now reds. It is still not a
 * completeness claim: see "AND THIS IS NOT AN ENUMERATION" in the docblock.
 *
 * `publishConfig` CAME OFF THIS LIST when net 4 was added, and the probe came off
 * with it: the probe asserts a path declared through the name goes UNSEEN, so
 * leaving the name here after the gate learned to see it would have reddened the
 * suite. That is the machinery working, not a special case.
 */
const KNOWN_UNREAD_FIELDS = ["directories"];

/**
 * Every relative path `package.json` promises to ship, deduped and normalized to
 * a leading `./` so two spellings of one promise are not checked twice.
 *
 * THE FIELD SET IS THE WHOLE OF WHAT NETS 1, 3 AND 4 CAN SEE, so a declaring field
 * missing from it is a hole in all three at once, silently. See "THE FIELDS THIS
 * READS" in the docblock for which fields are here, which are deliberately not, and
 * the measurement behind each.
 *
 * NET 4 CALLS THIS WITH A DIFFERENT MANIFEST: the one pnpm writes into the tarball,
 * with `publishConfig` already applied. That is why `publishConfig` is not a key
 * here even though the gate now reads it.
 */
function declaredArtifacts(pkg) {
  const found = new Set();
  // `main`, `module`, `types`, `typings`, `bin`, `man`, `unpkg`, `jsdelivr`, the
  // string form of `browser` and every `typesVersions` target are ALWAYS paths,
  // never package specifiers, and the `./` prefix is optional on all of them. Only an absolute path (not ours to
  // promise) or a pattern is skipped.
  const addPath = (v) => {
    if (typeof v !== "string" || v === "") return;
    if (v.startsWith("/") || v.includes("*")) return;
    const rel = v.startsWith(".") ? v : `./${v}`;
    if (rel === "./package.json") return;
    found.add(rel);
  };
  // An `exports` or `imports` target is required by spec to be `./`-relative, so a
  // leaf that is not one is a package specifier or a pattern, and is not a file of
  // ours. A `browser` map VALUE follows the same convention and is read the same
  // way, which is also what makes `false` (the "stub this out" form) fall out here
  // rather than needing a case of its own.
  //
  // THE TEST IS A LEADING DOT, NOT A LEADING `./`, AND THAT IS DELIBERATE: it keeps
  // `../outside.js` and `.hidden.js`, which are INVALID targets to Node and which a
  // reader is better off seeing named than silently dropped. Do not tighten it to
  // `"./"` without deciding what should happen to those, and do not describe it as
  // `./` anywhere: that sentence has already been wrong once.
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
  // Conditions nest arbitrarily and fallback ARRAYS are legal in both maps, so the
  // leaves are reached generically rather than by walking a shape this has to
  // predict. `null` targets (the "block this subpath" form) are objects to
  // `typeof` and are excluded by the truthiness test, not by a case.
  const walk = (node, add) => {
    if (typeof node === "string") add(node);
    else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v, add);
  };
  walk(pkg.exports, addTarget);
  // ---- BEYOND `exports`: the six fields net 3 was blind to --------------------
  // COUNTERFACTUAL MARKER. `attw-gate.test.ts` rebuilds the pre-fix field set by
  // deleting from here to the closing marker, so the RED-BEFORE half of that suite
  // is derived from this file rather than pasted beside it. Keep both markers; the
  // suite reds if either stops matching.
  walk(pkg.imports, addTarget);
  // `typesVersions` is `{ <range>: { <subpath>: [ <path>, ... ] } }`. Its targets
  // are paths with an OPTIONAL `./` (TypeScript's own documented example writes
  // `["ts3.1/*"]`), so they take `addPath`, and the `*` forms drop out there.
  walk(pkg.typesVersions, addPath);
  // `browser` is a bundler convention, not a Node one: a string entry point, or a
  // replacement map. Only the VALUES are read. A key is the module being replaced
  // rather than a promise about the tarball, and reading keys would red a package
  // that maps a file away precisely because it does not ship it to browsers.
  if (typeof pkg.browser === "string") addPath(pkg.browser);
  else if (pkg.browser && typeof pkg.browser === "object")
    for (const v of Object.values(pkg.browser)) addTarget(v);
  // `man` is `bin`'s own SIBLING in the npm spec: a bare string, or an array of
  // them, with the same lenient `./`-optional path grammar and never a specifier.
  // It is read exactly the way `bin` is, because the "it is only a LINK-TIME
  // promise" reason for skipping it is equally true of `bin`, which is read.
  if (typeof pkg.man === "string") addPath(pkg.man);
  else if (Array.isArray(pkg.man)) for (const v of pkg.man) addPath(v);
  // `unpkg` and `jsdelivr` are CDN conventions rather than npm ones, but the value
  // is a path into this tarball with `main`'s grammar, and a CDN serves a 404 for a
  // path the tarball does not carry. Same reading `main` gets.
  for (const key of ["unpkg", "jsdelivr"]) addPath(pkg[key]);
  // `directories` and `publishConfig` are NOT here, and neither is skipped on a
  // popularity ground. `directories` names DIRECTORIES while every net grades FILES,
  // so reading it needs a PREFIX test against the packed list: a second grading rule.
  // It is what KNOWN_UNREAD_FIELDS, declared above this function, now names on its
  // own. `publishConfig` names publish-time OVERRIDES that pnpm applies and
  // `npm pack` does not, so its targets are promises about a tarball net 3 never
  // reads; NET 4 reads that tarball and hands the manifest out of it back to THIS
  // function, which is why the answer was a second source of truth and not a key
  // here. See "`directories` STAYS UNREAD" and "`publishConfig` IS NO LONGER ON THAT
  // LIST" in the docblock.
  // ---- END BEYOND `exports` ---------------------------------------------------
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
      return {
        error: `npm listed a packed file with no "path" string, so the list is unreadable.`,
      };
    }
    files.add(entry.path);
  }
  return { files };
}

/**
 * The `path` a pax extended header sets for the entry after it, or `null`.
 *
 * A pax body is a run of `<byte-length> <key>=<value>\n` records. The length is
 * counted in BYTES and includes itself, so the walk is done over the Buffer rather
 * than over a decoded string: a multi-byte character in an earlier record would put
 * a string-indexed walk one or more positions out and silently return the wrong
 * path. Anything it cannot read returns `null`, and the caller then falls back to
 * the header fields rather than inventing a path.
 *
 * @param {Buffer} body The pax record block.
 * @returns {string | null}
 */
function paxPath(body) {
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    if (space < 0) return null;
    const length = Number.parseInt(body.subarray(at, space).toString("ascii"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || at + length > body.length) return null;
    const record = body.subarray(space + 1, at + length).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0 && record.slice(0, equals) === "path") {
      return record.slice(equals + 1).replace(/\n$/, "");
    }
    at += length;
  }
  return null;
}

/**
 * The REGULAR FILE entries of a gzipped tar archive, as a map of path to body.
 *
 * Net 4 needs two things out of the tarball pnpm wrote: the manifest inside it and
 * the list of what is beside that manifest. Both come from the same read, so this
 * walks the archive once rather than shelling out to `tar` twice: a system `tar` is
 * one more thing that has to be on the box for a Node-only gate to work, and this
 * gate is copied into every new parser repo.
 *
 * ONLY REGULAR FILES ARE KEPT. Directory records and symlinks are not files a
 * package promises, and net 3's authority does not list directories either, so the
 * two nets agree.
 *
 * A LONG PATH IS NOT IN THE HEADER'S `name` FIELD, AND BOTH ESCAPES pnpm USES ARE
 * MEASURED RATHER THAN ASSUMED. `name` is 100 bytes, and a path longer than that is
 * carried one of two ways. Both were reproduced against `pnpm pack` here, and
 * MISHANDLING EITHER IS A FALSE RED ON A CORRECTLY PACKED FILE, which is the worst
 * kind:
 *
 *   ustar `prefix`  A path that SPLITS at a `/` inside the last 155 bytes goes in
 *                   two fields. Measured on a 121-byte path: `prefix` held
 *                   `package/aaaa...` and `name` held the rest. Read `name` alone
 *                   and the entry lands under a path no manifest declares.
 *   pax `x` record  A path that cannot be split that way gets an extended header
 *                   INSTEAD, and the real entry that follows is literally named
 *                   `PaxHeader`. Measured on a 120-byte single filename: two
 *                   entries, `x` then a regular file, both named `PaxHeader`, with
 *                   `path=package/llll....js` in the `x` record's body. Skip the
 *                   `x` record without reading it and the file is invisible.
 *
 * A GNU `L` (LongLink) record is handled on the same terms. `tar` as pnpm invokes it
 * was not measured emitting one, so that branch is a safeguard rather than a
 * reproduction, and this sentence says so rather than claiming a measurement.
 *
 * @param {Buffer} gz The gzipped archive.
 * @returns {{ entries: Map<string, Buffer>, error?: undefined } | { error: string, entries?: undefined }}
 */
function tarEntries(gz) {
  let buf;
  try {
    buf = gunzipSync(gz);
  } catch (err) {
    return { error: `the tarball pnpm wrote could not be decompressed: ${err.message}` };
  }
  const entries = new Map();
  const field = (header, start, end) =>
    header
      .subarray(start, end)
      .toString("utf8")
      .replace(/\0[\s\S]*$/, "");
  /** The path a pax or GNU record set for the entry that follows it, if any. */
  let longPath = null;
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    // A zero-filled block is the end-of-archive marker.
    if (header.every((b) => b === 0)) break;
    const size = Number.parseInt(field(header, 124, 136).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      return {
        error:
          `the tarball pnpm wrote has a header at byte ${off} whose size field this gate\n` +
          `  could not read, so the archive could not be walked.`,
      };
    }
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 500);
    const body = buf.subarray(off + 512, off + 512 + size);
    // Typeflags are compared as BYTES rather than as decoded characters, so no
    // string escape for a NUL has to survive being copied between two files.
    // 0x30 "0" and 0x00 (the historical spelling) are a regular file; 0x78 "x" and
    // 0x58 "X" are a pax extended header for the NEXT entry; 0x4c "L" is GNU's
    // LongLink, whose whole body is that next entry's name.
    const type = header[156];
    if (type === 0x78 || type === 0x58) {
      longPath = paxPath(body) ?? longPath;
    } else if (type === 0x4c) {
      longPath = body.toString("utf8").replace(/\0[\s\S]*$/, "");
    } else {
      if (type === 0x30 || type === 0x00) {
        entries.set(longPath ?? (prefix === "" ? name : `${prefix}/${name}`), body);
      }
      // An extended header applies to ONE entry. Cleared after any other record so
      // it can never be read as belonging to a later one.
      longPath = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return { entries };
}

/**
 * The manifest pnpm WOULD PUBLISH and the paths beside it, read out of a tarball
 * pnpm actually wrote.
 *
 * THIS ASKS pnpm RATHER THAN MODELLING IT, and the docblock's net 4 section records
 * why: `publishConfig.directory` makes pnpm publish a DIFFERENT subtree's own
 * manifest and drop the root's other overrides, which a merge written here would
 * have had to know. Reading the tarball knows it for free.
 *
 * The tarball is written into a temporary directory OUTSIDE the package, so nothing
 * lands in a tree someone may be about to publish and nothing a later pack could
 * pick up; it is removed again whatever happens. `--pack-destination` is passed on
 * ARGV for the same reason net 3 passes its flags there, and it is ABSOLUTE because
 * pnpm resolves a relative one against the PUBLISH directory, which under
 * `publishConfig.directory` is not the directory this gate is standing in
 * (measured: `--pack-destination ./tb` wrote into `dist/tb`).
 *
 * Every shape this cannot read comes back as an error rather than as an empty set,
 * because a partial answer graded as a whole one is the false green this whole file
 * exists to refuse.
 *
 * @param {NodeJS.ProcessEnv} childEnv The environment to hand pnpm.
 * @returns {{ manifest: Record<string, unknown>, files: Set<string>, error?: undefined } | { error: string, manifest?: undefined, files?: undefined }}
 */
function pnpmPublished(childEnv) {
  let dest;
  try {
    dest = mkdtempSync(join(tmpdir(), "attw-gate-pnpm-"));
  } catch (err) {
    return { error: `could not create a temporary directory for \`pnpm pack\`: ${err.message}` };
  }
  try {
    const res = spawnSync("pnpm", ["pack", "--pack-destination", dest], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      env: childEnv,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    if (res.error) {
      return {
        error:
          `could not run \`pnpm pack\`: ${res.error.message}\n` +
          `  This net grades the manifest pnpm would publish, so it needs pnpm on PATH.\n` +
          `  Refused rather than skipped: a check that cannot run is not a pass.`,
      };
    }
    if (res.status !== 0) {
      const why = (res.stderr ?? "").trim();
      return { error: `\`pnpm pack\` exited ${res.status}.${why ? `\n${why}` : ``}` };
    }
    const written = readdirSync(dest).filter((entry) => entry.endsWith(".tgz"));
    if (written.length !== 1) {
      return {
        error:
          `\`pnpm pack\` wrote ${written.length} tarball(s) where this net can only grade\n` +
          `  exactly one. Something changed what pnpm was asked to pack.`,
      };
    }
    const read = tarEntries(readFileSync(join(dest, written[0])));
    if (read.error) return { error: read.error };
    const manifestEntry = read.entries.get("package/package.json");
    if (manifestEntry === undefined) {
      return { error: `the tarball pnpm wrote carries no package/package.json to grade.` };
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestEntry.toString("utf8"));
    } catch (err) {
      return {
        error: `the package.json inside the tarball pnpm wrote is not readable JSON: ${err.message}`,
      };
    }
    const files = new Set();
    for (const path of read.entries.keys()) {
      if (path.startsWith("package/")) files.add(path.slice("package/".length));
    }
    return { manifest, files };
  } catch (err) {
    return { error: `could not read the tarball \`pnpm pack\` wrote: ${err.message}` };
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
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
// answer. See "FOUR NETS" in the docblock for why that independence is the point.
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
// ---- END Net 3 --------------------------------------------------------------
// THE CLOSING MARKER IS EXPLICIT, and it was not always. `attw-gate.test.ts` used to
// slice net 3 out by cutting to the pass line's own comment, which meant anything
// added between the two silently left the counterfactual. Net 4 was added there and
// took `net4`'s declaration with it, and the three net 3 cases died on a
// ReferenceError that read as a plain exit 1. A named marker cannot do that.

/**
 * What net 4 concluded, in the three states the pass line has to tell apart:
 * `null` means the net is not in this build of the gate at all (the suite's
 * counterfactual deletes it), `{ skipped: true }` means there was no
 * `publishConfig` for it to grade, and a count means it graded that many paths.
 *
 * It is declared OUTSIDE the marked block below so the counterfactual copy still
 * parses, and so a deleted net prints NOTHING rather than a sentence about a check
 * that did not happen.
 *
 * @type {null | { skipped: true } | { declared: number }}
 */
let net4 = null;

// ---- Net 4: the manifest PNPM would publish ---------------------------------
// COUNTERFACTUAL MARKER. `attw-gate.test.ts` rebuilds the pre-net-4 gate by deleting
// from here to the closing marker, so the RED-BEFORE half of that suite is derived
// from this file rather than pasted beside it. Keep both markers; the suite reds if
// either stops matching.
//
// Nets 1 and 3 both graded the manifest ON DISK. pnpm publishes a DIFFERENT one: it
// applies `publishConfig` as publish-time overrides and rewrites the manifest inside
// the tarball, and `npm pack` does not. This net reads the manifest AND the entry
// list out of a tarball pnpm actually wrote, so it grades pnpm's own bytes rather
// than a model of them. See net 4 in the docblock for what it does not cover.
if (pkg.publishConfig !== null && typeof pkg.publishConfig === "object") {
  const published = pnpmPublished(env);
  if (published.error) {
    die(
      `this gate could not read the manifest pnpm would publish, so it could not check\n` +
        `  the paths that manifest declares. package.json sets publishConfig, which pnpm\n` +
        `  applies as publish-time OVERRIDES, so the manifest nets 1 and 3 graded is not\n` +
        `  the one that would be published. Refused rather than passed: an answer this\n` +
        `  net could not read is not a green one. ${published.error}`,
    );
  }
  const publishedDeclared = declaredArtifacts(published.manifest);
  const missing = publishedDeclared.filter((rel) => !published.files.has(rel.replace(/^\.\//, "")));
  if (missing.length > 0) {
    die(
      `the manifest PNPM WOULD PUBLISH declares paths its tarball would NOT carry:\n` +
        missing.map((rel) => `    ${rel}\n`).join("") +
        `\n  This is not net 3 repeating itself. package.json sets publishConfig, and pnpm\n` +
        `  applies it as publish-time overrides while \`npm pack\` leaves it alone, so the\n` +
        `  manifest above is not the manifest on disk. Both were read out of a tarball\n` +
        `  \`pnpm pack\` just wrote, so nothing here is predicted.\n` +
        `  THIS ORG PUBLISHES WITH pnpm, so this is the document that would ship: an\n` +
        `  installer would get a package whose own manifest points at paths that are not\n` +
        `  in it. Fix the publishConfig override, or pack what it names.\n`,
    );
  }
  net4 = { declared: publishedDeclared.length };
} else {
  net4 = { skipped: true };
}
// ---- END Net 4 --------------------------------------------------------------

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
      ? `  package.json declares no relative artifact paths, so net 3 had none to check.\n`
      : `  all ${declared.length} relative artifact path(s) package.json declares are in the\n` +
        `  tarball npm would publish (net 3). That set excludes wildcard subpaths, absolute\n` +
        `  paths, browser-map keys, package.json itself, and leaves of exports, imports and\n` +
        `  browser maps that do not begin with a dot; and it is presence, not resolution.\n`) +
    // THE DISCLOSURE SITS OUTSIDE EVERY BRANCH ABOVE, SO IT PRINTS ON EVERY RUN, and
    // that is not cosmetic. A package that declares everything through
    // `publishConfig` overrides has no relative artifact path of its OWN and lands in
    // net 3's zero-declared branch; net 4 grades that package now, but `directories`
    // is unread in BOTH manifests, so the sentence still has work to do on exactly
    // that run. It sat inside an else-branch for one commit while the docblock
    // claimed it printed every run.
    // NET 4's HALF IS BOUNDED THE SAME WAY, AND IT NAMES THE DOCUMENT IT READ,
    // because "the manifest pnpm would publish" is a different claim from net 3's
    // and a reader must not take one for the other. The skip sentence says only that
    // there was no override to grade: it must NOT say pnpm would publish the same
    // declarations, which is a claim this gate did not make on this run.
    (net4 === null
      ? ``
      : "skipped" in net4
        ? `  package.json sets no publishConfig, so there was no publish-time override for\n` +
          `  net 4 to grade and it did not run pnpm.\n`
        : net4.declared === 0
          ? `  the manifest pnpm would publish declares no relative artifact paths, so net 4\n` +
            `  had none to check.\n`
          : `  all ${net4.declared} relative artifact path(s) the manifest PNPM WOULD PUBLISH declares\n` +
            `  are in the tarball pnpm would write (net 4). Manifest and file list were both\n` +
            `  read out of a tarball \`pnpm pack\` wrote, so publishConfig overrides are\n` +
            `  applied; same exclusions as net 3, and it is presence, not resolution.\n`) +
    `  The field set does NOT cover every field that can name a file. Known-unread: ` +
    `${KNOWN_UNREAD_FIELDS.join(", ")}.\n` +
    (kinds.length === 0
      ? `  attw exited 0 and reported no problems.\n`
      : `  attw exited 0, but it REPORTED ${kinds.length} problem kind(s) that its exit code\n` +
        `  did not gate (--profile / ignoreRules / ignoreResolutions suppress the status,\n` +
        `  not the finding): ${kinds.join(", ")}.\n`),
);
