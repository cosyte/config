---
id: handle-parse-warnings
title: Handle the warnings a parse reports
sidebar_label: Handle parse warnings
description: "Decide per warning code whether a payload is accepted, flagged for review, or refused, without logging its content."
---

# Handle the warnings a parse reports

A lenient parse returns a result for a payload with a deviation in it, and lists the deviation as a
warning. This guide sorts a parse's warnings into the ones you accept and the ones you refuse.

## Steps

1. Parse the payload with `parse{{Pascal}}`.
2. Name the codes you accept. Treat every other code as a refusal, so a code added in a later
   release is refused until you decide about it.
3. Keep the codes, never the payload, in what you record.

```ts runnable
import { parse{{Pascal}}, {{PREFIX}}_WARNING_CODES as CODES } from "{{PKG}}";
import type { {{Pascal}}WarningCode } from "{{PKG}}";

const accepted = new Set<{{Pascal}}WarningCode>([CODES.{{PREFIX}}_EMPTY_SEGMENT]);

const { warnings } = parse{{Pascal}}("ABC|1\r\rabc\r");
const refused = warnings.filter((warning) => !accepted.has(warning.code));

refused.map((warning) => warning.code); // => ["{{PREFIX}}_MALFORMED_SEGMENT_ID"]
```

[Tolerance and warnings](./tolerance-and-warnings.md) explains which deviations warn and which
throw.
