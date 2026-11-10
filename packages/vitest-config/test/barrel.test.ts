/**
 * Which source files are barrels. Coverage and mutation testing leave a barrel out, so a file read
 * as a barrel by mistake hides real code from both: the rule is decided by reading each file, never
 * by its name, and anything it is unsure of is measured. Every file here is synthetic.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_MUTATE, cosyteStryker, findBarrels, isBarrel } from "../stryker.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "vitest-config-barrel-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** A pure barrel in the shapes real ones take: lists over many lines, types, comments, imports. */
const PURE_BARREL = `/**
 * The public entry point.
 */

export * from "./a.js";
export * as b from './b.js';
export type * from "./types.js";
export type * as t from "./types.js"
export { parse, type ParseOptions, default as format } from "./parse.js";
export type {
  // the message model
  Message,
  Segment, /* and the rest */
  Field,
} from "./model.js";
export { "odd-name" as oddName } from "./odd.js";
export {} from "./nothing.js";
import { helper } from "./helper.js";
import type { Shape } from "./shape.js";
import * as everything from "./everything.js";
import base, { extra } from "./base.js";
import other, * as rest from "./other.js";
import data from "./data.json" with { type: "json" };
export { helper, everything, base, extra, other, rest, data };
export type { Shape };
// trailing comment`;

/** One statement of real code among re-exports, the shape of a profile registry. */
const ONE_STATEMENT = `export { defineProfile } from "./define.js";
import { epic } from "./epic.js";
export const profiles = Object.freeze({ epic });
`;

/** A large index.ts that holds the parser itself, after a page of imports and re-exports. */
function largeParser(): string {
  const lines = [
    "/** The parser's entry point. */",
    'import { readDelimiters } from "./delimiters.js";',
    'import { tokenize } from "./tokenize.js";',
    'export { tokenize } from "./tokenize.js";',
    'export type { ParseOptions } from "./types.js";',
    "",
    "export function parseMessage(text: string): string[] {",
    "  const out: string[] = [];",
  ];
  for (let i = 0; i < 650; i += 1) lines.push(`  out.push(tokenize(text, ${i}).join("|"));`);
  lines.push("  readDelimiters(text);", "  return out;", "}", "");
  return lines.join("\n");
}

describe("isBarrel", () => {
  it("reads a file of nothing but re-exports as a barrel", () => {
    expect(isBarrel(PURE_BARREL)).toBe(true);
    expect(isBarrel('export * from "./a.js";')).toBe(true);
    expect(isBarrel("export*from'./a.js'")).toBe(true);
    expect(isBarrel('﻿export * from "./a.js";\r\n')).toBe(true);
    expect(isBarrel('/* a */ export /* b */ * /* c */ from /* d */ "./a.js" /* e */;')).toBe(true);
    expect(isBarrel('export { a } from "./a.js";\nexport { b } from "./b.js"\n')).toBe(true);
    expect(isBarrel('export { a as "a-b" } from "./a.js";')).toBe(true);
    expect(isBarrel('export { a, } from "./a.js";')).toBe(true);
    expect(isBarrel('export { typeA } from "./a.js";')).toBe(true);
    expect(isBarrel('export { type } from "./a.js";')).toBe(true);
    expect(isBarrel('import type from "./a.js";\nexport { type };')).toBe(true);
    expect(isBarrel('export * from "./it\\"s.js";')).toBe(true);
    expect(isBarrel("export * from './it\\'s.js';")).toBe(true);
    expect(isBarrel('export * from "./a.js" assert { type: "json", "x": \'y\', };')).toBe(true);
    expect(isBarrel('export * from "./a.js" with {};')).toBe(true);
  });

  it("measures a barrel with one statement of real code", () => {
    expect(isBarrel(ONE_STATEMENT)).toBe(false);
    expect(isBarrel(`${PURE_BARREL}\nexport const x = 1;`)).toBe(false);
    expect(isBarrel(`console.log(1);\n${PURE_BARREL}`)).toBe(false);
    expect(isBarrel('export * from "./a.js";\nfoo();')).toBe(false);
    expect(isBarrel('export * from "./a.js";\nexport default 1;')).toBe(false);
    expect(isBarrel('export * from "./a.js";\nexport type T = string;')).toBe(false);
    expect(isBarrel('export * from "./a.js";\nexport interface I {}')).toBe(false);
  });

  it("measures a large index.ts that holds the parser", () => {
    const text = largeParser();
    expect(text.split("\n").length).toBeGreaterThan(650);
    expect(isBarrel(text)).toBe(false);
  });

  it("measures a file it cannot read as re-exports alone", () => {
    for (const text of [
      "",
      "  \n// only a comment\n/* and another */",
      'import { a } from "./a.js";',
      'import "./side-effect.js";',
      'import a = require("./a.js");\nexport { a };',
      'export = require("./a.js");',
      'export * from "./a.js";;',
      'export * from "./a.js";\n/* never closed',
      'export * from "./a.js";\n/* a */ const hidden = 1; /* b */',
      'export * from "./a.js";\n// a\nconst hidden = 1;',
      "export * from `./a.js`;",
      'export * from "./a.js',
      'export * from "./a\nb.js";',
      'export * from "./a.js\\',
      'export * from "./a.js" with { type: json };',
      'export * from "./a.js" with { type: "json" ',
      'export * from "./a.js" with ',
      'export * from "./a.js" with { "a" }',
      'export * from "./a.js" with { a: "b" c: "d" }',
      'export * from "./a.js" with { , };',
      'export * from "./a.js" using { type: "json" };',
      'export { a b } from "./a.js";',
      'export { a, , b } from "./a.js";',
      'export { , } from "./a.js";',
      'export { a as } from "./a.js";',
      'export { a asb } from "./a.js";',
      'export { a.b } from "./a.js";',
      'export { 1a } from "./a.js";',
      'export { é } from "./a.js";',
      "export { a } from ./a.js;",
      "export { a } from;",
      'export { a } frm "./a.js";',
      'export { a } "./a.js";',
      "export { a ;",
      'export a from "./a.js";',
      'export * as from "./a.js";',
      'export * asb from "./a.js";',
      'export *as"b"from"./a.js";export function f() {}',
      "export typeof * from './a.js';",
      'exports * from "./a.js";',
      'xexport * from "./a.js";',
      'import xfrom "./a.js";\nexport { x };',
      'import x, from "./a.js";\nexport { x };',
      'import x, y from "./a.js";\nexport { x };',
      'import * from "./a.js";\nexport { x };',
      'import * x from "./a.js";\nexport { x };',
      'import * as from "./a.js";\nexport { x };',
      'import * asx from "./a.js";\nexport { x };',
      'import * as "x" from "./a.js";\nexport { x };',
      'import x, * from "./a.js";\nexport { x };',
      'import x * as y from "./a.js";\nexport { x };',
      'import x { y } from "./a.js";\nexport { x };',
      'import {} "./a.js";\nexport { x };',
      'importx from "./a.js";\nexport { x };',
      'import { x } from "./a.js" with { type: json };\nexport { x };',
      "export {};\nconst x = 1;",
    ]) {
      expect(isBarrel(text), JSON.stringify(text)).toBe(false);
    }
  });

  it("reads a file of imports and exports without a source as a barrel", () => {
    expect(isBarrel('import { x } from "./a.js";\nexport { x };')).toBe(true);
    expect(isBarrel('import x from "./a.js"\nexport { x }')).toBe(true);
    expect(isBarrel('import x,{y}from"./a.js";export{x,y}')).toBe(true);
    expect(isBarrel('import x,*as y from"./a.js";export{x,y}')).toBe(true);
    expect(isBarrel('import*as x from"./a.js";export{x}')).toBe(true);
    expect(isBarrel('import type{x}from"./a.js";export type{x}')).toBe(true);
    expect(isBarrel('import type x from "./a.js";\nexport type { x };')).toBe(true);
    expect(isBarrel('import type * as x from "./a.js";\nexport type { x };')).toBe(true);
    expect(isBarrel('import { x } from "./a.js" with { type: "json" };\nexport { x };')).toBe(true);
    expect(isBarrel('import { x }\nfrom "./a.js"\nexport { x }\n')).toBe(true);
    expect(isBarrel('export * from "./a.js"\t;\t\n')).toBe(true);
  });

  it("does not let a comment hide the code between two comments", () => {
    const text = 'export * from "./a.js"; /* a */ run(); /* b */';
    expect(isBarrel(text)).toBe(false);
    expect(isBarrel('export * from "./a.js"; /* a */ /* b */')).toBe(true);
    expect(isBarrel('export * from "./a.js"; /* a * b ** c */')).toBe(true);
    expect(isBarrel('export * from "./a.js"; /* a */ * /')).toBe(false);
  });
});

describe("findBarrels", () => {
  it("lists the barrels under src/, by what each file holds", () => {
    const dir = project("mixed", {
      "src/index.ts": PURE_BARREL,
      "src/parser/index.ts": largeParser(),
      "src/profiles/index.ts": ONE_STATEMENT,
      "src/model/exports.ts": 'export * from "./message.js";\n',
      "src/model/message.ts": "export class Message {}\n",
      "src/model/types.d.ts": 'export * from "./message.js";\n',
      "src/model/index.test.ts": 'export * from "./message.js";\n',
      "src/model/odd name.ts": 'export * from "./message.js";\n',
      "src/model/odd[1].ts": 'export * from "./message.js";\n',
      "src/model/readme.md": 'export * from "./message.js";\n',
      "src/model/view.tsx": 'export * from "./message.js";\n',
      "src/model/old.ts.txt": 'export * from "./message.js";\n',
      "src/folder.ts/inner.ts": 'export * from "../model/message.js";\n',
      "lib/index.ts": 'export * from "./a.js";\n',
    });
    symlinkSync(join(dir, "src/index.ts"), join(dir, "src/linked.ts"));
    expect(findBarrels(dir)).toEqual([
      "src/folder.ts/inner.ts",
      "src/index.ts",
      "src/model/exports.ts",
      "src/model/index.test.ts",
    ]);
  });

  it("finds none in a project without src/", () => {
    expect(findBarrels(project("empty", { "lib/index.ts": 'export * from "./a.js";\n' }))).toEqual(
      [],
    );
  });

  it("reads the working directory when it is given none", () => {
    const dir = project("cwd", { "src/index.ts": 'export * from "./a.js";\n' });
    const before = process.cwd();
    process.chdir(dir);
    try {
      expect(findBarrels()).toEqual(["src/index.ts"]);
    } finally {
      process.chdir(before);
    }
  });
});

describe("cosyteStryker's default mutate list", () => {
  it("leaves out the barrels it read, and keeps an index.ts that holds code", () => {
    const dir = project("stryker", {
      "src/index.ts": PURE_BARREL,
      "src/parser/index.ts": largeParser(),
      "src/profiles/index.ts": ONE_STATEMENT,
    });
    expect(DEFAULT_MUTATE).not.toContain("!src/**/index.ts");
    expect(cosyteStryker({ root: dir }).mutate).toEqual([...DEFAULT_MUTATE, "!src/index.ts"]);
    expect(cosyteStryker({ root: dir, mutate: ["src/a.ts"] }).mutate).toEqual(["src/a.ts"]);
  });

  it("reads the working directory when it is given no root", () => {
    const dir = project("stryker-cwd", { "src/index.ts": 'export * from "./a.js";\n' });
    const before = process.cwd();
    process.chdir(dir);
    try {
      expect(cosyteStryker().mutate).toEqual([...DEFAULT_MUTATE, "!src/index.ts"]);
    } finally {
      process.chdir(before);
    }
  });
});
