# 0002: The `0.1.0` version line for the eight published `@cosyte/*` packages

- **Status:** Accepted (2026-08-31)
- **Scope:** the eight packages this repository publishes (`@cosyte/eslint-config`,
  `@cosyte/prettier-config`, `@cosyte/process`, `@cosyte/script-utils`, `@cosyte/test-utils`,
  `@cosyte/tsconfig`, `@cosyte/tsup-config`, `@cosyte/vitest-config`). It does **not** reach the
  parser repositories scaffolded from `scripts/parser-template/`, which are not published from here
  and keep their own pre-alpha ladder.
- **Relates to:** [`RELEASING.md`](../../RELEASING.md) (the pipeline this decision feeds) ·
  [`documentation/release-0.1.0-audit.md`](../release-0.1.0-audit.md) (the per-package audit that
  this decision is the disposition of) · ADR 0001 (which cited the retired ladder as context).
- **Supersedes:** the sentence "the package stays on the **`0.0.x`-until-first-alpha** ladder",
  which stood in all eight package changelogs, in the root `CHANGELOG.md`, in `README.md` and in
  `.changeset/README.md` at commit `b78e2d977ac7615513c21f582c5efe5e42734209`.

## Context

Every one of the eight packages sat on a pre-alpha ladder whose whole content was "patch, always".
`.changeset/README.md` said it as a rule ("During pre-alpha all bumps are **`patch`**"), each
package's shipped `CHANGELOG.md` said it as a property of that package, and `README.md` said it as
an estate convention. The ladder was doing one useful thing and one harmful thing.

The useful thing: it made every bump mechanical, so nobody had to decide whether a change was a
feature or a fix while the packages were still moving underneath their consumers.

The harmful thing: it left consumers with no version line that means anything. Under
caret-on-`0.0.z` semantics every release is a separate major to a resolver, so `^0.0.4` and `^0.0.6`
do not satisfy each other. Thirteen parser repositories plus this one depend on these packages, and
a range that never widens is a range nobody can write. Worse, the ladder made the version carry no
signal at all: `0.0.6` and `0.0.2` are the same statement ("still moving"), so a consumer reading a
manifest cannot tell a settled surface from an unsettled one.

Eight independent patch ladders is also eight independent things to reason about. The audit that
this decision closes measured what each package actually has outstanding, and the answer was
uniform: **nothing**. Every package's manifest version, its highest `<pkg>@<version>` tag, and the
registry's `latest` agree, and no change since each package's release tag reaches inside that
package's published tarball. There is no backlog of unshipped behaviour to sort into features and
fixes. That is exactly the moment to move the line, because moving it costs no consumer a behaviour
change.

## Decision

**The eight published packages move to a single `0.1.0` line, together, and the pre-alpha ladder is
retired for them.**

1. **All eight go to `0.1.0` in one release.** Not a subset. A coordinated line is the only version
   statement a consumer can act on: "the `@cosyte/*` toolchain at `0.1.x`" names a set, where eight
   separate ladders name nothing.
2. **The bump is `minor` for all eight.** On a `0.0.z` version a `minor` changeset entry resolves to
   exactly `0.1.0`, and a `patch` entry resolves to `0.0.z+1`. `minor` is therefore the only
   changeset type that reaches the decided version, and it is also the honest one: this is a
   deliberate widening of what the version promises, not a defect repair.
3. **`0.1.0` asserts that the surface is settled, not that it is finished.** What the line means:
   these entry points are the ones consumers should pin, and a removal or a rename from here on is a
   breaking change that gets recorded as one rather than absorbed into the next patch. What it does
   not mean: a `1.0.0` stability promise. Pre-`1.0.0` semver still permits a breaking change in a
   minor bump, and this repository has not committed to more than that.
4. **Bump type is now a judgement per change, made in the changeset.** The rule "always patch" is
   replaced by ordinary semver on a `0.1.x` line: `patch` for a fix, `minor` for an addition or a
   deliberate widening, `major` for a removal or a rename. `major` on a `0.x` line is available and
   is not reserved.
5. **Nothing about the release pipeline moves.** `RELEASING.md` is unchanged by this decision: the
   ungated version arm, the gated publish arm, the two release gates, the hand promotion of the
   unreleased changelog heading and the `<pkg>@<version>` tag form all keep working exactly as they
   did. This is a statement about numbers, not about machinery.

## Consequences

- **Consumers must widen their ranges once.** A dependant pinned at `^0.0.4` does not resolve
  `0.1.0`. That is a one-time edit per dependant and it is the point of the move: after it, `^0.1.0`
  keeps resolving through the whole `0.1.x` line, which `^0.0.z` never did.
- **The private root manifest is unaffected.** `cosyte-config` is `private: true` and pinned at
  `0.0.0`. Changesets does not version a private root package and this decision does not ask it to.
  `scripts/release-notes.mjs` records why that value must never be read as a release signal.
- **A changelog entry now has to say which kind of change it is.** Under the ladder the bump type
  carried no information, so nobody had to think about it. From `0.1.0` the changeset type is the
  claim and the summary has to support it.
- **The scaffolded parser repositories are untouched.** `scripts/parser-template/` still ships the
  pre-alpha ladder, because a repository with no published version has nothing to settle. Moving
  those is a separate decision for a separate set of packages, and this ADR is deliberately not it.
- **This is reversible in one direction only.** A published version is permanent
  (`RELEASING.md`, "Credential rotation, revocation, and compensating actions"). If `0.1.0` turns
  out to be premature, the remedy is a later version that says so, never an unpublish.

## What this decision is not

It is not a release cadence. How often these packages ship is unsettled and is tracked elsewhere;
nothing in this ADR sets, implies or constrains a frequency. The audit that accompanies it records
which cadence questions were deliberately left open and why.
