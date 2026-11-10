// The long-run calibration suite: `decodeSourceLiterals` on the suite's smallest size, through
// `leak-target.mjs`, so a known leak can be switched on from outside.

import { defineBenchmark, defineSuite } from "@cosyte/bench";

import { source } from "../../packages/script-utils/bench/phi-scan.bench.mjs";

export default defineSuite({
  name: "long-run calibration",
  benchmarks: [
    defineBenchmark({
      name: "decodeSourceLiterals",
      sizes: [
        {
          label: "1 KiB",
          build: () => ({ inputs: Array.from({ length: 64 }, (_, f) => source(1024, f * 1000)) }),
        },
      ],
      bind: (engine) => (text) => engine.decodeSourceLiterals(text),
      weigh: (decoded) => decoded.length,
    }),
  ],
});
