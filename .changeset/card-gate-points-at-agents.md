---
"@cosyte/script-utils": patch
---

`checkClaudeCard` and `cosyte-claude-card` now hold a public repository's card to a Gate section that points to its AGENTS.md: with an AGENTS.md beside the card, a `## Gate` that does not name AGENTS.md (`gate-pointer`), holds a code block of commands (`gate-commands`), or says which checks are required (`gate-required`) is a finding, and the CLI exits 1.

A public repository writes its gate once, under `## The gate` in AGENTS.md, because copies of the gate on the card drifted from CI, and a list of required checks in a file goes stale since nothing in a repository can see its own ruleset. A card with no AGENTS.md beside it, a private repository's, is read as before. `CardRule` and `CARD_RULES` carry the three new rule ids.

What a caller must change: in a repository with an AGENTS.md, replace the commands and any required check names under the card's `## Gate` with a pointer to the gate in AGENTS.md (for example, "The gate is under `## The gate` in AGENTS.md, in the order CI runs it."), keep any note that is not a command, and read the required checks with `gh api repos/cosyte/<repo>/rules/branches/main` instead of writing them down.
