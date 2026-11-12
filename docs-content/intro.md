---
id: intro
title: The standards every Cosyte package is held to
sidebar_label: Overview
description: "The testing and performance standards that every Cosyte library's quality pages are measured against."
---

A Cosyte library's "Testing and quality" and "Performance" pages give its own numbers and link here
for the method behind them. These pages hold that method:

- [The testing standard](./testing-standard.md): what we test and why, the coverage floor that
  only rises, a change's own code at 100%, mutation testing, property-based testing, and what each
  technique catches and cannot catch.
- [The performance standard](./performance-standard.md): what we measure (throughput, latency,
  memory, import time and bundle size), with which instrument, how much noise each instrument has,
  and what it cannot detect.

Both are decision records in [cosyte/config](https://github.com/cosyte/config), the repository that
publishes the shared toolchain the libraries build, lint and test with. The record is the source,
and each page here is written from it, so the two cannot disagree.
