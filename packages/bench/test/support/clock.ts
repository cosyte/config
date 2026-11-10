/**
 * Scripted clocks. Each read moves time on by a fixed step, and a call to the measured function can
 * move it further, so every duration a test checks is arithmetic, not a machine's noise.
 */
export interface FakeClock {
  readonly now: () => number;
  readonly advance: (ms: number) => void;
  readonly reads: () => number;
}

export function fakeClock(stepMs = 0, startMs = 0): FakeClock {
  let t = startMs;
  let reads = 0;
  return {
    now: () => {
      reads++;
      const v = t;
      t += stepMs;
      return v;
    },
    advance: (ms) => {
      t += ms;
    },
    reads: () => reads,
  };
}

/** A nanosecond clock: each read moves on `stepNs`, and `advance` adds more. */
export function fakeNs(
  stepNs: bigint,
  startNs = 0n,
): { ns: () => bigint; advance: (n: bigint) => void } {
  let t = startNs;
  return {
    ns: () => {
      const v = t;
      t += stepNs;
      return v;
    },
    advance: (n) => {
      t += n;
    },
  };
}
