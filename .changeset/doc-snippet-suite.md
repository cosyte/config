---
"@cosyte/vitest-config": patch
---

Add the doc/code-agreement harness on a new `@cosyte/vitest-config/snippets` subpath:
`docSnippetSuite()` plus the factored primitives (`extractRunnableSnippets`, `rewriteAssertions`,
`remapImports`, `runSnippet`). It extracts every fenced ` ```ts runnable ` block from a package's
`docs-content/`, compiles it, executes it against the (built) package, and checks its inline
`// => value` assertions — the documentation analog of the parser conformance runners, so a green
docs build can never carry a snippet that silently disagrees with the code. devDep-only; zero new
runtime deps (Vitest is already a peer). Stays on the `0.0.x` ladder.
