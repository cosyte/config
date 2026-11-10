---
"@cosyte/script-utils": patch
---

A new subpath, `@cosyte/script-utils/docs-content`, and its bin, `cosyte-docs-content` (also `script-utils docs-content`): the structure check for a library's `docs-content/` folder, against the docs-content standard (decision record 0006 in cosyte/config). It checks the sidebar's shape (`intro`, then Installation, Quickstart, Tutorials, How-to guides, Explanation, Reference and Troubleshooting in that order, then the pages `testing-and-quality` and `performance`), that every page is listed once and every listed id is a page, the required pages, each page's front matter (`id` equal to the file name, `title`, `sidebar_label`, a `description` of at most 160 characters, no `sidebar_position`), page names, and the "Current numbers" section on both quality pages. Exit 0 clean, 1 a finding, 2 the check could not read its input. Nothing else in the package changes.
