---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/phi-scan` now carries ALL of the PHI-scan PROCESS, parameterised, so a
consuming repo's scanner is a declarative parameter file: walking, reading, enumeration, the union
with the bytes git carries, staged-blob handling, completeness and its bookkeeping, reporting, exit
codes, refusals, and the process tail. `runPhiScanCli(config)` is new and is the whole tail.

Nine engine defects are fixed, every one of them a case where the gate was weaker than declared and
said nothing: the named-path route followed symlinks; `--staged` omitted `--ignore-submodules=none`
so a git config could blank the pre-commit route; an unreadable path took node's exit 1, this
contract's HITS code; the default read filter exempted Markdown, so a `README.md` scan root read
nothing and reported clean at exit 0 over a live identifier; the allow-list parser dropped `ADDR`,
`PHONE` and `EMAIL` at a `default: break`; override-log entries were not section-scoped; `--staged`
misdiagnosed an unmerged path; the union's `cat-file` ran under node's default byte bound with the
locus computed after the read; and a declared format that failed to parse fell back to the floor
alone.

The `0.0.2` surface is BROKEN deliberately and without a shim, because no repo had adopted and an
additive surface would have preserved the defects. `isStagedReadable` and `isWalkReadable` are
removed and throw a `TypeError` naming their replacement rather than being silently ignored;
`stagedRoots` makes the staged containment a config-time comparison; `ScanRootSpec` replaces seven
root spellings with one type whose `shape` is declared and checked; `isReadable` defaults to reading
everything.

Detection is declarative: `detectors` is a LIST of grammars (`delimited-record`, covering HL7 v2,
X12 and ASTM; `xml`; `json`) plus tables of positions, conjunctive equality guards and named value
rules, with reserved spaces so a repo declares a convention rather than a literal per fixture. The
"five universal kinds" premise is refuted and recorded as such: the kind set is declared and open,
and several repos legitimately fill none.
