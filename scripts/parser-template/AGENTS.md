# {{PKG}}

The {{TITLE}} parser for Node.js and TypeScript.
It parses, serializes and builds messages, and is published to npm under MIT. Code is in `src/`,
tests in `test/`, and the docs.cosyte.com pages in `docs-content/`.

## Build and test

Node 22 or later, and the pnpm version `packageManager` in `package.json` pins.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## Gates

Each must pass before a push. CI runs them on Node 22, 24 and 26.

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test:coverage
pnpm attw
```

## Data

Synthetic data only. Real patient data never enters this repository: not in a fixture, a test, a
log or an issue. `pnpm phi-scan` runs on every commit and refuses one that looks like it carries
some.

## Contributing

See [CONTRIBUTING](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md).
