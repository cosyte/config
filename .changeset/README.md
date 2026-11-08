# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Every meaningful PR
adds a changeset describing the bump:

```sh
pnpm changeset
```

Pick **`patch`**, for a fix and for an addition alike. The operator's rule since 2026-11-07, in
their words: "do not move anything to a minor. do patch versions unless I say otherwise". The
packages stay on the **`0.1.x`** line together; a removal or a rename is raised with the operator
rather than written as a changeset. The rule is recorded as an amendment to
[ADR 0002](../documentation/decisions/0002-the-0-1-0-version-line.md), which had made `minor` the bump
for an addition.

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
