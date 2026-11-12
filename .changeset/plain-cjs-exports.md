---
"@cosyte/tsup-config": patch
---

A new `plainCjsExports` option keeps each CommonJS entry point's exports as writable data properties when `splitting` is on, as a one-file build has them, so `jest.spyOn` and `vi.spyOn` can stub them. With `splitting` on, rollup re-exports what the shared chunk holds as getters that cannot be redefined; the option rewrites them once tsup has written the files. It fails the build on any getter it cannot rewrite safely, a star re-export of an external module included, and on a re-exported binding the chunk reassigns. It defines an export named `__proto__` as an own property, so no export name can set the module's prototype. The option is off by default and the baseline is unchanged; a package that already rewrites its exports in its own `onSuccess` step can turn the option on and drop that step.
