---
"@cosyte/script-utils": patch
---

The CLAUDE.md card checker no longer sends detail to `documentation/agent-notes.md`, which was removed from every repository (D62). A card over 5,120 bytes, or with a level-2 heading other than Gate, Hazard and Rules, is told to move the detail to where it is used: a test, a comment at the code it guards, an ADR, the README or docs, or a runbook. What the checker checks, and its exit codes, are unchanged.
