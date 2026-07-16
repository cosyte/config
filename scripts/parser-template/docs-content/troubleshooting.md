---
id: troubleshooting
title: Troubleshooting
sidebar_position: 1
---

# Troubleshooting

Common symptoms when integrating `{{PKG}}`, and how to read what the parser is telling you.

## The parse "succeeded" but the result looks wrong

`{{PKG}}` is lenient — it recovers from vendor quirks rather than throwing. That means a surprising
result usually comes with an explanation in `warnings`. Inspect them first:

```ts
const { value, warnings } = parse{{Pascal}}(raw);

for (const w of warnings) {
  console.warn(w.code, w.message, w.position);
}
```

Each warning carries a **stable code** (`WARNING_CODES`) and positional context. If a deviation
should be a hard failure for your integration, re-parse with `{ strict: true }` to have it thrown
instead.

## A parse threw

Only **Tier-3 fatal** conditions (`FATAL_CODES`) throw in lenient mode — these mark input the parser
cannot recover into a structured result. In `{ strict: true }` mode, any tolerated deviation throws
too. Catch and inspect the error's code to tell the two apart.

## Warning messages and logs

Warning `message` fields are safe to log — they **never contain PHI**. Never log the raw payload
itself; it may carry protected health information.

## Known limitations

> **Status:** `{{PKG}}` is a pre-alpha scaffold. `parse{{Pascal}}` currently returns a structural stub
> (`{ value: {}, warnings: [] }`); the real lenient tokenizer, immutable model, serializer, and the
> full warning/fatal code sets land in subsequent phases.

- **`string` input only** for now — `Buffer` / `Uint8Array` support arrives with the real parser.
- **Placeholder code registries** — `WARNING_CODES` / `FATAL_CODES` hold example entries until the
  parser populates the real ones.
- **No serializer yet** — the spec-clean emit side is added in a later phase.

The **API Reference** always reflects exactly what this release ships — treat it as the source of
truth over any prose above.
