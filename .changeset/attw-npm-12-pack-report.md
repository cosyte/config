---
"@cosyte/script-utils": patch
---

The `attw` gate in `@cosyte/script-utils` reads `npm pack --dry-run --json` in both of npm's shapes: the array npm 10 and 11 print, and the object keyed by package name that npm 12 prints. Before this, npm 12's object read as no tarball at all, and the gate refused every package ("npm described 0 tarball(s)"). It still requires exactly one entry whose name is the package's own, and in the object shape the key must match too; any other document is refused as before. The docblock no longer says every repo's `prepare` is the same one-liner: the parser template's `prepare` printed on stdout, inside the JSON this net reads, and twelve sibling repos still carry that line.
