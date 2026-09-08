# Drift enforcement: which repos the baseline's verdict binds

`drift-manifest.json` is the cosyte estate's engineering baseline, and
`scripts/drift-check.js` grades every repo against it. This file answers the one question the
baseline used to leave to silence: **whose failure is anybody's problem?**

The answer lives in the manifest's `enforcement` block, and nowhere else. No evaluator carries a
roster, and no repo name is written into `scripts/drift-check.js` for this purpose.

## What BINDING means

A repo listed in `enforcement.binding` is a repo the drift run is a **verdict about**. Two things
fail the run for it:

1. **It drifts.** One or more of the requirements its baseline declares is unmet. Exit `1`.
2. **The run reached no verdict about it.** It is absent from the corpus, present but empty (an
   uninitialized submodule), or present with nothing in it that could be read. Exit `1`, with a line
   naming the repo and saying that no verdict was reached.

The second one is the point. Before enforcement existed, a repo that was not there was reported
`SKIP` and the run could still exit `0`, so a corpus holding one green repo and missing the other
twenty-three was a green. A gate wired to that reports the health of whatever happened to be checked
out, which is not a property of the estate at all.

## What DEFERRED means, and what it does not

A repo listed in `enforcement.deferred` is a repo the verdict does not bind **yet**. Every entry
carries a written `why` of at least 40 characters, the same floor a `configSubject` exemption's
reason carries, and the validator refuses a placeholder.

Deferral is **not forgiveness**, and it relaxes **no requirement**:

- A deferred repo that is present in a corpus and drifts still reds the run, through the ordinary
  worklist, exactly as it did before enforcement existed. The declaration only ever ADDS a failure.
- A deferred repo is excluded from a gate run by **not being in that run's corpus**, never by being
  excused a rule.
- Nothing about a deferral changes what that repo owes. Its baseline is unchanged.

## What must be true before a repo joins the binding set

Two conditions, and both are about evidence rather than intent:

1. **It measures green.** `node config/scripts/drift-check.js`, run from an umbrella checkout that
   has that repo initialized, reports no drift for it. A repo joining the set while red would red
   the gate on every pull request, for work only that repo's own migration item can do.
2. **It is present in the corpus the gate actually runs over.** This is the condition that binds
   today. `config`'s `verify` job checks out `config` alone, so `config` is the only repo the gate's
   own corpus holds. Binding any other repo, however green, would trip the no-verdict failure on
   every run. Checking out a sibling repository inside `config`'s CI would need a credential, which
   is a new dependency and an operator decision rather than a change anyone makes in passing.

That is why the shipped binding set is `["config"]` even though eight other repos measured clean on
2026-09-08: green was necessary and not sufficient, and `enforcement.provenance` records the run
those numbers came from.

## How a repo joins: one edit, to the standard alone

Move its path out of `enforcement.deferred` and into `enforcement.binding` in
`drift-manifest.json`. That is the whole change. No JavaScript file is touched, because the
evaluator reads the roster out of the standard it was pointed at.

From that moment the checker requires that repo's presence in the corpus and reds on its drift, and
`pnpm run drift:validate` refuses the edit if it leaves any estate path classified neither way,
classifies one repo twice, names a repo the estate does not carry, or empties the binding set.

## What is never a way to close a deferral

- **Loosening a requirement**, removing a group, or re-thresholding one. `enforcement` changes who
  is bound; it never changes what the baseline asks for.
- **Adding a `configSubject` exemption**, or any other route that excuses a rule to buy a green.
- **Making the CI step advisory again.** The check runs in `verify`, this repository's only required
  status check, with no `continue-on-error`, no trailing `|| true` and no `if:`. If the phi-scan
  capability probe's controls ever prove unstable there, the remedy is to fix the controls: a
  control that cannot fail is worth nothing, and a required check that gets disabled is worth less.
- **Shrinking the roster.** Dropping a repo out of `binding` is the same class of move as excusing a
  rule, and it is visible: the validator refuses a repo classified neither way, so the drop has to
  be written down as a deferral with a reason.

## Where each piece lives

| file                                      | what it holds                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `drift-manifest.json`                     | `enforcement.binding`, `enforcement.deferred` and the provenance of both                                                  |
| `drift-manifest.schema.json`              | the shape of that block; `enforcement` is in the root `required` list, so it cannot be deleted silently                   |
| `scripts/validate-drift-manifest.mjs`     | the four cross-checks a schema cannot express: totality, no double classification, no unknown repo, non-empty binding set |
| `scripts/drift-check.js`                  | the evaluator. It reads the declaration and carries no roster                                                             |
| `.github/workflows/ci.yml`                | the `verify` step whose exit status refuses the merge                                                                     |
| `test/drift-enforcement-manifest.test.ts` | the declaration's own refusals                                                                                            |
| `test/drift-enforcement-gate.test.ts`     | the gate's behaviour, including every refusal it kept                                                                     |
| `test/drift-gate-workflow.test.ts`        | that the step is present in `verify` and unneutralized                                                                    |
