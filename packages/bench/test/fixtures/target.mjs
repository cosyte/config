// The module under test for the fixture suites: plain functions with known behaviour.

export function length(text) {
  return text.length;
}

export function nothing() {
  return undefined;
}

export function nothingButNull() {
  return null;
}

let calls = 0;
export function boomLater(text) {
  // Fine through the warmup and the samples; throws once the latency calls begin.
  calls++;
  if (calls > 120) throw new RangeError("synthetic input QUOTED-INPUT-VALUE");
  return text.length;
}

export function boom() {
  // The message stands for an input a real parser might quote. It must never reach a report.
  throw new RangeError("synthetic input QUOTED-INPUT-VALUE");
}
