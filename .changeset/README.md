# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Every meaningful PR
adds a changeset describing the bump:

```sh
pnpm changeset
```

Pick the bump type by ordinary semver on the **`0.1.x`** line: **`patch`** for a fix, **`minor`** for
an addition or a deliberate widening, **`major`** for a removal or a rename. `major` is available on
a `0.x` version and is not reserved. The blanket pre-alpha rule that every bump was `patch` was
retired by [ADR 0002](../documentation/decisions/0002-the-0-1-0-version-line.md).

A change that reaches no published tarball gets **no changeset at all**: put it in the root
`CHANGELOG.md` instead. `scripts/changeset-guard.mjs` refuses a changeset that bumps nothing, and
`changeset add --empty` writes exactly that file, so it is banned here by name.

Changesets' own changelog generation is disabled (`"changelog": false`); each package's
`CHANGELOG.md` is hand-maintained in Keep a Changelog format, and its `[Unreleased]` heading is
promoted to a version heading BY HAND in the pull request that adds the changeset. Only the
`packages/*` workspaces are released; the private root package (`cosyte-config`) is not part of the
release set.
