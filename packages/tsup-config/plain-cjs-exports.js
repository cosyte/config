import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * Turns the exports of a built CommonJS entry point back into ordinary data properties.
 *
 * With `splitting` on, tsup has rollup turn each entry point into CommonJS on its own, with the
 * shared chunk as an external module, and rollup re-exports an external module's binding as a
 * getter that cannot be redefined:
 *
 *   Object.defineProperty(exports, "parseDemo", {
 *     enumerable: true,
 *     get: function () { return chunk_cjs.parseDemo; }
 *   });
 *
 * A one-file build gives `exports.parseDemo = parseDemo;` instead: a writable, configurable data
 * property, which is what `jest.spyOn` and `vi.spyOn` redefine on a CommonJS module. This rewrites
 * the export block at the end of the file into that form, every name in sorted order. A getter is
 * rewritten only when it reads a chunk this build wrote, and only when that chunk exports the
 * binding as a plain value it never reassigns, so the copy is the value the getter would return.
 *
 * Anything else that could leave a getter on `exports` fails the build: a getter anywhere outside
 * that block (a star re-export writes them indented, inside a loop), `exports` passed whole to a
 * function, `module.exports`, a getter into a module the build left external, and a binding the
 * chunk reassigns. A name that is not a plain identifier, `__proto__` among them, is defined with
 * `Object.defineProperty`, so no export name can set the module's prototype.
 */

const NAME = String.raw`[A-Za-z_$][\w$]*`;
/** A double-quoted export name as rollup writes it: no quote, backslash or line break inside. */
const QUOTED = String.raw`"[^"\\\n]*"`;
/** `id.name` or `id["name"]`: a property of a required module. */
const MEMBER = String.raw`(${NAME})(?:\.(${NAME})|\[(${QUOTED})\])`;

/** `Object.defineProperty(exports, "name", { enumerable: true, get: ... })`, as rollup writes it. */
const GETTER = new RegExp(
  String.raw`^Object\.defineProperty\(exports, (${QUOTED}), \{\n {2}enumerable: true,\n {2}get: function \(\) \{ return ${MEMBER}; \}\n\}\);\n`,
  "u",
);

/** `Object.defineProperty(exports, "name", { enumerable: true, value: id })`, rollup's `__proto__`. */
const VALUE = new RegExp(
  String.raw`^Object\.defineProperty\(exports, (${QUOTED}), \{\n {2}enumerable: true,\n {2}value: (${NAME}(?:\.${NAME})?)\n\}\);\n`,
  "u",
);

/** `exports.name = value;` or `exports["name"] = value;`, as rollup writes a local export. */
const ASSIGNMENT = new RegExp(
  String.raw`^exports(?:\.(${NAME})|\[(${QUOTED})\]) = (${NAME}(?:\.${NAME})?);\n`,
  "u",
);

/** The source map comments rollup and esbuild leave at the end of the file. */
const TRAILER = /^(?:\/\/# sourceMappingURL=[^\n]*(?:\n|$)|\n)*$/u;

/** Where an export statement can start: the first column, as rollup writes the block. */
const STARTS = /^(?:Object\.defineProperty\(exports, "|exports(?:\.|\["))/gmu;

/** The one `defineProperty(exports, ...)` a CommonJS entry may hold before its export block. */
const ES_MODULE = /^Object\.defineProperty\(exports, '__esModule', \{ value: true \}\);$/gmu;

/**
 * Anything outside the export block that could leave a getter on `exports`: a `defineProperty` or
 * `defineProperties` on it in any form, `exports` passed whole to a function, or `module.exports`.
 */
const UNSAFE =
  /\bdefineProperties?\s*\(\s*exports\b|[(,]\s*exports\s*[,)]|\bmodule\s*\.\s*exports\b/u;

/** `var id = require('./file.cjs');`, as rollup loads a chunk. */
const REQUIRE = new RegExp(String.raw`^var (${NAME}) = require\('(\.{1,2}/[^'\n]+)'\);$`, "gmu");

const IDENTIFIER = new RegExp(String.raw`^${NAME}$`, "u");

/**
 * `text` with every character a regular expression gives a meaning escaped.
 *
 * @param {string} text - Literal text.
 * @returns {string} The pattern that matches it.
 */
function escape(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);
}

/**
 * @typedef {object} Export
 * @property {string} value - The expression the export holds.
 * @property {{ module: string, name: string } | undefined} source - The required module and the
 *   name read from it, for a getter.
 */

/**
 * The export statement at the start of `text`, or `undefined` when it does not start with one.
 *
 * @param {string} text - The rest of a file.
 * @returns {{ length: number, name: string, entry: Export } | undefined} The statement.
 */
function readStatement(text) {
  const getter = GETTER.exec(text);
  if (getter) {
    const [statement, quoted, module, dotted, bracketed] = getter;
    const read = dotted === undefined ? `[${bracketed}]` : `.${dotted}`;
    const name = dotted ?? JSON.parse(bracketed);
    return {
      length: statement.length,
      name: JSON.parse(quoted),
      entry: { value: `${module}${read}`, source: { module, name } },
    };
  }
  const value = VALUE.exec(text);
  if (value) {
    const [statement, quoted, expression] = value;
    return {
      length: statement.length,
      name: JSON.parse(quoted),
      entry: { value: expression, source: undefined },
    };
  }
  const assignment = ASSIGNMENT.exec(text);
  if (assignment) {
    const [statement, dotted, quoted, expression] = assignment;
    const name = dotted ?? JSON.parse(quoted);
    return { length: statement.length, name, entry: { value: expression, source: undefined } };
  }
  return undefined;
}

/**
 * The export statements of `tail` and the source map comments after them, or `undefined` when
 * anything else is in it.
 *
 * @param {string} tail - The end of a file, from where an export block may start.
 * @returns {{ exports: Map<string, Export>, trailer: string, twice: string | undefined } | undefined}
 *   The block, and a name it holds twice.
 */
function readExports(tail) {
  /** @type {Map<string, Export>} */
  const exports = new Map();
  let twice;
  let rest = tail;
  while (!TRAILER.test(rest)) {
    const statement = readStatement(rest);
    if (statement === undefined) return undefined;
    if (exports.has(statement.name)) twice ??= statement.name;
    exports.set(statement.name, statement.entry);
    rest = rest.slice(statement.length);
  }
  return { exports, trailer: rest, twice };
}

/**
 * The file's export block, the code before it and the source map comments after it.
 *
 * @param {string} code - A CommonJS file rollup wrote.
 * @returns {{ body: string, exports: Map<string, Export>, trailer: string } | undefined} The parts.
 */
function split(code) {
  for (const start of code.matchAll(STARTS)) {
    const block = readExports(code.slice(start.index));
    if (block === undefined) continue;
    if (block.twice !== undefined) {
      throw new Error(`the export block names ${JSON.stringify(block.twice)} twice`);
    }
    return { body: code.slice(0, start.index), exports: block.exports, trailer: block.trailer };
  }
  return undefined;
}

/**
 * The statement that defines `name` as a writable, enumerable, configurable data property.
 *
 * @param {string} name - The export name.
 * @param {string} value - The expression it holds.
 * @returns {string} The statement, with its line break.
 */
function define(name, value) {
  if (IDENTIFIER.test(name) && name !== "__proto__") return `exports.${name} = ${value};\n`;
  return `Object.defineProperty(exports, ${JSON.stringify(name)}, { value: ${value}, writable: true, enumerable: true, configurable: true });\n`;
}

/**
 * Checks that `name` in the chunk `code` is a plain export the chunk never reassigns, so a copy
 * taken after the chunk has loaded is what a getter would return.
 *
 * @param {string} code - The chunk.
 * @param {string} name - The binding an entry re-exports from it.
 * @param {string} exported - The entry's export name, for the error.
 * @param {string} specifier - The chunk's specifier, for the error.
 * @throws {Error} When the binding is not a plain export of the chunk or the chunk reassigns it.
 */
function checkChunkBinding(code, name, exported, specifier) {
  const block = split(code);
  const property = IDENTIFIER.test(name)
    ? String.raw`\.${escape(name)}(?![\w$])`
    : String.raw`\[\s*${escape(JSON.stringify(name))}\s*\]`;
  const body = block === undefined ? code : block.body;
  if (new RegExp(String.raw`\bexports\s*${property}`, "u").test(body)) {
    throw new Error(
      `${JSON.stringify(exported)} re-exports ${JSON.stringify(name)}, which ${specifier} reassigns, so a copy would go stale`,
    );
  }
  const entry = block?.exports.get(name);
  if (entry === undefined || entry.source !== undefined) {
    throw new Error(
      `${JSON.stringify(exported)} re-exports ${JSON.stringify(name)}, which is not a plain export of ${specifier}`,
    );
  }
}

/**
 * `code` with its export block as plain data properties in sorted order.
 *
 * @param {string} code - A CommonJS entry point rollup wrote.
 * @param {(specifier: string) => string | undefined} readSibling - The text of the file a relative
 *   `require` specifier names, or `undefined` when the build did not write it.
 * @returns {string} The rewritten file.
 * @throws {Error} When the file could keep a getter on `exports` in a form this does not rewrite.
 */
export function rewriteCjsExports(code, readSibling) {
  const block = split(code);
  if (UNSAFE.test((block?.body ?? code).replace(ES_MODULE, ""))) {
    throw new Error(
      "a getter or exports passed whole outside the export block at the end of the file (a star re-export writes one)",
    );
  }
  if (block === undefined) throw new Error("no export block recognized at the end of the file");
  const { body, exports, trailer } = block;
  /** @type {Map<string, string>} */
  const required = new Map();
  for (const [, id, specifier] of body.matchAll(REQUIRE)) required.set(id, specifier);
  for (const [exported, { source }] of exports) {
    if (source === undefined) continue;
    const specifier = required.get(source.module);
    const chunk = specifier === undefined ? undefined : readSibling(specifier);
    if (chunk === undefined) {
      throw new Error(
        `${JSON.stringify(exported)} re-exports ${source.module}, which is not a file of this build, as a getter`,
      );
    }
    checkChunkBinding(chunk, source.name, exported, specifier);
  }
  const names = [...exports.keys()].sort();
  return body + names.map((name) => define(name, exports.get(name).value)).join("") + trailer;
}

/**
 * Rewrites the CommonJS entry point at `path` in place.
 *
 * @param {string} path - The absolute path of the file.
 * @throws {Error} Naming the file, when it could keep a getter on `exports`.
 */
export function rewriteCjsFile(path) {
  try {
    const code = readFileSync(path, "utf8");
    const out = rewriteCjsExports(code, (specifier) => {
      try {
        return readFileSync(join(dirname(path), specifier), "utf8");
      } catch {
        return undefined;
      }
    });
    if (out !== code) writeFileSync(path, out);
  } catch (error) {
    throw new Error(`plainCjsExports: ${path}: ${error.message}`, { cause: error });
  }
}

/**
 * The tsup plugin behind `plainCjsExports`: it notes each CommonJS entry point as tsup renders it
 * and rewrites each one once tsup has written every file of the format.
 *
 * @returns {import("tsup").Options["plugins"][number]} The plugin.
 */
export function plainCjsExportsPlugin() {
  /** @type {Set<string>} */
  const entries = new Set();
  return {
    name: "cosyte-plain-cjs-exports",
    renderChunk(_code, info) {
      if (this.format === "cjs" && info.entryPoint) entries.add(info.path);
    },
    buildEnd() {
      if (this.format !== "cjs") return;
      for (const path of [...entries].sort()) rewriteCjsFile(path);
      entries.clear();
    },
  };
}
