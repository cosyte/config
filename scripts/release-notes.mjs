#!/usr/bin/env node
// scripts/release-notes.mjs
//
// DERIVE EACH PACKAGE'S GITHUB RELEASE BODY FROM THE CHANGESETS THE VERSION COMMIT CONSUMED, AND
// REFUSE TO PUBLISH ONE THAT CANNOT SAY WHAT SHIPPED.
//
// THE DEFECT. `changesets/action` defaults `createGithubReleases` to TRUE. On a publish it then cuts
// one GitHub release per package and builds each body by finding a `## <version>` heading in that
// package's CHANGELOG.md. Every package here sets `"changelog": false` in `.changeset/config.json`
// and hand-maintains its CHANGELOG in Keep-a-Changelog form, so `changeset version` writes no such
// heading and the action finds none. Its fallback is to use the WHOLE FILE. That is what shipped on
// 2026-07-31: all six release bodies were the raw CHANGELOG, `# Changelog` preamble, `## [Unreleased]`
// and every historical version included. The bodies were corrected by hand afterwards. Correcting
// bodies by hand is not a gate, so the next release would have done it again.
//
// THE FIX IS TWO HALVES AND BOTH ARE REQUIRED. `release.yml` sets `createGithubReleases: false`, which
// removes the dumping behaviour outright; this script supplies the replacement body, derived from the
// changesets rather than from the CHANGELOG.
//
// WHY THE CHANGESETS AND NOT THE CHANGELOG, which is the question a reader will ask because the
// CHANGELOG is right there. Because deriving from the CHANGELOG requires a `## [0.0.6]` heading to
// exist for a version that does not exist yet at the time the changeset is written. With the
// Changesets changelog GENERATOR disabled, nothing writes that heading, so a human would have to
// predict the next version by hand in the same PR as the changeset, and a gate asserting the heading
// exists would refuse every release until they did. That is a deadlock of exactly the shape this
// repo has already met once. A changeset, by contrast, is written per change, carries a human summary
// by construction, and is deleted by the version commit, which is precisely what makes "what did this
// version consume" answerable from git.
//
// (Whether to switch the Changesets changelog generator back ON is a separate, founder-owned call
// tracked as CHANGELOG-PREAMBLE-FUTURE-TENSE. This script does not depend on the answer: it reads
// changesets, which exist either way. Nothing here should be taken as pre-empting it.)
//
// ORDERING, and it is the part that matters most. Every refusal below can run BEFORE npm is touched,
// because the changesets it reads are in the tree at the version commit's parent, which exists from
// the moment the Version PR is merged. `release.yml` therefore runs `prepare` before
// `changesets/action`, and a run that cannot say what it is shipping goes red with the registry
// untouched. A published version is permanent (ADR 0001), so a check that runs after the publish is
// a complaint, not a gate.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not classify prose. cosyte/.github's release-notes.mjs
// carries a large refusal set for internal identifiers, phase language, ADR numbers and unobservable
// changes, tuned against a single-package parser's changeset corpus. That is not ported here, and the
// honest reason is that it has not been calibrated against this repo's changesets and an uncalibrated
// classifier that refuses a good release is worse than no classifier. What IS refused here is narrow
// and mechanical: a body that is empty, a body that does not name its own release, a body carrying
// the CHANGELOG-dump fingerprint this script exists to prevent, and an em dash. Each of those is a
// property of the bytes, not a judgement about the prose.
//
// WHY NOT USE cosyte/.github's REUSABLE release.yml INSTEAD OF ANY OF THIS. Both facts below were
// measured on `cosyte/.github`'s `main` at `1e634f0`, which is the ref a caller would pin
// (`release.yml@main`), and re-checked as that repo moved during this slice. Neither depends on an
// input: it offers no multi-package mode and no tag override. It cannot serve this repo:
//
//   1. Its gate reads the ROOT package.json's version (`packageVersionAt(repo, rev)` reads
//      `<rev>:package.json`). This repo's root manifest is `cosyte-config`, `private: true`, pinned at
//      `0.0.0`, and Changesets never versions a private root package, so that value has never changed
//      and never will. Running its `prepare` against this repo returns
//      `is-release=false`, code `never-versioned`. The reusable workflow withholds the publish
//      command whenever `is-release` is not `true`, so adopting it would withhold EVERY config
//      publish, permanently, on a green run. That is a strictly worse instance of the same
//      silent-withholding class this change exists to close.
//   2. It hardcodes `tag="v${version}"` and its own comment says why: "Every caller of this workflow
//      is a single-package repo, for which Changesets tags `v<version>`; it uses `<pkg>@<version>`
//      only in a multi-package repo." This repo's fourteen existing tags are all `<pkg>@<version>`.
//
//   The half of that workflow that IS portable is the `RELEASE_PR_TOKEN` wiring, and `release.yml`
//   here now carries it directly. The gate had to be rebuilt for the six-package shape.
//
// Usage:
//   node scripts/release-notes.mjs prepare --repo . --out <dir>
//   node scripts/release-notes.mjs assert --file <f> --expect-package <name> --expect-version <v>
//
// Exit codes, a contract asserted by test/release-notes.test.ts:
//   0  bodies derived and written (or: this commit is not a version commit, so there is nothing to do)
//   1  a refusal: a version moved but its release body cannot be derived or is unfit to publish
//   2  the script could not run (bad invocation, no git, unreadable tree)

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

// See the note on the same import in scripts/changeset-guard.mjs: relative, not a bare specifier,
// because this gate runs before `pnpm install`.
import { isCliEntrypoint } from "../packages/script-utils/index.js";

/** Thrown for an invocation or environment problem: exit 2, never exit 1. */
class InvocationError extends Error {}

/** Thrown when a release cannot describe itself: exit 1. */
class NotesError extends Error {}

/** The em dash, built rather than written. This repo's own gate bans the escape form in source. */
const EM_DASH = String.fromCharCode(0x2014);

/**
 * The fingerprints of the raw-CHANGELOG dump this script exists to prevent.
 *
 * These are asserted on the FINISHED BYTES rather than on the rendering path, because a check that
 * merely confirms the renderer ran also passes when the renderer returns something wrong. If a future
 * change ever routes a body through the CHANGELOG again, one of these fires.
 */
const CHANGELOG_DUMP_MARKERS = [
  { pattern: /^#\s+Changelog\s*$/m, what: "the `# Changelog` file preamble" },
  { pattern: /^##\s*\[Unreleased\]/m, what: "an `## [Unreleased]` heading" },
  { pattern: /keepachangelog\.com/i, what: "the Keep a Changelog boilerplate link" },
];

/** Bodies that look deliberate and say nothing. */
const STUB_PATTERNS = [
  /^automated release of\b/i,
  /^release\s+v?\d+\.\d+\.\d+\.?$/i,
  /^bump(?:ed)? versions?\.?$/i,
];

/**
 * Run git in a repo, returning stdout.
 *
 * @param {string} repo Repository root.
 * @param {string[]} args Arguments to git.
 * @returns {string} Trimmed stdout.
 */
function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  } catch (cause) {
    throw new InvocationError(`git ${args.join(" ")} failed in ${repo}: ${String(cause)}`);
  }
}

/**
 * Run git, returning `null` instead of throwing when it fails.
 *
 * @param {string} repo Repository root.
 * @param {string[]} args Arguments to git.
 * @returns {string | null} Trimmed stdout, or `null`.
 */
function gitOrNull(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Read every publishable package's name and version at one revision.
 *
 * Reads from the git OBJECT at `rev`, not from the working tree, so it can answer the same question
 * about the version commit's parent, where the consumed changesets still exist.
 *
 * @param {string} repo Repository root.
 * @param {string} rev A revision.
 * @returns {Map<string, { dir: string, version: string }>} Keyed by package name.
 */
export function packagesAt(repo, rev) {
  const found = new Map();
  const listing = gitOrNull(repo, ["ls-tree", "-r", "--name-only", rev, "packages/"]);
  if (listing === null) return found;
  for (const path of listing.split("\n").filter(Boolean)) {
    if (!/^packages\/[^/]+\/package\.json$/.test(path)) continue;
    const raw = gitOrNull(repo, ["show", `${rev}:${path}`]);
    if (raw === null) continue;
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;
    if (manifest.private === true) continue;
    found.set(manifest.name, {
      dir: path.replace(/\/package\.json$/, ""),
      version: manifest.version,
    });
  }
  return found;
}

/**
 * The changeset filenames present at a revision.
 *
 * @param {string} repo Repository root.
 * @param {string} rev A revision.
 * @returns {string[]} Paths under `.changeset/`, excluding config and prose.
 */
export function changesetsAt(repo, rev) {
  const listing = gitOrNull(repo, ["ls-tree", "-r", "--name-only", rev, ".changeset/"]);
  if (listing === null) return [];
  return listing
    .split("\n")
    .filter((path) => /^\.changeset\/[^/]+\.md$/.test(path))
    .filter((path) => !path.endsWith("/README.md"))
    .sort();
}

/**
 * Split a changeset into its declared releases and its summary.
 *
 * @param {string} contents Raw changeset file contents.
 * @returns {{ names: string[], summary: string }} Declared package names and the summary.
 */
export function parseChangeset(contents) {
  const match = /\s*---([^]*?)\n\s*---(\s*(?:\n|$)[^]*)/.exec(contents);
  if (match === null) return { names: [], summary: contents.trim() };
  const names = [];
  for (const rawLine of (match[1] ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const pair = /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(\S+)\s*$/.exec(line);
    if (pair === null) continue;
    // A `none` entry pulls a package into the release without bumping it, so it contributes no
    // release body and is not a name this cares about.
    if ((pair[4] ?? "").trim() === "none") continue;
    names.push((pair[1] ?? pair[2] ?? pair[3] ?? "").trim());
  }
  return { names, summary: (match[2] ?? "").trim() };
}

/**
 * Decide whether HEAD is a version commit, and if so what it bumped and what it consumed.
 *
 * The classifier is deliberately a property of the DIFF rather than of tags or the network. A version
 * commit is the commit that moves at least one publishable package's version, and Changesets' version
 * step is the only thing in this repo that does so. The changesets it consumed are exactly those
 * present at the parent and absent at HEAD, which is the same deletion.
 *
 * ON BEING WRONG. If this says "not a release" when it is one, `release.yml` does NOT withhold the
 * publish on that answer, and the post-publish step keys off `changesets/action`'s own
 * `published` output instead. So a misclassification here reddens a run loudly after a real publish;
 * it never withholds one silently. That asymmetry is chosen: silent withholding is the failure this
 * whole change exists to close, and a predicate that could cause it would be self-defeating.
 *
 * @param {string} repo Repository root.
 * @returns {{ isRelease: boolean, reason: string, bumped: { name: string, version: string }[], consumed: string[] }} Classification.
 */
export function classify(repo) {
  const parent = gitOrNull(repo, ["rev-parse", "--verify", "--quiet", "HEAD^"]);
  if (parent === null) {
    return {
      isRelease: false,
      reason: "HEAD has no parent, so nothing can have been bumped",
      bumped: [],
      consumed: [],
    };
  }

  const before = packagesAt(repo, "HEAD^");
  const after = packagesAt(repo, "HEAD");
  const bumped = [];
  for (const [name, current] of after) {
    const previous = before.get(name);
    if (previous === undefined) continue;
    if (previous.version !== current.version)
      bumped.push({ name, version: current.version, dir: current.dir });
  }

  if (bumped.length === 0) {
    return {
      isRelease: false,
      reason:
        "no publishable package's version moved between HEAD^ and HEAD, so this is an ordinary push rather than a version commit",
      bumped: [],
      consumed: [],
    };
  }

  const atParent = new Set(changesetsAt(repo, "HEAD^"));
  const atHead = new Set(changesetsAt(repo, "HEAD"));
  const consumed = [...atParent].filter((path) => !atHead.has(path)).sort();

  return {
    isRelease: true,
    reason: `${bumped.length} package version(s) moved`,
    bumped: bumped.sort((a, b) => a.name.localeCompare(b.name)),
    consumed,
  };
}

/**
 * Render one package's release body.
 *
 * The reader is already looking at the tag, so there is no preamble and no restatement of the
 * version: the summaries say what changed, and the install block says how to get it.
 *
 * @param {{ packageName: string, version: string, summaries: string[] }} input What to render.
 * @returns {string} The body.
 */
export function renderNotes({ packageName, version, summaries }) {
  if (!packageName) throw new NotesError("renderNotes: packageName is required");
  if (!version) throw new NotesError("renderNotes: version is required");
  const kept = summaries.map((s) => s.trim()).filter((s) => s !== "");
  if (kept.length === 0) {
    throw new NotesError(
      `no changeset summary describes ${packageName}@${version}. A release body must say what ` +
        `changed. The changesets this version consumed are recoverable with ` +
        `\`git show HEAD^:.changeset/<file>.md\`.`,
    );
  }
  const lines = [];
  for (const summary of kept) lines.push(summary, "");
  lines.push("### Install", "", "```bash", `npm install ${packageName}@${version}`, "```", "");
  lines.push(`**npm:** https://www.npmjs.com/package/${packageName}/v/${version}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Assert that a finished body is fit to publish.
 *
 * A SEPARATE ENTRY POINT ON PURPOSE. It is handed bytes and knows nothing about how they were
 * produced, so it cannot be satisfied by the renderer having run. `release.yml` calls it twice: once
 * on the file before npm is touched, and once after the publish against the version Changesets
 * actually reported, which is the one fact not available beforehand.
 *
 * @param {{ body: string, packageName: string, version: string }} input What to check.
 * @returns {string[]} One line per problem. Empty means fit.
 */
export function assertNotes({ body, packageName, version }) {
  const problems = [];
  const trimmed = body.trim();

  if (trimmed === "") {
    problems.push("the body is empty");
    return problems;
  }

  for (const { pattern, what } of CHANGELOG_DUMP_MARKERS) {
    if (pattern.test(body)) {
      problems.push(
        `the body contains ${what}, which is the fingerprint of the raw CHANGELOG.md dump that ` +
          `\`createGithubReleases: true\` produced on 2026-07-31. A release body must be derived, ` +
          `not dumped.`,
      );
    }
  }

  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  for (const pattern of STUB_PATTERNS) {
    if (pattern.test(firstLine)) {
      problems.push(
        `the body opens with ${JSON.stringify(firstLine)}, a stub that looks deliberate and tells ` +
          `a reader nothing`,
      );
    }
  }

  if (body.includes(EM_DASH)) {
    problems.push("the body contains an em dash, which is banned on every cosyte surface");
  }

  if (!body.includes(`${packageName}@${version}`)) {
    problems.push(
      `the body never names ${packageName}@${version}, so it may describe a different release ` +
        `than the one being tagged`,
    );
  }

  // The install block plus the npm link is about 90 bytes on its own, so a body that is only
  // scaffolding is short. This is a floor on SUBSTANCE, measured against the part above the install
  // block rather than against the whole thing.
  const substance = trimmed.split("### Install")[0]?.trim() ?? "";
  if (substance.length < 20) {
    problems.push(
      `the body carries ${substance.length} bytes of description above its install block, which is ` +
        `not an account of what changed`,
    );
  }

  return problems;
}

/**
 * Derive and write every body for a version commit.
 *
 * @param {{ repo: string, outDir: string }} options Where to read and write.
 * @returns {{ isRelease: boolean, written: { packageName: string, version: string, file: string }[], report: string[] }} Result.
 */
export function prepare({ repo, outDir }) {
  const classification = classify(repo);
  if (!classification.isRelease) {
    return {
      isRelease: false,
      written: [],
      report: [`No release pending: ${classification.reason}.`],
    };
  }

  if (classification.consumed.length === 0) {
    throw new NotesError(
      `${classification.bumped.length} package version(s) moved but this commit consumed no ` +
        `changesets, so there is nothing from which to say what shipped. A version bump that ` +
        `consumed no changeset is not a release Changesets produced.`,
    );
  }

  // Map each consumed changeset's summary onto every package it bumps.
  const summariesFor = new Map();
  for (const path of classification.consumed) {
    const raw = gitOrNull(repo, ["show", `HEAD^:${path}`]);
    if (raw === null) {
      throw new InvocationError(`cannot read ${path} at HEAD^, though it is listed there`);
    }
    const { names, summary } = parseChangeset(raw);
    if (summary === "") {
      throw new NotesError(
        `the consumed changeset ${path} has an empty summary, so the packages it bumped ` +
          `(${names.join(", ") || "none declared"}) have nothing to report`,
      );
    }
    for (const name of names) {
      if (!summariesFor.has(name)) summariesFor.set(name, []);
      summariesFor.get(name).push(summary);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const written = [];
  const report = [];
  const problems = [];

  for (const { name, version } of classification.bumped) {
    const summaries = summariesFor.get(name) ?? [];
    let body;
    try {
      body = renderNotes({ packageName: name, version, summaries });
    } catch (error) {
      if (error instanceof NotesError) {
        problems.push(error.message);
        continue;
      }
      throw error;
    }
    const found = assertNotes({ body, packageName: name, version });
    if (found.length > 0) {
      problems.push(`${name}@${version}: ${found.join("; ")}`);
      continue;
    }
    const file = join(outDir, `${slugFor(name)}.md`);
    writeFileSync(file, body, "utf8");
    written.push({ packageName: name, version, file });
    report.push(`Derived a release body for ${name}@${version} (${body.length} bytes).`);
  }

  if (problems.length > 0) {
    throw new NotesError(
      `refusing to release: ${problems.length} package(s) cannot describe what they shipped.\n  ` +
        problems.join("\n  "),
    );
  }

  return { isRelease: true, written, report };
}

/**
 * A filesystem-safe stem for a scoped package name.
 *
 * @param {string} packageName A package name.
 * @returns {string} The stem.
 */
export function slugFor(packageName) {
  return packageName.replace(/^@/, "").replace(/[@/]/g, "-");
}

/**
 * Append `key=value` lines to the GitHub step output file, when there is one.
 *
 * @param {Record<string, string>} values Values to emit.
 * @returns {void}
 */
function emitOutputs(values) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  let text = "";
  for (const [key, value] of Object.entries(values)) text += `${key}=${value}\n`;
  appendFileSync(target, text, "utf8");
}

/**
 * Read `--flag value` pairs.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {Record<string, string>} Parsed flags without their leading dashes.
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--"))
      throw new InvocationError(`unexpected argument ${JSON.stringify(arg)}`);
    i += 1;
    const value = argv[i];
    if (value === undefined) throw new InvocationError(`${arg} needs a value`);
    out[arg.slice(2)] = value;
  }
  return out;
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} Process exit code.
 */
function main(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);

  if (subcommand === "prepare") {
    const repo = resolve(args.repo ?? process.cwd());
    const outDir = args.out;
    if (outDir === undefined) throw new InvocationError("prepare needs --out <dir>");
    const result = prepare({ repo, outDir: resolve(outDir) });
    for (const line of result.report) process.stdout.write(`${line}\n`);
    emitOutputs({
      "is-release": String(result.isRelease),
      packages: JSON.stringify(
        result.written.map((w) => ({ name: w.packageName, version: w.version })),
      ),
    });
    return 0;
  }

  if (subcommand === "assert") {
    const file = args.file;
    const packageName = args["expect-package"];
    const version = args["expect-version"];
    if (file === undefined || packageName === undefined || version === undefined) {
      throw new InvocationError("assert needs --file, --expect-package and --expect-version");
    }
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch (cause) {
      throw new InvocationError(`cannot read ${file}: ${String(cause)}`);
    }
    const problems = assertNotes({ body, packageName, version });
    if (problems.length > 0) {
      throw new NotesError(
        `the release body for ${packageName}@${version} is not fit to publish:\n  ` +
          problems.join("\n  "),
      );
    }
    process.stdout.write(`release-notes: OK (${packageName}@${version}, ${body.length} bytes)\n`);
    return 0;
  }

  throw new InvocationError(
    `unknown subcommand ${JSON.stringify(subcommand ?? "")}. Expected \`prepare\` or \`assert\`.`,
  );
}

// See the note on the same guard in scripts/changeset-guard.mjs: importing this file for tests must
// not run the CLI, an environment failure must not borrow exit 1 from a real refusal, and the raw
// string comparison this replaced took three ordinary invocations of this script to a silent exit 0.
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof NotesError) {
      process.stderr.write(`ERROR: ${error.message}\n`);
      process.exit(1);
    }
    if (error instanceof InvocationError) {
      process.stderr.write(`ERROR: release-notes could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
