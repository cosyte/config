import { describe, expect, it } from "vitest";

import { assertNoDiagnosticPhiLeak, PHI_MARKER_UNIT } from "../src/index.js";

/**
 * Positive controls for the diagnostic-surface runner, every one of them
 * **constructed here** rather than borrowed from a real parser. A control taken
 * from elsewhere can quietly fail to contain what the scanner hunts, in which
 * case it returns clean and proves nothing: which is precisely the failure the
 * runner exists to catch.
 *
 * Each fake below leaks through exactly one surface, and each control asserts
 * the failure it names rather than any failure. A control that reds for the
 * wrong reason is indistinguishable from one that works, so where a mechanism
 * needs isolating (truncation, `err.stack`, re-encoding) the fake is built so
 * that only that mechanism can fire.
 */

const CODE = "UNKNOWN_DOC_TYPE";

/** Pull the planted value back out of a fake input. */
function typeOf(raw: string): string {
  return /^type=([^;]*)/.exec(raw)?.[1] ?? "";
}

/** The one consumer-controlled slot every fake here reads: a document type code. */
const slots = [{ name: "doc/@type", plant: (m: string) => `type=${m};body=x`, expectCode: CODE }];

interface FakeWarning {
  readonly code: string;
  readonly message: string;
  readonly position?: unknown;
  readonly context?: unknown;
}

interface FakeDoc {
  readonly warnings: readonly FakeWarning[];
  readonly declaredType: string;
}

/** The shape that holds: the message is a literal, the value stays on the model. */
function cleanParse(raw: string): FakeDoc {
  return {
    warnings: [
      {
        code: CODE,
        message: "Document type is not recognized; parsed as a generic document.",
        position: { offset: 0 },
      },
    ],
    declaredType: typeOf(raw),
  };
}

/** Defaults every case shares, so each test states only what it is probing. */
const base = {
  slots,
  parseStrict: null,
  getDiagnostics: (doc: FakeDoc) => doc.warnings,
  // declaredType is a VALUE the model is meant to carry, not a structural
  // identifier, so the identifier list is legitimately empty here.
  getModelIdentifiers: () => [],
};

/** Build a parser whose single warning message is `render(plantedValue)`. */
function messageEcho(render: (value: string) => string) {
  return (raw: string): FakeDoc => ({
    warnings: [{ code: CODE, message: render(typeOf(raw)) }],
    declaredType: typeOf(raw),
  });
}

describe("assertNoDiagnosticPhiLeak", () => {
  it("passes for a parser whose message comes from a registry, not the document", () => {
    expect(() => assertNoDiagnosticPhiLeak({ ...base, parse: cleanParse })).not.toThrow();
  });

  it("FAILS naming the slot and the message when the factory interpolates the value", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: messageEcho((v) => `Document type "${v}" is not recognized.`),
      }),
    ).toThrow(/slot "doc\/@type" leaked into lenient diagnostics\[0\]\.message/);
  });

  it("FAILS on the position object even when the message itself is clean", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => ({
          warnings: [
            {
              code: CODE,
              message: "Document type is not recognized.",
              // The message is a literal, but the context object carries the
              // bytes: a consumer logging the whole warning still leaks.
              position: { offset: 0, near: typeOf(raw) },
            },
          ],
          declaredType: typeOf(raw),
        }),
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\] \(rendering \d\)/);
  });

  it("FAILS on an Error-valued field, which JSON.stringify renders as {}", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => ({
          warnings: [
            {
              code: CODE,
              message: "Document type is not recognized.",
              // JSON.stringify(new Error(x)) is "{}" because message is
              // non-enumerable, so a JSON-only sweep is blind to this while
              // console.error prints it in full.
              context: new Error(`near ${typeOf(raw)}`),
            },
          ],
          declaredType: typeOf(raw),
        }),
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\] \(rendering \d\)/);
  });

  it("FAILS on a nested toString, which neither summary rendering shows", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => ({
          warnings: [
            {
              code: CODE,
              message: "Document type is not recognized.",
              // inspect prints `{ offset: 0, toString: [Function] }` and
              // JSON.stringify prints `{"offset":0}`, but a consumer writing
              // `${w.position}` gets the value.
              position: {
                offset: 0,
                toString: () => `near ${typeOf(raw)}`,
              },
            },
          ],
          declaredType: typeOf(raw),
        }),
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\]/);
  });

  it("FAILS on byte-valued context, the natural shape for mllp, dicom, x12 and hl7", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => ({
          warnings: [
            {
              code: CODE,
              message: "Document type is not recognized.",
              // Renders as `<Buffer 5a 71 ...>` and as a JSON data array:
              // neither contains the marker, and a consumer decoding it does.
              context: Buffer.from(typeOf(raw), "utf8"),
            },
          ],
          declaredType: typeOf(raw),
        }),
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\]/);
  });

  it("FAILS past inspect's truncation ceiling, where the summary says '... more items'", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => {
          const context = new Map<number, string>();
          for (let i = 0; i < 104; i += 1) context.set(i, "filler");
          // Past inspect's 100-entry default, so the summary elides it.
          context.set(104, `near ${typeOf(raw)}`);
          return {
            warnings: [{ code: CODE, message: "Document type is not recognized.", context }],
            declaredType: typeOf(raw),
          };
        },
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\]/);
  });

  it("FAILS on a case-folded echo, which dicom and x12 normalization would produce", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: messageEcho((v) => `Document type "${v.toUpperCase()}" is not recognized.`),
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\]\.message/);
  });

  it("does NOT assert reach in strict mode, which throws on the first deviation", () => {
    // A strict mode aborts on the document's earliest deviation, so only one
    // slot could ever satisfy its own code there. Asserting per-mode reds a
    // correct slot with a false message, and because reach precedes the sweep
    // it would abort the run and hide a genuine leak in a later slot.
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: cleanParse,
        parseStrict: (): never => {
          throw Object.assign(new Error("strict: an earlier, unrelated deviation"), {
            code: "SOME_OTHER_CODE",
          });
        },
      }),
    ).not.toThrow();
  });

  it("FAILS on a thrown plain object, which has neither message nor stack", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => {
          // Throwing a non-Error is the whole point of this control: such a
          // value has neither `message` nor `stack`, so it is invisible to a
          // sweep that reads only those two fields.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw { code: CODE, detail: `near ${typeOf(raw)}` };
        },
      }),
    ).toThrow(/leaked into lenient thrown value \(rendering \d\)/);
  });

  it("FAILS on an Error.cause chain, which err.message and err.stack do not show", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => {
          throw Object.assign(
            new Error("strict: unrecognized document type", {
              cause: new Error(`near ${typeOf(raw)}`),
            }),
            { code: CODE },
          );
        },
      }),
    ).toThrow(/leaked into lenient thrown value \(rendering \d\)/);
  });

  it("FAILS on err.stack specifically, with a message that cannot be the cause", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: cleanParse,
        parseStrict: (raw: string): never => {
          // The value is written ONLY into the stack, so this control cannot
          // pass by way of err.message or the whole-value rendering finding it
          // somewhere else first: it isolates the stack sweep.
          const err = Object.assign(new Error("strict: unrecognized document type"), {
            code: CODE,
          });
          err.stack = `Error: strict: unrecognized document type [near ${typeOf(raw)}]`;
          throw err;
        },
      }),
    ).toThrow(/leaked into strict err\.stack/);
  });

  it("FAILS a truncating fix, on a remnant far too short to be the whole marker", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        // Truncated to 5 bytes: shorter than the 8-byte marker unit, so this
        // can only red via fragment matching. A whole-unit check would pass it,
        // and a 5-byte remnant is still a postal-code prefix.
        parse: messageEcho((v) => `Document type "${v.slice(0, 5)}" is not recognized.`),
      }),
    ).toThrow(/leaked into lenient diagnostics\[0\]\.message \(matched "\w{4}"\)/);
  });

  it("passes a truncation below the detection floor, which is a documented limit", () => {
    // Three bytes is under MIN_DETECTED_FRAGMENT. This is NOT an endorsement:
    // the runner cannot see it, and the test exists so the limit is stated in
    // executable form rather than only in prose.
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: messageEcho((v) => `Document type "${v.slice(0, 3)}" is not recognized.`),
      }),
    ).not.toThrow();
  });

  it("does NOT fail a clean parser whose position number grows with the input", () => {
    // The regression that made length invariance opt-in: a column offset gains
    // digits as the value before it lengthens. Nothing is echoed, and the
    // runner must stay green or adopters learn to disable it.
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): FakeDoc => ({
          warnings: [
            {
              code: CODE,
              message: "Document type is not recognized.",
              position: { offset: raw.length },
            },
          ],
          declaredType: typeOf(raw),
        }),
      }),
    ).not.toThrow();
  });

  it("FAILS a re-encoded echo on length, but only when that check is asked for", () => {
    // Hex-encoding destroys the marker but not the flow of input into the
    // message. A real mllp regression did exactly this.
    const hexEcho = {
      ...base,
      parse: messageEcho(
        (v) => `Document type 0x${Buffer.from(v, "utf8").toString("hex")} is not recognized.`,
      ),
    };
    expect(() => assertNoDiagnosticPhiLeak(hexEcho)).not.toThrow();
    expect(() => assertNoDiagnosticPhiLeak({ ...hexEcho, checkLengthInvariance: true })).toThrow(
      /changed the size of its lenient diagnostics/,
    );
  });

  it("FAILS on a model identifier, the layering case that hl7's message fix did not close", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        // Messages are clean. The unbounded value sits on the model, where a
        // downstream package interpolates it to build its own diagnostics.
        parse: cleanParse,
        getModelIdentifiers: (doc: FakeDoc) => [doc.declaredType],
      }),
    ).toThrow(/leaked into lenient model identifier\[0\]/);
  });

  it("FAILS when the slot never reached the code path it names", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        // Never warns: the marker went in and nothing came out. Under a
        // count-the-diagnostics check this is a pass.
        parse: (raw: string): FakeDoc => ({ warnings: [], declaredType: typeOf(raw) }),
      }),
    ).toThrow(/never produced "UNKNOWN_DOC_TYPE" in lenient mode/);
  });

  it("FAILS when an UNRELATED diagnostic stands in for the slot's own", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        // A diagnostic IS produced, so any reach check that merely counts is
        // satisfied while the leaking branch was never entered. This is the
        // audit's central failure, reproduced against the antidote.
        parse: (raw: string): FakeDoc => ({
          warnings: [{ code: "MISSING_TITLE", message: "The document has no title." }],
          declaredType: typeOf(raw),
        }),
      }),
    ).toThrow(/never produced "UNKNOWN_DOC_TYPE".*Codes seen: \[MISSING_TITLE\]/s);
  });

  it("allows a slot's reach to be waived deliberately, and only deliberately", () => {
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        slots: slots.map((slot) => ({ ...slot, expectCode: null })),
        parse: (raw: string): FakeDoc => ({ warnings: [], declaredType: typeOf(raw) }),
      }),
    ).not.toThrow();
  });

  it("sweeps a second diagnostic collection when the model exposes one", () => {
    interface TwoLists extends FakeDoc {
      readonly errors: readonly FakeWarning[];
    }
    expect(() =>
      assertNoDiagnosticPhiLeak({
        ...base,
        parse: (raw: string): TwoLists => ({
          ...cleanParse(raw),
          // Clean `warnings`, leaking `errors`. A default selector reading only
          // `.warnings` would report this green.
          errors: [{ code: "FATAL_TYPE", message: `Bad type "${typeOf(raw)}".` }],
        }),
        getDiagnostics: (doc: TwoLists) => [...doc.warnings, ...doc.errors],
      }),
    ).toThrow(/leaked into lenient diagnostics\[1\]\.message/);
  });

  it("survives hostile diagnostic shapes instead of aborting the run", () => {
    // A throw out of the sweep aborts at this slot, so a real leak in a LATER
    // slot would never be reported. None of these carry the marker; the
    // assertion is that the runner completes rather than crashing.
    const hostile: Array<() => unknown> = [
      () => {
        const view = new Uint8Array(new ArrayBuffer(8));
        structuredClone(view.buffer, { transfer: [view.buffer] }); // detach
        return view;
      },
      () =>
        new Proxy(
          {},
          {
            get: () => {
              throw new Error("hostile get");
            },
          },
        ),
      () =>
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error("hostile ownKeys");
            },
          },
        ),
      (): unknown => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
      () => ({
        [Symbol.for("nodejs.util.inspect.custom")]: () => {
          throw new Error("hostile");
        },
      }),
      (): unknown => Object.create(null) as unknown,
      () => ({
        get boom(): string {
          throw new Error("hostile getter");
        },
      }),
    ];

    for (const [index, make] of hostile.entries()) {
      expect(
        () =>
          assertNoDiagnosticPhiLeak({
            ...base,
            parse: (raw: string): FakeDoc => ({
              warnings: [
                { code: CODE, message: "Document type is not recognized.", context: make() },
              ],
              declaredType: typeOf(raw),
            }),
          }),
        `hostile shape #${String(index)}`,
      ).not.toThrow();
    }
  });

  it("rejects an empty slot table, which would assert nothing", () => {
    expect(() => assertNoDiagnosticPhiLeak({ ...base, slots: [], parse: cleanParse })).toThrow(
      /`slots` is empty/,
    );
  });

  it("exports a marker unit whose every four-byte run is distinctive", () => {
    expect(PHI_MARKER_UNIT).toHaveLength(8);
    const doubled = PHI_MARKER_UNIT.repeat(2);
    const runs = new Set<string>();
    for (let i = 0; i + 4 <= doubled.length; i += 1) runs.add(doubled.slice(i, i + 4));
    // Eight distinct four-grams, one per offset in the unit: a truncation at
    // any offset still leaves a run the sweep recognizes.
    expect(runs.size).toBe(8);
  });
});
