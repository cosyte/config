# {{PKG}}

> {{TITLE}} parser, serializer, and builder for Node.js and TypeScript — **lenient on parse,
> spec-clean on emit**.

`{{PKG}}` is a zero-dependency TypeScript toolkit that follows the cosyte parser archetype: a lenient
parser that turns real-world, vendor-quirky input into **warnings** rather than failures, paired with
a serializer that always emits spec-clean output (Postel's Law). It mirrors the API shape of the
reference parser, [`@cosyte/hl7`](https://github.com/cosyte/hl7).

> **Status:** pre-alpha (`0.0.x`), not yet published to npm. The public API below is the scaffold;
> the real parser lands in subsequent phases.

## Install

```bash
npm install {{PKG}}
```

## Parse

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const result = parse{{Pascal}}(raw);

result.warnings; // stable, positional tolerance warnings (never throws on quirks)
```

The parser is **lenient by default** — vendor quirks become warnings, not failures. A
`{ strict: true }` mode (to be added) escalates every tolerated deviation to a thrown error.

## The cosyte parser archetype

- **Postel's Law** — liberal parser (lenient default + warnings), conservative serializer (always
  spec-clean), so quirks don't propagate downstream on round-trip.
- **Tiered tolerance** — Tier 0/1 silent, Tier 2 warning + recovery (escalates in strict mode),
  Tier 3 fatal always.
- **Stable warning codes** — warnings carry stable string codes + positional context; consumers
  branch on `w.code`, so renaming a code is a breaking change.
- **Zero runtime dependencies** — Node stdlib only (healthcare integrations vet every dependency).
- **Dual ESM + CJS** — built with `tsup`, validated with `attw`.
- **Immutability** — parsed models are immutable; mutation is via explicit methods.
- **Profile system** — a `defineProfile()` API for vendor quirks (to be added), with built-in
  profiles authored through the same public API.

## License

MIT © Cosyte
