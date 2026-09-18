import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runInternalRefsScan } from "@cosyte/script-utils/internal-refs";

/**
 * A THROWAWAY GIT REPOSITORY FOR THE INTERNAL-REFERENCE GATE'S TESTS.
 *
 * WHY A REAL REPOSITORY AND NOT A STUB. The gate's whole subject is what a tracked tree contains:
 * enumeration is `git ls-files`, the tracked-surface refusal is a git question, and the completeness
 * rule compares what git listed against what the reader opened. A fake enumerator would grade the
 * fake. These directories are small (a manifest and one or two markdown files), so a real
 * `git init` is cheap enough to pay for every case.
 */
export interface ScratchRepo {
  /** The repository root. */
  root: string;
  /** Write a file, creating its parents. It is NOT tracked until `track` is called. */
  write(relative: string, contents: string | Buffer): void;
  /** Stage and commit paths, so `git ls-files` reports them. */
  track(...relative: string[]): void;
  /** Run git in this repository. */
  git(...args: string[]): string;
  /** Remove it. */
  dispose(): void;
}

/** A clean manifest: nothing in it trips a rule, so a seeded violation is the only one. */
export function cleanManifest(files: string[] = ["README.md"]): string {
  return JSON.stringify(
    {
      name: "scratch",
      version: "0.0.0",
      description: "A throwaway package used to grade the internal-reference gate.",
      keywords: ["scratch"],
      files,
    },
    null,
    2,
  );
}

/**
 * Create a throwaway repository with a manifest and a README already tracked.
 *
 * @param prefix - A label for the temporary directory, so a leaked one can be traced.
 * @param readme - The README contents.
 * @returns The repository.
 */
export function makeScratchRepo(
  prefix: string,
  readme = "# Scratch\n\nNothing here.\n",
): ScratchRepo {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  git("init", "-q", ".");
  git("config", "user.email", "scratch@example.invalid");
  git("config", "user.name", "Scratch");
  git("config", "commit.gpgsign", "false");

  const repo: ScratchRepo = {
    root,
    write(relative, contents) {
      const absolute = join(root, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    },
    track(...relative) {
      git("add", "--", ...relative);
      git("commit", "-q", "-m", "scratch");
    },
    git,
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  repo.write("package.json", cleanManifest());
  repo.write("README.md", readme);
  repo.track("package.json", "README.md");
  return repo;
}

/** What one in-process run of the gate produced. */
export interface RunResult {
  code: number;
  out: string;
  err: string;
  /** Everything the run wrote, so a case can assert on the report without choosing a stream. */
  all: string;
}

/**
 * Run the gate in process against a scratch repository, capturing both streams.
 *
 * `write` is supplied here rather than left to the caller so no case can accidentally assert on a
 * stream the run never used.
 *
 * @param config - The gate configuration under test.
 * @returns The exit code and the report.
 */
export function runGate(config: Record<string, unknown>): RunResult {
  let out = "";
  let err = "";
  const code = runInternalRefsScan({
    ...config,
    write: {
      out: (text: string) => {
        out += text;
      },
      err: (text: string) => {
        err += text;
      },
    },
  } as never);
  return { code, out, err, all: `${out}${err}` };
}
