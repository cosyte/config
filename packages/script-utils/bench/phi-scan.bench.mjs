// Benchmarks for the PHI scan engine (`phi-scan.js`), which runs in every parser's commit gate.
//
// A reading of this build:
//   pnpm bench:phi-scan
// A base against head comparison, the base built in another checkout:
//   node packages/bench/dist/cli.mjs compare --suite packages/script-utils/bench/phi-scan.bench.mjs \
//     --base <base checkout>/packages/script-utils/phi-scan.js --head packages/script-utils/phi-scan.js
//
// The suite is handed the module under test rather than importing it, so one file measures both
// builds. Every input is synthetic and built here from an index: no file a person supplied is read.
// The only email domain in the corpus is the reserved example.com, which the allow list declares, and
// no line has the shape of an SSN, so every scan is a clean one: the path a commit gate takes on
// every commit.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineBenchmark, defineSuite } from "@cosyte/bench";

/** One synthetic line of TypeScript: string escapes for the decoder, an allowed email address. */
function line(i) {
  return (
    `export const v${String(i)} = "field\\u002D${String(i)}\\x41\\n" + ` +
    `"synthetic record ${String(i % 97)} ${"x".repeat(i % 13)}"; // owner${String(i % 89)}@example.com`
  );
}

/** A synthetic source of about `bytes` bytes. `seed` shifts the line numbers so sources differ. */
export function source(bytes, seed = 0) {
  const lines = [];
  let n = 0;
  for (let i = seed; n < bytes; i++) {
    const l = line(i);
    lines.push(l);
    n += l.length + 1;
  }
  return lines.join("\n");
}

const KIB = 1024;

// Small to very large: a typical source file, a large one, a generated one, and one far past what
// a hand-written file reaches. `files` keeps a pass of the small sizes from being one file repeated.
// The very large size is left out of the pull request comparison: one of its processes takes
// several seconds, and a comparison runs 24 per case. A reading still measures it.
const SIZES = [
  { label: "1 KiB", bytes: KIB, files: 64 },
  { label: "32 KiB", bytes: 32 * KIB, files: 8 },
  { label: "1 MiB", bytes: 1024 * KIB, files: 1 },
  { label: "4 MiB", bytes: 4096 * KIB, files: 1, compare: false },
];

const EXIT = { clean: 0, hits: 1, refuse: 2 };

/** A temporary repository holding `files` synthetic sources and an allow list. */
function syntheticRepo({ bytes, files }) {
  const root = mkdtempSync(join(tmpdir(), "cosyte-bench-phi-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "scripts", "phi-allow-list.txt"), "EMAILDOMAIN example.com\n");
  const paths = [];
  let total = 0;
  for (let f = 0; f < files; f++) {
    const text = source(bytes, f * 1000);
    const path = join(root, "src", `module-${String(f)}.ts`);
    writeFileSync(path, text);
    paths.push(path);
    total += Buffer.byteLength(text);
  }
  return { root, paths, total };
}

export default defineSuite({
  name: "@cosyte/script-utils phi-scan",
  benchmarks: [
    defineBenchmark({
      // The whole engine on one file, the way `cosyte-phi-scan <path>` runs: the allow list read,
      // the file read, decoded and run through the SSN and email floor.
      name: "runPhiScan, one file",
      sizes: SIZES.map((size) => ({
        label: size.label,
        compare: size.compare ?? true,
        build: () => {
          const repo = syntheticRepo(size);
          return {
            inputs: repo.paths.map((path) => ({ root: repo.root, path })),
            bytes: repo.total,
            teardown: () => rmSync(repo.root, { recursive: true, force: true }),
          };
        },
      })),
      bind: (engine) => {
        const scan = ({ root, path }) =>
          engine.runPhiScan({
            repoRoot: root,
            argv: [path],
            exitCodes: EXIT,
            scanRoots: ["."],
            isStagedReadable: () => true,
          });
        return scan;
      },
      // A scan that did not come back clean measured something else: count only clean ones, so a
      // corpus that stopped scanning clean leaves the sink still and the run refuses.
      weigh: (code) => (code === EXIT.clean ? 1 : 0),
    }),
    defineBenchmark({
      // The escape decoder alone, on text already in memory.
      name: "decodeSourceLiterals",
      sizes: SIZES.map((size) => ({
        label: size.label,
        compare: size.compare ?? true,
        build: () => {
          const inputs = Array.from({ length: size.files }, (_, f) => source(size.bytes, f * 1000));
          return { inputs, bytes: inputs.reduce((n, t) => n + Buffer.byteLength(t), 0) };
        },
      })),
      bind: (engine) => (text) => engine.decodeSourceLiterals(text),
      weigh: (decoded) => decoded.length,
    }),
  ],
});
