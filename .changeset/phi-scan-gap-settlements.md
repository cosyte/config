---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/phi-scan` settles the eight differences its first consumer's committed corpus
found between that repository's own scanner and this engine. Every one of them now has ONE
behaviour, so a repository adopting the engine gets a verdict it can predict from this entry.

**`all` mode reads the bytes git carries at EVERY tracked path.** `scanRoots` bounds the WALK, which
answers what is on disk under the roots you declared; the index answers what your repository
CARRIES, and a root list was narrowing that too. Measured on the first consumer: three real messages
under an undeclared top-level directory were read by neither route, and a tracked symbolic link
outside every root was reached by neither. **If your roots are narrower than your repository, this
release reads more of it**, so run `pnpm phi-scan` once before you rely on the exit code in CI. The
two READ filters are unchanged and still apply on both sweeping routes, so a tracked `.md` and an
`excludedPaths` entry mean the same thing they did. `--staged` is untouched.

**`--staged` refuses what YOUR staged scope admits, and nothing else.** Its non-regular and unmerged
refusals used to fire for any path under a scan root, so a repository whose `isStagedReadable` is
narrower than its roots had commits blocked that its own gate had always let through. They key on
`isStagedReadable` now. **This refuses less at the pre-commit hook**: a staged symbolic link that
your staged scope declines is no longer refused there, and `all` mode still refuses it on both of its
routes, so your own sweep still catches it. Widen `isStagedReadable` if you want the hook to refuse
it too.

**A hit in the bytes git carries says which kind it is.** The single `(as git carries it)` label
becomes `(git index)` for a path whose working-tree copy the run never read and
`(git index; the working tree differs)` for one whose disk copy carries other bytes, with a footer
counting how many of the reported hits are in those bytes. The second kind reads clean in the file a
developer opens, so re-staging is part of its remedy and one label hid that. A gate test asserting
the old label asserts one of the two new ones.

**A refusal no longer discards the hits already in hand.** An unmerged index entry or a tracked link
refused the whole sweep before anything was read, so a consumer saw a refusal with no indication that
PHI had already been found. The walk sweeps first, prints what it found, and the refusal follows at
the same code.

**A clean run that skipped a file says so on stdout.** `OK: no hits (N untracked file(s) skipped, see
stderr)`. The skip report was on stderr alone, which is where a CI log buries it. With nothing
skipped the line is byte-identical to what it was.

**A scan root has one settled outcome per KIND.** A regular file is scanned as one target, a symbolic
link is refused rather than followed, and a directory that cannot be listed is refused at your
`refuse` code naming the path: that last one used to escape `readdirSync` uncaught and take node's
own exit 1, the code the exit contract reserves for HITS FOUND.

**Two refusals reworded, because their remedies differ.** "git could not read this repository's git
index" and "the git index holds no entries" were one sentence. The starved-root refusal now says how
many of how many roots went unobserved and names them.

**`--allow-fixture` still cannot reach a clean run, and which tier refuses it follows the mode.** A
bypass beside a positional path names something the run does not enumerate; a lone bypass declares a
path an `all`-mode run would have read and is refused by the completeness rule. Both name the path.

The two narrowings above are recorded in full, with the route that still refuses the same entry, in
`documentation/decisions/0003-the-phi-scan-engine-gap-settlements.md`. The exports, the configuration
surface and the detection rules are unchanged: the cross-cutting floor detects the same two shapes,
and no repository's rules ship in this package.
