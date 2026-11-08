---
"@cosyte/tsup-config": patch
---

The `tsup` peer range is now `^8.0.0 || ^9.0.0`, so a package on tsup 9 installs this config without a peer warning; tsup 8 still satisfies it. The baseline options are unchanged and build the same dual ESM and CJS output with declarations under tsup 9.0.0. tsup 9 itself needs Node 22.18 or later.
