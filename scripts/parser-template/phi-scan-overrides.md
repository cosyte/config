# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains a `### <path>` subsection referencing the same
path. The committed log is intentionally annoying. It discourages bypass and
creates an audit trail.

> **🛑 A `### <path>` HEADING COUNTS ONLY UNDER THE `## Entries` HEADING.** The
> engine reads this file section-scoped, and a `###` anywhere above `## Entries`
> (in the Format section below, in a legend, in prose) is **not** an entry. A
> sibling's committed log held five `###` headings above its own `## Entries`
> section, and an unscoped reading turned all five into honoured bypass paths.
> Headings inside a fenced code block are skipped too, so the example below
> cannot become an entry.

> **A BYPASS IS RECORDED AND THEN REFUSED. IT CANNOT PRODUCE A CLEAN RUN, IN ANY
> MODE.** `--allow-fixture` withdraws a file from the read set, and the scanner
> refuses (**exit 2**) over a target it enumerated and never read: a scan that
> did not open a file has no clean verdict to give about it. Three gates stand
> between the flag and a clean run, and each refuses on its own: an **unlogged**
> path is rejected at the argument tier; a logged path the run **does not
> enumerate** is refused because the flag would subtract nothing; and a logged
> path the run **does** enumerate is admitted, recorded, withdrawn, and then
> refused by the completeness rule. Reaching for this flag to get a green run is
> following a remedy to exit 2.
>
> **The remedy that reaches a clean run is `scripts/phi-allow-list.txt`**: a
> token-level, reviewed declaration that specific identifiers are synthetic. It
> is narrower than a whole-file bypass by construction, because the file still
> gets opened and every check still runs over it. Add the tokens; do not withdraw
> the file.
>
> **A CONVENTION IS BETTER THAN A LIST OF LITERALS.** Where the synthetic values
> live in a reserved space that is itself the provenance marker (the NANP
> fictional numbers, the SSA never-issued ranges, the RFC-reserved domains),
> declare the SPACE once in the scanner's `floor` rather than adding a literal
> per fixture. Maintaining literals by hand is the thing this gate's shared
> engine exists to delete.

> **🛑 AN UNKNOWN TAG IN `scripts/phi-allow-list.txt` NOW REFUSES.** The parser
> used to drop a tag it did not implement, silently, so a declaration its own
> header promised took no effect and its author believed it had. Five repos
> measured the cost as hits over values they had already declared synthetic. The
> canonical tags are `NAME`, `DOB`, `ID`, `ADDR`, `CITY`, `ZIP`, `PHONE`,
> `EMAIL`, `EMAILAT` and `EMAILDOMAIN`.
>
> 🛑 **THE PATH-SCOPED MAIL FORM IS `EMAILAT <repo-relative path> <address>`, NOT
> `EMAIL`.** It is narrower than allowing a whole domain on the commit-blocking
> route, which is the remedy to reach for first. `EMAIL` takes ONE field and
> takes the rest of the line as the address, so `EMAIL <path> <address>` is
> accepted, joined into one value that matches nothing, and declares nothing:
> the unknown-tag refusal cannot see it, because `EMAIL` is a known tag.

> **This is the STARTER template.** `detect` in `scripts/phi-scan.ts` is empty,
> so `pnpm phi-scan` finds the cross-cutting SSN/email floor and nothing else.
> Before you rely on it as a real PHI gate for this standard, write this
> standard's field-level detection there. If this repo genuinely has no
> PHI-bearing fields to key on, say so in a comment where `detect` is left empty,
> so a reader can tell a decision from an omission: the clean line says whether a
> detector ran at all, on every run, for exactly that reason.

## Format

Each entry is a markdown subsection, **under this file's `## Entries` heading**:

```
### <path>

- **Date:** <YYYY-MM-DD>
- **Reason:** <one-line justification>
- **Approved by:** <committer name>
- **Expires:** <YYYY-MM-DD or "permanent">
```

## Entries

(none yet)
