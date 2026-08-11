---
"@cosyte/script-utils": patch
---

Add `@cosyte/script-utils/phi-scan`: the shared machinery of the `@cosyte/*` PHI commit-gate, as a
parameterised engine.

`scripts/parser-template/` is a SCAFFOLD rather than a dependency, so `scripts/phi-scan.ts` was
COPIED into every parser repo and a newly-found escape cost one pull request and one adversarial
review PER REPO. Three escape classes have been paid for that way already. `runPhiScan(config)` now
owns argument parsing, the allow-list and override log, target enumeration on all three routes, the
union of the working-tree walk with the bytes git carries, content deduplication under git's own
`blob <len>\0` framing, the completeness rule, every refusal, and the cross-cutting SSN/email floor.

The five per-repo axes are PARAMETERS rather than forks. `exitCodes`, `scanRoots` and
`isStagedReadable` are REQUIRED, because the siblings genuinely disagree on them and a default would
be the porting mistake the gate exists to catch; `excludedPaths`, `isWalkReadable` (the Markdown
exemption) and `regularBlobModes` are DEFAULTED, so moving one of those boundaries is a change here
plus a version bump rather than an edit in every consumer. EOL normalization has no parameter at all
and stays machinery: the walk/index deduplication is by CONTENT, so where a `text` attribute makes
the index carry LF and the working tree CRLF, both forms are scanned.

Per-standard field detection stays with the caller, through `detect`. It is handed the reported
LOCUS rather than the target path, so a hit found in the bytes git carries can no longer be reported
against a working-tree copy a developer would open and find clean; that used to be a sentence in a
comment and is now the only path a caller can reach.

Two behaviours are corrections rather than ports, and both are new here. The floor's dashed-SSN
branch now consults `allow.ids` (matching a declaration in either rendering), because with the
whole-file bypass closed a detector that consults nothing leaves a developer with a hit and no
remedy at all. And a fatal partway through the sweep now prints the hits already found BEFORE the
refusal, instead of discarding them; the refusal still wins the exit code and the clean line is
still unreachable from there.

A detector that throws REFUSES the scan rather than escaping to node's own exit code, which the
contract reserves for HITS FOUND. A misconfigured scanner throws a `TypeError` rather than returning
a code, because at the point a required axis is missing there is no trustworthy code to return.

Two containments the first draft asserted are ENFORCED rather than claimed, both falsified in review
and both reproducible against the pre-consolidation scanner: a staged path `isStagedReadable` admits
that no scan root covers is REFUSED (it used to be enumerated, read, and reported clean, with the
link's target path handed to the detector as content), and a scan root is normalised the way every
other path is, with one resolving outside the repository refused (`["./src"]` used to walk correctly
while matching no index path, emptying every index-keyed rule in silence). The optional axes are
shape-checked too, because `excludedPaths` given as an array used to throw from inside enumeration
and take node's exit 1, the code reserved for HITS FOUND.

`scanRoots` is a plain `string[]` and a root may name a regular FILE, with the kind derived from the
filesystem rather than declared. The thirteen live copies declare roots in at least six shapes and
one of them declares `{ rel, shape }` with a single file among them; deriving expresses that without
the richer type. An earlier draft crashed on such a root with an uncaught `ENOTDIR`, taking node's
exit 1. What deriving gives up is that a declaration could notice a root is not the kind it was
meant to be, and derivation cannot.
