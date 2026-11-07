---
"@cosyte/script-utils": patch
---

A new entry point, `@cosyte/script-utils/claude-card`: the checker for the CLAUDE.md card every Cosyte repository keeps. A card opens with `# <name>` and a paragraph, then has exactly three level-2 sections in order, Gate, Hazard and Rules (a heading may go on after its word, as in `## Rules that bind here`), none empty. It is at most 60 lines, every line at most 100 characters with code included, and at most 5,120 bytes, and when an AGENTS.md sits beside it the card imports it on a line of its own (`@AGENTS.md`). Run it with `node node_modules/@cosyte/script-utils/claude-card.js`; it exits 0 when the card follows the spec, 1 with each finding's line and rule, and 2 when CLAUDE.md cannot be read. `checkClaudeCard`, `runClaudeCardGate` and the limits it checks against are exported.
