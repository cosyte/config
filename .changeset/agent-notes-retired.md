---
"@cosyte/script-utils": patch
---

Deprecated: the agent-notes checker, `@cosyte/script-utils/agent-notes` and its bin `cosyte-agent-notes`. The agent notes, `documentation/agent-notes.md`, were removed from every Cosyte repository (D62), so remove the package script or CI step that runs it. Until a minor release removes the entry point and the bin, a repository with no notes file (not tracked, or deleted from the working tree) passes: the checker exits 0 with one line, `agent notes: OK, no agent notes (retired, D62)`, where it used to fail on a pointer left in the card, a source comment or a changelog. A repository that still has the file is checked as before, and a failing run ends with a line saying the notes are retired. `--help`, the `script-utils` command list, the declarations and the README say it is deprecated.
