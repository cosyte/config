/**
 * The release pull request check. Each rule is shown red on a tree that breaks it and green on the
 * smallest tree that keeps it, and the command line is graded on its exit codes: 0 clean, 1 a
 * finding, 2 could not read its input.
 *
 * Every package, test and changeset here is synthetic.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bulletLengthBound,
  checkChangeset,
  checkReleasePr,
  checkVersionScript,
  checkVersionTests,
  declaresVersion,
  openingSentence,
  readReleasePrInput,
  RELEASE_BULLET_LIMIT,
  RELEASE_PR_RULES,
  runReleasePrCheck,
  scriptSteps,
  freshVersionTestGaps,
  loadTypeScript,
} from "../release-pr.js";

const EM_DASH = String.fromCodePoint(0x2014);

/** The version script the template carries. */
const GOOD_SCRIPT =
  "changeset version && cosyte-process sync-version && cosyte-docs-reference && cosyte-process format";

/** A test file that pins VERSION through a fresh import, the shape the check asks for. */
const GOOD_TEST = [
  'import { readFileSync } from "node:fs";',
  'import { describe, expect, it, vi } from "vitest";',
  "",
  'const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));',
  "",
  'describe("VERSION", () => {',
  '  it("equals package.json", async () => {',
  "    vi.resetModules();",
  '    const { VERSION } = await import("../src/index.js");',
  "    expect(VERSION).toBe(pkg.version);",
  "  });",
  "});",
  "",
].join("\n");

/** A changeset with this summary. */
function changeset(summary: string, front = '"@cosyte/demo": patch'): string {
  return `---\n${front}\n---\n\n${summary}\n`;
}

/** A sentence of exactly `n` characters, ending in a full stop that the headline drops. */
function sentenceOf(n: number): string {
  return `${"a".repeat(n)}.`;
}

/** Collect what a run writes. */
function sink(): { stream: { write: (s: string) => boolean }; text: () => string } {
  let out = "";
  return {
    stream: {
      write: (s: string) => {
        out += s;
        return true;
      },
    },
    text: () => out,
  };
}

describe("the rules", () => {
  it("names four rules, each with what it requires", () => {
    expect(Object.keys(RELEASE_PR_RULES).sort()).toEqual([
      "changeset-bullet",
      "changeset-shape",
      "version-script",
      "version-test",
    ]);
    for (const text of Object.values(RELEASE_PR_RULES)) expect(text.length).toBeGreaterThan(20);
    expect(RELEASE_BULLET_LIMIT).toBe(400);
  });
});

describe("scriptSteps", () => {
  it("splits a script on && and trims each step", () => {
    expect(scriptSteps("a  &&b &&  c d", {})).toEqual(["a", "b", "c d"]);
    expect(scriptSteps("   ", {})).toEqual([]);
  });

  it("expands a step that runs another script, through pnpm, pnpm run and npm run", () => {
    const scripts = {
      "docs:reference": "cosyte-docs-reference",
      inner: "x && y",
      outer: "pnpm inner",
    };
    expect(scriptSteps("a && pnpm docs:reference", scripts)).toEqual([
      "a",
      "cosyte-docs-reference",
    ]);
    expect(scriptSteps("pnpm run inner && z", scripts)).toEqual(["x", "y", "z"]);
    expect(scriptSteps("npm run outer", scripts)).toEqual(["x", "y"]);
  });

  it("keeps a step that names no script, or names one that is not a string", () => {
    expect(scriptSteps("pnpm nothing && pnpm run", { odd: 3 })).toEqual([
      "pnpm nothing",
      "pnpm run",
    ]);
    expect(scriptSteps("pnpm odd", { odd: 3 })).toEqual(["pnpm odd"]);
  });

  it("stops at a script that runs itself rather than looping", () => {
    const scripts = { a: "pnpm b", b: "pnpm a && c" };
    expect(scriptSteps("pnpm a", scripts)).toEqual(["pnpm a", "c"]);
  });
});

describe("version-script", () => {
  it("passes the template's script, and one that reaches the reference through a script", () => {
    expect(checkVersionScript({ version: GOOD_SCRIPT })).toEqual([]);
    expect(
      checkVersionScript({
        version: "changeset version && node scripts/sync-version.mjs && pnpm docs:reference",
        "docs:reference": "cosyte-docs-reference",
      }),
    ).toEqual([]);
  });

  it("refuses a package with no version script at all", () => {
    const found = checkVersionScript({});
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("version-script");
    expect(found[0]?.file).toBe("package.json");
    expect(found[0]?.message).toContain('no "version" script');
    expect(checkVersionScript({ version: 7 })[0]?.message).toContain('no "version" script');
  });

  it("refuses a script with no changeset version step", () => {
    const found = checkVersionScript({
      version: "cosyte-process sync-version && cosyte-docs-reference",
    });
    expect(found.map((f) => f.message)).toEqual([expect.stringContaining("`changeset version`")]);
  });

  it("refuses a script that never syncs VERSION, or syncs it before the bump", () => {
    const none = checkVersionScript({ version: "changeset version && cosyte-docs-reference" });
    expect(none.map((f) => f.message)).toEqual([expect.stringContaining("sync-version")]);
    const early = checkVersionScript({
      version: "cosyte-process sync-version && changeset version && cosyte-docs-reference",
    });
    expect(early.map((f) => f.message)).toEqual([expect.stringContaining("before")]);
  });

  it("refuses a script that does not regenerate the API reference (the synth defect)", () => {
    const found = checkVersionScript({
      version: "changeset version && cosyte-process sync-version && cosyte-process format",
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("cosyte-docs-reference");
    const checkOnly = checkVersionScript({
      version: "changeset version && cosyte-process sync-version && cosyte-docs-reference --check",
    });
    expect(checkOnly).toHaveLength(1);
    expect(checkOnly[0]?.message).toContain("cosyte-docs-reference");
  });

  it("reads --check written with a value as the check it is, not a regeneration", () => {
    for (const flag of ["--check=true", "--check=1"]) {
      const found = checkVersionScript({
        version: `changeset version && cosyte-process sync-version && cosyte-docs-reference ${flag}`,
      });
      expect(
        found.map((f) => f.message),
        flag,
      ).toEqual([expect.stringContaining("cosyte-docs-reference")]);
    }
    const other = checkVersionScript({
      version:
        "changeset version && cosyte-process sync-version && cosyte-docs-reference --checked",
    });
    expect(other).toEqual([]);
  });

  it("refuses a reference regenerated before VERSION is synced", () => {
    const found = checkVersionScript({
      version: "changeset version && cosyte-docs-reference && cosyte-process sync-version",
    });
    expect(found.map((f) => f.message)).toEqual([expect.stringContaining("after")]);
  });

  it("reports every gap at once", () => {
    expect(checkVersionScript({ version: "prettier --write ." })).toHaveLength(3);
  });
});

describe("freshVersionTestGaps", () => {
  it("finds no gap in a test that pins VERSION through a fresh import", () => {
    expect(freshVersionTestGaps("test/version.test.ts", GOOD_TEST)).toEqual([]);
  });

  it("accepts a source path with no extension, and the declaring module itself", () => {
    const bare = GOOD_TEST.replace("../src/index.js", "../src");
    expect(freshVersionTestGaps("test/version.test.ts", bare)).toEqual([]);
    const nested = GOOD_TEST.replace("../src/index.js", "../../src/version.js");
    expect(freshVersionTestGaps("test/unit/version.test.ts", nested)).toEqual([]);
  });

  it("names a static import of the source (the hl7, fhir, dicom and mllp defect)", () => {
    const text = `import { VERSION } from "../src/index.js";\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/sanity.test.ts", text)).toEqual([
      expect.stringContaining("imports the source statically"),
    ]);
    const sideEffect = `import "../src/setup.js";\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", sideEffect)).toHaveLength(1);
    const reexport = `export { VERSION } from "../src/index.js";\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", reexport)).toHaveLength(1);
    const multiline = `import {\n  VERSION,\n} from "../src/index.js";\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", multiline)).toHaveLength(1);
  });

  it("allows a type-only import of the source and a static import of anything else", () => {
    const text = `import type { Parsed } from "../src/index.js";\nimport { x } from "./helpers.js";\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", text)).toEqual([]);
  });

  it("does not read an import written in a comment", () => {
    const text = `/*\n * import { VERSION } from "../src/index.js";\n */\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", text)).toEqual([]);
  });

  it("names a test with no module-cache reset, or one that resets only after the import", () => {
    const none = GOOD_TEST.replace("    vi.resetModules();\n", "");
    expect(freshVersionTestGaps("test/a.test.ts", none)).toEqual([
      expect.stringContaining("resetModules"),
    ]);
    const late = none.replace("    expect(VERSION)", "    vi.resetModules();\n    expect(VERSION)");
    expect(freshVersionTestGaps("test/a.test.ts", late)).toEqual([
      expect.stringContaining("resetModules"),
    ]);
  });

  it("names a test with no dynamic import of the source", () => {
    const outside = GOOD_TEST.replace("../src/index.js", "../dist/index.js");
    expect(freshVersionTestGaps("test/a.test.ts", outside)).toEqual([
      expect.stringContaining("dynamic import"),
    ]);
    const bare = GOOD_TEST.replace("../src/index.js", "@cosyte/demo");
    expect(freshVersionTestGaps("test/a.test.ts", bare)).toEqual([
      expect.stringContaining("dynamic import"),
    ]);
    const prefixed = GOOD_TEST.replace("../src/index.js", "../srcx/index.js");
    expect(freshVersionTestGaps("test/a.test.ts", prefixed)).toHaveLength(1);
  });

  it("names a dynamic import at the top of the file, outside any test body", () => {
    // Evaluated while the file is collected, before any test runs: the static import's defect.
    const text = [
      'import pkg from "../package.json";',
      "vi.resetModules();",
      'const { VERSION } = await import("../src/index.js");',
      'it("x", () => expect(VERSION).toBe(pkg.version));',
    ].join("\n");
    const gaps = freshVersionTestGaps("test/v.test.ts", text);
    expect(gaps).toContainEqual(expect.stringContaining("outside a test body"));
    expect(gaps).toContainEqual(expect.stringContaining("no dynamic import of the source inside"));
  });

  it("names an import in a describe callback or a hook, which is not a test body", () => {
    const inDescribe = GOOD_TEST.replace(
      'describe("VERSION", () => {',
      'describe("VERSION", async () => {\n  await import("../src/index.js");',
    );
    expect(freshVersionTestGaps("test/a.test.ts", inDescribe)).toEqual([
      expect.stringContaining("outside a test body"),
    ]);
    const inHook = GOOD_TEST.replace(
      'describe("VERSION", () => {',
      'describe("VERSION", () => {\n  beforeAll(() => import("../src/index.js"));',
    );
    expect(freshVersionTestGaps("test/a.test.ts", inHook)).toEqual([
      expect.stringContaining("outside a test body"),
    ]);
  });

  it("is not satisfied by a comment or a string", () => {
    const comment = [
      '// VERSION package.json vi.resetModules() await import("../src/index.js")',
      'it("x", () => {});',
    ].join("\n");
    const fromComment = freshVersionTestGaps("test/v.test.ts", comment);
    expect(fromComment).toContainEqual(expect.stringContaining("no dynamic import"));
    expect(fromComment).toContainEqual(expect.stringContaining("package.json"));
    const strings = GOOD_TEST.replace(
      '    vi.resetModules();\n    const { VERSION } = await import("../src/index.js");',
      "    const s = 'vi.resetModules(); await import(\"../src/index.js\")';\n    const VERSION = s;",
    );
    expect(freshVersionTestGaps("test/a.test.ts", strings)).toEqual([
      expect.stringContaining("no dynamic import"),
    ]);
  });

  it("names a reset and an import that sit in two different test bodies", () => {
    const split = GOOD_TEST.replace(
      "    vi.resetModules();\n",
      '    expect(1).toBe(1);\n  });\n  it("other", async () => {\n    vi.resetModules();\n',
    ).replace(
      '  it("equals package.json", async () => {',
      '  it("equals package.json", async () => {\n    await import("../src/index.js");',
    );
    // The first body imports without a reset; the second resets, imports and reads VERSION.
    expect(freshVersionTestGaps("test/a.test.ts", split)).toEqual([]);
    const apart = [
      'import pkg from "../package.json";',
      'it("a", () => { vi.resetModules(); });',
      'it("b", async () => { const { VERSION } = await import("../src/index.js"); expect(VERSION).toBe(pkg.version); });',
    ].join("\n");
    expect(freshVersionTestGaps("test/a.test.ts", apart)).toEqual([
      expect.stringContaining("resetModules"),
    ]);
  });

  it("names a VERSION read only outside the body that imports the source", () => {
    const text = [
      'import pkg from "../package.json";',
      "const VERSION = pkg.version;",
      'it("a", async () => { vi.resetModules(); await import("../src/index.js"); });',
    ].join("\n");
    expect(freshVersionTestGaps("test/a.test.ts", text)).toEqual([
      expect.stringContaining("never reads VERSION"),
    ]);
    const elsewhere = text
      .replace("const VERSION = pkg.version;\n", "")
      .concat('\nit("b", () => { const VERSION = pkg.version; });');
    expect(freshVersionTestGaps("test/a.test.ts", elsewhere)).toEqual([
      expect.stringContaining("never reads VERSION in the test body that imports the source"),
    ]);
  });

  it("names a require of the source at the top of the file, and a static import of its folder", () => {
    const required = `const { VERSION } = require("../src/index.js");\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", required)).toEqual([
      expect.stringContaining("outside a test body"),
    ]);
    const folder = `import { VERSION } from "../src";\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", folder)).toEqual([
      expect.stringContaining("imports the source statically"),
    ]);
    const equals = `import src = require("../src/index.js");\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", equals)).toEqual([
      expect.stringContaining("imports the source statically"),
    ]);
    const two = `const VERSION = 1;\nfunction h() { return import("../src/b.js"); }\nawait import("../src/a.js");\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", two)).toEqual([
      expect.stringContaining("outside a test body (line 2, line 3)"),
    ]);
    const alias = `namespace N { export const x = 1; }\nimport X = N.x;\n${GOOD_TEST}`;
    expect(freshVersionTestGaps("test/a.test.ts", alias)).toEqual([]);
  });

  it("accepts the test written with test(), it.each and a template-literal specifier, in JavaScript", () => {
    const viaTest = GOOD_TEST.replace('  it("equals', '  test("equals');
    expect(freshVersionTestGaps("test/a.test.ts", viaTest)).toEqual([]);
    const each = GOOD_TEST.replace(
      '  it("equals package.json", async () => {',
      '  it.each([1])("equals %s", async () => {',
    );
    expect(freshVersionTestGaps("test/a.test.ts", each)).toEqual([]);
    const template = GOOD_TEST.replace('import("../src/index.js")', "import(`../src/index.js`)");
    expect(freshVersionTestGaps("test/a.test.js", template)).toEqual([]);
    const property = GOOD_TEST.replace(
      '    const { VERSION } = await import("../src/index.js");\n    expect(VERSION)',
      '    const mod = await import("../src/index.js");\n    expect(mod.VERSION)',
    );
    expect(freshVersionTestGaps("test/a.test.mjs", property)).toEqual([]);
  });

  it("does not count a skipped test, which never runs", () => {
    const skipped = GOOD_TEST.replace('  it("equals', '  it.skip("equals');
    expect(freshVersionTestGaps("test/a.test.ts", skipped)).toContainEqual(
      expect.stringContaining("outside a test body"),
    );
    const todo = GOOD_TEST.replace('  it("equals', '  test.todo("equals');
    expect(freshVersionTestGaps("test/a.test.ts", todo)).toContainEqual(
      expect.stringContaining("outside a test body"),
    );
  });

  it("accepts a named helper that only test bodies call, the shape hl7 and fhir use", () => {
    const helper = [
      'import { readFileSync } from "node:fs";',
      'import { expect, it, vi } from "vitest";',
      "async function freshVersion(): Promise<string> {",
      "  vi.resetModules();",
      '  const { VERSION } = await import("../src/index.js");',
      "  return VERSION;",
      "}",
      'const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));',
      'it("pins VERSION", async () => {',
      "  expect(await freshVersion()).toBe(pkg.version);",
      "});",
    ].join("\n");
    expect(freshVersionTestGaps("test/sanity.test.ts", helper)).toEqual([]);
    const arrow = helper
      .replace(
        "async function freshVersion(): Promise<string> {",
        "const freshVersion = async (): Promise<string> => {",
      )
      .replace("  return VERSION;\n}", "  return VERSION;\n};");
    expect(freshVersionTestGaps("test/sanity.test.ts", arrow)).toEqual([]);
    const throughTwo = helper
      .replace("async function freshVersion()", "async function inner()")
      .replace("const pkg", "async function freshVersion() { return inner(); }\nconst pkg");
    expect(freshVersionTestGaps("test/sanity.test.ts", throughTwo)).toEqual([]);
    const passed = helper.replace(
      'it("pins VERSION", async () => {\n  expect(await freshVersion()).toBe(pkg.version);\n});',
      'it("pins VERSION", freshVersion);\npkg;',
    );
    expect(freshVersionTestGaps("test/sanity.test.ts", passed)).toEqual([]);
  });

  it("names a helper that runs outside a test body, or never runs", () => {
    const helper = [
      'import pkg from "../package.json";',
      "async function freshVersion() {",
      "  vi.resetModules();",
      '  const { VERSION } = await import("../src/index.js");',
      "  return VERSION;",
      "}",
    ].join("\n");
    const topLevel = `${helper}\nconst v = await freshVersion();\nit("x", () => expect(v).toBe(pkg.version));`;
    expect(freshVersionTestGaps("test/a.test.ts", topLevel)).toContainEqual(
      expect.stringContaining("outside a test body (line 4)"),
    );
    const inHook = `${helper}\nbeforeAll(async () => { await freshVersion(); });\nit("x", async () => expect(await freshVersion()).toBe(pkg.version));`;
    expect(freshVersionTestGaps("test/a.test.ts", inHook)).toContainEqual(
      expect.stringContaining("outside a test body"),
    );
    const never = `${helper}\nit("x", () => expect(1).toBe(pkg.version));`;
    expect(freshVersionTestGaps("test/a.test.ts", never)).toContainEqual(
      expect.stringContaining("outside a test body"),
    );
    const cycle = helper
      .replace("  return VERSION;", "  return VERSION + (await again());")
      .concat("\nasync function again() { return freshVersion(); }");
    expect(freshVersionTestGaps("test/a.test.ts", cycle)).toContainEqual(
      expect.stringContaining("outside a test body"),
    );
  });

  it("ignores an import whose specifier is not a literal", () => {
    const computed = GOOD_TEST.replace('import("../src/index.js")', "import(`../src/${name}.js`)");
    expect(freshVersionTestGaps("test/a.test.ts", computed)).toEqual([
      expect.stringContaining("no dynamic import"),
    ]);
  });

  it("names a test that never reads VERSION, or never reads package.json", () => {
    const noVersion = GOOD_TEST.replaceAll("VERSION", "NAME");
    expect(freshVersionTestGaps("test/a.test.ts", noVersion)).toEqual([
      expect.stringContaining("VERSION"),
    ]);
    const noManifest = GOOD_TEST.replaceAll("package.json", "manifest.json");
    expect(freshVersionTestGaps("test/a.test.ts", noManifest)).toEqual([
      expect.stringContaining("package.json"),
    ]);
  });
});

describe("loadTypeScript", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "release-pr-ts-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A folder with these files. */
  function tree(label: string, files: Record<string, string>): string {
    const dir = join(root, label);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("takes the package's own typescript first", () => {
    const dir = tree("own", {
      "package.json": "{}",
      "node_modules/typescript/package.json": '{"name":"typescript","main":"index.js"}',
      "node_modules/typescript/index.js": 'module.exports = { from: "own" };',
    });
    expect(loadTypeScript(dir, [])).toEqual({ from: "own" });
  });

  it("then the one @cosyte/process carries, which a scaffold has without listing typescript", () => {
    const dir = tree("process", {
      "package.json": "{}",
      "node_modules/@cosyte/process/package.json":
        '{"name":"@cosyte/process","exports":{"./package.json":"./package.json"}}',
      "node_modules/@cosyte/process/node_modules/typescript/package.json":
        '{"name":"typescript","main":"index.js"}',
      "node_modules/@cosyte/process/node_modules/typescript/index.js":
        'module.exports = { from: "process" };',
    });
    expect(loadTypeScript(dir, [])).toEqual({ from: "process" });
  });

  it("then this package's own surroundings, and throws naming the fix when none has it", () => {
    const dir = tree("none", { "package.json": "{}" });
    expect(loadTypeScript(dir).version).toMatch(/^\d+\./);
    expect(() => loadTypeScript(dir, [])).toThrow(/typescript/);
  });
});

describe("version-test", () => {
  it("passes when one test file qualifies, whatever the others do", () => {
    const stale = `import { VERSION } from "../src/index.js";\nVERSION;\n`;
    expect(
      checkVersionTests([
        { path: "test/sanity.test.ts", text: stale },
        { path: "test/version.test.ts", text: GOOD_TEST },
      ]),
    ).toEqual([]);
  });

  it("refuses a repository where none does, naming each test that reads VERSION and its gap", () => {
    const stale = `import { VERSION } from "../src/index.js";\nVERSION;\n`;
    const found = checkVersionTests([
      { path: "test/sanity.test.ts", text: stale },
      { path: "test/other.test.ts", text: "it('x', () => {});\n" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("version-test");
    expect(found[0]?.file).toBe("test/");
    expect(found[0]?.message).toContain("test/sanity.test.ts");
    expect(found[0]?.message).toContain("imports the source statically");
    expect(found[0]?.message).not.toContain("test/other.test.ts");
  });

  it("refuses a repository with no tests at all", () => {
    const found = checkVersionTests([]);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("No test file reads VERSION");
  });
});

describe("declaresVersion", () => {
  it("finds an exported VERSION declared at the start of a line, typed or not", () => {
    expect(declaresVersion('export const VERSION: string = "1.0.0";\n')).toBe(true);
    expect(declaresVersion('/** x */\nexport const VERSION = "1.0.0";\n')).toBe(true);
    expect(declaresVersion('export { VERSION } from "./version.js";\n')).toBe(false);
    expect(declaresVersion('// export const VERSION = "1";\n')).toBe(false);
    expect(declaresVersion('export const VERSIONS = ["1"];\n')).toBe(false);
  });
});

describe("openingSentence", () => {
  it("is the first sentence, flattened to one line, without its full stop", () => {
    expect(openingSentence("Add a thing.\n\nMore detail.")).toBe("Add a thing");
    expect(openingSentence("Add\n  a   thing! Then more.")).toBe("Add a thing!");
    expect(openingSentence("No stop at all")).toBe("No stop at all");
    expect(openingSentence("Version 1.2.3 parses. Next.")).toBe("Version 1.2.3 parses");
  });

  it("drops every trailing full stop, and reads a long run of them quickly", () => {
    expect(openingSentence("Done...")).toBe("Done");
    expect(openingSentence("...")).toBe("");
    const run = `a${".".repeat(50_000)}b`;
    const started = performance.now();
    expect(openingSentence(run)).toBe(run);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reads a bold lead-in as the headline, and a sentence ending inside emphasis", () => {
    expect(openingSentence("**Lead in** and the rest. More.")).toBe("Lead in");
    expect(openingSentence("**Lead in:** the rest.")).toBe("Lead in:");
    expect(openingSentence("It is **done.** Then more.")).toBe("It is **done.**");
  });
});

describe("bulletLengthBound", () => {
  it("is the sentence's length, plus one for each dash and each slice the release rewrites", () => {
    expect(bulletLengthBound("abc")).toBe(3);
    expect(bulletLengthBound(`a ${EM_DASH} b`)).toBe(6);
    expect(bulletLengthBound("this slice and those Slices")).toBe(29);
    expect(bulletLengthBound("slicer and sliced")).toBe(17);
    // "slice" inside a longer word: the release's rewrite can reach it too.
    expect(bulletLengthBound("the subslices slice")).toBe(21);
  });

  it("adds one for each parenthetical and each comma inside one, which the release rebuilds", () => {
    // The release rebuilds a parenthetical that holds an internal reference as ` (a, b)`: a space
    // before it when there was none, and ", " between segments an author joined with a bare comma.
    expect(bulletLengthBound("f(a,b)")).toBe(8);
    expect(bulletLengthBound("a (b) c (d, e)")).toBe(17);
    expect(bulletLengthBound("a, b (c")).toBe(7);
    // Only an innermost parenthetical, the one the release rebuilds.
    expect(bulletLengthBound("x ((a,b),c)")).toBe(13);
  });
});

describe("changesets", () => {
  it("passes an opening sentence at the cap, and refuses one a character over", () => {
    expect(checkChangeset(".changeset/a.md", changeset(sentenceOf(400)))).toEqual([]);
    const over = checkChangeset(".changeset/a.md", changeset(sentenceOf(401)));
    expect(over).toHaveLength(1);
    expect(over[0]?.rule).toBe("changeset-bullet");
    expect(over[0]?.file).toBe(".changeset/a.md");
    expect(over[0]?.message).toContain("401 characters");
    expect(over[0]?.message).toContain("1 over");
  });

  it("measures only the opening sentence, so detail after it is free", () => {
    const text = changeset(`Short opening. ${sentenceOf(900)}`);
    expect(checkChangeset(".changeset/a.md", text)).toEqual([]);
  });

  it("counts what the release adds, so a sentence the release would push over the cap is refused", () => {
    const sentence = `${"a".repeat(389)} this slice.`;
    expect(openingSentence(sentence)).toHaveLength(400);
    expect(bulletLengthBound(openingSentence(sentence))).toBe(401);
    const text = changeset(sentence);
    expect(checkChangeset(".changeset/a.md", text)).toHaveLength(1);
  });

  it("refuses the sentence the release measures over the cap after rebuilding its parenthetical", () => {
    // The reviewer's case: 399 characters as written, and the release tooling's headline for it is
    // 413 (`toHeadline` in the shared release-notes script), over the cap.
    const segments = Array.from({ length: 30 }, (_, i) => `seg${String(i).padStart(5, "x")}`);
    let sentence = `Fix the reader (CI-1 note text,${segments.join(",")})`;
    sentence = `${sentence} ${"w".repeat(398 - sentence.length)}.`;
    expect(openingSentence(sentence)).toHaveLength(399);
    expect(bulletLengthBound(openingSentence(sentence))).toBeGreaterThanOrEqual(413);
    expect(checkChangeset(".changeset/a.md", changeset(sentence)).map((f) => f.rule)).toEqual([
      "changeset-bullet",
    ]);
  });

  it("reads CRLF line ends", () => {
    const text = changeset(sentenceOf(401)).replaceAll("\n", "\r\n");
    expect(checkChangeset(".changeset/a.md", text)).toHaveLength(1);
  });

  it("refuses a file with no front matter, and a release with no summary", () => {
    const shapeless = checkChangeset(".changeset/a.md", "Just text.\n");
    expect(shapeless.map((f) => f.rule)).toEqual(["changeset-shape"]);
    expect(shapeless[0]?.message).toContain("front matter");
    const empty = checkChangeset(".changeset/a.md", changeset(""));
    expect(empty.map((f) => f.rule)).toEqual(["changeset-shape"]);
    expect(empty[0]?.message).toContain("summary");
  });

  it("refuses an empty front matter block, the file `changeset add --empty` writes", () => {
    // The release tooling reads every changeset the version commit consumed with
    // /^---\n([\s\S]*?)\n---\n?/ and throws on one that does not match, after the merge.
    for (const text of ["---\n---\n", "---\n---\n\n", "---\n---\n\nA note.\n", "---\r\n---\r\n"]) {
      const found = checkChangeset(".changeset/a.md", text);
      expect(
        found.map((f) => f.rule),
        JSON.stringify(text),
      ).toEqual(["changeset-shape"]);
      expect(found[0]?.message).toContain("empty");
      expect(found[0]?.message).toContain("no changeset at all");
    }
  });

  it("passes a front matter block that names no package but is not empty, as the release reads it", () => {
    expect(checkChangeset(".changeset/a.md", "---\n# a note\n\n---\n")).toEqual([]);
    expect(checkChangeset(".changeset/a.md", "---\n\n---\n")).toEqual([]);
  });

  it("refuses a front matter line or a bump the release cannot read", () => {
    const line = checkChangeset(".changeset/a.md", changeset("A change.", "just words"));
    expect(line.map((f) => f.rule)).toEqual(["changeset-shape"]);
    expect(line[0]?.message).toContain("front matter line");
    const bump = checkChangeset(".changeset/a.md", changeset("A change.", '"@cosyte/demo": tiny'));
    expect(bump.map((f) => f.rule)).toEqual(["changeset-shape"]);
    expect(bump[0]?.message).toContain("bump");
    const quoted = checkChangeset(
      ".changeset/a.md",
      changeset("A change.", "'@cosyte/demo': 'MINOR'"),
    );
    expect(quoted).toEqual([]);
  });
});

describe("checkReleasePr", () => {
  it("applies the version rules only to a package that exports VERSION", () => {
    const changesets = [{ path: ".changeset/a.md", text: changeset(sentenceOf(401)) }];
    const without = checkReleasePr({ scripts: {}, declaresVersion: false, tests: [], changesets });
    expect(without.map((f) => f.rule)).toEqual(["changeset-bullet"]);
    const withVersion = checkReleasePr({
      scripts: {},
      declaresVersion: true,
      tests: [],
      changesets,
    });
    expect(withVersion.map((f) => f.rule)).toEqual([
      "version-script",
      "version-test",
      "changeset-bullet",
    ]);
  });
});

describe("the command line", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "release-pr-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A repository with these files. */
  function repo(label: string, files: Record<string, string>): string {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  const GOOD: Record<string, string> = {
    "package.json": JSON.stringify({ name: "@cosyte/demo", scripts: { version: GOOD_SCRIPT } }),
    "src/index.ts": 'export const VERSION: string = "0.0.0";\n',
    "src/index.test.ts": "it('x', () => {});\n",
    "test/version.test.ts": GOOD_TEST,
    "test/unit/deep.spec.ts": "export {};\n",
    "test/fixture.txt": "VERSION\n",
    ".changeset/README.md": "Not a changeset, and has no front matter.\n",
    ".changeset/config.json": "{}\n",
    ".changeset/good.md": changeset("A short opening."),
  };

  it("exits 0 on a repository that keeps every rule, and says what it read", () => {
    const out = sink();
    const err = sink();
    const code = runReleasePrCheck({
      argv: ["--dir", repo("good", GOOD)],
      stdout: out.stream,
      stderr: err.stream,
    });
    expect(code, err.text()).toBe(0);
    expect(out.text()).toContain("release-pr: OK");
    expect(out.text()).toContain("1 changeset");
    expect(err.text()).toBe("");
  });

  it("reads tests beside the source and under test/, but not fixtures, and skips node_modules", () => {
    const dir = repo("read", {
      ...GOOD,
      "test/node_modules/x/version.test.ts": GOOD_TEST,
      "src/version.ts": 'export const VERSION = "1";\n',
      "src/types.d.ts": "export const VERSION: string;\n",
    });
    const input = readReleasePrInput(dir);
    expect(input.tests.map((t) => t.path).sort()).toEqual([
      "src/index.test.ts",
      "test/unit/deep.spec.ts",
      "test/version.test.ts",
    ]);
    expect(input.changesets.map((c) => c.path)).toEqual([".changeset/good.md"]);
    expect(input.declaresVersion).toBe(true);
  });

  it("reads a package with no src, test or .changeset folder as one with nothing to check", () => {
    const dir = repo("bare", { "package.json": JSON.stringify({ name: "x" }) });
    const input = readReleasePrInput(dir);
    expect(input).toEqual({ scripts: {}, declaresVersion: false, tests: [], changesets: [] });
    const out = sink();
    expect(
      runReleasePrCheck({ argv: ["--dir", dir], stdout: out.stream, stderr: sink().stream }),
    ).toBe(0);
    expect(out.text()).toContain("exports no VERSION");
  });

  it("does not follow a symbolic link out of the tree", () => {
    const outside = repo("outside", { "version.test.ts": GOOD_TEST });
    const dir = repo("linked", {
      "package.json": JSON.stringify({ name: "x", scripts: { version: GOOD_SCRIPT } }),
      "src/index.ts": 'export const VERSION = "1";\n',
    });
    symlinkSync(outside, join(dir, "test"), "dir");
    expect(readReleasePrInput(dir).tests).toEqual([]);
  });

  it("exits 1 on each finding, naming the file and the rule on stderr", () => {
    const dir = repo("bad", {
      ...GOOD,
      "package.json": JSON.stringify({ name: "@cosyte/demo", scripts: {} }),
      "test/version.test.ts": `import { VERSION } from "../src/index.js";\nVERSION;\n`,
      ".changeset/long.md": changeset(sentenceOf(450)),
    });
    const out = sink();
    const err = sink();
    const code = runReleasePrCheck({
      argv: ["--dir", dir],
      stdout: out.stream,
      stderr: err.stream,
    });
    expect(code).toBe(1);
    expect(err.text()).toContain("package.json [version-script]");
    expect(err.text()).toContain("test/ [version-test]");
    expect(err.text()).toContain(".changeset/long.md [changeset-bullet]");
    expect(err.text()).toContain("3 finding(s)");
    expect(out.text()).toBe("");
  });

  it("exits 2 when it cannot read the package, or is given an argument it does not know", () => {
    const err = sink();
    expect(
      runReleasePrCheck({
        argv: ["--dir", join(root, "nowhere")],
        stdout: sink().stream,
        stderr: err.stream,
      }),
    ).toBe(2);
    expect(err.text()).toContain("Nothing was checked");
    const broken = repo("broken", { "package.json": "{ not json" });
    expect(
      runReleasePrCheck({ argv: ["--dir", broken], stdout: sink().stream, stderr: sink().stream }),
    ).toBe(2);
    const arg = sink();
    expect(runReleasePrCheck({ argv: ["--fix"], stdout: sink().stream, stderr: arg.stream })).toBe(
      2,
    );
    expect(arg.text()).toContain('"--fix"');
    expect(
      runReleasePrCheck({ argv: ["--dir"], stdout: sink().stream, stderr: sink().stream }),
    ).toBe(2);
  });

  it("reads the working directory when no --dir is given, and accepts --", () => {
    const dir = repo("cwd", GOOD);
    const out = sink();
    expect(
      runReleasePrCheck({ argv: ["--"], dir, stdout: out.stream, stderr: sink().stream }),
    ).toBe(0);
    expect(out.text()).toContain("release-pr: OK");
  });
});
