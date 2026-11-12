---
"@cosyte/script-utils": patch
---

`cosyte-docs-content` now reads whether each page holds what its kind asks, the kind being the
sidebar category the page is listed in (decision record 0006, section 12). Seven new rules: a how-to
guide's title begins with an imperative verb (`howto-title`) and it has no heading that begins How,
Why or The alternatives (`howto-steps`); an explanation has no settings table and no numbered H2
(`explanation-content`); each library has one `limitations` page, in Reference, and no other page
has a limitations heading (`limitations`); a tutorial's H2s are numbered steps ending in "What you
built" and "Next" (`tutorial-steps`); a page id shares a word with its title and does not begin
`guides-`, `concepts-` or `core-concepts` (`page-id`); and a configuration or command reference
names the generator or test that holds it to the code in `held_by:` in its front matter
(`reference-source`). A number with a measured unit outside "Current numbers" is a warning
(`measured-number`) and never fails.

A library's findings under the seven rules are held by a ratchet, `docs-content-ratchet.json`,
which records each library's counts as they were on 2026-11-12, so no library goes red when it
takes this version. The counts only fall. New exports: `RATCHETED_RULES`, `WARNING_RULES`,
`DOCS_CONTENT_RATCHET`, `applyDocsContentRatchet`, `docsContentWarnings`, `pageKinds`,
`isHeldByPath`, `HELD_BY_KEY`, `LIMITATIONS_PAGE`, `TUTORIAL_ENDING`, `KIND_PREFIXES` and
`IMPERATIVE_VERBS`. `readDocsContent` also returns `sources` and `library`.

What a caller changes: `checkDocsContent` now returns the seven new rules' findings with the rest,
unratcheted, so a caller that treats any finding as a failure passes them through
`applyDocsContentRatchet` first, as `runDocsContentCheck` does. Code that switches over
`DocsContentRule` sees eight new values.
