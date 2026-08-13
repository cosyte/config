import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, makeTempDir, useFixture } from "./helpers.js";
import { checkWiring } from "../src/check.js";
import { OVERRIDE_FILE } from "../src/overrides.js";
import { resolveToolBin } from "../src/resolve.js";
import { run, type SpawnTool } from "../src/run.js";
import { DELEGATED_VERBS, type DelegatedVerb, type ToolName, VERBS } from "../src/verbs.js";

/**
 * The command itself: argv in, exit code out, with the tool execution injected.
 *
 * This is where "executes EXACTLY that verb's invocation" is proven end to end without running a
 * tool: the recorded call carries the resolved bin and the exact argument list the contract's
 * partition produces, including whatever the override file and the modifier did to it.
 */

afterAll(cleanupTempDirs);

interface Recorded {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** A spawn that records instead of executing, and reports the exit code it is told to. */
function recorder(code = 0): { calls: Recorded[]; spawnTool: SpawnTool } {
  const calls: Recorded[] = [];
  const spawnTool: SpawnTool = (bin, args, cwd) => {
    calls.push({ bin, args, cwd });
    return Promise.resolve(code);
  };
  return { calls, spawnTool };
}

/** Run in-process, collecting whatever went to stderr. */
async function runIn(
  argv: readonly string[],
  cwd: string,
  extra: { spawnTool?: SpawnTool; toolBase?: string } = {},
): Promise<{ code: number; stderr: string }> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await run(argv, { cwd, stderr: stream, ...extra });
  return { code, stderr: Buffer.concat(chunks).toString("utf8") };
}

interface VerbCase {
  readonly verb: DelegatedVerb;
  readonly tool: ToolName;
  readonly args: readonly string[];
}

const VERB_CASES: readonly VerbCase[] = [
  { verb: "build", tool: "tsup", args: [] },
  { verb: "test", tool: "vitest", args: ["run"] },
  {
    verb: "lint",
    tool: "eslint",
    args: [
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "src/**/*.ts",
      "scripts/**/*.ts",
      "test/**/*.ts",
    ],
  },
  { verb: "typecheck", tool: "tsc", args: ["--noEmit"] },
  {
    verb: "format",
    tool: "prettier",
    args: [
      "--write",
      "src/**/*.{ts,md}",
      "test/**/*.ts",
      "scripts/**/*.{ts,mjs}",
      "*.{json,md,yml}",
    ],
  },
];

describe("the five delegated verbs execute their exact invocation", () => {
  it.each(VERB_CASES)("$verb", async ({ verb, tool, args }) => {
    const dir = useFixture("wired");
    const { calls, spawnTool } = recorder();
    const { code } = await runIn([verb], dir, { spawnTool });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bin).toBe(resolveToolBin(tool));
    expect(calls[0]?.args).toEqual(args);
    expect(calls[0]?.cwd).toBe(dir);
  });

  it("runs the tool in the invoking repo's working directory", async () => {
    const dir = useFixture("minimal");
    const { calls, spawnTool } = recorder();
    await runIn(["build"], dir, { spawnTool });
    expect(calls[0]?.cwd).toBe(dir);
  });
});

describe("modifiers, over the effective invocation", () => {
  it("`test --watch` swaps the core token (no e2e: watch never exits)", async () => {
    const dir = useFixture("wired");
    const { calls, spawnTool } = recorder();
    await runIn(["test", "--watch"], dir, { spawnTool });
    expect(calls[0]?.args).toEqual(["watch"]);
  });

  it("`test --coverage` keeps `run` and appends", async () => {
    const dir = useFixture("wired");
    const { calls, spawnTool } = recorder();
    await runIn(["test", "--coverage"], dir, { spawnTool });
    expect(calls[0]?.args).toEqual(["run", "--coverage"]);
  });

  it("`lint --fix` appends after the flags, before the globs", async () => {
    const dir = useFixture("wired");
    const { calls, spawnTool } = recorder();
    await runIn(["lint", "--fix"], dir, { spawnTool });
    expect(calls[0]?.args).toEqual([
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "--fix",
      "src/**/*.ts",
      "scripts/**/*.ts",
      "test/**/*.ts",
    ]);
  });

  it("`format --check` swaps --write for --check", async () => {
    const dir = useFixture("wired");
    const { calls, spawnTool } = recorder();
    await runIn(["format", "--check"], dir, { spawnTool });
    expect(calls[0]?.args?.[0]).toBe("--check");
    expect(calls[0]?.args).not.toContain("--write");
  });

  it("`lint --fix` under a globs override fixes the OVERRIDDEN globs", async () => {
    const dir = useFixture("overridden");
    const { calls, spawnTool } = recorder();
    await runIn(["lint", "--fix"], dir, { spawnTool });
    expect(calls[0]?.args).toEqual([
      "--max-warnings=0",
      "--no-error-on-unmatched-pattern",
      "--fix",
      "lib/**/*.ts",
    ]);
  });

  it("a test flags override yields `vitest run --coverage`, never `vitest --coverage`", async () => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), '{"test":{"flags":["--coverage"]}}\n');
    const { calls, spawnTool } = recorder();
    await runIn(["test"], dir, { spawnTool });
    expect(calls[0]?.args).toEqual(["run", "--coverage"]);
  });

  it("leaves the fixture's script bodies untouched while doing it", async () => {
    const dir = useFixture("overridden");
    const { spawnTool } = recorder();
    await runIn(["lint", "--fix"], dir, { spawnTool });
    expect(checkWiring(dir)).toEqual([]);
  });
});

describe("argument errors print the supported verbs and modifiers", () => {
  it("refuses no verb at all", async () => {
    const { code, stderr } = await runIn([], useFixture("wired"));
    expect(code).not.toBe(0);
    expect(stderr).toContain("no verb given");
    for (const verb of VERBS) {
      expect(stderr).toContain(verb);
    }
    expect(stderr).toContain("cosyte-process test --watch");
    expect(stderr).toContain("cosyte-process lint --fix");
    expect(stderr).toContain("cosyte-process format --check");
    expect(stderr).toContain("cosyte-process test --coverage");
  });

  it("refuses an unknown verb", async () => {
    const { code, stderr } = await runIn(["buidl"], useFixture("wired"));
    expect(code).not.toBe(0);
    expect(stderr).toContain('unknown verb "buidl"');
    expect(stderr).toContain("usage: cosyte-process");
  });

  it("refuses an unknown modifier", async () => {
    const { code, stderr } = await runIn(["test", "--fix"], useFixture("wired"));
    expect(code).not.toBe(0);
    expect(stderr).toContain('unknown modifier "--fix"');
    expect(stderr).toContain("--watch, --coverage");
  });

  it("refuses a modifier on a verb that takes none", async () => {
    const { code, stderr } = await runIn(["build", "--watch"], useFixture("wired"));
    expect(code).not.toBe(0);
    expect(stderr).toContain('unknown modifier "--watch"');
    expect(stderr).toContain('"build" takes no modifier');
  });

  it("refuses a modifier on check", async () => {
    const { code, stderr } = await runIn(["check", "--fix"], useFixture("wired"));
    expect(code).not.toBe(0);
    expect(stderr).toContain('"check" takes no modifier');
  });

  it("refuses two modifiers, even when both are valid for the verb", async () => {
    const { code, stderr } = await runIn(["test", "--watch", "--coverage"], useFixture("wired"));
    expect(code).not.toBe(0);
    expect(stderr).toContain("at most one modifier");
    expect(stderr).toContain("usage: cosyte-process");
  });
});

describe("the empty state: no package.json", () => {
  it.each(VERBS)("%s names the missing file", async (verb) => {
    const empty = makeTempDir("cosyte-process-empty-");
    const { code, stderr } = await runIn([verb], empty);
    expect(code).not.toBe(0);
    expect(stderr).toContain(join(empty, "package.json"));
    expect(stderr).toContain("no package.json");
  });
});

describe("an invalid override file fails EVERY verb", () => {
  it.each(VERBS)("%s names the file and the first violation", async (verb) => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), '{"lint":{"tool":"biome"}}\n');
    const { code, stderr } = await runIn([verb], dir, { spawnTool: recorder().spawnTool });
    expect(code).not.toBe(0);
    expect(stderr).toContain(join(dir, OVERRIDE_FILE));
    expect(stderr).toContain('unknown key "tool" under "lint"');
  });

  it("never reaches the tool", async () => {
    const dir = useFixture("wired");
    writeFileSync(join(dir, OVERRIDE_FILE), "{ not json");
    const { calls, spawnTool } = recorder();
    const { code, stderr } = await runIn(["build"], dir, { spawnTool });
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(0);
    expect(stderr).toContain("malformed JSON");
  });
});

describe("a baseline tool that does not resolve", () => {
  it.each(DELEGATED_VERBS)("%s exits non-zero identifying the missing tool", async (verb) => {
    const dir = useFixture("wired");
    const noTools = makeTempDir("cosyte-process-no-tools-");
    const { calls, spawnTool } = recorder();
    const { code, stderr } = await runIn([verb], dir, { spawnTool, toolBase: noTools });
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(0);
    expect(stderr).toContain("cannot resolve the");
    expect(stderr).toContain("not a missing dependency in this repo");
  });
});

describe("exit codes come from the tool, verbatim", () => {
  it.each([0, 1, 2, 42, 127])("propagates %i", async (expected) => {
    const dir = useFixture("wired");
    const { spawnTool } = recorder(expected);
    const { code } = await runIn(["build"], dir, { spawnTool });
    expect(code).toBe(expected);
  });
});

describe("check", () => {
  it("exits 0 on a conforming consumer", async () => {
    const { code } = await runIn(["check"], useFixture("wired"));
    expect(code).toBe(0);
  });

  it("exits 0 on a consumer with no reserved variant scripts", async () => {
    const { code } = await runIn(["check"], useFixture("minimal"));
    expect(code).toBe(0);
  });

  it("exits non-zero naming each drifted script", async () => {
    const { code, stderr } = await runIn(["check"], useFixture("drifted"));
    expect(code).not.toBe(0);
    expect(stderr).toContain('script "test"');
    expect(stderr).toContain('script "lint"');
    expect(stderr).toContain('script "test:coverage"');
    expect(stderr).toContain("3 violation(s)");
  });

  it("never spawns a tool", async () => {
    const { calls, spawnTool } = recorder();
    await runIn(["check"], useFixture("wired"), { spawnTool });
    expect(calls).toHaveLength(0);
  });
});
