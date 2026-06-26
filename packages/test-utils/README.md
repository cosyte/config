# @cosyte/test-utils

The shared conformance test kit for the `@cosyte/*` parsers — so every parser proves the **same**
archetype invariants against one contract instead of reinventing them.

It ships **generic, parameterized invariant runners**. The **format-specific arbitraries stay in
each parser** — this kit contains no HL7/DICOM/X12 generators. The runners are framework-agnostic:
they use [`fast-check`](https://fast-check.dev/) (a peer dependency, `^3`) and `node:assert/strict`,
and **throw** on failure, so any test runner (Vitest, `node:test`, Mocha) catches them. The kit takes
no runtime dependency on a test framework.

```sh
pnpm add -D @cosyte/test-utils fast-check
```

## The runners

| Export                       | Proves                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `roundTripProperty`          | `parse(serialize(x))` equals `x`, and serialization is idempotent.                                            |
| `lenientNeverThrowsProperty` | `parse` throws only on sanctioned fatals; every recovered warning has a registered code (+ position).         |
| `immutabilityProperty`       | a mutation attempt throws or returns a new instance — it never edits the original in place.                   |
| `sortedCodeSet`              | the sorted warning/fatal code values, ready for a `toMatchSnapshot` stability tripwire.                       |
| `assertNoSecretLeak`         | a `Secret<T>`-style wrapper never leaks through `JSON.stringify` / `String()` / `` `${}` `` / `util.inspect`. |

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
