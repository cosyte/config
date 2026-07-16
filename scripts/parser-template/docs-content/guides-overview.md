---
id: guides-overview
title: Guides
sidebar_position: 1
---

# Guides

Task-oriented recipes — "how do I X?" — for `{{PKG}}`. Each guide is a short, copy-pasteable answer to
one real integration question.

> **Status:** this package is a pre-alpha scaffold, so the guide set is intentionally thin. Guides are
> added here as the parser ships real capability; a guide is only written once the behavior it
> documents is shipped and its runnable example passes the doc/code-agreement check.

## Planned guides

As the parser grows, expect recipes such as:

- **Handle a vendor quirk** — branch on a specific `WARNING_CODES` entry and decide whether to
  tolerate, log, or reject.
- **Fail fast with strict mode** — use `{ strict: true }` to turn tolerated deviations into thrown
  errors at an integration boundary.
- **Round-trip a payload** — parse, adjust, and re-serialize spec-clean output.

Until then, the [Quickstart](./quickstart) covers the one-line parse, and the **API Reference**
documents every shipped export.
