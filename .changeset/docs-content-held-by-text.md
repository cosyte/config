---
"@cosyte/script-utils": patch
---

`cosyte-docs-content` now also refuses a `held_by` that names a text file that can only mention the
page: a `.markdown` or `.txt` file, or a file with no extension unless its text begins with `#!`, as
a script does. Such a reference is reported under `reference-source` with the message "which is a
text file, not the generator or the test that holds the reference to the code". What a caller
changes: a `held_by` that named such a file names the generator or the test instead.
