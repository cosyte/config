---
"@cosyte/vitest-config": patch
---

`@cosyte/vitest-config` accepts Vitest 5 as well as Vitest 4: the `vitest` and `@vitest/coverage-v8` peer ranges are now `^4.0.0 || ^5.0.0`, so a package on Vitest 5 installs it without a peer warning. The configuration it returns is unchanged; Vitest 5 reads the same `coverage` options, and its own `vite` range (6.4 or later, 7 or 8) sits inside this package's.
