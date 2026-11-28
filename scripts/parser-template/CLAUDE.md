# {{PKG}}

Our {{TITLE}} parser for Node.js and TypeScript.
It is published to npm under MIT, reads real-world messages leniently (a warning, not a throw, short
of structural corruption) and writes spec-clean output, with zero runtime dependencies.

@AGENTS.md

## Gate

The gate is in AGENTS.md, in the order CI runs it. Run it from the repo root before a push, with
the pnpm version `packageManager` pins first on PATH.

## Hazard

Every message this library reads can carry a patient's identity and clinical record. The failure
that hurts is the quiet one: a field parsed wrong but plausible travels downstream and nothing flags
it. When a value is in doubt, warn rather than guess. Keep message text out of errors, warnings and
logs, and keep fixtures synthetic: real patient data never enters this repository.

## Rules

- Errors and warnings carry stable codes and positions, never message text: a diagnostic that
  quotes a field publishes it wherever the log goes.
- `attw` stays exactly `cosyte-attw`, the shared gate from `@cosyte/script-utils`: the bare CLI
  exits 0 on a tarball that carries no types.
- `scripts/phi-scan.ts` calls `@cosyte/script-utils/phi-scan`. Add this standard's field detectors
  there; each one consults `ctx.allow`, and an exclusion is a literal path, never a class.
- A change under `src/` adds a changeset: `minor` for behavior a consumer can call, `patch` for a
  fix. The changeset summary is the changelog entry, so never hand-edit `CHANGELOG.md`.
- `.github/workflows/release.yml` keeps its four grants (`actions: read`, `contents: write`,
  `id-token: write`, `pull-requests: write`): without them the release fails at startup.
- Fix a gate in cosyte/config (`scripts/parser-template/` or `@cosyte/script-utils`), not only here,
  or the next parser scaffolded from the template is born with the same defect.
- The card stands on its own: each rule names its failure and cites its PR or issue. Reasoning
  goes in a test, a comment at the code it guards, an ADR in `documentation/decisions/`, the
  README or `docs-content/`; git and the PRs keep the history.
