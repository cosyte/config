---
---

RELEASE-DRY-RUN: stop `prepublishOnly` running a tool that packs, which broke every version bump.

- `@cosyte/test-utils`'s `prepublishOnly` ended in `pnpm attw`, and `attw --pack .` packs a tarball
  of its own. Run from inside `pnpm publish`'s staging context that pack lands where `attw` cannot
  find it, and the step dies with `ENOENT: cosyte-test-utils-0.0.2.tgz`.
- It stayed hidden because `publish --dry-run` skips a version already on npm, so the chain only ran
  on a bump. It first fired on the `0.0.2` Version PR and would have failed the real publish too,
  since `changeset publish` also runs `prepublishOnly`.
- `attw` still runs twice where it belongs: its own CI step and the `Pack integrity` job. Coverage is
  unchanged. The rule is written down in `RELEASING.md`.

This is an empty changeset: it changes a lifecycle script and a doc, not a published package's
surface, so it bumps no version.
