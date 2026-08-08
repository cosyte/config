# Changelog: `cosyte-config` (repo)

Repo-level changes to this monorepo: the shared toolchain spine, the drift check, the parser
scaffold, release plumbing, and supply-chain / governance hygiene. Follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Per-package changes live in each package's own `packages/*/CHANGELOG.md`**:
`@cosyte/tsconfig`, `@cosyte/eslint-config`, `@cosyte/prettier-config`, `@cosyte/tsup-config`,
`@cosyte/vitest-config`, `@cosyte/test-utils`, `@cosyte/script-utils`, each hand-maintained on the
**`0.0.x`-until-first-alpha** ladder (Changesets' own changelog generation is disabled). This file
tracks only what those don't own: the workspace root, the drift manifest/check, the scaffold
generator, CI/release, and dependency/governance hygiene. The root workspace is `private` and ships
no package, so entries here are **dated** rather than versioned.

## [Unreleased]

### Added

- **`@cosyte/script-utils`**, a new zero-dependency, zero-build package, so that the entry-point
  guard every cosyte gate script needs lands **once** rather than being respelled per repo
  (`ENTRYPOINT-STRING-COMPARE`). It ships `isCliEntrypoint(import.meta.url)`. `website` (3 CLIs) and
  `docs` (4 `.mjs` gates, one of them the real `test:build` gate) hold the same shape and are the
  intended next consumers.
  - **It is imported by RELATIVE PATH inside this repo**, not as `@cosyte/script-utils`. Both gates
    here run before `pnpm install` in `ci.yml` and `release.yml` on purpose, so there is no
    `node_modules` for a bare specifier to resolve through. That is also why the package carries no
    dependencies and no build step.

### Fixed

- **A crafted `--title` could scaffold a repo whose `package.json` names a DIFFERENT PACKAGE, while
  the generator printed `Scaffolded @cosyte/<name>` and exited 0** (`CONFIG-SCAFFOLD-RESIDUALS`).
  The title is substituted verbatim into every template file carrying `{{TITLE}}`, and nothing
  checked it. At `e76939f` every title below exited **0** with a success banner:
  - `Bad "Q" Title`, `Bad \ Title`, a raw newline and a raw tab each emitted a `package.json`
    **nothing can parse**.
  - **U+2028 / U+2029 were found while measuring, not predicted from a list.** They are legal raw
    inside a JSON string, so no amount of JSON care catches them, but they are ECMAScript **line
    terminators**: they end the line comments they land in and the emitted TypeScript stops parsing.
  - A `*` followed by a `/` closes the JSDoc block in the emitted `src/index.ts`.
  - `Title {{NAME}} here` shipped an **unsubstituted placeholder** into the README and into the
    published package `description`; `{{Pascal}}` was silently rewritten by a token that runs later.
    Neither is the title that was asked for.
  - `X", "name": "@evil/pwned", "x": "` emitted a `package.json` that **PARSES CLEANLY and names
    `@evil/pwned`**. **This is the silent case the item was filed for, and it was worse than the
    filed description.**
  - **What `d3df2f3`, this change's base, already did - stated in two sentences, because a per-row
    account of it was written wrong twice.** `#57`'s format step parses the emitted manifest and
    runs prettier over the emitted tree, so at base the first three bullets above already exit 1 -
    but only after a full broken tree has been written to disk, and the line-terminator and
    block-comment cases are reported as a formatting failure rather than as the title that caused
    them. **The placeholder and injection bullets still exit 0 with the success banner at
    `d3df2f3`**, and they are why this exists: handing back a **working** repo that carries someone
    else's package name, or an unsubstituted token in a published `description`, is worse than
    handing back a broken one loudly.
  - **The remedy is refusal at the door plus an identity check on the way out, and deliberately NOT
    escaping.** The same string lands in four syntaxes at once (a JSON string, a JSDoc block, line
    comments, Markdown prose), so no single escaping is correct in all of them: JSON-escaping the
    value would put a literal backslash-quote in the README, and nothing you do to quotes rescues a
    block-comment terminator. "Escape it properly" therefore means one escaper per destination plus
    a router that knows which file is which - real machinery, to carry a display string that has no
    legitimate reason to hold any of these characters. `validateTitle()` refuses instead, with a
    typed message naming the character (`U+0022 QUOTATION MARK`), its offset, and the destination it
    breaks, and it runs **before the first file is written**, so a refusal never leaves a
    half-written repo behind.
  - **`assertEmittedManifest()` is the second guard and is not a restatement of the first.** It
    checks that the emitted manifest names the package that was asked for and carries the title it
    was given. The injection case is precisely why: that manifest **parses**, so only an identity
    check sees it. If the accept-set is ever wrong or widened, the silent class cannot return.
  - **Each rule is tied to a measured breakage, and two candidates were REFUSED for lack of one:**
    `U+007F` (legal raw in JSON, not a line terminator) and a 300-character title (nothing reflows a
    comment, so the emitted tree stays format-clean) are both accepted.
  - **How far the accept-set reaches, stated no wider than it holds.** It is complete for the two
    destinations where a title can produce an artifact that does not **parse**: JSON (RFC 8259
    forbids exactly `"`, `\` and raw `U+0000`-`U+001F`) and TypeScript (only LF, CR, U+2028 and
    U+2029 end a line comment; only a block-comment terminator ends a block one). It is **not**
    complete for Markdown, deliberately: `Bad *emph* Title` is accepted, and prettier-on-emit
    normalises it to `Bad _emph_ Title` in whichever emitted Markdown its globs reach, while
    `package.json` and the Markdown they do not reach keep the raw bytes. That divergence is
    **`PRE-EXISTING`** - it arrived with `#57`'s formatting step, is identical on this change's
    base, and yields a repo that builds, publishes and gates green - so it is named rather than
    fixed by refusing titles on cosmetic grounds.
  - **`test/scaffold-title.test.ts` proves it on the real generator**, red before and green after
    (13 failing cases -> 19 passing), with a conformant control that asserts the emitted manifest
    parses, names `@cosyte/probe`, carries its title, and leaves no `{{...}}` token anywhere in the
    34-file tree. **Three counterfactuals rebuild the generator with one or both calls textually
    removed** and measure that the guards are independent: strip both and the exit-0 `@evil/pwned`
    scaffold comes straight back; strip either one alone and the other still catches it. **The
    counterfactuals cover the injection and a quoted title**: the two ends of what these guards do,
    a manifest that parses and lies and one that does not parse at all. Every other case is asserted on the branch's
    behaviour - a refusal, before any write.
  - **The emitted tree is unchanged for conformant input, proved rather than assumed**: the
    **34-file** emitted tree is `diff -r` clean against the previous generator for `a`, `hl7`,
    `terminology`, `a-a-a-a-a-a` and an explicit `--title "C-CDA R2.1"`. **`--help` is NOT
    byte-identical, and should not be**: `--title`'s contract narrowed, so `--help` and the file
    header now say what it will refuse. `prettier --write` was run **only on the paths this change
    opened**, never across the tree.
  - **The item's own description was corrected by measurement:** at `d3df2f3` the invalid-manifest
    class surfaces as a **typed exit-1 refusal**, not an uncaught stack trace. What `#57` genuinely
    left open was the silent injection, and that is what this closes.

- **Every parser this repo has ever scaffolded was born with a red `format:check`, and the emitted
  tree is now formatted on emit** (`CONFIG-SCAFFOLD-BORN-UNFORMATTED`). `scripts/parser-template` is
  `.prettierignore`d **wholesale**, because it carries `{{PLACEHOLDER}}` tokens and is not valid TS
  or JSON until it has been generated. Nothing formatted the template, and nothing formatted the
  emitted tree either, so a brand-new repo's first CI run failed on whitespace: `format:check` is a
  gate in the shared workflow the emitted `.github/workflows/ci.yml` calls. `#56` widened this
  repo's own globs to read `.mjs` and closed the half a glob can reach; **no glob can reach this
  half, because the input does not exist until the generator runs.**
  - **It is package-name-length dependent, which is why one probe reads clean and proves nothing.**
    Substitution moves line lengths in **both** directions. Measured on this template with the
    format step removed: `cli`/`x12`/`hl7` (3 chars) red only
    `test/property/round-trip.property.test.ts`, because a short name shortens an already-wrapped
    import until prettier wants it collapsed; `terminology` (11) reds only `src/index.ts` and
    `test/docs-content.test.ts`, because a long one pushes a signature and a ternary past 100.
    **Those two sets are disjoint**, so measuring either end clears neither. A third regime appears
    when only the PascalCase identifier moves: `a-a-a-a-a-a` is the same 11 characters but the
    generator drops hyphens when it builds the identifier, and it reds a third set again.
  - **So the fix is not a line edit, it is running the formatter.** `scripts/scaffold-parser.mjs`
    now runs prettier over the tree it emitted, then **proves it with `--check`** rather than
    treating "we ran `--write`" as evidence (`--write` is not idempotent in general). The emitted
    bytes are a fixed point of prettier for every name at every length, with nothing to keep in step
    with the template's line lengths.
  - **What it formats is derived from the emitted repo, never listed in the generator.** The globs
    come out of the emitted `package.json`'s own `format` script, and the verification uses its
    `format:check` script, so the set formatted on emit and the set checked in CI cannot disagree.
    A script shape the generator cannot parse **refuses loudly** instead of formatting nothing,
    which would be the same never-pointed-at-its-input defect one level up.
  - **The generator gains two dependencies of this repo** (`prettier`, `@cosyte/prettier-config`),
    resolved **before the first file is written** so a missing `pnpm install` refuses with nothing on
    disk. It is no longer stdlib-only, and its header says so.
  - **Proved semantics-free apart from formatting, rather than assumed**: `--help` is byte-identical
    to base, and for `a`, `hl7`, `terminology` and `c-cda` the **34-file** emitted tree is `diff -r`
    clean against the base generator's output run through `prettier --write`. The only deliberate
    behaviour change is the "Next steps" line, which no longer tells the author to run `pnpm format`.
    `prettier --write` was run **only on the two paths this change opened**, never across the tree,
    because of the code-span-inside-bold-span non-idempotency hazard.
  - **`test/scaffold-format.test.ts` is the guard, and its probe set is derived rather than listed.**
    The real ends come from `drift-manifest.json`'s `targets` (the roster of parser repos this
    generator exists to mint), so they track the ecosystem instead of going stale beside it; the
    absolute ends come from the generator's own name rule and from `printWidth` read out of
    `@cosyte/prettier-config`. **Measured red before and green after on all five probes.** The
    checked census is re-derived every run with prettier's own glob expansion rather than counted by
    hand, and a **counterfactual rebuilds the pre-fix generator** by textually removing the format
    call, asserting that the substitution really changed the file, that every probe reds without it,
    and that the two real name lengths red **disjoint** sets. If that disjointness ever stops
    holding, the guard reds and the probe set has to be re-derived rather than trimmed.
  - **Named, not fixed, and out of this slice:** the template pins `@cosyte/prettier-config` at
    `^0.0.2` while this repo builds `0.0.4`, which under caret-on-`0.0.x` are different releases.
    Measured rather than reasoned from the changelog: `index.json` is **byte-identical across all
    four published versions and the working copy** (sha256 `605a669523ab8b44...`), so nothing is
    hidden today; a settings change shipped without moving the pin would be.
  - **An unreadable emitted manifest now refuses loudly too**, rather than throwing an uncaught
    `SyntaxError` out of the new derivation step. The one reachable cause is `--title`, which is
    substituted into the emitted `package.json` **without JSON escaping**, so a title carrying a
    quote or a backslash emits a manifest nothing can parse. That unescaped substitution is a
    separate, **pre-existing** defect and is not fixed here: on the base generator the same input
    exits **0** and hands over a repo whose `package.json` is invalid JSON, silently.

- **`format:check` never read a single `.mjs` file, and reported success for it**
  (`CONFIG-FORMAT-CHECK-SKIPS-MJS`). The root globs named `{js,ts,json,md,yml,yaml}` while the repo
  tracks **eight** `.mjs` files, **seven** of them outside `.prettierignore` and so in scope for
  these globs. Those seven include every gate script this repo runs before `pnpm install`
  (`changeset-guard.mjs`, `release-notes.mjs`, `scaffold-parser.mjs`) and the published
  `attw` wrapper in `packages/test-utils/scripts/`. A glob that omits an extension reports a pass
  rather than "no such input", so nothing in CI could tell "checked and clean" apart from **never
  looked**. That is how a 101-character line in `attw.mjs` reached review under `#55` with a green
  `format:check` behind it; the refuter caught it, this repo's own gate did not.
  - **Widened to `{js,mjs,ts,json,md,yml,yaml}`, on both `format` and `format:check`.** Measured red
    before and green after: on the base glob `pnpm format:check` exits 0; widened and unformatted it
    exits 1 naming `scripts/scaffold-parser.mjs`; formatted it exits 0.
  - **One file was actually dirty**, `scripts/scaffold-parser.mjs`: a 119-character `node:fs` import
    and a double-quoted string carrying escaped quotes. Both changes are syntactic. Proved rather
    than assumed: the generator's `--help` output is byte-identical before and after, and so is the
    entire **34-file** tree it emits. The other six files were already conformant and are byte-
    unchanged, so the assertion holding `packages/test-utils/scripts/attw.mjs` and its
    `scripts/parser-template/` twin byte-identical still holds.
  - **The census is derived on every run, never written down.** `test/format-coverage.test.ts` pipes
    `git ls-files` through prettier's own `getFileInfo()` and fails naming any tracked, non-ignored,
    prettier-parseable file the globs do not reach. A hand-written extension list is a claim, and it
    is exactly the shape that went stale here; this one goes red the first time a `.cjs`, `.mts` or
    `.css` lands unmatched. It also pins `format` and `format:check` to the same extension set (drift
    either way is a violation shipping green, or a red CI with no local remedy), refuses a glob shape
    it cannot derive coverage from instead of passing vacuously, and refuses an empty census, which
    is the same never-looked failure it exists to catch.
  - **What the guard compares is extension sets, not file sets**, which is strictly weaker than
    "prettier reads every such file" and is said so in the test rather than left to be assumed.
    `getFileInfo()` is given only `.prettierignore` while the prettier CLI defaults to
    `[".gitignore", ".prettierignore"]`, so a file ignored by `.gitignore` alone counts in the census
    and is skipped by the CLI. The two file sets are identical today, so nothing is hidden; a green
    simply does not prove on its own that they still are.
  - **A gate that reads `git ls-files` cannot see an untracked file**, which is how the first cut of
    this very change ran `check:no-emdash` green over a new file the gate had never been handed.
    Recorded because it is the same shape as the defect being fixed, one level up: run the tracked-
    file gates **after** staging, never before.

- **The `attw` gate now checks that the paths `package.json` DECLARES are in the tarball, not just
  that some TypeScript-extension file is** (`ATTW-INCLUDED-IS-NOT-THE-DECLARED-TYPES`). This is a
  **hole nothing currently walks through, closed on purpose rather than a bug anyone hit**: no repo
  in the org ships a `.attw.json`, so every route below is latent, and **all 13** sibling repos with
  an `attw` script were measured to pass the new check unchanged. (The census is
  `git submodule status` filtered by `scripts.attw`, re-derived rather than remembered: a first
  hand-written list of it said 12 and had dropped `astm`.)
  - **The hole.** Net 2 asserts `analysis.types.kind === "included"`, and `"included"` is
    `containsTypes()` in `@arethetypeswrong/core`, i.e. `listFiles("/").some(ts.hasTSFileExtension)`:
    i.e. ANY TypeScript-extension file anywhere in the tarball. Net 1 does not see the case either,
    because it reads the WORKING TREE while the loss is in the `files` field. So a package that
    loses every DECLARED `.d.ts` while packing one stray one sat behind attw's own exit code alone,
    and a committed `.attw.json` relaxes exactly that.
  - **Measured, on the pinned `@arethetypeswrong/cli@0.18.4`.** Against a package whose declared
    `./dist/index.d.ts` is out of `files` while an undeclared `./dist/internal.d.ts` is packed, bare
    attw exits 1, and the gate exited **0** under `{"ignoreRules": [...]}`, under
    `{"ignoreResolutions": [...]}`, and under `{"entrypoints": []}`. All three now red, and each is
    pinned with a counterfactual built by slicing net 3 out of the shipped wrapper at test time.
    `{"profile": ...}` was measured NOT to relax this case, for all three of attw's profiles, and is
    recorded as such rather than repeated as a fourth route.
  - **Net 3 reads npm, not attw.** It runs `npm pack --dry-run --json` and requires every declared
    path to be in the listing. **It is not the key deny-list this file has retired twice, and cannot
    decay into one**: it never reads `.attw.json`, so an unenumerated key is not a hole in it, and
    the set it checks is bounded by the manifest rather than by attw's option surface. `--dry-run`
    and `--json` are on argv because `json` is an ordinary npm config an ambient
    `npm_config_json` would otherwise pick. An unreadable listing FAILS CLOSED.
  - **The alternative was rejected on a measurement, not a preference.** Gating on attw's own
    UNFILTERED problem list would close two of the three routes and not the third (an empty
    `entrypoints` means attw analysed nothing, so there is no finding to read). It would also red
    healthy packages that ship today: `mllp`, `deid`, `synth` and `cli` all pass `--profile node16`
    and **all four** carry a suppressed `NoResolution` their profile silences on purpose.
  - **What it does NOT claim, stated because two earlier drafts of this gate's prose claimed more
    than it proved, the second more strongly than the first.** Net 3 proves PRESENCE, never
    RESOLUTION, and the pass line is bounded twice in the same breath as its count, because a count
    reads like a total: it says "presence, not resolution", and it names the three things the set it
    counted leaves out (wildcard `exports` subpaths, absolute paths, and `package.json` itself).
    The config route is **narrowed, not closed**: a package whose declared paths are all packed and
    whose types resolve wrongly still passes under a config that relaxes attw's exit code. That
    residue is itself a test, so a future draft cannot quietly widen the claim.
  - **It runs every lifecycle script `npm pack` fires a second time**, and that is disclosed rather
    than suppressed. `npm pack --dry-run` still runs them; only the tarball write goes away. Measured
    with `ignore-scripts` off: `prepare`, `prepack` and `postpack` each fired ONCE through the base
    gate and TWICE through this one, while `prepublishOnly` fired **zero** times through either, so
    this cannot recurse into the gate that runs it. Nothing reds today: of the three that double,
    all 13 siblings and the template define only `prepare`, as the same
    `command -v simple-git-hooks … || true` one-liner. It is deliberately **not** fixed with
    `--ignore-scripts`, because a `prepack` may generate files that belong in the tarball and
    suppressing it would make this net read a listing the real publish would not produce.
  - **🩺 A TEST FIXTURE THAT SYMLINKS A pnpm `.bin` ENTRY INTO A TEMP TREE IS A BOX-DEPENDENT TEST,
    and this one passed locally and failed on the runner.** The counterfactual needs the net-3-less
    wrapper somewhere it can still resolve `../node_modules/.bin/attw`. Linking only that one bin
    left three cases dying in ~70 ms with a module-not-found before `attw` ever ran, so CI reported a
    failing gate for a gate that was fine. Linking the WHOLE `node_modules` directory turned the
    runner green (measured on the runner: red before, green after, on Node 22 and 24 alike), and a
    liveness assertion was added so a counterfactual that dies can never read as one that ran.
  - **▶ THE MECHANISM SENTENCE THAT FIRST ACCOMPANIED THAT FIX WAS WRONG AND IS DELETED RATHER THAN
    REWRITTEN.** It said the dev container writes an absolute `.bin` shim and the runner a portable
    one, and that linking the directory is "right for both shapes". Refuted by measurement: the
    absolute shim in this container is a hand-written artifact that **no `pnpm install` recreates**
    (it is the only non-portable entry of the ten bins beside it), a stock install writes a shim that
    climbs several levels, and **Node collapses `..` lexically**, so no symlink placed at the temp
    tree is on the path such a shim resolves. **The construction is therefore STILL BOX-DEPENDENT,
    and a fresh clone plus a stock install reds these three cases ON THE BASE COMMIT TOO.** Linking
    the directory is strictly better than linking the bin everywhere it was measured, and it is not a
    general fix. Named, not closed: the counterfactual should reach `attw` without depending on the
    shim's relative reach. **Never infer a package manager's shim shape from the box you are on**,
    and when a measurement cannot be reproduced, delete the claim instead of restating it.
  - Both byte-identical copies carry it (`packages/test-utils/scripts/attw.mjs` and
    `scripts/parser-template/scripts/attw.mjs`), so every scaffolded parser inherits it. **The 13
    existing sibling repos carry their own older copies and are unchanged by this**; porting is
    theirs, not this repo's.
  - **No changeset, deliberately**, following this repo's own precedent (`cf07086`, and `#42`/`#44`/
    `#47`): `scripts/` and `test/` are outside every published tarball, verified against
    `@cosyte/test-utils`' own `npm pack` listing, so nothing published changes, and an unnecessary
    changeset silently withholds a release.

- **The `attw` gate's post-check now reads attw's STRUCTURED output, so the three `.attw.json` keys
  that blinded it no longer can** (`ATTW-CONFIG-ROUTE-BLINDS-THE-GATE`). `readConfig()` applies the file AFTER
  argv and calls `setOptionValueWithSource` for every key except `configPath`/`help`/`version`, so a
  config beats every argument the gate passes and the argument allow-list never reached it. The gate
  now forces `--format json` onto the `attw` child, parses stdout, and asserts
  `analysis.types.kind === "included"`.
  - **The route that mattered, reproduced end to end.** `{"definitelyTyped": "./x.tgz"}` naming a
    `@types/<name>` tarball makes an untyped package analyse as fully typed: `checkPackage` in
    `@arethetypeswrong/core` sets its verdict from `pkg.typesPackage` alone and never re-reads the
    tarball once a DefinitelyTyped package is merged in. Measured against a package whose tarball
    carries no declaration file anywhere, the previous gate **exited 0**; it now reds. The merge
    happens even when the gate passes `--no-definitely-typed`, because the config overwrites the flag.
  - **The parse closes the other half, and it fails CLOSED.** `{"quiet": true}` empties stdout and
    `{"format": "table"}` beats the gate's own `--format json`; neither leaves parseable JSON, so both
    red without being named anywhere. Routes nobody has enumerated red the same way, which is the
    property a name-scoped refusal could never have.
  - **The two-key `.attw.json` deny-list is DELETED, not extended.** It refused `quiet` and `format`
    by name, which is the shape the argument guard had already retired, and `definitelyTyped` walked
    straight past it. No key list replaced it.
  - **Named for what it checks, and NO WIDER. The config route as a whole is NOT closed, and the
    prose says so rather than implying otherwise.** `"included"` is `containsTypes()`, meaning SOME
    TypeScript-extension file is in the tarball, not that the DECLARED declarations are. A package
    that leaves its declared `dist/index.d.ts` out of `files` while packing an undeclared
    `dist/internal.d.ts` is caught only by attw's own exit code, and a config setting `ignoreRules`,
    `ignoreResolutions` (which `readConfig()` does not even validate), `entrypoints` or `profile`
    relaxes that exit code and passes it. Measured on the base as well as here, so it is neither
    introduced nor fixed by this change; it wants its own item. **No repo in the org ships a
    `.attw.json` today, so all of it, closed and open alike, is LATENT rather than live.**
  - **The pass line was corrected to match.** An earlier draft said "attw found no problems", which
    is false whenever `--profile` (which several sibling manifests pass) suppresses a resolution:
    `getExitCode` filters the problem list for the STATUS while `analysis.problems` keeps every
    finding. The gate now prints the suppressed kinds instead of swallowing them, and the failure
    path renders a problem digest rather than dumping raw JSON.
  - **`maxBuffer` is set (64 MiB).** `--format json` is 20 to 50 times the size of the table the gate
    used to read (~56 kB for this repo's own package; ~245 kB for one entrypoint over an unbundled
    declaration tree), and `spawnSync`'s 1 MiB default would have turned a large but healthy package
    into an `ENOBUFS` red the previous gate passed.
  - Carried into both byte-identical copies of the wrapper, so every newly scaffolded parser inherits
    it, and `scripts/parser-template/CLAUDE.md` now states which half is closed and which half is
    still open. **8 new cases** pin it (18 to 26 `it()` declarations in
    `packages/test-utils/test/attw-gate.test.ts`, measured). The cases that close a route were each
    measured RED against the previous gate; the one pinning the still-open `ignoreRules` hole is green
    on both sides BY DESIGN, because its job is to red if someone closes that hole without correcting
    the prose.
  - **No changeset, deliberately:** `scripts/` and `test/` are in no package's `files`, so no
    published tarball changes and a changeset would burn a version on identical bytes.

- **Both release gates went silent, exit 0, having graded nothing, for three ordinary invocations**
  (`ENTRYPOINT-STRING-COMPARE`). `scripts/changeset-guard.mjs` and `scripts/release-notes.mjs` each
  decided whether to run their CLI body with
  `` import.meta.url === `file://${resolve(process.argv[1])}` ``, which compares two STRINGS rather
  than two paths. Measured on Node 22.23.1, it answers `false` for:
  - **a symlinked invocation**, because Node resolves the main module to its real path while
    `argv[1]` keeps the link. This one reaches the gates in this repo today.
  - **a checkout under a path containing a space**, because `import.meta.url` percent-encodes it
    (`/space%20dir/`) and concatenating `file://` onto a raw path does not.
  - **an extension-less specifier** that Node or `tsx` resolved (`node scripts/gate` running
    `scripts/gate.js`). Not reachable for a `.mjs` file, since Node's extension-less main resolution
    tries `.js`/`.json`/`.node` only, but it is the form that bit the first attempt at this fix
    elsewhere and the helper covers it.
  - **Why this was worth a slice.** A gate that never ran exits 0, and so does a gate that ran and
    passed. The two are indistinguishable from the exit code, which is the only thing anyone reads.
    `test/is-cli-entrypoint.test.ts` therefore asserts observed behaviour rather than a bare exit 0,
    and carries the old spelling as a live control: 5 of its cases are red against it and green
    against `isCliEntrypoint`.

- **The `attw` gate no longer breaks when it runs inside a `publish --dry-run`, which had made the
  first version bump in months un-mergeable** (`CONFIG-PREPUBLISH-ATTW-ENOENT`).
  `packages/test-utils/test/attw-gate.test.ts` shells out to a real `attw --pack`, `prepublishOnly`
  runs `pnpm test`, and `pnpm -r publish --dry-run` runs `prepublishOnly`: seven cases red with
  `ENOENT: ... attw-gate-fixture-unpacked-1.0.0.tgz` on the `0.0.3` Version PR (#46), on a tree whose
  only change under `packages/test-utils/` was its `CHANGELOG.md`. It was invisible until then
  because **`publish --dry-run` SKIPS a version already on npm**, so the chain runs on nothing but a
  bump.
  - **The mechanism, measured at both ends.** `pnpm publish --dry-run` exports
    `npm_config_dry_run=true` into every lifecycle script it runs; `npm pack` honours it and writes
    no tarball; `attw` opens the path it computed from the manifest (`<dir>/<name>-<version>.tgz`)
    and never asks npm where the file went. `npm_config_pack_destination` is the same fault from the
    other side. **The underscore spellings always arrive; the hyphenated key npm also honours
    depends on a shell, not on npm**: attw packs with `execSync("npm pack")`, so the variable crosses
    `/bin/sh`, and `npm_config_dry-run` is not a valid shell identifier, which dash (what Debian and
    Ubuntu ship as `/bin/sh`) drops and bash forwards. The strip is a case-insensitive superset that
    covers the hyphen on either shell, and the suite MEASURES which shell it is rather than asserting
    one answer. Two earlier drafts of that case got it wrong in opposite directions, which is
    recorded beside it.
  - **The fix is at the source, not in the caller**: `scripts/attw.mjs` strips those two keys, and
    only those two, from the environment of the `attw` child. `npm_config_registry` and the rest are
    deliberately left alone, because they change what attw RESOLVES rather than where npm writes.
    Both copies of the wrapper move together (the byte-identity test), so every scaffolded parser
    inherits it. Nothing about what the gate checks changed: same argument allow-list, same
    preflight, same post-check.
  - **Planted, not asserted.** The suite strips the same two keys from its own subprocesses (it is
    itself run from `prepublishOnly`) and then plants them back: on the bare CLI, where the two
    underscore spellings must still produce ENOENT with attw's untyped sentence absent, and on the
    wrapper, where they must not. The hyphenated spelling's bare-CLI outcome is shell-dependent, so
    that case probes `/bin/sh` and asserts whichever answer this box gives, and is explicit that on
    dash its wrapper half is coverage rather than a pin. A negative control pins that a package which
    reds on its own merits still reds with the plant. Base measurement, on the failing condition: 7
    of 29 red. With the fix: 35 of 35 green.
  - **Two claims in the entry below are RETRACTED**, and the prose in `RELEASING.md`,
    `scripts/parser-template/CLAUDE.md` and `test/attw-scaffold.test.ts` is corrected rather than
    quietly reworded. The pack does not "land where attw cannot find it" in a staging context: it is
    never written. And a real publish would **not** have failed identically, because a non-dry-run
    `pnpm publish` sets no `dry_run` (measured: its lifecycle environment carries `registry`,
    `cache`, `user_agent` and nothing else that moves a pack). This class has never broken a release;
    it breaks the dry run that exists to prove one, which is what blocks a Version PR.
  - **No changeset, deliberately.** `scripts/` is not in any package's `files`, so no published
    tarball changes. A changeset here would burn a version on identical bytes.

### Added

- **`scripts/changeset-guard.mjs`: an inert changeset can no longer withhold a publish on a green
  run** (`DEPENDABOT-PR-QUEUE`, item 2). `changesets/action` given only changesets that resolve to
  zero package bumps logs `All changesets are empty; not creating PR`, opens no Version PR,
  publishes nothing, and **exits 0**. Run 30640138565 (2026-07-31) did exactly that: approved
  through the protected `release` environment as a real publish, reported success, and shipped none
  of the six packages whose manifests were already a patch ahead of the registry. `cf07086` (#41)
  deleted the offending file and wrote the finding down, which fixed the instance and left the
  class. The guard runs first in both `ci.yml` and `release.yml`, before install, and refuses per
  file rather than per repo. The copy that spares an approver is the **`ci.yml`** one: `release.yml`
  declares `environment: release` at job level, so that whole job waits for approval before its first
  step runs.
  - **Three shapes bump nothing, and only the first is what the action calls empty.** Frontmatter
    that declares no packages (`yaml.load` of an empty block returns falsy and
    `@changesets/parse@0.4.3` sets `releases = []` **without throwing**, so the file parses cleanly
    and carries a human summary). A changeset whose every entry is type `none`, which is **valid**
    in the parser's own `validVersionTypes`, so its releases list is non-empty, it does **not** trip
    the action's emptiness check, and it instead opens a Version PR that changes no version. And a
    misspelled package name. All three are read off the vendored parser source, not inferred from
    the log line.
  - **`none` alongside a real bump is still accepted**, because that is what `none` is for.
  - **The negative control is committed, not run once by hand** (`test/changeset-guard.test.ts`, 16
    cases). It drives the shipped CLI with `execFileSync` and asserts the **process exit code**,
    because what the workflow depends on is the exit code and an exported function returning
    `{ ok: false }` proves nothing about it. This repo has already been bitten by that exact gap
    (#42, where `attw`'s wrapper exited 0 on an untyped pack). Both directions are pinned: an inert
    changeset **must** exit non-zero, a real one **must** exit zero, and an empty `.changeset/`
    directory must exit **zero** because that is the publish arm and refusing it would block every
    release. A guard that refuses everything fails the first control; one that refuses nothing fails
    the second.
  - **A guard that cannot run exits 2, never 1.** 1 is reserved for "an inert changeset was found",
    and collapsing the two would make a broken gate and a caught defect one signal.

- **`scripts/release-notes.mjs`: release bodies are derived and checked before npm is touched**
  (`DEPENDABOT-PR-QUEUE`, item 1). `changesets/action` defaults `createGithubReleases` to **true**,
  and builds each body by finding a `## <version>` heading in that package's `CHANGELOG.md`. Every
  package here sets `"changelog": false` and hand-maintains its changelog, so `changeset version`
  writes no such heading, the action finds none, and **its fallback is the whole file**: on
  2026-07-31 all six bodies published as the raw `CHANGELOG.md`, `# Changelog` preamble and
  `## [Unreleased]` included. The bodies were corrected by hand, which is not a gate.
  `createGithubReleases` is now **false**, which removes the dumping behaviour outright, and this
  script supplies the replacement.
  - **Derived from the changesets the version commit consumed, not from the CHANGELOG.** Deriving
    from the changelog would require a `## [0.0.6]` heading for a version that does not exist when
    the changeset is written, and with the generator disabled nothing writes it, so a gate asserting
    it would refuse every release until a human predicted the next version by hand. That is a
    deadlock of a shape this org has already met. A changeset is written per change, carries a
    summary by construction, and is deleted by the version commit, which is what makes "what did
    this version consume" answerable from git.
  - **Ordering is the point.** The changesets are in the tree at `HEAD^`, so every refusal runs with
    the registry untouched. A published version is permanent (ADR 0001), so a check after the
    publish is a complaint, not a gate.
  - **What it refuses:** a version bump that consumed no changesets; a consumed changeset with an
    empty summary; a bumped package no changeset describes; and, asserted on the **finished bytes**
    by a separate entry point that knows nothing about how they were produced, a body that is empty,
    a stub, an em dash, one naming a different version than the one being tagged, or one carrying
    any of the three fingerprints of the CHANGELOG dump. It deliberately does **not** port
    `cosyte/.github`'s prose classifier, that is tuned against a single-package parser's changeset
    corpus, and an uncalibrated classifier that refuses a good release is worse than none.
  - **The publish command is NOT gated on the classifier**, and that is deliberate. The shared
    workflow withholds `publish:` when its notes step says "not a release"; here, a classifier that
    was wrong in that direction would **withhold a publish on a green run**, which is precisely the
    failure item 2 exists to close. So the publish stays unconditional, and a second step refuses
    loudly if a publish happens on a commit the gate never recognised. A misclassification reddens;
    it never withholds silently.

- **🩺 WHAT THE GATE CAUGHT, AND IT WAS THE SAME DEFECT CLASS THIS SLICE EXISTS TO CLOSE.** The
  first draft keyed the post-publish step on `steps.changesets.outputs.published == 'true'` and
  looped over `publishedPackages`. `gate-refuter` **REFUTED** it by measuring the action's own
  `run.ts`: `git.pushTag` sits inside `if (createGithubReleases)`, so turning that flag off makes
  this step the **only** thing that creates a tag. Then:

  > Six packages publish. `gh release create` succeeds for two and fails on the third. The step reds,
  > so an operator re-runs it. On the re-run `changeset publish` finds all six already on the
  > registry, publishes nothing and exits 0, so `published` is `false`, so the step is **skipped**,
  > so the run goes **GREEN** with four packages on npm carrying no tag and no release, permanently.

  A green run that did nothing, arrived at through the very fix for green runs that did nothing.
  **The step is now driven by what the version commit BUMPED, runs on `!cancelled()`, and asks the
  REGISTRY whether each package is actually there**, so a re-run completes the job instead of
  skipping it and a bumped package that never published is named rather than counted as done. Note
  this half is **not a base regression**: with `createGithubReleases` at its default of true the
  action pushed the tag inside its own call, so base lost a release _body_. Losing the _tag_ is new,
  and it matters more here than it looks because this repo's changelog headings are dated from tags
  by hand.
  - `changesets/action` is now **pinned to `a45c4d5`**, the sha `cosyte/.github` pins and the sha the
    `pushTag` behaviour above was measured at. A floating `@v1` could move the internals this file
    now depends on with no diff here.
  - **PASS 2 caught the CORRECTION overreaching, which is the symmetric failure.** The trailing
    comment strip added for the finding below turned a safe exit 2 into an **exit 0 on an inert
    file**: `"@cosyte/tsconfig": "none" # keep pinned` passed, because the release type was compared
    as a raw token while `js-yaml` strips the quotes, so `@changesets/parse` reads it as the
    all-`none` shape the guard exists to refuse. A green guard over a changeset that bumps nothing,
    introduced by the commit fixing green runs that did nothing. The type is now unquoted before the
    comparison and validated against `validVersionTypes`, so an unknown type takes **exit 2** here
    rather than throwing inside the action. Three spellings are pinned by a control.
  - Three smaller findings, all applied: a comment claiming the guards run "before an approver is
    asked for anything", **false in `release.yml`** because `environment:` is declared at job level
    so the whole job waits first (the `ci.yml` copy is the one that genuinely spares the approver);
    the guard exiting 2 on `"@cosyte/x": patch # comment`, valid YAML a human plausibly writes, now
    accepted with a committed control proving an inert file carrying a comment is still refused; and
    the fact that this guard **bans an idiom this repo used deliberately three times**
    (`changeset add --empty` for a repo-level note), now written down in `RELEASING.md` with the
    root `CHANGELOG.md` named as the only home for such an entry.

### Changed

- **`config` stays on its own `release.yml` rather than becoming a thin caller of
  `cosyte/.github/.github/workflows/release.yml@main`, and the reason is measured, not preferential.**
  Adopting the shared workflow was the intended remedy and it cannot serve this repo's six-package
  shape:
  - Its gate answers "is a release pending" from the **root** `package.json`'s version. This repo's
    root manifest is `cosyte-config`, `private: true`, pinned at `0.0.0`, and Changesets does not
    version a private root package, so that value has never changed and never will. Running the
    shared `prepare` against this repo returns `is-release=false`, code `never-versioned`. The
    shared workflow supplies `publish:` **only** when that is `true`, so adopting it would withhold
    **every** config publish, permanently, on a green run: a strictly worse instance of the class
    item 2 exists to close.
  - It hardcodes `tag="v${version}"`, and its own comment states the assumption: "Every caller of
    this workflow is a single-package repo". This repo's fourteen tags are all `<pkg>@<version>`,
    and six packages publishing in one run would collide on a single tag.

    So the two portable halves were ported instead (the token wiring, and a notes gate rebuilt for
    six packages) and the workflow comment records what to delete if the shared one ever grows a
    multi-package mode.

- **Both gates run in `ci.yml`'s `verify` job, not only on push to `main`.** `verify` is a required
  status check in the `config-ci-required-checks` ruleset and a separate job would not be, so this is
  the half that can be made blocking from inside the repo, following the precedent the em-dash gate
  already set in that file. `verify` now checks out with `fetch-depth: 0`, which the notes gate needs:
  a shallow clone has no `HEAD^`, and the gate would report "no release pending" on every run, green
  and blind. On a Version PR the merge commit's first parent is the base branch, so the check sees
  the same shape the push-to-`main` run will, one merge earlier.

### Fixed

- **The six `packages/*/CHANGELOG.md` no longer head shipped content `[Unreleased]`**
  (`DEPENDABOT-PR-QUEUE`, item 3). Every one of them was **byte-identical to its own latest release
  tag**, so every byte under `[Unreleased]` had already shipped and would have republished on the
  next release. Each section now carries the version it shipped in, dated from that release's tag.
  `@cosyte/vitest-config` needed a **two-way split**: its `[Unreleased]` block spanned two shipped
  versions, and the boundary was read off the `@cosyte/vitest-config@0.0.2` tag rather than guessed
  (the `### Added` block is `0.0.2`, 2026-07-15; the em-dash `### Changed` entry is `0.0.3`,
  2026-07-31). One now-false future-tense clause went with it: "ships in the next release" had
  shipped.
  - **The generator flag was NOT flipped.** `"changelog": false` in `.changeset/config.json` is
    untouched. Whether to turn Changesets' changelog generation on is the founder-owned call tracked
    as `CHANGELOG-PREAMBLE-FUTURE-TENSE`, and it changes the shape of a shipped file in eight repos
    at once. **These six were corrected by hand; the mechanism that produced them is unchanged and
    that call stays open.** Each file now says so at the top: promotion of `[Unreleased]` to a
    version heading is manual, in the PR that adds the changeset.

- **`release.yml` carries the `RELEASE_PR_TOKEN` wiring, so a Version PR can run its checks.** GitHub
  does not start workflow runs for events produced by `GITHUB_TOKEN`, so a Version PR opened with it
  arrives with **zero checks**, and a required check that never reports is PENDING rather than
  failing: with `bypass_actors: []` nobody can merge past it, an admin included. Both halves are
  needed and the second is the one that is easy to miss. The token goes in the action's `env` (the
  action reads `process.env.GITHUB_TOKEN || core.getInput("github-token")`, so the env wins and
  adding the input alone would be a silent no-op), **and** the caller checkout sets
  `persist-credentials: false`, because the version commit is pushed by `git push` out of that
  checkout and the persisted `http.<host>.extraheader` otherwise outranks the `~/.netrc` the action
  writes. Fixing only the first fixes `opened` and leaves `synchronize` broken, which means it works
  until the second changeset. Absent, the secret **falls back to `GITHUB_TOKEN` and warns loudly**
  rather than failing closed: failing closed would take this repo's release path down to protect
  against a state it is already in.

- **The three residuals `TEMPLATE-REMINTS-BOTH-GATES` left in the parser template, closed at the
  source** (`TEMPLATE-SCAFFOLD-RESIDUALS`). `scripts/scaffold-parser.mjs` mints every new
  `@cosyte/*` parser from `scripts/parser-template/`, so each of these was not a defect in one repo
  but the shape every future repo would be born with. All three are measured on this tree; the new
  and changed cases red on the unfixed template (4 of the 16 `phi-scan` cases, and the forwarding
  pin below reds on a wrapper that drops the flag).
  - **A missing allow-list took exit 1, the code the contract reserves for HITS FOUND.**
    `loadAllowList()` sat outside `main`'s `InvocationError` handler, so a run that cannot find
    `scripts/phi-allow-list.txt` threw uncaught and got node's own 1. A caller that branches on the
    code, and CI is one, read "this corpus contains PHI" off a run that never opened a file. The load
    now sits inside the handler and refuses with 2. The previous suite asserted this as MEASURED
    (`not.toBe(0)`, with the defect written into the comment); the assertion is now the exact code,
    plus a counterfactual that rebuilds the old placement out of the emitted scanner and shows exit 1
    returning. **The live trigger is NOT a fresh scaffold**, which a draft of this entry and of the
    scanner's own docblock both claimed: the template ships `scripts/phi-allow-list.txt` and the
    scaffolder copies it, verified against a real `scaffold-parser.mjs` run. It is the scanner
    invoked from the wrong working directory, since `REPO_ROOT` is `process.cwd()`. The narrower
    claim is the one the suite actually exercises, and this file gets minted into every new parser,
    so the wrong one would have been copied with it.
    **What this does NOT claim:** an allow-list that exists but cannot be READ (a directory at that
    path, or mode 000) makes `readFileSync` throw a plain `Error`, which the handler wrapping it
    rethrows, and the run still takes exit 1. That is `PRE-EXISTING`, unchanged, and not answered by
    widening the catch or by enumerating `EACCES`/`EISDIR`, that is the deny-list shape the `attw`
    guard next door just retired. Its own slice if it is worth closing.
  - **The staged enumerator's status filter is now `--diff-filter=d` (an EXCLUSION) rather than
    `AMT` (an allow-list).** `synth#37` and `ncpdp#54` both ended on the exclusion form with "do not
    narrow this back to an allow-list" written down, and an allow-list is the wrong polarity for a
    safety gate: every letter it does not name is dropped in silence, which is exactly how sibling
    scanners missed `R` and then `T`, one refuter pass apart. With `--no-renames` already preventing
    `R` and `C` the practical delta is `U`, `X` and `B`. **This diff's base is `AMT`, not `AM`**, so
    what it closes is narrow: `AM` was this template's base one slice back, and `702fd2a` is what
    moved it to `AMT`, so repeating the backlog line's "strictly better than base's `AM`" here would
    have described a wider hole than the one this diff actually found. **It is still the right
    change, because this
    template is what every future parser inherits and it should not be the copy carrying the older
    shape.**
    Measured on git 2.39.5: a conflicted path lists as `:100644 000000 <sha> 0000000 U` plus its
    path, ONE record and two fields, destination mode `000000`, so the two-field stride is unaffected
    and the mode reaches the non-regular refusal (exit 2) instead of being dropped unlisted. A new
    case builds a real merge conflict in the emitted repo and pins both directions: `AMT` lists
    nothing, `d` lists it, the scan refuses, and restoring `AMT` makes the same tree report clean.
  - **`--no-definitely-typed`'s FORWARDING is now pinned on its own.** Every other case in the attw
    suite passes it so the gate stays off the network, and that is precisely why none of them pinned
    it: the flag rode along on every run, so a wrapper that ACCEPTED it and then dropped it kept the
    whole suite green. The acceptance half was covered incidentally by the allow-list; the
    forwarding half was not covered at all. The real CLI cannot answer the question (it reports on a
    tarball, not on its own argv, and the flag only suppresses a network lookup), so the pin runs the
    EMITTED wrapper against an `attw` shim that records what it was handed. **With a negative
    control**: without the flag the shim must see `--pack .` and nothing else, which is what stops a
    wrapper that hardcodes the flag from satisfying the pin. `--profile` is pinned the same way in
    both spellings, and `--quiet` is asserted to be refused before attw is reached, so "forwards it"
    cannot be satisfied by forwarding everything. **The same gap is open upstream in
    `terminology#40` and is not touched here.**
  - **Deliberately NOT done, carried forward from `TEMPLATE-REMINTS-BOTH-GATES` unchanged: the
    template's own starter suite gains no symlink cases.** Nothing in this repo can execute
    `scripts/parser-template/test/`, and shipping unexecuted tests into every new parser is worse
    than shipping none. The coverage lives in this repo's `test/phi-scan-scaffold.test.ts`, which
    runs the real scaffolder and exercises the EMITTED scanner.
  - **Also deliberately not done: the fix is not ported into the existing parser repos.** Those
    carry their own copies and their own history; this item is about what gets MINTED. Porting is a
    separate item with a separate owner.

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
    beats the flag). `--format table-flipped` still prints the sentence and is refused anyway, that
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
    failure still fails, so an upgrade that reworks the wording or fixes the exit code reds the
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

- **PERF-P2: repo plumbing for the perf gate.** The gate itself is a `@cosyte/test-utils` change and
  is described in that package's changelog; what lands at the repo level is:
  - A root `test:perf` script (`pnpm --filter "./packages/*" run --if-present test:perf`), so the
    perf tests run in their **own non-instrumented invocation**. ADR 0001 §6 is the reason they
    cannot simply join `pnpm test`: `@vitest/coverage-v8` drives V8's `kBlockCount` precise coverage,
    compiling an effectful counter into the measured function body in every tier at a cost that
    scales with executed-block count, which differs between the two phases a ratio compares, so it
    does not cleanly cancel. `--if-present` keeps it a no-op for the five config packages that have
    nothing to measure. It is **deliberately not wired into CI yet**: see below.
  - `experiments/perf-p2-false-alarm/`: a throwaway-but-committed sweep, the same shape as
    `perf-calibration/`, answering the roadmap's P2 acceptance clause: **does the shipped gate fire
    across 200 clean runs?** It could not be inherited from PERF-P0, because P0 measured its 3,200
    ratios after an `hl7`-shaped _fixed-count_ warmup while the kit ships a _time-budgeted_ one, and
    ADR 0001 §2 says in terms that changing the warmup rule moves the operating point the ceiling was
    set from. It imports P0's linear workload module unchanged, so the warmup rule and the runner are
    the only variables. Read `ANALYSIS.md`; the datasets are under `data/`.
  - **What the sweep found, and it is not a clean pass.** Three independent 200-run sweeps on one
    box against identical gate code gave **3, 0 and 1** fires (**4 in 600 runs (0.67%)**) on a
    workload that is linear by construction. One sweep of three met the roadmap's clause outright;
    the others did not. The rate is dominated by ambient CPU contention rather than by the gate, and
    that is a stronger claim than any single sweep could have supported. **No constant was changed in
    response**: they are frozen by ADR 0001 and P2 implements a decided contract. Raising the ceiling
    to clear the worst observed 11.01 would put it above 8.84: the weakest real O(n²) signal at
    `hl7`'s own fixture size: turning a gate that occasionally cries wolf into one guaranteed to
    sleep through a real regression. The mechanism is evidenced rather than guessed, from a preserved
    firing diagnostic: the warmup rule declared steady state on a batch series oscillating **5×**
    (7.25–36.80 ms/pass), because three consecutive batches coincided within ±5%, so
    `WARMUP_STABLE_BATCHES = 3`, a judgement constant, is the leading suspect. Underneath it, this
    container runs a 2-CPU `cpu.max` while `os.cpus().length` reports 56, so V8 sizes its GC/compiler
    pools from the host and the cgroup throttles in bursts; a same-process ratio cancels JIT state
    (C5) but the two phases are separated in **time**, and a throttling state that changes between
    them is not cancelled by anything in the contract. Also recorded, and it answers ADR 0001 §2's
    "re-check the operating point on both sides" **per axis**, because pooling them hides the effect:
    against P0's matched cell the **count** axis is unchanged (p50 −0.1%) while the **size** axis body
    shifted **+8.1%** (4.2665 → 4.6100), reproducibly across all three sweeps, and the size axis is
    the one whose worst false alarm set the ceiling, so that eats into a 1.20× margin. Three
    candidates for it are confounded here and none is established: the warmup rule, the fact that the
    kit runs both axes in one process (size second) where P0 ran one, and a changed timed-loop body.
    Separately, the floor's thinnest observed margin is **1.06×** (a 1.5833 ratio against a floor of
    1.5), thinner than the 1.13× the ADR believed. Because of all
    this, `pnpm test:perf` is **not** wired into CI, a known-flaky required check is roadmap §5's
    risk #1, and adoption should not proceed on the strength of the global ceiling until P4 settles
    it with the founder.

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
