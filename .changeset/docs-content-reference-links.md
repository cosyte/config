---
"@cosyte/script-utils": patch
---

The docs-content check (`cosyte-docs-content`, `@cosyte/script-utils/docs-content`) now resolves every link a page makes into the generated reference, `./api/<page>.md#<anchor>`: the page must exist under `docs-content/api/`, and the anchor must be one a heading on it gets on docs.cosyte.com (lower case, every character but a letter, a mark, a digit, an underscore, a space or a hyphen dropped, each space a hyphen, a repeat numbered `-1`, `-2`). A link that does not resolve is a finding under the new rule `reference-link`, with its page and line. It also requires the "Current numbers" section of both quality pages to hold only the placeholder, `NUMBERS_PLACEHOLDER`, until the release fills in the numbers: a table, a sub-heading or a sentence added beside it is a finding. `readDocsContent` now returns the generated pages as `reference`, and `headingAnchors(text)` is exported.
