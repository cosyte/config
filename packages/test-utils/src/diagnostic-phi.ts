/**
 * The diagnostic-surface PHI runner: does consumer-controlled input reach a
 * place a consumer will log?
 *
 * This is a different question from {@link assertNoSecretLeak}, which asks
 * whether a `Secret<T>` *wrapper* resists stringification. This runner asks
 * whether a **parser** copies bytes it was handed into a `message`, a `stack`,
 * a position object, or a structural identifier on its own model. On a
 * healthcare parser that is a patient identifier in a log line.
 *
 * The invariant every `@cosyte/*` parser must hold:
 *
 * > A diagnostic is built from a **registry**, not from the document. Its
 * > `code` and its position say where to look; the bytes stay in the model.
 *
 * `astm` and `transform` hold it by construction: their warning factories take
 * **no value parameter**, so no interpolation is possible regardless of what
 * the document contains. That is the shape this runner is designed to prove.
 *
 * ## Why the slot table is the deliverable
 *
 * A PHI test is only as good as the slots its input generator can reach. An
 * audit of thirteen cosyte repos (2026-07-30) found **every** PHI test green
 * over unreachable space: sentinels planted in patient name, MRN and narrative
 * while the slots that actually leaked (a template OID, an element name, a
 * column name) were handed clean values. The tests could not have failed.
 *
 * So every slot must **name the diagnostic code it triggers**
 * ({@link DiagnosticSlot.expectCode}), and the runner asserts that code
 * actually appeared. Merely counting diagnostics is not enough: a fixture can
 * plant a marker, have it ignored, and emit some *unrelated* warning, and the
 * slot then looks exercised while the leaking branch was never entered.
 *
 * ## Exactly what this proves, and what it does not
 *
 * State it narrowly, because a gate believed to cover more than it does is how
 * the last generation of these suites went green over nothing:
 *
 * > For each declared slot, no **verbatim echo of four or more bytes** of the
 * > planted value appears in any swept surface, and the slot **provably reached
 * > the diagnostic it names**.
 *
 * It does **not** prove the absence of a re-encoded echo (hex, base64, a hash),
 * an echo shorter than four bytes, a leak carried only as a number, a leak
 * through a slot nobody declared, or reach in strict mode. Nor does it prove
 * the absence of a leak that is *both* invisible to the two summary renderings
 * (behind a `toString`, in raw bytes, or past `inspect`'s hundred-entry cut)
 * *and* beyond {@link walkForText}'s ceilings of depth 8 and 5,000 nodes.
 * Those ceilings buy off an unbounded walk on an adversarial diagnostic; the
 * honest response to a leak hiding past them is to say so, not to raise them.
 *
 * The optional {@link DiagnosticSurfaceOptions.checkLengthInvariance} adds a
 * size-growth check that catches some re-encoded echoes, but it is off by
 * default and the reason is in its own documentation.
 *
 * ## The two probes
 *
 * Each slot is parsed twice, with a short marker and a long one. Neither may
 * produce a surface containing any four-byte run of {@link PHI_MARKER_UNIT}, so
 * a fix that *truncates* an echo instead of removing it still fails, down to a
 * four-byte remnant.
 *
 * ## What the model sweep does and does not cover
 *
 * A parser's model is *supposed* to carry document values, so a blanket sweep
 * of it would be meaningless. What must stay bounded are **structural
 * identifiers**: a segment type, an XML local name, a JSON key, a CSV column
 * name. Four of the audited leaks were exactly that shape, and one of them
 * proved the layering lesson the hard way: `hl7` bounded its warning messages
 * and `@cosyte/deid` still leaked, because `segment.type` stayed unbounded on
 * the *model* and `deid` interpolated it to build a manifest. A
 * diagnostic-surface fix protects your diagnostics; it does not protect a
 * downstream package that reads your model and builds its own diagnostics from
 * it. Supply {@link DiagnosticSurfaceOptions.getModelIdentifiers} and enumerate
 * them; the enumeration is meant to be reviewed.
 *
 * @packageDocumentation
 */

import assert from "node:assert/strict";
import { inspect } from "node:util";

/**
 * The eight-byte unit every probe marker is built from. Markers are this string
 * repeated, and the sweep matches any four-byte run of it, so a diagnostic that
 * echoes even a truncated fragment of a planted value is still caught (down to
 * {@link MIN_DETECTED_FRAGMENT} bytes).
 *
 * Chosen to be absent from real healthcare payloads and free of regular
 * expression metacharacters, so it can be embedded in XML attributes and HL7
 * v2 fields without changing the grammar.
 *
 * **It is not valid everywhere.** DICOM restricts `UI` to digits and `.` and
 * `CS` to upper case, digits, space and `_` (PS3.5 section 6.2), and the X12
 * basic character set excludes lower case. Those are exactly the structural
 * slots a `dicom` or `x12` adopter would want to probe, and a parser that
 * rejects or normalizes the marker before the leaking branch makes the probe
 * prove nothing. Matching is case-insensitive, which covers case folding; an
 * adopter for those formats still has to confirm the marker reaches the branch
 * rather than assuming it, which is what {@link DiagnosticSlot.expectCode} is
 * for.
 */
export const PHI_MARKER_UNIT = "ZqPhI7xK";

/**
 * The shortest echoed fragment the runner can recognize. Every four-byte run of
 * a repeated {@link PHI_MARKER_UNIT} is distinctive, so a truncated echo is
 * caught down to four bytes: below that there is not enough left to match
 * without risking a false positive on ordinary text.
 *
 * **This is a real limit, not a formality.** A four-byte remnant is still a
 * postal-code prefix or the tail of an account number. A parser that truncates
 * an echo to three bytes passes this runner and is still wrong; the fix is to
 * build the diagnostic from a registry, not to shorten the echo.
 */
const MIN_DETECTED_FRAGMENT = 4;

/**
 * Every distinct fragment of `MIN_DETECTED_FRAGMENT` bytes that can appear in a
 * marker. Taken over the unit doubled, so runs that straddle a repeat boundary
 * are included and a truncation at any offset is still matched.
 */
const MARKER_FRAGMENTS: readonly string[] = (() => {
  const doubled = PHI_MARKER_UNIT.repeat(2);
  const fragments = new Set<string>();
  for (let i = 0; i + MIN_DETECTED_FRAGMENT <= doubled.length; i += 1) {
    fragments.add(doubled.slice(i, i + MIN_DETECTED_FRAGMENT));
  }
  return [...fragments];
})();

/**
 * One consumer-controlled position in the format under test, and how to build
 * an input carrying a marker there.
 *
 * List **every** slot a sender controls, not the ones that look sensitive.
 * The audited leaks were in template OIDs, element names and column names:
 * slots nobody thought of as PHI-bearing, which a real sender can fill with
 * anything at all.
 *
 * @template TInput - The parser's input type (typically `string` or `Uint8Array`).
 */
export interface DiagnosticSlot<TInput> {
  /**
   * A human-readable name for the slot, used verbatim in failure messages
   * (e.g. `"ClinicalDocument/templateId/@root"`). Make it precise enough to
   * navigate to.
   */
  readonly name: string;
  /**
   * Build an input with `marker` planted in this slot and everything else
   * spec-clean. The marker must survive into the bytes the parser reads: if the
   * surrounding document escapes or strips it, the probe proves nothing.
   */
  readonly plant: (marker: string) => TInput;
  /**
   * The diagnostic **code** this slot is expected to trigger: the warning code,
   * or the code of the fatal it raises. The runner asserts that code actually
   * appeared, which is what ties the probe to the code path under test.
   *
   * Counting diagnostics is not enough, and this field exists because of that.
   * A fixture can plant a marker, have it silently ignored, and still emit some
   * *unrelated* warning; the slot then looks exercised while the leaking branch
   * was never entered. That is not a hypothetical, it is what the audit found
   * in thirteen repos out of thirteen.
   *
   * Pass `null` to declare deliberately that this slot's reach is unchecked.
   * It is a required decision rather than a default so that it shows up in
   * review, and a `null` here is exactly the kind of thing to question there.
   */
  readonly expectCode: string | null;
}

/**
 * Options for {@link assertNoDiagnosticPhiLeak}.
 *
 * @template TInput - The parser's input type.
 * @template TParsed - The parser's model type.
 */
export interface DiagnosticSurfaceOptions<TInput, TParsed> {
  /** Every consumer-controlled slot in the format, each able to plant a marker. */
  readonly slots: readonly DiagnosticSlot<TInput>[];
  /**
   * The parser in its lenient (default) mode. If it throws, the thrown value's
   * `message` and `stack` are swept rather than treated as a failure: a fatal
   * is a diagnostic surface too.
   */
  readonly parse: (raw: TInput) => TParsed;
  /**
   * The parser in strict mode, or `null` if it has none. Strict modes typically
   * raise the first warning into an `Error`, which puts the warning's text into
   * `err.stack` and from there into whatever an error reporter ships to a third
   * party, so a leak can exist in strict mode only.
   *
   * Required (as `null` when absent) rather than optional, so that forgetting a
   * strict mode is impossible and skipping one is visible in review.
   */
  readonly parseStrict: ((raw: TInput) => unknown) | null;
  /**
   * Extract **every** diagnostic collection the model exposes. Required, and
   * required to be exhaustive: a model carrying both `warnings` and `errors`
   * must return both, or the unswept one becomes the place leaks live.
   *
   * There is deliberately no default reading `.warnings`, because a default
   * that silently covers one array of two reports green for a model it only
   * half-read.
   */
  readonly getDiagnostics: (parsed: TParsed) => readonly unknown[];
  /**
   * Enumerate every **structural identifier** string on the model: the fields a
   * downstream package would interpolate to describe a location (segment type,
   * element name, key, column name). Values the model is supposed to carry do
   * **not** belong here.
   *
   * Required, and `() => []` is a legitimate answer for a format with no such
   * field. It is required rather than optional because omitting it silently is
   * exactly the `hl7`/`deid` failure: `hl7` bounded its messages, went green,
   * and `deid` still leaked off the model. An optional selector plus a warning
   * in prose is the control that already failed, ecosystem-wide.
   */
  readonly getModelIdentifiers: (parsed: TParsed) => readonly string[];
  /**
   * Also assert that the **size** of each diagnostic is unchanged between the
   * short and long probes, catching an echo that was hex-encoded, base64'd or
   * escaped past a verbatim match. Defaults to `false`.
   *
   * Off by default because it reds correct parsers. A diagnostic legitimately
   * grows with input size whenever it carries an input-derived **number**: a
   * position `column` gains digits as the value before it lengthens, and a
   * byte count gains digits directly. Both are the *prescribed* fix here, so
   * the check would fail `mllp`'s bounded byte-count messages, `astm`'s count
   * and `fhir`'s `"(1 location(s))"`: the ecosystem's three reference-correct
   * designs. A length-based failure would also be reported as an echo, which
   * is the wrong diagnosis and teaches an adopter to distrust the runner.
   *
   * Enable it only for a parser whose diagnostics carry no input-derived
   * number at all, and expect to turn it off again if positions are added.
   */
  readonly checkLengthInvariance?: boolean;
  /**
   * How many times {@link PHI_MARKER_UNIT} is repeated for the long probe.
   * Defaults to 4,096 (a 32 KiB marker).
   */
  readonly largeProbeRepeats?: number;
}

/** One swept string, with a label precise enough to navigate to on failure. */
interface Surface {
  readonly label: string;
  readonly text: string;
}

/**
 * Render a value **three** ways, because no single rendering sees what a
 * consumer sees.
 *
 * `JSON.stringify` is what a structured logger ships. `inspect` is what
 * `console.log` and `console.error` print, and of the two only `inspect`
 * reaches an `Error`-valued property, an `Error.cause` chain, a `Map`, or a
 * field a `toJSON` omits. That gap is not academic:
 * `JSON.stringify(new Error(secret))` is the string `"{}"`, so a warning
 * carrying `context: new Error(...)`, or an error class holding its own
 * context on `this`, is completely invisible to a JSON-only sweep while
 * `console.error` prints it in full.
 *
 * Both are still only *summaries*, so {@link walkForText} runs alongside them
 * and reaches what a summary elides: a nested `toString`, raw bytes, and
 * entries past `inspect`'s truncation ceilings.
 */
function renderings(value: unknown): readonly string[] {
  const out: string[] = [];
  try {
    out.push(inspect(value, { depth: null, showHidden: true, getters: true }));
  } catch {
    // A throwing [util.inspect.custom] shows nothing through this channel; the
    // walk below still reaches the underlying fields.
  }
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) out.push(json);
  } catch {
    // Circular or non-serializable: the inspect rendering above still covers it.
  }
  out.push(...walkForText(value));
  return out;
}

/** Depth and node ceilings for {@link walkForText}, so a probe cannot hang. */
const WALK_MAX_DEPTH = 8;
const WALK_MAX_NODES = 5000;

/**
 * Walk a value and collect the text a consumer could get out of each node.
 *
 * `inspect` and `JSON.stringify` both render a *summary*, and a summary hides
 * things a log line shows. Two shapes matter here and neither is exotic:
 *
 * - **A `toString()` on a nested object.** `inspect` prints
 *   `{ offset: 0, toString: [Function] }` and `JSON.stringify` prints
 *   `{"offset":0}`, while `` `${warning.position}` `` prints the value. A
 *   position object holding the offending text behind `toString` is the natural
 *   way to write one, and the README names the position object as covered, so
 *   it has to actually be covered.
 * - **Bytes.** `context: Buffer.from(raw)` renders as `<Buffer 5a 71 …>` and as
 *   `{"type":"Buffer","data":[90,113,…]}`; neither contains the marker, and a
 *   consumer decoding it sees the value. Attaching the offending bytes to a
 *   diagnostic is the obvious shape for `mllp`, `dicom`, `x12` and `hl7`, which
 *   are four of the repos this kit is being built to fix.
 *
 * Walking also removes `inspect`'s own truncation from the picture: a `Map` of
 * more than 100 entries renders as `... N more items`, so a leak past the
 * hundredth entry is invisible to the summary and visible here.
 */
function walkForText(root: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  let budget = WALK_MAX_NODES;

  const visit = (node: unknown, depth: number): void => {
    if (budget <= 0 || depth > WALK_MAX_DEPTH) return;
    budget -= 1;

    if (typeof node === "string") {
      found.push(node);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (ArrayBuffer.isView(node)) {
      try {
        const bytes = new Uint8Array(node.buffer, node.byteOffset, node.byteLength);
        // Both decodings: a marker planted as text survives utf8, and latin1
        // recovers it from bytes that are not valid utf8.
        found.push(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        found.push(Buffer.from(bytes).toString("latin1"));
      } catch {
        // A detached ArrayBuffer holds nothing to leak. Swallowed rather than
        // propagated because a throw here aborts the whole run at this slot,
        // and a real leak in a LATER slot would then never be reported.
      }
      return;
    }

    // A custom toString is what template-literal interpolation and String()
    // reach, and it is the one channel neither summary rendering shows.
    // The read itself is guarded: a Proxy `get` trap, or a revoked Proxy, can
    // throw here, and an uncaught throw aborts the run at this slot.
    let asString: unknown;
    try {
      asString = (node as { toString?: unknown }).toString;
    } catch {
      return;
    }
    if (typeof asString === "function" && asString !== Object.prototype.toString) {
      try {
        // Guarded directly above: this node has its own toString, so the
        // default "[object Object]" the rule warns about cannot be what we get.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        found.push(String(node));
      } catch {
        // A throwing toString leaks nothing through this channel.
      }
    }

    if (node instanceof Map) {
      for (const [key, value] of node) {
        visit(key, depth + 1);
        visit(value, depth + 1);
      }
      return;
    }
    if (node instanceof Set) {
      for (const value of node) visit(value, depth + 1);
      return;
    }
    if (node instanceof Error) {
      visit(node.message, depth + 1);
      visit(node.stack, depth + 1);
      visit(node.cause, depth + 1);
    }

    // Own keys rather than enumerable ones, so a non-enumerable field and a
    // Symbol-keyed field are both reached. Guarded for the same reason as the
    // toString read: a Proxy `ownKeys` trap can throw.
    let keys: (string | symbol)[];
    try {
      keys = Reflect.ownKeys(node);
    } catch {
      return;
    }
    for (const key of keys) {
      let child: unknown;
      try {
        child = (node as Record<string | symbol, unknown>)[key];
      } catch {
        continue; // A throwing getter exposes nothing.
      }
      visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return found;
}

/**
 * Coerce a field that is *usually* a string into one for sweeping. A custom
 * error class can carry a non-string `message`, and that value still ends up in
 * a log, so it is rendered rather than skipped or blindly stringified.
 */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return renderings(value).join(" ");
}

/** What one parse attempt exposed: swept strings, plus the codes it reported. */
interface Probe {
  readonly surfaces: readonly Surface[];
  /** Every diagnostic code seen, used to prove the slot reached its code path. */
  readonly codes: ReadonlySet<string>;
}

/** Read a `code` off a diagnostic or a thrown value, if it carries one. */
function codeOf(value: unknown): string | undefined {
  const code = (value as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Collect every diagnostic surface one parse attempt exposes: a thrown value
 * rendered whole plus its `message` and `stack`, every diagnostic the caller's
 * selector returns rendered whole plus its `message`, and every model
 * identifier the caller enumerates.
 */
function sweep<TInput, TParsed>(
  raw: TInput,
  parse: (raw: TInput) => TParsed,
  mode: string,
  options: DiagnosticSurfaceOptions<TInput, TParsed>,
): Probe {
  const surfaces: Surface[] = [];
  const codes = new Set<string>();

  let parsed: TParsed;
  try {
    parsed = parse(raw);
  } catch (err) {
    const thrown = err as { message?: unknown; stack?: unknown };
    surfaces.push({ label: `${mode} err.message`, text: asText(thrown.message) });
    // The stack embeds the message and is what error reporters ship off-box, so
    // it is swept as its own surface rather than assumed to follow the message.
    surfaces.push({ label: `${mode} err.stack`, text: asText(thrown.stack) });
    // The thrown value WHOLE. A throw is not always an Error, and an Error is
    // not only its message: a plain object, a bare string, an `Error.cause`
    // chain, an AggregateError's sub-errors, and any context an error class
    // parks on `this` are all printed by console.error and all missed if only
    // message and stack are read.
    renderings(err).forEach((text, i) => {
      surfaces.push({ label: `${mode} thrown value (rendering ${String(i + 1)})`, text });
    });
    const code = codeOf(err);
    if (code !== undefined) codes.add(code);
    return { surfaces, codes };
  }

  options.getDiagnostics(parsed).forEach((diagnostic, index) => {
    const message = (diagnostic as { message?: unknown }).message;
    if (typeof message === "string") {
      surfaces.push({ label: `${mode} diagnostics[${index}].message`, text: message });
    }
    // The whole diagnostic, every rendering: catches the position object and
    // any other field a consumer might log, not just the message.
    renderings(diagnostic).forEach((text, i) => {
      surfaces.push({
        label: `${mode} diagnostics[${index}] (rendering ${String(i + 1)})`,
        text,
      });
    });
    const code = codeOf(diagnostic);
    if (code !== undefined) codes.add(code);
  });

  options.getModelIdentifiers(parsed).forEach((identifier, index) => {
    surfaces.push({ label: `${mode} model identifier[${index}]`, text: identifier });
  });

  return { surfaces, codes };
}

/** Truncate a surface's text for a failure message, so an error stays readable. */
function excerpt(text: string): string {
  const limit = 120;
  const head = text.length <= limit ? text : `${text.slice(0, limit)}…`;
  return `${JSON.stringify(head)} (${String(text.length)} bytes)`;
}

/**
 * The first marker fragment `text` contains, if any.
 *
 * Matched case-insensitively, because a parser that upper-cases a value before
 * reporting it is still echoing it. `dicom` and `x12` both normalize case on
 * conformance grounds, and a case-sensitive match would go green on exactly
 * that shape: the same defect as the `dicom` generator whose alphabet excluded
 * the byte its leak split on.
 */
function leakedFragment(text: string): string | undefined {
  const haystack = text.toLowerCase();
  return MARKER_FRAGMENTS.find((fragment) => haystack.includes(fragment.toLowerCase()));
}

/**
 * Assert that no consumer-controlled slot echoes into a diagnostic surface: not
 * a diagnostic `message`, not a position object, not `err.message`, not
 * `err.stack`, not the thrown value itself, and not a structural identifier on
 * the model.
 *
 * For every slot the runner plants a short marker and a long one, sweeps both,
 * and fails on the first violation naming the **slot** and the **surface**. It
 * also fails a slot whose declared {@link DiagnosticSlot.expectCode} never
 * appeared, because a probe that did not reach its code path is not evidence of
 * safety.
 *
 * Run it against the unfixed parser first and watch it fail. A PHI suite that
 * has never been seen red is indistinguishable from one that cannot go red.
 *
 * @param options - The slot table, the parser, and the two model selectors.
 * @returns Nothing; it throws an `AssertionError` on the first leaking surface.
 * @example
 * ```ts
 * import { assertNoDiagnosticPhiLeak } from "@cosyte/test-utils";
 * import { parseCcda, WARNING_CODES } from "@cosyte/ccda";
 *
 * assertNoDiagnosticPhiLeak({
 *   slots: [
 *     {
 *       name: "ClinicalDocument/templateId/@root",
 *       plant: (m) => buildDoc({ docTypeOid: m }),
 *       expectCode: WARNING_CODES.UNKNOWN_DOCUMENT_TEMPLATE,
 *     },
 *     {
 *       name: "section/code/@code",
 *       plant: (m) => buildDoc({ sectionCode: m }),
 *       expectCode: WARNING_CODES.UNKNOWN_SECTION_CODE,
 *     },
 *   ],
 *   parse: (raw) => parseCcda(raw),
 *   parseStrict: (raw) => parseCcda(raw, { strict: true }),
 *   getDiagnostics: (doc) => doc.warnings,
 *   getModelIdentifiers: (doc) => doc.sections.map((s) => s.templateId),
 * });
 * ```
 */
export function assertNoDiagnosticPhiLeak<TInput, TParsed>(
  options: DiagnosticSurfaceOptions<TInput, TParsed>,
): void {
  const { slots, parse, parseStrict } = options;
  const largeRepeats = options.largeProbeRepeats ?? 4096;

  assert.ok(
    slots.length > 0,
    "assertNoDiagnosticPhiLeak: `slots` is empty, so the suite asserts nothing. Enumerate every consumer-controlled position in the format.",
  );
  assert.ok(
    largeRepeats > 1,
    "assertNoDiagnosticPhiLeak: `largeProbeRepeats` must exceed 1, or the long probe cannot differ from the short one",
  );

  const shortMarker = PHI_MARKER_UNIT;
  const longMarker = PHI_MARKER_UNIT.repeat(largeRepeats);

  for (const slot of slots) {
    const modes: ReadonlyArray<readonly [string, (raw: TInput) => unknown]> = parseStrict
      ? [
          ["lenient", parse],
          ["strict", parseStrict],
        ]
      : [["lenient", parse]];

    for (const [mode, run] of modes) {
      const cast = run as (raw: TInput) => TParsed;
      const short = sweep(slot.plant(shortMarker), cast, mode, options);
      const long = sweep(slot.plant(longMarker), cast, mode, options);

      // Reach, tied to the SLOT, and asserted in LENIENT mode only.
      //
      // Counting diagnostics would let an unrelated warning stand in for the
      // one this slot is supposed to trigger, leaving the leaking branch
      // unentered and the suite green. But a strict mode typically throws on
      // the FIRST deviation, so only whichever slot happens to be the
      // document's earliest deviation could ever satisfy its code there. Left
      // asserted per-mode, a correct slot reds with a message claiming it never
      // reached its code path, and because this check precedes the sweep it
      // would abort the run and hide a genuine leak in a later slot. Strict
      // keeps its sweep and gives up an assertion it cannot satisfy.
      if (slot.expectCode !== null && mode === "lenient") {
        assert.ok(
          short.codes.has(slot.expectCode),
          `assertNoDiagnosticPhiLeak: slot ${JSON.stringify(slot.name)} never produced ${JSON.stringify(slot.expectCode)} in ${mode} mode, so it did not reach the code path it names and proves nothing about it. Codes seen: [${[...short.codes].join(", ") || "none"}]. Fix the plant so the marker reaches that branch, correct ` +
            "`expectCode`, or set it to `null` deliberately.",
        );
      }

      for (const surface of [...short.surfaces, ...long.surfaces]) {
        const fragment = leakedFragment(surface.text);
        assert.ok(
          fragment === undefined,
          `assertNoDiagnosticPhiLeak: slot ${JSON.stringify(slot.name)} leaked into ${surface.label} (matched ${JSON.stringify(fragment ?? "")}). Build the diagnostic from a registry rather than from the document. Surface: ${excerpt(surface.text)}`,
        );
      }

      if (options.checkLengthInvariance === true) {
        const lengths = (probe: Probe): string =>
          probe.surfaces
            .map((s) => s.text.length)
            .sort((a, b) => a - b)
            .join(",");
        const shortLengths = lengths(short);
        const longLengths = lengths(long);
        assert.equal(
          longLengths,
          shortLengths,
          `assertNoDiagnosticPhiLeak: slot ${JSON.stringify(slot.name)} changed the size of its ${mode} diagnostics when the planted value grew, with no verbatim echo. That is usually a re-encoded or escaped echo, but a diagnostic carrying an input-derived NUMBER (a position column gaining digits, a byte count) grows the same way and is correct: check which before treating this as a leak, and turn \`checkLengthInvariance\` off if it is the latter. Lengths with an ${String(shortMarker.length)}-byte value: [${shortLengths}]; with a ${String(longMarker.length)}-byte value: [${longLengths}].`,
        );
      }
    }
  }
}
