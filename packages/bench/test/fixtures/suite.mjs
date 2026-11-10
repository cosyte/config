// A fixture suite, written the way a package writes one but without importing @cosyte/bench, which
// is not built while its own tests run. `globalThis.benchTeardowns` counts teardowns.

const bump = () => {
  globalThis.benchTeardowns = (globalThis.benchTeardowns ?? 0) + 1;
};

export default {
  name: "fixture suite",
  benchmarks: [
    {
      name: "length",
      sizes: [
        { label: "small", build: () => ({ inputs: ["ab", "abc"], bytes: 5, teardown: bump }) },
        { label: "large", build: () => ({ inputs: ["x".repeat(1000)] }) },
      ],
      bind: (target) => target.length,
      longRun: "large",
    },
    {
      name: "nothing",
      sizes: [{ label: "one", build: () => ({ inputs: [1] }) }],
      bind: (target) => target.nothing,
    },
    {
      name: "null",
      sizes: [{ label: "one", build: () => ({ inputs: [1] }) }],
      bind: (target) => target.nothingButNull,
    },
    {
      name: "boom later",
      sizes: [{ label: "one", build: () => ({ inputs: ["a"] }) }],
      bind: (target) => target.boomLater,
    },
    {
      name: "boom",
      sizes: [{ label: "one", build: () => ({ inputs: ["a"], teardown: bump }) }],
      bind: (target) => target.boom,
    },
    {
      name: "bad build",
      sizes: [
        {
          label: "one",
          build: () => {
            throw new TypeError("synthetic input QUOTED-INPUT-VALUE");
          },
        },
      ],
      bind: (target) => target.length,
    },
    {
      name: "empty",
      sizes: [{ label: "one", build: () => ({ inputs: [] }) }],
      bind: (target) => target.length,
    },
    {
      name: "not an array",
      sizes: [{ label: "one", build: () => ({ inputs: "abc" }) }],
      bind: (target) => target.length,
    },
    {
      name: "throws a string",
      sizes: [{ label: "one", build: () => ({ inputs: ["a"] }) }],
      bind: () => () => {
        throw "synthetic input QUOTED-INPUT-VALUE";
      },
    },
  ],
};
