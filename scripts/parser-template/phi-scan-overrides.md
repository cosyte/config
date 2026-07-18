# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains a `### <path>` subsection referencing the same
path. The committed log is intentionally annoying — it discourages bypass and
creates an audit trail. Prefer extending `scripts/phi-allow-list.txt` (a
token-level, reviewed declaration) over a whole-file bypass, which silences
_every_ check for that file.

> **This is the STARTER template.** `scripts/phi-scan.ts` ships with the shared
> machinery and a cross-cutting SSN/email floor ONLY. Before you rely on
> `pnpm phi-scan` as a real PHI gate for this standard, add structured,
> field-level detection (names, DOB, MRN / member id, address, phone) in the
> fenced TODO section of `scripts/phi-scan.ts` — see the sibling parsers
> (`hl7` / `dicom` / `x12` / `ccda` / `ncpdp`) for worked examples.

## Format

Each entry is a markdown subsection:

```
### <path>

- **Date:** <YYYY-MM-DD>
- **Reason:** <one-line justification>
- **Approved by:** <committer name>
- **Expires:** <YYYY-MM-DD or "permanent">
```

## Entries

(none yet)
