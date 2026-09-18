---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/phi-scan` gains two refusal tiers, both of them states in which an `all`-mode
sweep previously reported on a corpus it did not have. The engine is about to have its first
consumer, and walking that consumer's requirements against it found these two.

**The per-root observation rule.** `all` mode now refuses unless every `scanRoots` entry yielded at
least one file that was actually read, and the refusal names every starved root. The completeness
rule asks whether every target was read; nothing asked whether a root produced a target at all, and
one productive root made the whole run look productive. Measured before the change: a caller
supplying an `isWalkReadable` that admits nothing read no file on either sweeping route and printed
`OK: no hits` at the CLEAN code over a tracked file carrying a live dashed identifier. A missing
root, an unreadable one, and a root whose every file the read filter drops are all in this tier, so
the `.d.ts` no longer has to say that the ways a root can contribute nothing are not enumerable.

**The enumeration TOCTOU window.** A target the walk listed and that was gone by read time refused
unconditionally, which made an ordinary mid-run deletion look like an unaccounted-for file. An
UNTRACKED file removed during an `all`-mode run is now reported SKIPPED instead: git carries no
bytes at such a path, so nothing the repository holds went unread. The exception is bounded rather
than described. A tracked file, a non-`ENOENT` failure, a path named on argv, and a path that came
BACK before the run ended all still refuse, and the re-check happens at the END of the run, which is
the widest window the run can offer.

**A finding names a position and stops there.** A hit report prints the locus, the locator inside it
and the rule that fired, and no longer the token that matched: `segment=(ssn) (dashed SSN pattern)`
where it used to carry the identifier as well. stderr is a CI log, and a diagnostic ABOUT a PHI leak
that quotes the leak is a second copy of it somewhere with no retention policy. The value a detector
passes to `ctx.hit` is accepted and DROPPED at the boundary rather than stored, so `Hit.value` is
now optional and a hit the engine reports never carries one; a detector's own source needs no
change. A consumer whose gate tests assert that the matched identifier reaches stderr asserts on the
locator and the rule instead, which is also the stronger observable: it can only be written by a
report of a finding, where an echoed payload can be written by a scanner that never graded it.

Neither the exports, the configuration surface, nor the detection rules change: both subpaths export
exactly what `0.0.2` exports, and the cross-cutting floor detects the same two shapes it always did.
What changes is what the engine refuses to call clean, and what a report of a finding says. It lands
in the same release as the settled-surface line move, whose own entry records that that change
touched no engine code; this entry is the one that did.
