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

`@cosyte/script-utils` is on the cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

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

Every entry point is published as source with no build step, so the relative-path route works for
all three: the files are `index.js`, `phi-scan.js` and `internal-refs.js`, each beside its own
hand-written `.d.ts`. A vendored copy is one of those files and nothing else.

## Usage

Guard a script's CLI side effect so a test can import it for its exports. That guard wraps the exit,
so this is the whole shape of a real gate:

```ts runnable
import { isCliEntrypoint } from "@cosyte/script-utils";

/** Your gate's body, exported so a test can import it without the CLI running. */
export function main(argv: string[]): number {
  return argv.length;
}

// This module was imported, not pointed at, so the guard is closed: `main` does not run and nothing
// exits. The assertion is deliberately ahead of the branch, so the example cannot exit a test
// process even if that answer ever changed.
const runAsCli = isCliEntrypoint(import.meta.url);
runAsCli; // => false
if (runAsCli) process.exit(main(process.argv.slice(2)));
```

That guard is what lets a test import the module for its exports without the CLI executing as a side
effect, while the script still runs normally when invoked.

The PHI scanner is the other half, on its own subpath. Its shared read filter is exported so a
caller can compose with it rather than restate it:

```ts runnable
import { exemptsMarkdown } from "@cosyte/script-utils/phi-scan";

exemptsMarkdown("docs/adopting.md"); // => false
exemptsMarkdown("src/patient.ts"); // => true
```

The internal-reference gate is the third, and it is configured entirely through one object. The
axis names below are the whole interface a consumer needs, so they are checked here rather than
described:

```ts runnable
import { canonicalRuleNames, resolveConfig } from "@cosyte/script-utils/internal-refs";

const config = {
  projectPrefixes: ["HL7", "CCDA"],
  standardsDesignations: ["HL7-(?:V2|V3|CDA)"],
  surfacePaths: ["README.md", "docs-content"],
  accountedTarballFiles: ["CHANGELOG.md", "dist"],
};

// Hand that to `runInternalRefsScan(config)` and it returns an exit code. Checked here without
// touching a repository, so this example reds if an axis is ever renamed under a consumer.
resolveConfig(config).problems; // => undefined
canonicalRuleNames().length; // => 6
```

The `attw` publish gate is the fourth. It exists because `attw` prints "This package does not
contain types." and exits **0**: for a package that ships types, that sentence means the
declarations were not in the tarball, which is a broken publish reported as a pass. Your repo keeps
`scripts/attw.mjs` and an `attw` script whose body is exactly `node scripts/attw.mjs`; that file is
a caller, and this is the whole of it:

```ts runnable
import { runAttwGate } from "@cosyte/script-utils/attw";

// The one line a consuming repo's `scripts/attw.mjs` carries:
//
//     process.exitCode = runAttwGate({ callerUrl: import.meta.url });
//
// `callerUrl` is required and has no default. `attw` is resolved as `../node_modules/.bin/attw`
// from it, so the binary that runs is YOUR package's own; defaulted to this module's location it
// would resolve inside `node_modules/@cosyte/`, where your package has no attw at all. The gate
// RETURNS the code to exit with and never calls `process.exit`, so it is testable in-process.
typeof runAttwGate; // => "function"
```

## Entry points

| entry point                          | what it is                                                               |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `@cosyte/script-utils`               | `isCliEntrypoint(moduleUrl)`, the entry-point guard                      |
| `@cosyte/script-utils/phi-scan`      | `runPhiScan(config)` and `exemptsMarkdown(relPath)`, the shared PHI gate |
| `@cosyte/script-utils/internal-refs` | `runInternalRefsScan(config)`, the shared internal-reference gate        |
| `@cosyte/script-utils/attw`          | `runAttwGate(options)`, the shared `attw` publish gate                   |

They are separate subpaths because they are separately adoptable: a repo can take the entry-point
guard without taking a position on PHI scanning, a repo can take the internal-reference gate without
taking either, and importing one never loads another.

### The em-dash gate, which is a file rather than a subpath

This package also ships `check-no-emdash.sh`, the one implementation of the em-dash gate for every
`@cosyte/*` repository. It is a shell script and not a module, so it is not in the `exports` map:
nothing imports it, a repository EXECUTES it.

```sh
# The package script every consuming repo keeps, which forwards its arguments:
#   "check:no-emdash": "bash node_modules/@cosyte/script-utils/check-no-emdash.sh"
bash node_modules/@cosyte/script-utils/check-no-emdash.sh              # scan every tracked file
bash node_modules/@cosyte/script-utils/check-no-emdash.sh --stdin PR   # scan text on stdin
bash node_modules/@cosyte/script-utils/check-no-emdash.sh --list-scanned
bash node_modules/@cosyte/script-utils/check-no-emdash.sh --self-id
```

Exit 0 means the mode completed and found nothing banned. Exit 1 means anything else: a banned form
was found, an input could not be read, an input was not scanned, a declaration was unusable, or an
argument was not recognised. There is no third code. Hits and diagnostics go to stderr in every mode.

`--self-id` prints the sha256 of the copy that is executing, so a repository can prove it is running
these bytes rather than a fork of them. `--list-scanned` prints the NUL-separated, repo-root-relative
path of every tracked file the default scan reads, so a repository adopting the gate can compare its
coverage against whatever it ran before rather than compare two filter expressions.

A repository narrows WHAT IS SCANNED, and only that, through a tracked file at its own top level,
`scripts/check-no-emdash.exclude`: one entry per line, `#` comments and blank lines ignored, an entry
ending in `/` covering every tracked path beneath it, and every entry anchored at the repository
root. An entry that matches no tracked path is refused rather than ignored, because an exclusion that
has outlived its subject is a hole nobody is looking at. Nothing narrows WHAT IS MATCHED: the six
banned forms are fixed in the gate.

## Overrides

`isCliEntrypoint` has no options and cannot be overridden. It answers one question and its
tie-breaking direction is the whole design, so a knob to invert it would be a knob to turn the gate
off.

`runPhiScan` is configured entirely through its `config` argument, along the five axes tabulated
under [the five per-repo axes](#the-five-per-repo-axes) below: three are required because they are
the ones a port gets wrong, and the defaulted ones move for every repo at once through a version
bump.

The engine's own cross-cutting detection floor is not on that list, and it is not overridable.
Neither is the completeness rule that refuses a run which enumerated a target and never read it. A
caller can widen what is scanned and can add detection, and cannot subtract either of those two.

`runInternalRefsScan` follows the same bargain along [its own axes](#the-internal-reference-axes):
four required, six defaulted, and every per-repository difference supplied by the caller. What it
will not accept is a configuration that SUBTRACTS. The canonical rule set, the self-test floor and
every completeness refusal are not caller inputs, and an option that reaches for one of them is
refused by name rather than ignored. So is an option the gate has never heard of: an ignored setting
reads, from the caller's side, exactly like an honoured one.

`runAttwGate` takes the narrowest bargain of the four, and deliberately. A caller supplies where it
lives (`callerUrl`, required, no default) and may supply the arguments to forward; everything else
is the gate's. The arguments it will forward are an ALLOW-LIST of two (`--profile` with its value,
and `--no-definitely-typed`), because a deny-list of blinding spellings bought exactly one more
evasion per round: each of `--quiet`, `-q`, `--format json`, `-fjson`, `-qP`, `--config-path`,
`--help` and `--version` was measured making attw exit 0 with nothing for the gate to read.
Widening that set is a deliberate one-line edit in this package, reviewed here, and not something a
caller can do. No net can be switched off.

## PHI and safety

This package ships the machinery of the PHI commit-gate, so it is the one package here that reads
files which may contain patient data. What it does with them, stated narrowly:

- It reads your repository's own files, in your own process, to look for PHI-shaped content. It sends
  nothing anywhere and opens no network connection.
- It **does not log, echo or persist a matched value**. A finding names a path, a locator inside it
  (`(ssn)`, `(email)`, or the field id your own detector raised it against) and the rule that fired;
  the matched bytes are not written into the report, because a gate that prints the secret it found
  has published it into a CI log. A `value` your detector passes to `ctx.hit` is dropped at the
  boundary rather than stored, so nothing downstream can print what no record carries.
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

#### The boundary: what the engine owns, and what stays in your repo

**The ENGINE, shared and shipped here.** Argument parsing and the three modes (`--staged`, explicit
paths, and the `all`-mode sweep); reading the allow-list and the override log; target enumeration;
the union of the working-tree walk with the bytes git carries at every index path, deduplicated **by
content** under git's own `blob <len>\0` framing; the completeness rule (a target the run enumerated
and never read refuses, naming the paths); the per-root observation rule (`all` mode refuses unless
every `scanRoots` entry yielded a file that was read, naming the starved roots); every refusal; and a
cross-cutting detection floor that finds a dashed SSN shape and an email at an undeclared domain over
every file, always.

**The RULES, local to your repo, never moved and never shipped in this package.**
`scripts/phi-allow-list.txt` (the positive declaration that a token is synthetic, tagged `NAME`,
`DOB`, `ADDR`, `ID`, `EMAILDOMAIN`); `phi-scan-overrides.md` (the `--allow-fixture` audit log, and
whatever category-to-field map your detector reads); and the per-standard field detector you supply
through `detect` (names, DOB, MRN / member id, address, phone, parsed out of your own wire format).

The split is not a convenience. **This package's `files` list ships no repo's rules**, so a
declaration one consumer makes can never travel to another consumer through a version bump: with no
file at `allowListPath` the engine treats every PHI-shaped token as undeclared, and refuses rather
than reporting clean. A rules file is a reviewed, committed act in the repository it describes.

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

**Every scan root has to produce something.** `all` mode refuses when a `scanRoots` entry yielded no
file that was read, and names it. A root that is missing, unreadable, or whose every file your read
filter drops used to leave the sweep quietly narrower than its own configuration said, and one
productive root made the whole run look productive. If you narrow `scanRoots`, this is the tier that
tells you what the narrowing stopped reading.

### `runInternalRefsScan(config)`

`@cosyte/script-utils/internal-refs` keeps our own bookkeeping off every surface a consumer reads:
item identifiers, phase and wave language, ADR numbers, internal repository paths and traceability
markers, on the pages, the npm metadata and, optionally, the doc comments that compile into shipped
type declarations.

```ts
import { runInternalRefsScan } from "@cosyte/script-utils/internal-refs";

process.exit(
  runInternalRefsScan({
    projectPrefixes: ["HL7", "CCDA", "MLLP"],
    standardsDesignations: ["HL7-(?:V2|V3|CDA)", "FHIR-R\\d[A-Z]?"],
    surfacePaths: ["README.md", "TRADEMARKS.md", "LICENSE", "docs-content"],
    accountedTarballFiles: ["CHANGELOG.md", "dist"],
    sourceDocComments: { enabled: true, paths: ["src/*.ts", "src/**/*.ts"] },
  }),
);
```

It returns an exit code rather than calling `process.exit`, so a test can drive it in process.

#### What exit 0 means, and what it does not

Exit 0 means the run completed, enumerated its configured surface, read every target it enumerated,
passed its own self-tests and found nothing. A hit, an enumerated target that was never read, an
unreadable input, an input a text matcher classifies as binary, a configured surface path the
repository does not track, a `files` entry the configuration does not account for, and a failed
self-test are each a non-zero exit with the cause on stderr. A hit report names the file, the line
and the rule.

#### The internal-reference axes

Four are required, and which four is the design rather than an oversight: each is the axis a port
gets wrong, and a default would be one repository's answer imposed on every other.

| Axis                       | Option                  | Required?                                                             |
| -------------------------- | ----------------------- | --------------------------------------------------------------------- |
| 1 Project prefixes         | `projectPrefixes`       | **Required**, empty refused. Keying on these is why `MSH-2` survives. |
| 2 Standards designations   | `standardsDesignations` | **Required.** Never flagged. An empty list declares no collisions.    |
| 3 Public surface           | `surfacePaths`          | **Required**, empty refused, every entry must be tracked.             |
| 4 Tarball accounting       | `accountedTarballFiles` | **Required.** The `files` entries already accounted for.              |
| 5 Source doc comments      | `sourceDocComments`     | Defaulted OFF. Enable where the build copies doc text verbatim.       |
| 6 Exit codes               | `exitCodes`             | Defaulted `{ clean: 0, hits: 1, refuse: 1 }`. `clean` must stay 0.    |
| 7 Added detection          | `extraRules`            | Defaulted `[]`. Each added rule brings its own samples.               |
| 8 Added self-test material | `extraSamples`          | Defaulted `{}`. Additive only.                                        |
| 9 Repository under test    | `repoRoot`              | Defaulted to the working directory, anchored at its git top level.    |
| 10 Report destination      | `write`                 | Defaulted to the process streams.                                     |

`CONFIG_AXES` is the same table as data, so a consumer can enumerate it rather than transcribe it.

#### Two things worth knowing before you adopt this one

**The prefix set has to be extended by hand, and that is the cheaper mistake.** A new programme
means adding its prefix, and nothing catches it until someone does. The alternative is a `WORD-N`
shape rule, which flags the segment-field references a parser's documentation exists to provide.

**Every configured prefix has to be reachable.** The self-test floor proves each one still matches,
so a prefix shadowed by a standards designation refuses the run instead of silently contributing
nothing. That is the axis a caller edits most, and a dead entry there is a rule that stopped seeing.

### `runAttwGate(options)`

The `attw` publish gate, run in the working directory of the package being checked. It returns the
exit code a caller should exit with: 0 when every net passed, attw's own status when attw itself
judged the package, and 1 for every refusal.

`attw --pack .` prints "This package does not contain types." and exits **0**, because
`getExitCode()` returns before it reads the problem list whenever the analysis found no types at
all. For a package that ships types, that is a broken publish reported as a pass, and the window it
arrives through is ordinary: `tsup` emits JS in one pass and declarations in a later one, so every
build has a moment where `dist/` holds `.mjs`/`.cjs` and no `.d.ts`.

Four nets, each catching something the others cannot:

1. **Preflight**, over every relative artifact path the manifest promises. A path that is missing or
   empty reds and is named. A manifest that declares NOTHING is refused rather than reported as
   checked: three of the four nets grade that one set, so an empty set makes them vacuous at once.
2. **The document attw prints**, never its prose. The gate forces `--format json` and asserts
   `analysis.types.kind === "included"`, so a route that hides or reformats the output leaves stdout
   unparseable, and unparseable fails closed.
3. **npm's own pack listing.** A declared path can be on disk and out of the tarball, which net 1
   cannot see and which a committed `.attw.json` can hide from attw's exit code. This net asks npm.
4. **The manifest pnpm WOULD PUBLISH.** pnpm applies `publishConfig` as publish-time overrides and
   rewrites the manifest inside the tarball; `npm pack` does not. This org publishes with pnpm, so
   the document net 3 grades is not the one that ships.

What each net does and does not claim, and every measurement behind them, is in `attw.js`'s own
docblock. It is not restated here: a claim written down twice is a claim that drifts.

## Compatibility

Node `>=22.14`, ESM only, published as source (`index.js`, `phi-scan.js`, `internal-refs.js` and
`attw.js` with hand-written `.d.ts` files) with no build step, so a consumer can import it by
relative path from a checkout as well as by specifier. `runPhiScan` shells out to `git` for the
index-backed half of its sweep, so `all` mode needs git on the path, `runInternalRefsScan` shells
out to `git` for its whole enumeration, and `runAttwGate` spawns the consuming package's own `attw`
binary, `npm pack` and, where a `publishConfig` object is present, `pnpm pack`.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to the scan engine needs a changeset:
a new detection pattern reds a consumer that was passing, and a removed one silently stops catching
something. Never open an issue containing a real PHI value; describe the shape instead.

## License

MIT, copyright Cosyte. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
