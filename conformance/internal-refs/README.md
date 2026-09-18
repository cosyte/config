# Internal-reference gate: the conformance corpus

What this is: one entry per repository that carries a hand-written variant of the internal-reference
gate, holding that variant's rule inventory and the samples that prove the shared implementation
carries it. `@cosyte/script-utils/internal-refs` is the shared implementation; this directory is the
evidence that adopting it loses nothing.

## The claim this corpus exists to grade

For every populated entry, for every rule in that repository's inventory, in both directions: the
shared implementation, configured the way that repository configures it, flags what the variant
flags and lets through what the variant lets through. A repository that adopts the shared gate and
stops catching something its own copy caught is the failure this is built to make visible, and it
presents as a green run.

## The three states

| state        | what it means                                                                   |
| ------------ | ------------------------------------------------------------------------------- |
| `populated`  | a session adopted that repository and transcribed its variant from its checkout |
| `pending`    | nobody has adopted it yet; carries a reason and no sample material              |
| `unreadable` | the entry file is absent or will not load; reported, never skipped              |

A pending entry that carries sample material is **malformed**. Material nobody read inside that
repository is material nobody can attribute to a tree, so it is refused rather than accepted as a
head start.

## Populating an entry

Only the session **adopting** that repository does this, from inside that repository's own checkout
or from a variant a spec manifest names. No session populates an entry for a repository it is not
adopting, because no implementer may read another repository's source.

1. Read that repository's gate, and record the exact sha you read it at.
2. Transcribe its rule inventory into `ruleSets`, one rule set per surface the variant keeps a
   separate rule array for, with a positive and a negative sample for every rule. Where the variant
   carries no sample for a rule, that is a defect to report, not one to invent a sample for.
3. Resolve its axes into `canonicalConfig`: the prefix set, the standards designations, the surface
   paths, the tarball accounting, and whether the source doc-comment pass runs.
4. Add every contradiction against an already-populated entry to `conflicts.js`, with both rule
   sets, the rule, and whether it was decided as a configuration axis or as canonical behaviour.
5. Run the corpus and superset suites. They grade the entry you just wrote.

`entries/hl7.js` is the worked example.

## What the shape is deliberately not

It is not fitted to one variant. `ruleSets` is a list because a variant may keep two rule arrays for
two surfaces, or one, or three; rule names are the variant's own words rather than a shared
vocabulary; and `canonicalConfig` is whatever axes that repository sets rather than a fixed record.
A later repository's differently named, differently shaped inventory is added by writing its entry
file, with no edit to the graders.
