---
"@cosyte/script-utils": patch
---

A new check, `cosyte-release-pr` (also `script-utils release-pr` and the `./release-pr` entry point), fails a library whose Version Packages pull request would fail its own checks, and a changeset whose opening sentence the release would refuse.

- **`version-script`**: the `version` script runs `changeset version`, then the `VERSION` sync, then `cosyte-docs-reference` without `--check`, in that order, so the API reference that prints `VERSION` is regenerated in the release commit. A step may reach a command through another script, such as `pnpm docs:reference`.
- **`version-test`**: one test file pins `VERSION` where the mutation run can link it: no static import of the source and no load of it outside a test body, a `vi.resetModules()` call, then an import of the source inside the test body (or a helper only test bodies call), and a comparison with the version in package.json. Test files are parsed with the library's own TypeScript compiler, so a comment or a string satisfies nothing. The finding names each test that reads `VERSION` and what it lacks.
- **`changeset-bullet`** and **`changeset-shape`**: each pending changeset has a front matter block that is not empty and that the release can read, a summary when it releases a package, and an opening sentence of at most 400 characters, measured conservatively as an upper bound on the bullet the release publishes. An empty changeset, the file `changeset add --empty` writes, is refused, because the release cannot read it once consumed: a change that releases no package gets no changeset at all.

The two version rules apply only when a file under `src/` declares an exported `VERSION`. Exit 0 clean, 1 a finding, 2 the package could not be read. Nothing existing changes, so a caller changes nothing; a library adopts the check by adding `"check:release-pr": "cosyte-release-pr"` and running it in CI.
