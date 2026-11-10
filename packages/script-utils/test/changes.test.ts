/**
 * What a change touched, by line, read from git: the input both the ratchet's rule for a pull
 * request and the changed-files mutation run depend on. A wrong answer here is silent: a line left
 * out is a line nobody judges. So every case runs against a real git repository in a temp
 * directory, and the parser is pinned on the shapes git prints. Every file here is synthetic.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ChangesUnreadable,
  parseUnifiedDiff,
  readChanges,
  runGit,
  unquoteGitPath,
} from "../changes.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "script-utils-changes-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** A repository with `main` holding `base`, and HEAD on `feature` holding `head` committed. */
function repo(label: string, base: Record<string, string>, head: Record<string, string>): string {
  const dir = join(root, label);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main", ".");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  write(dir, base);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  write(dir, head);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "head");
  return dir;
}

function asObject(files: Map<string, Set<number>>): Record<string, number[]> {
  return Object.fromEntries(
    [...files].map(([file, lines]) => [file, [...lines].sort((a, b) => a - b)]),
  );
}

describe("parseUnifiedDiff", () => {
  it("reads each file's added and changed lines from its hunks", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +2,3 @@ export function a() {",
      "+one",
      "+two",
      "+three",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "@@ -20,2 +23,0 @@",
      "-gone",
      "-gone",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -0,0 +1,2 @@",
      "+x",
      "+y",
    ].join("\n");
    expect(asObject(parseUnifiedDiff(diff))).toEqual({ "src/a.ts": [2, 3, 4, 12], "b.ts": [1, 2] });
  });

  it("leaves out a deleted file and ignores a hunk with no file before it", () => {
    const diff = [
      "@@ -1 +1 @@",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "--- a/kept.ts",
      "+++ b/kept.ts\t",
      "@@ -1 +5,1 @@",
    ].join("\n");
    expect(asObject(parseUnifiedDiff(diff))).toEqual({ "kept.ts": [5] });
  });

  it("unquotes a path git quoted, and keeps a path whose own name starts with b/", () => {
    const diff = [
      '+++ "b/sp\\303\\251cial \\"q\\".ts"',
      "@@ -1 +1 @@",
      "+++ b/b/inner.ts",
      "@@ -1 +3 @@",
    ];
    expect(asObject(parseUnifiedDiff(diff.join("\n")))).toEqual({
      'spécial "q".ts': [1],
      "b/inner.ts": [3],
    });
  });

  it("drops the tab git ends a spaced name with, and reads an old count of any width", () => {
    const diff = [
      "+++ b/a b.ts\t",
      "@@ -1,12 +3,2 @@",
      "+++ b/c.ts",
      "@@ -100,0 +101 @@",
      "+++ b/d.ts",
      "@@ -1 +5,12 @@",
    ].join("\n");
    expect(asObject(parseUnifiedDiff(diff))).toEqual({
      "a b.ts": [3, 4],
      "c.ts": [101],
      "d.ts": [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    });
  });

  it("reads a hunk header only at the start of a line, not inside a changed line", () => {
    const diff = [
      "+++ b/t.ts",
      "@@ -1 +1 @@",
      '+const fixture = "@@ -1 +7 @@";',
      "+@@ -1 +9 @@",
    ].join("\n");
    expect(asObject(parseUnifiedDiff(diff))).toEqual({ "t.ts": [1] });
  });

  it("adds a second hunk of the same file to the lines already read", () => {
    const diff = ["+++ b/a.ts", "@@ -1 +1 @@", "+++ b/a.ts", "@@ -1 +9 @@"].join("\n");
    expect(asObject(parseUnifiedDiff(diff))).toEqual({ "a.ts": [1, 9] });
  });
});

describe("unquoteGitPath", () => {
  it("returns a path git did not quote as it is", () => {
    for (const path of ["plain.ts", '"', '"open.ts', 'close.ts"', "a\\b.ts"]) {
      expect(unquoteGitPath(path), path).toBe(path);
    }
  });

  it("undoes octal bytes and the escapes git writes", () => {
    expect(unquoteGitPath('"a\\tb\\nc\\rd\\\\e\\"f"')).toBe('a\tb\nc\rd\\e"f');
    expect(unquoteGitPath('"\\303\\251t\\303\\251.ts"')).toBe("été.ts");
    expect(unquoteGitPath('""')).toBe("");
  });

  it("reads a backslash before something that is not three octal digits as the character", () => {
    expect(unquoteGitPath('"\\x123"')).toBe("x123");
    expect(unquoteGitPath('"\\1234"')).toBe("S4");
    expect(unquoteGitPath('"\\12x"')).toBe("12x");
    expect(unquoteGitPath('"\\8"')).toBe("8");
    expect(unquoteGitPath('"\\0777"')).toBe("\u003f7");
  });
});

describe("readChanges", () => {
  it("returns the changed lines of a committed change, with the root and the merge base; a file moved unedited changed none", () => {
    const dir = repo(
      "committed",
      {
        "src/a.ts": "one\ntwo\nthree\n",
        "src/gone.ts": "x\n",
        "src/moved.ts": "m\n",
      },
      { "src/a.ts": "one\nTWO\nthree\nfour\n", "src/new.ts": "n1\nn2\n" },
    );
    git(dir, "rm", "-q", "src/gone.ts");
    git(dir, "mv", "src/moved.ts", "src/renamed.ts");
    git(dir, "commit", "-q", "-m", "more");
    const changes = readChanges({ base: "main", cwd: dir });
    expect(changes.root).toBe(git(dir, "rev-parse", "--show-toplevel").trim());
    expect(changes.base).toBe("main");
    expect(changes.mergeBase).toBe(git(dir, "rev-parse", "main").trim());
    expect(asObject(changes.files)).toEqual({
      "src/a.ts": [2, 4],
      "src/new.ts": [1, 2],
    });
  });

  it("counts edits not yet committed and untracked files, and leaves out ignored ones", () => {
    const dir = repo("worktree", { ".gitignore": "ignored.ts\n", "a.ts": "1\n2\n" }, {});
    write(dir, {
      "a.ts": "1\n2\n3\n",
      "untracked.ts": "u1\nu2\nu3",
      "empty.ts": "",
      "ignored.ts": "i\n",
      "sub/deep.ts": "d\n",
    });
    symlinkSync(join(dir, "nowhere"), join(dir, "dangling.ts"));
    expect(asObject(readChanges({ base: "main", cwd: dir }).files)).toEqual({
      "a.ts": [3],
      "untracked.ts": [1, 2, 3],
      "empty.ts": [],
      "sub/deep.ts": [1],
    });
  });

  it("answers for the whole repository when run from a subdirectory", () => {
    const dir = repo("subdir", { "pkg/a.ts": "a\n", "other/b.ts": "b\n" }, { "other/b.ts": "B\n" });
    write(dir, { "other/c.ts": "c\n" });
    expect(asObject(readChanges({ base: "main", cwd: join(dir, "pkg") }).files)).toEqual({
      "other/b.ts": [1],
      "other/c.ts": [1],
    });
  });

  it("does not follow a user's diff settings: renames, prefixes", () => {
    const dir = repo("rename", { "a.ts": "1\n2\n3\n4\n5\n6\n7\n8\n" }, {});
    git(dir, "config", "diff.renames", "false");
    git(dir, "config", "diff.noprefix", "true");
    git(dir, "config", "diff.mnemonicPrefix", "true");
    git(dir, "mv", "a.ts", "b.ts");
    write(dir, { "b.ts": "1\n2\n3\n4\n5\n6\n7\nEIGHT\n" });
    expect(asObject(readChanges({ base: "main", cwd: dir }).files)).toEqual({ "b.ts": [8] });
  });

  it("refuses with no base, an unknown base, or outside a repository", () => {
    const dir = repo("refusals", { "a.ts": "a\n" }, {});
    expect(() => readChanges({ base: "", cwd: dir })).toThrow(
      new ChangesUnreadable("no base ref was given to compare against"),
    );
    expect(new ChangesUnreadable("x").name).toBe("ChangesUnreadable");
    expect(() => readChanges({ base: undefined as unknown as string, cwd: dir })).toThrow(
      new ChangesUnreadable("no base ref was given to compare against"),
    );
    expect(() => readChanges({ base: "no-such-ref", cwd: dir })).toThrow(
      /^no merge base with no-such-ref: git merge-base no-such-ref HEAD failed: \S/,
    );
    const outside = mkdtempSync(join(tmpdir(), "script-utils-not-a-repo-"));
    try {
      expect(() => readChanges({ base: "main", cwd: outside })).toThrow(
        /^not inside a git repository: git rev-parse --show-toplevel failed: fatal/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses when the diff or the untracked listing fails, naming which", () => {
    const answers = (failing: string) => (args: string[]) => {
      if (args.includes(failing)) return { status: 1, stdout: "", stderr: ` boom \n` };
      if (args[0] === "rev-parse") return { status: 0, stdout: "/repo\n", stderr: "" };
      if (args[0] === "merge-base") return { status: 0, stdout: "abc\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(() => readChanges({ base: "main", git: answers("diff") })).toThrow(
      /^could not diff against the merge base: git -c core\.quotepath=off diff .* failed: boom$/,
    );
    expect(() => readChanges({ base: "main", git: answers("ls-files") })).toThrow(
      /^could not list untracked files: git .*ls-files.* failed: boom$/,
    );
    const calls: { args: string[]; cwd: string }[] = [];
    const recording = (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      return answers("none")(args);
    };
    readChanges({ base: "main", cwd: "/repo/pkg", git: recording });
    expect(calls.map((c) => c.cwd)).toEqual(["/repo/pkg", "/repo", "/repo", "/repo"]);
    expect(calls[2]?.args).toEqual([
      "-c",
      "core.quotepath=off",
      "diff",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--diff-filter=d",
      "abc",
      "--",
    ]);
    expect(calls[3]?.args).toEqual([
      "-c",
      "core.quotepath=off",
      "ls-files",
      "--others",
      "--exclude-standard",
      "--full-name",
    ]);
  });

  it("reads a quoted untracked path", () => {
    const dir = repo("quoted", { "a.ts": "a\n" }, {});
    write(dir, { 'q"uote.ts': "q\n" });
    expect(asObject(readChanges({ base: "main", cwd: dir }).files)).toEqual({ 'q"uote.ts': [1] });
  });
});

describe("runGit", () => {
  it("returns git's status and output", () => {
    const r = runGit(["--version"], root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^git version /);
  });

  it("reports a git that could not start as a null status with the reason", () => {
    const r = runGit(["status"], join(root, "no-such-directory"));
    expect(r.status).toBeNull();
    expect(r.stderr).toMatch(/ENOENT/);
    expect(r.stdout).toBe("");
  });
});
