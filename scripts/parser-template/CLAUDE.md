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
  `scripts/attw.mjs` carries **two nets that catch different things**: a preflight that every relative
  path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf of `exports`)
  exists and is non-empty, which catches that window and names the missing file; and a post-check on
  attw's untyped sentence, which catches what the preflight structurally cannot, declarations present
  on disk but excluded from the tarball by `files`/`.npmignore`.
  **The post-check reads a string, so what would hide that string is refused, by option and
  wholesale rather than by value**: `--quiet`, `--format`, `--config-path`, and a `.attw.json` setting
  `quiet` or `format` (`readConfig()` applies the file after argv, so it beats the flag). A harmless
  `--format` value blinds nothing and is refused anyway. That is the deliberate trade against
  value-parsing the guard. Other arguments are forwarded, so `--profile node16` still works.
  **SHORT OPTIONS ARE MATCHED PER CHARACTER, NOT PER TOKEN, AND AN EXACT-TOKEN GUARD IS A LIVE HOLE.**
  Commander accepts an attached value (`-fjson`) and a cluster (`-Pq`), so a guard holding the exact
  tokens `-f` and `-q` lets both through: `-fjson` was measured handing back exit 0 over an untyped
  pack through exactly that shape. attw's short options are `-P/--pack`, `-f/--format`,
  `-p/--from-npm`, `-q/--quiet`, so refusing any cluster containing `f` or `q` refuses nothing
  legitimate.
  **`--config-path` is refused for a weaker reason, and do not restate it as a stronger one.** Alone
  it blinds nothing (pointed at a missing file the sentence still prints). It selects **which** file
  `readConfig()` applies, so pointed at one setting `quiet` it blinds like `.attw.json` does. It is
  refused because the gate cannot check a file whose path it is told to ignore.
  **This file arrives from `cosyte/config`'s `scripts/parser-template/`.** Fix the gate there, never
  only here, or the next scaffolded parser is born with the defect again.

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
