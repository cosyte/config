# @cosyte/test-utils

The shared conformance test kit for the `@cosyte/*` parsers, so every parser proves the **same**
archetype invariants against one contract instead of reinventing them.

It ships **generic, parameterized invariant runners**. The **format-specific arbitraries stay in
each parser**. This kit contains no HL7/DICOM/X12 generators. The runners are framework-agnostic:
they use [`fast-check`](https://fast-check.dev/) (a peer dependency, `^3`) and `node:assert/strict`,
and **throw** on failure, so any test runner (Vitest, `node:test`, Mocha) catches them. The kit takes
no runtime dependency on a test framework.

```sh
pnpm add -D @cosyte/test-utils fast-check
```

## The runners

| Export                       | Proves                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roundTripProperty`          | `parse(serialize(x))` equals `x`, and serialization is idempotent.                                                                                          |
| `lenientNeverThrowsProperty` | `parse` throws only on sanctioned fatals; every recovered warning has a registered code (+ position).                                                       |
| `immutabilityProperty`       | a mutation attempt throws or returns a new instance. It never edits the original in place.                                                                  |
| `sortedCodeSet`              | the sorted warning/fatal code values, ready for a `toMatchSnapshot` stability tripwire.                                                                     |
| `assertNoSecretLeak`         | a `Secret<T>`-style wrapper never leaks through `JSON.stringify` / `String()` / `` `${}` `` / `util.inspect`.                                               |
| `assertNoDiagnosticPhiLeak`  | a declared slot's input does not echo into a diagnostic `message`, a position object, a thrown value, `err.stack`, or a structural identifier on the model. |

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

A PHI test is only as good as the slots its generator can reach. An audit of thirteen cosyte repos
(2026-07-30) found every PHI test green over unreachable space: sentinels planted in patient name,
MRN and narrative, while the slots that actually leaked (a template OID, an element name, a column
name) were handed clean values. Those tests could not have failed.

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

## Adopting it in a parser

Bring your own format-specific `fast-check` arbitraries; feed them to the runners. For `@cosyte/hl7`:

```ts
import { describe, it, expect } from "vitest";
import { roundTripProperty, lenientNeverThrowsProperty, sortedCodeSet } from "@cosyte/test-utils";
import { parseHL7, Hl7ParseError, FATAL_CODES, WARNING_CODES } from "@cosyte/hl7";
import { specCleanMessage, hostileInput } from "./property/_arbitraries.js"; // the parser's own

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

## `@cosyte/test-utils/perf` — the performance kit

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

### Both axes, and why size-scaling is not optional

`count` scales the _number_ of inputs at fixed length; `size` scales each input's _length_ at fixed
count. An O(n²)-in-length tokenizer is invisible to the count axis **by construction** — at fixed
message size a quadratic parser still scores ≈4 there. There is no way to ask for one axis.

### What it will not tell you — read this before quoting it

1. **It does not detect constant-factor regressions.** A 10% slowdown passes, and always will. From
   a single cloud instance only 17–22% of configurations reliably detect a ≤10% slowdown, so this is
   a property of same-machine paired measurement, not a gap to be closed by tuning. **Never claim 10%
   sensitivity for a package that adopts this.**
2. **"Catches complexity-shaped regressions" is conditional.** It holds only when the fixture is
   large enough, and how large is workload-specific: the measured signal from a genuine
   O(n²)-in-length parser climbed 4.69 → 8.09 → 8.84 → 10.68 as the base fixture grew 125 → 250 →
   500 → 1000 repeated segments, against a false-alarm tail that stays at 6.649. At the smallest of
   those a real regression is _inside the noise_. `assertScalingGateFires` is what proves your own
   fixtures clear that bar — a package that skips it has a gate with no established sensitivity.
3. **The ceiling is calibrated to a runner class, and yours may not be in it.** Measured by
   PERF-P2's own false-alarm sweeps: on a CPU-quota-throttled container the gate fired on a workload
   that is linear by construction **4 times in 600 clean runs**, at ratios of 8.94–11.01 — which sit
   **above** the weakest real O(n²) signal at `hl7`'s own fixture size (8.84). On that box no ceiling
   separates noise from signal at all. The
   mechanism is not modelled by the contract: a same-process ratio cancels JIT state, but the two
   phases are separated in _time_ and a cgroup's throttling state changes between them. So
   `assertScalingGateFires` proves your **fixture** is big enough and says nothing about whether your
   **runner** is quiet enough. Establish both before adopting — `experiments/perf-p2-false-alarm/`
   in the `config` repo re-runs on any machine and answers the second question.
4. Absolute timings are not a portable guarantee, cross-package comparison is meaningless, and
   nothing here sees a regression that only appears under real I/O, network or concurrency.

### Fail-safe, and PHI

A performance measurement must never report a confident wrong answer. When the preconditions for a
ratio do not hold — `phase-too-short`, `warmup-unstable` — the gate **skips loudly** on stderr and
returns `status: "skipped"`. **A skip is not a pass**; read the returned report if you want one to
fail your suite. Both bounds are asserted: the ceiling catches the complexity regression, the floor
catches the two phases having received the same workload.

The runner takes a **generator function, never a file path**, so inputs are synthetic and produced
in-process by construction rather than by discipline. Every diagnostic carries sizes, counts, ratios
and sample vectors, and never echoes input content.

### Running it

Perf tests belong in their **own non-instrumented invocation** — coverage instrumentation compiles
an effectful counter into the measured function body at a cost that does not cleanly cancel in a
ratio. This package ships that split as a worked example: `pnpm test` (clock-free, coverage-safe) and
`pnpm test:perf` (`vitest.perf.config.ts`, the tests that actually measure).

Every constant is fixed by
[ADR 0001](../../documentation/decisions/0001-perf-measurement-contract.md), each tagged _measured_
or _judgement_, from the PERF-P0 calibration: 3,200 4N-vs-N ratios on a linear workload, 320 on a
deliberately O(n²) one, on Node 22.23.1 / V8 12.4. They are **not tuning knobs** — the ADR's review
triggers are the process for moving one.

Part of [cosyte/config](https://github.com/cosyte/config).
