import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, ensureBuilt, makeTempDir, runCli } from "./helpers.js";
import { run } from "../src/run.js";
import { findVersionDeclarations, syncVersion, SyncVersionError } from "../src/sync-version.js";

/**
 * The canonical version sync, against the five numbered conditions of its behaviour contract.
 *
 * Every test here names the condition number it exercises, and `test/sync-version-conditions.test.ts`
 * fails the run if any of the five goes unnamed: the mapping from contract to evidence is a string a
 * reader can check rather than a judgement they have to make.
 */

beforeAll(ensureBuilt);
afterAll(cleanupTempDirs);

/** A line the diagnostics must never echo: it stands in for whatever a consumer's source carries. */
const SENTINEL = "SENTINEL-SOURCE-CONTENT-THAT-MUST-NOT-BE-PRINTED";

/** A stack frame, as an unhandled exception prints it. A refusal carries none. */
const STACK_FRAME = /\n\s+at \S+/;

/**
 * Whether this run can build a file it is not allowed to write.
 *
 * Mode bits do not constrain root, so the read-only fixture below expresses nothing when the suite
 * runs as root. The same arm is graded without privileges by `pack-docs.test.ts`, over an output
 * path that is already a file.
 */
const CAN_WITHHOLD_WRITE = typeof process.getuid === "function" && process.getuid() !== 0;

interface Tree {
  /** The package root. */
  readonly dir: string;
  /** The source entry point. */
  readonly source: string;
  /** The manifest. */
  readonly manifest: string;
}

/** A package tree: a manifest with the given version, and a source entry point with the given body. */
function tree(manifestVersion: unknown, source: string): Tree {
  const dir = join(makeTempDir("cosyte-process-sync-version-"), "consumer");
  mkdirSync(join(dir, "src"), { recursive: true });
  const manifest = join(dir, "package.json");
  const body: Record<string, unknown> = { name: "consumer", private: true, type: "module" };
  if (manifestVersion !== undefined) {
    body["version"] = manifestVersion;
  }
  writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);
  const entry = join(dir, "src", "index.ts");
  writeFileSync(entry, source);
  return { dir, source: entry, manifest };
}

/** The ordinary source entry point: a declaration at column 0, with content either side of it. */
function sourceWith(version: string): string {
  return [
    `// ${SENTINEL}`,
    'import { join } from "node:path";',
    "",
    `export const VERSION: string = "${version}";`,
    "",
    "export function where(): string {",
    '  return join("a", "b");',
    "}",
    "",
  ].join("\n");
}

/** A file's bytes and modification time, both read through one descriptor. */
function snapshot(path: string): { bytes: Buffer; mtimeMs: number } {
  const handle = openSync(path, "r");
  try {
    return { bytes: readFileSync(handle), mtimeMs: fstatSync(handle).mtimeMs };
  } finally {
    closeSync(handle);
  }
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

describe("AC-C1: the declaration is rewritten to the manifest version", () => {
  it("version-sync condition 1: writes the manifest's version string, character for character", async () => {
    const { dir, source } = tree("2.3.4", sourceWith("0.0.0"));
    const result = await runIn(["sync-version"], dir);
    expect(result.code).toBe(0);
    expect(readFileSync(source, "utf8")).toContain('export const VERSION: string = "2.3.4";');
  });

  it("version-sync condition 2: rewrites the column-0 declaration wherever in the file it sits", () => {
    const filler = Array.from({ length: 40 }, (_, index) => `// line ${String(index)}`).join("\n");
    const { dir, source } = tree(
      "9.9.9",
      `${filler}\nexport const VERSION: string = "0.0.0";\n${filler}\n`,
    );
    expect(syncVersion(dir).outcome).toBe("written");
    const text = readFileSync(source, "utf8");
    expect(text).toContain('export const VERSION: string = "9.9.9";');
    expect(text.startsWith(filler)).toBe(true);
  });

  it("version-sync condition 2: leaves an indented declaration alone, matching only at column 0", () => {
    const { dir, source } = tree(
      "1.2.3",
      [
        "const outer = {",
        '  export_const_VERSION: "decoy",',
        "};",
        '  export const VERSION: string = "not-at-column-0";',
        'export const VERSION: string = "0.0.0";',
        "",
      ].join("\n"),
    );
    expect(syncVersion(dir).outcome).toBe("written");
    const text = readFileSync(source, "utf8");
    expect(text).toContain('  export const VERSION: string = "not-at-column-0";');
    expect(text).toContain('export const VERSION: string = "1.2.3";');
  });

  it("version-sync condition 4: writes nothing when the tree is already at that version, and says so", async () => {
    const { dir, source } = tree("4.5.6", sourceWith("4.5.6"));
    const before = snapshot(source);
    const result = await runIn(["sync-version"], dir);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("already at 4.5.6");
    const after = snapshot(source);
    expect(after.bytes).toEqual(before.bytes);
    // Not merely "the same bytes": an idempotent run does not touch the file at all.
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("version-sync condition 5: exits 0 for a write and for an already-synced tree", async () => {
    const { dir } = tree("7.8.9", sourceWith("0.0.1"));
    expect((await runIn(["sync-version"], dir)).code).toBe(0);
    expect((await runIn(["sync-version"], dir)).code).toBe(0);
  });
});

describe("AC-C3: a refusal names the file and the condition, and writes nothing", () => {
  it("version-sync condition 1: refuses a manifest with no usable version", async () => {
    for (const version of [undefined, 1, null, ""]) {
      const { dir, source, manifest } = tree(version, sourceWith("0.0.0"));
      const before = readFileSync(source);
      const result = await runIn(["sync-version"], dir);
      expect(result.code, `version ${JSON.stringify(version)}`).not.toBe(0);
      expect(result.stderr).toContain(manifest);
      expect(result.stderr).toContain("condition 1");
      expect(readFileSync(source)).toEqual(before);
    }
  });

  it("version-sync condition 1: refuses a manifest that is not readable JSON", async () => {
    const { dir, source, manifest } = tree("1.0.0", sourceWith("0.0.0"));
    writeFileSync(manifest, "{ not json");
    const before = readFileSync(source);
    const result = await runIn(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("condition 1");
    expect(readFileSync(source)).toEqual(before);
  });

  it("version-sync condition 2: refuses a source with no matching declaration, naming the rename", async () => {
    const { dir, source } = tree("1.0.0", 'export const RELEASE: string = "0.0.0";\n');
    const before = readFileSync(source);
    const result = await runIn(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(source);
    expect(result.stderr).toContain("condition 2");
    expect(result.stderr).toContain("renamed");
    expect(readFileSync(source)).toEqual(before);
  });

  it("version-sync condition 2: refuses two declarations, including a commented-out decoy", async () => {
    // The decoy is inside a block comment at column 0, which is the case the contract names: it must
    // not be rewritten ahead of the real one, and the ambiguity is refused rather than guessed.
    const { dir, source } = tree(
      "1.0.0",
      [
        "/*",
        'export const VERSION: string = "0.0.1";',
        "*/",
        'export const VERSION: string = "0.0.0";',
        "",
      ].join("\n"),
    );
    const before = readFileSync(source);
    const result = await runIn(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("condition 2");
    expect(result.stderr).toContain("2 exported VERSION declarations");
    expect(result.stderr).toContain("lines 2, 4");
    expect(readFileSync(source)).toEqual(before);
  });

  it("version-sync condition 2: refuses a declaration line that carries a trailing comment", async () => {
    // The value runs to the first quote, so this line is not a declaration: the trailing comment
    // ends in the same two characters the form closes with, and a value that could match through it
    // would splice the manifest version over the comment, deleting source text where a refusal was
    // owed. The retired per-repo variant rejected this input, and so does this one.
    const { dir, source } = tree(
      "1.2.3",
      'export const VERSION: string = "0.0.1"; // see "docs";\n',
    );
    const before = readFileSync(source);
    const result = await runIn(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("condition 2");
    expect(readFileSync(source)).toEqual(before);
  });

  it("version-sync condition 2: refuses an absent source entry point, naming the path", async () => {
    const dir = join(makeTempDir("cosyte-process-sync-version-nosrc-"), "consumer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{ "name": "c", "version": "1.0.0" }\n');
    const result = await runIn(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(join(dir, "src", "index.ts"));
    expect(result.stderr).toContain("condition 2");
  });

  it("version-sync condition 5: every refusal exits 1, and the vocabulary is exactly 0 and 1", async () => {
    const codes = new Set<number>();
    const noVersion = tree(undefined, sourceWith("0.0.0"));
    const noDeclaration = tree("1.0.0", "export const OTHER = 1;\n");
    const twoDeclarations = tree(
      "1.0.0",
      'export const VERSION: string = "a";\nexport const VERSION: string = "b";\n',
    );
    const happy = tree("1.0.0", sourceWith("0.0.0"));
    for (const subject of [noVersion, noDeclaration, twoDeclarations, happy]) {
      codes.add((await runIn(["sync-version"], subject.dir)).code);
    }
    // Twice over the happy tree, so the already-synced path contributes its code too.
    codes.add((await runIn(["sync-version"], happy.dir)).code);
    expect([...codes].sort((left, right) => left - right)).toEqual([0, 1]);
  });
});

describe("AC-C4: the manifest string is inserted literally", () => {
  it("version-sync condition 3: writes $&, $1 and a backtick sequence exactly as the manifest carries them", () => {
    const version = "1.0.0-$&+$1-`x`";
    const { dir, source } = tree(version, sourceWith("0.0.0"));
    expect(syncVersion(dir).version).toBe(version);
    expect(readFileSync(source, "utf8")).toContain(
      'export const VERSION: string = "1.0.0-$&+$1-`x`";',
    );
    // `$&` expanded against the match would have produced the whole declaration inside the value.
    expect(readFileSync(source, "utf8")).not.toContain(
      'export const VERSION: string = "1.0.0-export',
    );
  });

  it("version-sync condition 3: reading the declaration back reports exactly what was written", () => {
    const version = "0.0.0-$`";
    const { dir, source } = tree(version, sourceWith("0.0.0"));
    syncVersion(dir);
    const [declaration] = findVersionDeclarations(readFileSync(source, "utf8"));
    expect(declaration?.value).toBe(version);
  });
});

describe("AC-C10: diagnostics reach stderr only, and carry no file content", () => {
  it("writes the diagnostic to stderr and nothing to stdout", () => {
    const { dir } = tree(undefined, sourceWith("0.0.0"));
    const result = runCli(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("sync-version");
  });

  it("names the path, the entry point and the action available", () => {
    const { dir, source } = tree("1.0.0", "export const OTHER = 1;\n");
    const result = runCli(["sync-version"], dir);
    expect(result.stderr).toContain(source);
    expect(result.stderr).toContain("sync-version");
    expect(result.stderr).toContain("run cosyte-process sync-version again");
  });

  it("never echoes the content of the file it read", () => {
    const { dir } = tree("1.0.0", `// ${SENTINEL}\nexport const OTHER = 1;\n`);
    const result = runCli(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stdout).not.toContain(SENTINEL);
  });

  it("reports an ambiguity by line number rather than by quoting the lines", () => {
    const { dir } = tree(
      "1.0.0",
      [
        `// ${SENTINEL}`,
        'export const VERSION: string = "a";',
        'export const VERSION: string = "b";',
        "",
      ].join("\n"),
    );
    const result = runCli(["sync-version"], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("lines 2, 3");
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stderr).not.toContain('export const VERSION: string = "a";');
  });

  it("refuses an argument rather than ignoring it", () => {
    const { dir } = tree("1.0.0", sourceWith("0.0.0"));
    const result = runCli(["sync-version", "--force"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("sync-version takes no arguments");
  });

  // AC-C10's trigger is "for any reason", and this is the arm no numbered condition describes: the
  // manifest and the declaration are both fine and the write itself fails, which is what a read-only
  // mount, a uid mismatch in a release container or a file an earlier step left unwritable produces.
  it.skipIf(!CAN_WITHHOLD_WRITE)(
    "refuses a source file it cannot write to, rather than crashing",
    () => {
      const { dir, source } = tree("9.9.9", sourceWith("0.0.0"));
      chmodSync(source, 0o444);
      const result = runCli(["sync-version"], dir);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("sync-version");
      expect(result.stderr).toContain(source);
      expect(result.stderr).toContain("EACCES");
      expect(result.stderr).toContain("run cosyte-process sync-version again");
      // A stack trace names no action and is not a refusal, whatever exit code follows it.
      expect(result.stderr).not.toMatch(STACK_FRAME);
      expect(result.stderr).not.toContain(SENTINEL);
      expect(readFileSync(source, "utf8")).toContain('export const VERSION: string = "0.0.0";');
    },
  );
});

describe("AC-C3: the error carries the condition it failed", () => {
  it("version-sync condition 1: surfaces the number programmatically as well as on stderr", () => {
    const { dir } = tree(undefined, sourceWith("0.0.0"));
    try {
      syncVersion(dir);
      expect.unreachable("a manifest with no version must refuse");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SyncVersionError);
      expect((error as SyncVersionError).condition).toBe(1);
    }
  });
});
