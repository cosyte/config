import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { gunzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, ensureBuilt, makeTempDir, runCli } from "./helpers.js";
import { DOCS_ARTIFACT, PACK_DOCS_INPUTS, packDocs, SOURCE_ARTIFACT } from "../src/pack-docs.js";
import { run } from "../src/run.js";

/**
 * The canonical docs-artifact build.
 *
 * The archives are read back with the system `tar`, never with the writer that produced them: an
 * archive this package can read and nothing else is not an artifact a release job can consume.
 */

beforeAll(ensureBuilt);
afterAll(cleanupTempDirs);

/** A line the diagnostics must never echo: it stands in for whatever a consumer's files carry. */
const SENTINEL = "SENTINEL-DOCS-CONTENT-THAT-MUST-NOT-BE-PRINTED";

/** A stack frame, as an unhandled exception prints it. A refusal carries none. */
const STACK_FRAME = /\n\s+at \S+/;

/** A member name too long for the archive format, with no directory boundary that splits it. */
const UNREPRESENTABLE = `${"a".repeat(120)}.ts`;

/** The files a complete package tree carries, relative to its root. */
const TREE: Readonly<Record<string, string>> = {
  "docs-content/intro.md": `# Intro\n\n${SENTINEL}\n`,
  "docs-content/sidebars.json": '{ "docs": ["intro"] }\n',
  "docs-content/guides/using.md": "# Using\n",
  "src/index.ts": "export const answer = 42;\n",
  "src/lib/util.ts": "export const helper = true;\n",
  "package.json": '{ "name": "consumer", "version": "1.0.0", "private": true }\n',
  "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
  "README.md": "# Not an artifact input\n",
  "test/unit.test.ts": "// not packed\n",
};

/** A complete package tree, minus whichever paths the caller names (a directory takes its files). */
function tree(without: readonly string[] = []): string {
  const dir = join(makeTempDir("cosyte-process-pack-docs-"), "consumer");
  const omitted = (path: string): boolean =>
    without.some((entry) => path === entry || path.startsWith(`${entry}/`));
  for (const [path, content] of Object.entries(TREE)) {
    if (omitted(path)) continue;
    const absolute = join(dir, ...path.split("/"));
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The member names inside a tarball, read with the system tar. */
function members(archive: string): string[] {
  return execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "")
    .sort();
}

/** Extract a tarball into a fresh directory and return it. */
function extract(archive: string): string {
  const into = makeTempDir("cosyte-process-extract-");
  execFileSync("tar", ["-xzf", archive, "-C", into]);
  return into;
}

/** Run the bin in-process, collecting stderr. */
async function runIn(
  argv: readonly string[],
  cwd: string,
): Promise<{ code: number; stderr: string }> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await run(argv, { cwd, stderr: stream });
  return { code, stderr: Buffer.concat(chunks).toString("utf8") };
}

describe("AC-C5: the two artifacts, with the member sets the contract names", () => {
  it("writes both archives into dist-artifacts when no output directory is given", async () => {
    const dir = tree();
    expect((await runIn(["pack-docs"], dir)).code).toBe(0);
    expect(existsSync(join(dir, "dist-artifacts", DOCS_ARTIFACT))).toBe(true);
    expect(existsSync(join(dir, "dist-artifacts", SOURCE_ARTIFACT))).toBe(true);
  });

  it("carries the contents of docs-content at the tarball root, and nothing else", async () => {
    const dir = tree();
    await runIn(["pack-docs"], dir);
    expect(members(join(dir, "dist-artifacts", DOCS_ARTIFACT))).toEqual([
      "guides/using.md",
      "intro.md",
      "sidebars.json",
    ]);
  });

  it("carries src/, package.json and tsconfig.json at the tarball root, and nothing else", async () => {
    const dir = tree();
    await runIn(["pack-docs"], dir);
    expect(members(join(dir, "dist-artifacts", SOURCE_ARTIFACT))).toEqual([
      "package.json",
      "src/index.ts",
      "src/lib/util.ts",
      "tsconfig.json",
    ]);
  });

  it("preserves the bytes of every member", async () => {
    const dir = tree();
    await runIn(["pack-docs"], dir);
    const docs = extract(join(dir, "dist-artifacts", DOCS_ARTIFACT));
    const source = extract(join(dir, "dist-artifacts", SOURCE_ARTIFACT));
    expect(readFileSync(join(docs, "intro.md"), "utf8")).toBe(TREE["docs-content/intro.md"]);
    expect(readFileSync(join(docs, "guides", "using.md"), "utf8")).toBe(
      TREE["docs-content/guides/using.md"],
    );
    expect(readFileSync(join(source, "src", "lib", "util.ts"), "utf8")).toBe(
      TREE["src/lib/util.ts"],
    );
    expect(readFileSync(join(source, "tsconfig.json"), "utf8")).toBe(TREE["tsconfig.json"]);
  });

  it("writes into the directory named by the first positional argument", async () => {
    const dir = tree();
    expect((await runIn(["pack-docs", "build/artifacts"], dir)).code).toBe(0);
    expect(existsSync(join(dir, "build", "artifacts", DOCS_ARTIFACT))).toBe(true);
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });
});

describe("AC-C6: a missing input refuses the run before anything is written", () => {
  it.each(PACK_DOCS_INPUTS.map((input) => input.path))(
    "refuses a tree with no %s, naming it, and writes no output directory",
    async (missing) => {
      const dir = tree([missing]);
      const result = await runIn(["pack-docs"], dir);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(missing);
      expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
    },
  );

  it("refuses a docs-content directory that has lost only its sidebars", async () => {
    const dir = tree();
    rmSync(join(dir, "docs-content", "sidebars.json"));
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("docs-content/sidebars.json");
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it("refuses a src that is a file rather than a directory", async () => {
    const dir = tree(["src/index.ts", "src/lib/util.ts"]);
    writeFileSync(join(dir, "src"), "not a directory\n");
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("src (directory)");
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it("names every missing input, not only the first", async () => {
    const dir = tree(["docs-content/intro.md", "tsconfig.json"]);
    const result = await runIn(["pack-docs"], dir);
    expect(result.stderr).toContain("docs-content/intro.md");
    expect(result.stderr).toContain("tsconfig.json");
  });
});

describe("AC-C10: diagnostics reach stderr only, and carry no file content", () => {
  it("writes the diagnostic to stderr and nothing to stdout", () => {
    const dir = tree(["tsconfig.json"]);
    const result = runCli(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pack-docs");
  });

  it("names the path, the entry point and the action available", () => {
    const dir = tree(["tsconfig.json"]);
    const result = runCli(["pack-docs"], dir);
    expect(result.stderr).toContain(dir);
    expect(result.stderr).toContain("tsconfig.json");
    expect(result.stderr).toContain("run cosyte-process pack-docs");
    expect(result.stderr).toContain("Nothing was written.");
  });

  it("never echoes the content of the files it read", () => {
    const dir = tree(["tsconfig.json"]);
    const result = runCli(["pack-docs"], dir);
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stdout).not.toContain(SENTINEL);
  });

  it("puts the success report on stderr too, leaving stdout empty", () => {
    const dir = tree();
    const result = runCli(["pack-docs"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(DOCS_ARTIFACT);
  });

  it("refuses a second positional argument rather than ignoring it", () => {
    const dir = tree();
    const result = runCli(["pack-docs", "one", "two"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pack-docs takes at most one output directory");
  });

  // AC-C10's trigger is "for any reason", and this is the arm no required-input check describes:
  // every input is present and the output directory itself cannot be made, which is what a stale
  // file left under that name produces.
  it("refuses an output path that is already a file, rather than crashing", () => {
    const dir = tree();
    const stale = join(dir, "dist-artifacts");
    writeFileSync(stale, "left behind by something that was not this command\n");
    const result = runCli(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pack-docs");
    expect(result.stderr).toContain(stale);
    expect(result.stderr).toContain("EEXIST");
    expect(result.stderr).toContain("run cosyte-process pack-docs again");
    // A stack trace names no action and is not a refusal, whatever exit code follows it.
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stderr).not.toContain(SENTINEL);
    expect(readFileSync(stale, "utf8")).toContain("left behind");
  });
});

// AC-C6, AC-C10: the fail-fast property this command states about itself, at the point where the
// two archives differ. Both are built before the output directory is created, so a member the
// archive format cannot carry refuses with the tree exactly as it was found rather than with the
// first archive already written where a release job would find it.
describe("a refusal while building an archive leaves no half-built artifact set", () => {
  it("refuses a source path the archive format cannot carry, naming the member", () => {
    const dir = tree();
    writeFileSync(join(dir, "src", UNREPRESENTABLE), "export const x = 1;\n");
    const result = runCli(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pack-docs");
    expect(result.stderr).toContain(UNREPRESENTABLE);
    expect(result.stderr).toContain("shorten the path");
    expect(result.stderr).toContain("Nothing was written.");
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(result.stderr).not.toContain(SENTINEL);
  });

  it("writes neither the output directory nor the archive that did build", () => {
    const dir = tree();
    writeFileSync(join(dir, "src", UNREPRESENTABLE), "export const x = 1;\n");
    // The docs archive builds cleanly from this tree; only the source archive cannot be built. The
    // directory holding both is what must not exist afterwards.
    expect(runCli(["pack-docs"], dir).code).toBe(1);
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });
});

/** Write a `cosyte-process.config.json` into a tree. */
function configure(dir: string, config: unknown): void {
  writeFileSync(join(dir, "cosyte-process.config.json"), `${JSON.stringify(config)}\n`);
}

/** A file the tree did not start with, at a path relative to its root. */
function place(dir: string, path: string, content: string): void {
  const absolute = join(dir, ...path.split("/"));
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
}

/** Fix every file's mode and modification time, so an archive's bytes depend on content alone. */
function pin(dir: string): void {
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      chmodSync(absolute, 0o644);
      utimesSync(absolute, 1_700_000_000, 1_700_000_000);
    }
  };
  walk(dir);
}

/** The sha256 of an archive's uncompressed tar stream: the gzip layer belongs to the zlib build. */
function tarDigest(archive: string): string {
  return createHash("sha256")
    .update(gunzipSync(readFileSync(archive)))
    .digest("hex");
}

/** A synthetic dependency inventory, plainly fake, standing in for one a release job produces. */
const INVENTORY = '{ "bomFormat": "CycloneDX", "components": [{ "name": "fake-dep" }] }\n';

describe("pack-docs.sourceFiles: extra files carried in source.tar.gz", () => {
  it("adds each named file at the tarball root, under its file name, with its bytes", async () => {
    const dir = tree();
    place(dir, "build/inventory.cdx.json", INVENTORY);
    configure(dir, { "pack-docs": { sourceFiles: ["build/inventory.cdx.json"] } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(0);
    const source = join(dir, "dist-artifacts", SOURCE_ARTIFACT);
    expect(members(source)).toEqual([
      "inventory.cdx.json",
      "package.json",
      "src/index.ts",
      "src/lib/util.ts",
      "tsconfig.json",
    ]);
    expect(readFileSync(join(extract(source), "inventory.cdx.json"), "utf8")).toBe(INVENTORY);
    // The docs archive is not where these go.
    expect(members(join(dir, "dist-artifacts", DOCS_ARTIFACT))).not.toContain("inventory.cdx.json");
  });

  it("reads a file in the output directory itself, written there by an earlier step", async () => {
    const dir = tree();
    place(dir, "dist-artifacts/dependency-inventory.cdx.json", INVENTORY);
    configure(dir, {
      "pack-docs": { sourceFiles: ["dist-artifacts/dependency-inventory.cdx.json"] },
    });
    expect((await runIn(["pack-docs"], dir)).code).toBe(0);
    expect(members(join(dir, "dist-artifacts", SOURCE_ARTIFACT))).toContain(
      "dependency-inventory.cdx.json",
    );
  });

  it("follows a symlink that stays inside the package", async () => {
    const dir = tree();
    place(dir, "build/inventory.cdx.json", INVENTORY);
    symlinkSync(join(dir, "build", "inventory.cdx.json"), join(dir, "linked.cdx.json"));
    configure(dir, { "pack-docs": { sourceFiles: ["linked.cdx.json"] } });
    expect((await runIn(["pack-docs"], dir)).code).toBe(0);
    const source = join(dir, "dist-artifacts", SOURCE_ARTIFACT);
    expect(readFileSync(join(extract(source), "linked.cdx.json"), "utf8")).toBe(INVENTORY);
  });

  it("refuses a file that does not exist, naming it, and writes nothing", async () => {
    const dir = tree();
    configure(dir, { "pack-docs": { sourceFiles: ["build/absent.cdx.json"] } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `pack-docs: ${dir}: "pack-docs.sourceFiles" in cosyte-process.config.json: ` +
        "build/absent.cdx.json: does not exist: produce it before this step, or take it off the " +
        "list, then run cosyte-process pack-docs again. Nothing was written.",
    );
    expect(result.stderr).toContain("Nothing was written.");
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it("refuses a directory, which is not a file", async () => {
    const dir = tree();
    configure(dir, { "pack-docs": { sourceFiles: ["docs-content"] } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "docs-content: is not a regular file: name a file, not a directory",
    );
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it.each(["../outside.cdx.json", "build/../../outside.cdx.json", ".."])(
    "refuses %s, which escapes the package, without reading it",
    async (escaping) => {
      const dir = tree();
      // The file exists, so the refusal is about where it is, not whether it is there.
      writeFileSync(join(dir, "..", "outside.cdx.json"), INVENTORY);
      configure(dir, { "pack-docs": { sourceFiles: [escaping] } });
      const result = await runIn(["pack-docs"], dir);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        `${escaping}: is outside the package root: name a path relative to it`,
      );
      expect(result.stderr).toContain("Nothing was written.");
      expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
    },
  );

  it("refuses an absolute path, even one inside the package", async () => {
    const dir = tree();
    const absolute = join(dir, "README.md");
    configure(dir, { "pack-docs": { sourceFiles: [absolute] } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`${absolute}: is outside the package root`);
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it("refuses a symlink inside the package that points out of it", async () => {
    const dir = tree();
    const outside = join(dir, "..", "outside.cdx.json");
    writeFileSync(outside, INVENTORY);
    symlinkSync(outside, join(dir, "escape.cdx.json"));
    configure(dir, { "pack-docs": { sourceFiles: ["escape.cdx.json"] } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "escape.cdx.json: resolves outside the package root through a symlink: name a file " +
        "inside the package",
    );
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it("refuses a path under a symlinked directory that points out of the package", async () => {
    const dir = tree();
    const outside = join(dir, "..", "outside-dir");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "inventory.cdx.json"), INVENTORY);
    symlinkSync(outside, join(dir, "linked-dir"));
    configure(dir, { "pack-docs": { sourceFiles: ["linked-dir/inventory.cdx.json"] } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("resolves outside the package root");
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it.each([
    ["package.json", ["build/package.json"]],
    ["tsconfig.json", ["build/tsconfig.json"]],
    ["src", ["build/src"]],
    ["inventory.cdx.json", ["a/inventory.cdx.json", "b/inventory.cdx.json"]],
  ])("refuses a second member named %s rather than overwrite one", async (name, files) => {
    const dir = tree();
    for (const file of files) place(dir, file, INVENTORY);
    configure(dir, { "pack-docs": { sourceFiles: files } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `source.tar.gz already carries "${name}": rename the file or take it off the list`,
    );
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });

  it("refuses a malformed option with the config file's own diagnostic", async () => {
    const dir = tree();
    configure(dir, { "pack-docs": { sourceFiles: "build/inventory.cdx.json" } });
    const result = await runIn(["pack-docs"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cosyte-process.config.json");
    expect(result.stderr).toContain(
      `pack-docs: ${join(dir, "cosyte-process.config.json")}: "pack-docs.sourceFiles" must be ` +
        "an array of non-empty strings: correct the file, then run cosyte-process pack-docs " +
        "again. Nothing was written.",
    );
    expect(result.stderr).not.toMatch(STACK_FRAME);
    expect(existsSync(join(dir, "dist-artifacts"))).toBe(false);
  });
});

describe("a sourceFiles refusal names what it refused over", () => {
  it("names the entry it refused", () => {
    const dir = tree();
    configure(dir, { "pack-docs": { sourceFiles: ["build/absent.cdx.json"] } });
    expect(() => packDocs(dir)).toThrow(
      expect.objectContaining({ name: "PackDocsError", missing: ["build/absent.cdx.json"] }),
    );
  });

  it("names the config file when the option itself is malformed", () => {
    const dir = tree();
    configure(dir, { "pack-docs": [] });
    expect(() => packDocs(dir)).toThrow(
      expect.objectContaining({ name: "PackDocsError", missing: ["cosyte-process.config.json"] }),
    );
  });
});

describe("with no sourceFiles, source.tar.gz is byte-identical to the archive before the option", () => {
  // The sha256 of the uncompressed source archive this command wrote for the pinned tree below before
  // the option existed: no config, a config without the key and an empty list all still match it.
  const BEFORE = "9036d98bc029279e1ed3fdf15facc9f03cb28da261e7baf1eb886592e81565a5";

  it.each([
    ["no config file", undefined],
    ["a config without pack-docs", { lint: { flags: [] } }],
    ["an empty sourceFiles list", { "pack-docs": { sourceFiles: [] } }],
  ])("matches with %s", async (_label, config) => {
    const dir = tree();
    pin(dir);
    if (config !== undefined) configure(dir, config);
    expect((await runIn(["pack-docs"], dir)).code).toBe(0);
    expect(tarDigest(join(dir, "dist-artifacts", SOURCE_ARTIFACT))).toBe(BEFORE);
  });
});
