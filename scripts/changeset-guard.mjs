#!/usr/bin/env node
// scripts/changeset-guard.mjs
//
// REFUSE A CHANGESET THAT BUMPS NOTHING, BEFORE `changesets/action` EXITS GREEN ON IT.
//
// THE DEFECT THIS EXISTS FOR, measured, not predicted. `changesets/action` publishes on exactly one
// arm: no changeset files present, plus a publish script. With one changeset file present that
// resolves to zero package bumps it takes a THIRD arm, logs
//
//     All changesets are empty; not creating PR
//
// opens no "Version Packages" PR, publishes nothing, and EXITS 0. Run 30640138565 (2026-07-31) did
// exactly that in this repo: it was approved through the protected `release` environment as a real
// publish, reported success, and shipped NONE of the six packages whose manifests were already a
// patch ahead of the registry. The remedy at the time (`cf07086`, PR #41) deleted the offending file
// and wrote the finding down. That fixed the instance. This fixes the class.
//
// A green run that did nothing is worse than a red one, because the run conclusion is the only thing
// anyone reads. Nothing downstream can recover it either: `steps.changesets.outputs.published` is
// `false`, which is also what an ordinary push to main reports, so the two are indistinguishable
// after the fact.
//
// WHAT "EMPTY" MEANS HERE, read off @changesets/parse 0.4.3's own source rather than inferred from
// the log line (node_modules/.pnpm/@changesets+parse@0.4.3/.../changesets-parse.cjs.js):
//
//   * `yaml.load()` of an EMPTY frontmatter block returns a falsy value, and the parser's `else`
//     branch then sets `releases = []`. It does NOT throw. So
//
//         ---
//         ---
//
//         A perfectly good summary nobody will ever read.
//
//     parses cleanly, carries a human-written summary, looks exactly like a real changeset in a
//     diff, and bumps nothing.
//
//   * `validVersionTypes` is `["major", "minor", "patch", "none"]`. `none` is VALID and bumps
//     nothing by design. It exists so a changeset can pull a package into a release without moving
//     its version, which is legitimate ALONGSIDE a real bump. A changeset whose releases are ALL
//     `none` is the same inert file wearing a different disguise: `releases.length > 0`, so it
//     does not even trip the action's own emptiness check, and instead opens a Version PR that
//     changes no version. That is the shape this guard would otherwise miss, so it is checked
//     separately and reported differently.
//
// WHAT THIS DOES NOT DO, stated so it is not assumed. It does not re-implement the action's arm
// selection, and it deliberately does not try to predict which arm a given run will take. Its claim
// is narrower and does not depend on that: a changeset file that cannot bump any package is inert
// on EVERY arm, so refusing it is right regardless of which one the action would have chosen. The
// silent-withholding failure is a consequence of inertness, not the definition of it.
//
// Zero changesets is NOT a failure. That is the publish arm, and it is how every release in this
// repo starts.
//
// Usage:
//   node scripts/changeset-guard.mjs [--dir <changeset-dir>] [--workspace <repo-root>]
//
// Exit codes, which are a contract and are asserted by test/changeset-guard.test.ts:
//   0  no changesets, or every changeset bumps at least one real package and says why
//   1  at least one changeset is inert or mute (the refusal this gate exists for)
//   2  the guard could not run (bad invocation, unreadable directory, unparseable file)
//
// The 1-versus-2 split matters for the same reason it does in scripts/phi-allow-list handling: a
// guard that cannot read its input must not report the same code as a guard that read it and found
// a violation, or "broken" and "caught something" become one signal.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

/** Thrown for an invocation or environment problem: exit 2, never exit 1. */
class InvocationError extends Error {}

/** The em dash, built rather than written. This repo's own gate bans the escape form in source. */
const EM_DASH = String.fromCharCode(0x2014);

/** Files in `.changeset/` that are configuration or prose, never changesets. */
const NOT_A_CHANGESET = new Set(["README.md", "config.json"]);

/**
 * `validVersionTypes` from `@changesets/parse@0.4.3`, copied so an unknown type is refused HERE
 * rather than thrown inside `changesets/action`.
 */
const VALID_RELEASE_TYPES = new Set(["major", "minor", "patch", "none"]);

/**
 * Split a changeset file into its frontmatter block and its summary.
 *
 * This is the SAME regex @changesets/parse 0.4.3 uses (`mdRegex` in its source). It is copied
 * deliberately rather than approximated: a guard that disagrees with the parser about where the
 * frontmatter ends would refuse files the real pipeline accepts, or worse, accept ones it treats as
 * empty. Copying it is a dependency on a private detail, which is why parseChangeset() below
 * asserts the shapes it depends on rather than trusting them.
 *
 * @param {string} contents Raw file contents.
 * @returns {{ frontmatter: string, summary: string } | null} `null` when there is no frontmatter.
 */
function splitChangeset(contents) {
  const match = /\s*---([^]*?)\n\s*---(\s*(?:\n|$)[^]*)/.exec(contents);
  if (match === null) return null;
  return { frontmatter: match[1] ?? "", summary: (match[2] ?? "").trim() };
}

/**
 * Read the `name: type` pairs out of a frontmatter block.
 *
 * Deliberately a LINE parser rather than a YAML one, because this script is zero-dependency by the
 * same rule the drift check follows. That is a real limitation and it is bounded in the right
 * direction: a frontmatter shape this cannot read is reported as unparseable (exit 2), never as
 * empty (exit 1) and never as fine (exit 0). The only shapes changesets itself writes, and the only
 * ones any cosyte repo has ever committed, are `"name": type` and `name: type`, one per line,
 * optionally with a trailing `# comment`.
 *
 * KNOWN AND ACCEPTED: a YAML flow map (`{ "@cosyte/tsconfig": patch }`) or a block scalar splitting
 * the pair across two lines is valid to `@changesets/parse` and takes exit 2 here. Raised by the
 * gate-refuter and left as it is, because the failure is loud and in the safe direction, and the
 * message names the form this accepts. Closing it means taking a YAML dependency for a file shape
 * nothing in this org writes.
 *
 * @param {string} frontmatter The text between the `---` delimiters.
 * @returns {{ name: string, type: string }[]} One entry per declared release.
 */
function parseFrontmatter(frontmatter) {
  const releases = [];
  for (const rawLine of frontmatter.split("\n")) {
    // A trailing `# comment` is valid YAML and a human plausibly writes one next to a bump. Stripped
    // only when the name is quoted or the `#` follows whitespace, so a `#` inside an unquoted value
    // is left alone rather than silently truncated.
    const line = rawLine.replace(/(^|\s)#.*$/, "$1").trim();
    if (line === "") continue;
    const match = /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(\S+)\s*$/.exec(line);
    if (match === null) {
      throw new InvocationError(
        `cannot read the frontmatter line ${JSON.stringify(line)}. This guard reads only the ` +
          `one-pair-per-line form changesets itself writes. Refusing to guess: an unreadable ` +
          `frontmatter must not be reported as an empty one.`,
      );
    }
    // UNQUOTE THE TYPE, and this line is load-bearing rather than tidiness. `@changesets/parse`
    // hands the YAML to js-yaml, which strips quotes, so `"none"` and `none` are the SAME inert
    // value to it. Comparing the raw token instead let `"@cosyte/x": "none"` slip through the
    // all-`none` refusal below and exit 0: a green guard over a changeset that bumps nothing, which
    // is the precise thing this file exists to refuse. Found by the gate-refuter, on the very commit
    // that added the comment strip above.
    const type = (match[4] ?? "").trim().replace(/^["'](.*)["']$/, "$1");
    if (!VALID_RELEASE_TYPES.has(type)) {
      throw new InvocationError(
        `the frontmatter line ${JSON.stringify(line)} declares the release type ` +
          `${JSON.stringify(type)}, which is not one of ${[...VALID_RELEASE_TYPES].join(", ")}. ` +
          `@changesets/parse THROWS on this, so the release run would die inside the action rather ` +
          `than here. Refusing to report it as fine.`,
      );
    }
    releases.push({ name: (match[1] ?? match[2] ?? match[3] ?? "").trim(), type });
  }
  return releases;
}

/**
 * Every package name the workspace can actually release.
 *
 * A changeset naming a package that does not exist is a third way to bump nothing, and it is the
 * one a typo produces. Changesets' own behaviour on an unknown name is not relied on here.
 *
 * @param {string} workspaceRoot Repository root.
 * @returns {Set<string>} Package names under `packages/`.
 */
export function workspacePackages(workspaceRoot) {
  const packagesDir = join(workspaceRoot, "packages");
  let entries;
  try {
    entries = readdirSync(packagesDir);
  } catch (cause) {
    throw new InvocationError(`cannot read ${packagesDir}: ${String(cause)}`);
  }
  const names = new Set();
  for (const entry of entries) {
    const manifestPath = join(packagesDir, entry, "package.json");
    let manifest;
    try {
      if (!statSync(manifestPath).isFile()) continue;
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (typeof manifest.name === "string" && manifest.private !== true) names.add(manifest.name);
  }
  if (names.size === 0) {
    throw new InvocationError(
      `no publishable packages found under ${packagesDir}. Refusing to clear changesets against ` +
        `an empty workspace, which would clear every one of them.`,
    );
  }
  return names;
}

/**
 * Grade one changeset file.
 *
 * @param {string} filename The basename, for diagnostics.
 * @param {string} contents Raw file contents.
 * @param {Set<string>} knownPackages Package names this workspace can release.
 * @returns {string[]} One line per problem. Empty means the changeset is fine.
 */
export function gradeChangeset(filename, contents, knownPackages) {
  const problems = [];
  const split = splitChangeset(contents);
  if (split === null) {
    throw new InvocationError(
      `${filename} has no \`---\` frontmatter block, so @changesets/parse would throw on it and ` +
        `the release run would die inside the action rather than here.`,
    );
  }

  const releases = parseFrontmatter(split.frontmatter);

  if (releases.length === 0) {
    problems.push(
      `its frontmatter declares no packages, so @changesets/parse resolves it to zero releases. ` +
        `With no other changeset present, \`changesets/action\` logs "All changesets are empty; ` +
        `not creating PR", publishes nothing, and exits 0.`,
    );
  } else {
    const unknown = releases.filter((r) => !knownPackages.has(r.name));
    for (const release of unknown) {
      problems.push(
        `it names \`${release.name}\`, which is not a publishable package in this workspace. ` +
          `That entry bumps nothing.`,
      );
    }
    if (unknown.length === 0 && releases.every((r) => r.type === "none")) {
      problems.push(
        `every one of its ${releases.length} release entries is type \`none\`, so it bumps no ` +
          `version. It is not caught by the action's own emptiness check (its releases list is ` +
          `non-empty), so it opens a "Version Packages" PR that changes nothing.`,
      );
    }
  }

  if (split.summary === "") {
    problems.push(
      `its summary is empty. The summary is the only human-written account of what shipped, and ` +
        `this repo derives its release bodies from it, so an empty one publishes a version that ` +
        `cannot say what changed.`,
    );
  } else if (split.summary.includes(EM_DASH)) {
    problems.push(
      `its summary contains an em dash, which is banned on every cosyte surface and would reach ` +
        `a public release body through scripts/release-notes.mjs.`,
    );
  }

  return problems;
}

/**
 * Run the guard over a changeset directory.
 *
 * @param {{ dir: string, workspaceRoot: string }} options Where to look.
 * @returns {{ ok: boolean, checked: number, report: string[] }} Result and the lines to print.
 */
export function guard({ dir, workspaceRoot }) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (cause) {
    throw new InvocationError(`cannot read the changeset directory ${dir}: ${String(cause)}`);
  }

  const files = entries
    .filter((entry) => entry.endsWith(".md") && !NOT_A_CHANGESET.has(basename(entry)))
    .sort();

  if (files.length === 0) {
    return {
      ok: true,
      checked: 0,
      report: [
        `changeset-guard: OK (no changesets pending, which is the publish arm; nothing to grade)`,
      ],
    };
  }

  const knownPackages = workspacePackages(workspaceRoot);
  const report = [];
  let bad = 0;
  for (const file of files) {
    const contents = readFileSync(join(dir, file), "utf8");
    const problems = gradeChangeset(file, contents, knownPackages);
    if (problems.length === 0) continue;
    bad += 1;
    for (const problem of problems) report.push(`ERROR: .changeset/${file}: ${problem}`);
  }

  if (bad > 0) {
    report.push(
      "",
      `Refusing: ${bad} of ${files.length} pending changeset(s) cannot do what a changeset is for.`,
      `Fix the frontmatter (\`"@cosyte/<pkg>": patch\`) and the summary, or delete the file. Do not`,
      `leave it in place: this repo has already shipped a green release run that published nothing`,
      `because of exactly this.`,
    );
    return { ok: false, checked: files.length, report };
  }

  return {
    ok: true,
    checked: files.length,
    report: [
      `changeset-guard: OK (${files.length} pending changeset(s), each bumps a real package and ` +
        `carries a summary)`,
    ],
  };
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} Process exit code.
 */
function main(argv) {
  let dir = null;
  let workspaceRoot = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new InvocationError("--dir needs a value");
      dir = value;
    } else if (arg === "--workspace") {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new InvocationError("--workspace needs a value");
      workspaceRoot = value;
    } else {
      throw new InvocationError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }

  const result = guard({
    dir: resolve(dir ?? join(workspaceRoot, ".changeset")),
    workspaceRoot: resolve(workspaceRoot),
  });
  const stream = result.ok ? process.stdout : process.stderr;
  for (const line of result.report) stream.write(`${line}\n`);
  return result.ok ? 0 : 1;
}

// `import.meta.url` is only the entry module when run as a script, so importing this file for tests
// never executes the CLI. The InvocationError handler is what keeps a broken invocation on exit 2:
// left to node's default an uncaught throw exits 1, which is the code this contract reserves for
// "an inert changeset was found", and the two must not be the same signal.
if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof InvocationError) {
      process.stderr.write(`ERROR: changeset-guard could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
