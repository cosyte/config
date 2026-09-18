---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/attw` is a new entry point: the shared `attw` publish gate, which exists
because `attw` prints "This package does not contain types." and exits 0, so a package that ships
types reports a broken publish as a pass.

`runAttwGate({ callerUrl })` runs the gate in the working directory and RETURNS the exit code a
caller should exit with; it never calls `process.exit`. `callerUrl` is required and has no default:
`attw` is resolved as `../node_modules/.bin/attw` from it, so the binary that runs is the CONSUMING
package's own rather than one resolved relative to wherever this package was installed. A call that
omits it is refused, and a binary that is missing or not executable is refused by the path it looked
for rather than by a syscall message.

Four nets, and each catches what the others cannot: the preflight over every relative artifact path
the manifest promises, the structured document attw prints (`--format json`, asserting
`analysis.types.kind === "included"`), npm's own pack listing, and the manifest pnpm would publish.
Arguments are an allow-list of two, because a deny-list of blinding spellings bought one more
evasion per round. A manifest that declares no relative artifact path at all is REFUSED rather than
reported as checked: three of the four nets grade that one set, so an empty set makes them vacuous
and leaves the verdict standing on attw's own exit code.

The three existing entry points are untouched: `isCliEntrypoint`, the shared PHI scanner and the
internal-reference gate export exactly what they exported before, and importing the new subpath
loads none of them.
