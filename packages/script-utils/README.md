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

## `isCliEntrypoint(import.meta.url)`

Is this module the file Node was pointed at, rather than one imported by something else?

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

## `runPhiScanCli(config)`

`@cosyte/script-utils/phi-scan` is the `@cosyte/*` PHI commit-gate. **The engine owns the process; a
consuming repo declares data.**

```ts
import { runPhiScanCli, type DetectContext } from "@cosyte/script-utils/phi-scan";

runPhiScanCli({
  exitCodes: { clean: 0, hits: 1, refuse: 2 },
  scanRoots: ["."],
  detect: (ctx: DetectContext) => {
    // This standard's field-level detection. Parse the wire format, check every
    // PHI-bearing field against ctx.allow, and raise findings with ctx.hit(...).
    // Key path logic on ctx.targetPath, never on ctx.path.
  },
});
```

`runPhiScan(config)` is the same scan without the process tail: it **returns** a code and never
calls `process.exit`, so a test can drive it in process.

### Why it is a dependency and not a template file

`scripts/parser-template/` is a **scaffold**, not a dependency: the scaffolder copies it, so fixing
the template fixes no existing repo. That produced thirteen byte-distinct copies of one scanner, and
a newly-found escape therefore cost one pull request and one adversarial review **per repo**. Three
escape classes were paid for that way before this package existed. Here it is one pull request and a
version bump.

### What it owns

**All of the process.** Walking, reading, enumeration on all three routes (`--staged`, explicit
paths, and the `all`-mode sweep); the allow-list and the override log; the union of the working-tree
walk with the bytes git carries, deduplicated **by content** under git's own `blob <len>\0` framing;
the completeness rule and its per-root tier; every refusal; the report; the exit codes; and the
process tail. Plus the cross-cutting floor and the **reserved spaces** a repo declares instead of
maintaining a list of literals.

It does **not** own per-standard field detection: names, DOB, MRN / member id, address, phone. Those
differ per healthcare standard and are supplied through `detect`.

**A declarative vocabulary layer was built for that and then cut**, and the reason is on the record
rather than left to be rediscovered: three consecutive adversarial passes each found a blocker in it
and each remedy grew a new one. A JSON walk dropped primitives inside arrays, so FHIR given names and
street lines were invisible at exit 0. Delimiter discovery was blinded by one line of prose naming a
field; its remedy was blinded by a field table. Declaring the delimiters instead moved three checked
keys into an unchecked nested object, so one transposed letter blinded a whole file again. And the
record splitter never covered X12, whose segments end with a declared character rather than a line
break. None of it touched the process, so the process shipped and it did not.

### The axes

Which ones are required is the design, not an oversight.

| Axis                | Option                                | Required?                                                         |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| 1 Exit codes        | `exitCodes`                           | **Required.** The siblings disagree; a default would be a port.   |
| 2 Roots             | `scanRoots`                           | **Required.** No safe default exists in either direction.         |
| 2 Roots (subtract)  | `excludedPaths`, `unreadablePrefixes` | Defaulted empty, and every entry is announced on every run.       |
| 2 Roots (read)      | `isReadable`                          | Defaults to reading **everything**.                               |
| 3 `--staged` scope  | `stagedRoots`                         | Defaults to `scanRoots`; a wider value is refused at config time. |
| 4 Gitlinks          | `regularBlobModes`                    | Defaulted to git's two regular-blob modes.                        |
| 5 EOL normalization | none                                  | Machinery. A port must check it, not set it.                      |

A required axis has no default **because** it is the thing a port gets wrong. `scanRoots` is the
sharpest case: five repos need the whole repository, two measured that the whole repository makes
them exit on their own manifest's author address, and five measured that copying a sibling's narrow
roots silently dropped tracked files their index union had been reading. Derive it; never port it.

### Where the engine can tell a parameter is wrong, it refuses

All thirteen consuming repos derived against `0.0.2`, all thirteen were blocked, and **every defect
they found made the gate weaker than declared and said nothing**: none produced a false alarm, all
produced false confidence. So an unknown allow-list tag, an unknown key in a detector spec, a root
that is not the shape it declares, a root the scan cannot stat, a declared root that yielded nothing
read, a declared format that will not parse, a `stagedRoots` entry outside every scan root, and an
unreadable allow-list or override log are all **refusals**, not silent skips.

It is **not** a claim that every misdeclaration is caught. A parameter that is well-typed and wrong
is not detectable here: a `recordIdLength` of 2 against a three-character record id matches nothing,
and the engine cannot know that was not intended.

### Two things worth knowing before you adopt

**A detector that consults nothing has no remedy.** The whole-file `--allow-fixture` bypass is
recorded and then refused, so it cannot reach a clean run. Check every PHI-bearing field against
`ctx.allow`, or declare a **reserved space** (`nanp-fictional`, `ssa-never-issued`,
`reserved-domain`) so a whole convention answers at once instead of a literal per fixture.

**`all` mode needs a git index.** It refuses when git cannot name the index or names it empty,
because without it the sweep is the working-tree walk's word alone. A freshly scaffolded repo has to
`git init` and commit before an `all`-mode run means anything.

## License

MIT
