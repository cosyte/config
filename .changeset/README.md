# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Every meaningful PR
adds a changeset describing the bump:

```sh
pnpm changeset
```

During pre-alpha all bumps are **`patch`** (this keeps each package on the `0.0.x` ladder). Changesets'
own changelog generation is disabled (`"changelog": false`) — each package's `CHANGELOG.md` is
hand-maintained in Keep a Changelog format. Only the `packages/*` workspaces are released; the private
root package (`cosyte-config`) is not part of the release set.
