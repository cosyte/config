---
"@cosyte/script-utils": patch
---

`check-no-emdash.sh` now ships in this package, so a repository can execute the em-dash gate instead
of keeping a copy of it. Run it as `bash node_modules/@cosyte/script-utils/check-no-emdash.sh`, which
is what a `check:no-emdash` package script should point at; arguments forward, including through the
`--` that `pnpm run` passes along.

Four modes, and the exit vocabulary is two codes. No argument scans every tracked file. `--stdin
LABEL` scans text that is not a file, which is how a workflow checks a pull request title, body and
commit messages. `--list-scanned` writes the NUL-separated, repo-root-relative path of every tracked
file the default scan reads, so a repository adopting this gate can compare its coverage against
whatever it ran before. `--self-id` writes the sha256 of the copy that is executing, so a repository
can prove it is running these bytes and not a fork of them. Exit 0 means the mode completed and found
nothing banned; exit 1 means anything else, with the cause on stderr.

A repository narrows what is scanned through a tracked file at its own top level,
`scripts/check-no-emdash.exclude`: one entry per line, `#` comments and blank lines ignored, an entry
ending in `/` covering every tracked path beneath it, every entry anchored at the repository root. An
entry matching no tracked path is refused rather than ignored, because an exclusion that has outlived
its subject is a hole nobody is looking at. What is MATCHED is not configurable: the banned forms are
the literal character, its percent-encoded and backslash-u spellings, and the three HTML entities.

The three existing entry points are untouched. `isCliEntrypoint`, the shared PHI scanner and the
shared internal-reference gate export exactly what they exported before, and none of them is loaded
by anything added here.
