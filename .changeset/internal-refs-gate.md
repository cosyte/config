---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/internal-refs` is a new entry point: the shared internal-reference gate, which
keeps item identifiers, phase and wave language, ADR numbers, internal repository paths and
traceability markers off the pages, the npm metadata and the doc comments a consumer receives.

`runInternalRefsScan(config)` returns an exit code and never calls `process.exit`. Four axes are
required and carry no default, because each is the one a port gets wrong: the project prefix set,
the standards designations that must never be flagged, the public surface, and the `package.json`
`files` entries the repository has already accounted for. A caller may widen the scanned surface and
may add detection; a configuration that tries to subtract a rule, the self-test floor or a
completeness refusal is refused by name rather than honoured, and so is an option the gate does not
know.

Exit 0 means the run completed, enumerated its configured surface, read every target it enumerated,
passed its own self-tests and found nothing. A hit report names the file, the line and the rule.

The two existing entry points are untouched: `isCliEntrypoint` and the shared PHI scanner export
exactly what they exported before, and importing the new subpath loads neither.
