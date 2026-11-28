---
id: performance
title: Performance
sidebar_label: Performance
description: "What we measure on {{PKG}}, how we measure it, and the gate that fails a pull request when parsing cost grows faster than its input."
---

# Performance

This page describes what we measure on `{{PKG}}` and how. The numbers for the current release are
in [Current numbers](#current-numbers) below.

## The scaling gate

`pnpm test:perf` runs the scaling gate from `@cosyte/test-utils/perf`, apart from the test suite
and never under coverage. It asks whether parsing cost grows faster than the input: with four times
the payloads, and with payloads four times longer, the cost must stay inside a fixed band. It does
not see a parser that is slower by a constant factor everywhere.

## Run it yourself

```bash
pnpm install --frozen-lockfile
pnpm test:perf
```

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
