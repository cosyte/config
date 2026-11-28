# AGENTS.md

`{{PKG}}` is our {{TITLE}} parser for Node.js and TypeScript, under MIT. Code is in `src/`, tests
in `test/`, and the docs.cosyte.com pages in `docs-content/`. An explanation of how something works
belongs in `docs-content/`, not in this file.

## Build and test

Node 22 or later, and the pnpm version `packageManager` in `package.json` pins, first on PATH.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## The gate

Run it from the repository root before a push, after `git add`: the PHI scan and the dash gate read
tracked files. CI runs the first block on Node 22, 24 and 26, in this order.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm build
pnpm attw
```

CI's other jobs run these, each in its own job:

```sh
pnpm check:release-pr
pnpm check:readme
pnpm check:claude-card
pnpm check:catalog
pnpm check:docs-content
pnpm check:docs-reference
pnpm check:no-emdash
pnpm check:no-internal-refs
```

## Rules

- Synthetic data only. Real patient data never enters this repository: not in a fixture, a test,
  a log, or an issue. Declare every synthetic identifier a fixture uses in
  `scripts/phi-allow-list.txt`. `pnpm phi-scan` runs on every commit.
- A warning or an error carries a code and a position, never a value from the payload.
- A change to what the package ships (`src/`, `README.md`, or a `package.json` field npm shows)
  adds a changeset with `pnpm changeset`, and every changeset is a `patch`. A change to tests,
  `docs-content/`, scripts, or CI adds none.
- After a change to an export or its doc comment, run `pnpm docs:reference` and commit the pages
  under `docs-content/api/`; after `pnpm build`, run `pnpm api-surface` and, for an intended
  change, `pnpm api-surface --write`.

## Contributing

Questions, bug reports, and proposals go to
[the issue tracker](https://github.com/cosyte/{{NAME}}/issues). See also
[CONTRIBUTING](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md).

A pull request title follows Conventional Commits with a required scope,
`type(scope): description`. Merges are squash merges, so the title is the commit on `main`.
