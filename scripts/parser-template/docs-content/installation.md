---
id: installation
title: Installation
sidebar_position: 1
---

# Installation

`{{PKG}}` is a zero-dependency TypeScript package for Node.js. It ships dual **ESM + CJS** builds with
per-condition type declarations, so it works from either module system without configuration.

> **Status:** pre-alpha (`0.0.x`), not yet published to npm. The command below is the shape it will
> take at first publish; until then, consume it from source or a workspace link.

## Prerequisites

- **Node.js >= 22** (the whole `@cosyte/*` suite targets ES2023 / Node 22+).
- A package manager — `pnpm`, `npm`, or `yarn`.

## Install

```bash
npm install {{PKG}}
```

## Smoke test

Confirm the package resolves and its version symbol is present:

```ts
import { VERSION } from "{{PKG}}";

console.log(VERSION);
```

If that prints a version string, the install is good — head to the [Quickstart](./quickstart).
