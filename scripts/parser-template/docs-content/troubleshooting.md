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

const codes = parse{{Pascal}}("").warnings.map((warning) => warning.code);

codes; // => []
```

Each warning carries a stable code and a position. [Tolerance and warnings](./tolerance-and-warnings.md)
explains what each tier means.

## A parse threw

In the default lenient mode only a fatal condition throws, with a code from `FATAL_CODES`: input
the parser cannot turn into a structure. Catch the error and branch on its code.

## What to put in a log

A warning's code and position are safe to log, and its message never holds a value from the
payload. Never log the payload itself: it may carry a patient's identity.

## Something is not supported

[Limitations](./limitations.md) lists what this release does not do yet.
