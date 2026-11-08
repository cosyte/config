---
"@cosyte/script-utils": patch
---

Under CI, every gate's `--help` and `-h` now exit non-zero instead of 0: the bins exit 2 and the dash gate exits 1, after printing the help to stderr with a line saying why. Help checks nothing, so a package script such as `"attw": "cosyte-attw --help"` used to pass a required check having run no gate. CI is read the way the common runners set it: `CI` set to anything but an empty string, `false` or `0`. At a terminal `--help` prints to stdout and exits 0 as before.
