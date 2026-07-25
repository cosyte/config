/**
 * PERF-P0 · Experiment B — how many `gc()` rounds settle `heapUsed`, on a real Node 22 binary.
 *
 * Produces the third constant the kit needs (the **GC round count**) plus the residual spread once
 * settled, and re-checks on Node 22 three findings that were only measured on Node v24.18.0 (§10/O7):
 *
 *   - **M2** — `gc(true)` silently performs a *scavenge*, not a major GC. The research framed the rule
 *     as "a truthy non-options argument"; leg 2 spans enough argument SHAPES to find out whether that
 *     is the actual boundary. (It is not — see ANALYSIS.md §6: the boundary is whether V8 recognises
 *     a key.) This is the single most-copied idiom in JS memory benchmarks and it silently
 *     invalidates the reading.
 *   - **M3** — one GC is not a fixpoint. V8's maximal-reclamation path runs between
 *     `kMinNumberOfAttempts = 2` and `kMaxNumberOfAttempts = 7` rounds "until the root set is stable".
 *     Leg 1 measures how many rounds it actually takes here.
 *   - **O4** — sync vs async `gc()`. V8's docs recommend the async form for "test that certain objects
 *     indeed are reclaimed", but the stack-scanning explanation for why was refuted. Leg 3 measures
 *     whether the async form reaches the fixpoint in fewer rounds, which decides which incantation
 *     the kit standardizes on.
 *
 * Run: `node --expose-gc gc-fixpoint.mjs`. Writes JSON to `$OUT` (default stdout).
 *
 * Method note. The garbage has to be in **old space** for any of this to be meaningful — a scavenge
 * reclaims young-generation garbage, so young garbage would make `gc(true)` look fine. So each trial
 * builds a graph, forces two major GCs to promote it, drops the reference, and only then measures.
 * PHI: the graph is filler strings and numbers.
 */

import { writeFileSync } from "node:fs";

if (typeof globalThis.gc !== "function") {
  console.error("gc-fixpoint: needs --expose-gc");
  process.exit(2);
}
const gc = globalThis.gc;

/** Trials per leg. Enough to report a spread, cheap enough to run on a shared CI runner. */
const TRIALS = 50;
/** Max rounds probed per trial. V8's own documented ceiling is 7 (M3); 12 leaves headroom. */
const MAX_ROUNDS = 12;
/** Objects per graph. Sized to move old space by tens of MB so the signal clears the noise. */
const GRAPH_SIZE = 120_000;
/** A round counts as settled once it reclaims less than this. 64 KB ≈ ordinary allocator jitter. */
const SETTLED_BYTES = 64 * 1024;

const heapUsed = () => process.memoryUsage().heapUsed;

/**
 * Build a retained graph big enough to matter, with cross-links so it cannot be a single flat
 * allocation V8 can dispose of trivially.
 */
function buildGraph(n) {
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = {
      i,
      tag: `node-${i}-filler-payload-to-occupy-real-bytes`,
      next: null,
      data: [i, i + 1, i + 2],
    };
  }
  for (let i = 0; i < n; i++) nodes[i].next = nodes[(i * 7 + 1) % n];
  return nodes;
}

/** Allocate, promote to old space, drop. Returns the heapUsed reading with the garbage still live. */
function makeOldSpaceGarbage() {
  let graph = buildGraph(GRAPH_SIZE);
  // Two major GCs while the graph is still reachable promote it out of the young generation.
  gc();
  gc();
  const live = heapUsed();
  // Touch it after the reading so nothing above can be optimized away as dead.
  const witness = graph[0].next.i;
  graph = null;
  return { live, witness };
}

/** Leg 1 — rounds of zero-arg `gc()` to reach a fixpoint, and the residual spread once settled. */
function legFixpoint() {
  const trials = [];
  for (let t = 0; t < TRIALS; t++) {
    const { live } = makeOldSpaceGarbage();
    const series = [];
    let firstSettledRound = null;
    for (let r = 0; r < MAX_ROUNDS; r++) {
      const before = heapUsed();
      gc();
      const after = heapUsed();
      series.push(after);
      if (firstSettledRound === null && before - after < SETTLED_BYTES) firstSettledRound = r + 1;
    }
    // `firstSettledRound` is 1-based and names the first round that ITSELF reclaimed nothing, so the
    // rounds actually required to reach the fixpoint is one fewer.
    trials.push({
      live,
      series,
      firstSettledRound,
      roundsRequired: firstSettledRound === null ? null : firstSettledRound - 1,
      final: series[series.length - 1],
    });
  }
  return trials;
}

/**
 * Leg 2 — M2 reproduction. For each argument form, build fresh old-space garbage and record what a
 * SINGLE call of that form reclaims. A form that reclaims ~0 is performing a scavenge.
 *
 * The form list has to span the *shape* space, not just the truthiness space, or the leg cannot
 * support a general claim about which arguments work. V8's gc-extension parses the argument as an
 * options bag only when it recognises a key (`type`, `execution`, `flavor`); anything else — a
 * primitive, an empty object, an object whose keys it does not know — falls through to the legacy
 * path. So the list below deliberately includes an EMPTY options object and one with an
 * unrecognised key, which are the two cases that separate "is an object" from "is parsed as
 * options". An earlier version of this leg tested only 7 forms, none of them an options object with
 * a non-`type` key, and the write-up generalised past what those 7 could support.
 *
 * `await`ing is per-form: `{execution:'async'}` returns a promise and reclaims nothing until it
 * settles, so measuring it synchronously would score a working form as broken.
 */
async function legArgumentForms() {
  const forms = [
    { label: "gc()", call: () => gc() },
    { label: "gc(true)", call: () => gc(true) },
    { label: "gc(false)", call: () => gc(false) },
    { label: "gc(1)", call: () => gc(1) },
    { label: "gc(null)", call: () => gc(null) },
    { label: "gc(undefined)", call: () => gc(undefined) },
    { label: "gc({})", call: () => gc({}) },
    { label: "gc({foo:1})", call: () => gc({ foo: 1 }) },
    { label: "gc({type:'major'})", call: () => gc({ type: "major" }) },
    { label: "gc({type:'minor'})", call: () => gc({ type: "minor" }) },
    { label: "gc({execution:'sync'})", call: () => gc({ execution: "sync" }) },
    { label: "await gc({execution:'async'})", call: () => gc({ execution: "async" }), async: true },
    { label: "gc({flavor:'last-resort'})", call: () => gc({ flavor: "last-resort" }) },
  ];
  const results = [];
  for (const form of forms) {
    const reclaimed = [];
    let error = null;
    for (let t = 0; t < 10; t++) {
      const { live } = makeOldSpaceGarbage();
      try {
        if (form.async) await form.call();
        else form.call();
      } catch (e) {
        error = String(e);
        break;
      }
      reclaimed.push(live - heapUsed());
    }
    // Leave the heap clean so the next form starts from the same place.
    gc();
    gc();
    results.push({ form: form.label, reclaimedBytes: reclaimed, error });
  }
  return results;
}

/** Leg 3 — O4. Rounds to fixpoint using the async form instead of the sync one. */
async function legAsync() {
  const trials = [];
  for (let t = 0; t < TRIALS; t++) {
    const { live } = makeOldSpaceGarbage();
    const series = [];
    let firstSettledRound = null;
    let supported = true;
    for (let r = 0; r < MAX_ROUNDS; r++) {
      const before = heapUsed();
      try {
        await gc({ execution: "async" });
      } catch {
        supported = false;
        break;
      }
      const after = heapUsed();
      series.push(after);
      if (firstSettledRound === null && before - after < SETTLED_BYTES) firstSettledRound = r + 1;
    }
    trials.push({
      live,
      series,
      firstSettledRound,
      roundsRequired: firstSettledRound === null ? null : firstSettledRound - 1,
      supported,
      final: series[series.length - 1] ?? null,
    });
  }
  return trials;
}

const report = {
  node: process.versions.node,
  v8: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
  cpus: (await import("node:os")).cpus().length,
  totalMemBytes: (await import("node:os")).totalmem(),
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  config: { TRIALS, MAX_ROUNDS, GRAPH_SIZE, SETTLED_BYTES },
  fixpoint: legFixpoint(),
  argumentForms: await legArgumentForms(),
  asyncFixpoint: await legAsync(),
};

const out = process.env.OUT;
const json = JSON.stringify(report);
if (out) {
  writeFileSync(out, json + "\n");
  console.error(`gc-fixpoint: wrote ${out}`);
} else {
  process.stdout.write(json + "\n");
}
