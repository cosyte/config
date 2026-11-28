---
id: parse-your-first-message
title: Parse your first message
sidebar_label: Parse your first message
description: "A first session with {{PKG}}: install it, parse a payload, and read the warnings it reports."
---

# Parse your first message

In this tutorial we install `{{PKG}}`, parse a payload, and read what the parse reports. It takes a
new project and Node.js 22 or later.

## 1. Install the package

```bash
npm install --save-exact {{PKG}}
```

## 2. Parse a payload

`parse{{Pascal}}` takes the payload as text or as UTF-8 bytes and returns a frozen document: its
segments, each with its fields as written, and the warnings the parse recorded:

```ts runnable
import { parse{{Pascal}} } from "{{PKG}}";

const document = parse{{Pascal}}("ABC|1|2\r");

document.segments[0]?.id; // => "ABC"
document.segments[0]?.fields; // => ["ABC", "1", "2"]
```

## 3. Read the warnings

A warning says where the parser tolerated a deviation and which rule it applied, by code. It never
quotes the payload, so a warning is safe to count, store, or send to a log:

```ts runnable
import { parse{{Pascal}} } from "{{PKG}}";

const codes = parse{{Pascal}}("ABC|1\r\rabc\r").warnings.map((warning) => warning.code);

codes; // => ["{{PREFIX}}_EMPTY_SEGMENT", "{{PREFIX}}_MALFORMED_SEGMENT_ID"]
```

## What you built

A parse of a payload, and a list of the warning codes it reported.

## Next

- [Handle the warnings a parse reports](./handle-parse-warnings.md).
- [Tolerance and warnings](./tolerance-and-warnings.md).
