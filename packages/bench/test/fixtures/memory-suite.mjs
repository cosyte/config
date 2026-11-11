// A fixture suite for the memory measurements, written without importing @cosyte/bench like the
// other fixture suites. Its functions ignore the target: they allocate known amounts.

/** Allocate `arrays` arrays of 1,024 small integers, none kept past the call. */
function arrays(count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += new Array(1024).fill(i & 1023).length;
  return total;
}

export default {
  name: "memory fixture suite",
  benchmarks: [
    {
      // 64 arrays a call, about 512 KiB: small enough for a window without a collection. 16,384
      // a call, 256 times as much: every window of it collects.
      name: "arrays",
      sizes: [
        { label: "64", build: () => ({ inputs: [64] }) },
        { label: "16384", build: () => ({ inputs: [16_384] }) },
      ],
      bind: () => arrays,
    },
    {
      // One 8 MiB Buffer a call, outside the V8 heap, not kept past the call.
      name: "buffer",
      sizes: [{ label: "8 MiB", build: () => ({ inputs: [8 * 1024 * 1024] }) }],
      bind: () => (bytes) => Buffer.alloc(bytes).length,
    },
  ],
};
