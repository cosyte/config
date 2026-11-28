---
id: troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
description: "Common symptoms when integrating {{PKG}}, and how to read what the parser reports."
---

# Troubleshooting

Common symptoms when integrating `{{PKG}}`, and how to read what the parser reports.

## The parse succeeded but the result looks wrong

The parse is lenient, so a surprising result usually comes with a warning. Read the codes first:

```ts runnable
import { parse{{Pascal}} } from "{{PKG}}";

const codes = parse{{Pascal}}("ABC|1\r\rDEF|2\r").warnings.map((warning) => warning.code);

codes; // => ["{{PREFIX}}_EMPTY_SEGMENT"]
```

Each warning carries a stable code and a position. [Tolerance and warnings](./tolerance-and-warnings.md)
explains what each tier means.

## A parse threw

In the default lenient mode only a fatal condition throws: a `{{Pascal}}ParseError` with a code
from `{{PREFIX}}_FATAL_CODES`, for an empty payload or bytes that are not UTF-8. Under
`strict: true` the first warning throws the same error with the warning's code. Catch the error and
branch on its code.

## What to put in a log

A warning's code and position are safe to log, and its message never holds a value from the
payload. Never log the payload itself: it may carry a patient's identity.

## Something is not supported

[Limitations](./limitations.md) lists what this release does not do yet.
