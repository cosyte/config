# Changelog: `cosyte-config` (repo)

Repo-level changes to this monorepo: the shared toolchain spine, the drift check, the parser
scaffold, release plumbing, and supply-chain / governance hygiene. Follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Per-package changes live in each package's own `packages/*/CHANGELOG.md`**:
`@cosyte/tsconfig`, `@cosyte/eslint-config`, `@cosyte/prettier-config`, `@cosyte/tsup-config`,
`@cosyte/vitest-config`, `@cosyte/test-utils`, each hand-maintained on the
**`0.0.x`-until-first-alpha** ladder (Changesets' own changelog generation is disabled). This file
tracks only what those don't own: the workspace root, the drift manifest/check, the scaffold
generator, CI/release, and dependency/governance hygiene. The root workspace is `private` and ships
no package, so entries here are **dated** rather than versioned.

## [Unreleased]

### Fixed

- **The parser template was still re-minting both gate holes into every new parser, and it was the
  last source of either** (TEMPLATE-REMINTS-BOTH-GATES). `scripts/scaffold-parser.mjs` mints every
  new `@cosyte/*` parser from `scripts/parser-template/`, so a hole left there is not one repo's
  defect: it is every future repo's. The two 2026-08-03 class ports had landed across the fleet and
  this template had received neither. Three halves, all measured on this tree rather than carried
  over as prose.
  - **The `attw` argument guard is now an ALLOW-LIST** (`--profile`, `--no-definitely-typed`,
    everything else refused), ported from `terminology#40`. **A deny-list bought exactly one more
    evasion per round, and this repo had already paid for two of them.** The first shape matched
    tokens, so `-fjson` was neither `-f` nor `--format` and walked through; the second matched short
    clusters per character, which closed `-fjson`/`-Pfjson`/`-Pf json` and **closed nothing else**.
    Measured here against `@arethetypeswrong/cli@0.18.4` on a pack whose tarball carries no types,
    through that per-character guard: **`--help`, `-h`, `--version` and `-V` each exited 0 with the
    untyped sentence absent and a NON-EMPTY transcript**, so the empty-output net could not backstop
    them either and the gate could not tell any of the four from a pass. The allow-list retires all
    four at once, and `--config-path`, `--definitely-typed`, `--ignore-rules` and every future
    spelling fall out for free. `--profile`'s value is still forwarded, separated or fused, pinned
    on the **ESM-only** fixture, which is the only one here attw judges differently per profile
    (measured: default reds it, `esm-only` does not, `node16` reds it). The bare-CLI premise is
    asserted **first** and the same wrapper without a profile is asserted to still red, so a dropped
    value **or a hardcoded default** reds the case. **A draft of this pinned it on the well-formed
    dual package instead, where attw returns 0 with or without a profile, so the assertion was
    `0 === 0` and a gate hardcoding `--profile strict` kept all 29 cases green.** The gate's own
    docblock says every drift between copies of a claim is a claim edited in some of them and not
    the others; this one was caught by the gate's refuter, in this diff, and is recorded rather than
    quietly corrected.
    - **The six cluster rules were deliberately NOT extended, and the per-character machinery is
      gone rather than kept beside the allow-list.** Enumerating spellings is a ceiling, not a fix.
    - **What this does NOT close, stated because the gate's own prose must not imply otherwise:**
      `readConfig()` applies a committed `.attw.json` after argv and calls `setOptionValueWithSource`
      for nearly every key, **so the config route wins regardless of the allow-list.** The
      name-scoped `.attw.json` refusal covers `quiet` and `format` only. `terminology#40`'s gate
      insisted that be **its own item** rather than a fourth round here, and it still is.
  - **The preflight's exit-code counterfactual is deleted rather than reworded**, and both branches
    of it are pinned absent. It read the MANIFEST and never the TARBALL, and the tarball is what
    `containsTypes()` keys on (`listFiles(directory).some(ts.hasTSFileExtension)`, computed before
    any entrypoint resolves), so a package whose `files` packs a whole `dist/` can lose every
    declared declaration and still hand attw an undeclared chunk declaration to find. A gate that
    reds correctly and then explains itself with a falsehood teaches the next reader the wider,
    wrong story, and this file gets copied.
  - **The preflight now reads `bin` and normalizes a path declared without a leading `./`.** Both
    measured leaving the old gate at exit 0: a manifest promising `bin: {demo: "./dist/cli.js"}` with
    no such file (attw never looks at `bin` at all), and `"types": "dist/index.d.ts"`, which is legal
    and is the spelling npm's own documentation uses. The second dropped a real promise while the
    gate still reported it had checked. `exports` leaves are left alone: Node requires `./` there.
  - **`scripts/phi-scan.ts` refuses (exit 2) an in-scope entry that is not a regular file, on BOTH
    enumerating routes**, ported from `terminology#37` plus `dicom#60`'s `--no-renames`. Measured on
    the emitted scaffold with a synthetic name-bearing payload outside the walk roots: all-mode
    exited **0** `OK: no hits`, `--staged` exited **0** after `git add`, and naming the target
    explicitly exited **1** with the hit. **The payload was detectable the whole time; the two routes
    never looked at it.** `walk()` enumerates `Dirent.isFile()`, an lstat answer, so a link is
    neither a file nor a directory and fell out silently; `--staged` reads content with
    `git show :<path>`, and git stores a link as its TARGET PATH under mode 120000, so that route was
    handed the path text. Neither route is made to follow a link, and **a refusal never prints the
    target**, which is working-tree text that can itself carry PHI.
  - **THE SCOPE PREDICATE IS SPLIT, AND THAT HALF IS THE ONE TWO SIBLINGS EACH FOUND THE HARD WAY.**
    `synth#37` and `ncpdp#54` independently shipped a single shared predicate and both had the two
    routes disagree about a `.md`-named link, because root scope and the read filter were one test.
    Here `isUnderScanRoot` decides whether an entry is the scan's business (every non-regular check
    keys on it) and the read filters decide whether a regular file's bytes are read. Pinned with a
    counterfactual: a scanner built by collapsing the two exits **0** under `--staged` on a
    `src/notes.md` link that all-mode refuses.
  - **`--no-renames` and `--diff-filter=AMT` are both load-bearing, each pinned with its git premise
    asserted first.** With rename detection on (the default), `git mv <link> test/fixtures/<name>` is
    an ordinary developer action that stages as `:120000 120000 ... R100` with two paths, which the
    status filter then deletes outright: measured, the record set was **empty** and a scanner with
    detection left on printed `OK: no hits` and exited 0 over a mode-120000 entry under the corpus
    root. Replacing an already-TRACKED fixture with a link raises `T`, which `--diff-filter=AM`
    deleted before any mode could be read. An index entry at exactly `test/fixtures` (git records
    none for a directory, so the corpus root itself replaced) is in scope too.
  - **`prepublishOnly` no longer ends in `&& pnpm attw`**, the shape `f32e7dd` removed from
    `@cosyte/test-utils` and which the template kept re-minting. `test/attw-scaffold.test.ts`
    previously asserted nothing about it on purpose; it now asserts the packing tool is absent **and
    that the rest of the chain is still there**, so the case cannot be satisfied by deleting the
    script.
  - **`test/phi-scan-scaffold.test.ts` is new, and it exists because the template's own suite never
    runs in this repo.** It travels into a scaffolded repo and runs against that repo's
    `node_modules`, so a defect in the template's scanner was invisible to this repo's CI. The new
    suite runs the REAL scaffolder and exercises the EMITTED scanner (through Node's type stripping,
    since `tsx` is not installed by a test). **9 of its 15 cases red on the pre-port template**; the
    6 that stay green are the ones that should, including the negative control and the `.md` READ
    exemption. The `attw` suite reds **20 of 29** on the pre-port gate.
  - **Deliberately NOT done here:** the template's own starter suite gains no symlink cases. Nothing
    in this repo can execute it, so shipping unexecuted tests into every new parser is worse than
    shipping none; the executed pin lives in this repo's root suite instead. Also unfixed and
    unrelated to this slice: `loadAllowList()` is called outside `main`'s `InvocationError` handler,
    so a missing allow-list escapes as an uncaught throw and takes exit **1**, the code this
    contract reserves for "hits found". Pre-existing, asserted as measured rather than as it ought
    to be.
  - No changeset, deliberately, per the two entries below: `packages/test-utils` publishes only
    `dist`, `README.md` and `CHANGELOG.md`, so nothing in any published tarball changes, and an
    unnecessary changeset silently withholds a release.
- **`attw --pack .` exits 0 on a package whose tarball carries no types, so both `attw` scripts
  this repo owns are now a wrapper that catches it** (ATTW-FALSE-GREEN-PORT; the remedy shipped in
  `@cosyte/terminology` and is ported here). `getExitCode.js` in `@arethetypeswrong/cli@0.18.4`
  opens with `if (!analysis.types) return 0`, returning **before** the problem list is read, so for
  a package that ships types a broken publish is reported as a pass. No `--profile`,
  `--ignore-rules` or config setting reaches that early return. A false red costs an hour; a false
  green merges.
  - **Reproduced on this repo's own package, with zero concurrency.** Against `@cosyte/test-utils`
    at `0.0.2`, both `rm -f dist/index.d.ts dist/index.d.cts && attw --pack .` and
    `rm -rf dist && attw --pack .` print the untyped sentence and exit **0**.
  - **Concurrency supplies the condition and is not the defect, which is why the answer is not a
    lock, a lease or a build queue.** `tsup` writes JS in one pass and declarations in a later one,
    so **every** build has a window in which `dist/` holds `.mjs`/`.cjs` and no `.d.ts`. Polling
    clean `tsup` runs on this package, the JS landed first in **every run measured, 12 of 12 across
    two independent sets**. **No width is quoted, not even a range**: the two sets disagreed about
    the spread on the same idle box, and a draft of this entry quoted a range the next set did not
    reproduce. The load-bearing fact is the order (JS, then declarations); the width is whatever the
    box was doing. The gate has to be able to say its own inputs were missing, whatever removed them.
  - `scripts/attw.mjs` carries **two nets that catch different things**: a preflight that every
    relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf
    of `exports`) exists and is non-empty, which catches the window above and **names the missing
    file**; and a post-check on the untyped sentence, which catches what the preflight structurally
    cannot, declarations present on disk but excluded from the tarball by `files`/`.npmignore`.
  - The post-check reads a string, so what would hide that string is **refused, by option and
    wholesale rather than by value**. Each blinding route was re-measured here rather than carried
    over as prose, and each exits 0 with the sentence gone: `--quiet`, `--format json`, its attached
    short form `-fjson`, and a `.attw.json` setting either (`readConfig()` calls
    `setOptionValueWithSource(..., "config")` inside the command action, **after** argv, so the file
    beats the flag). `--format table-flipped` still prints the sentence and is refused anyway: that
    over-strictness is the deliberate trade against value-parsing the guard.
  - **Short options are matched per character, not per token**, and that is load-bearing rather than
    tidy. Commander accepts an attached value (`-fjson`) and a cluster (`-Pq`), so a guard holding
    the exact tokens `-f` and `-q` lets **both straight through**: `-fjson` was measured handing back
    exit 0 over an untyped pack through exactly such a draft of this guard. attw's short options are
    `-P/--pack`, `-f/--format`, `-p/--from-npm`, `-q/--quiet`, so refusing any cluster containing `f`
    or `q` refuses nothing legitimate.
    **SUPERSEDED by the allow-list entry above, and the two halves fail differently.** The
    measurement stands and is why those spellings are still in the evidence table. The claim that the
    per-character rule "refuses nothing legitimate" does **not** stand as a description of the tree:
    `-P` is now refused like everything outside the allow-list, and the test that pinned it staying
    green is gone. Being over-strict about an argument nobody passes to a repo's own publish gate is
    the deliberate trade.
  - **`--config-path` is refused for a weaker and different reason, and the distinction is not
    pedantry.** On its own it blinds nothing: pointed at a file that does not exist, the untyped
    sentence still prints (measured). What it does is choose **which** file `readConfig()` applies,
    so pointed at one that sets `quiet` it blinds exactly like `.attw.json` (also measured). Upstream
    recorded this refusal as inferred rather than measured; both halves are measured here, and a
    draft of this entry wrongly upgraded that into "the flag blinds", which the tree contradicts.
    Both halves are now pinned by a test.
  - **THE ONE THAT MATTERS MOST IS THE TEMPLATE.** `scripts/parser-template/` is what
    `scripts/scaffold-parser.mjs` mints every NEW `@cosyte/*` parser from, so porting only
    `packages/test-utils/` would have left the defect being **re-minted into every future parser**.
    The two copies of the wrapper are kept byte-identical by an assertion, and
    `test/attw-scaffold.test.ts` runs the real scaffolder and shows the emitted gate reddening on a
    pack that bare `attw` passes. **All six of its cases red on the pre-port tree**, and the
    `test-utils` suite reds **15 of 18** there. Two of the three survivors are pure attw-behaviour
    controls, which are supposed to hold on both sides because they assert what the CLI does rather
    than what the wrapper does. **The third is not**: "still fails when attw itself fails, with
    attw's own status" is a wrapper assertion, and it survives on base only because the wrapper is
    absent there and Node's `MODULE_NOT_FOUND` exit is also `1`, which happens to equal the status it
    compares against. Do not read that one as a control.
  - `packages/test-utils/test/attw-gate.test.ts` pins both nets against the real binary, including
    **attw's own exit 0**, a negative control on a well-formed package, and that a real `attw`
    failure still fails: so an upgrade that reworks the wording or fixes the exit code reds the
    suite instead of letting the net go quietly slack.
  - No changeset accompanies this, deliberately, per the entry below and the `prepublishOnly`
    precedent: nothing in any published tarball changes, and an unnecessary changeset withholds a
    release.
  - **Known and deliberately not fixed here** (CLOSED by TEMPLATE-REMINTS-BOTH-GATES above):
    `scripts/parser-template/package.json` still ended `prepublishOnly` with `&& pnpm attw`, which is
    exactly the shape the entry below removed from `@cosyte/test-utils`, so the template was still
    re-minting it into every new parser. It was release-pipeline work and got its own slice, as
    intended. `test/attw-scaffold.test.ts` deliberately asserted **nothing** about `prepublishOnly`
    so that fixing it would not red this suite; it now asserts the fixed shape.
- **`prepublishOnly` no longer runs a tool that packs, which had broken every version bump.**
  `@cosyte/test-utils`'s `prepublishOnly` ended in `pnpm attw`, and `attw --pack .` packs a
  tarball of its own; run from inside `pnpm publish`'s staging context that pack lands where
  `attw` cannot find it, and the step dies with `ENOENT` on its own tgz. It stayed hidden because
  **`publish --dry-run` skips a version already on npm**, so the chain only ever ran on a bump. It
  first fired on the `0.0.2` Version PR (2026-07-31) and would have failed the real publish
  identically, since `changeset publish` runs `prepublishOnly` too. `attw` still runs twice, as
  its own CI step and in `Pack integrity`, so coverage is unchanged. Rule recorded in
  `RELEASING.md`: never put a tool that packs, publishes or installs into a lifecycle script that
  publishing itself invokes.
- **An empty changeset left in `.changeset/` silently withholds a release.**
  `changesets/action` publishes only when there are **zero** changeset files. With one present that
  bumps nothing it logs `All changesets are empty; not creating PR`, opens no Version PR, publishes
  nothing, and **exits green**. A repo-level note therefore belongs in this file, not in a
  package-less changeset that outlives the Version PR that would have consumed it.

### Changed

- **Published with npm provenance.** The repo is public, so every `@cosyte/*` config package now
  ships a signed SLSA provenance attestation linking the tarball to the exact commit and workflow
  that built it: verifiable with `npm audit signatures`. No API or behaviour change.
- **Every em dash is gone from the tree** (EMDASH-CONFORMANCE part 2). Measured byte level over all
  126 tracked files before the sweep: 529 occurrences of U+2014 as the literal character across 73
  files, 42 of them not markdown, plus **one in an encoded form that a literal-character sweep
  passes straight over**: the JS escape in `scripts/parser-template/package.json`'s npm
  `description`. That file is what `scripts/scaffold-parser.mjs` generates every new parser repo
  from, so the escape was on its way into the published `description` of every future `@cosyte/*`
  parser. Sweep for the encodings, never only for the character.
  - **Three occurrences carried a value rather than punctuation** and were converted by hand before
    any bulk transform ran, because a bulk rule would have turned a declared absence into a stray
    glyph: the null-cell placeholder in `experiments/perf-calibration/analyze.mjs` (now `n/a`), the
    "not applicable" cell in `ANALYSIS.md`'s runner-class table, and the 60-character separator rule
    printed by `scripts/drift-check.js`.
  - `analyze.mjs` and the committed tables under `experiments/perf-calibration/data/` were rewritten
    **consistently**, so the tables still re-derive by running the analyzer. That is this
    experiment's whole contract, and punctuating the generator and its evidence differently would
    have broken it silently.

### Added

- **The em-dash brand rule is now gated in CI** (`scripts/check-no-emdash.sh`, `check:no-emdash`,
  and `.github/workflows/no-emdash.yml`). It scans every tracked file, and separately the PR title,
  body and commit messages, which is what the rule names explicitly. The content sweep above and
  this gate landed in the **same commit**: a gate without the sweep reds CI on arrival, and a sweep
  without the gate grows the character back.
  - It runs from `verify` as well as from its own workflow. `verify` is a required status check here
    and `no-emdash` is not, so without that the gate would run, be visible, and still not block a
    merge. Making `no-emdash` required is a ruleset change, and the follow-up.
  - It **closes cross-repo residual (iv)**, which every other copy of this gate in the ecosystem
    records as a known hole and declines to close: it unsets any interposed `grep`/`xargs`/`sed`/`awk`
    shell function, and runs a **scanner-visibility probe** that refuses rather than reporting a
    clean tree when the grep in use silently skips a file. The pattern self-test cannot catch that
    case, because a tool that skips a file and a tool that read it and found it clean produce the
    same empty output and the same exit 0. Both halves were checked against a real `-I`-forcing
    interposition rather than reasoned about, as was every other refusal in the script.

- **PERF-P1: the measurement contract is now written down.** New
  `documentation/decisions/0001-perf-measurement-contract.md` (the repo's first ADR; a
  `documentation/decisions/` folder now exists here, matching `fhir`/`transform`/`cli`). It freezes,
  with PERF-P0's measured data, everything `@cosyte/test-utils/perf` will hard-code, so P2/P3
  implement a decided contract instead of re-deriving it, and **no constant in the kit lacks a
  recorded justification**. Every entry in its table is tagged _measured_ (re-derived from the
  committed datasets under `experiments/perf-calibration/data/`) or _judgement_ (P0 could not settle
  it, so the reasoning is written down instead). What it fixes:
  - **Estimator split.** `min` for the ratio _assertion_, the only estimator leaving a usable window
    (6.65…8.84 rather than 8.58…8.84), with the full sample vector retained and emitted; a **median**
    headline with the distribution beside it for the _benchmark_, since median-vs-trimmed-mean
    divergence reaches 25.6% at the tail. W2's criticism of min-of-N as a reported statistic stands.
  - **Warmup is time-budgeted, never fixed-count** (W1): ≥500 ms, stop on 3 consecutive 50 ms batches
    within ±5%, cap 5 s, and **skip loudly** if it never stabilises. The batch length is itself a
    constant with a measured motivation: at the granularity of a single ~4–9 ms pass the ±5% rule is
    unsatisfiable in 8–99% of _already warm_ phases, worst on the size axis, so the fix is coarser batches, not a looser
    tolerance. And the interaction that has to be remembered: changing the warmup rule moves the
    operating point the ceiling was set from, on both the signal and the false-alarm side.
  - **Ratio ceiling 8, floor 1.5**, both hard failures, plus a `MIN_PHASE_MS` of 4 ms below which the
    gate skips rather than answers (the fastest base phase in 3,200 samples was 4.14 ms).
  - **The perf tests come out of the coverage run** (`test/perf`): P0's pre-registered rule tripped.
  - **`src`-vs-`dist` (V4) settled both ways:** the gate keeps importing `src` through the test host
    (the calibrated regime), the reporting benchmark imports built `dist` from a plain Node process.
    Verified directly in this repo's Vitest 4.1.4 host that the SSR getter lands on _call sites in the
    test file_ and not on a same-module or hoisted-local call, so the kit's function-value API keeps
    it out of the measured loop, and it is `hl7`'s current shape that is the outlier.
  - **The GC rules for P3**, including M2 restated correctly: the boundary is whether V8 **recognises a
    key** (`type`/`execution`/`flavor`), not truthiness: `gc({})` and `gc({foo:1})` scavenge exactly
    like `gc(true)`.
  - **Two corrections carried into the roadmap's own framing rather than dropped:** the floor **cannot**
    catch dead-code elimination on the count axis (the sink does that, structurally), and "catches
    complexity-shaped regressions" now carries "**provided the fixture is large enough, and each
    package must prove that**", enforced by a per-package injected-O(n²) self-check at the sizes that
    package's real gate uses.

- **PERF-P0: the perf gate is now calibrated, before it is built.** New
  `experiments/perf-calibration/` (a committed experiment, not a published API: nothing imports it
  and it does not run in `pnpm test`) measures the three constants `@cosyte/test-utils/perf` needs
  rather than guessing them: 3,200 4N-vs-N measurements on a linear workload across `{count,size}`
  axis × `{N→4N, 4N→N}` ordering × `{coverage on, off}` on two runner classes, 320 on a deliberately
  O(n²) one, and 200 GC-fixpoint trials: all on a real **Node 22.23.1 / V8 12.4** binary,
  discharging roadmap §10/O7. Constants: **ceiling 8, floor 1.5, 3 GC calls.** Findings, in
  `experiments/perf-calibration/ANALYSIS.md`:
  - **The gate's discriminating power is much thinner than the roadmap assumes.** The "≈16 signal"
    a quadratic regression was assumed to produce is neither 16 nor a constant. It climbs with
    fixture size, and near the crossover it lands _inside_ the false-alarm tail. On the noisier
    runner the usable window between worst false alarm (6.649) and weakest real regression at
    `hl7`'s own fixture size (8.84) is a factor of **1.33**. So fixture size is a calibration
    parameter, and P2's injected-O(n²) self-check only proves anything when run at the sizes the
    package's real gate uses.
  - **`hl7`'s shipped ceiling of 10 is too high**: the weakest real regression at its own fixture
    size scored 8.84, so the shipped gate would have passed it. P4 must lower it, not just re-comment
    it.
  - **The estimator is load-bearing**: `min` caps the false-alarm tail at 6.649 where the central
    estimators reach 8.25–8.58, which would leave no window at all.
  - **V1 measured**: coverage costs 1.17–1.43× and _mostly_ cancels in the ratio, residual a few
    percent, so `hl7`'s "coverage cancels" comment is wrong as written.
  - **W1 confirmed**: after `hl7`'s fixed-count warmup the first measured rep is still up to 23%
    slower than the fifth.
  - **M2 confirmed on Node 22, with the rule corrected**: the boundary is not truthiness but whether
    V8 recognises a key; `gc({execution:'sync'})` and `gc({flavor:'last-resort'})` are major GCs,
    while `gc({})` and `gc({foo:1})` silently scavenge.

  New `perf-calibration.yml` (`workflow_dispatch` only, never a gate) takes the GitHub-hosted legs.
  The pre-registered coverage decision rule **tripped**, so P1's ADR inherits a recommendation to
  exclude the perf tests from the coverage run.

- **PHI-GATE-SUITE: `phi-scan` is now an enforced baseline script + a scaffold default.** Added
  `"phi-scan"` to `drift-manifest.json`'s `requiredScripts`, so `drift-check` fails any `@cosyte/*`
  parser that loses its commit-time PHI scanner (all six targets already carry one: `drift-check`
  stays green). To keep a **newly** scaffolded parser born-compliant, the parser template
  (`scripts/parser-template/`) now ships a **STARTER** `scripts/phi-scan.ts`: the proven shared
  machinery (`--staged` pre-commit + full-tree CI modes, synthetic allow-list, `--allow-fixture`
  override-log gate, exit codes 0/1/2, `git`-only-via-`execFileSync`) plus a cross-cutting SSN/email
  detection **floor** and a prominent, fenced TODO obligating the author to add structured,
  field-level PHI detection for their standard before relying on it. Also adds
  `scripts/phi-allow-list.txt`, `phi-scan-overrides.md`, `test/scripts/phi-scan.test.ts`, the
  `phi-scan` script + `simple-git-hooks` `pre-commit` wiring (`tsx` + `simple-git-hooks` devDeps),
  `run-phi-scan: true` on the template's CI caller, and `scripts/**/*.ts` to the template's
  tsconfig/lint/format scope.
- **REL-PIPE**: proved the publish pipeline without burning a version. New **`release-dry-run` CI
  job** exercises the publish path (`pnpm -r publish --dry-run`) + asserts every publishable tarball
  assembles (`npm pack --dry-run`) on each push/PR: auth-free, no upload, no version consumed; a red
  here means a real release would fail. `release.yml` now references an **`environment: release`**
  approval gate. New **`RELEASING.md`** documents the whole pipeline + the turnkey OIDC-trusted-
  publishing / provenance migration deferred to the public launch (PUB-FLIP).

### Changed

- `release.yml` NOTE rewritten to reflect the environment gate and the OIDC-at-PUB-FLIP reality
  (provenance auto-enables on the public flip; tokenless OIDC needs npm ≥ 11.5.1 / pnpm ≥ 10.16
  first).

### Remaining (one-time, privileged, not autopilot-doable)

- ~~**Create the protected `release` environment**~~: done. `release` carries a required reviewer
  and a `main`-only deployment-branch policy; see `RELEASING.md`.

## 2026-06-30

### Added

- This repo-level `CHANGELOG.md` (the monorepo root previously had none; per-package changelogs were
  already present).

### Changed

- **DEPS-1**: `drift-manifest.json` gained a canonical `pnpmOverrides` block and
  `scripts/drift-check.js` now **fails** any consumer repo whose `pnpm.overrides` are missing or
  divergent, enforcing the suite-wide `esbuild` (path-traversal) and `js-yaml`
  (`GHSA-h67p-54hq-rp68`) dev-dependency advisory remediation with no per-repo drift. The root
  carries the same overrides block for parity.

## 2026-06-27

### Changed

- Pinned GitHub Actions bumped via Dependabot: `actions/checkout` 4→7, `actions/setup-node` 4→6,
  `pnpm/action-setup` 4→6.

## 2026-06-26

### Added

- Dependabot config (`npm` + `github-actions`, grouped, weekly) and `CODEOWNERS`.
- `@cosyte/eslint-config` application mode (`{ library: false }`) so apps opt out of the JSDoc /
  `console` gates the libraries enforce.
- Deterministic parser scaffold generator (`scripts/`) for standard-compliant `@cosyte/*` parsers;
  the template `package.json` is born clean with a `pnpm format` step.

### Changed

- Drift check extended to require `@cosyte/tsup-config` + `@cosyte/vitest-config`.

### Fixed

- `@cosyte/test-utils` `@cosyte/*` devDependencies use the `workspace:` protocol.

## 2026-06-25

### Added

- `@cosyte/test-utils` conformance kit built out.
- The `vite` peer required for the Vitest 4 standard.

### Fixed

- npm provenance gated on public repo visibility; `NPM_TOKEN` passed explicitly to the Changesets
  publish step.

## 2026-06-24

### Added

- Initial monorepo: the shared `@cosyte/*` toolchain packages (`tsconfig`, `eslint-config`,
  `prettier-config`, `tsup-config`, `vitest-config`) + the `@cosyte/test-utils` scaffold, wired with
  Changesets.
- The **drift check** (`scripts/drift-check.js` + `drift-manifest.json`): the enforcement spine that
  keeps every consumer repo on one toolchain with no drift.
- Dogfooding CI + smoke tests + the provenance release path.

### Changed

- Baseline raised to **ES2023 + ESLint 10** (the suite's Node ≥ 22 floor).
