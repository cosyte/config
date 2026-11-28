---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
description: "Parse a {{TITLE}} payload with {{PKG}} and read the warnings the lenient parser reports."
---

# Quickstart

Parse a {{TITLE}} payload and read the result. The parse is lenient by default: input with a known
deviation parses, and the deviation comes back as a warning on the document rather than a thrown
error.

## Parse a payload

```ts runnable
import { parse{{Pascal}} } from "{{PKG}}";

const document = parse{{Pascal}}("ABC|1|2\rDEF|3\r");

document.segments.length; // => 2
document.segments[0]?.fields[1]; // => "1"
document.warnings.length; // => 0
```

## Branch on a warning code

Each warning carries a stable code from `{{PREFIX}}_WARNING_CODES`, so a branch on it keeps
working from one release to the next. The set of codes can grow in any release, so keep a default
branch:

```ts runnable
import { parse{{Pascal}}, {{PREFIX}}_WARNING_CODES } from "{{PKG}}";

const { warnings } = parse{{Pascal}}("ABC|1\r\rDEF|2\r");

let empty = 0;
for (const warning of warnings) {
  switch (warning.code) {
    case {{PREFIX}}_WARNING_CODES.{{PREFIX}}_EMPTY_SEGMENT:
      empty += 1;
      break;
    default:
      break;
  }
}

empty; // => 1
```

## Refuse a deviation

`strict: true` throws a `{{Pascal}}ParseError` at the first warning, with that warning's code:

```ts runnable
import { parse{{Pascal}}, {{Pascal}}ParseError } from "{{PKG}}";

let code: string | undefined;
try {
  parse{{Pascal}}("ABC|1\r\rDEF|2\r", { strict: true });
} catch (error) {
  if (error instanceof {{Pascal}}ParseError) code = error.code;
}

code; // => "{{PREFIX}}_EMPTY_SEGMENT"
```

## Next

- [Handle the warnings a parse reports](./handle-parse-warnings.md).
- [Tolerance and warnings](./tolerance-and-warnings.md): what a parse tolerates, and what throws.
