<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/script-utils

> The two things every repo-local gate script gets wrong, fixed once and shared.

[![npm version](https://img.shields.io/npm/v/@cosyte/script-utils.svg)](https://www.npmjs.com/package/@cosyte/script-utils)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.14-brightgreen.svg)](https://nodejs.org)

Zero-dependency helpers for the repo-local gate scripts in @cosyte/\* repos.

## Why this exists

A gate script that exits 0 without having checked anything is worse than no gate, because the run
conclusion is the only thing anyone reads. Two ways of producing one turned out to be universal
across the cosyte repositories: an entrypoint guard written by hand that answers `false` for ordinary
invocations, and thirteen byte-distinct copies of one PHI scanner, each of which had to be fixed
separately when an escape was found.

The nearest alternative is `scripts/parser-template/`, and it is deliberately not this. A scaffold is
COPIED, so fixing the template fixes no repository that already exists. Here a fix is one pull
request and a version bump.

## Status

`@cosyte/script-utils` is on the cosyte 0.0.x ladder: the public API is not yet settled and may change in any release.

Still moving: the `runPhiScan` option surface, which is where the per-repo axes below are still being
argued about, and the cross-cutting detection floor, which gains patterns as escapes are found. A new
pattern is a new red in a consumer that was passing, so pin an exact version if a green commit gate
matters more to you than a new detection.

## Install

```sh
pnpm add -D @cosyte/script-utils
```

Node `>=22.14`. ESM only, no runtime dependencies, and no build step. Both of those are load-bearing
rather than minimalism: the gates in `config` itself run **before `pnpm install`** on purpose, so
that a broken or hostile install cannot decide whether a release gate runs.

### If your gate runs before `pnpm install`, do not use the bare specifier

Read this before adopting the package, because it is the one thing that does not generalise.

A bare `import ... from "@cosyte/script-utils"` resolves through `node_modules`, so it only works
once the install has happened. `config`'s own gates run before their install and therefore import
this file by **relative path** instead, which needs nothing on disk but the checkout.

So check when your gate runs, and pick accordingly:

| When the gate runs               | How to import                                    |
| -------------------------------- | ------------------------------------------------ |
| After `pnpm install` (the usual) | `@cosyte/script-utils`, as a `devDependency`     |
| Before `pnpm install`            | A relative path to a vendored or checked-in copy |

Installing the package does not, on its own, give a pre-install gate the property described above.

## Usage

```js
import { isCliEntrypoint } from "@cosyte/script-utils";

export function main(argv) {
  /* ... */
}

if (isCliEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
```

That guard is what lets a test import the module for its exports without the CLI executing as a side
effect, while the script still runs normally when invoked.

## PHI and safety

This package ships the machinery of the PHI commit-gate, so it is the one package here that reads
files which may contain patient data. What it does with them, stated narrowly:

- It reads your repository's own files, in your own process, to look for PHI-shaped content. It sends
  nothing anywhere and opens no network connection.
- It **does not log, echo or persist a matched value**. A finding names a path, a line and the rule
  that fired; the matched bytes are not written into the report, because a gate that prints the
  secret it found has published it into a CI log.
- The allow-list and the override log record DECLARATIONS about paths, never content.
- Detection is a floor, not a proof: this package owns a dashed SSN shape and an email at an
  undeclared domain, and everything field-level is yours to supply through `detect`. A clean run
  means nothing this configuration looked for was found, which is not the same as no PHI.

The consumer still owns the rest: deciding what a PHI-bearing field is for its standard, keeping real
patient data out of the repository in the first place, and never illustrating a rule, a fixture or an
issue report with a real value.

## API

### `isCliEntrypoint(import.meta.url)`

Is this module the file Node was pointed at, rather than one imported by something else?

#### Why not compare the strings

The obvious spelling is a one-liner, and several cosyte repos wrote it by hand:

```js
// Do not do this.
import.meta.url === `file://${resolve(process.argv[1])}`;
```

It compares two strings rather than two paths, so it answers `false` for three ordinary invocations
of the script that contains it. All three were measured on Node 22.23.1, not predicted:

| Invocation                     | What happens                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/gate`            | Node resolves the extension and runs `scripts/gate.js`; `argv[1]` keeps `scripts/gate`, which names no file. `tsx scripts/gate` does the same with `.ts`. |
| A checkout under `/space dir/` | `import.meta.url` percent-encodes to `/space%20dir/`; concatenating `file://` onto a raw path does not.                                                   |
| A symlinked invocation         | Node resolves the main module to its real path, so `import.meta.url` is the target while `argv[1]` is the link. `node_modules/.bin` shims hit this.       |

In every one the guard is `false`, so the gate exits 0 having checked nothing. That is worse than
the defect the gate was written to catch, because the run conclusion is the only thing anyone reads.

`isCliEntrypoint` compares canonical paths, resolves symlinks, and treats an `argv[1]` that names no
file on disk as a specifier Node had to resolve.

#### Which way it errs

When the answer is genuinely ambiguous it returns `true` and the CLI runs. A false positive runs a
gate during an import, which is loud and immediately visible; a false negative skips a gate and
exits 0, which is silent. Those are not symmetric, so the tie goes to running.

It throws a `TypeError` rather than returning `false` when handed something that is not a non-empty
string, for the same reason.

### `runPhiScan(config)`

`@cosyte/script-utils/phi-scan` is the shared machinery of the `@cosyte/*` PHI commit-gate.

```ts
import { exemptsMarkdown, runPhiScan } from "@cosyte/script-utils/phi-scan";

process.exit(
  runPhiScan({
    exitCodes: { clean: 0, hits: 1, refuse: 2 },
    scanRoots: ["."],
    isStagedReadable: exemptsMarkdown,
    detect: (ctx) => {
      // Your standard's field-level detection. Check every PHI-bearing field
      // against ctx.allow, and raise findings with ctx.hit(...).
    },
  }),
);
```

It returns an exit code rather than calling `process.exit`, so a test can drive it in process.

#### Why it is a dependency and not a template file

`scripts/parser-template/` is a **scaffold**, not a dependency: the scaffolder copies it, so fixing
the template fixes no existing repo. That produced thirteen byte-distinct copies of one scanner, and
a newly-found escape therefore cost one pull request and one adversarial review **per repo**. Three
escape classes were paid for that way before this package existed. Here it is one pull request and a
version bump.

#### What it owns

Argument parsing and the three modes (`--staged`, explicit paths, and the `all`-mode sweep); the
allow-list and the override log; target enumeration; the union of the working-tree walk with the
bytes git carries, deduplicated **by content** under git's own `blob <len>\0` framing; the
completeness rule (a target the run enumerated and never read refuses, naming the paths); every
refusal; and a cross-cutting floor that detects a dashed SSN shape and an email at an undeclared
domain.

It does **not** own per-standard field detection: names, DOB, MRN / member id, address, phone.
Those differ per healthcare standard and are supplied through `detect`.

#### The five per-repo axes

Which ones are required is the design, not an oversight.

| Axis                | Option                            | Required?                                                       |
| ------------------- | --------------------------------- | --------------------------------------------------------------- |
| 1 Exit codes        | `exitCodes`                       | **Required.** The siblings disagree; a default would be a port. |
| 2 Roots             | `scanRoots`                       | **Required.** `["."]` is the whole repository.                  |
| 2 Roots (subtract)  | `excludedPaths`, `isWalkReadable` | Defaulted. Moving the shared boundary is one change here.       |
| 3 `--staged` scope  | `isStagedReadable`                | **Required.** It decides what a commit is blocked on.           |
| 4 Gitlinks          | `regularBlobModes`                | Defaulted to git's two regular-blob modes.                      |
| 5 EOL normalization | none                              | Machinery. A port must check it, not set it.                    |

A required axis has no default **because** it is the thing a port gets wrong: carrying an exit code
across a repo boundary is how a caller ends up branching on a meaning that repo never assigned.
A defaulted axis is the opposite case: every repo wants the same answer, so the answer lives here
and reaches all of them through a version bump.

#### Two things worth knowing before you adopt

**A detector that consults nothing has no remedy.** The whole-file `--allow-fixture` bypass is
recorded and then refused, so it cannot reach a clean run. Check every PHI-bearing field against
`ctx.allow`, or a developer meeting your detector has nowhere to go. The engine's own floor does
this on both branches.

**`all` mode needs a git index.** It refuses when git cannot name the index or names it empty,
because without it the sweep is the working-tree walk's word alone. A freshly scaffolded repo has to
`git init` and commit before an `all`-mode run means anything.

## Compatibility

Node `>=22.14`, ESM only, published as source (`index.js` and `phi-scan.js` with hand-written `.d.ts`
files) with no build step, so a consumer can import it by relative path from a checkout as well as by
specifier. `runPhiScan` shells out to `git` for the index-backed half of its sweep, so `all` mode
needs git on the path.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to the scan engine needs a changeset:
a new detection pattern reds a consumer that was passing, and a removed one silently stops catching
something. Never open an issue containing a real PHI value; describe the shape instead.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
