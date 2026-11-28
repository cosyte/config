# src

`{{PKG}}`: our {{TITLE}} parser. A parse is lenient by default and returns a deep-frozen document
with the warnings on it; `strict: true` throws at the first warning instead. A vendor profile
shapes the parse, and the serializer writes back what was read. Generators for property tests
are at `{{PKG}}/arbitraries`.

## Classes

### {{Pascal}}ParseError

The error a parse throws: on a fatal code in every mode, and on the first warning under
`strict: true`, with that warning's code. It carries a code and a position, never a snippet of
the payload.

#### Example

```ts
import { parse{{Pascal}}, {{Pascal}}ParseError } from "{{PKG}}";

let caught: unknown;
try {
  parse{{Pascal}}("ABC|1\r\rDEF|2", { strict: true });
} catch (error) {
  caught = error;
}
caught instanceof {{Pascal}}ParseError && caught.code; // => "{{PREFIX}}_EMPTY_SEGMENT"
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new {{Pascal}}ParseError**(`code`, `message`, `position`): [`{{Pascal}}ParseError`](#{{SLUG}}parseerror)

###### Parameters

###### code

[`{{Pascal}}FatalCode`](#{{SLUG}}fatalcode) \| [`{{Pascal}}WarningCode`](#{{SLUG}}warningcode-1)

The fatal or warning code.

###### message

`string`

The code's message.

###### position

[`{{Pascal}}Position`](#{{SLUG}}position)

Where the parse stopped.

###### Returns

[`{{Pascal}}ParseError`](#{{SLUG}}parseerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`{{Pascal}}FatalCode`](#{{SLUG}}fatalcode) \| [`{{Pascal}}WarningCode`](#{{SLUG}}warningcode-1)

A fatal code, or under `strict: true` the code of the warning that stopped the parse.

##### position

> `readonly` **position**: [`{{Pascal}}Position`](#{{SLUG}}position)

Where the parse stopped.

***

### {{Pascal}}ProfileError

The error `define{{Pascal}}Profile` throws for a definition it refuses.

#### Example

```ts
import { define{{Pascal}}Profile, {{Pascal}}ProfileError } from "{{PKG}}";

let caught: unknown;
try {
  define{{Pascal}}Profile({ name: "vendor", fieldSeparator: "\r" });
} catch (error) {
  caught = error;
}
caught instanceof {{Pascal}}ProfileError && caught.code; // => "{{PREFIX}}_INVALID_FIELD_SEPARATOR"
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new {{Pascal}}ProfileError**(`code`): [`{{Pascal}}ProfileError`](#{{SLUG}}profileerror)

###### Parameters

###### code

[`{{Pascal}}ProfileCode`](#{{SLUG}}profilecode)

Why the definition was refused.

###### Returns

[`{{Pascal}}ProfileError`](#{{SLUG}}profileerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`{{Pascal}}ProfileCode`](#{{SLUG}}profilecode)

Why the definition was refused.

## Interfaces

### {{Pascal}}Document

A parsed {{TITLE}} payload: its segments, the separators it was read with, and the warnings the
lenient parse recorded. Deep-frozen: nothing in it can be changed in place.

#### Example

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const document = parse{{Pascal}}("ABC|1\rDEF|2\r");
document.segments.length; // => 2
document.trailingTerminator; // => true
document.warnings.length; // => 0
```

#### Properties

##### fieldSeparator

> `readonly` **fieldSeparator**: `string`

The field separator the payload was read with.

##### segments

> `readonly` **segments**: readonly [`{{Pascal}}Segment`](#{{SLUG}}segment)[]

The segments, in the order the payload holds them.

##### trailingTerminator

> `readonly` **trailingTerminator**: `boolean`

Whether the payload ended with a segment terminator.

##### warnings

> `readonly` **warnings**: readonly [`{{Pascal}}Warning`](#{{SLUG}}warning)[]

What the lenient parse tolerated, in the order it was found.

***

### {{Pascal}}ParseOptions

Options for [parse{{Pascal}}](#parse{{SLUG}}).

#### Example

```ts
import type { {{Pascal}}ParseOptions } from "{{PKG}}";

const options: {{Pascal}}ParseOptions = { strict: true };
```

#### Properties

##### onWarning?

> `readonly` `optional` **onWarning?**: (`warning`) => `void`

Called once for each warning, in the order they are found, after the warning is recorded. A
handler that throws does not fail the parse.

###### Parameters

###### warning

[`{{Pascal}}Warning`](#{{SLUG}}warning)

###### Returns

`void`

##### profile?

> `readonly` `optional` **profile?**: [`{{Pascal}}Profile`](#{{SLUG}}profile)

The vendor profile to read the payload with. Default: `|` between fields.

##### strict?

> `readonly` `optional` **strict?**: `boolean`

Throw a `{{Pascal}}ParseError` at the first warning, with that warning's code, rather than
record it. For a sender you trust to be spec-clean. Default `false`.

***

### {{Pascal}}Position

Where a warning or an error points in a {{TITLE}} payload.

`segmentIndex` counts segments from 0 in the order they appear: an index we assign to count
occurrences, not a number the standard assigns. A field number, where one is added, is the
standard's own and counts from 1.

#### Example

```ts
import type { {{Pascal}}Position } from "{{PKG}}";

const first: {{Pascal}}Position = { segmentIndex: 0 };
```

#### Properties

##### segmentIndex

> `readonly` **segmentIndex**: `number`

The segment, counted from 0 in the order the payload holds them.

***

### {{Pascal}}Profile

A vendor profile: how one sender's payloads are read. A profile shapes the parse; it never
removes a warning from the result. Deep-frozen.

#### Example

```ts
import { define{{Pascal}}Profile } from "{{PKG}}";

define{{Pascal}}Profile({ name: "vendor-a" }).fieldSeparator; // => "|"
```

#### Properties

##### fieldSeparator

> `readonly` **fieldSeparator**: `string`

The field separator payloads read with this profile use.

##### name

> `readonly` **name**: `string`

The profile's name.

***

### {{Pascal}}ProfileInput

What a profile definition takes.

#### Example

```ts
import type { {{Pascal}}ProfileInput } from "{{PKG}}";

const input: {{Pascal}}ProfileInput = { name: "vendor-a", fieldSeparator: "^" };
```

#### Properties

##### fieldSeparator?

> `readonly` `optional` **fieldSeparator?**: `string`

The field separator the sender uses, when it is not `|`. One character, not `\r`.

##### name

> `readonly` **name**: `string`

A name for the profile: 1 to 64 letters, digits, `.`, `_` or `-`.

***

### {{Pascal}}Segment

One segment of a parsed {{TITLE}} payload: the text between two segment terminators, split on the
field separator.

`fields` holds every piece as written, so `fields[0]` is the piece before the first separator and
`fields[n]` is field `n`, numbered from 1 as the standard numbers it. `id` is that first piece
when it has the shape of a segment identifier, and is absent otherwise: a structural name on the
model never carries text that failed its shape test, since a caller may build a message from it.

#### Example

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const [segment] = parse{{Pascal}}("ABC|1|2").segments;
segment?.id; // => "ABC"
segment?.fields[2]; // => "2"
```

#### Properties

##### fields

> `readonly` **fields**: readonly `string`[]

Every piece of the segment as written; `fields[0]` is the identifier's piece.

##### id?

> `readonly` `optional` **id?**: `string`

The segment identifier, present only when `fields[0]` has the identifier's shape.

***

### {{Pascal}}SerializeOptions

Options for [serialize{{Pascal}}](#serialize{{SLUG}}).

#### Example

```ts
import type { {{Pascal}}SerializeOptions } from "{{PKG}}";

const options: {{Pascal}}SerializeOptions = { normalize: true };
```

#### Properties

##### normalize?

> `readonly` `optional` **normalize?**: `boolean`

Write the normal form rather than what was read: segments that hold no text dropped, trailing
empty fields dropped, and every segment ended with the terminator. Default `false`.

***

### {{Pascal}}Warning

What a lenient parse tolerated: plain, frozen data with a stable code, a message from that
code's registry entry, and a position. It is never an `Error`, and it never carries a value from
the payload.

#### Example

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const [warning] = parse{{Pascal}}("ABC|1\r\rDEF|2").warnings;
warning?.position.segmentIndex; // => 1
```

#### Properties

##### code

> `readonly` **code**: [`{{Pascal}}WarningCode`](#{{SLUG}}warningcode-1)

The stable code.

##### message

> `readonly` **message**: `string`

A sentence from the code's registry entry. It holds no value from the payload.

##### position

> `readonly` **position**: [`{{Pascal}}Position`](#{{SLUG}}position)

Where the deviation is.

## Type Aliases

### {{Pascal}}FatalCode

> **{{Pascal}}FatalCode** = *typeof* [`{{PREFIX}}_FATAL_CODES`](#{{PREFIX_LOWER}}_fatal_codes)\[keyof *typeof* [`{{PREFIX}}_FATAL_CODES`](#{{PREFIX_LOWER}}_fatal_codes)\]

A value from [{{PREFIX_MD}}\_FATAL\_CODES](#{{PREFIX_LOWER}}_fatal_codes).

#### Example

```ts
import type { {{Pascal}}FatalCode } from "{{PKG}}";

const code: {{Pascal}}FatalCode = "{{PREFIX}}_EMPTY_INPUT";
```

***

### {{Pascal}}ProfileCode

> **{{Pascal}}ProfileCode** = *typeof* [`{{PREFIX}}_PROFILE_CODES`](#{{PREFIX_LOWER}}_profile_codes)\[keyof *typeof* [`{{PREFIX}}_PROFILE_CODES`](#{{PREFIX_LOWER}}_profile_codes)\]

A value from [{{PREFIX_MD}}\_PROFILE\_CODES](#{{PREFIX_LOWER}}_profile_codes).

#### Example

```ts
import type { {{Pascal}}ProfileCode } from "{{PKG}}";

const code: {{Pascal}}ProfileCode = "{{PREFIX}}_INVALID_PROFILE_NAME";
```

***

### {{Pascal}}WarningCode

> **{{Pascal}}WarningCode** = *typeof* [`{{PREFIX}}_WARNING_CODES`](#{{PREFIX_LOWER}}_warning_codes)\[keyof *typeof* [`{{PREFIX}}_WARNING_CODES`](#{{PREFIX_LOWER}}_warning_codes)\]

A value from [{{PREFIX_MD}}\_WARNING\_CODES](#{{PREFIX_LOWER}}_warning_codes).

#### Example

```ts
import type { {{Pascal}}WarningCode } from "{{PKG}}";

const code: {{Pascal}}WarningCode = "{{PREFIX}}_EMPTY_SEGMENT";
```

## Variables

### {{PREFIX_MD}}\_FATAL\_CODES

> `const` **{{PREFIX_MD}}\_FATAL\_CODES**: `object`

The fatal codes: input a parse cannot turn into a structure, which throws in every mode. Each
key equals its value. The set is open, as the warning codes are.

#### Type Declaration

##### {{PREFIX_MD}}\_EMPTY\_INPUT

> `readonly` **{{PREFIX_MD}}\_EMPTY\_INPUT**: `"{{PREFIX}}_EMPTY_INPUT"` = `"{{PREFIX}}_EMPTY_INPUT"`

The payload holds no characters at all.

##### {{PREFIX_MD}}\_INVALID\_UTF8

> `readonly` **{{PREFIX_MD}}\_INVALID\_UTF8**: `"{{PREFIX}}_INVALID_UTF8"` = `"{{PREFIX}}_INVALID_UTF8"`

The payload was given as bytes that are not UTF-8.

#### Example

```ts
import { parse{{Pascal}}, {{Pascal}}ParseError, {{PREFIX}}_FATAL_CODES } from "{{PKG}}";

let code: string | undefined;
try {
  parse{{Pascal}}("");
} catch (error) {
  if (error instanceof {{Pascal}}ParseError) code = error.code;
}
code === {{PREFIX}}_FATAL_CODES.{{PREFIX}}_EMPTY_INPUT; // => true
```

***

### {{PREFIX_MD}}\_PROFILE\_CODES

> `const` **{{PREFIX_MD}}\_PROFILE\_CODES**: `object`

The profile codes: why a profile definition was refused. Each key equals its value.

#### Type Declaration

##### {{PREFIX_MD}}\_INVALID\_FIELD\_SEPARATOR

> `readonly` **{{PREFIX_MD}}\_INVALID\_FIELD\_SEPARATOR**: `"{{PREFIX}}_INVALID_FIELD_SEPARATOR"` = `"{{PREFIX}}_INVALID_FIELD_SEPARATOR"`

The field separator is not one character, or is the segment terminator.

##### {{PREFIX_MD}}\_INVALID\_PROFILE\_NAME

> `readonly` **{{PREFIX_MD}}\_INVALID\_PROFILE\_NAME**: `"{{PREFIX}}_INVALID_PROFILE_NAME"` = `"{{PREFIX}}_INVALID_PROFILE_NAME"`

The name is empty, too long, or holds a character outside letters, digits, `.`, `_` and `-`.

#### Example

```ts
import { define{{Pascal}}Profile, {{Pascal}}ProfileError, {{PREFIX}}_PROFILE_CODES } from "{{PKG}}";

let code: string | undefined;
try {
  define{{Pascal}}Profile({ name: "" });
} catch (error) {
  if (error instanceof {{Pascal}}ProfileError) code = error.code;
}
code === {{PREFIX}}_PROFILE_CODES.{{PREFIX}}_INVALID_PROFILE_NAME; // => true
```

***

### {{PREFIX_MD}}\_WARNING\_CODES

> `const` **{{PREFIX_MD}}\_WARNING\_CODES**: `object`

The warning codes: every deviation a lenient parse tolerates, by a stable name. Each key equals
its value, so `Object.values` lists the whole set.

The set is open: a release may add a code, so a branch over codes keeps a default case. A code
is never renamed or removed without the release notes saying what a caller must change.

#### Type Declaration

##### {{PREFIX_MD}}\_EMPTY\_SEGMENT

> `readonly` **{{PREFIX_MD}}\_EMPTY\_SEGMENT**: `"{{PREFIX}}_EMPTY_SEGMENT"` = `"{{PREFIX}}_EMPTY_SEGMENT"`

Two segment terminators with nothing between them. The empty segment is kept.

##### {{PREFIX_MD}}\_MALFORMED\_SEGMENT\_ID

> `readonly` **{{PREFIX_MD}}\_MALFORMED\_SEGMENT\_ID**: `"{{PREFIX}}_MALFORMED_SEGMENT_ID"` = `"{{PREFIX}}_MALFORMED_SEGMENT_ID"`

A segment whose first piece is not a segment identifier. The text is kept in `fields[0]`.

#### Example

```ts
import { parse{{Pascal}}, {{PREFIX}}_WARNING_CODES } from "{{PKG}}";

const { warnings } = parse{{Pascal}}("ABC|1\r\rDEF|2");
warnings[0]?.code === {{PREFIX}}_WARNING_CODES.{{PREFIX}}_EMPTY_SEGMENT; // => true
```

## Functions

### define{{Pascal}}Profile()

> **define{{Pascal}}Profile**(`input`): [`{{Pascal}}Profile`](#{{SLUG}}profile)

Define a vendor profile, checked once here so a parse never meets a bad one.

#### Parameters

##### input

[`{{Pascal}}ProfileInput`](#{{SLUG}}profileinput)

The profile's name and the settings it changes.

#### Returns

[`{{Pascal}}Profile`](#{{SLUG}}profile)

The frozen profile.

#### Throws

When the name or a setting is refused.

#### Example

```ts
import { define{{Pascal}}Profile, parse{{Pascal}} } from "{{PKG}}";

const profile = define{{Pascal}}Profile({ name: "vendor-a", fieldSeparator: "^" });
parse{{Pascal}}("ABC^1^2", { profile }).segments[0]?.fields.length; // => 3
```

***

### parse{{Pascal}}()

> **parse{{Pascal}}**(`raw`, `options?`): [`{{Pascal}}Document`](#{{SLUG}}document)

Parse a {{TITLE}} payload. The parse is lenient: a known deviation is recorded as a warning on the
result and the parse carries on, and only input it cannot turn into a structure throws.

The grammar here is a placeholder: segments end with `\r`, and fields within a segment are split
on the profile's separator. Every piece is kept as written, so serializing the result gives back
the payload that was read.

#### Parameters

##### raw

`string` \| `Uint8Array`\<`ArrayBufferLike`\>

The payload, as text or as UTF-8 bytes.

##### options?

[`{{Pascal}}ParseOptions`](#{{SLUG}}parseoptions) = `{}`

Strict mode, a vendor profile, and a warning handler.

#### Returns

[`{{Pascal}}Document`](#{{SLUG}}document)

The deep-frozen document, with the warnings on it.

#### Throws

On a fatal code, and under `strict: true` at the first warning.

#### Example

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const document = parse{{Pascal}}("ABC|1|2\rDEF|3\r");
document.segments.map((segment) => segment.id); // => ["ABC", "DEF"]
document.warnings.length; // => 0
```

***

### serialize{{Pascal}}()

> **serialize{{Pascal}}**(`document`, `options?`): `string`

Serialize a document. By default the output is what was read: a parsed payload serializes back
to the same text. `normalize: true` writes the normal form instead.

#### Parameters

##### document

[`{{Pascal}}Document`](#{{SLUG}}document)

The document to write.

##### options?

[`{{Pascal}}SerializeOptions`](#{{SLUG}}serializeoptions) = `{}`

Whether to write the normal form.

#### Returns

`string`

The payload text.

#### Example

```ts
import { parse{{Pascal}}, serialize{{Pascal}} } from "{{PKG}}";

const raw = "ABC|1||\r\rDEF|2";
serialize{{Pascal}}(parse{{Pascal}}(raw)) === raw; // => true
serialize{{Pascal}}(parse{{Pascal}}(raw), { normalize: true }); // => "ABC|1\rDEF|2\r"
```

## Version

### VERSION

> `const` **VERSION**: `string` = `"0.0.0"`

Library version string, the same as `package.json#version`. The `version` script writes it
(`cosyte-process sync-version`) in the commit that bumps the version, and `test/version.test.ts`
holds the two equal.

It is typed `string` rather than left to inference, so the declaration file does not carry the
current version as a literal type, and so `cosyte-process sync-version` finds it: it rewrites
exactly this form.

It sits in a group of its own in the generated reference, so where it is listed does not depend
on how the package's own names sort against it.

#### Example

```ts
import { VERSION } from "{{PKG}}";

typeof VERSION; // => "string"
```
