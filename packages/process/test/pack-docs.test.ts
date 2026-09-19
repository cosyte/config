import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, ensureBuilt, makeTempDir, runCli } from "./helpers.js";
import { DOCS_ARTIFACT, PACK_DOCS_INPUTS, SOURCE_ARTIFACT } from "../src/pack-docs.js";
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
