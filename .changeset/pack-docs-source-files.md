---
"@cosyte/process": patch
---

`cosyte-process pack-docs` can carry further files in `source.tar.gz`.

- **The `sourceFiles` option.** A `pack-docs` key in `cosyte-process.config.json` takes
  `sourceFiles`, a list of paths relative to the package root. Each file lands at the tarball root
  under its file name, so `{ "pack-docs": { "sourceFiles": ["dist-artifacts/dependency-inventory.cdx.json"] } }`
  adds `dependency-inventory.cdx.json` beside `package.json`. `docs-content.tar.gz` is unchanged.
- **Every path is checked first.** The run refuses, naming the path and writing nothing, when a file
  does not exist, is absolute or leaves the package root, resolves outside it through a symlink, is
  not a regular file, or would carry a name the archive already has.
- **No option, no change.** With no `pack-docs` key, or an empty list, `source.tar.gz` is byte for
  byte what it was before.

What a repo must do: nothing. A repo that builds its own source archive to add a file can list the
file under `sourceFiles` and run `cosyte-process pack-docs` instead. The override file now accepts a
`pack-docs` top-level key, which it refused before; it still takes no `globs` or `flags` under it,
and `sync-version` is still refused. New exports: `loadConfig`, `PACK_DOCS_CONFIG_KEY`,
`PACK_DOCS_KEYS` and the `PackDocsOptions` and `ProcessConfig` types. Nothing exported before
changes.
