---
"@cosyte/script-utils": patch
"@cosyte/bench": patch
---

`@cosyte/script-utils`: the attw gate (`cosyte-attw`, `runAttwGate` and `runAttwCli`) now starts on
Windows. It used to check `node_modules/.bin/attw` and start it without a shell; on Windows that file
is a POSIX shell script, so the start failed with ENOENT, and npm and pnpm, which the gate also
starts, are `.cmd` files there that Node will not start without a shell. On Windows the gate now
checks and starts `node_modules/.bin/attw.cmd`, and starts all three tools through `cmd.exe` with
every argument and every path on the command line in double quotes. Elsewhere nothing changes. Two new exports,
`attwBinaryPath(callerUrl, platform?)` and `toolCommand(file, args, platform?)`, say which binary and
which command line. The gate now refuses an argument carrying a double quote, a percent sign or a
line break, on every system: no argument it accepts needs one. A repository that skipped the attw
step on Windows can drop the skip once it takes this version. Callers change nothing.

`@cosyte/bench`: the README now says what the small-input memory budget gives up: a cost in fewer
than half of a small case's 20 calls is not bounded, the rule switches at a hard 64 KiB edge, and
the empty-call floor's highest call is not a fixed figure (usually about 29 KiB, once 369,888
bytes) while its median is stable at about 3.4 KiB. No behavior changes.
