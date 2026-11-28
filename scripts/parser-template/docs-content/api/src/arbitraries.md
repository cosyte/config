# src/arbitraries

fast-check generators for {{TITLE}} payload text, at `{{PKG}}/arbitraries`. We use them to test
this library, and you can use them to test code you build on it.

`fast-check` is an optional peer dependency: install it to use this entry point. The main entry
point, `{{PKG}}`, never loads it.

Every generated value is synthetic and random: segment identifiers and short runs of letters and
digits, nothing shaped like a person's name, a date of birth or an identifier.

## Example

```ts
import fc from "fast-check";
import { parse{{Pascal}}, serialize{{Pascal}} } from "{{PKG}}";
import { specClean{{Pascal}}Text } from "{{PKG}}/arbitraries";

fc.assert(
  fc.property(specClean{{Pascal}}Text(), (raw) => serialize{{Pascal}}(parse{{Pascal}}(raw)) === raw),
);
```

## Functions

### hostile{{Pascal}}Text()

> **hostile{{Pascal}}Text**(): `Arbitrary`\<`string`\>

Hostile input: any string, a string drawn mostly from separators and terminators, or a messy
payload. A lenient parse of any of them throws only a fatal code.

#### Returns

`Arbitrary`\<`string`\>

The generator.

#### Example

```ts
import fc from "fast-check";
import { hostile{{Pascal}}Text } from "{{PKG}}/arbitraries";

typeof fc.sample(hostile{{Pascal}}Text(), 1)[0]; // => "string"
```

***

### messy{{Pascal}}Text()

> **messy{{Pascal}}Text**(): `Arbitrary`\<`string`\>

A payload with the deviations the parser tolerates: empty segments and segments that do not
begin with an identifier, around at least one spec-clean segment. It parses without throwing.

#### Returns

`Arbitrary`\<`string`\>

The generator.

#### Example

```ts
import fc from "fast-check";
import { parse{{Pascal}} } from "{{PKG}}";
import { messy{{Pascal}}Text } from "{{PKG}}/arbitraries";

const [raw = "ABC"] = fc.sample(messy{{Pascal}}Text(), 1);
parse{{Pascal}}(raw).segments.length > 0; // => true
```

***

### segment()

> **segment**(): `Arbitrary`\<`string`\>

A spec-clean segment: an identifier and up to six fields of letters, digits, spaces, dots and
hyphens, joined by `|`.

#### Returns

`Arbitrary`\<`string`\>

The generator.

#### Example

```ts
import fc from "fast-check";
import { segment } from "{{PKG}}/arbitraries";

/^[A-Z][A-Z0-9]{2}/.test(fc.sample(segment(), 1)[0] ?? ""); // => true
```

***

### segmentId()

> **segmentId**(): `Arbitrary`\<`string`\>

A segment identifier: an upper-case letter, then two upper-case letters or digits.

#### Returns

`Arbitrary`\<`string`\>

The generator.

#### Example

```ts
import fc from "fast-check";
import { segmentId } from "{{PKG}}/arbitraries";

fc.sample(segmentId(), 1)[0]?.length; // => 3
```

***

### specClean{{Pascal}}Text()

> **specClean{{Pascal}}Text**(): `Arbitrary`\<`string`\>

A spec-clean payload: one to eight segments, each ended with `\r` or with the last one left
open. It parses with no warning.

#### Returns

`Arbitrary`\<`string`\>

The generator.

#### Example

```ts
import fc from "fast-check";
import { parse{{Pascal}} } from "{{PKG}}";
import { specClean{{Pascal}}Text } from "{{PKG}}/arbitraries";

const [raw = "ABC"] = fc.sample(specClean{{Pascal}}Text(), 1);
parse{{Pascal}}(raw).warnings.length; // => 0
```
