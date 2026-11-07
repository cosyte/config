# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Changesets drives
the version bump, the publish, and the release section in `CHANGELOG.md`: a release writes its own
version heading there from the changesets it consumed. So the changeset summary is the changelog
entry. Write it here, and do not hand-edit `CHANGELOG.md`.

Add a changeset for every change a consumer of `{{PKG}}` would notice:

```bash
pnpm changeset
```

Before its first alpha the package stays on the `0.0.x` line, so pick **patch**. From the `0.1`
line on, pick **minor** when a change adds behavior a consumer can call and **patch** when it
corrects behavior. Write the summary for a reader of the package: its first sentence becomes the
release note.
