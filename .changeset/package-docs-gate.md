---
"@cosyte/eslint-config": patch
"@cosyte/prettier-config": patch
"@cosyte/process": patch
"@cosyte/script-utils": patch
"@cosyte/test-utils": patch
"@cosyte/tsconfig": patch
"@cosyte/tsup-config": patch
"@cosyte/vitest-config": patch
---

Every published README now covers the same five topics under the same headings, documents every entry point its `exports` map declares, and ends with the same repository footer. A new root check, `test/package-docs.test.ts`, grades all of it and fails when a package falls short.

Why all eight packages are versioned for a documentation change: a README ships inside the npm tarball and is what the package page renders, so it is a consumer-visible surface. No API, type, signature or default changed in any of them, and no runtime file was touched.

What was actually missing before this. Three published entry points were documented nowhere: `@cosyte/script-utils/phi-scan`, `@cosyte/test-utils/perf` and `@cosyte/vitest-config/snippets` each had prose about the package and nothing that said the subpath existed. The two shortest READMEs were 22 and 29 lines against 166 and 240 for the two longest, and the same topic carried a different heading in almost every file.

The check derives its package set from `pnpm-workspace.yaml` and skips anything marked `private`, so a package added later joins the graded set with no edit to the check. Entry points come from each `exports` map for the same reason, and so does the one exemption: `@cosyte/tsconfig` and `@cosyte/prettier-config` are excused from carrying an _executable_ example because every one of their export targets is a JSON file a tool reads, which is asked of the manifest rather than written down as a list of two names. They are not excused a _copyable_ one: every published package's `## Use` section has to carry a fenced block, and a section that answers how to consume the package in prose alone is named with the package and the topic.

Nine usage examples are now executed on every `pnpm test` through `@cosyte/vitest-config/snippets`, against this repo's own sources rather than the published versions. A documented call whose output no longer matches the code fails the run, naming the README file and the line of the offending block. Which blocks those are is decided by where they sit, not by who remembered a tag: the example in a package's `## Use` section is the one a consumer copies, so an untagged TypeScript or JavaScript block there is refused by file and line. Script blocks elsewhere in a README stay illustrative, being anti-examples, fragments, and integrations written against packages this repository does not contain.
