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

  it("passes an empty changeset, which releases nothing and becomes no bullet", () => {
    expect(checkChangeset(".changeset/a.md", "---\n---\n")).toEqual([]);
    expect(checkChangeset(".changeset/a.md", "---\n# a note\n\n---\n")).toEqual([]);
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
