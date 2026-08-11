---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/phi-scan` now carries ALL of the PHI-scan PROCESS, parameterised, so a
consuming repo's scanner is a declarative parameter file: walking, reading, enumeration, the union
with the bytes git carries, staged-blob handling, completeness and its bookkeeping, reporting, exit
codes, refusals, and the process tail. `runPhiScanCli(config)` is new and is the whole tail.

Engine defects fixed, every one a case where the gate ended up weaker than declared and said
nothing: the named-path route followed symlinks; `--staged` omitted `--ignore-submodules=none`, so a
git config could blank the pre-commit route; an unreadable path took node's exit 1, this contract's
HITS code; the default read filter exempted Markdown, so a `README.md` scan root read nothing and
reported clean at exit 0 over a live identifier; the allow-list parser dropped `ADDR`, `PHONE` and
`EMAIL` at a `default: break`; override-log entries were not section-scoped; `--staged` misdiagnosed
an unmerged path; the union's `cat-file` ran under node's default byte bound with the locus computed
after the read; and a root the scan could not stat was skipped exactly like an absent one, which is
fail-open on the axis that decides what the corpus is.

Most seriously, **the floor left scanned bytes in process-global state**: V8 keeps the last
successful match on the `RegExp` constructor, so after a run `RegExp.input` held the scanned file
and `RegExp.lastMatch` the matched identifier, reachable by anything later in the same process and
by any crash dump. One repo had closed that residual twice by hand, so adoption would have
reintroduced it. No per-repo parameter can restore it, and it is now scrubbed after every target and
on every exit path.

A declared format that fails to parse now REFUSES instead of falling back to the floor alone, which
is a defect in the hand-written code the engine replaces rather than in the engine. Its diagnostic
prints no text off the document: `JSON.parse`'s message embeds a window of the input, which put a
patient's given name on stderr.

The `0.0.2` surface is BROKEN deliberately and without a shim, because no repo had adopted and an
additive surface would have preserved the defects. `isStagedReadable` and `isWalkReadable` are
removed and throw a `TypeError` naming their replacement rather than being silently ignored;
`stagedRoots` makes the staged containment a config-time comparison; `ScanRootSpec` replaces seven
root spellings with one type whose `shape` is declared and checked; `isReadable` defaults to reading
everything.

A declarative vocabulary layer was built for `detectors` and then CUT: three consecutive adversarial
passes each found a blocker in it and each remedy grew a new one, and none of them touched the
process. Passing `detectors` is a `TypeError` rather than a silent no-op, and a repo declares its
field vocabulary inside `detect`, where its format parsing already lives. The "five universal kinds,
only the vocabulary differs" premise is refuted on both axes and recorded so it is not re-derived.
