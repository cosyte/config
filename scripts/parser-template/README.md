<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="The Cosyte logo on its own white ground: the icon beside the word Cosyte." src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# {{PKG}}

> {{TITLE}} for Node.js and TypeScript: lenient on parse, spec-clean on emit.

[![npm version](https://img.shields.io/npm/v/{{PKG}}.svg)](https://www.npmjs.com/package/{{PKG}})
[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/{{NAME}}/ci.yml?branch=main&label=CI)](https://github.com/cosyte/{{NAME}}/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cosyte/{{NAME}}/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

## Why this exists

Real-world {{TITLE}} messages depart from the specification in vendor-specific ways. `{{PKG}}`
reads them leniently, turning each quirk into a warning with a stable code instead of a failure,
and writes spec-clean output, so a quirk does not travel downstream on a round trip. It follows
the Cosyte parser archetype and mirrors the API of [`@cosyte/hl7`](https://github.com/cosyte/hl7).

## Status

Pre-alpha, on the 0.0.x line, and not yet published to npm. The API below is the scaffold; the
parser lands in later releases.

## Install

```bash
npm install {{PKG}}
```

Node 22 or later. No runtime dependencies.

## Usage

```ts
import { parse{{Pascal}} } from "{{PKG}}";

const result = parse{{Pascal}}(raw);

result.warnings; // stable, positional tolerance warnings: a quirk never throws
```

The parser is lenient by default: vendor quirks become warnings, not failures.

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
