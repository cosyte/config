// The large-case calibration suite: `large-target.mjs`'s parser on one synthetic message of 1 MiB
// and of 4 MiB. A call at these sizes takes longer than a warmup batch, so every batch is a single
// pass and the case runs on the large-case plan of the performance standard. The 4 MiB case is the
// one the large-case A/A calibration compares; both are read.
//
// Every message is built here from an index: a header segment and numbered result segments with
// synthetic codes and values. No file is read and no field holds anything about a person.

import { defineBenchmark, defineSuite } from "@cosyte/bench";

/** One synthetic result segment. */
function segment(i) {
  const value = String((i * 37) % 1000);
  return (
    `OBX|${String(i)}|NM|CODE${String(i % 211)}^Synthetic result ${String(i % 53)}^LOCAL||` +
    `${value}|unit${String(i % 7)}^^LOCAL|0-999|N|||F|||20260101000000`
  );
}

/** A synthetic message of about `bytes` bytes. */
export function message(bytes) {
  const lines = ["MSH|^~\\&|SYNTH|SITE|SYNTH|SITE|20260101000000||ORU^R01|1|P|2.5"];
  let n = lines[0].length + 1;
  for (let i = 1; n < bytes; i++) {
    const s = segment(i);
    lines.push(s);
    n += s.length + 1;
  }
  return lines.join("\r");
}

const MIB = 1024 * 1024;

export default defineSuite({
  name: "large-case calibration",
  benchmarks: [
    defineBenchmark({
      name: "parseMessage",
      sizes: [
        {
          label: "1 MiB",
          compare: false,
          build: () => {
            const text = message(MIB);
            return { inputs: [text], bytes: text.length };
          },
        },
        {
          label: "4 MiB",
          build: () => {
            const text = message(4 * MIB);
            return { inputs: [text], bytes: text.length };
          },
        },
      ],
      bind: (target) => (text) => target.parseMessage(text),
      weigh: (parsed) => parsed.count,
    }),
  ],
});
