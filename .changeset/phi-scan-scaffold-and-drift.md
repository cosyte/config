---
---

PHI-GATE-SUITE (repo-level; no published package changes): enforce `phi-scan` in the drift baseline
and ship it as a scaffold default.

- `drift-manifest.json` `requiredScripts` now includes `"phi-scan"`, so `drift-check` flags any
  parser that loses its commit-time PHI scanner (all six targets already carry one).
- The parser template (`scripts/parser-template/`) now ships a STARTER `scripts/phi-scan.ts` (shared
  machinery + a cross-cutting SSN/email floor + a fenced TODO obligating structured, field-level
  detection), `scripts/phi-allow-list.txt`, `phi-scan-overrides.md`, `test/scripts/phi-scan.test.ts`,
  the `phi-scan` script + `simple-git-hooks` pre-commit wiring, `run-phi-scan: true` on the CI
  caller, and `scripts/` in the tsconfig/lint/format scope.

This is an empty changeset: the change touches the drift manifest and the scaffold template, neither
of which is a published `@cosyte/*` package, so it bumps no version (repo-level entry lives in the
root `CHANGELOG.md`).
