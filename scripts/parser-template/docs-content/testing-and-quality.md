---
id: testing-and-quality
title: Testing and quality
sidebar_label: Testing and quality
description: "How we test {{PKG}}: unit tests, property-based tests, the coverage and mutation floors, doc samples, and the PHI scan."
---

# Testing and quality

This page describes how we test `{{PKG}}`, what each technique catches, and what it cannot. The
numbers for the current release are in [Current numbers](#current-numbers) below.

## What we run, and what each technique catches

| Technique | What it catches | What it cannot catch |
| --- | --- | --- |
| Unit tests | each documented behavior and each failure path, run against the source | an input nobody thought to write down |
| Property-based tests | a class of input breaking a stated rule: a lenient parse never throws except on a fatal code, and every warning carries a registered code | a rule nobody stated, or a case the generators never produce |
| Coverage floor | code no test runs, held at the floor in `quality-floor.json` | a test that runs code without checking what it returns |
| Mutation testing | a test that runs code but would not notice it changing | a mutant that changes nothing a caller can observe |
| Doc samples | a sample on these pages that no longer matches the code: each one runs against the built package and its `// =>` values are checked | prose that is wrong beside a sample that is right |
| PHI scan | a realistic patient identifier in a staged file or a fixture, against a declared allow-list of synthetic values | an identifier in a shape it does not know |

## Run them yourself

```bash
pnpm install --frozen-lockfile
pnpm test                # unit tests, properties, and doc samples
pnpm test:coverage       # the same suite with the coverage floor
pnpm phi-scan            # the PHI scan over the repository
```

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.
