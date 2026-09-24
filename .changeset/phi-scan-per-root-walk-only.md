---
"@cosyte/script-utils": patch
---

`@cosyte/script-utils/phi-scan`: the per-root observation rule is answered from the WALK's reads
only, as its own refusal sentence always said.

**A scan root that is missing or empty on disk now refuses in `all` mode even when git tracks files
under it.** The rule asked whether each root yielded a file that was read, and answered from every
read the run took, including the index-union reads of the bytes git carries. In a real repository
every root holds tracked files, so an emptied or missing root was credited by the index and the sweep
printed `OK: no hits` at the clean code. It now names that root in the starved-root refusal at your
`refuse` code. **If a root of yours is empty or gone on disk, this release refuses where 0.1.0
reported clean**: point the root at a directory this run can read, or drop it.

The index route's coverage is unchanged. Those tracked files are still read from the bytes git
carries, and a hit in them is printed before the refusal. The completeness rule still counts every
read, so a tracked path the walk did not list is not reported as unread. A root the walk reads is
never refused by this rule, whether or not its working tree matches the index. No exit code, flag or
message is added.
