---
"@cosyte/script-utils": patch
---

Every gate is now a bin, so a repository with no `package.json` can run it through npx: `cosyte-no-emdash`, `cosyte-attw`, `cosyte-phi-scan`, `cosyte-internal-refs`, `cosyte-readme`, `cosyte-claude-card`, `cosyte-agent-notes` and `cosyte-catalog`, each with `--help`, and `script-utils`, the dispatcher npx runs by the package's name (`npx -y @cosyte/script-utils@0.1 no-emdash`). The dash gate also matches every form the marketing and consulting scanner caught, in any case: the characters, URL encoding, the backslash-u escape (plain, braced and eight-digit), the braced backslash-x escape, the CSS escape, the Unicode name, and the named, decimal and hexadecimal HTML entities with or without the semicolon and with leading zeros. It now reads every tracked file's name as well as its content, and answers `--help`. A tracked file or name carrying one of the newly matched forms is refused where 0.1.3 printed OK.
