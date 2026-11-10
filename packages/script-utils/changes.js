// @cosyte/script-utils/changes
//
// WHAT A PULL REQUEST CHANGED, BY LINE, READ FROM GIT. The ratchet's rule for a pull request (its
// changed lines covered, every mutant in them killed) and the changed-files mutation run both need
// the same answer to "what did this change touch", so it is computed here, once.
//
// The answer is the diff from the merge base of the base ref and HEAD to the working tree, plus
// every untracked file that git does not ignore. In CI the working tree is HEAD, so this is exactly
// what the pull request changed. Locally it also counts edits not yet committed, which is what a
// person running the gate before pushing wants judged.
//
// A deleted file changes no lines that still exist, so it is left out. A file moved without edits
// changes none either (rename detection is switched on explicitly, so a user's `diff.renames`
// setting cannot change the answer). Zero dependencies, like the rest of this package.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Thrown when git cannot answer: no repository, an unknown base, a failed diff. Exit 2. */
export class ChangesUnreadable extends Error {
  /**
   * @param {string} message What could not be read.
   */
  constructor(message) {
    super(message);
    this.name = "ChangesUnreadable";
  }
}

/**
 * Run git with array arguments, never through a shell. Not exported: every argument a caller
 * could reach is a literal or an id git itself printed, and a value a caller passes in (a base
 * ref, a path) reaches git on standard input, so no value can become an option such as
 * `--upload-pack`, which runs a command.
 *
 * @param {string[]} args The arguments.
 * @param {string} cwd The directory to run in.
 * @param {string} [input] What to write to git's standard input.
 * @returns {{ status: number | null, stdout: string, stderr: string }} The result.
 */
function runGit(args, cwd, input) {
  const r = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  // When git could not start, the status is null and nothing reads the output.
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout,
    stderr: r.error ? r.error.message : r.stderr,
  };
}

/** A commit id as git prints one: 40 hex digits, or 64 in a SHA-256 repository. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A control character: it would end or break the line git reads a name from. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Run git, throwing {@link ChangesUnreadable} with git's own complaint when it fails.
 *
 * @param {typeof runGit} git Runs git.
 * @param {string[]} args The arguments.
 * @param {string} cwd The directory to run in.
 * @param {string} what What could not be read, for the message.
 * @param {string} [input] What to write to git's standard input.
 * @returns {string} Git's standard output.
 */
function mustRun(git, args, cwd, what, input) {
  const r = git(args, cwd, input);
  if (r.status !== 0) {
    throw new ChangesUnreadable(`${what}: git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

/** The escapes git writes in a quoted path besides octal bytes, as the byte each stands for. */
const GIT_ESCAPES = Object.freeze({ n: 10, t: 9, r: 13 });

/**
 * Undo git's C-style quoting of a path (`"a\"b"`, octal escapes for bytes). A path git did not
 * quote is returned as it is.
 *
 * @param {string} path A path as git printed it.
 * @returns {string} The path.
 */
export function unquoteGitPath(path) {
  if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path;
  const body = path.slice(1, -1);
  /** @type {number[]} */
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch));
      continue;
    }
    const next = body[i + 1];
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    bytes.push(GIT_ESCAPES[next] ?? next.charCodeAt(0));
    i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Read the changed lines out of a zero-context unified diff (`git diff --unified=0`).
 *
 * @param {string} text The diff.
 * @returns {Map<string, Set<number>>} Each changed file, relative to the repository root, with the
 *   1-based line numbers its new version added or changed.
 */
export function parseUnifiedDiff(text) {
  /** @type {Map<string, Set<number>>} */
  const files = new Map();
  /** @type {Set<number> | null} */
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++ ")) {
      // git ends a name that has a space in it with a tab, for patch(1); the tab is not the name's.
      const target = line.endsWith("\t") ? line.slice(4, -1) : line.slice(4);
      if (target === "/dev/null") {
        current = null;
        continue;
      }
      // The destination prefix is pinned to b/ by the diff's own arguments, whatever the config says.
      const path = unquoteGitPath(target).slice(2);
      current = files.get(path) ?? new Set();
      files.set(path, current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk !== null && current !== null) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n += 1) current.add(n);
    }
  }
  return files;
}

/**
 * The lines a change touched against a base ref.
 *
 * @param {object} opts Options.
 * @param {string} opts.base The base ref, for example `origin/main`.
 * @param {string} [opts.cwd] Any directory inside the repository.
 * @param {typeof runGit} [opts.git] Runs git; replaced in tests.
 * @returns {{ root: string, base: string, mergeBase: string, files: Map<string, Set<number>> }}
 *   The repository root, the base as given, the merge base it resolved to, and each changed file
 *   (relative to the root) with its changed lines.
 * @throws {ChangesUnreadable} When git cannot answer.
 */
export function readChanges({ base, cwd = process.cwd(), git = runGit }) {
  if (typeof base !== "string" || base === "") {
    throw new ChangesUnreadable("no base ref was given to compare against");
  }
  // The ref reaches git on standard input, never as an argument. A dash at its start still names
  // no ref git would take, so it is refused as a mistake, and a control character would end the
  // line git reads it from.
  if (base.startsWith("-")) {
    throw new ChangesUnreadable(`the base ref ${JSON.stringify(base)} starts with a dash`);
  }
  if (CONTROL.test(base)) {
    throw new ChangesUnreadable(`the base ref ${JSON.stringify(base)} has a control character`);
  }
  const root = mustRun(
    git,
    ["rev-parse", "--show-toplevel"],
    cwd,
    "not inside a git repository",
  ).trim();
  // Everything after this runs at the root, so a run from a package directory sees the whole change.
  const must = (args, what, input) => mustRun(git, args, root, what, input);
  const resolved = must(
    ["cat-file", "--batch-check=%(objectname)"],
    "could not resolve the base ref",
    `${base}^{commit}\n`,
  ).trim();
  if (!COMMIT_ID.test(resolved)) {
    throw new ChangesUnreadable(
      `the base ref ${JSON.stringify(base)} names no commit git can find`,
    );
  }
  const mergeBase = must(["merge-base", resolved, "HEAD"], `no merge base with ${base}`).trim();
  const diff = must(
    [
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
      mergeBase,
      "--",
    ],
    "could not diff against the merge base",
  );
  const files = parseUnifiedDiff(diff);
  const untracked = must(
    ["-c", "core.quotepath=off", "ls-files", "--others", "--exclude-standard", "--full-name"],
    "could not list untracked files",
  );
  // The listing ends with a newline, so its last entry is empty: that names the root itself, which
  // reads as no file and is skipped like any path that cannot be read (a dangling link, a socket).
  for (const raw of untracked.split("\n")) {
    const path = unquoteGitPath(raw);
    let text;
    try {
      text = String(readFileSync(join(root, path)));
    } catch {
      continue;
    }
    const count = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    files.set(path, new Set(Array.from({ length: count }, (_, i) => i + 1)));
  }
  return { root, base, mergeBase, files };
}

/**
 * A file as it was at a commit: what the ratchet reads the floor file at the merge base with.
 *
 * @param {object} opts Options.
 * @param {string} opts.commit The commit id, as git printed it.
 * @param {string} opts.path The file, relative to the repository root, with `/` separators.
 * @param {string} opts.cwd Any directory inside the repository.
 * @param {typeof runGit} [opts.git] Runs git; replaced in tests.
 * @returns {string | null} The file's text, or `null` when the commit has no such path.
 * @throws {ChangesUnreadable} When git cannot answer, or the path names no file.
 */
export function readFileAtCommit({ commit, path, cwd, git = runGit }) {
  if (!COMMIT_ID.test(commit)) {
    throw new ChangesUnreadable(`the commit ${JSON.stringify(commit)} is not a commit id`);
  }
  if (CONTROL.test(path)) {
    throw new ChangesUnreadable(`the path ${JSON.stringify(path)} has a control character`);
  }
  // `cat-file --batch` reads the name from standard input and prints a header line, the content,
  // and a newline; a name it cannot find prints only `<name> missing`.
  const out = mustRun(
    git,
    ["cat-file", "--batch"],
    cwd,
    `could not read ${path} at ${commit}`,
    `${commit}:${path}\n`,
  );
  const end = out.indexOf("\n");
  const header = end === -1 ? out : out.slice(0, end);
  if (header === `${commit}:${path} missing`) return null;
  const parts = header.split(" ");
  if (parts.length !== 3 || !COMMIT_ID.test(parts[0])) {
    throw new ChangesUnreadable(`${path} at ${commit} could not be read: ${header}`);
  }
  if (parts[1] !== "blob") throw new ChangesUnreadable(`${path} at ${commit} is not a file`);
  return out.slice(end + 1, -1);
}
