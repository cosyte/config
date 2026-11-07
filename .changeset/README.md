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

Changesets writes each package's `CHANGELOG.md` (`"changelog": "@changesets/cli/changelog"`,
since 2026-11-07, ST35): the version commit adds a section for every release from the changesets it
consumed, so the changeset summary is the changelog entry. Write it for a reader of the package, and
do not hand-edit a package `CHANGELOG.md`; the history kept by hand before then sits under its
`## Released before this file was generated` heading. Only the
`packages/*` workspaces are released; the private root package (`cosyte-config`) is not part of the
release set.
