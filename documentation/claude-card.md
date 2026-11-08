# The CLAUDE.md card

Every Cosyte repository keeps a `CLAUDE.md` at its root, and every Claude Code session in that
repository reads it before doing anything else. We keep it short: a card that says what must pass
before a push, what a change here can break without a gate noticing, and the rules that bind here.
The card stands on its own, and anything longer lives where it is used
([Where the detail goes](#where-the-detail-goes)).

This is the spec. `@cosyte/script-utils/claude-card` checks it, and the parser template's
`CLAUDE.md` is written to it.

## Shape

1. **Title.** Line 1 is `# <name>`: the package name for a library (`# @cosyte/hl7`), the
   repository otherwise (`# cosyte/config`). A repository whose documents carry YAML front matter
   may put that block first; the title is then the first line after it.
2. **What this is.** One short paragraph under the title. A public repository's card then imports
   its `AGENTS.md` on a line of its own, `@AGENTS.md` (ST26), so the build, test and gate commands
   and the data rule are written once.
3. **Three sections, in this order**, each a level-2 heading that starts with its word. A heading
   may go on after the word: `## Hazard: a change here reaches every repo`, `## Rules that bind
here`.
   - `## Gate`: what must pass before a push. The required checks by name, and the commands in a
     fenced block, in the order CI runs them.
   - `## Hazard`: what a change here can break that a green gate would not show, and what to do
     about it.
   - `## Rules`: the rules that bind in this repository, one bullet each. Each names the failure
     it prevents and cites the PR or issue behind it (a decision with neither cites its date).
4. **No other level-2 heading.** Level-3 headings inside a section are fine. No section is empty.

## Limits

- **At most 60 lines**, counted the way `wc -l` counts them.
- **Every line at most 100 characters**, code blocks included. Break a long command with `\`, and
  move a long explanation off the card, to where it is used.
- **At most 5,120 bytes** of UTF-8.

The byte cap is the one that binds. A card is loaded into the context of every session in its
repository before any work starts, so its size is a cost paid on every task. 60 lines of 100
characters is up to 6,060 bytes, so with only the line and width caps a card could be 60 full lines
of dense text; 5,120 bytes (5 KiB, about 1,300 tokens) keeps a card to roughly 50 full lines or
more shorter ones. On 2026-11-07 the nine cards that already kept to 100 characters a line measured
2,440 to 4,067 bytes, so 5 KiB leaves room to grow without inviting a card to fill it. A byte cap
also counts what the width cap cannot: a line of 100 multi-byte characters is up to 400 bytes.

## Where the detail goes

A card stands on its own. It points into no file of notes, and the repository keeps none: each rule
is one bullet that names its failure and cites the PR or issue behind it. Longer reasoning goes
where it is used:

- **Why a rule binds:** a test that fails when the rule is broken, or a comment at the code it
  guards.
- **A lasting design decision:** an ADR in `documentation/decisions/` (ST38).
- **A fact a user needs:** the README or the docs.
- **An operating procedure:** the repository's runbook, such as `RELEASING.md`.

History, incident narratives and measurements stay in git and the PRs, and in the changelog when a
release carries them. Until 2026-11-08 a card pointed into `documentation/agent-notes.md`; those
notes were removed from every repository (D62), and the agent-notes checker in
`@cosyte/script-utils` is deprecated.

## The checker

```sh
node node_modules/@cosyte/script-utils/claude-card.js              # CLAUDE.md in this directory
node node_modules/@cosyte/script-utils/claude-card.js --dir <path> # another repository
```

It exits 0 when the card follows this spec, 1 with one line per finding (each naming its line and
rule), and 2 when it cannot read `CLAUDE.md`. When an `AGENTS.md` sits beside the card, the card must
import it; a card that imports an `AGENTS.md` that is not there is a finding too.
