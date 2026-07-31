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

Part of [cosyte/config](https://github.com/cosyte/config).
