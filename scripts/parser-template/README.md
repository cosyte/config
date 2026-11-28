<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# {{PKG}}

> {{TITLE}} for Node.js and TypeScript: lenient on parse, faithful on emit.

[![npm version](https://img.shields.io/npm/v/{{PKG}}.svg)](https://www.npmjs.com/package/{{PKG}})
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/{{NAME}}/ci.yml?branch=main&label=CI)](https://github.com/cosyte/{{NAME}}/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/{{NAME}}/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

## Why this exists

Real-world {{TITLE}} messages depart from the specification in vendor-specific ways. `{{PKG}}`
reads them leniently, turning each quirk into a warning with a stable code instead of a failure,
and writes back what it read, so a parse and a serialize change nothing downstream. It follows the
contract every Cosyte format parser shares, as [`@cosyte/hl7`](https://github.com/cosyte/hl7) does.

## Status

Pre-alpha, on the 0.0.x line. The grammar the parser reads is a placeholder until the standard's
own replaces it.

## Install

```bash
npm install {{PKG}}
```

Node 22 or later. No runtime dependencies.

## Usage

```ts
import { parse{{Pascal}}, serialize{{Pascal}} } from "{{PKG}}";

const raw = "ABC|1|2\r\rDEF|3\r";
const document = parse{{Pascal}}(raw);

document.warnings.map((warning) => warning.code); // => ["{{PREFIX}}_EMPTY_SEGMENT"]
serialize{{Pascal}}(document) === raw; // => true
```

The parser is lenient by default: vendor quirks become warnings, not failures. `strict: true`
throws at the first warning instead.

## Documentation

The guides and the API reference are at
[docs.cosyte.com/{{NAME}}](https://docs.cosyte.com/{{NAME}}).

## Support

Ask a question or report a bug in [GitHub issues](https://github.com/cosyte/{{NAME}}/issues). Use
synthetic data only: never paste a real message.

## Security

Report a vulnerability privately, as our
[security policy](https://github.com/cosyte/.github/blob/main/SECURITY.md) describes, never in a
public issue.

## Contributing

See [CONTRIBUTING](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md). Fixtures are
synthetic only.

## License

MIT, Cosyte LLC. See [LICENSE](https://github.com/cosyte/{{NAME}}/blob/main/LICENSE).
