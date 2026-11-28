---
id: limitations
title: Limitations
sidebar_label: Limitations
description: "What this release of {{PKG}} does not do yet, so you do not rely on it for that."
---

# Limitations

This page lists what `{{PKG}}` does not do in this release. Each entry is removed by the release
that adds the capability.

## The grammar is a placeholder

`parse{{Pascal}}` reads segments ended by `\r` and fields split on `|` (or a profile's separator),
with a segment identifier of three characters. It does not yet read the {{TITLE}} grammar itself:
its escapes, its repetitions, or its components.

## Two warnings

The parse warns on an empty segment and on a segment that does not begin with an identifier, and
on nothing else yet.

## No builder

There is no builder for writing a new payload from values; the serializer writes a parsed one.
