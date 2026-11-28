---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
description: "Parse a {{TITLE}} payload with {{PKG}} and read the warnings the lenient parser reports."
---

# Quickstart

Parse a {{TITLE}} payload and read the result. The parse is lenient by default: input with a known
deviation parses, and the deviation comes back as a warning rather than a thrown error.

## Parse a payload

```ts runnable
import { parse{{Pascal}} } from "{{PKG}}";

const { warnings } = parse{{Pascal}}("");

warnings.length; // => 0
```

## Branch on a warning code

Each warning carries a stable code from `WARNING_CODES`, so a branch on it keeps working from one
release to the next. The set of codes can grow in any release, so keep a default branch:

```ts runnable
import { parse{{Pascal}}, WARNING_CODES } from "{{PKG}}";

const { warnings } = parse{{Pascal}}("");

let tolerated = 0;
for (const warning of warnings) {
  switch (warning.code) {
    case WARNING_CODES.EXAMPLE_TOLERATED_DEVIATION:
      tolerated += 1;
      break;
    default:
      break;
  }
}

tolerated; // => 0
```

## Next

- [Handle the warnings a parse reports](./handle-parse-warnings.md).
- [Tolerance and warnings](./tolerance-and-warnings.md): what a parse tolerates, and what throws.
