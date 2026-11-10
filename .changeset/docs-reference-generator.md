---
"@cosyte/process": patch
---

A second bin, `cosyte-docs-reference`: it generates a package's API reference from its TSDoc comments into `docs-content/api/`, one page per module for every entry point in `exports`, with TypeDoc and typedoc-plugin-markdown (now dependencies of this package), and reports each export (function, class, interface, type alias, enum, variable or namespace) with no TSDoc summary. `--check` writes nothing and fails when the committed pages differ from what the source generates. Exit 0 clean, 1 a finding, 2 the input could not be read. `cosyte-process` itself does not change.
