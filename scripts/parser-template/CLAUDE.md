# {{PKG}}

Our {{TITLE}} parser for Node.js and TypeScript.
It is published to npm under MIT, reads real-world messages leniently (a warning, not a throw, short
of structural corruption) and writes spec-clean output, with zero runtime dependencies.

@AGENTS.md

## Gate

Required checks: the shared CI ladder (`ci`) on Node 22, 24 and 26, `no-emdash`, and
`codeql / analyze`. From the repo root, with the pnpm version `packageManager` pins:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test:coverage
pnpm build
pnpm attw
pnpm check:no-emdash
```

## Hazard

Every message this library reads can carry a patient's identity and clinical record. The failure
that hurts is the quiet one: a field parsed wrong but plausible travels downstream and nothing flags
it. When a value is in doubt, warn rather than guess. Keep message text out of errors, warnings and
logs, and keep fixtures synthetic: real patient data never enters this repository.

## Rules

- Errors and warnings carry stable codes and positions, never message text: a diagnostic that
  quotes a field publishes it wherever the log goes.
- `attw` stays exactly `node scripts/attw.mjs`, a caller of `@cosyte/script-utils/attw`: the bare
  CLI exits 0 on a tarball that carries no types.
- `scripts/phi-scan.ts` calls `@cosyte/script-utils/phi-scan`. Add this standard's field detectors
  there; each one consults `ctx.allow`, and an exclusion is a literal path, never a class.
- A change under `src/` adds a changeset: `minor` for behavior a consumer can call, `patch` for a
  fix. The changeset summary is the changelog entry, so never hand-edit `CHANGELOG.md`.
- `.github/workflows/release.yml` keeps its four grants (`actions: read`, `contents: write`,
  `id-token: write`, `pull-requests: write`): without them the release fails at startup.
- Fix a gate in cosyte/config (`scripts/parser-template/` or `@cosyte/script-utils`), not only here,
  or the next parser scaffolded from the template is born with the same defect.
- Longer notes go in `documentation/agent-notes.md`, and this card points to them as
  `documentation/agent-notes.md#<anchor>`.
