// Stands in for the measuring process: answers any job with a fixed timing result.
import { readFileSync, writeFileSync } from "node:fs";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const result = {
  mode: "timing",
  case: job.case,
  inputsPerPass: 1,
  bytesPerPass: null,
  warmup: { stable: true, elapsedMs: 500, passes: 1, batches: [1] },
  status: "measured",
  samplesMsPerOp: [1],
  medianMsPerOp: 1,
  latency: null,
  // What the process was started with, so a test can see its flags and environment.
  execArgv: process.execArgv,
  coverage: process.env.NODE_V8_COVERAGE ?? null,
  compileCache: process.env.NODE_COMPILE_CACHE ?? null,
};
writeFileSync(process.argv[3], JSON.stringify({ ok: true, result }));
