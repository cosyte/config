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
  declaresVersion,
  openingSentence,
  readReleasePrInput,
  RELEASE_BULLET_LIMIT,
  RELEASE_PR_RULES,
  runReleasePrCheck,
  scriptSteps,
} from "../release-pr.js";

const EM_DASH = String.fromCodePoint(0x2014);

/** The version script the template carries. */
const GOOD_SCRIPT =
  "changeset version && cosyte-process sync-version && cosyte-docs-reference && cosyte-process format";

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
  it("names three rules, each with what it requires", () => {
    expect(Object.keys(RELEASE_PR_RULES).sort()).toEqual([
      "changeset-bullet",
      "changeset-shape",
      "version-script",
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
  it("applies the version rule only to a package that exports VERSION", () => {
    const changesets = [{ path: ".changeset/a.md", text: changeset(sentenceOf(401)) }];
    const without = checkReleasePr({ scripts: {}, declaresVersion: false, changesets });
    expect(without.map((f) => f.rule)).toEqual(["changeset-bullet"]);
    const withVersion = checkReleasePr({ scripts: {}, declaresVersion: true, changesets });
    expect(withVersion.map((f) => f.rule)).toEqual(["version-script", "changeset-bullet"]);
  });

  it("reads no test file: the release pull request's mutation job proves the VERSION test", () => {
    const found = checkReleasePr({
      scripts: { version: GOOD_SCRIPT },
      declaresVersion: true,
      changesets: [],
    });
    expect(found).toEqual([]);
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

  it("finds VERSION in any source file, but not in a test, a declaration file or node_modules", () => {
    const input = readReleasePrInput(
      repo("read", {
        ...GOOD,
        "src/index.ts": "export {};\n",
        "src/deep/version.ts": 'export const VERSION = "1";\n',
      }),
    );
    expect(input.changesets.map((c) => c.path)).toEqual([".changeset/good.md"]);
    expect(input.declaresVersion).toBe(true);
    const none = repo("read-none", {
      ...GOOD,
      "src/index.ts": "export {};\n",
      "src/index.test.ts": 'export const VERSION = "1";\n',
      "src/a.spec.mts": 'export const VERSION = "1";\n',
      "src/types.d.ts": "export const VERSION: string;\n",
      "src/node_modules/x/index.ts": 'export const VERSION = "1";\n',
    });
    expect(readReleasePrInput(none).declaresVersion).toBe(false);
  });

  it("reads a package with no src, test or .changeset folder as one with nothing to check", () => {
    const dir = repo("bare", { "package.json": JSON.stringify({ name: "x" }) });
    const input = readReleasePrInput(dir);
    expect(input).toEqual({ scripts: {}, declaresVersion: false, changesets: [] });
    const out = sink();
    expect(
      runReleasePrCheck({ argv: ["--dir", dir], stdout: out.stream, stderr: sink().stream }),
    ).toBe(0);
    expect(out.text()).toContain("exports no VERSION");
  });

  it("does not follow a symbolic link out of the tree", () => {
    const outside = repo("outside", { "index.ts": 'export const VERSION = "1";\n' });
    const dir = repo("linked", { "package.json": JSON.stringify({ name: "x", scripts: {} }) });
    symlinkSync(outside, join(dir, "src"), "dir");
    expect(readReleasePrInput(dir).declaresVersion).toBe(false);
  });

  it("exits 1 on each finding, naming the file and the rule on stderr", () => {
    const dir = repo("bad", {
      ...GOOD,
      "package.json": JSON.stringify({ name: "@cosyte/demo", scripts: {} }),
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
    expect(err.text()).toContain(".changeset/long.md [changeset-bullet]");
    expect(err.text()).toContain("2 finding(s)");
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
