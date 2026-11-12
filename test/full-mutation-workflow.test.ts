import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { filesInShard } from "../packages/vitest-config/mutate.js";

import { sharedCallers } from "./support/shared-workflows.js";

/**
 * THE FULL MUTATION RUN, BY HAND AND IN SHARDS.
 *
 * `.github/workflows/full-mutation.yml` runs `cosyte-mutate full` for every package that holds a
 * mutation floor, split across parallel jobs by the shared sharded workflow in cosyte/.github, which
 * merges the shard reports into one `mutation.json` per package and holds each score to its floor
 * in `quality-floor.json`. These cases hold the parts of it that a later edit could break without a
 * red run: the ratchet reads every package's floor, so a package with a floor the command does not
 * mutate leaves no report and stops the run unread; and a shard count that puts the two largest
 * modules of `@cosyte/script-utils` in one shard puts back the single long job the split exists to
 * avoid.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const WORKFLOW = ".github/workflows/full-mutation.yml";
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

/** The `mutate-cmd` input, a folded block scalar, as the one line the shell runs. */
const mutateCommand = (text: string): string => {
  const block = /^ {6}mutate-cmd: >-\n((?: {8}.*\n)+)/m.exec(text)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
};

/** The `shard-count` input. */
const shardCount = (text: string): number =>
  Number(/^ {6}shard-count: (\d+)$/m.exec(text)?.[1] ?? Number.NaN);

/** The package directories `quality-floor.json` holds a mutation floor for. */
const withMutationFloor = (floor: string): string[] =>
  Object.entries(
    (JSON.parse(floor) as { packages: Record<string, { mutation?: number }> }).packages,
  )
    .filter(([, entry]) => entry.mutation !== undefined)
    .map(([dir]) => dir)
    .sort();

/**
 * The package directories a command runs a full mutation run in: `cd <dir> && cosyte-mutate full`,
 * or `cosyte-mutate full --config <dir>/stryker.config.mjs` from the root.
 */
const mutatedPackages = (command: string): string[] =>
  [
    ...[...command.matchAll(/\(cd (\S+) && pnpm exec cosyte-mutate full\)/g)].map((m) => m[1]),
    ...[
      ...command.matchAll(/pnpm exec cosyte-mutate full --config (\S+)\/stryker\.config\.mjs/g),
    ].map((m) => m[1]),
  ]
    .filter((dir): dir is string => dir !== undefined)
    .sort();

const SCRIPT_UTILS = [
  "packages/script-utils/phi-scan.js",
  "packages/script-utils/ratchet.js",
  "packages/script-utils/changes.js",
  "packages/script-utils/docs-content.js",
];

/** The shard, 1 to n, a file falls in. */
const shardOf = (file: string, n: number): number => {
  for (let k = 1; k <= n; k += 1) if (filesInShard([file], { k, n }).length === 1) return k;
  return 0;
};

describe("the full mutation workflow", () => {
  const text = read(WORKFLOW);

  it("starts by hand, and on a pull request only when it changes itself", () => {
    expect(text).toMatch(/^ {2}workflow_dispatch:/m);
    expect(text).toMatch(
      /^ {2}pull_request:\n {4}paths:\n {6}- "\.github\/workflows\/full-mutation\.yml"\n/m,
    );
    expect(text).not.toMatch(/^ {2}(?:push|schedule):/m);
  });

  it("calls the shared sharded mutation workflow", () => {
    expect(sharedCallers(WORKFLOW, text).map((c) => c.workflow)).toEqual(["weekly-mutation.yml"]);
  });

  it("mutates every package that holds a mutation floor, and builds first", () => {
    const command = mutateCommand(text);
    expect(command.startsWith("pnpm build && ")).toBe(true);
    expect(mutatedPackages(command)).toEqual(withMutationFloor(read("quality-floor.json")));
  });

  it("NEGATIVE CONTROL: a package with a floor left out of the command is seen", () => {
    const command = mutateCommand(text);
    const short = command.replace(
      / && \(cd packages\/test-utils && pnpm exec cosyte-mutate full\)/,
      "",
    );
    expect(short).not.toBe(command);
    expect(mutatedPackages(short)).not.toEqual(withMutationFloor(read("quality-floor.json")));
  });

  it("puts the PHI-scan engine and the docs-content check in different shards", () => {
    const n = shardCount(text);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(16);
    expect(shardOf("packages/script-utils/phi-scan.js", n)).not.toBe(
      shardOf("packages/script-utils/docs-content.js", n),
    );
    for (const file of SCRIPT_UTILS) expect(shardOf(file, n), file).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: some shard counts put the two in one shard", () => {
    const together = [2, 4, 8].filter(
      (n) =>
        shardOf("packages/script-utils/phi-scan.js", n) ===
        shardOf("packages/script-utils/docs-content.js", n),
    );
    expect(together).toEqual([2, 4, 8]);
  });
});
