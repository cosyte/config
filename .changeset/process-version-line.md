---
"@cosyte/process": patch
---

Print `cosyte-process <version>` on stderr before a delegated verb runs its tool.

`build`, `test`, `lint`, `typecheck` and `format` now write one line naming the running
`@cosyte/process` version, ahead of the tool's own output, so a consumer can see which version of the
shared process scripts produced a run without asking its lockfile. The version is read from this
package's manifest at run time, so it follows every bump on its own.

`cosyte-process check` prints no such line, stdout is untouched, and nothing else changes: the
baseline invocations, the modifiers, the override semantics and the verbatim exit-code propagation
are all exactly as they were in the previous version.
