import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compile } from "@mdx-js/mdx";
import { afterAll, describe, expect, it, vi } from "vitest";

import { cleanupTempDirs, ensureBuilt, makeTempDir, PKG_ROOT } from "./helpers.js";
import {
  buildReference,
  compareReference,
  entryPointsFor,
  REFERENCE_DIR,
  ReferenceInputError,
  REQUIRED_KINDS,
  runDocsReference,
} from "../src/docs-reference.js";

/**
 * The reference generator: TSDoc into `docs-content/api/`, with the check that every public export
 * is documented. Every package here is a synthetic fixture written into a temp directory.
 */

afterAll(cleanupTempDirs);

/** Generation runs TypeDoc, which takes a few seconds on a cold start. */
const SLOW = 60_000;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    skipLibCheck: true,
  },
  include: ["src"],
});

/** A package tree with these source files and this `exports`. */
function pkg(
  files: Record<string, string>,
  exports: unknown = { ".": "./dist/index.js" },
  extra: Record<string, string> = {},
): string {
  const dir = makeTempDir("docs-reference-");
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "@cosyte/demo", version: "1.0.0", exports }),
    "tsconfig.json": TSCONFIG,
    "docs-content/intro.md": "# Intro\n",
    ...files,
    ...extra,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const DOCUMENTED = [
  "/** Parse a message. Braces { like this }, a generic Array<string> and <b>markup</b>. */",
  "export function parse(input: string): Message {",
  "  return { length: input.length };",
  "}",
  "/** A parsed message. See {@link parse} and {@link Missing}. */",
  "export interface Message {",
  "  length: number;",
  "}",
  "/** The default. */",
  "export const DEFAULT = 1;",
  "/** Kinds. */",
  'export enum Kind { A = "a" }',
  "/** An alias. */",
  "export type Alias = string;",
  "/** A box. */",
  "export class Box {}",
  "/** Exported, so in the reference although it is tagged. @internal */",
  "export const tagged = 2;",
  "export { parse as reparse };",
  "",
].join("\n");

/**
 * Headings in comments: in the package's comment, a summary, a block tag, a parameter and a member,
 * beside lines that are not headings (in code, deeper than six, indented four, no space after).
 */
const HEADINGS = [
  "/**",
  " * The demo package.",
  " *",
  " * # The package",
  " *",
  " * @packageDocumentation",
  " */",
  'export { other } from "./other.js";',
  "/**",
  " * Parse a message.",
  " *",
  " * ## Notes",
  " *",
  " * ## Use `parse` for this",
  " *",
  " * `code` ## is not a heading, but after `code`",
  " * ## a line that starts with # is one.",
  " *",
  " * ##\tTabbed",
  " *",
  " * ###",
  " *",
  " * ####### Seven is not a heading. #hashtag is not one.",
  " *",
  " *     ## Indented four, so code",
  " *",
  " * `## inline code`",
  " *",
  " * ```md",
  " * ## In a fenced block",
  " * ```",
  " *",
  " * @remarks",
  " * ### Remark heading",
  " * @param input - The input.",
  " *   # Param heading",
  " * @example",
  " * ```ts",
  " * // ## In an example",
  ' * parse("x");',
  " * ```",
  " */",
  "export function parse(input: string): number {",
  "  return input.length;",
  "}",
  "/** A box. */",
  "export class Box {",
  "  /**",
  "   * A member.",
  "   *",
  "   * #### Member heading",
  "   */",
  "  size = 1;",
  "}",
  "",
].join("\n");

function capture(): { stream: { write(text: string): boolean }; text: () => string } {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
        return true;
      },
    },
    text: () => text,
  };
}

async function cli(
  argv: string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  const out = capture();
  const err = capture();
  const code = await runDocsReference(argv, { cwd, stdout: out.stream, stderr: err.stream });
  return { code, out: out.text(), err: err.text() };
}

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(dir, path));
    else out.push(path);
  }
  return out.sort();
}

describe("ReferenceInputError", () => {
  it("names itself", () => {
    expect(new ReferenceInputError("x").name).toBe("ReferenceInputError");
  });
});

describe("the constants", () => {
  it("writes to docs-content/api and requires the export kinds, not their members", () => {
    expect(REFERENCE_DIR).toBe("docs-content/api");
    expect(REQUIRED_KINDS).toEqual([
      "Namespace",
      "Enum",
      "Variable",
      "Function",
      "Class",
      "Interface",
      "TypeAlias",
    ]);
  });
});

describe("entryPointsFor", () => {
  it("maps . to src/index.ts and each subpath to its index or its file, skipping JSON", () => {
    const dir = pkg(
      {
        "src/index.ts": "export {};\n",
        "src/testing/index.ts": "export {};\n",
        "src/ack.ts": "export {};\n",
      },
      {
        ".": "./dist/index.js",
        "./testing": "./dist/testing/index.js",
        "./ack": { types: "./dist/ack.d.ts", default: "./dist/ack.js" },
        "./package.json": "./package.json",
        "./schema.json": "./schema.json",
      },
    );
    expect(entryPointsFor(dir)).toEqual([
      { subpath: ".", file: join(dir, "src", "index.ts") },
      { subpath: "./testing", file: join(dir, "src", "testing", "index.ts") },
      { subpath: "./ack", file: join(dir, "src", "ack.ts") },
    ]);
  });

  it("reads a string exports, a null one and none at all as the one entry point .", () => {
    const one = { "src/index.ts": "export {};\n" };
    expect(entryPointsFor(pkg(one, "./dist/index.js")).map((e) => e.subpath)).toEqual(["."]);
    expect(entryPointsFor(pkg(one, null)).map((e) => e.subpath)).toEqual(["."]);
    expect(entryPointsFor(pkg(one, undefined)).map((e) => e.subpath)).toEqual(["."]);
  });

  it("refuses a subpath with no source, a pattern subpath and a missing package.json", () => {
    const dir = pkg({ "src/index.ts": "export {};\n" }, { ".": "./a.js", "./gone": "./b.js" });
    expect(() => entryPointsFor(dir)).toThrow(ReferenceInputError);
    expect(() => entryPointsFor(dir)).toThrow(
      `the export "./gone" has no source: neither ${join(dir, "src", "gone", "index.ts")} nor ${join(dir, "src", "gone.ts")} exists`,
    );
    const pattern = pkg({ "src/index.ts": "export {};\n" }, { ".": "./a.js", "./*": "./b/*.js" });
    expect(() => entryPointsFor(pattern)).toThrow(
      'the export "./*" is a pattern; list each subpath the reference should cover',
    );
    const bare = makeTempDir("docs-reference-bare-");
    expect(() => entryPointsFor(bare)).toThrow(`${join(bare, "package.json")} could not be read`);
    writeFileSync(join(bare, "package.json"), "{ not json");
    expect(() => entryPointsFor(bare)).toThrow(`${join(bare, "package.json")} is not JSON`);
  });
});

describe("buildReference", () => {
  it(
    "writes one page for one entry point, and finds nothing undocumented",
    async () => {
      const dir = pkg({ "src/index.ts": DOCUMENTED, "README.md": "# Readme marker\n" });
      const result = await buildReference(dir);
      expect(result.undocumented).toEqual([]);
      expect(result.headings).toEqual([]);
      expect([...result.files.keys()]).toEqual(["README.md"]);
      const page = result.files.get("README.md") ?? "";
      expect(page.startsWith("# @cosyte/demo\n")).toBe(true);
      expect(page).not.toContain("Defined in");
      expect(page).not.toContain("Readme marker");
      for (const name of ["parse()", "Message", "DEFAULT", "Kind", "Alias", "Box", "tagged"]) {
        expect(page, name).toContain(`### ${name}`);
      }
    },
    SLOW,
  );

  it(
    "names each undocumented export once, by name, kind and file, and leaves members alone",
    async () => {
      const dir = pkg({
        "src/index.ts": [
          'export { helper } from "./helper.js";',
          "export const bare = 1;",
          "export function plain(): void {}",
          "export interface Shape { side: number }",
          "export type Id = string;",
          "export class Thing { method(): void {} }",
          "export enum Mode { On }",
          'export * as tools from "./helper.js";',
          "/** Documented, with an undocumented member. */",
          "export interface Fine { member: number }",
          "/** @deprecated A tag is not a summary. */",
          "export const tagged = 1;",
          "/** Documented on the overloads' implementation only. */",
          "export function over(a: string): void;",
          "export function over(a: number): void;",
          "export function over(a: unknown): void {}",
          "export function signed(): void;",
          "/** Documented on its one overload. */",
          "export function signed(a?: number): void;",
          "export function signed(): void {}",
          "/** {@link bare} */",
          "export const linkOnly = 1;",
          "/** Documented, though it does not type-check. */",
          "export const mistyped: number = 'x';",
          'export { ext } from "ext";',
          "",
        ].join("\n"),
        "src/helper.ts": "export function helper(): void {}\nexport const inner = 1;\n",
        "node_modules/ext/package.json": JSON.stringify({ name: "ext", types: "index.d.ts" }),
        "node_modules/ext/index.d.ts": "export declare function ext(): void;\n",
      });
      const result = await buildReference(dir);
      expect(result.files.get("README.md")).not.toContain("ext()");
      const namespacePage = [...result.files].find(([path]) => path.endsWith("tools.md"))?.[1];
      expect(namespacePage?.startsWith("# tools\n")).toBe(true);
      expect(result.undocumented).toEqual([
        "Id (TypeAlias), defined in src/index.ts",
        "Mode (Enum), defined in src/index.ts",
        "Shape (Interface), defined in src/index.ts",
        "Thing (Class), defined in src/index.ts",
        "bare (Variable), defined in src/index.ts",
        "helper (Function), defined in src/helper.ts",
        "plain (Function), defined in src/index.ts",
        "tagged (Variable), defined in src/index.ts",
        "tools (Namespace), defined in src/helper.ts",
        "tools.inner (Variable), defined in src/helper.ts",
      ]);
    },
    SLOW,
  );

  it(
    "lets no tag hide a public export: @internal, @hidden and @ignore are each checked and shown",
    async () => {
      const dir = pkg({
        "src/index.ts": [
          "/** @internal */",
          "export function internalBare(): void {}",
          "/** @hidden */",
          "export const hiddenBare = 1;",
          "/** @ignore */",
          "export interface IgnoredBare { a: number }",
          "/** Documented, and tagged. @internal */",
          "export const internalDocumented = 1;",
          "/** Documented, and tagged. @hidden */",
          "export function hiddenDocumented(): void {}",
          "/** Documented, with a tagged member. */",
          "export class Holder {",
          "  /** A member, tagged. @internal */",
          "  member = 1;",
          "}",
          "",
        ].join("\n"),
      });
      const result = await buildReference(dir);
      expect(result.undocumented).toEqual([
        "IgnoredBare (Interface), defined in src/index.ts",
        "hiddenBare (Variable), defined in src/index.ts",
        "internalBare (Function), defined in src/index.ts",
      ]);
      const page = result.files.get("README.md") ?? "";
      for (const name of [
        "internalBare()",
        "hiddenBare",
        "IgnoredBare",
        "internalDocumented",
        "hiddenDocumented()",
        "Holder",
        "member",
      ]) {
        expect(page, name).toContain(`### ${name}`);
      }
    },
    SLOW,
  );

  it(
    "covers every entry point, a page per module",
    async () => {
      const dir = pkg(
        {
          "src/index.ts": "/** Root. */\nexport const root = 1;\n",
          "src/testing/index.ts": "export const fake = 2;\n",
        },
        { ".": "./dist/index.js", "./testing": "./dist/testing/index.js" },
      );
      const result = await buildReference(dir);
      expect(result.undocumented).toEqual(["fake (Variable), defined in src/testing/index.ts"]);
      expect(result.files.size).toBeGreaterThan(1);
      const all = [...result.files.values()].join("\n");
      expect(all).toContain("root");
      expect(all).toContain("fake");
    },
    SLOW,
  );

  it(
    "writes pages that compile as MDX, and the same pages every time",
    async () => {
      const dir = pkg({ "src/index.ts": DOCUMENTED });
      const first = await buildReference(dir);
      const second = await buildReference(dir);
      expect([...second.files]).toEqual([...first.files]);
      for (const [path, text] of first.files) {
        await expect(compile(text), path).resolves.toBeDefined();
      }
      // The control: the same braces unescaped do not compile, so the check above can fail.
      await expect(compile("Braces { like this }")).rejects.toThrow();
    },
    SLOW,
  );

  it(
    "refuses a program TypeDoc cannot convert, with what TypeDoc said",
    async () => {
      const dir = pkg({ "src/other.ts": "export const a = 1;\n" });
      await expect(buildReference(dir)).rejects.toThrow(
        new ReferenceInputError(
          `TypeDoc could not read the source: The glob ${join(dir, "src", "index.ts")} ` +
            "did not match any files; Unable to find any entry points. See previous warnings",
        ),
      );
    },
    SLOW,
  );

  it(
    "refuses a tsconfig.json TypeDoc cannot read",
    async () => {
      const dir = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" }, undefined, {
        "tsconfig.json": "{ not json",
      });
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        await expect(buildReference(dir)).rejects.toThrow(
          new ReferenceInputError("TypeDoc could not read its options (its errors are above)"),
        );
      } finally {
        errors.mockRestore();
        logs.mockRestore();
      }
    },
    SLOW,
  );

  it(
    "finds nothing undocumented in a package that exports nothing",
    async () => {
      const result = await buildReference(pkg({ "src/index.ts": "export {};\n" }));
      expect(result.undocumented).toEqual([]);
      expect([...result.files.keys()]).toEqual(["README.md"]);
    },
    SLOW,
  );

  it(
    "names each heading written in a comment, wherever the comment is, and none in code",
    async () => {
      const dir = pkg({
        "src/index.ts": HEADINGS,
        "src/other.ts": "/**\n * Another file.\n *\n * ## Other\n */\nexport const other = 1;\n",
      });
      const result = await buildReference(dir);
      expect(result.undocumented).toEqual([]);
      expect(result.headings).toEqual([
        "@cosyte/demo (Project): # The package",
        "Box.size (Property), defined in src/index.ts: #### Member heading",
        "other (Variable), defined in src/other.ts: ## Other",
        // Sorted, so the tab comes before the space.
        "parse.parse (CallSignature), defined in src/index.ts: ##\tTabbed",
        "parse.parse (CallSignature), defined in src/index.ts: ## Notes",
        "parse.parse (CallSignature), defined in src/index.ts: ## Use `parse` for this",
        "parse.parse (CallSignature), defined in src/index.ts: ## a line that starts with # is one.",
        "parse.parse (CallSignature), defined in src/index.ts: ###",
        "parse.parse (CallSignature), defined in src/index.ts: ### Remark heading",
        "parse.parse.input (Parameter), defined in src/index.ts: # Param heading",
      ]);
      // The page prints each as it is, which is why it is refused: it would be in the outline.
      expect(result.files.get("README.md")).toMatch(/^## Notes$/m);
    },
    SLOW,
  );

  it("refuses a package with no tsconfig.json", async () => {
    const dir = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" });
    rmSync(join(dir, "tsconfig.json"));
    await expect(buildReference(dir)).rejects.toThrow(
      new ReferenceInputError(`${join(dir, "tsconfig.json")} does not exist`),
    );
  });
});

describe("the temporary folder", () => {
  it(
    "is removed after a build, and after a build that fails",
    async () => {
      const scratch = makeTempDir("docs-reference-tmp-");
      const good = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" });
      const bad = pkg({ "src/other.ts": "export {};\n" });
      const before = process.env["TMPDIR"];
      process.env["TMPDIR"] = scratch;
      try {
        await buildReference(good);
        expect(readdirSync(scratch)).toEqual([]);
        await expect(buildReference(bad)).rejects.toThrow(ReferenceInputError);
        expect(readdirSync(scratch)).toEqual([]);
      } finally {
        if (before === undefined) delete process.env["TMPDIR"];
        else process.env["TMPDIR"] = before;
      }
    },
    SLOW,
  );
});

describe("compareReference", () => {
  it("names each missing, changed and extra file, in order", () => {
    const dir = makeTempDir("docs-reference-compare-");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "same.md"), "same");
    writeFileSync(join(dir, "changed.md"), "old");
    writeFileSync(join(dir, "sub", "extra.md"), "extra");
    writeFileSync(join(dir, "a-extra.md"), "extra");
    const expected = new Map([
      ["same.md", "same"],
      ["changed.md", "new"],
      ["missing.md", "m"],
    ]);
    expect(compareReference(expected, dir)).toEqual([
      "a-extra.md: not generated from the source",
      "changed.md: differs from what the source generates",
      "missing.md: missing",
      "sub/extra.md: not generated from the source",
    ]);
  });

  it("reads a missing folder as empty", () => {
    expect(compareReference(new Map([["a.md", "a"]]), join(makeTempDir("x-"), "none"))).toEqual([
      "a.md: missing",
    ]);
    expect(compareReference(new Map(), join(makeTempDir("x-"), "none"))).toEqual([]);
  });
});

describe("runDocsReference, the command line", () => {
  it(
    "writes docs-content/api, replacing what was there, and exits 0",
    async () => {
      const dir = pkg({ "src/index.ts": DOCUMENTED });
      mkdirSync(join(dir, REFERENCE_DIR), { recursive: true });
      writeFileSync(join(dir, REFERENCE_DIR, "stale.md"), "old");
      const r = await cli([], dir);
      expect(r.code, r.err).toBe(0);
      expect(r.err).toBe("");
      expect(r.out).toBe(
        "docs-reference: wrote 1 page(s) to docs-content/api; every export is documented\n",
      );
      expect(listFiles(join(dir, REFERENCE_DIR))).toEqual(["README.md"]);
      const check = await cli(["--check"], dir);
      expect(check).toEqual({
        code: 0,
        out: "docs-reference: docs-content/api matches the source; every export is documented\n",
        err: "",
      });
    },
    SLOW,
  );

  it(
    "writes, then exits 1 naming each undocumented export",
    async () => {
      const dir = pkg({
        "src/index.ts": 'export const bare = 1;\nexport * as ns from "./ns.js";\n',
        "src/ns.ts": "/** Inner. */\nexport const inner = 1;\n",
      });
      const r = await cli([], dir);
      expect(r.code).toBe(1);
      expect(r.out).toBe("docs-reference: wrote 2 page(s) to docs-content/api\n");
      expect(r.err).toBe(
        "docs-reference: 2 export(s) without a TSDoc comment:\n" +
          "  bare (Variable), defined in src/index.ts\n" +
          "  ns (Namespace), defined in src/ns.ts\n",
      );
      expect(listFiles(join(dir, REFERENCE_DIR))).toEqual([
        "@cosyte/namespaces/ns.md",
        "README.md",
      ]);
      expect(readFileSync(join(dir, REFERENCE_DIR, "README.md"), "utf8")).toContain("bare");
    },
    SLOW,
  );

  it(
    "with --check, exits 1 on a stale page and an undocumented export, writing nothing",
    async () => {
      const dir = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" });
      expect((await cli([], dir)).code).toBe(0);
      writeFileSync(
        join(dir, "src", "index.ts"),
        "/** A. */\nexport const a = 1;\nexport const b = 2;\n",
      );
      const before = readFileSync(join(dir, REFERENCE_DIR, "README.md"), "utf8");
      writeFileSync(join(dir, REFERENCE_DIR, "notes.md"), "hand-written");
      const r = await cli(["--check"], dir);
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toBe(
        "docs-reference: docs-content/api does not match the source:\n" +
          "  README.md: differs from what the source generates\n" +
          "  notes.md: not generated from the source\n" +
          "docs-reference: run cosyte-docs-reference and commit docs-content/api\n" +
          "docs-reference: 1 export(s) without a TSDoc comment:\n" +
          "  b (Variable), defined in src/index.ts\n",
      );
      expect(readFileSync(join(dir, REFERENCE_DIR, "README.md"), "utf8")).toBe(before);
    },
    SLOW,
  );

  it(
    "with --check, exits 1 on a stale page alone, printing no success line",
    async () => {
      const dir = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" });
      await cli([], dir);
      writeFileSync(join(dir, REFERENCE_DIR, "README.md"), "edited by hand\n");
      expect(await cli(["--check"], dir)).toEqual({
        code: 1,
        out: "",
        err:
          "docs-reference: docs-content/api does not match the source:\n" +
          "  README.md: differs from what the source generates\n" +
          "docs-reference: run cosyte-docs-reference and commit docs-content/api\n",
      });
    },
    SLOW,
  );

  it(
    "with --check, exits 1 on an undocumented export alone",
    async () => {
      const dir = pkg({ "src/index.ts": "export const bare = 1;\n" });
      await cli([], dir);
      const r = await cli(["--check"], dir);
      expect(r).toEqual({
        code: 1,
        out: "",
        err:
          "docs-reference: 1 export(s) without a TSDoc comment:\n" +
          "  bare (Variable), defined in src/index.ts\n",
      });
    },
    SLOW,
  );

  it(
    "writes, then exits 1 naming each heading in a comment; with --check, exits 1 on them alone",
    async () => {
      const dir = pkg({
        "src/index.ts": "/**\n * A.\n *\n * ## Notes\n *\n * ### More\n */\nexport const a = 1;\n",
      });
      const headings =
        "docs-reference: 2 heading(s) in TSDoc comments, which the pages would show in their " +
        "outline; write each as a bold line or a sentence:\n" +
        "  a (Variable), defined in src/index.ts: ## Notes\n" +
        "  a (Variable), defined in src/index.ts: ### More\n";
      expect(await cli([], dir)).toEqual({
        code: 1,
        out: "docs-reference: wrote 1 page(s) to docs-content/api; every export is documented\n",
        err: headings,
      });
      expect(await cli(["--check"], dir)).toEqual({ code: 1, out: "", err: headings });
    },
    SLOW,
  );

  it(
    "reads the working directory and writes to the process streams by default",
    async () => {
      const dir = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" });
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
      const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(await runDocsReference([])).toBe(0);
        expect(out).toHaveBeenCalledWith(
          "docs-reference: wrote 1 page(s) to docs-content/api; every export is documented\n",
        );
        expect(await runDocsReference(["--fix"])).toBe(2);
        expect(err).toHaveBeenCalledWith(
          'docs-reference: "--fix" is not an argument (only --check). Nothing was generated.\n',
        );
      } finally {
        cwd.mockRestore();
        out.mockRestore();
        err.mockRestore();
      }
    },
    SLOW,
  );

  it("exits 2 on an argument it does not accept", async () => {
    const r = await cli(["--fix"], makeTempDir("x-"));
    expect(r).toEqual({
      code: 2,
      out: "",
      err: 'docs-reference: "--fix" is not an argument (only --check). Nothing was generated.\n',
    });
  });

  it("exits 2 with no docs-content/ folder, and with no package.json", async () => {
    const dir = pkg({ "src/index.ts": "export {};\n" });
    rmSync(join(dir, "docs-content"), { recursive: true });
    expect(await cli([], dir)).toEqual({
      code: 2,
      out: "",
      err: `docs-reference: ${join(dir, "docs-content")} is not a directory. Nothing was generated.\n`,
    });
    const bare = makeTempDir("x-");
    mkdirSync(join(bare, "docs-content"));
    const r = await cli(["--check"], bare);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      `docs-reference: ${join(bare, "package.json")} could not be read. Nothing was generated.\n`,
    );
  });

  it(
    "exits 2 when TypeDoc cannot read the source",
    async () => {
      const dir = pkg({ "src/other.ts": "export const a = 1;\n" });
      const r = await cli([], dir);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^docs-reference: TypeDoc could not read the source: \S/);
      expect(r.err).toMatch(/ Nothing was generated\.\n$/);
    },
    SLOW,
  );

  it.skipIf(process.getuid?.() === 0)(
    "exits 2 when it cannot write the pages",
    async () => {
      const dir = pkg({ "src/index.ts": "/** A. */\nexport const a = 1;\n" });
      chmodSync(join(dir, "docs-content"), 0o555);
      try {
        const r = await cli([], dir);
        expect(r.code).toBe(2);
        expect(r.err).toMatch(/^docs-reference: EACCES: permission denied, mkdir '.*api'/);
        expect(r.err).toMatch(/ Nothing was generated\.\n$/);
      } finally {
        chmodSync(join(dir, "docs-content"), 0o755);
      }
    },
    SLOW,
  );
});

describe("the cosyte-docs-reference bin", () => {
  it(
    "is built, declared in package.json, and runs the command with its arguments",
    () => {
      ensureBuilt();
      const manifest = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
        bin: Record<string, string>;
      };
      expect(manifest.bin["cosyte-docs-reference"]).toBe("./dist/docs-reference.mjs");
      const bin = join(PKG_ROOT, "dist", "docs-reference.mjs");
      expect(readFileSync(bin, "utf8")).toMatch(/^#!\/usr\/bin\/env node\n/);
      const dir = pkg({ "src/index.ts": "export const bare = 1;\n" });
      const r = spawnSync(process.execPath, [bin, "--check"], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain("bare (Variable), defined in src/index.ts");
      expect(r.stderr).toContain("README.md: missing");
    },
    SLOW,
  );
});
