/**
 * The PHI-leak assertion matrix.
 *
 * A `Secret<T>`-style wrapper (the `pathways` pattern) must resist **every**
 * channel through which a value can become a string — because any one of them
 * can spill PHI into a log line, an error message, or a serialized payload. The
 * four channels a wrapper must survive:
 *
 * 1. `JSON.stringify(value)` — structured logging / serialization (`toJSON`);
 * 2. `String(value)` — explicit coercion (`toString` / `Symbol.toPrimitive`);
 * 3. `` `${value}` `` — template-literal interpolation (the log-statement trap);
 * 4. `util.inspect(value, { depth: null })` — `console.log` / Node REPL
 *    (`Symbol.for("nodejs.util.inspect.custom")`).
 *
 * {@link assertNoSecretLeak} drives a value through all four and asserts the raw
 * secret never appears while the redaction marker does — naming the exact leaking
 * channel when one fails. This is format-agnostic: it works on any wrapper, not
 * just healthcare ones.
 *
 * @packageDocumentation
 */

import assert from "node:assert/strict";
import { inspect } from "node:util";

/**
 * Options for {@link assertNoSecretLeak}.
 */
export interface SecretLeakOptions {
  /**
   * The raw secret string that must never surface through any channel. Must be
   * non-empty (an empty needle would match everything and make the test vacuous).
   */
  readonly secret: string;
  /**
   * The masked marker the wrapper substitutes for the secret (e.g.
   * `"[REDACTED]"`). Each channel's output must contain this, proving the value
   * actively redacts rather than merely omitting the secret.
   */
  readonly redactedMarker: string;
}

/** One channel under test: a human-readable name and how to stringify through it. */
interface Channel {
  readonly name: string;
  readonly render: (value: unknown) => string;
}

/**
 * The four leak channels, in a fixed order. Each `render` reproduces exactly one
 * way a value can become a string in real code.
 */
const CHANNELS: readonly Channel[] = [
  { name: "JSON.stringify", render: (v) => JSON.stringify(v) ?? "undefined" },
  { name: "String()", render: (v) => String(v) },
  // The template-literal path is distinct from String(): it invokes
  // Symbol.toPrimitive with the "string" hint and is the classic log-line leak.
  { name: "template-literal", render: (v) => `${v as string}` },
  { name: "util.inspect", render: (v) => inspect(v, { depth: null }) },
];

/**
 * Assert that a value never leaks `secret` through any of the four stringify
 * channels, and that each channel instead shows `redactedMarker`.
 *
 * For each channel the runner renders the value and checks two things: the raw
 * `secret` does **not** appear in the output, and the `redactedMarker` **does**.
 * On the first violation it throws an `AssertionError` naming the offending
 * channel (e.g. `"util.inspect"`) and what went wrong, so the leak is
 * immediately diagnosable. With no test-framework dependency, this works under
 * any runner.
 *
 * @param value - The wrapper instance to probe (typically a `Secret<T>`).
 * @param options - The raw `secret` and the expected `redactedMarker`.
 * @returns Nothing; it throws on the first leaking (or non-redacting) channel.
 * @example
 * ```ts
 * import { assertNoSecretLeak } from "@cosyte/test-utils";
 *
 * class Secret<T> {
 *   constructor(private readonly value: T) {}
 *   toJSON() { return "[REDACTED]"; }
 *   toString() { return "[REDACTED]"; }
 *   [Symbol.for("nodejs.util.inspect.custom")]() { return "[REDACTED]"; }
 * }
 *
 * // Passes: the SSN never surfaces and every channel shows the marker.
 * assertNoSecretLeak(new Secret("123-45-6789"), {
 *   secret: "123-45-6789",
 *   redactedMarker: "[REDACTED]",
 * });
 * ```
 */
export function assertNoSecretLeak(value: unknown, options: SecretLeakOptions): void {
  const { secret, redactedMarker } = options;

  assert.ok(
    secret.length > 0,
    "assertNoSecretLeak: `secret` must be non-empty — an empty needle matches everything",
  );
  assert.ok(redactedMarker.length > 0, "assertNoSecretLeak: `redactedMarker` must be non-empty");

  for (const channel of CHANNELS) {
    const rendered = channel.render(value);

    assert.ok(
      !rendered.includes(secret),
      `assertNoSecretLeak: secret leaked through ${channel.name} — its output contained the raw secret. Channel output: ${JSON.stringify(rendered)}`,
    );
    assert.ok(
      rendered.includes(redactedMarker),
      `assertNoSecretLeak: ${channel.name} did not redact — its output is missing the marker ${JSON.stringify(redactedMarker)}. Channel output: ${JSON.stringify(rendered)}`,
    );
  }
}
