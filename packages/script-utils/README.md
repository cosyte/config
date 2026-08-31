# @cosyte/script-utils

Zero-dependency helpers for the repo-local gate scripts every cosyte repo keeps in `scripts/`.

No runtime dependencies and no build step. Both are load-bearing for the gates in `config` itself,
which run **before `pnpm install`** on purpose, so that a broken or hostile install cannot decide
whether a release gate runs.

## Install

```sh
pnpm add -D @cosyte/script-utils
```

### If your gate runs before `pnpm install`, do not use the bare specifier

Read this before adopting the package, because it is the one thing that does not generalise.

A bare `import ... from "@cosyte/script-utils"` resolves through `node_modules`, so it only works
once the install has happened. `config`'s own two gates run before their install and therefore
import this file by **relative path** instead, which needs nothing on disk but the checkout.

So check when your gate runs, and pick accordingly:

| When the gate runs               | How to import                                    |
| -------------------------------- | ------------------------------------------------ |
| After `pnpm install` (the usual) | `@cosyte/script-utils`, as a `devDependency`     |
| Before `pnpm install`            | A relative path to a vendored or checked-in copy |

Installing the package does not, on its own, give a pre-install gate the property described above.

## Use

Guard a script's CLI side effect so a test can import it for its exports:

```ts runnable
import { isCliEntrypoint } from "@cosyte/script-utils";

// This module was imported, not pointed at, so the guard is closed and `main` does not run.
isCliEntrypoint(import.meta.url); // => false
```

In a real gate that guard wraps the exit:

```js
import { isCliEntrypoint } from "@cosyte/script-utils";

export function main(argv) {
  /* ... */
}

if (isCliEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
```

The PHI scanner is the other half, on its own subpath. Its shared read filter is exported so a
caller can compose with it rather than restate it:

```ts runnable
import { exemptsMarkdown } from "@cosyte/script-utils/phi-scan";

exemptsMarkdown("docs/adopting.md"); // => false
exemptsMarkdown("src/patient.ts"); // => true
```

## Entry points

| entry point                     | what it is                                                               |
| ------------------------------- | ------------------------------------------------------------------------ |
| `@cosyte/script-utils`          | `isCliEntrypoint(moduleUrl)`, the entry-point guard                      |
| `@cosyte/script-utils/phi-scan` | `runPhiScan(config)` and `exemptsMarkdown(relPath)`, the shared PHI gate |

They are separate subpaths because they are separately adoptable: a repo can take the entry-point
guard without taking a position on PHI scanning, and importing the root never loads the scanner.

## `isCliEntrypoint(import.meta.url)`

Is this module the file Node was pointed at, rather than one imported by something else?

That guard is what lets a test import the module for its exports without the CLI executing as a side
effect, while the script still runs normally when invoked.

### Why not compare the strings

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

### Which way it errs

When the answer is genuinely ambiguous it returns `true` and the CLI runs. A false positive runs a
gate during an import, which is loud and immediately visible; a false negative skips a gate and
exits 0, which is silent. Those are not symmetric, so the tie goes to running.

It throws a `TypeError` rather than returning `false` when handed something that is not a non-empty
string, for the same reason.

## `runPhiScan(config)`

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

### Why it is a dependency and not a template file

`scripts/parser-template/` is a **scaffold**, not a dependency: the scaffolder copies it, so fixing
the template fixes no existing repo. That produced thirteen byte-distinct copies of one scanner, and
a newly-found escape therefore cost one pull request and one adversarial review **per repo**. Three
escape classes were paid for that way before this package existed. Here it is one pull request and a
version bump.

### What it owns

Argument parsing and the three modes (`--staged`, explicit paths, and the `all`-mode sweep); the
allow-list and the override log; target enumeration; the union of the working-tree walk with the
bytes git carries, deduplicated **by content** under git's own `blob <len>\0` framing; the
completeness rule (a target the run enumerated and never read refuses, naming the paths); every
refusal; and a cross-cutting floor that detects a dashed SSN shape and an email at an undeclared
domain.

It does **not** own per-standard field detection: names, DOB, MRN / member id, address, phone.
Those differ per healthcare standard and are supplied through `detect`.

### Two things worth knowing before you adopt

**A detector that consults nothing has no remedy.** The whole-file `--allow-fixture` bypass is
recorded and then refused, so it cannot reach a clean run. Check every PHI-bearing field against
`ctx.allow`, or a developer meeting your detector has nowhere to go. The engine's own floor does
this on both branches.

**`all` mode needs a git index.** It refuses when git cannot name the index or names it empty,
because without it the sweep is the working-tree walk's word alone. A freshly scaffolded repo has to
`git init` and commit before an `all`-mode run means anything.

## Overrides

`isCliEntrypoint` has no options and cannot be overridden. It answers one question and its
tie-breaking direction is the whole design, so a knob to invert it would be a knob to turn the gate
off.

`runPhiScan` is configured entirely through its `config` argument, along five axes. Which ones are
required is the design, not an oversight:

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

The engine's own cross-cutting floor is not on that list, and it is not overridable. Neither is the
completeness rule. A caller can widen what is scanned and can add detection, and cannot subtract
either of those two.

Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the `@cosyte/*`
suite.
