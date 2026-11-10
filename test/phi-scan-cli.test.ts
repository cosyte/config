/**
 * The PHI engine's command-line form (ST34), and the staged gitlink a user's git config could hide.
 *
 * SECURITY / PHI: every payload here is SYNTHETIC. `SSN` is a reserved, never-issued dashed shape
 * the cross-cutting floor detects, and `clinic.invalid` is an RFC 2606 reserved domain. Nothing is
 * written anywhere but a throwaway temp directory this suite removes afterwards.
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readPhiExclusions } from "@cosyte/script-utils/phi-scan";

const ENGINE = join(import.meta.dirname, "..", "packages", "script-utils", "phi-scan.js");

/** A synthetic dashed identifier the floor detects. Never issued by anyone. */
const SSN = "123-45-6789";

const repos: string[] = [];
afterEach(() => {
  while (repos.length > 0) rmSync(repos.pop() ?? "", { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** A repository with an allow-list and these files, every one tracked. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "phi-scan-cli-"));
  repos.push(dir);
  git(dir, ["init", "-q", "."]);
  git(dir, ["config", "user.email", "probe@example.com"]);
  git(dir, ["config", "user.name", "probe"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  const all = { "scripts/phi-allow-list.txt": "EMAILDOMAIN example.com\n", ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "fixture", "--no-verify"]);
  return dir;
}

function cli(cwd: string, args: string[] = []): { code: number; out: string } {
  const r = spawnSync(process.execPath, [ENGINE, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("the PHI engine from the command line", () => {
  it("exits 0 over a clean repository, with no caller script", () => {
    const r = cli(repo({ "src/index.ts": "export const x = 1;\n" }));
    expect(r.code, r.out).toBe(0);
  });

  it("exits 1 on the floor's shape anywhere in the repository, naming the place and not the value", () => {
    const r = cli(repo({ "test/fixtures/record.txt": `id ${SSN}\n` }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("test/fixtures/record.txt");
    expect(r.out).not.toContain(SSN);
  });

  it("leaves out a literal tracked path named in scripts/phi-scan.exclude", () => {
    const dir = repo({
      "vendor/upstream.txt": `id ${SSN}\n`,
      "scripts/phi-scan.exclude": "# upstream text we do not own\nvendor/upstream.txt\n",
    });
    expect(cli(dir).code).toBe(0);
  });

  it("still reads every path the exclusions file does not name", () => {
    // Without this, the case above is satisfied by a CLI that excludes everything.
    const dir = repo({
      "vendor/upstream.txt": `id ${SSN}\n`,
      "vendor/other.txt": `id ${SSN}\n`,
      "scripts/phi-scan.exclude": "vendor/upstream.txt\n",
    });
    const r = cli(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("vendor/other.txt");
  });

  it.each([
    ["a directory", "vendor/\n", "is a directory or a pattern"],
    ["a pattern", "vendor/*.txt\n", "is a directory or a pattern"],
    ["a path git does not track", "vendor/gone.txt\n", "is not a tracked path"],
  ])(
    "refuses an exclusions file naming %s, at exit 2, before scanning",
    (_label, file, message) => {
      const dir = repo({
        "vendor/upstream.txt": `id ${SSN}\n`,
        "scripts/phi-scan.exclude": file,
      });
      const r = cli(dir);
      expect(r.code).toBe(2);
      expect(r.out).toContain(message);
    },
  );

  it("reads the staged route, everything but Markdown", () => {
    const dir = repo({ "src/index.ts": "export const x = 1;\n" });
    writeFileSync(join(dir, "src", "leak.ts"), `export const id = "${SSN}";\n`);
    writeFileSync(join(dir, "NOTES.md"), `id ${SSN}\n`);
    git(dir, ["add", "src/leak.ts", "NOTES.md"]);
    const r = cli(dir, ["--staged"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/leak.ts");
    expect(r.out).not.toContain("NOTES.md");
  });

  it("refuses a staged gitlink even when the user's git config hides submodules from diff", () => {
    // x12, terminology and astm pass `--ignore-submodules=none` to the staged diff; the engine
    // did not, so `diff.ignoreSubmodules = all` hid a staged gitlink and the hook exited 0.
    const dir = repo({ "src/index.ts": "export const x = 1;\n" });
    git(dir, ["config", "diff.ignoreSubmodules", "all"]);
    git(dir, ["update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},src/vendored`]);
    const r = cli(dir, ["--staged"]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("src/vendored");
  });

  it("refuses an argument the engine does not accept, at exit 2", () => {
    expect(cli(repo({ "a.txt": "x\n" }), ["--fix"]).code).toBe(2);
  });
});

describe("--allow-list <path>, the allow list to use instead of scripts/phi-allow-list.txt", () => {
  /** A repository with these files and NO allow list of its own. */
  function bare(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "phi-scan-cli-bare-"));
    repos.push(dir);
    git(dir, ["init", "-q", "."]);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    git(dir, ["add", "."]);
    return dir;
  }

  /** An empty allow list outside every repository, as a tool pushing from a bare repository passes. */
  function emptyList(): string {
    const dir = mkdtempSync(join(tmpdir(), "phi-scan-cli-list-"));
    repos.push(dir);
    const file = join(dir, "empty-allow-list.txt");
    writeFileSync(file, "");
    return file;
  }

  /** An email shape at a reserved domain: declared by every fixture list here, by no empty one. */
  const EMAIL = ["someone", "example.com"].join("@");

  it("leaves the default alone: a repository with no allow list still refuses at exit 2", () => {
    const r = cli(bare({ "src/index.ts": "export const x = 1;\n" }));
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("scripts/phi-allow-list.txt");
  });

  it("scans a repository with no allow list of its own, and reports it clean", () => {
    const r = cli(bare({ "src/index.ts": "export const x = 1;\n" }), ["--allow-list", emptyList()]);
    expect(r.code, r.out).toBe(0);
  });

  it("still catches a dashed SSN shape with an empty list, naming the place and not the value", () => {
    const r = cli(bare({ "test/record.txt": `id ${SSN}\n` }), ["--allow-list", emptyList()]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("test/record.txt");
    expect(r.out).toContain("dashed SSN pattern");
    expect(r.out).not.toContain(SSN);
  });

  it("still catches an email at an undeclared domain with an empty list", () => {
    const r = cli(bare({ "notes.txt": `write to ${EMAIL}\n` }), ["--allow-list", emptyList()]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("notes.txt");
    expect(r.out).toContain("email with non-test domain");
    expect(r.out).not.toContain(EMAIL);
  });

  it("replaces the repository's own list rather than adding to it", () => {
    // Without this, an option that merged with (or ignored) the named file would pass the cases
    // above in a repository that declares the shape itself.
    const dir = repo({
      "scripts/phi-allow-list.txt": `EMAILDOMAIN example.com\nID ${SSN}\n`,
      "a.txt": `id ${SSN} ${EMAIL}\n`,
    });
    expect(cli(dir).code).toBe(0);
    const r = cli(dir, ["--allow-list", emptyList()]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("dashed SSN pattern");
    expect(r.out).toContain("email with non-test domain");
  });

  it("reads the declarations of the list it names", () => {
    const list = emptyList();
    writeFileSync(list, "EMAILDOMAIN example.com\n");
    expect(cli(bare({ "a.txt": `${EMAIL}\n` }), ["--allow-list", list]).code).toBe(0);
  });

  it("takes a path relative to the working directory", () => {
    const dir = bare({ "a.txt": `id ${SSN}\n` });
    writeFileSync(join(dir, "empty.txt"), "");
    git(dir, ["add", "empty.txt"]);
    const r = cli(dir, ["--allow-list", "empty.txt"]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("a.txt");
  });

  it("works with --staged, on either side of it", () => {
    const dir = bare({ "src/index.ts": "export const x = 1;\n" });
    const list = emptyList();
    expect(cli(dir, ["--staged", "--allow-list", list]).code).toBe(0);
    writeFileSync(join(dir, "src", "leak.ts"), `export const id = "${SSN}";\n`);
    git(dir, ["add", "src/leak.ts"]);
    for (const args of [
      ["--staged", "--allow-list", list],
      ["--allow-list", list, "--staged"],
    ]) {
      const r = cli(dir, args);
      expect(r.code, `${args.join(" ")}: ${r.out}`).toBe(1);
      expect(r.out).toContain("src/leak.ts");
    }
  });

  it("works with paths, before or after them, and scans only those paths", () => {
    const dir = bare({ "a.txt": `id ${SSN}\n`, "b.txt": "clean\n" });
    const list = emptyList();
    expect(cli(dir, ["--allow-list", list, "b.txt"]).code).toBe(0);
    for (const args of [
      ["--allow-list", list, "a.txt"],
      ["a.txt", "--allow-list", list],
    ]) {
      const r = cli(dir, args);
      expect(r.code, `${args.join(" ")}: ${r.out}`).toBe(1);
      expect(r.out).toContain("a.txt");
    }
  });

  it("refuses a path that does not exist, at exit 2, saying so, before scanning", () => {
    const missing = join(dirname(emptyList()), "no-such-list.txt");
    const r = cli(bare({ "a.txt": `id ${SSN}\n` }), ["--allow-list", missing]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("--allow-list");
    expect(r.out).toContain("does not exist");
    expect(r.out).toContain(missing);
    expect(r.out).not.toContain("HIT");
  });

  it("refuses a path that cannot be read, at exit 2, saying so", () => {
    const dir = dirname(emptyList());
    const r = cli(bare({ "a.txt": "clean\n" }), ["--allow-list", dir]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("--allow-list");
    expect(r.out).toContain("could not be read");
    expect(r.out).toContain(dir);
  });

  it.each([
    ["no path", ["--allow-list"]],
    ["an empty path", ["--allow-list", ""]],
    ["the option twice", ["--allow-list", "x.txt", "--allow-list", "y.txt"]],
  ])("refuses %s at exit 2", (_label, args) => {
    const r = cli(bare({ "a.txt": "clean\n" }), args);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("--allow-list");
  });

  it("reads --allow-list after -- as a path to scan, not as the option", () => {
    const list = emptyList();
    const dir = repo({ "a.txt": "clean\n" });
    const r = cli(dir, ["--", "--allow-list", list]);
    // Both are paths now: `--allow-list` names no file, so the paths route refuses it.
    expect(r.code, r.out).toBe(2);
  });

  it("leaves the value of --allow-fixture alone, even when it reads --allow-list", () => {
    // `--allow-fixture --allow-list` names a fixture called `--allow-list`; the engine refuses it
    // for having no override-log entry, and the option parser must not take it as the option.
    const r = cli(repo({ "a.txt": "clean\n" }), ["--allow-fixture", "--allow-list"]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("--allow-fixture rejected");
  });
});

describe("readPhiExclusions", () => {
  const tracked = new Set(["a.txt", "dir/b.txt"]);

  it("takes literal tracked paths and comment lines", () => {
    const read = readPhiExclusions("# why\na.txt\n\ndir/b.txt\n", tracked);
    expect([...read.paths]).toEqual(["a.txt", "dir/b.txt"]);
    expect(read.problems).toEqual([]);
  });

  it("names a repeat", () => {
    expect(readPhiExclusions("a.txt\na.txt\n", tracked).problems[0]).toContain("listed twice");
  });
});
