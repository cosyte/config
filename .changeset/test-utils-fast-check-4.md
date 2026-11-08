---
"@cosyte/test-utils": patch
---

The `fast-check` peer range is now `^3.0.0 || ^4.0.0`, so a package on fast-check 4 can use the
runners without a peer warning; fast-check 3 still satisfies it. On fast-check 4 a failing runner
still names its reason (for example "snapshot changed") in the thrown error's message: fast-check 4
moves the failing check's error to `cause` by default, and the runners now ask it to keep the error
in the message, as fast-check 3 does. The package's suite passes on fast-check 4.10.2 and 3.23.2.
