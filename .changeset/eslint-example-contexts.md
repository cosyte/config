---
"@cosyte/eslint-config": patch
---

`jsdoc/require-example` no longer lists the `ExportNamedDeclaration > VariableDeclaration` context, which never reported: an exported constant, arrow function or function expression with a doc comment already passed without an `@example`, so lint results do not change.

The config's own doc comment no longer says the Pathways engine opts out of the library rules with `{ library: false }`: Pathways runs the library defaults, and the option stays for an application with no published API.
