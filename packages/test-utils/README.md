<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/test-utils

> The invariants every healthcare parser owes, proved against one contract instead of thirteen.

[![npm version](https://img.shields.io/npm/v/@cosyte/test-utils.svg)](https://www.npmjs.com/package/@cosyte/test-utils)
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/config/ci.yml?branch=main&label=CI)](https://github.com/cosyte/config/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/config/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

Framework-agnostic conformance test kit for the @cosyte/\* parsers: generic round-trip, idempotent-normalize, lenient-mode, immutability, warning-code, and PHI-leak invariant runners, at a depth one environment variable sets.

## Why this exists

Every parser in this estate owes the same archetype invariants: round-trip, lenient parsing that
never throws outside its sanctioned fatals, immutability, a stable warning-code surface, and no
patient data on a diagnostic. Written per repository, those suites diverge, and an audit of thirteen
Cosyte repos (2026-07-30) found every PHI test green over unreachable space. Those tests could not
have failed.

The nearest alternative is each parser writing its own property tests against `fast-check`. That is
what produced the audit above. This kit ships the RUNNERS and leaves the format-specific arbitraries
in each parser, so the thing that is hard to get right is written once and reviewed once.

## Status

`@cosyte/test-utils` is on the Cosyte 0.1.x line: the public API is settled and bump types follow ordinary semver.

Still moving: the `./perf` subpath, whose ratio ceiling is an open question (see the "What it will
not tell you" section below and the review triggers in ADR 0001), and the option surface of
`assertNoDiagnosticPhiLeak`, which gains checks as leaks are found. A new check reds a parser that
was passing, which is the point, but it means a version bump is not a safe unattended upgrade.

## Install

```sh
pnpm add -D @cosyte/test-utils fast-check
```

`fast-check` (`^3` or `^4`) is a peer dependency. Node `>=22.0.0`. ESM only.

It ships **generic, parameterized invariant runners**. The **format-specific arbitraries stay in
each parser**. This kit contains no HL7/DICOM/X12 generators. The runners are framework-agnostic:
they use [`fast-check`](https://fast-check.dev/) and `node:assert/strict`, and **throw** on failure,
so any test runner (Vitest, `node:test`, Mocha) catches them. The kit takes no runtime dependency on
a test framework.

## Usage

Feed a runner your own arbitraries and call it inside whatever test framework you already run. Every
runner throws on failure and returns nothing, so there is no result to forget to assert on:

```ts runnable
import { sortedCodeSet } from "@cosyte/test-utils";

const codes = { UNKNOWN_SEGMENT: "HL7_UNKNOWN_SEGMENT", BAD_DATE: "HL7_BAD_DATE" };
sortedCodeSet(codes); // => ["HL7_BAD_DATE", "HL7_UNKNOWN_SEGMENT"]
```

The worked example for the property runners is under
[Adopting it in a parser](#adopting-it-in-a-parser), and the PHI runners below are the two to read
first.

## Entry points

| entry point               | what it is                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@cosyte/test-utils`      | the conformance runners: round-trip, idempotent normalize, lenient-mode, immutability, PHI leak, and the run options they share |
| `@cosyte/test-utils/perf` | the performance kit: the scaling gate and its self-check                                                                        |

They are separate subpaths because they run under different conditions: the conformance runners are
clock-free and coverage-safe, and the perf kit must not be measured under coverage instrumentation.
Importing one never loads the other.

```ts runnable
import { assertScalingGateFires, PERF_CONTRACT, scalingGate } from "@cosyte/test-utils/perf";

PERF_CONTRACT.RATIO_CEILING; // => 8
PERF_CONTRACT.SCALE_STEP; // => 4
typeof scalingGate; // => "function"
typeof assertScalingGateFires; // => "function"
```

## Overrides

Everything a runner does is decided by the options object you hand it, and every runner is a plain
function: there is no config file, no global registration and nothing to switch off in your
`package.json`. What that leaves is a short list of things you deliberately cannot move.

| Surface                                                | Overridable?                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Arbitraries, parse/serialize functions, equality       | Yours entirely. The kit ships none.                                       |
| Depth, seed and path (`numRuns`, `seed`, `path`)       | Per runner; `COSYTE_PROPERTY_RUNS`, `_SEED` and `_PATH` win over them.    |
| `getDiagnostics`, `getModelIdentifiers`, `parseStrict` | **Required, no defaults.** `() => []` is an answer; silence is not.       |
| `expectCode` on a PHI slot                             | **Required per slot.** A slot that names no code cannot be proven read.   |
| `checkLengthInvariance`                                | Opt-in. Read that option's docs before enabling it.                       |
| `PERF_CONTRACT` (the ratio ceiling, floor, reps, step) | **Frozen.** Readable, not overridable. ADR 0001 is the route to move one. |

The two rows in bold are the whole reason this kit exists as a shared contract rather than a
snippet each parser copies. An optional selector plus a warning in prose is exactly the control that
already failed ecosystem-wide, and a perf ceiling a package can raise locally is a ceiling that
reports whatever that package needed it to report.

## Adopting it in a parser

Bring your own format-specific `fast-check` arbitraries, from your package's `/arbitraries` subpath
(below), and feed them to the runners. Every parser proves three properties: round trip, idempotent
normalize, and never throws in lenient mode. For `@cosyte/hl7`:

```ts
import { describe, it, expect } from "vitest";
import {
  roundTripProperty,
  idempotentNormalizeProperty,
  lenientNeverThrowsProperty,
  sortedCodeSet,
} from "@cosyte/test-utils";
import { parseHL7, Hl7ParseError, FATAL_CODES, WARNING_CODES } from "@cosyte/hl7";
import { message, messageText, hostileInput } from "@cosyte/hl7/arbitraries";

const fatal = new Set(Object.values(FATAL_CODES));
const known = new Set(Object.values(WARNING_CODES));

describe("hl7 conformance", () => {
  it("round-trips", () =>
    roundTripProperty({
      arbitrary: specCleanMessage(),
      serialize: (m) => m.toString(),
      parse: (raw) => parseHL7(raw),
      equals: (a, b) => a.toString() === b.toString(),
    }));

  it("normalizes idempotently", () =>
    idempotentNormalizeProperty({
      arbitrary: messageText(),
      normalize: (raw) => parseHL7(raw).toString(),
    }));

  it("is lenient", () =>
    lenientNeverThrowsProperty({
      arbitrary: hostileInput(),
      parse: (raw: string) => parseHL7(raw),
      isFatal: (e) => e instanceof Hl7ParseError && fatal.has(e.code),
      getWarnings: (m) => (m as { warnings: { code: string; position?: unknown }[] }).warnings,
      isKnownCode: (c) => known.has(c),
      hasPositionalContext: (w) => typeof w.position === "object" && w.position !== null,
    }));

  it("has a stable warning-code surface", () => {
    expect(sortedCodeSet(WARNING_CODES)).toMatchSnapshot();
  });
});
```

### Depth, seeds and replay

Every property runner runs 100 cases by default (`DEFAULT_NUM_RUNS`), fast enough for every pull
request. One environment variable sets the depth of every property in the run, over each runner's
own `numRuns`. The standard's nightly run will set it to 10,000 or more; that job is not built yet,
so until it is, a deeper run is one a person or a job starts like this:

```sh
COSYTE_PROPERTY_RUNS=10000 pnpm test
```

A failure names the property and prints the seed and path that replay it, before fast-check's own
report (the counterexample, the shrinks, and the failing check's message):

```text
round trip: property failed after 52 case(s), shrunk 4 time(s).
Replay exactly: COSYTE_PROPERTY_SEED=791784642 COSYTE_PROPERTY_PATH=51:1:0:0:6
(or pass { seed: 791784642, path: "51:1:0:0:6" } to the runner)

Property failed after 52 tests
{ seed: 791784642, path: "51:1:0:0:6", endOnFailure: true }
Counterexample: [";"]
Shrunk 4 time(s)
Got AssertionError [ERR_ASSERTION]: round-trip: parse(serialize(x)) is not deep-equal to x
```

That is a real run, of a serializer that drops `;`.

Setting those two variables (or passing `seed` and `path` to the runner) runs that one case again,
already shrunk, so a nightly failure becomes a local one. A value that is set but malformed throws
rather than being ignored, so a nightly job that typed its depth wrong cannot quietly run the
pull-request depth. `assertProperty(name, property, options)` is the same machinery for a parser's
own properties, and `resolvePropertyRun` shows what a run will use:

```ts runnable
import { resolvePropertyRun } from "@cosyte/test-utils";

resolvePropertyRun({}, {}).numRuns; // => 100
resolvePropertyRun({ numRuns: 50 }, { COSYTE_PROPERTY_RUNS: "10000" }).numRuns; // => 10000
resolvePropertyRun({}, { COSYTE_PROPERTY_SEED: "-7", COSYTE_PROPERTY_PATH: "3:0" }).path; // => "3:0"
```

### The `/arbitraries` subpath every package exports

The kit ships no format knowledge, so each package exports the generators for its own formats, for
its own tests and for its users' tests of code built on it:

- **Where.** An optional subpath, `@cosyte/<package>/arbitraries`, in the `exports` map. The root
  entry never imports it, so a user without fast-check never loads it.
- **fast-check is an optional peer.** `peerDependencies` names `fast-check` (`^4`) and
  `peerDependenciesMeta` marks it `optional`; the subpath is the only file that imports it.
- **What it exports.** Factory functions named for what they generate, each returning a fast-check
  `Arbitrary` and taking an optional options object: a value the serializer can emit (for round
  trip), raw text the parser accepts, messy on purpose (for idempotent normalize), and hostile
  input (for never throws). For example `message()`, `messageText()` and `hostileInput()`.
- **Synthetic only.** Generated values are random, never drawn from real records, and the
  subpath carries no fixture copied from one.

The kit's runners take `Arbitrary<T>` directly, so no adapter sits between a package's arbitraries
and the runners.

## PHI and safety

This kit exists partly BECAUSE of patient data, so what it does with it is the first thing to know.

**It never generates, ships or requires real PHI.** Every input is produced by your own `fast-check`
arbitraries or by a generator function you pass in, in your own process. The kit reads no file, opens
no network connection, and persists nothing.

**The PHI runners plant SYNTHETIC sentinels.** `assertNoDiagnosticPhiLeak` puts a marker value into a
slot you declare and then sweeps the parser's diagnostics for a verbatim echo of it. The marker is
synthetic by construction; never substitute a real value for one, and never commit a fixture built
from a real record. A test fixture is committed code, and a repository is not a safe place for a
patient's data.

**A diagnostic that fails prints the SENTINEL, not a patient's record**, for the same reason: what
was planted is what is echoed back in the failure message.

What the consumer still owns: keeping real data out of its arbitraries and fixtures, declaring a slot
for every position a sender controls, and reading the narrow statement of what
`assertNoDiagnosticPhiLeak` proves before quoting the gate as coverage. A green run means nothing
this configuration looked for was found, which is not the same as no leak.

## API

### The runners

| Export                        | Proves                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roundTripProperty`           | `parse(serialize(x))` equals `x`, and serialization is idempotent.                                                                                          |
| `idempotentNormalizeProperty` | `normalize(normalize(x))` equals `normalize(x)`.                                                                                                            |
| `lenientNeverThrowsProperty`  | `parse` throws only on sanctioned fatals; every recovered warning has a registered code (plus position).                                                    |
| `immutabilityProperty`        | a mutation attempt throws or returns a new instance. It never edits the original in place.                                                                  |
| `sortedCodeSet`               | the sorted warning/fatal code values, ready for a `toMatchSnapshot` stability tripwire.                                                                     |
| `assertNoSecretLeak`          | a `Secret<T>`-style wrapper never leaks through `JSON.stringify` / `String()` / `` `${}` `` / `util.inspect`.                                               |
| `assertNoDiagnosticPhiLeak`   | a declared slot's input does not echo into a diagnostic `message`, a position object, a thrown value, `err.stack`, or a structural identifier on the model. |
| `assertProperty`              | runs any fast-check property at the shared depth, and throws a failure that replays exactly.                                                                |
| `resolvePropertyRun`          | the depth, seed and path a run will use, from a runner's options and the environment.                                                                       |

**The two PHI runners answer different questions and neither substitutes for the other.**
`assertNoSecretLeak` is about a wrapper resisting stringification. `assertNoDiagnosticPhiLeak` is
about a parser copying bytes it was handed into something a consumer will log. A parser needs the
second one.

### Exactly what `assertNoDiagnosticPhiLeak` proves

Stated narrowly on purpose, because a gate believed to cover more than it does is how the last
generation of these suites went green over nothing:

> For each declared slot, no **verbatim echo of four or more bytes** of the planted value appears in
> any swept surface, and the slot **provably reached the diagnostic it names**.

It does **not** prove the absence of a re-encoded echo (hex, base64, a hash), an echo shorter than
four bytes, or a leak through a slot nobody declared. Opt in to `checkLengthInvariance` for the
first of those, and read that option's docs before you do.

Matching is case-insensitive, and each diagnostic is rendered three ways: `JSON.stringify`,
`util.inspect`, and a walk of the object graph. The walk is what catches a nested `toString`, raw
bytes attached as context, and entries past `inspect`'s truncation ceilings, none of which either
summary rendering shows.

```ts
import { assertNoDiagnosticPhiLeak } from "@cosyte/test-utils";
import { parseCcda, WARNING_CODES } from "@cosyte/ccda";

it("puts no consumer-controlled input on a diagnostic surface", () => {
  assertNoDiagnosticPhiLeak({
    slots: [
      {
        name: "ClinicalDocument/templateId/@root",
        plant: (m) => buildDoc({ docTypeOid: m }),
        expectCode: WARNING_CODES.UNKNOWN_DOCUMENT_TEMPLATE,
      },
      {
        name: "section/code/@code",
        plant: (m) => buildDoc({ sectionCode: m }),
        expectCode: WARNING_CODES.UNKNOWN_SECTION_CODE,
      },
    ],
    parse: (raw: string) => parseCcda(raw),
    parseStrict: (raw: string) => parseCcda(raw, { strict: true }),
    getDiagnostics: (doc) => doc.warnings,
    // Structural identifiers only. Values the model is meant to carry do not belong here.
    getModelIdentifiers: (doc) => doc.sections.map((s) => s.templateId),
  });
});
```

### Why every slot must name a code

A PHI test is only as good as the slots its generator can reach. The audit named above found
sentinels planted in patient name, MRN and narrative, while the slots that actually leaked (a
template OID, an element name, a column name) were handed clean values.

Counting diagnostics does not fix that. A fixture can plant a marker, have it ignored, and still
emit some _unrelated_ warning, at which point the slot looks exercised while the leaking branch was
never entered. So `expectCode` is required per slot and the runner asserts that code appeared.
Declare a slot for **every** position a sender controls, not the ones that look sensitive, and run
it against the unfixed parser first. A PHI suite that has never been seen red is indistinguishable
from one that cannot go red.

Reach is asserted in **lenient mode only**. A strict mode throws on the first deviation, so only
whichever slot happens to be the document's earliest deviation could ever satisfy its code there;
held per-mode, the check reds correct slots and, since it precedes the sweep, aborts the run and
hides a real leak in a later slot. Strict mode keeps its sweep and gives up the assertion.

### The three selectors are required, and that is deliberate

`getDiagnostics`, `getModelIdentifiers` and `parseStrict` have no defaults. `() => []` and `null`
are legitimate answers; _silence_ is not.

`getModelIdentifiers` is the one that matters most. `@cosyte/hl7` bounded its warning messages, went
green, and `@cosyte/deid` still leaked, because `segment.type` stayed unbounded on the **model** and
`deid` interpolated it to build a manifest. A diagnostic-surface fix protects your diagnostics, not
a downstream package that reads your model and builds its own diagnostics from it. An optional
selector plus a warning in prose is exactly the control that already failed, ecosystem-wide.

Likewise `getDiagnostics` must return **every** diagnostic collection: a model carrying both
`warnings` and `errors` must return both, or the unswept one is where leaks live.

### `@cosyte/test-utils/perf`: the performance kit

A second, separately-imported runner family on the `./perf` subpath. It exists so every package can
prove, in its own CI and without bespoke code, that it has not silently acquired an
**algorithmic-complexity** regression. Zero dependencies, hand-rolled on `node:perf_hooks`.

```ts
import { scalingGate, assertScalingGateFires, PERF_CONTRACT } from "@cosyte/test-utils/perf";
```

| Export                   | What it does                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `scalingGate`            | the gate: asserts the **count** and **size** scaling ratios stay inside the calibrated band |
| `assertScalingGateFires` | the self-check: proves _your_ fixtures are big enough for the gate to be able to fail       |
| `PERF_CONTRACT`          | the frozen constants, readable but not overridable                                          |
| `perfSink`               | the accumulator the measured loop sums into, so it cannot be optimized away                 |
| `SELF_SIZE_TARGET_MS`    | the base phase duration a self-sizing gate aims for: 20 ms                                  |

**You need both.** `scalingGate` on its own is a gate whose sensitivity is unknown.

```ts
const options = {
  name: "@cosyte/hl7 parseHL7",
  parse: (raw: string) => parseHL7(raw),
  weigh: (m) => m.segments.length,
  count: { n: 1_000, generate: (i) => adtMessage(i) },
  size: { inputs: 10, size: 500, generate: (i, size) => oruMessage(i, size) },
};

it("has not acquired a complexity regression", () => {
  scalingGate(options); // throws outside the band; returns a report, which may be a loud skip
});

it("has fixtures large enough for that gate to fail", () => {
  assertScalingGateFires(options, { regressedParse: parseHL7Quadratic });
});
```

#### Both axes, and why size-scaling is not optional

`count` scales the _number_ of inputs at fixed length; `size` scales each input's _length_ at fixed
count. An O(n²)-in-length tokenizer is invisible to the count axis **by construction**: at fixed
message size a quadratic parser still scores about 4 there. There is no way to ask for one axis.

#### Self-sizing: no more growing a fixture for the floor

A base phase under `MIN_PHASE_MS` (4 ms) skips `phase-too-short`, and a skip is not a pass. A
fixture sized by hand to clear the floor on one runner reads under it on a faster one, and every
parser speedup shrinks it again. Pass `selfSize: true` and the gate sizes its own phases instead:

```ts
const options = {
  name: "@cosyte/hl7 parseHL7",
  parse: (raw: string) => parseHL7(raw),
  count: { n: 100, generate: (i) => adtMessage(i) },
  size: { inputs: 1, size: 500, generate: (i, size) => oruMessage(i, size) },
  selfSize: true, // or { targetMs: 40 }
};
```

After the warmup it counts how many passes over the base corpus one timed rep needs to take at
least 20 ms (`SELF_SIZE_TARGET_MS`, or your own `targetMs`, which may not be under the floor), then
times **both** phases at that many passes per rep. The ratio is the ratio one pass against one pass
would give, so the floor, the ceiling and the self-check are unchanged. The count it chose is
`passes` on each phase's report and a `self-sized:` line in the diagnostic, and the self-check
reports its own as `passes` and `cleanPasses`. A phase that is still under the floor at the most
passes the gate will try (65,536 a rep) skips `phase-too-short`, as before, and the self-check fails
on it.

It is off by default: a gate that does not ask runs one pass a rep, exactly as before. Adopting it
is one line, and the fixture can then shrink back to the size the **self-check** needs, since
repetition lifts a phase over the floor but not a signal over the ceiling: a real quadratic's signal
climbs only with the size of each input, so `assertScalingGateFires` still fails a size axis too
small to show one.

#### What it will not tell you: read this before quoting it

1. **It does not detect constant-factor regressions.** A 10% slowdown passes, and always will. From
   a single cloud instance only 17% to 22% of configurations reliably detect a slowdown of 10% or
   less, so this is a property of same-machine paired measurement, not a gap to be closed by tuning.
   **Never claim 10% sensitivity for a package that adopts this.**
2. **"Catches complexity-shaped regressions" is conditional.** It holds only when the fixture is
   large enough, and how large is workload-specific: the measured signal from a genuine
   O(n²)-in-length parser climbed 4.69, then 8.09, then 8.84, then 10.68 as the base fixture grew
   from 125 to 250 to 500 to 1000 repeated segments, against a false-alarm tail that stays at 6.649.
   At the smallest of those a real regression is _inside the noise_. `assertScalingGateFires` is what
   proves your own fixtures clear that bar: a package that skips it has a gate with no established
   sensitivity.
3. **The ceiling is calibrated to a runner class, and yours may not be in it.** Measured by
   PERF-P2's own false-alarm sweeps: on a CPU-quota-throttled container the gate fired on a workload
   that is linear by construction **4 times in 600 clean runs**, at ratios of 8.94 to 11.01, which
   sit **above** the weakest real O(n²) signal at `hl7`'s own fixture size (8.84). On that box no
   ceiling separates noise from signal at all. The mechanism is not modelled by the contract: a
   same-process ratio cancels JIT state, but the two phases are separated in _time_ and a cgroup's
   throttling state changes between them. So `assertScalingGateFires` proves your **fixture** is big
   enough and says nothing about whether your **runner** is quiet enough. Establish both before
   adopting: `experiments/perf-p2-false-alarm/` in the `config` repo re-runs on any machine and
   answers the second question.
4. Absolute timings are not a portable guarantee, cross-package comparison is meaningless, and
   nothing here sees a regression that only appears under real I/O, network or concurrency.

#### Fail-safe, and PHI

A performance measurement must never report a confident wrong answer. When the preconditions for a
ratio do not hold (`phase-too-short`, `warmup-unstable`) the gate **skips loudly** on stderr and
returns `status: "skipped"`. **A skip is not a pass**; read the returned report if you want one to
fail your suite. Both bounds are asserted: the ceiling catches the complexity regression, the floor
catches the two phases having received the same workload.

The runner takes a **generator function, never a file path**, so inputs are synthetic and produced
in-process by construction rather than by discipline. Every diagnostic carries sizes, counts, ratios
and sample vectors, and never echoes input content.

#### Running it

Perf tests belong in their **own non-instrumented invocation**: coverage instrumentation compiles
an effectful counter into the measured function body at a cost that does not cleanly cancel in a
ratio. This package ships that split as a worked example: `pnpm test` (clock-free, coverage-safe) and
`pnpm test:perf` (`vitest.perf.config.ts`, the tests that actually measure).

Every constant is fixed by
[ADR 0001](https://github.com/cosyte/config/blob/main/documentation/decisions/0001-perf-measurement-contract.md),
each tagged _measured_ or _judgement_, from the PERF-P0 calibration: 3,200 4N-vs-N ratios on a linear
workload, 320 on a deliberately O(n²) one, on Node 22.23.1 / V8 12.4. They are **not tuning knobs**:
the ADR's review triggers are the process for moving one.

## Compatibility

Node `>=22.0.0`, ESM only, dual-published through tsup with declarations. `fast-check` `^3` or `^4` is a peer
dependency of the main entry point; the `./perf` subpath has no dependencies at all and runs on
`node:perf_hooks` alone, so a package can adopt the performance kit without taking `fast-check`.

## Contributing

Questions, bug reports and proposals go to
[the issue tracker](https://github.com/cosyte/config/issues). Pull requests are welcome, in
[cosyte/config](https://github.com/cosyte/config), where this package lives.

A change has to clear the required `verify` job, and a change to a runner needs a changeset saying
what it now proves: a new check reds parsers that were passing, and a relaxed one silently stops
proving something. Never open an issue containing real patient data; describe the shape instead.

## License

MIT, copyright Cosyte LLC. See [LICENSE](https://github.com/cosyte/config/blob/main/LICENSE).
