---
id: tolerance-and-warnings
title: Tolerance and warnings
sidebar_label: Tolerance and warnings
description: "Why {{PKG}} parses leniently, the three tiers of deviation, and why a warning or an error never carries a value from the payload."
---

# Tolerance and warnings

Most {{TITLE}} traffic in production deviates from the specification somewhere. A parser that
refuses every deviation cannot read a real feed, and one that accepts every deviation without a
word hides what it changed. `{{PKG}}` takes the middle path: it parses what it can, and says what
it tolerated.

## Three tiers

Every deviation falls in one of three tiers:

- **Spec-clean.** Nothing to report.
- **Tolerated.** A known deviation the parser reads past. The parse records a warning with a stable
  code and a position, and carries on.
- **Fatal.** Input the parser cannot turn into a structure. The parse throws a
  `{{Pascal}}ParseError` with a code from `{{PREFIX}}_FATAL_CODES`.

`strict: true` moves the line: the first tolerated deviation throws the same error, with the
warning's own code, so a sender you trust to be spec-clean is held to it. A vendor profile shapes
how a payload is read, such as the separator between fields, and never removes a warning from the
result.

A warning is plain data, not an `Error`, and it has no severity field: the tier is the severity.

## Stable codes

Warning and fatal codes are public API, and each one carries the `{{PREFIX}}_` prefix, so a code in a
log names its package. A code keeps its name across releases, so a branch on one
keeps working. The set is open: a release may add a code, which is why a branch over codes keeps a
default case. Renaming or removing a code is a change the release notes call out with what a caller
must change.

## No values in a diagnostic

A warning or an error says where to look, never what was there: a code and a position, and never a
field's value or a snippet of the payload. A {{TITLE}} payload can carry a patient's identity, and a
diagnostic travels to logs and trackers that were never meant to hold it. A segment's `id` follows
the same rule: it is present only when the text has an identifier's shape.

## Faithful on emit

`serialize{{Pascal}}` writes back what was read, deviations included, so a parse and a serialize
change nothing a downstream system would see. `{ normalize: true }` writes the normal form instead,
and asking for it is the caller's decision.
