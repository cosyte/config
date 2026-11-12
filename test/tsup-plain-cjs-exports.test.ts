import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it, vi } from "vitest";

import { cosyteTsup } from "@cosyte/tsup-config";

import { rewriteCjsExports } from "../packages/tsup-config/plain-cjs-exports.js";

// `plainCjsExports` in @cosyte/tsup-config: with `splitting` on, the CommonJS entry points re-export
// what the shared chunk holds as getters that cannot be redefined, and the option turns them back
// into the writable data properties a one-file build has, or fails the build.

const FIXTURE = join(import.meta.dirname, "fixtures", "tsup-plain-cjs");
const TSUP_CLI = createRequire(import.meta.url).resolve("tsup/dist/cli-default.js");
const scratch = mkdtempSync(join(tmpdir(), "tsup-plain-cjs-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Builds the fixture's `entries` into a fresh folder; returns the folder and the tsup run. */
function build(
  entries: string[],
  { split = true, plain = true }: { split?: boolean; plain?: boolean } = {},
): { outDir: string; status: number | null; output: string } {
  const outDir = mkdtempSync(join(scratch, "dist-"));
  const run = spawnSync(
    process.execPath,
    [TSUP_CLI, "--config", "tsup.config.mjs", "--out-dir", outDir],
    {
      cwd: FIXTURE,
      encoding: "utf8",
      env: {
        ...process.env,
        FIXTURE_ENTRIES: entries.join(","),
        FIXTURE_SPLIT: split ? "1" : "0",
        FIXTURE_PLAIN: plain ? "1" : "0",
      },
    },
  );
  return { outDir, status: run.status, output: `${run.stdout}${run.stderr}` };
}

/** Each own export's descriptor, with the value left out, keyed by name. */
function shapes(mod: object): Record<string, PropertyDescriptor> {
  // fromEntries defines each key, so a key named __proto__ stays an own key here too.
  return Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(mod)).map(([name, descriptor]) => {
      const { value: _value, get, set, ...rest } = descriptor;
      return [name, { ...rest, ...(get || set ? { get, set } : {}) }];
    }),
  );
}

/** Runs CommonJS `code` with `modules` as what `require` returns; returns its `exports`. */
function evaluate(code: string, modules: Record<string, unknown> = {}): Record<string, unknown> {
  const exports = {};
  const load = (id: string): unknown => {
    if (!(id in modules)) throw new Error(`unexpected require: ${id}`);
    return modules[id];
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the module under test is text
  new Function("exports", "require", code)(exports, load);
  return exports;
}

const DATA = { writable: true, enumerable: true, configurable: true };

/** The getter rollup writes for a binding re-exported from another module. */
const getter = (name: string, from: string): string =>
  `Object.defineProperty(exports, "${name}", {\n  enumerable: true,\n  get: function () { return ${from}; }\n});\n`;

const CHUNK = [
  "'use strict';\n\n",
  "function parseDemo(text) { return text.trim(); }\n",
  "var DEMO_VERSION = '0.0.0-demo';\n",
  "exports.demoCounter = 0;\n",
  "function bumpDemoCounter() { exports.demoCounter += 1; }\n\n",
  "exports.DEMO_VERSION = DEMO_VERSION;\n",
  "exports.bumpDemoCounter = bumpDemoCounter;\n",
  "exports.parseDemo = parseDemo;\n",
  "//# sourceMappingURL=chunk-DEMO.cjs.map\n",
].join("");

const HEAD =
  "'use strict';\n\nvar chunk = require('./chunk-DEMO.cjs');\n\nfunction onlyIndex() { return 'index'; }\n\n";
const TRAILER = "//# sourceMappingURL=index.cjs.map\n//# sourceMappingURL=index.cjs.map\n";
const sibling = (specifier: string): string | undefined =>
  specifier === "./chunk-DEMO.cjs" ? CHUNK : undefined;
const chunkExports = evaluate(CHUNK);

describe("rewriteCjsExports, the forms it rewrites", () => {
  it("turns a getter into a chunk into a sorted plain assignment and keeps the trailer", () => {
    const code = `${HEAD}${getter("parseDemo", "chunk.parseDemo")}${getter("DEMO_VERSION", "chunk.DEMO_VERSION")}exports.onlyIndex = onlyIndex;\n${TRAILER}`;
    const out = rewriteCjsExports(code, sibling);
    expect(out).toBe(
      `${HEAD}exports.DEMO_VERSION = chunk.DEMO_VERSION;\nexports.onlyIndex = onlyIndex;\nexports.parseDemo = chunk.parseDemo;\n${TRAILER}`,
    );
    const mod = evaluate(out, { "./chunk-DEMO.cjs": chunkExports });
    expect(Object.keys(mod)).toEqual(["DEMO_VERSION", "onlyIndex", "parseDemo"]);
    for (const name of Object.keys(mod)) expect(shapes(mod)[name]).toEqual(DATA);
    expect(mod.parseDemo).toBe(chunkExports.parseDemo);
  });

  it("reads a bracket getter source and a bracket assignment", () => {
    const code = `${HEAD}${getter("parseDemo", 'chunk["parseDemo"]')}exports["dash-name"] = onlyIndex;\n${TRAILER}`;
    const mod = evaluate(rewriteCjsExports(code, sibling), { "./chunk-DEMO.cjs": chunkExports });
    expect(shapes(mod)).toEqual({ "dash-name": DATA, parseDemo: DATA });
  });

  it("defines __proto__ as an own export and never sets the module's prototype", () => {
    const proto = `Object.defineProperty(exports, "__proto__", {\n  enumerable: true,\n  value: onlyIndex\n});\n`;
    const out = rewriteCjsExports(`${HEAD}${proto}exports.onlyIndex = onlyIndex;\n`, sibling);
    expect(out).not.toMatch(/exports(?:\.__proto__|\["__proto__"\])\s*=/u);
    const mod = evaluate(out, { "./chunk-DEMO.cjs": chunkExports });
    expect(Object.getPrototypeOf(mod)).toBe(Object.prototype);
    expect(Object.hasOwn(mod, "__proto__")).toBe(true);
    expect(shapes(mod)).toEqual(
      Object.fromEntries([
        ["__proto__", DATA],
        ["onlyIndex", DATA],
      ]),
    );
  });

  it("defines a __proto__ re-exported from a chunk the same way", () => {
    const chunk = `${CHUNK}exports.demoProto = DEMO_VERSION;\n`;
    const out = rewriteCjsExports(`${HEAD}${getter("__proto__", "chunk.demoProto")}`, () => chunk);
    expect(out).toContain(
      'Object.defineProperty(exports, "__proto__", { value: chunk.demoProto, writable: true, enumerable: true, configurable: true });',
    );
    const mod = evaluate(out, { "./chunk-DEMO.cjs": evaluate(chunk) });
    expect(Object.getPrototypeOf(mod)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(mod, "__proto__")?.value).toBe("0.0.0-demo");
  });

  it("leaves the __esModule marker, the head and a local live binding as they are", () => {
    const head = `'use strict';\n\nObject.defineProperty(exports, '__esModule', { value: true });\n\nexports.counter = 0;\nfunction bump() { exports.counter += 1; }\n\n`;
    const out = rewriteCjsExports(
      `${head}exports.bump = bump;\nexports.default = bump;\n`,
      sibling,
    );
    expect(out).toBe(`${head}exports.bump = bump;\nexports.default = bump;\n`);
  });
});

describe("rewriteCjsExports, the forms it refuses", () => {
  const refuse = (code: string, message: RegExp): void => {
    expect(() => rewriteCjsExports(code, sibling)).toThrow(message);
  };

  it("a star re-export, whose getters are indented inside a loop", () => {
    const star =
      "Object.keys(path).forEach(function (k) {\n  if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {\n    enumerable: true,\n    get: function () { return path[k]; }\n  });\n});\n";
    refuse(
      `${HEAD}exports.onlyIndex = onlyIndex;\n${star}${TRAILER}`,
      /a getter or exports passed whole/u,
    );
    refuse(
      `${HEAD}${star}exports.onlyIndex = onlyIndex;\n${TRAILER}`,
      /a getter or exports passed whole/u,
    );
  });

  it("a getter that is not at the end of the file", () => {
    refuse(
      `${HEAD}${getter("parseDemo", "chunk.parseDemo")}function late() {}\nexports.late = late;\n`,
      /a getter or exports passed whole/u,
    );
  });

  it("a one-line getter, as sucrase writes it with treeshake off", () => {
    refuse(
      `${HEAD}Object.defineProperty(exports, 'parseDemo', {enumerable: true, get: function () { return chunk.parseDemo; }});\n`,
      /a getter or exports passed whole/u,
    );
  });

  it("exports passed whole, and module.exports", () => {
    refuse(`${HEAD}__export(exports, { a: () => a });\n`, /a getter or exports passed whole/u);
    refuse(
      `${HEAD}module.exports = __toCommonJS(src_exports);\n`,
      /a getter or exports passed whole/u,
    );
  });

  it("a getter into a module the build did not write", () => {
    refuse(
      `'use strict';\n\nvar path = require('path');\n\n${getter("pathSep", "path.sep")}`,
      /"pathSep" re-exports .* not a file of this build/u,
    );
  });

  it("a getter into a chunk that reassigns the binding", () => {
    refuse(`${HEAD}${getter("demoCounter", "chunk.demoCounter")}`, /"demoCounter" .* reassigns/u);
  });

  it("a getter into a chunk that does not export the binding as a plain value", () => {
    refuse(`${HEAD}${getter("missing", "chunk.missing")}`, /"missing" .* not a plain export/u);
  });

  it("a getter whose source is not a required module", () => {
    refuse(
      `${HEAD}${getter("parseDemo", "other.parseDemo")}`,
      /"parseDemo" re-exports .* not a file of this build/u,
    );
  });

  it("the same name exported twice", () => {
    refuse(
      `${HEAD}exports.onlyIndex = onlyIndex;\nexports.onlyIndex = onlyIndex;\n`,
      /"onlyIndex" twice/u,
    );
  });

  it("a file with no export block at its end", () => {
    refuse(`${HEAD}${TRAILER}`, /no export block/u);
  });
});

describe("cosyteTsup({ plainCjsExports })", () => {
  it("is off by default and leaves the plugins it is given", () => {
    const own = { name: "own" };
    expect(cosyteTsup({ entry: ["src/index.ts"] })).not.toHaveProperty("plainCjsExports");
    const on = cosyteTsup({ entry: ["src/index.ts"], plugins: [own], plainCjsExports: true });
    const obj = Array.isArray(on) ? on[0] : on;
    expect(obj).not.toHaveProperty("plainCjsExports");
    expect(obj.plugins?.map((plugin: { name: string }) => plugin.name)).toEqual([
      "own",
      "cosyte-plain-cjs-exports",
    ]);
  });

  it("gives a split build the same CommonJS descriptors as a one-file build", () => {
    const entries = ["index", "parse", "names"];
    const split = build(entries);
    expect(split.output).toBe("");
    expect(split.status).toBe(0);
    const single = build(["index", "parse"], { split: false, plain: false });
    expect(single.status).toBe(0);
    const load = createRequire(join(split.outDir, "x.cjs"));
    const loadSingle = createRequire(join(single.outDir, "x.cjs"));
    for (const entry of ["index", "parse"]) {
      const mod = load(`./${entry}.cjs`) as object;
      expect(shapes(mod)).toEqual(shapes(loadSingle(`./${entry}.cjs`) as object));
      for (const descriptor of Object.values(shapes(mod))) expect(descriptor).toEqual(DATA);
    }
    // One shared class behind both entry points, and a stub that a getter would have refused.
    const index = load("./index.cjs") as Record<string, unknown>;
    const parse = load("./parse.cjs") as Record<string, (text: string) => string>;
    expect(index.DemoError).toBe(parse.DemoError);
    const spy = vi.spyOn(parse, "parseDemo").mockReturnValue("stubbed");
    expect(parse.parseDemo(" x ")).toBe("stubbed");
    spy.mockRestore();
    // Names that are not identifiers, and the default.
    const names = load("./names.cjs") as Record<string, unknown>;
    expect(Object.getPrototypeOf(names)).toBe(Object.prototype);
    expect(shapes(names)).toEqual(
      Object.fromEntries([
        ["__esModule", { writable: false, enumerable: false, configurable: false }],
        ["__proto__", DATA],
        ["dash-name", DATA],
        ["default", DATA],
        ["parseDemo", DATA],
      ]),
    );
    expect(Object.getOwnPropertyDescriptor(names, "__proto__")?.value).toEqual({ synthetic: true });
    // Node still finds every name when ESM imports the CommonJS file.
    const url = pathToFileURL(join(split.outDir, "names.cjs")).href;
    const esm = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import * as m from ${JSON.stringify(url)}; console.log(JSON.stringify(Object.keys(m)));`,
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(esm.stdout)).toEqual(
      expect.arrayContaining(["__proto__", "dash-name", "default", "parseDemo"]),
    );
    expect(readFileSync(join(split.outDir, "parse.cjs"), "utf8")).toMatch(
      /\/\/# sourceMappingURL=parse\.cjs\.map\n?$/u,
    );
  });

  it("fails the build on a star re-export of an external module", () => {
    const run = build(["star-external"]);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/star-external\.cjs: .*a getter or exports passed whole/u);
  });

  it("fails the build on a live binding the chunk reassigns", () => {
    const run = build(["index", "live"]);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/live\.cjs: "demoCounter" .* reassigns/u);
  });

  it("without the option, a split build keeps the getters", () => {
    const run = build(["index", "parse"], { plain: false });
    expect(run.status).toBe(0);
    const mod = createRequire(join(run.outDir, "x.cjs"))("./parse.cjs") as object;
    expect(Object.getOwnPropertyDescriptor(mod, "parseDemo")?.get).toBeTypeOf("function");
  });
});
