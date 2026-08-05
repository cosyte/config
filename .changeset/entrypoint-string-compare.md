---
"@cosyte/script-utils": patch
---

First release of `@cosyte/script-utils`: zero-dependency helpers for the gate scripts every cosyte
repo keeps in `scripts/`.

It ships `isCliEntrypoint(import.meta.url)`, which answers "is this module the file Node was pointed
at" by comparing canonical paths. It replaces the raw string comparison those gates spelled by hand,
`` import.meta.url === `file://${resolve(process.argv[1])}` ``, which compares two strings rather
than two paths and so answers `false` for three ordinary invocations: an extension-less specifier
that Node or `tsx` resolved, a checkout under a path containing a space, and a symlinked invocation.
In each of those the gate exits 0 having checked nothing, which is indistinguishable from a clean
pass.

The package has no runtime dependencies and no build step, because the gates that import it run
before `pnpm install` on purpose.
