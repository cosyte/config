---
id: intro
title: Introduction
sidebar_label: Introduction
description: "What {{PKG}} is, the parser contract it follows, and where to start reading."
---

# {{PKG}}

`{{PKG}}` is our {{TITLE}} parser for Node.js and TypeScript, with no runtime dependencies. It
follows the contract every Cosyte format parser shares: a parse is lenient by default, the document
it returns carries what it tolerated as warnings with stable codes, and what it cannot recover from
throws a coded error. `strict: true` turns the first warning into that error, a vendor profile
shapes the parse, and the serializer writes back what was read.

The package is new, and [Limitations](./limitations.md) says what this release does not do yet.

## Where to start

- [Installation](./installation.md): add the package and import it from ESM or CommonJS.
- [Quickstart](./quickstart.md): parse a payload and read what it reports.
- [Parse your first message](./parse-your-first-message.md): the same steps, one at a time.
- [Tolerance and warnings](./tolerance-and-warnings.md): why a parse warns rather than throws.
- The API reference: every export, generated from the source.
