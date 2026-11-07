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
