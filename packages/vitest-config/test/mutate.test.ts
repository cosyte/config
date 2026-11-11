/**
 * `cosyte-mutate`: the full run and the changed-files run. The refusals come first: a run that
 * cannot start must exit 2, never 0, and a changed run must mutate exactly the changed source
 * files the config names, no more and no fewer. One case runs real StrykerJS over a two-file
 * fixture, so the options this passes are proved to reach Stryker. Every file is synthetic.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  INCREMENTAL_VARIABLE,
  MutateUnreadable,
  SHARD_VARIABLE,
  changedReportPath,
  emptyReport,
  expandMutate,
  filesInShard,
  fnv1a32,
  fullReportPath,
  loadChangeReader,
  loadConfig,
  parseMutateArgs,
  parseShard,
  runMutate,
  runStryker,
  selectChangedFiles,
  shardReportPath,
} from "../mutate.js";

const PACKAGE_DIR = join(import.meta.dirname, "..");
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "vitest-config-mutate-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(dir: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

let count = 0;
function dir(files: Record<string, string> = {}): string {
  count += 1;
  return write(join(root, `d${count}`), files);
}

const CONFIG = 'export default { mutate: ["src/**/*.ts", "!src/**/*.test.ts"] };\n';

async function run(
  cwd: string,
  argv: string[],
  overrides: Partial<Parameters<typeof runMutate>[0]> = {},
): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  // The variables a sharded run reads are left out unless a case sets them, so a suite run inside a
  // sharded run (Stryker's own workers inherit them) sees none.
  const code = await runMutate({
    argv,
    cwd,
    env: {},
    out: (t) => (out += t),
    err: (t) => (err += t),
    ...overrides,
  });
  return { code, out, err };
}

describe("parseMutateArgs", () => {
  it("reads the mode, the base and the config", () => {
    expect(parseMutateArgs(["full"])).toEqual({ mode: "full", base: null, config: DEFAULT_CONFIG });
    expect(parseMutateArgs(["changed", "--base", "origin/main", "--config", "s.mjs"])).toEqual({
      mode: "changed",
      base: "origin/main",
      config: "s.mjs",
    });
    expect(parseMutateArgs(["full", "--config", "x.mjs"]).config).toBe("x.mjs");
    expect(DEFAULT_CONFIG).toBe("stryker.config.mjs");
  });

  it("refuses what it does not know", () => {
    const cases: [string[], string][] = [
      [[], "the mode must be full or changed, not undefined"],
      [["some"], 'the mode must be full or changed, not "some"'],
      [["full", "--fast", "x"], 'unknown argument "--fast"'],
      [["full", "--config"], "--config needs a value"],
      [["changed", "--base", "--config", "x"], "--base needs a value"],
      [["changed"], "changed needs --base <ref>, the ref the change is measured against"],
      [
        ["changed", "--config", "x"],
        "changed needs --base <ref>, the ref the change is measured against",
      ],
      [["full", "--base", "main"], "full takes no --base: it mutates everything the config names"],
    ];
    for (const [argv, message] of cases) {
      expect(() => parseMutateArgs(argv), argv.join(" ")).toThrow(new MutateUnreadable(message));
    }
    expect(new MutateUnreadable("x").name).toBe("MutateUnreadable");
  });
});

describe("selectChangedFiles", () => {
  it("picks changed files a pattern names and no ! pattern excludes, relative to the run's directory", () => {
    const picked = selectChangedFiles({
      changed: [
        "packages/a/src/z.ts",
        "packages/a/src/a.ts",
        "packages/a/src/a.test.ts",
        "packages/a/README.md",
        "packages/b/src/b.ts",
        "packages/a/lib/x.ts",
      ],
      root: "/repo",
      cwd: "/repo/packages/a",
      patterns: ["src/**/*.ts", "!src/**/*.test.ts"],
    });
    expect(picked).toEqual(["src/a.ts", "src/z.ts"]);
  });

  it("picks nothing from an empty change, or from a config with no positive pattern", () => {
    expect(
      selectChangedFiles({ changed: [], root: "/r", cwd: "/r", patterns: ["**/*.ts"] }),
    ).toEqual([]);
    expect(
      selectChangedFiles({ changed: ["a.ts"], root: "/r", cwd: "/r", patterns: ["!a.ts"] }),
    ).toEqual([]);
  });

  it("never lets a ! pattern include a file, even one whose name starts with !", () => {
    expect(
      selectChangedFiles({ changed: ["!odd.ts"], root: "/r", cwd: "/r", patterns: ["!odd.ts"] }),
    ).toEqual([]);
  });

  it("excludes only by the ! patterns, and includes by any one positive pattern", () => {
    expect(
      selectChangedFiles({
        changed: ["src/a.ts", "src/a.test.ts", "lib/b.js"],
        root: "/r",
        cwd: "/r",
        patterns: ["**/*.ts", "lib/**/*.js", "!**/*.test.ts"],
      }),
    ).toEqual(["lib/b.js", "src/a.ts"]);
  });

  it("never picks a changed file outside the run's directory, even when a pattern reaches it", () => {
    expect(
      selectChangedFiles({
        changed: ["b/x.ts", "a/y.ts"],
        root: "/r",
        cwd: "/r/a",
        patterns: ["../b/*.ts", "*.ts"],
      }),
    ).toEqual(["y.ts"]);
  });

  it("works from the repository root with patterns that name a package", () => {
    expect(
      selectChangedFiles({
        changed: ["packages/s/phi-scan.js", "packages/s/test/x.test.ts", "scripts/y.js"],
        root: "/r",
        cwd: "/r",
        patterns: ["packages/s/*.js"],
      }),
    ).toEqual(["packages/s/phi-scan.js"]);
  });
});

describe("the report paths", () => {
  it("follow the config's JSON report, or Stryker's default", () => {
    expect(fullReportPath({})).toBe("reports/mutation/mutation.json");
    expect(fullReportPath({ jsonReporter: { fileName: "out/m.json" } })).toBe("out/m.json");
    expect(fullReportPath({ jsonReporter: { fileName: 3 } })).toBe(
      "reports/mutation/mutation.json",
    );
    expect(changedReportPath({})).toBe(join("reports", "mutation", "changed.json"));
    expect(changedReportPath({ jsonReporter: { fileName: "packages/s/r/m.json" } })).toBe(
      join("packages", "s", "r", "changed.json"),
    );
  });

  it("an empty report has the schema's shape, the run's directory, and no file", () => {
    expect(JSON.parse(emptyReport("/r/p"))).toEqual({
      schemaVersion: "2",
      thresholds: { high: 100, low: 90 },
      projectRoot: "/r/p",
      files: {},
    });
    expect(emptyReport("/r").endsWith("}\n")).toBe(true);
  });
});

describe("loadConfig", () => {
  it("returns the module's default export", async () => {
    const d = dir({ "s.mjs": CONFIG });
    expect(await loadConfig(join(d, "s.mjs"))).toEqual({
      mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
    });
  });

  it("refuses a config it cannot load, or one with no mutate list", async () => {
    const d = dir({
      "throws.mjs": 'throw new Error("broken config");\n',
      "none.mjs": "export const x = 1;\n",
      "nulled.mjs": "export default null;\n",
      "nomutate.mjs": "export default { mutate: 'src' };\n",
    });
    await expect(loadConfig(join(d, "gone.mjs"))).rejects.toThrow(
      new RegExp(
        `^the Stryker config ${join(d, "gone.mjs")} could not be loaded: Cannot find module`,
      ),
    );
    await expect(loadConfig(join(d, "throws.mjs"))).rejects.toThrow(
      `the Stryker config ${join(d, "throws.mjs")} could not be loaded: broken config`,
    );
    for (const file of ["none.mjs", "nulled.mjs", "nomutate.mjs"]) {
      await expect(loadConfig(join(d, file)), file).rejects.toThrow(
        new MutateUnreadable(
          `the Stryker config ${join(d, file)} exports no config with a mutate list`,
        ),
      );
    }
  });
});

describe("runMutate", () => {
  const changesOf = (files: string[], root: string) => () => ({
    root,
    base: "main",
    mergeBase: "abc",
    files: new Map(files.map((f) => [f, new Set([1])])),
  });

  it("full: removes an old report, then starts Stryker with the config", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG, "reports/mutation/mutation.json": "{}" });
    const calls: unknown[] = [];
    const r = await run(d, ["full"], {
      stryker: async (options) => {
        calls.push(options);
        expect(existsSync(join(d, "reports/mutation/mutation.json"))).toBe(false);
      },
    });
    expect(r).toEqual({
      code: 0,
      out: "cosyte-mutate: mutating everything stryker.config.mjs names\n",
      err: "",
    });
    expect(calls).toEqual([{ configFile: join(d, DEFAULT_CONFIG) }]);
  });

  it("changed: starts Stryker over the changed source files, writing changed.json", async () => {
    const d = dir({ "s.mjs": CONFIG, "reports/mutation/changed.json": "{}" });
    const calls: unknown[] = [];
    const r = await run(d, ["changed", "--base", "main", "--config", "s.mjs"], {
      changes: changesOf(["src/b.ts", "src/a.ts", "src/a.test.ts", "docs/x.md"], d),
      stryker: async (options) => {
        calls.push(options);
        expect(existsSync(join(d, "reports/mutation/changed.json"))).toBe(false);
      },
    });
    expect(r).toEqual({
      code: 0,
      out: "cosyte-mutate: mutating 2 changed file(s) against main:\n  src/a.ts\n  src/b.ts\n",
      err: "",
    });
    expect(calls).toEqual([
      {
        configFile: join(d, "s.mjs"),
        mutate: ["src/a.ts", "src/b.ts"],
        jsonReporter: { fileName: join("reports", "mutation", "changed.json") },
        htmlReporter: { fileName: join("reports", "mutation", "changed.html") },
      },
    ]);
  });

  it("changed: with no changed source file, starts nothing, writes an empty report, and exits 0", async () => {
    const d = dir({
      [DEFAULT_CONFIG]:
        'export default { mutate: ["src/**/*.ts"], jsonReporter: { fileName: "out/deep/m.json" } };\n',
    });
    const r = await run(d, ["changed", "--base", "origin/main"], {
      changes: changesOf(["README.md"], d),
      stryker: async () => {
        throw new Error("must not start");
      },
    });
    expect(r).toEqual({
      code: 0,
      out: `cosyte-mutate: no changed source file against origin/main; nothing to mutate. Wrote an empty ${join("out", "deep", "changed.json")}.\n`,
      err: "",
    });
    expect(readFileSync(join(d, "out/deep/changed.json"), "utf8")).toBe(emptyReport(d));
  });

  it("passes the base and the working directory to the change reader", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG });
    const seen: unknown[] = [];
    await run(d, ["changed", "--base", "origin/dev"], {
      changes: (opts) => {
        seen.push(opts);
        return changesOf([], d)();
      },
    });
    expect(seen).toEqual([{ base: "origin/dev", cwd: d }]);
  });

  it("exits 2, saying why, when it cannot run", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG });
    expect(await run(d, ["sideways"])).toEqual({
      code: 2,
      out: "",
      err: 'cosyte-mutate: could not run: the mode must be full or changed, not "sideways"\n',
    });
    const noConfig = await run(dir(), ["full"]);
    expect(noConfig.code).toBe(2);
    expect(noConfig.err).toMatch(
      /^cosyte-mutate: could not run: the Stryker config .* could not be loaded: /,
    );
    const unknownBase = await run(d, ["changed", "--base", "no-such-ref-anywhere"], {
      changes: () => {
        throw new (class extends Error {})("x");
      },
    });
    expect(unknownBase.code).toBe(2);
    const failed = await run(d, ["full"], {
      stryker: async () => {
        throw new Error("Stryker failed");
      },
    });
    expect(failed.code).toBe(2);
    expect(failed.err).toMatch(/^cosyte-mutate: could not run: Error: Stryker failed\n {4}at /);
    const odd = await run(d, ["full"], {
      stryker: async () => {
        throw "a string";
      },
    });
    expect(odd.err).toBe("cosyte-mutate: could not run: a string\n");
    const nothing = await run(d, ["full"], {
      stryker: async () => {
        throw undefined;
      },
    });
    expect(nothing).toEqual({
      code: 2,
      out: "cosyte-mutate: mutating everything stryker.config.mjs names\n",
      err: "cosyte-mutate: could not run: undefined\n",
    });
  });

  it("names git's own complaint when the change cannot be read", async () => {
    const outside = mkdtempSync(join(tmpdir(), "vitest-config-not-a-repo-"));
    try {
      write(outside, { [DEFAULT_CONFIG]: CONFIG });
      const r = await run(outside, ["changed", "--base", "main"]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(
        /^cosyte-mutate: could not run: not inside a git repository: git rev-parse --show-toplevel failed: /,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("prints its help with --help or -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const r = await run(root, ["changed", flag]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(
        /^cosyte-mutate: run StrykerJS with the shared config, over everything or over a change\./,
      );
      expect(r.out).toContain("default stryker.config.mjs, relative");
    }
  });
});

describe("@cosyte/script-utils is an optional peer, loaded only by a changed run", () => {
  it("is declared an optional peer, not a dependency", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
    expect(pkg.dependencies?.["@cosyte/script-utils"]).toBeUndefined();
    expect(pkg.peerDependencies["@cosyte/script-utils"]).toBe("workspace:^");
    expect(pkg.peerDependenciesMeta["@cosyte/script-utils"]).toEqual({ optional: true });
  });

  it("loads readChanges from @cosyte/script-utils/changes, and names the package when it is missing", async () => {
    const asked: string[] = [];
    const readChanges = () => ({ root: "/", files: new Map() });
    expect(
      await loadChangeReader(async (specifier) => {
        asked.push(specifier);
        return { readChanges };
      }),
    ).toBe(readChanges);
    expect(asked).toEqual(["@cosyte/script-utils/changes"]);
    expect(typeof (await loadChangeReader())).toBe("function");
    await expect(
      loadChangeReader(async () => {
        throw new Error("Cannot find package");
      }),
    ).rejects.toThrow(
      new MutateUnreadable(
        "a changed run reads what a change touched with @cosyte/script-utils, an optional peer dependency of @cosyte/vitest-config; install it beside this package (Cannot find package)",
      ),
    );
  });

  it("loads and runs a full run without it, and refuses a changed run, naming it", () => {
    // A copy of the two modules outside this workspace, where @cosyte/script-utils cannot resolve.
    const d = mkdtempSync(join(tmpdir(), "vitest-config-no-peer-"));
    try {
      for (const file of ["mutate.js", "stryker.js"]) {
        copyFileSync(join(PACKAGE_DIR, file), join(d, file));
      }
      write(d, {
        "package.json": '{ "type": "module" }\n',
        [DEFAULT_CONFIG]: CONFIG,
      });
      const script = [
        'import { runMutate } from "./mutate.js";',
        "const io = { cwd: process.cwd(), out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) };",
        'const full = await runMutate({ ...io, argv: ["full"], stryker: async () => {} });',
        'const changed = await runMutate({ ...io, argv: ["changed", "--base", "main"] });',
        "process.stdout.write(`\\nexit ${full} ${changed}\\n`);",
      ].join("\n");
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: d,
        encoding: "utf8",
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("\nexit 0 2\n");
      expect(r.stderr).toMatch(
        /^cosyte-mutate: could not run: a changed run reads what a change touched with @cosyte\/script-utils, an optional peer dependency of @cosyte\/vitest-config; install it beside this package \([\s\S]+\)\n$/,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// The stand-in for `cosyte-mutate` that the shared weekly mutation workflow was proved against
// (test/fixtures/quality-stubs/stubs.mjs in cosyte/.github) shards by this hash over this file list.
// Both are copied here unchanged, so a test can hold this tool to the same partition.
function stubHashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
function stubSourceFiles(cwd: string, dir = join(cwd, "src")): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...stubSourceFiles(cwd, path));
    else if (entry.name.endsWith(".mjs")) found.push(relative(cwd, path).split(sep).join("/"));
  }
  return found.sort();
}

/** Synthetic source paths, enough that every one of 16 shards gets some. */
const MANY = Array.from({ length: 300 }, (_, i) => `src/m${i % 7}/file-${i}.ts`);

/** Every shard of `n`, each as the list of files it holds. */
function shardsOf(files: string[], n: number): string[][] {
  return Array.from({ length: n }, (_, i) => filesInShard(files, { k: i + 1, n }));
}

const SHARD_REFUSAL = (value: string) =>
  `COSYTE_MUTATE_SHARD must be <k>/<n>, two whole numbers with 1 <= k <= n, not ${JSON.stringify(value)}`;

describe("parseShard", () => {
  it("reads <k>/<n>, and reads unset or empty as no shard", () => {
    expect(parseShard(undefined)).toBeNull();
    expect(parseShard("")).toBeNull();
    expect(parseShard("1/1")).toEqual({ k: 1, n: 1 });
    expect(parseShard("3/8")).toEqual({ k: 3, n: 8 });
    expect(parseShard("16/16")).toEqual({ k: 16, n: 16 });
    expect(parseShard("08/16")).toEqual({ k: 8, n: 16 });
  });

  it("refuses a value that is not two positive whole numbers with k at most n", () => {
    for (const value of [
      "0/1",
      "2/1",
      "1/0",
      "0/0",
      "-1/2",
      "1/-2",
      "a/b",
      "1",
      "1/2/3",
      " 1/2",
      "1/2 ",
      "1/2\n",
      "x1/2",
      "1.5/2",
      "1/2.0",
      "/2",
      "1/",
      "+1/2",
      "1 of 2",
    ]) {
      expect(() => parseShard(value), JSON.stringify(value)).toThrow(
        new MutateUnreadable(SHARD_REFUSAL(value)),
      );
    }
    expect(SHARD_VARIABLE).toBe("COSYTE_MUTATE_SHARD");
    expect(INCREMENTAL_VARIABLE).toBe("COSYTE_MUTATE_INCREMENTAL_FILE");
  });
});

describe("fnv1a32, the hash a file's shard is read from", () => {
  it("is 32-bit FNV-1a over the UTF-8 bytes", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("matches the stand-in's hash on the same paths, non-ASCII ones included", () => {
    const paths = [
      ...MANY,
      "src/index.mjs",
      "src/greeting.mjs",
      "packages/script-utils/phi-scan.js",
      "src/café.ts",
      "src/日本/語.ts",
      "src/😀.ts",
      `src/${"deep/".repeat(40)}x.ts`,
    ];
    for (const path of paths) expect(fnv1a32(path), path).toBe(stubHashOf(path));
  });
});

describe("expandMutate", () => {
  it("lists the files under the run's directory the config names, as selectChangedFiles picks them", () => {
    const d = dir({
      "src/b.ts": "",
      "src/a.ts": "",
      "src/a.test.ts": "",
      "src/deep/c.ts": "",
      "src/node_modules/x.ts": "",
      "node_modules/p/src/y.ts": "",
      ".git/src/z.ts": "",
      ".stryker-tmp/sandbox-1/src/a.ts": "",
      "lib/q.ts": "",
      "README.md": "",
    });
    expect(expandMutate({ cwd: d, patterns: ["**/*.ts", "!**/*.test.ts"] })).toEqual([
      "lib/q.ts",
      "src/a.ts",
      "src/b.ts",
      "src/deep/c.ts",
    ]);
    // A pattern that names a skipped directory outright still finds nothing in it.
    expect(
      expandMutate({
        cwd: d,
        patterns: [".git/**/*.ts", ".stryker-tmp/**/*.ts", "node_modules/**/*.ts"],
      }),
    ).toEqual([]);
    expect(expandMutate({ cwd: dir({ "only.md": "" }), patterns: ["**"] })).toEqual(["only.md"]);
    expect(expandMutate({ cwd: d, patterns: ["src/**/*.ts", "!src/**/*.test.ts"] })).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/deep/c.ts",
    ]);
  });

  it("skips the temp directory the config names, and only that one", () => {
    const d = dir({
      "work/tmp/a.ts": "",
      ".stryker-tmp/b.ts": "",
      "src/work/tmp/c.ts": "",
    });
    const patterns = ["**/*.ts", ".stryker-tmp/*.ts"];
    expect(expandMutate({ cwd: d, patterns })).toEqual(["src/work/tmp/c.ts", "work/tmp/a.ts"]);
    expect(expandMutate({ cwd: d, patterns, tempDirName: "./work/tmp/" })).toEqual([
      ".stryker-tmp/b.ts",
      "src/work/tmp/c.ts",
    ]);
  });

  it("lists nothing when no file matches", () => {
    expect(expandMutate({ cwd: dir({ "a.md": "" }), patterns: ["src/**/*.ts"] })).toEqual([]);
  });

  it("never follows a symbolic link, and reads a relative working directory from the process's", () => {
    const outside = dir({ "src/far.ts": "" });
    const d = dir({ "src/near.ts": "" });
    symlinkSync(join(outside, "src"), join(d, "src", "linked"), "dir");
    symlinkSync(join(outside, "src", "far.ts"), join(d, "src", "file-link.ts"));
    expect(expandMutate({ cwd: d, patterns: ["src/**/*.ts"] })).toEqual(["src/near.ts"]);
    expect(expandMutate({ cwd: relative(process.cwd(), d), patterns: ["src/**/*.ts"] })).toEqual([
      "src/near.ts",
    ]);
  });
});

describe("filesInShard", () => {
  it("puts every file in exactly one shard, for 1, 2, 8 and 16 shards", () => {
    for (const n of [1, 2, 8, 16]) {
      const shards = shardsOf(MANY, n);
      const all = shards.flat();
      expect(all.length, `n=${n}`).toBe(MANY.length);
      expect(new Set(all).size, `n=${n}`).toBe(MANY.length);
      expect([...all].sort(), `n=${n}`).toEqual([...MANY].sort());
      shards.forEach((files, i) => {
        for (const file of files) expect(fnv1a32(file) % n, file).toBe(i);
      });
      if (n > 1)
        expect(
          shards.every((files) => files.length < MANY.length),
          `n=${n}`,
        ).toBe(true);
    }
    expect(filesInShard(MANY, { k: 1, n: 1 })).toEqual(MANY);
  });

  it("picks each shard's files exactly as the stand-in does", () => {
    const files: Record<string, string> = { "src/README.md": "", "test/t.mjs": "" };
    for (let i = 0; i < 40; i += 1) files[`src/${i % 3 === 0 ? "nested/" : ""}m${i}.mjs`] = "";
    const d = dir(files);
    const ours = expandMutate({ cwd: d, patterns: ["src/**/*.mjs"] });
    expect(ours).toEqual(stubSourceFiles(d));
    for (const n of [1, 2, 3, 8, 16]) {
      for (let k = 1; k <= n; k += 1) {
        expect(filesInShard(ours, { k, n }), `${k}/${n}`).toEqual(
          stubSourceFiles(d).filter((file) => stubHashOf(file) % n === k - 1),
        );
      }
    }
  });
});

describe("shardReportPath", () => {
  it("is shard-<k>-of-<n>.json beside the full report", () => {
    expect(shardReportPath({}, { k: 3, n: 8 })).toBe(
      join("reports", "mutation", "shard-3-of-8.json"),
    );
    expect(
      shardReportPath(
        { jsonReporter: { fileName: "packages/s/reports/mutation/mutation.json" } },
        { k: 1, n: 2 },
      ),
    ).toBe(join("packages", "s", "reports", "mutation", "shard-1-of-2.json"));
  });
});

describe("runMutate, a sharded or incremental full run", () => {
  const SOURCES: Record<string, string> = { "src/a.test.ts": "", "docs/x.md": "" };
  // Ten files, fewer than 16 shards, so a run of 16 has empty shards.
  for (let i = 0; i < 10; i += 1) SOURCES[`src/f${i}.ts`] = "";
  const ALL = Object.keys(SOURCES)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();

  it("mutates only its shard's files and writes shard-<k>-of-<n>.json, never mutation.json", async () => {
    const d = dir({
      [DEFAULT_CONFIG]: CONFIG,
      ...SOURCES,
      "reports/mutation/mutation.json": "{}",
      "reports/mutation/shard-2-of-3.json": "{}",
    });
    const calls: unknown[] = [];
    const r = await run(d, ["full"], {
      env: { [SHARD_VARIABLE]: "2/3" },
      stryker: async (options) => {
        calls.push(options);
        expect(existsSync(join(d, "reports/mutation/shard-2-of-3.json"))).toBe(false);
      },
    });
    const mine = filesInShard(ALL, { k: 2, n: 3 });
    expect(mine.length).toBeGreaterThan(0);
    expect(r).toEqual({
      code: 0,
      out:
        `cosyte-mutate: shard 2 of 3: mutating ${mine.length} of the ${ALL.length} file(s) stryker.config.mjs names:\n` +
        mine.map((f) => `  ${f}\n`).join(""),
      err: "",
    });
    expect(calls).toEqual([
      {
        configFile: join(d, DEFAULT_CONFIG),
        mutate: mine,
        jsonReporter: { fileName: join("reports", "mutation", "shard-2-of-3.json") },
        htmlReporter: { fileName: join("reports", "mutation", "shard-2-of-3.html") },
      },
    ]);
    expect(readFileSync(join(d, "reports/mutation/mutation.json"), "utf8")).toBe("{}");
  });

  it("partitions the files across the shards: each in exactly one, for 1, 2, 8 and 16 shards", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG, ...SOURCES });
    for (const n of [1, 2, 8, 16]) {
      const mutated: string[] = [];
      let empty = 0;
      for (let k = 1; k <= n; k += 1) {
        let started = false;
        const r = await run(d, ["full"], {
          env: { [SHARD_VARIABLE]: `${k}/${n}` },
          stryker: async (options) => {
            started = true;
            mutated.push(...(options["mutate"] as string[]));
          },
        });
        expect(r.code, `${k}/${n}`).toBe(0);
        const report = join(d, "reports", "mutation", `shard-${k}-of-${n}.json`);
        if (!started) {
          empty += 1;
          expect(readFileSync(report, "utf8"), `${k}/${n}`).toBe(emptyReport(d));
        }
      }
      expect(mutated.length, `n=${n}`).toBe(ALL.length);
      expect([...mutated].sort(), `n=${n}`).toEqual(ALL);
      if (n === 16) expect(empty).toBeGreaterThan(0);
    }
    expect(existsSync(join(d, "reports/mutation/mutation.json"))).toBe(false);
  });

  it("an empty shard writes the empty report where its shard report goes, starts nothing, and exits 0", async () => {
    const d = dir({
      [DEFAULT_CONFIG]:
        'export default { mutate: ["src/**/*.ts"], jsonReporter: { fileName: "out/deep/m.json" } };\n',
      "out/deep/shard-1-of-1.json": "{}",
    });
    const r = await run(d, ["full"], {
      env: { [SHARD_VARIABLE]: "1/1", [INCREMENTAL_VARIABLE]: "reports/mutation/incremental.json" },
      stryker: async () => {
        throw new Error("must not start");
      },
    });
    expect(r).toEqual({
      code: 0,
      out: `cosyte-mutate: shard 1 of 1 holds none of the 0 file(s) stryker.config.mjs names; nothing to mutate. Wrote an empty ${join("out", "deep", "shard-1-of-1.json")}.\n`,
      err: "",
    });
    expect(readFileSync(join(d, "out/deep/shard-1-of-1.json"), "utf8")).toBe(emptyReport(d));
    expect(existsSync(join(d, "out/deep/m.json"))).toBe(false);
  });

  it("exits 2 on a malformed shard, before it starts or writes anything", async () => {
    for (const value of ["0/2", "3/2", "1/0", "x", "1/2/3"]) {
      const d = dir({ [DEFAULT_CONFIG]: CONFIG, ...SOURCES });
      const r = await run(d, ["full"], {
        env: { [SHARD_VARIABLE]: value },
        stryker: async () => {
          throw new Error("must not start");
        },
      });
      expect(r, value).toEqual({
        code: 2,
        out: "",
        err: `cosyte-mutate: could not run: ${SHARD_REFUSAL(value)}\n`,
      });
      expect(existsSync(join(d, "reports")), value).toBe(false);
    }
  });

  it("passes incremental: true and the incremental file to Stryker, sharded or not", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG, ...SOURCES });
    const calls: Record<string, unknown>[] = [];
    const stryker = async (options: Record<string, unknown>) => {
      calls.push(options);
    };
    const whole = await run(d, ["full"], {
      env: { [INCREMENTAL_VARIABLE]: "reports/mutation/incremental.json" },
      stryker,
    });
    expect(whole).toEqual({
      code: 0,
      out:
        "cosyte-mutate: mutating everything stryker.config.mjs names\n" +
        "cosyte-mutate: incremental results read from and written to reports/mutation/incremental.json\n",
      err: "",
    });
    const sharded = await run(d, ["full"], {
      env: { [SHARD_VARIABLE]: "1/2", [INCREMENTAL_VARIABLE]: "inc/i.json" },
      stryker,
    });
    expect(sharded.code).toBe(0);
    expect(sharded.out).toContain(
      "cosyte-mutate: incremental results read from and written to inc/i.json\n",
    );
    expect(calls).toEqual([
      {
        configFile: join(d, DEFAULT_CONFIG),
        incremental: true,
        incrementalFile: join(d, "reports/mutation/incremental.json"),
      },
      {
        configFile: join(d, DEFAULT_CONFIG),
        mutate: filesInShard(ALL, { k: 1, n: 2 }),
        jsonReporter: { fileName: join("reports", "mutation", "shard-1-of-2.json") },
        htmlReporter: { fileName: join("reports", "mutation", "shard-1-of-2.html") },
        incremental: true,
        incrementalFile: join(d, "inc/i.json"),
      },
    ]);
  });

  it("with both variables unset or empty, runs exactly as an unsharded full run always has", async () => {
    for (const env of [{}, { [SHARD_VARIABLE]: "", [INCREMENTAL_VARIABLE]: "" }]) {
      const d = dir({
        [DEFAULT_CONFIG]: CONFIG,
        ...SOURCES,
        "reports/mutation/mutation.json": "{}",
      });
      const calls: unknown[] = [];
      const r = await run(d, ["full"], {
        env,
        stryker: async (options) => {
          calls.push(options);
          expect(existsSync(join(d, "reports/mutation/mutation.json"))).toBe(false);
        },
      });
      expect(r).toEqual({
        code: 0,
        out: "cosyte-mutate: mutating everything stryker.config.mjs names\n",
        err: "",
      });
      expect(calls).toEqual([{ configFile: join(d, DEFAULT_CONFIG) }]);
    }
  });

  it("a changed run reads neither variable", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG });
    const calls: unknown[] = [];
    const r = await run(d, ["changed", "--base", "main"], {
      env: { [SHARD_VARIABLE]: "nonsense", [INCREMENTAL_VARIABLE]: "i.json" },
      changes: () => ({ root: d, files: new Map([["src/a.ts", new Set([1])]]) }),
      stryker: async (options) => {
        calls.push(options);
      },
    });
    expect(r.code).toBe(0);
    expect(calls).toEqual([
      {
        configFile: join(d, DEFAULT_CONFIG),
        mutate: ["src/a.ts"],
        jsonReporter: { fileName: join("reports", "mutation", "changed.json") },
        htmlReporter: { fileName: join("reports", "mutation", "changed.html") },
      },
    ]);
  });

  it("reads the variables from the process's environment when it is given none", async () => {
    const d = dir({ [DEFAULT_CONFIG]: CONFIG });
    const before = process.env[SHARD_VARIABLE];
    process.env[SHARD_VARIABLE] = "2/1";
    try {
      let err = "";
      const code = await runMutate({
        argv: ["full"],
        cwd: d,
        out: () => {},
        err: (t) => (err += t),
        stryker: async () => {},
      });
      expect(code).toBe(2);
      expect(err).toBe(`cosyte-mutate: could not run: ${SHARD_REFUSAL("2/1")}\n`);
    } finally {
      if (before === undefined) delete process.env[SHARD_VARIABLE];
      else process.env[SHARD_VARIABLE] = before;
    }
  });
});

describe("runStryker, for real", () => {
  it("runs StrykerJS over a fixture and writes the changed report where it was told", async () => {
    // The fixture sits inside this package so Vitest and the runner resolve from its node_modules.
    const d = mkdtempSync(join(PACKAGE_DIR, ".e2e-"));
    try {
      write(d, {
        "package.json": '{ "type": "module" }\n',
        // StrykerJS loads the config outside Vitest. A copy of the module keeps that load off the
        // instrumented stryker.js, whose coverage would otherwise be merged with it, line for line.
        "stryker-copy.js": readFileSync(join(PACKAGE_DIR, "stryker.js"), "utf8"),
        "src/sum.ts": "export function sum(a: number, b: number): number {\n  return a + b;\n}\n",
        "test/sum.test.ts":
          'import { expect, it } from "vitest";\nimport { sum } from "../src/sum.js";\nit("adds", () => expect(sum(2, 3)).toBe(5));\n',
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n',
        "stryker.config.mjs":
          'import { cosyteStryker } from "./stryker-copy.js";\nexport default cosyteStryker({ stryker: { concurrency: 1, reporters: ["json"] } });\n',
      });
      const config = join(d, "stryker.config.mjs");
      const cwd = process.cwd();
      // Stryker reads its files from the working directory; this test restores it.
      process.chdir(d);
      try {
        await runStryker({
          configFile: config,
          mutate: ["src/sum.ts"],
          jsonReporter: { fileName: "reports/mutation/changed.json" },
        });
      } finally {
        process.chdir(cwd);
      }
      const report = JSON.parse(readFileSync(join(d, "reports/mutation/changed.json"), "utf8"));
      expect(Object.keys(report.files)).toEqual(["src/sum.ts"]);
      const statuses = report.files["src/sum.ts"].mutants.map((m: { status: string }) => m.status);
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.every((s: string) => s === "Killed")).toBe(true);
      expect(existsSync(join(d, "reports/mutation/mutation.json"))).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }, 120_000);

  it("runs one shard of a full run with incremental results, writing the shard report and the results file", async () => {
    const d = mkdtempSync(join(PACKAGE_DIR, ".e2e-"));
    try {
      write(d, {
        "package.json": '{ "type": "module" }\n',
        // StrykerJS loads the config outside Vitest. A copy of the module keeps that load off the
        // instrumented stryker.js, whose coverage would otherwise be merged with it, line for line.
        "stryker-copy.js": readFileSync(join(PACKAGE_DIR, "stryker.js"), "utf8"),
        "src/sum.ts": "export function sum(a: number, b: number): number {\n  return a + b;\n}\n",
        "test/sum.test.ts":
          'import { expect, it } from "vitest";\nimport { sum } from "../src/sum.js";\nit("adds", () => expect(sum(2, 3)).toBe(5));\n',
        "vitest.config.ts":
          'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n',
        "stryker.config.mjs":
          'import { cosyteStryker } from "./stryker-copy.js";\nexport default cosyteStryker({ stryker: { concurrency: 1, reporters: ["json"] } });\n',
      });
      const cwd = process.cwd();
      process.chdir(d);
      let r;
      try {
        r = await run(d, ["full"], {
          env: {
            [SHARD_VARIABLE]: "1/1",
            [INCREMENTAL_VARIABLE]: "reports/mutation/incremental.json",
          },
          stryker: runStryker,
        });
      } finally {
        process.chdir(cwd);
      }
      expect(r.code, r.err).toBe(0);
      const report = JSON.parse(
        readFileSync(join(d, "reports/mutation/shard-1-of-1.json"), "utf8"),
      );
      expect(Object.keys(report.files)).toEqual(["src/sum.ts"]);
      const incremental = JSON.parse(
        readFileSync(join(d, "reports/mutation/incremental.json"), "utf8"),
      );
      expect(Object.keys(incremental.files)).toEqual(["src/sum.ts"]);
      expect(existsSync(join(d, "reports/mutation/mutation.json"))).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("the bin", () => {
  const BIN = join(PACKAGE_DIR, "bin", "cosyte-mutate.js");
  const bin = (args: string[], env: NodeJS.ProcessEnv, cwd = root) =>
    spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8" });
  const noCi = () => {
    const env = { ...process.env };
    delete env["CI"];
    delete env[SHARD_VARIABLE];
    delete env[INCREMENTAL_VARIABLE];
    delete env[SHARD_VARIABLE];
    delete env[INCREMENTAL_VARIABLE];
    return env;
  };

  it("prints its help at a terminal and refuses it under CI", () => {
    const ok = bin(["--help"], noCi());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^cosyte-mutate: run StrykerJS/);
    for (const ci of ["", "false", "0"])
      expect(bin(["-h"], { ...noCi(), CI: ci }).status, ci).toBe(0);
    const refused = bin(["--help"], { ...noCi(), CI: "true" });
    expect(refused.status).toBe(2);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("cosyte-mutate: refusing --help under CI (CI=true).");
  });

  it("exits 2 with the reason when it cannot run, and 0 on a change with nothing to mutate", () => {
    const bad = bin(["full"], noCi(), dir());
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/^cosyte-mutate: could not run: the Stryker config /);
    const out = dir();
    const config = join(
      dir({
        "s.mjs": `export default { mutate: ["nothing-here/**"], jsonReporter: { fileName: ${JSON.stringify(join(out, "m.json"))} } };\n`,
      }),
      "s.mjs",
    );
    // Run inside this repository, so git can answer; nothing it changed is under nothing-here/.
    const empty = bin(["changed", "--base", "HEAD", "--config", config], noCi(), PACKAGE_DIR);
    expect(empty.status, empty.stderr).toBe(0);
    expect(empty.stdout).toBe(
      `cosyte-mutate: no changed source file against HEAD; nothing to mutate. Wrote an empty ${join(out, "changed.json")}.\n`,
    );
    expect(JSON.parse(readFileSync(join(out, "changed.json"), "utf8")).files).toEqual({});
  });
});
