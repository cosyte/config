import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE CANONICAL EM-DASH GATE'S SURFACE AND ITS REFUSALS.
 *
 * `scripts/check-no-emdash.sh` is the one implementation of this gate for the estate, so what it
 * refuses is what every consuming repo inherits. These cases are the criteria that are not gradeable
 * by running the gate over THIS repository: each needs a repository in a state config is never in.
 *
 * EVERY CASE BUILDS A THROWAWAY GIT REPOSITORY. Mutating the repository under test to produce an
 * empty file list, a tracked symlink or a stale declaration would leave the suite's own checkout in
 * a state the next case reads, and two of these states red the repository's own gate.
 *
 * THIS FILE CARRIES NO BANNED FORM AS SOURCE BYTES, AND NEEDS NONE. It is tracked, so a banned form
 * spelled here would make config track a second file carrying the vocabulary, which reds the gate's
 * own run over its own tree. None of the criteria below needs a HIT to be observable: they are
 * refusals and reporting modes. The one place the estate proves the scanner still SEES a violation
 * is the gate's own self-test, which builds the bytes with `printf`.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const GATE = join(REPO_ROOT, "scripts", "check-no-emdash.sh");
const DECLARATION = "scripts/check-no-emdash.exclude";

let scratch: string;
let counter = 0;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "check-no-emdash-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Build a throwaway git repository and stage its files.
 *
 * Staged rather than committed: `git ls-files` reads the index, which is what the gate enumerates,
 * and committing would need an identity this suite has no business writing into a runner's config.
 *
 * @param files Repo-root-relative path to file body, for every file to create.
 * @param options.untracked Paths from `files` to create on disk but leave out of the index.
 * @param options.links Repo-root-relative symlink path to its target, staged like any other entry.
 * @returns The absolute path of the repository.
 */
function makeRepo(
  files: Record<string, string>,
  options: { untracked?: string[]; links?: Record<string, string> } = {},
): string {
  const dir = join(scratch, `repo-${(counter += 1)}`);
  mkdirSync(dir, { recursive: true });
  const init = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);

  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  for (const [rel, target] of Object.entries(options.links ?? {})) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    symlinkSync(target, abs);
  }

  const untracked = new Set(options.untracked ?? []);
  const toAdd = [...Object.keys(files), ...Object.keys(options.links ?? {})].filter(
    (rel) => !untracked.has(rel),
  );
  if (toAdd.length > 0) {
    const add = spawnSync("git", ["-C", dir, "add", "--", ...toAdd], { encoding: "utf8" });
    if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
  }
  return dir;
}

/**
 * Run the gate, from `cwd`, and report everything a caller can observe.
 *
 * stdout is kept as bytes because `--list-scanned` writes a NUL-separated list, and decoding it as
 * text before splitting would hide a separator the gate got wrong.
 *
 * @param cwd The directory to run from.
 * @param args Arguments to the gate.
 * @param gate The implementation to execute. Defaults to the canonical in this repository.
 * @returns The exit status, stdout as bytes, and stderr as text.
 */
function runGate(
  cwd: string,
  args: string[] = [],
  gate: string = GATE,
): { code: number | null; stdout: Buffer; stderr: string } {
  const result = spawnSync("bash", [gate, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  return {
    code: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
}

/**
 * The repo-root-relative paths `--list-scanned` reported, sorted.
 *
 * @param stdout The mode's raw stdout.
 * @returns One entry per path, with the trailing empty field after the last NUL dropped.
 */
function scannedPaths(stdout: Buffer): string[] {
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry !== "")
    .sort();
}

describe("[AC-2] an argument the gate does not recognise", () => {
  it("[AC-2] refuses at exit 1, names the argument, and names the four modes", () => {
    const repo = makeRepo({ "a.txt": "hello\n" });
    const run = runGate(repo, ["--recursive"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("unrecognised argument: --recursive");
    expect(run.stderr).toContain("--stdin");
    expect(run.stderr).toContain("--list-scanned");
    expect(run.stderr).toContain("--self-id");
    // The exit vocabulary is closed at 0 and 1, so a bad invocation may not invent a third code,
    // and nothing about a refusal belongs on the machine-readable stream.
    expect(run.stdout.length).toBe(0);
  });

  it("[AC-2] refuses an extra operand after a mode that takes none", () => {
    const repo = makeRepo({ "a.txt": "hello\n" });
    for (const args of [
      ["--list-scanned", "also-this"],
      ["--self-id", "also-this"],
    ]) {
      const run = runGate(repo, args);
      expect(run.code, `${args.join(" ")} was accepted`).toBe(1);
      expect(run.stderr).toContain("also-this");
      expect(run.stdout.length).toBe(0);
    }
  });
});

describe("[AC-3] --self-id reports which bytes are executing", () => {
  it("[AC-3] writes one line, the lowercase sha256 of the implementation, and nothing else", () => {
    const repo = makeRepo({ "a.txt": "hello\n" });
    const run = runGate(repo, ["--self-id"]);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");

    const digest = createHash("sha256").update(readFileSync(GATE)).digest("hex");
    expect(run.stdout.toString("utf8")).toBe(`${digest}\n`);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[AC-3] reports the copy that is running, not a constant, and needs no repository", () => {
    // THE NEGATIVE CONTROL, and without it the case above proves only that two spellings of one
    // constant agree. A consumer's whole use of this mode is to tell the canonical from a drifted
    // copy, so a mutated copy must report a DIFFERENT digest, and its own.
    //
    // It runs from the scratch directory, which is not a git repository: `--self-id` is answered
    // before anything asks git a question, and the consuming repo that leans on this mode executes
    // the gate out of `node_modules` where that property is the difference between an answer and a
    // fatal. That is one assertion about this mode, not a second case.
    const drifted = join(scratch, "drifted-copy.sh");
    writeFileSync(drifted, `${readFileSync(GATE, "utf8")}\n# one byte of drift\n`);

    const run = runGate(scratch, ["--self-id"], drifted);
    expect(run.code).toBe(0);

    const driftedDigest = createHash("sha256").update(readFileSync(drifted)).digest("hex");
    const canonicalDigest = createHash("sha256").update(readFileSync(GATE)).digest("hex");
    expect(run.stdout.toString("utf8")).toBe(`${driftedDigest}\n`);
    expect(driftedDigest).not.toBe(canonicalDigest);
  });
});

describe("[AC-5] the exclusion declaration", () => {
  it("[AC-5] applies a trailing-slash entry as a prefix and any other entry as one exact path", () => {
    const repo = makeRepo({
      "a.txt": "excluded exactly\n",
      "keep.txt": "scanned\n",
      "vendor/x/one.json": "excluded by prefix\n",
      "vendor/x/two.json": "excluded by prefix\n",
      "vendor/README.md": "scanned: the prefix is vendor/x/, not vendor/\n",
      [DECLARATION]: ["# a comment", "", "   # an indented comment", "vendor/x/", "a.txt", ""].join(
        "\n",
      ),
    });

    const run = runGate(repo, ["--list-scanned"]);
    expect(run.code).toBe(0);
    // The declaration is itself a tracked file and is scanned like any other, so it is in this list.
    expect(scannedPaths(run.stdout)).toEqual(["keep.txt", DECLARATION, "vendor/README.md"]);
  });

  it("[AC-5] refuses an entry that matches no tracked path, exact or prefix", () => {
    for (const entry of ["vendor/gone.json", "vendor/gone/"]) {
      const repo = makeRepo({
        "a.txt": "hello\n",
        [DECLARATION]: `${entry}\n`,
      });
      const run = runGate(repo);
      expect(run.code, `${entry} was accepted`).toBe(1);
      expect(run.stderr).toContain(`stale entry in ${DECLARATION}, line 1: ${entry}`);
      expect(run.stdout.length).toBe(0);
    }
  });

  it("[AC-5] refuses an entry carrying stray whitespace, and says that is why", () => {
    // An entry is the line verbatim, so `a.txt ` is a path no repository has. The refusal is
    // therefore correct and the diagnostic is the whole of what makes it actionable: without it a
    // reader compares the entry against a path that looks identical on screen.
    const repo = makeRepo({ "a.txt": "hello\n", [DECLARATION]: "a.txt \n" });
    const run = runGate(repo);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("stale entry");
    expect(run.stderr).toContain("whitespace");
  });
});

describe("[AC-6] an entry that is not anchored at the repository root", () => {
  it("[AC-6] refuses an absolute entry, a ./ entry, and an entry containing ..", () => {
    for (const entry of ["/a.txt", "./a.txt", "../outside/a.txt", "vendor/../a.txt"]) {
      const repo = makeRepo({ "a.txt": "hello\n", [DECLARATION]: `${entry}\n` });
      const run = runGate(repo);
      expect(run.code, `${entry} was accepted`).toBe(1);
      expect(run.stderr).toContain(`unusable entry in ${DECLARATION}, line 1: ${entry}`);
      expect(run.stdout.length).toBe(0);
    }
  });
});

describe("[AC-C4] a tracked entry that is not a regular file", () => {
  it("[AC-C4] refuses by name rather than skipping it, in both modes that enumerate paths", () => {
    // A symlink to a DIRECTORY is the case a `-d skip` would swallow in silence: it is readable, it
    // tests as a directory, and grep would drop it at exit 0 with nothing on stderr.
    const repo = makeRepo(
      { "a.txt": "hello\n", "dir/inner.txt": "hello\n" },
      { links: { link: "dir" } },
    );

    const scan = runGate(repo);
    expect(scan.code).toBe(1);
    expect(scan.stderr).toContain("tracked entry is not a regular file: link");
    expect(scan.stdout.length).toBe(0);

    // `--list-scanned` reports what the default scan READS, so it runs the same enumeration and
    // owes the same refusal. A reporting mode that listed an entry the scan refuses would hand a
    // consumer a coverage comparison the scan never honoured.
    const list = runGate(repo, ["--list-scanned"]);
    expect(list.code).toBe(1);
    expect(list.stderr).toContain("tracked entry is not a regular file: link");
    expect(list.stdout.length).toBe(0);
  });
});

describe("[AC-C5] a scan with nothing left to read", () => {
  it("[AC-C5] refuses when the repository tracks no file at all", () => {
    const repo = makeRepo({});
    const run = runGate(repo);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("no tracked files to scan");
    expect(run.stdout.length).toBe(0);
  });

  it("[AC-C5] refuses when the declaration excludes every tracked path", () => {
    const repo = makeRepo({
      "a.txt": "hello\n",
      [DECLARATION]: `a.txt\n${DECLARATION}\n`,
    });
    const run = runGate(repo);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("no tracked files left to scan");
    expect(run.stdout.length).toBe(0);
  });
});
