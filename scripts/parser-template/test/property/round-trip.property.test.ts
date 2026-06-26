/**
 * Property-based conformance tests for the cosyte parser archetype, driven by the shared
 * `@cosyte/test-utils` invariant runners. The kit owns the **invariants**; this parser owns the
 * **format-specific arbitraries** (the `{{Pascal}}` generators below).
 *
 * This file is the intended shape for every `@cosyte/*` parser (see `@cosyte/hl7`'s
 * `test/property/`). While `{{PKG}}` is still a scaffold:
 *
 *   - the **lenient-mode** invariant runs today against the stub parser (it must never throw on
 *     arbitrary input and must only emit registered warning codes) — a real, passing guard; and
 *   - the **round-trip** invariant is `it.todo` until the serializer (`serialize{{Pascal}}` /
 *     `result.toString()`) lands. The body is written against the real runner so it typechecks and
 *     lints now, and flips on by changing `it.todo` to `it` once a serializer exists.
 *
 * Replace the placeholder arbitraries with real spec-clean and hostile generators as the parser
 * grows, and add the `immutabilityProperty` + warning-code snapshot guards (see `@cosyte/test-utils`).
 */

import { describe, it } from "vitest";
import fc from "fast-check";
import { lenientNeverThrowsProperty, roundTripProperty } from "@cosyte/test-utils";

import {
  FATAL_CODES,
  WARNING_CODES,
  parse{{Pascal}},
  type Parsed{{Pascal}},
} from "../../src/index.js";

const fatalCodes = new Set<string>(Object.values(FATAL_CODES));
const knownWarningCodes = new Set<string>(Object.values(WARNING_CODES));

/**
 * Placeholder arbitrary for **hostile / quirky** input — the lenient-mode generator. Today this is
 * just arbitrary strings; replace it with a generator that emits real {{TITLE}} quirks (truncated
 * segments, unknown elements, encoding oddities) the lenient parser must recover into warnings.
 */
function hostileInput(): fc.Arbitrary<string> {
  return fc.string();
}

/**
 * Placeholder arbitrary for **spec-clean** values — the round-trip generator. Today it produces the
 * stub's parsed shape; replace it with a generator of spec-valid messages the builder/serializer can
 * emit, so `parse(serialize(x))` can be asserted structurally equal to `x`.
 */
function specClean{{Pascal}}(): fc.Arbitrary<Parsed{{Pascal}}> {
  return fc.constant({ value: {}, warnings: [] } satisfies Parsed{{Pascal}});
}

describe("{{NAME}} conformance (archetype invariants)", () => {
  it("is lenient — arbitrary input never throws a non-fatal, and every warning has a known code", () => {
    lenientNeverThrowsProperty({
      arbitrary: hostileInput(),
      parse: (raw: string) => parse{{Pascal}}(raw),
      // The stub parser never throws; once real fatals exist, only those may escape as throws.
      isFatal: (err) =>
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        fatalCodes.has(String(err.code)),
      getWarnings: (parsed) => (parsed as Parsed{{Pascal}}).warnings,
      isKnownCode: (code) => knownWarningCodes.has(code),
      hasPositionalContext: (warning) =>
        warning.position === undefined || typeof warning.position === "object",
    });
  });

  // TODO: flip `it.todo` -> `it` once a serializer (`serialize{{Pascal}}` / `result.toString()`)
  // exists. The body already typechecks and lints against the real runner.
  it.todo("round-trips — parse(serialize(x)) is structurally equal to x", () => {
    roundTripProperty({
      arbitrary: specClean{{Pascal}}(),
      // Replace with the real serializer once it lands.
      serialize: (value) => JSON.stringify(value),
      // Replace with the real parser once it returns the model type the arbitrary produces. The
      // placeholder reconstructs the stub shape from the wire string without an unsafe cast.
      parse: (raw): Parsed{{Pascal}} => {
        const decoded: unknown = JSON.parse(raw);
        const warnings =
          typeof decoded === "object" && decoded !== null && "warnings" in decoded
            ? (decoded as Parsed{{Pascal}}).warnings
            : [];
        return { value: {}, warnings };
      },
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });
  });
});
