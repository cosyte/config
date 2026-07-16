---
id: concepts-archetype
title: The parser archetype
sidebar_position: 1
---

# Core Concepts

`{{PKG}}` follows the shared **cosyte parser archetype** — the same mental model every `@cosyte/*`
parser implements, so what you learn here transfers across the suite. `@cosyte/hl7` is the reference
implementation; this package mirrors its shape.

## Postel's Law: lenient parse, strict emit

The parser is **liberal in what it accepts** and the serializer is **conservative in what it emits**.
Vendor quirks and tolerated deviations don't fail a parse — they become **warnings** — while anything
the serializer produces is spec-clean. A `{ strict: true }` option escalates every tolerated
deviation to a thrown error for callers who want the parse to fail loudly instead.

## The tolerance tiers

Every deviation the parser encounters falls into one of three tiers:

- **Tier 1 — spec-clean.** No deviation; no warning.
- **Tier 2 — recoverable.** A vendor quirk the parser tolerates. It returns a **warning** with a
  stable code and positional context, and keeps going. Never thrown (unless `strict`).
- **Tier 3 — fatal.** Unrecoverable structural corruption. **Always thrown**, even in lenient mode.

## Stable warning + fatal codes

Warnings and fatal errors carry **stable codes** — `WARNING_CODES` (Tier 2) and `FATAL_CODES`
(Tier 3). Consumers branch on these, so a code's name is part of the public contract: renaming or
removing one is a **breaking change**. Codes are `key === value` entries, so the full set survives an
`Object.values(...)` snapshot into a stability tripwire.

> **Status:** the code registries currently hold placeholder entries; the real codes are added as the
> parser grows, phase by phase. See the **API Reference** for the exact set this release ships.

## Immutability

Parsed values are immutable by default; mutation happens only through explicit methods. This keeps a
parsed document safe to share across a pipeline without defensive copying.
