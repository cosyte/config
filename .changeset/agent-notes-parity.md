---
"@cosyte/script-utils": patch
---

The agent-notes checker reads a text file that holds a NUL byte, instead of skipping it as binary (ccda tracks one, where a NUL separates a key inside a TypeScript string); a file is skipped as binary only when it is not valid UTF-8. A new rule, `cross-anchor`, holds a `<file>.md#<anchor>` pointer in CLAUDE.md or the notes, into another tracked Markdown file, to an anchor that file has. Three rules transform's own checker carried are offered opt-in with `--also title,orphan,card-path` (or `also` in options): `title`, the first level-1 heading of CLAUDE.md and of the notes names the package; `orphan`, CLAUDE.md points at every `##` section of the notes; and `card-path`, a path CLAUDE.md names inside the repository is tracked. They are off by default because, measured over the estate, each would fail repositories that follow the card spec.
