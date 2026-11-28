---
id: limitations
title: Limitations
sidebar_label: Limitations
description: "What this release of {{PKG}} does not do yet, so you do not rely on it for that."
---

# Limitations

This page lists what `{{PKG}}` does not do in this release. Each entry is removed by the release
that adds the capability.

## The parse returns a stub

`parse{{Pascal}}` returns an empty value and no warnings for every payload. The tokenizer and the
model are not written yet.

## The code registries hold placeholders

`WARNING_CODES` and `FATAL_CODES` each hold one example entry, which nothing emits.

## There is no serializer

Nothing turns a parsed value back into a {{TITLE}} payload yet.

## The input is a string

`parse{{Pascal}}` takes a `string`. A `Uint8Array` input arrives with the tokenizer.
