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
 * @param input Text to put on the gate's stdin. Omitted, stdin is empty.
 * @returns The exit status, stdout as bytes, and stderr as text.
 */
function runGate(
  cwd: string,
  args: string[] = [],
  gate: string = GATE,
  input?: string,
): { code: number | null; stdout: Buffer; stderr: string } {
  const result = spawnSync("bash", [gate, ...args], {
    cwd,
    input,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  return {
    code: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
}

/**
 * The four modes of the surface, each with whatever it needs to reach its own work.
 *
 * `--stdin` is handed a clean line so that an empty-stdin refusal can never stand in for the
 * refusal a case is actually asserting.
 */
const EVERY_MODE: { name: string; args: string[]; input?: string }[] = [
  { name: "(no argument)", args: [] },
  { name: "--list-scanned", args: ["--list-scanned"] },
  { name: "--stdin", args: ["--stdin", "a label"], input: "a clean line\n" },
  { name: "--self-id", args: ["--self-id"] },
];

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

describe("[AC-5] [AC-6] an unusable declaration is refused in EVERY mode", () => {
  // AC-5 says "in every mode including --list-scanned" and AC-6 carries no mode qualifier at all.
  // `--stdin` and `--self-id` subtract no path with the declaration, so for them this is validation
  // rather than filtering: an entry that has outlived its subject is a hole nobody is looking at,
  // and the mode that happens to be running is no reason to leave it standing.

  it("[AC-5] refuses a stale entry in every mode, and names it", () => {
    for (const mode of EVERY_MODE) {
      const repo = makeRepo({ "a.txt": "hello\n", [DECLARATION]: "vendor/gone.json\n" });
      const run = runGate(repo, mode.args, GATE, mode.input);
      expect(run.code, `${mode.name} accepted a stale entry`).toBe(1);
      expect(run.stderr, mode.name).toContain(
        `stale entry in ${DECLARATION}, line 1: vendor/gone.json`,
      );
      expect(run.stdout.length, mode.name).toBe(0);
    }
  });

  it("[AC-6] refuses an entry that is not anchored in every mode, and names it", () => {
    for (const mode of EVERY_MODE) {
      const repo = makeRepo({ "a.txt": "hello\n", [DECLARATION]: "./a.txt\n" });
      const run = runGate(repo, mode.args, GATE, mode.input);
      expect(run.code, `${mode.name} accepted an unanchored entry`).toBe(1);
      expect(run.stderr, mode.name).toContain(`unusable entry in ${DECLARATION}, line 1: ./a.txt`);
      expect(run.stdout.length, mode.name).toBe(0);
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

  it("[AC-C4] refuses a tracked regular file that a directory shadows on disk", () => {
    // The index says mode 100644 and the disk says directory. Only the index can tell this apart
    // from a gitlink, and a skip keyed on the type on disk counts it as one: the indexed content is
    // never opened, nothing reaches stderr, and the run exits 0 reporting a gitlink it does not
    // have. Whatever the index holds for that path goes unread, which is a missed READ rather than
    // a missed match and is the harder one to notice.
    const repo = makeRepo({ "a.txt": "hello\n", "ok.txt": "hello\n" });
    rmSync(join(repo, "a.txt"));
    mkdirSync(join(repo, "a.txt"));

    for (const args of [[], ["--list-scanned"]]) {
      const run = runGate(repo, args);
      expect(run.code, `${args.join(" ") || "(no argument)"} skipped it`).toBe(1);
      expect(run.stderr).toContain("tracked entry is not a regular file: a.txt");
      expect(run.stdout.length).toBe(0);
    }
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

describe("[Contract: THE SURFACE] the exit vocabulary is closed at two codes", () => {
  // "Exit 0 means the mode completed and found nothing banned. Exit 1 means anything else: ... an
  // input could not be read ... THERE IS NO THIRD CODE." `cli` N1 says the same: the vocabulary is
  // closed and adding to it is a change to the surface. git answers 128 for a repository it cannot
  // read, and a status allowed out of here is a third code arriving from a tool this gate does not
  // own, carrying no diagnostic of this gate's own.

  it("[Contract: THE SURFACE] refuses at 1, never at git's status, where there is no work tree", () => {
    const outside = mkdtempSync(join(scratch, "outside-"));
    const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: outside,
      encoding: "utf8",
    });
    expect(probe.stdout.trim(), "this case needs a directory outside any repository").not.toBe(
      "true",
    );

    for (const mode of EVERY_MODE) {
      const run = runGate(outside, mode.args, GATE, mode.input);
      // Nothing is tracked, so there is no declaration to honour and no tracked file to read: the
      // two modes that enumerate tracked paths refuse, and the two that read none answer.
      const enumerates = mode.args.length === 0 || mode.args[0] === "--list-scanned";
      expect(run.code, `${mode.name} answered with ${run.code}`).toBe(enumerates ? 1 : 0);
      if (enumerates) {
        // The refusal has to say what failed, not merely decline to be 128: a status reduced
        // without a diagnostic leaves a reader hunting a cause nobody named.
        expect(run.stderr, mode.name).toContain("this is not a git work tree");
        expect(run.stdout.length, mode.name).toBe(0);
      }
    }
  });

  it("[Contract: THE SURFACE] refuses at 1, never at git's status, when the index cannot be read", () => {
    // An unreadable index is literally "an input could not be read", and it is the one repository
    // state in which this gate cannot know what is tracked: every mode fails closed on it, because
    // a declaration it cannot check is a scan surface it cannot vouch for.
    const repo = makeRepo({ "a.txt": "hello\n" });
    writeFileSync(join(repo, ".git", "index"), "not an index at all");

    for (const mode of EVERY_MODE) {
      const run = runGate(repo, mode.args, GATE, mode.input);
      expect(run.code, `${mode.name} answered with ${run.code}`).toBe(1);
      // Naming the call that failed is the half a reduced status cannot supply on its own.
      expect(run.stderr, mode.name).toContain("git ls-files -s -z failed");
      expect(run.stdout.length, mode.name).toBe(0);
    }
  });
});
