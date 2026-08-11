# {{PKG}}: Project Guide for Claude

## Project

**`{{PKG}}`**: a developer-focused {{TITLE}} parser + utility library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). One of the sibling `@cosyte/*` healthcare-standard
parsers that **mirror each other's API**: `@cosyte/hl7` is the reference; this repo deliberately
copies its shape.

**North star (the archetype):** a developer can parse a real-world, vendor-quirky {{TITLE}} message
and pull useful fields out in one line, without reading the spec. Liberal on parse (quirks become
warnings), conservative on emit (always spec-clean). See `documentation/conventions.md` →
"The standard parser archetype" in the meta-repo for the full contract this repo must satisfy:
Postel's Law, the tiered tolerance model, stable warning codes, zero runtime deps, dual ESM + CJS,
immutability + explicit mutation, and the profile system.

## Status

- **Scaffolded from the shared `@cosyte/*` parser template.** Pre-alpha `0.0.x`, not yet published to
  npm. `src/index.ts` carries archetype **stubs** (`parse{{Pascal}}`, `WARNING_CODES`, `FATAL_CODES`).
  The real parser lands in subsequent phases.

## Tech Stack (the shared `@cosyte/*` standard)

This repo inherits the canonical toolchain by depending on the published `@cosyte/*` config packages,
not by copying files. The source of truth is the meta-repo's `documentation/conventions.md`. This is
a summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`. TypeScript 5.9.x, exact-pinned.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate
  (per-condition types: `.d.ts` for `import`, `.d.cts` for `require`). The `attw` script is
  **`scripts/attw.mjs`, not the bare CLI**: see the guardrail below.
- **Node:** **>= 22** (CI matrix 22 + 24).
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** + unified `typescript-eslint` (type-checked) via
  `@cosyte/eslint-config`; Prettier via `@cosyte/prettier-config`. Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-directory >= 90 gates; the
  property-based conformance invariants come from `@cosyte/test-utils` (round-trip, lenient-mode,
  immutability, warning-code stability): the format-specific arbitraries stay in this repo.
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows.
- **Runtime deps:** **Zero.** Node stdlib only.
- **License:** MIT.

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export: the JSDoc lint rule is an **error** on public
  exports, so this is enforced, not optional.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Short, testable functions over big parsing blobs.
- Postel's Law: parser is liberal (lenient default + warnings), serializer is conservative (always
  emits spec-clean output).
- Fatal errors only for unrecoverable structural corruption (Tier-3 codes). Everything else is a
  warning with a stable code + positional context.
- Coverage: per-directory >= 90% (lines/branches/functions/statements), enforced by
  `pnpm test:coverage`.
- **`attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE
  BARE CLI.** `getExitCode.js` in `@arethetypeswrong/cli` opens with `if (!analysis.types) return 0`,
  so the problem list is never consulted and no `--profile`, `--ignore-rules` or config setting
  reaches that early return. An untyped package is a legitimate npm package, so the CLI treats "no
  types at all" as a description rather than a problem. For a package that ships types it means the
  declarations were **not in the tarball**, which is a broken publish reported as a pass. A false red
  costs an hour; a false green merges.
  **The race only supplies the condition, so the answer is not a lock, a lease or a build queue.**
  `tsup` emits JS in one pass and declarations in a later one, so **every** build has a window where
  `dist/` holds `.mjs`/`.cjs` and no `.d.ts`; a concurrent build or `clean` in the same working tree
  lands `attw` in it. The gate must be able to say its own inputs were missing, whatever removed them.
  `scripts/attw.mjs` carries **four nets that catch different things** (a structural preflight over
  what `package.json` promises, a post-check that forces `--format json` and asserts
  `analysis.types.kind === "included"`, a tarball check that reads `npm pack --dry-run --json`
  and requires every declared path to be in it, and a fourth that reads the manifest **pnpm** would
  publish out of a tarball `pnpm pack` wrote, because pnpm applies `publishConfig` and `npm pack`
  does not), plus an **argument ALLOW-LIST**, because a deny-list of the spellings that blind a gate
  bought exactly one more evasion per round.
  **THE RULES ARE STATED ONCE, IN `scripts/attw.mjs`'s OWN DOCBLOCK, AND THIS BULLET IS A POINTER.**
  Read them there. The previous shape of that guard was described in several committed files at once
  and every drift between the copies was a claim edited in some of them and not the others, so do not
  restate the argument set, the measurements, or the reasons here.
  **The keys that blind NET 2 are closed by that structure rather than by a key list. THE CONFIG
  ROUTE AS A WHOLE IS NOT CLOSED, and no prose here may say it is.** `readConfig()` applies a
  committed `.attw.json` after argv and calls `setOptionValueWithSource` for nearly every key, so a
  config still beats every argument the gate passes. What changed is that net 2 no longer reads
  prose: `quiet` and `format` leave stdout unparseable and red, and `definitelyTyped` pointed at a
  `.tgz`, which parses fine and exits 0 while making an untyped tarball analyse as typed, reds on the
  `kind` assertion. `"included"` still only means SOME TypeScript-extension file is in the tarball,
  never that the DECLARED declarations are, and **net 2 has not been widened to say otherwise**.
  What refuses a package that loses its declared `.d.ts` while packing a stray one is **net 3**,
  which reads npm's pack listing and asks attw nothing. **What is still open:** net 3 proves
  PRESENCE, not RESOLUTION, so a config relaxing attw's exit code (`ignoreRules`,
  `ignoreResolutions`, an empty `entrypoints`) still passes a package whose declared paths are all
  packed and whose types resolve wrongly. **Read the docblock, not this bullet, before acting on any
  of it.**
  **Do not put a tool that packs, publishes, or installs into `prepublishOnly`.** `attw --pack .`
  packs a tarball of its own into the directory being published, and under `pnpm publish --dry-run`
  it does not pack at all: that command exports `npm_config_dry_run=true` into every lifecycle
  script, `npm pack` writes nothing, and attw dies with `ENOENT` on the path it computed. It hides
  because `publish --dry-run` skips a version already on npm, so the chain only ever runs on a real
  version bump: it blocked every release of `@cosyte/test-utils` until it was removed there. `attw`
  belongs in CI as its own step, which is where it runs.
  **A test that shells out to `attw --pack` against a throwaway fixture in a temp directory is a
  different act and is fine**, because `scripts/attw.mjs` strips `dry-run` and `pack-destination`
  from the environment of the `attw` child. Read that file's docblock before touching it.
- **`scripts/phi-scan.ts` IS A THIN CALLER. THE MACHINERY IS `@cosyte/script-utils/phi-scan`, A
  devDependency.** Read that module's docblock; this bullet is a pointer and restates none of it.
  `scripts/parser-template/` is a SCAFFOLD rather than a dependency, so the scanner used to be
  COPIED into every parser repo: **thirteen repos, thirteen byte-distinct copies**, and each escape
  closed so far cost one pull request and one adversarial review PER REPO. Fixing the engine now
  fixes every consumer through a version bump. **It is a devDependency, never a runtime one**: the
  zero-dep rule governs what ships, and a dev-time gate does not ship.
- **WHAT STAYS IN THIS FILE IS DATA.** The scanner declares roots, subtractions, allow-list
  conventions, views and the per-standard field VOCABULARY. It runs no process at all: the engine
  owns walking, reading, enumeration, the union, completeness, reporting, the exit codes, the
  refusals and the process TAIL (`runPhiScanCli`). **Which parameters the engine REQUIRES is the
  design**: `exitCodes` and `scanRoots` have no default, because the siblings genuinely disagree and
  a default would be the porting mistake the gate exists to catch. **`unionScope` decides whether
  the index half is bounded by those roots or reads the whole repository**, because the walk and the
  union are two axes and one root list collapsed them. 🛑 **Never port an exit code in or
  out.** 🛑 **An exclusion is a LITERAL PATH, never a class**. A sibling measured that a "binary
  blob" predicate would have dropped two of its own hand-written sources, which embed NUL bytes as
  HMAC domain separators.
- **WHERE THE ENGINE CAN TELL A PARAMETER IS WRONG, IT REFUSES.** All thirteen consuming repos
  derived against the first published engine, all thirteen were blocked, and **every defect they
  found made the gate weaker than declared and said nothing**: none produced a false alarm, all
  produced false confidence. So an unknown allow-list tag, a root that is not the shape it declares,
  a root the scan cannot stat, a declared root that yielded nothing read, and an unreadable
  allow-list are refusals. **It is not a claim that every misdeclaration is caught**: a well-typed
  but wrong value is not detectable there, and neither is a misspelled key inside an optional nested
  object.
- **THE SCAN ROOTS ARE THE WHOLE REPOSITORY (`["."]`), AND NARROWING THEM IS A MEASURED DECISION.**
  This template shipped `["test/fixtures", "src"]` and it was measured against a fresh scaffold: **35
  tracked files, ONE in scope**, so a tracked `test/leak.test.ts` carrying a dashed SSN exited 0 on
  the sweep and on the pre-commit route. The engine prunes gitignored directories during descent and
  skips `.git` by name, so a whole-repository root costs nothing on a fresh tree.
  🛑 **THIS AXIS HAS NO SAFE DEFAULT IN EITHER DIRECTION AND BOTH FAILURES ARE MEASURED.** Five repos
  need the whole repository; **two measured that it makes them exit on their own `package.json`
  author address**, and both remedies are worse than narrow roots. Five more measured that copying a
  sibling's narrow roots silently DROPPED tracked files their index union had been reading.
  "The whole repository" is the ROOT half of scope, never a claim that every tracked file is read:
  `EXCLUDED_PATHS` and `unreadablePrefixes` still subtract, and both are ANNOUNCED on every run.
  **NO COUNT IS WRITTEN HERE, AND THAT IS DELIBERATE TWICE OVER**: a figure that stood in this
  bullet was invalidated by the read filter's default changing and read as current the whole time,
  and a draft carried per-repo file counts with no attribution, which a reader in another repo
  reasonably mistook for their own. A count belongs beside the repo and revision that measured it.
  If you narrow the roots, **measure what the narrowing STOPS reading** rather than assuming it
  stops reading nothing.
- **THE `--allow-fixture` BYPASS CANNOT REACH A CLEAN RUN, SO EVERY DETECTOR YOU ADD MUST CONSULT
  `ctx.allow`.** A target the run enumerated and never read REFUSES, in every mode, so the flag is
  recorded and then refused. That means a detector that checks nothing leaves a developer with a hit
  and **no remedy at all**: a sibling shipped a phone detector and a dashed-SSN branch in that state
  while its footer claimed the token allow-list was the only remedy, and its reviewer caught the
  claim as false. The engine's own floor consults the allow-list on both branches.
- **RAISE HITS THROUGH `ctx.hit`, NEVER BY BUILDING A PATH.** The sweep reads the bytes git carries
  as a union with the working-tree walk, and a hit found in a tracked blob whose disk copy differs is
  labelled `(as git carries it)`. The engine fills that locus in, so a hit cannot be reported against
  a path a developer would open and find clean.
- **THE EXIT CONTRACT IS DEFINED IN THIS REPO'S OWN SCANNER, NOT INHERITED**: 0 clean, 1 hits, 2
  every state the engine RAISES in which the scan cannot account for something. An allow-list or an
  override log that exists but cannot be READ is a **refusal (2)**, not exit 1: that used to escape
  as a plain `Error` and take node's own exit 1, which a caller reads as "hits found", and four
  repos measured seven instances of the shape. **A misconfigured scanner still throws a `TypeError`
  before any scan begins**, which is loud and lands on the author's first run.
- **This file and `scripts/attw.mjs` arrive from `cosyte/config`'s `scripts/parser-template/`.** Fix
  a gate there, never only here, or the next scaffolded parser is born with the defect again.
  `scripts/phi-scan.ts` arrives from there too, but its MACHINERY does not: that is
  `@cosyte/script-utils/phi-scan`, so an engine fix is a version bump here rather than a re-port.
  **`cosyte/config`'s drift check RUNS your `phi-scan.ts` (a capability probe, not a regex) and
  reports drift when it does not refuse over a target it enumerated and never read.** It plants the
  version of the shared package THIS repo has installed, so the probe is an adoption check: a repo
  pinned behind a fix is graded on what it actually has.

## Standing disciplines (every change)

Mirrors the three disciplines in the meta-repo's `documentation/conventions.md`. They bind here too:

1. **Documentation follows code**: a change to the public surface/stack/status isn't done until the
   docs are: this repo's docs content (`README.md`, `docs-content/`), the meta-repo
   `documentation/repos/{{NAME}}.md` (bump its "last verified" date), and the `ecosystem-map.md`
   status table.
2. **Version + changelog**: a Changeset (`patch` on the `0.0.x` ladder) + a `CHANGELOG.md`
   `[Unreleased]` entry per meaningful change. Renaming a stable warning code is a **breaking change**.
3. **Crew + knowledgebase loop**: if this parser's public API or warning codes change, flag/update
   the matching `crew` healthcare skill + the KB product doc.
