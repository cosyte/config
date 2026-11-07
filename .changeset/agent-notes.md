---
"@cosyte/script-utils": patch
---

A new entry point, `@cosyte/script-utils/agent-notes`: the checker for a repository's agent notes, which replaces each library's own. What does not fit on the CLAUDE.md card lives in one file, `documentation/agent-notes.md`, and the card points into it in one form, `documentation/agent-notes.md#<anchor>`. The checker reads every tracked file and requires every pointer to name a heading of the notes (its GitHub slug) or an explicit `<a id>` or `<a name>` target; in CLAUDE.md it also refuses a bare backticked `#anchor` and `agent-notes.md#` without its directory. A notes directory, notes the card never points into, a blank notes file, an empty section and a citation of the umbrella's deleted ADR 0023 or its doc-budget hook are findings. Run it with `node node_modules/@cosyte/script-utils/agent-notes.js`; it exits 0 when clean, 1 with each finding's file, line and rule, and 2 when it cannot run.
