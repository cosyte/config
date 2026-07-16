---
id: quickstart
title: Quickstart
sidebar_position: 1
---

# Quickstart

Parse a {{TITLE}} payload and read the result in a few lines. `{{PKG}}` is **lenient by default**
(Postel's Law): real-world, vendor-quirky input parses into a value plus a list of tolerance
**warnings**, rather than throwing.

## Parse a payload

```ts runnable
import { parse{{Pascal}} } from "{{PKG}}";

// Replace this with a real {{TITLE}} message once the parser lands; on clean input the lenient
// parser recovers nothing, so `warnings` is empty.
const { value, warnings } = parse{{Pascal}}("");

warnings; // => []
```

`parse{{Pascal}}` always returns a `{ value, warnings }` pair. Each warning carries a **stable code**
you can branch on without it churning between releases:

```ts
import { parse{{Pascal}}, WARNING_CODES } from "{{PKG}}";

const { warnings } = parse{{Pascal}}(raw);

for (const w of warnings) {
  if (w.code === WARNING_CODES.EXAMPLE_TOLERATED_DEVIATION) {
    // handle the tolerated deviation
  }
}
```

> **About runnable examples.** The first block above is tagged ```` ```ts runnable ````: the docs
> build extracts it, runs it against the package, and asserts the `// =>` result — so a documented
> example can never silently drift from the code. Tag a fence `runnable` only once its `// =>`
> assertions match the shipped behavior; leave illustrative fragments as a plain ```` ```ts ```` block.

## Next

- [Core Concepts](./concepts-archetype) — the parser archetype and the tolerance model.
- **API Reference** — every export, generated from source.
