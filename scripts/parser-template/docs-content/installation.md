---
id: installation
title: Installation
sidebar_label: Installation
description: "Install {{PKG}} from npm and import it from ESM or CommonJS on Node.js 22 or later."
---

# Installation

`{{PKG}}` ships ESM and CommonJS builds, each with its own type declarations, so it loads from
either module system without configuration. It has no runtime dependencies.

## Prerequisites

- Node.js 22 or later.
- A package manager: pnpm, npm, or Yarn.

## Install

We recommend an exact version, so an upgrade is a change you make on purpose:

```bash
npm install --save-exact {{PKG}}
```

## Check the install

Import the version the package reports:

```ts runnable
import { VERSION } from "{{PKG}}";

typeof VERSION; // => "string"
```

If that import resolves, the install is complete. The [Quickstart](./quickstart.md) is next.
