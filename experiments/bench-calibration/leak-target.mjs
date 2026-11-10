// A target for the long-run calibration: the real `decodeSourceLiterals`, wrapped so that each call
// keeps a known amount alive. `LEAK_EVERY` set in the environment retains one small object every
// that many calls (0, the default, retains nothing), so the slope the long run should report is
// known before it is measured.

import { decodeSourceLiterals as decode } from "../../packages/script-utils/phi-scan.js";

const every = Number(process.env.LEAK_EVERY ?? "0");
const kept = [];
let calls = 0;

export function decodeSourceLiterals(text) {
  calls++;
  if (every > 0 && calls % every === 0) kept.push({ calls });
  return decode(text);
}
