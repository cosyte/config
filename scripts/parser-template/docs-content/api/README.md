# {{PKG}}

## Interfaces

### Parsed{{Pascal}}

The result of parsing a {{TITLE}} payload.

Mirrors the Cosyte parser archetype: a parsed value plus the **warnings** the lenient parser
recovered from (Tier-2 deviations). The real model (an immutable document with dot-path access,
named helpers, and a spec-clean serializer) lands in subsequent phases; for now this captures the
minimal lenient-parse contract.

#### Properties

##### value

> `readonly` **value**: `Record`\<`string`, `unknown`\>

The parsed in-memory representation. A structural stub until the real model lands.

##### warnings

> `readonly` **warnings**: readonly [`{{Pascal}}Warning`](#{{SLUG}}warning)[]

Tier-2 deviations recovered during a lenient parse: stable code + position, never thrown.

***

### Parse{{Pascal}}Options

Options for [parse{{Pascal}}](#parse{{SLUG}}).

The parser is **lenient by default** (Postel's Law): vendor quirks become [{{Pascal}}Warning](#{{SLUG}}warning)s
rather than failures. Set `strict` to escalate every Tier-2 deviation to a thrown error.

#### Properties

##### strict?

> `readonly` `optional` **strict?**: `boolean`

When `true`, escalate every Tier-2 deviation to a thrown error instead of a warning.

***

### {{Pascal}}Warning

A single Tier-2 tolerance warning.

Warnings carry a **stable** [WarningCode](#warningcode) plus positional context so consumers can branch on
`w.code === WARNING_CODES.SOME_CODE` without the code churning: renaming a code is a breaking
change. The serializer never emits these; they describe what the lenient parser tolerated.

#### Properties

##### code

> `readonly` **code**: `"EXAMPLE_TOLERATED_DEVIATION"`

The stable warning code. One of the values in [WARNING\_CODES](#warning_codes).

##### message

> `readonly` **message**: `string`

Human-readable detail for logs (never contains PHI).

##### position?

> `readonly` `optional` **position?**: `object`

Positional context (offset/segment/element, refined as the parser grows).

###### offset

> `readonly` **offset**: `number`

## Type Aliases

### FatalCode

> **FatalCode** = *typeof* [`FATAL_CODES`](#fatal_codes)\[keyof *typeof* [`FATAL_CODES`](#fatal_codes)\]

A value from [FATAL\_CODES](#fatal_codes): the type carried by a thrown fatal error.

***

### WarningCode

> **WarningCode** = *typeof* [`WARNING_CODES`](#warning_codes)\[keyof *typeof* [`WARNING_CODES`](#warning_codes)\]

A value from [WARNING\_CODES](#warning_codes): the type consumers narrow `warning.code` against.

## Variables

### FATAL\_CODES

> `const` **FATAL\_CODES**: `object`

Stable **Tier-3 fatal code** registry: unrecoverable structural corruption.

Tier-3 codes are **always thrown**, even in lenient mode: they mark input the parser cannot
recover into a structured result. Like [WARNING\_CODES](#warning_codes) these are `key === value` and part of
the public contract. Real codes are added as the parser grows; this placeholder keeps the shape
resolvable.

#### Type Declaration

##### EXAMPLE\_UNRECOVERABLE

> `readonly` **EXAMPLE\_UNRECOVERABLE**: `"EXAMPLE_UNRECOVERABLE"` = `"EXAMPLE_UNRECOVERABLE"`

Placeholder Tier-3 code: replace with the parser's real unrecoverable-corruption codes.

#### Example

```ts
import { FATAL_CODES } from "{{PKG}}";

try {
  parse{{Pascal}}(raw);
} catch (err) {
  // err carries a code from FATAL_CODES
  void FATAL_CODES.EXAMPLE_UNRECOVERABLE;
}
```

***

### VERSION

> `const` **VERSION**: `string` = `"0.0.0"`

Library version string, the same as `package.json#version`. The `version` script writes it
(`cosyte-process sync-version`) in the commit that bumps the version, and `test/version.test.ts`
holds the two equal.

It is typed `string` rather than left to inference, so the declaration file does not carry the
current version as a literal type, and so `cosyte-process sync-version` finds it: it rewrites
exactly this form.

#### Example

```ts
import { VERSION } from "{{PKG}}";
console.log(VERSION);
```

***

### WARNING\_CODES

> `const` **WARNING\_CODES**: `object`

Stable **Tier-2 warning code** registry: the lenient parser's recoverable deviations.

Each code is its own value (`key === value`) so the set survives `Object.values(...)` into a
snapshot tripwire (see `@cosyte/test-utils`' `sortedCodeSet`). These codes are part of the public
contract: consumers branch on them, so renaming or removing one is a **breaking change**. Real
codes are added here as the parser grows; this placeholder keeps the shape resolvable.

#### Type Declaration

##### EXAMPLE\_TOLERATED\_DEVIATION

> `readonly` **EXAMPLE\_TOLERATED\_DEVIATION**: `"EXAMPLE_TOLERATED_DEVIATION"` = `"EXAMPLE_TOLERATED_DEVIATION"`

Placeholder Tier-2 code: replace with the parser's real recoverable-deviation codes.

#### Example

```ts
import { WARNING_CODES } from "{{PKG}}";

if (warning.code === WARNING_CODES.EXAMPLE_TOLERATED_DEVIATION) {
  // handle the tolerated deviation
}
```

## Functions

### parse{{Pascal}}()

> **parse{{Pascal}}**(`raw`, `options?`): [`Parsed{{Pascal}}`](#parsed{{SLUG}})

Parse a {{TITLE}} payload into a [Parsed{{Pascal}}](#parsed{{SLUG}}).

**Lenient by default**: real-world, vendor-quirky input parses rather than throws, emitting
[{{Pascal}}Warning](#{{SLUG}}warning)s instead (Postel's Law). The complementary serializer (added in a later
phase) always emits spec-clean output. Only unrecoverable structural corruption throws (a Tier-3
[FatalCode](#fatalcode)).

#### Parameters

##### raw

`string`

The raw {{TITLE}} payload (`string` for now; `Buffer`/`Uint8Array` support is added
  alongside the real parser).

##### options?

[`Parse{{Pascal}}Options`](#parse{{SLUG}}options) = `{}`

Parse options; see [Parse{{Pascal}}Options](#parse{{SLUG}}options). Lenient unless `strict` is set.

#### Returns

[`Parsed{{Pascal}}`](#parsed{{SLUG}})

The parsed value plus any recovered Tier-2 warnings.

#### Throws

Only on a Tier-3 [FatalCode](#fatalcode) (unrecoverable structural corruption), or, once
  implemented, on any Tier-2 deviation when `options.strict` is `true`.

#### Example

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const { value, warnings } = parse{{Pascal}}(raw);
for (const w of warnings) console.warn(w.code, w.position);
```
