# Registry propagation evidence: how long a just-published version stays invisible, measured

This file is the measurement the release workflow's presence budget is derived from. Open it to
answer one question: after `changeset publish` has accepted a version, how long can the public
registry go on reporting that version as absent. Every number below names the query it came from, and
the figure the workflow is graded against is the **maximum upper bound** at the end.

The presence accounting lives in `scripts/registry-presence.mjs` and runs on both arms of
`.github/workflows/release.yml`. Its budget is the maximum wall time it will wait for one package's
version to appear before it declares that version absent. Before this measurement that budget was
three probes with two five second waits between them, so roughly ten seconds, and it was chosen
rather than measured.

## The answer in three sentences

On the reference run below, eight packages published inside one 146 second publishing step, and the
registry recorded the last of them **242.594 seconds** after that step started. The presence step
gave up 73.594 seconds before that happened, so a release that had in fact completed was reported as
a release that never published, and clearing it cost a second approval on a protected environment.
The budget is therefore set from the largest upper bound this run produced rather than from a guess.

## The reference publish run

| field                                 | value                                                                  | query                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| repository                            | `cosyte/config`                                                        |                                                                                                                                              |
| workflow                              | `Release`                                                              |                                                                                                                                              |
| run id                                | `35512528046`                                                          | `gh api repos/cosyte/config/actions/runs/35512528046`                                                                                        |
| attempt every reading below came from | **1**, the attempt that failed                                         | `gh api repos/cosyte/config/actions/runs/35512528046/attempts/1/jobs`                                                                        |
| attempts on the run                   | 2; attempt 2 was a re-run and it passed                                | same                                                                                                                                         |
| version commit                        | `254ca68ffc81472e2595bbb3478f2108d8f93d95` ("Version Packages (#111)") | same                                                                                                                                         |
| packages this run published           | **8**                                                                  | `git show --stat 254ca68` names eight `packages/*/package.json` bumps, and every row below has a registry acceptance instant for its version |

Attempt 1 is the attempt to read. The plain `/actions/runs/<id>/jobs` endpoint answers for the LATEST
attempt only, which on a run cleared by a re-run is the attempt whose presence step passed, and that
attempt holds no failing probe to measure against.

### The two step windows on attempt 1

Both come from the same `attempts/1/jobs` response, and both resolve to the STEP rather than to an
individual probe: the jobs API records no per-probe instant, and the log text that would is not
something this record can depend on.

| step                                                                              | started                | completed              | span                      |
| --------------------------------------------------------------------------------- | ---------------------- | ---------------------- | ------------------------- |
| `Publish` (the publishing step)                                                   | `2026-09-21T10:48:34Z` | `2026-09-21T10:51:00Z` | 146 s                     |
| `Every bumped package must be published, tagged and released` (the presence step) | `2026-09-21T10:51:00Z` | `2026-09-21T10:51:23Z` | 23 s, concluded `failure` |

The `publish` job itself ran `2026-09-21T10:48:19Z` to `2026-09-21T10:51:25Z`.

## Why a delay is an interval and never a single number

The publishing step put eight packages up across one 146 second window and recorded nothing about
when inside that window each one went. So for a package whose version the registry accepted at
instant `A`:

- the **upper bound** on its propagation delay is `A - publishing step start`, which is what the delay
  would be if that package had been the first thing the step uploaded;
- the **lower bound** is `A - publishing step completion`, floored at zero, which is what the delay
  would be if that package had been the last.

The truth is somewhere inside. Stating a point instead would be stating something no run observed:
what the run proves is that a version was invisible at one instant and visible at a later one, never
the instant it turned over.

## One row per package this run published

Acceptance instants are the public registry's own record, read with
`npm view <package> time --json` and taking the `0.1.0` key. Bounds are computed from the publishing
step window above. Rows are ordered by acceptance instant.

| package                   | version | registry accepted at       | delay lower bound (s) | delay upper bound (s) | presence step saw it                             |
| ------------------------- | ------- | -------------------------- | --------------------- | --------------------- | ------------------------------------------------ |
| `@cosyte/prettier-config` | `0.1.0` | `2026-09-21T10:49:21.181Z` | 0.000                 | 47.181                | yes                                              |
| `@cosyte/eslint-config`   | `0.1.0` | `2026-09-21T10:49:21.513Z` | 0.000                 | 47.513                | yes                                              |
| `@cosyte/vitest-config`   | `0.1.0` | `2026-09-21T10:49:42.923Z` | 0.000                 | 68.923                | yes                                              |
| `@cosyte/tsup-config`     | `0.1.0` | `2026-09-21T10:49:45.619Z` | 0.000                 | 71.619                | yes                                              |
| `@cosyte/tsconfig`        | `0.1.0` | `2026-09-21T10:50:21.353Z` | 0.000                 | 107.353               | yes                                              |
| `@cosyte/script-utils`    | `0.1.0` | `2026-09-21T10:50:22.369Z` | 0.000                 | 108.369               | yes                                              |
| `@cosyte/process`         | `0.1.0` | `2026-09-21T10:50:39.286Z` | 0.000                 | 125.286               | yes                                              |
| `@cosyte/test-utils`      | `0.1.0` | `2026-09-21T10:52:36.594Z` | 96.594                | 242.594               | **NO, and this is the package the run reded on** |

Eight rows against eight packages published. Seven rows carry a lower bound of zero because the
registry accepted those versions before the publishing step had finished, so the smallest delay
consistent with the window is none at all. That is a real reading, not a blank: every column is
filled for a package that never raced.

`@cosyte/test-utils` is the one the presence step failed to see. It gave up at `10:51:23Z`; the
registry recorded the version at `10:52:36.594Z`, **73.594 seconds later**. The run's annotation read
`1 of 8 package(s) were bumped by this version commit but are not on the registry:
@cosyte/test-utils@0.1.0`, and the package had in fact published: what had not happened was the
registry's record of it.

The re-run corroborates the reading rather than adding one. On attempt 2 the same presence step ran
`2026-09-21T10:55:05Z` to `2026-09-21T10:55:17Z` and passed, with no change to the tree, because by
then the version had been visible for over two minutes.

## The figure the budget is graded against

**Maximum upper bound: `242.594` seconds.** It is `@cosyte/test-utils`'s row, and it is the largest
value in the upper bound column above.

**The shipped budget is 300 seconds**, declared as `PRESENCE_BUDGET_SECONDS` in
`scripts/registry-presence.mjs` and readable without running the workflow or reaching the network. It
is at or above the maximum upper bound, which is the constraint, with 57.406 seconds of headroom, and
it is the smallest whole number of minutes that clears the measurement. It is not derived from any
claim about npm's propagation behaviour in general: it is derived from this registry, this release
and this run, and a later run that measured worse is a reason to re-measure here and move it.

What the budget costs when it is not needed is nothing. The probe sequence stops on the first
success, so a package that is already visible is one probe, which is what seven of the eight rows
above were. What it costs when a package is genuinely absent is bounded: one package holds the step
for the budget plus one probe, and then the step reds with `Bumped but never published`, which is the
outcome that check exists to produce.

## What this record does not establish

- It does not establish a propagation delay for npm in general, or for any other registry, or for a
  package this repository does not publish. One run, one registry, eight packages.
- It does not establish where inside the publishing step each package went up. The publishing step
  does not record that, which is why every delay here is an interval.
- It does not establish that 242.594 seconds is a worst case. It is the worst case OBSERVED, on the
  one run this defect was observed on, which is why the budget carries headroom over it rather than
  sitting on it.
