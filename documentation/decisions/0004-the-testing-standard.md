# 0004: The testing standard: a ratchet to 100, a change's own code at 100, mutation and property testing

- **Status:** Proposed (2026-11-09), for the owner's review before it is accepted
- **Scope:** every `@cosyte/*` package, and the shared pieces in this repository that carry the
  standard: the `./stryker` and `./mutate` entry points and the `cosyte-mutate` bin of
  `@cosyte/vitest-config` (new), the `cosyte-ratchet` bin and the `./ratchet` and
  `./changes` entry points of `@cosyte/script-utils`, its `cosyte-release-pr` bin and `./release-pr`
  entry point, the property runners of `@cosyte/test-utils`,
  and the coverage reporters of `@cosyte/vitest-config`. The CI jobs that run them in the other
  repositories live in the shared workflows of cosyte/.github and are not decided here.
- **Relates to:** ADR 0001 (performance measurement; its section 6 keeps clock-reading tests out
  of the coverage run, which this standard keeps) ·
  [`packages/vitest-config/stryker.js`](../../packages/vitest-config/stryker.js) ·
  [`packages/script-utils/ratchet.js`](../../packages/script-utils/ratchet.js) ·
  [`packages/test-utils/src/property.ts`](../../packages/test-utils/src/property.ts) ·
  [`quality-floor.json`](../../quality-floor.json) (this repository's own floor).

## Context

Our libraries read healthcare data: HL7, FHIR, X12, DICOM and the rest. A parser that is wrong
does not crash; it returns a field that is slightly off, and nobody notices until it matters. So
"the tests pass" has to mean something we can state and measure, and we intend to publish what we
measure. This record is the standard we hold every package to, written plainly enough to become
the basis of a white paper, with the numbers we measured while building it.

Before this, every package ran Vitest with v8 coverage and a fixed gate of 90 on lines, branches,
functions and statements, and every parser ran the conformance runners in `@cosyte/test-utils`
(round trip, lenient mode, immutability, warning codes, PHI leaks). Three things were missing:

1. **A number that can only go up.** A fixed gate of 90 lets a package at 98 fall to 91 without a
   word.
2. **A rule for a change's own code.** A package-wide percentage lets a new function with no test
   ride on the old code's coverage.
3. **A measure of whether the tests check anything.** Coverage says a line ran. It does not say a
   test would notice if the line were wrong.

## Decision

### 1. What we test, and why

| Technique                                  | What it answers                                                   | Where it runs                                           |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Example tests                              | does the code do what we wrote down, for these inputs             | every run                                               |
| Coverage (v8)                              | which lines, branches and functions the tests ran                 | every run                                               |
| Mutation testing (StrykerJS)               | would the tests notice if this code were wrong                    | a pull request's changed files; in full by hand for now |
| Property-based testing (fast-check)        | does a rule hold for inputs nobody wrote down                     | 100 cases a property on every run                       |
| Conformance runners (`@cosyte/test-utils`) | does a parser keep the contracts every parser keeps, PHI included | every run                                               |

Each answers a question the others cannot, and section 6 says what each one cannot catch. Section 7
says which runs exist today and which are still to come: a weekly full mutation run, a nightly deep
property run and a full mutation run before each release.

### 2. The floor file and the ratchet

Each repository keeps a floor file at its root, `quality-floor.json`: each package directory,
relative to the file, with its coverage floors and its mutation score floor.

```json
{
  "packages": {
    ".": {
      "coverage": { "lines": 97.12, "branches": 93.4, "functions": 98, "statements": 97.05 },
      "mutation": 81.2
    }
  }
}
```

`cosyte-ratchet check` compares each measured metric with its floor, prints the metric, the floor
and the gap to 100, and exits 1 on any drop. `cosyte-ratchet raise` moves each floor up to what
was measured and never moves one down. A floor is cut to two decimals toward zero, so a raised
floor is never above what was measured. Exit 2 means an input could not be read (the floor file,
a report a floor needs, git); a gate that could not read its input is never a pass. A floor file
with a key the ratchet does not know is refused, because a misspelled metric would be a floor
nobody checks.

**The floor file only rises.** `raise` cannot lower a floor, and a hand edit is caught on the pull
request: with `--base`, `check` reads the floor file as it was at the merge base and exits 1 when
the change lowered any floor in it or removed one (a metric, or a whole package). Raising a floor,
or adding a package or a metric, passes. A floor file that is new in the change has nothing earlier
to hold, and `check` says so. The comparison needs `--base`, so it runs on a pull request; a
`check` with no base (a push to main) compares measurements with the floor file as it stands.

The reports come from the shared configs: Istanbul's `coverage/coverage-summary.json` and
`coverage/lcov.info` from `@cosyte/vitest-config` (which now adds the `json-summary` reporter), and
StrykerJS's `reports/mutation/mutation.json` from `@cosyte/vitest-config/stryker`.

**How the floor relates to `@cosyte/vitest-config`'s gate of 90.** The 90 thresholds stay: one
fixed minimum for every package, which fails the test run itself. The floor is each repository's
own record, and it only rises. A package above 90 is held by its floor, and the 90 gate is a
backstop that does not fire. A package below 90 on a metric lowers that one key with
`coverageThresholds`, and its floor still holds what it measured, so the number can only rise from
there. We did not replace the thresholds with the floor (Vitest's `thresholds.autoUpdate` can
rewrite a config file's thresholds upward), because the floor also holds the mutation score, and
one file read by one tool is one rule.

### 3. A change's own code: 100%, and every exception named

On a pull request, `cosyte-ratchet check --base <ref>` holds the change's own code to 100:

- **Coverage.** Every changed line that coverage counts must have run. A changed line any
  package's suite ran counts as run, so a monorepo whose suites overlap is judged on all of them
  together.
- **Mutation.** Every mutant whose location touches a changed line must be killed (or time out,
  which also means a test noticed). A mutant that survived, or that no test reached, fails.
- **Exceptions.** A line or mutant that cannot be reached gets an inline comment that names its
  reason: `/* v8 ignore next -- the reason */` for coverage (also `start`/`stop`, `if`, `else`,
  `file`, and the `c8` and `istanbul` spellings), and `// Stryker disable next-line <mutators>:
the reason` for a mutant. `check` lists every exception in changed code, so the pull request
  carries the list, and an exception with no reason fails.

"Changed" is read from git by `@cosyte/script-utils/changes`: the diff from the merge base of the
base ref and HEAD to the working tree, plus untracked files. In CI the working tree is HEAD, so
this is exactly the pull request. A file moved without edits changes no lines. The diff pins its
own rename detection and path prefixes, so a person's git settings cannot change the answer.
`cosyte-mutate` reads changed files through the same function, so the two cannot disagree
about what a pull request touched.

Two details a reviewer should know. A coverage hint covers the statement after it, and lcov does
not say where that statement ends, so a `next`, `if` or `else` hint is taken to reach up to the
next line coverage still counts; a change anywhere in that reach lists the hint. And mutation
testing does not read coverage hints: on a probe file, the lines under a `v8 ignore` hint still
produced mutants, reported as not covered. A line that is truly unreachable needs both comments,
each with its reason.

### 4. Mutation testing

`@cosyte/vitest-config/stryker` is one StrykerJS config for the Vitest runner, beside the Vitest
config it runs (StrykerJS is an optional peer, so a package that does not mutate never installs it):

- per-test coverage analysis, so each mutant runs only the tests that reach it;
- Vitest's forks pool (Vitest's own default; StrykerJS's runner defaults to threads, where a test
  that calls `process.chdir()` fails before any mutant runs);
- static mutants ignored (`ignoreStatic: true`), with the numbers and the exception below;
- no score threshold of its own (`break: null`): the floor decides;
- the JSON report at `reports/mutation/mutation.json`, and HTML beside it;
- the same files coverage measures: `src/**/*.ts` without tests, declarations, fixtures, generated
  code and barrels.

**Barrels are read, not named.** Coverage and mutation testing leave out a barrel, a file that
holds nothing but re-exports. Both configs used to leave out every `index.ts` by name, and the HL7
parser's `src/parser/index.ts` is 688 lines that hold `parseHL7`: the parser's own entry point was
outside a 100% coverage floor and outside mutation testing. Mutated for the first time, it scored
84.29%, with 11 mutants no test reaches. Now each `.ts` file under `src/` (but declaration files)
is read, and it is a barrel only when every statement is an import that binds names or an export
of names, with at least one export. One statement of real code (a declaration, a call, a
side-effect import, a type alias), or anything the reading does not understand, makes it real code.
The two mistakes are not equal: a file wrongly called a barrel hides code from both gates, and a
barrel wrongly measured adds a few export lines to the coverage count, so when in doubt the file is
measured. A library adopting this measures every `index.ts` that holds code, so its coverage and
mutation scores can fall below its floor on the first run: the code was always there, and now it
is counted. How such a library records its floor is decided when the first one adopts this, in
that library's own change.

**Static mutants are ignored, with one exception.** A static mutant is one in code that runs once,
when a module loads: a table of patterns, a frozen map. Per-test coverage cannot tie it to the
tests that reach it, so Stryker tests each one by running every test again. On the HL7 library,
5,328 of 12,280 mutants (43%) were static, and Stryker estimated them at 94% of a full run's time;
with them ignored, the run the floor holds (the parser and the serializers, 3,328 mutants) took
33 min 41 s on 15 workers. The weekly full run is not affordable with them, and a pull request that
touches a table would mutate it whole against every test, past the 15-minute budget.

What is given up: a changed entry in a module-level table is no longer checked by a mutant. What
still holds it: coverage, which counts every such line and holds a change's own lines to 100, and
the unit tests that read each table through the functions that use it. An ignored mutant in a pull
request's changed lines is not silent: `cosyte-ratchet check --base` lists it as an exception, with
Stryker's reason ("Static mutant (and "ignoreStatic" was enabled)"), so the pull request carries
it. Ignored mutants are not in the score, so the score of a package that adopts this can move
either way on its next full run.

The exception: a package whose module-level tables are the thing it checks keeps them, with
`stryker: { ignoreStatic: false }`. The PHI-scan engine is one: its patterns are module-level code,
and they are what it is made of, so `packages/script-utils/stryker.config.mjs` keeps every static
mutant, and the engine's numbers below are unchanged by this. `@cosyte/vitest-config`'s own run
keeps them too, since its barrel reading is a set of module-level patterns.

`cosyte-mutate full` mutates everything the config names, and its score can raise the floor. Today
it runs by hand: no CI job runs it yet. A weekly run and a run before each release are future work
in the shared workflows (section 7). A full run of a large library takes hours on one machine, so
it can be split across parallel jobs: with `COSYTE_MUTATE_SHARD=<k>/<n>` set, `cosyte-mutate full`
mutates only the files whose 32-bit FNV-1a hash of the path is `k - 1` mod `n`, so each file is in
exactly one shard, and writes `reports/mutation/shard-<k>-of-<n>.json`, never `mutation.json`; the
shards' reports are merged into `mutation.json` before the ratchet reads it. With
`COSYTE_MUTATE_INCREMENTAL_FILE` set, StrykerJS keeps its incremental results in that file, so a
later run retests only what changed. A malformed shard exits 2; with neither variable set, a full
run is unchanged. `cosyte-mutate changed --base <ref>` mutates only the source
files a change touched, whole, and writes `reports/mutation/changed.json`, a separate file so a
run over a few files is never read as the package's score. A change with no changed source file
starts no run: it writes an empty report, so the ratchet can tell "ran, nothing to mutate" from
"never ran", and exits 0.

**What we measured on the PHI-scan engine.** The engine (`packages/script-utils/phi-scan.js`, 2,321
lines) runs in every parser's commit gate, so it was the first thing we measured:

| measure                       | first run, 2026-11-09      | second run, 2026-11-10     |
| ----------------------------- | -------------------------- | -------------------------- |
| mutants                       | 1,659                      | 1,659                      |
| killed / timed out            | 812 / 375                  | 889 / 292                  |
| survived / reached by no test | 206 / 266                  | 212 / 266                  |
| mutation score                | 71.55% (85.21% of reached) | 71.19% (84.78% of reached) |
| wall time, with the ratchet   | 10 min, 2,509 mutants      | 12 min 50 s, 2,505 mutants |

Both runs used 15 workers on a 16-core machine that other work was also loading. Neither the
engine nor the suites that test it changed between them, yet the score moved by 0.36 points: a
mutant that makes a loop run long is a timeout on one run and a kill or a survivor on the next,
depending on load. The ratchet compares a mutation score with its floor exactly, so a full run on a
busier machine can fail on that noise alone, and so would the weekly run once it exists. Whether a
full-run comparison should allow a small tolerance is left open for the owner (see Consequences);
it does not touch the rule for a change's own code, which needs every mutant in changed lines
killed. The 478 mutants that survived or were never reached in the second run are the engine's
mutation gap to 100. Each later pull request that touches the engine must kill every mutant in
the lines it changes.

### 5. Property-based testing

Every parser proves three properties, with the runners in `@cosyte/test-utils`:

- **Round trip** (`roundTripProperty`): `parse(serialize(x))` equals `x`, and serializing again
  changes nothing.
- **Idempotent normalize** (`idempotentNormalizeProperty`): `normalize(normalize(x))` equals
  `normalize(x)`. For most parsers, `normalize` is `(raw) => serialize(parse(raw))`.
- **Never throws in lenient mode** (`lenientNeverThrowsProperty`): hostile input becomes warnings
  with registered codes, and only the parser's sanctioned fatals may throw.

The PHI-leak runners stay as they are. "No PHI in errors" was not made a fourth property: the
diagnostic PHI runner already plants synthetic sentinels in every slot a sender controls.

**Depth.** 100 cases a property on every run, set by `DEFAULT_NUM_RUNS`. One environment variable,
`COSYTE_PROPERTY_RUNS`, sets the depth of every property in a run and wins over a runner's own
`numRuns`. A nightly job that sets it to 10,000 or more, beside the nightly fuzz job, is future
work (section 7); until it exists, every property runs 100 cases. A value that is set but malformed
throws, so a job that typed its depth wrong cannot quietly run 100.

**Replay.** A failure names the property and prints the seed and path that replay it, before
fast-check's own report:

```text
round trip: property failed after 52 case(s), shrunk 4 time(s).
Replay exactly: COSYTE_PROPERTY_SEED=791784642 COSYTE_PROPERTY_PATH=51:1:0:0:6
```

Setting those two variables (or passing `seed` and `path`) runs that one case again, already
shrunk. A nightly failure is then a local one.

**Each package's arbitraries.** The test kit ships no format knowledge. Each package exports the
generators for its formats at an optional subpath, `@cosyte/<package>/arbitraries`, which our own
tests use and a user can use to test code built on the package:

- `fast-check` is a peer dependency marked optional (`peerDependenciesMeta`), and the subpath is the
  only file that imports it, so the root entry never loads it;
- the subpath exports factory functions named for what they generate (`message()`,
  `messageText()`, `hostileInput()`), each returning an `Arbitrary` and taking an optional options
  object: one for values the serializer can emit, one for raw text the parser accepts, messy on
  purpose, and one for hostile input;
- generated values are random and synthetic; the subpath carries no fixture copied from a record.

The runners take `Arbitrary<T>` directly, so no adapter sits between a package's arbitraries and
the runners, and we ship no helper type for the subpath.

### 6. What each technique catches, and what it cannot

**Coverage** catches code no test runs. It cannot tell a line a test checked from a line a test
merely ran. We measured this on the code this record adds: the Stryker config's two modules
and the ratchet's two had 100% line coverage, and their first mutation runs scored 94.71% to
97.96%, with 40 mutants surviving on lines every test ran. Each survivor was a check a test did
not make. Coverage also cannot see code run in a child process: before this change, the eight
modules of `@cosyte/script-utils` measured 42.49% of their lines from the package's own suite and
61.42% from the root suite, because most of its gates are tested through their command lines, in
processes v8 coverage in Vitest does not follow.

**Mutation testing** catches tests that run code without checking it. It cannot catch code that is
missing: a PHI pattern the engine never had has no mutant, so no score says it is absent. It
cannot tell an equivalent mutant (a change that does not change behavior) from a weak test, so
those need a reasoned exception; while building the ratchet we found twelve, and removed each by
simplifying the code rather than excusing it. It is bounded by which tests can run against
instrumented code: three of the root suites assert on the PHI engine's own source text (its call
sites, its shipped bytes), which instrumentation changes, so they are left out of the engine's
mutation run and its score is lower than the full suite would earn. And it is slow: the engine's
runs took 10 and 13 minutes on 16 cores, so a pull request mutates only its changed files.

**Property-based testing** catches inputs nobody wrote down. It cannot prove a property holds: a
pass means the cases tried held. It cannot reach an input its arbitrary never generates, so the
arbitraries are as much a part of the test as the property. Depth matters: if one generated case
in a thousand hits a bug, 100 cases find it with probability 9.5% and 10,000 with 99.995%
(1 - (1 - p)^n); at one in ten thousand, 1.0% and 63.2%. That is why every run is meant to be fast
and a nightly run deep; until the nightly run exists, the second kind of bug is likely to be missed. On the toy parser in this repository's own tests, 100 cases of each of the
three properties took 3 to 86 milliseconds, and 10,000 took 68 to 467 milliseconds, on a busy
16-core machine.

**The conformance runners** catch a parser breaking a contract every parser keeps. The diagnostic
PHI runner proves only that the sentinels it planted, in the slots it was told about, did not echo
into a diagnostic; a slot nobody declared is not checked.

### 7. Run depths

| when               | coverage                           | mutation                                | properties                         | runs today?       |
| ------------------ | ---------------------------------- | --------------------------------------- | ---------------------------------- | ----------------- |
| every pull request | full suite; ratchet; changed lines | changed files; mutants in changed lines | 100 cases each                     | yes, in this repo |
| nightly            | as on a pull request               | none                                    | 10,000 or more each, seeds printed | no, future work   |
| weekly             | as on a pull request               | full run; can raise the floor           | as on a pull request               | no, future work   |
| before a release   | as on a pull request               | full run                                | as on a pull request               | no, future work   |

Only the first row runs today, and only in this repository: `verify` runs the coverage ratchet,
and the `mutation` job (not yet a required check) runs the changed-files run and judges its
mutants. Both compare the floor file with the merge base's. The budget for a pull request's checks
is 15 minutes: mutation of changed files runs as its own job, beside the others. The nightly,
weekly and release jobs are future work in the shared workflows of cosyte/.github. Until they
exist, no CI job compares a package's full mutation score with its floor: that happens only when
a person runs `cosyte-mutate full` and then `cosyte-ratchet check`, and properties run 100 cases
only.

### 8. How a repository adopts it

1. Use `@cosyte/vitest-config` (it writes `json-summary` and `lcov`), and run tests with coverage.
2. Add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`, and a `stryker.config.mjs`
   that exports `cosyteStryker()` from `@cosyte/vitest-config/stryker`.
3. Run `cosyte-mutate full` once. Write `quality-floor.json` with `{ "packages": { ".": {} } }`,
   then `cosyte-ratchet raise`: the floor is now today's scores, whatever they are.
4. Put `cosyte-ratchet check --skip mutation --base origin/main` in the gate, after the coverage
   run, and the changed-files mutation job in CI with `cosyte-ratchet check --skip coverage --base`.
5. Export `/arbitraries`, and prove the three properties with them.
6. Add every inline exception's reason when the ratchet asks for it, and list them in the pull
   request.
7. Give the library the two pieces section 9 asks for, a fresh-import `VERSION` test and a
   version script that regenerates the API reference, and run `cosyte-release-pr` on every pull
   request.

This repository adopted it in the same change: `quality-floor.json` holds today's measured scores
for `packages/process`, `packages/script-utils`, `packages/test-utils` and `packages/vitest-config`,
`verify` runs the coverage ratchet, and a `mutation` job runs the changed-files run; both fail a
pull request that lowers or removes a floor. Two limits,
stated rather than hidden: `@cosyte/script-utils` mutates only the PHI-scan engine and the ratchet
so far (its other gates join as their floors are recorded), and `@cosyte/process` has no mutation
floor until its first full run.

### 9. A release pull request passes its own checks

The Version Packages pull request that Changesets opens is a pull request like any other, and every
check above runs on it. Five of our libraries' release pull requests were blocked on one night for
two mechanical reasons, each fixed by hand in its own repository. Both fixes are now part of the
standard, the parser template carries both, and a shared check fails a library that lacks either.

**The exported `VERSION` string is pinned by a test the mutation run can link.** A release changes
`VERSION` in `src/index.ts` (or wherever it is declared), so the changed-files mutation run mutates
that line, and four libraries' release pull requests went red on the surviving mutant. Each had a
test comparing `VERSION` with package.json, and it did not help. `VERSION` is set once, when its
module is first evaluated, and per-test coverage links a mutant only to the tests that run while
its line is evaluated. A test file with a static import of the source evaluates the module while
the file loads, before any test starts, so no test is linked to the line and the mutant survives
however exactly a test compares it. Importing the source again inside a test of that file does not
help either: the module cache returns the copy the static import already evaluated. What works is a
test file that:

- has no static import of the source (a type-only import is fine);
- calls `vi.resetModules()`, then imports the source inside the test body,
  `await import("../src/index.js")`;
- compares `VERSION` with the version read from package.json at test time.

The parser template's `test/version.test.ts` is that file.

**The version script regenerates the API reference.** The generated reference under
`docs-content/api/` prints `VERSION`, and its drift check (`cosyte-docs-reference --check`) failed a
release pull request whose version script bumped the version and synced `VERSION` but left the
reference as it was. The version script runs, in this order:

```sh
changeset version && cosyte-process sync-version && cosyte-docs-reference && cosyte-process format
```

`changeset version` bumps package.json, the sync writes the new version into `VERSION`, and the
reference is generated from the synced source, all in the commit Changesets makes.

**A changeset's opening sentence fits a release bullet.** A third defect wedged a release after its
pull request had merged: the shared release workflow makes one bullet of each changeset's opening
sentence and refuses one over 400 characters, and it refuses it after the Version Packages pull
request has merged and consumed the changeset, when the fix is a revert. The check below reads the
pending changesets on the pull request that adds them.

**The check.** `cosyte-release-pr`, in `@cosyte/script-utils`, reads a library's tree and fails it
(exit 1) for each of these: a version script that does not run the three steps in order, no test
file of the shape above (it names each test that reads `VERSION` and what it lacks), and a pending
changeset whose opening sentence could become a bullet over 400 characters. The version rules apply
when `src/` declares an exported `VERSION`. It reads text, so it cannot tell that the test it
accepts passes; the test's own run does that. The parser template runs it in its own CI job on every
pull request, and the root suite here grades what the scaffolder emits with it.

**Who still lacks one, for the sweep.** Measured on 2026-11-12 by running the check over each
library's `main`:

| library       | version script misses the reference | no fresh-import `VERSION` test |
| ------------- | ----------------------------------- | ------------------------------ |
| `astm`        | yes                                 | yes                            |
| `ccda`        | yes                                 | yes                            |
| `cli`         | yes                                 | yes                            |
| `deid`        | no                                  | yes                            |
| `dicom`       | yes                                 | yes                            |
| `ncpdp`       | yes                                 | yes                            |
| `synth`       | no                                  | yes                            |
| `terminology` | yes                                 | yes                            |
| `transform`   | yes                                 | yes                            |
| `x12`         | no                                  | yes                            |

The commits read: astm `18b6b5d`, ccda `dd801d4`, cli `71fff3e`, deid `60f6570`, dicom `3b0abd5`,
ncpdp `f2c8169`, synth `243b991`, terminology `c5da7fe`, transform `2374b5f`, x12 `f8cc2fb`. `hl7`
(`c3bf85d`), `mllp` (`5bc58e1`) and `fhir` (`707ba32`) pass. No library's pending changesets were
over the cap. Each library takes the check into its own CI in the change that clears its row.

## Consequences

- A floor only rises: `raise` never lowers one, and on a pull request `check --base` fails a change
  that lowers or removes one. Coverage is compared with its floor on every pull request and every
  push to main, so a release is no worse on coverage than the floor. The full mutation score is
  compared only when someone runs a full mutation run, because the weekly and release runs do not
  exist yet; until they do, a release can be worse on that score than the last raise with no check
  failing, though every change's own mutants are still judged.
- A pull request's own code is held to 100 from the day a repository adopts this, whatever its
  floor says, and every exception is on the page for review.
- A pull request that changes a large file waits for that file to be mutated whole. On the PHI
  engine that is minutes, not seconds; mutating only the changed lines would be faster and is the
  first thing to revisit if the 15-minute budget is at risk.
- A full mutation score is not exactly repeatable (section 4 measured 0.36 points between two
  runs of unchanged code), and the ratchet compares it exactly. If the weekly run turns out to fail
  on noise, the fix is a tolerance on the mutation comparison only, decided by the owner, not a
  lower floor.
- Default property depth falls from 300 cases to 100 on every run. Until the nightly run at 10,000
  or more exists (future work, section 7), every property runs 100 cases, and a test that wants
  more on every run passes `numRuns`.
