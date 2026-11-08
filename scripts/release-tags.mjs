#!/usr/bin/env node
// scripts/release-tags.mjs
//
// EVERY PACKAGE VERSION ON NPM HAS ITS TAG AND ITS GITHUB RELEASE, WHICHEVER COMMIT VERSIONED IT.
//
// THE DEFECT THIS EXISTS FOR (config#189, config#192, 2026-11-08). The tag step in release.yml
// ("Every bumped package must be published, tagged and released") works from what the LATEST version
// commit bumped: release-notes.mjs classifies HEAD against HEAD^, and nothing else. The run for the
// version commit of #189 stopped in `preflight` at the catalog check, so nothing published. The run
// for the next version commit, #192, took the publish arm, and `changeset publish` published every
// manifest version npm did not have: script-utils 0.1.8, which #192 bumped, and eslint-config 0.1.3,
// process 0.1.5 and test-utils 0.1.3, which only #189 bumped. The tag step tagged and released the
// one package #192 bumped, and the run went GREEN with three versions on npm carrying no tag and no
// GitHub release. They were tagged by hand.
//
// SO THIS ASKS A DIFFERENT QUESTION, OVER EVERY PUBLISHABLE PACKAGE, NOT ONLY THE BUMPED ONES. For
// each `packages/*` manifest that is not private, read `<name>@<version>` from the working tree,
// which is what `changeset publish` publishes, and ask GitHub whether the tag `<name>@<version>` and
// its release exist. Only a version missing one of them is asked about on the registry, and only a
// version the registry has is owed anything: it gets its tag and release here, at the commit this run
// published from, with a body built from that version's section of the package's CHANGELOG.md. Then
// the tag and the release are read back, and a version on npm still missing either one reds the run.
//
// WHY THE CHANGELOG AND NOT THE CHANGESETS for the body. The changesets that described an earlier
// version commit were deleted by that commit, and finding it means walking history. Since
// 2026-11-07 Changesets writes every package CHANGELOG (ST35), and each `## <version>` section is
// built from the same changesets, so the section says the same thing in the form the package ships.
// The body is still checked by release-notes.mjs's `assertNotes`, byte for byte, like every other
// body: a section that is missing, empty or unfit is a refusal, never an invented body.
//
// IT DOES NOT REPLACE THE BUMPED-PACKAGE STEP, AND RUNS AFTER IT. That step keeps the changeset
// derived bodies and the balance for what HEAD bumped; this one closes every version that step does
// not see. In the ordinary case every version already has its tag and release by the time this
// runs, so it makes two GitHub reads per package, no registry probe and no write.
//
// IDEMPOTENT. A version with its tag and release is left alone (never edited), so a re-run of the
// publish job creates only what is still owed. A version that is not on the registry is not tagged:
// a tag says the version shipped.
//
// CARRYING IT OVER. Everything is in this file and in one step of release.yml ("Every package version
// on npm must have its tag and release"), which calls it with the checkout, the commit and a scratch
// directory, and needs only `GH_TOKEN` with `contents: write`, which the publish job already holds.
// It reads no output of `changesets/action`, so a workflow that publishes some other way keeps the
// guarantee by keeping that one step after its publish step.
//
// ZERO DEPENDENCIES, like the other release gates here.
//
// Usage:
//   node scripts/release-tags.mjs reconcile --repo <dir> --target <sha> --notes-dir <dir>
//                                           [--budget-seconds <n>] [--probe-interval-seconds <n>]
//
// GitHub is reached through `gh` with the token in `GH_TOKEN`, and the repository is
// `GITHUB_REPOSITORY` when it is set (in Actions it always is).
//
// Exit codes, a contract asserted by test/release-tags.test.ts:
//   0  every publishable package's version that is on npm has its tag and its GitHub release.
//   1  at least one version on npm still has no tag or no release, or GitHub or the registry could
//      not be read, so that cannot be ruled out.
//   2  the reconciliation could not run: a bad invocation or an unreadable workspace.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCliEntrypoint } from "../packages/script-utils/index.js";
import {
  ABSENT,
  InvocationError,
  PRESENT,
  account,
  workspacePackages,
} from "./registry-presence.mjs";
import { assertNotes, renderNotes, slugFor } from "./release-notes.mjs";

export { InvocationError };

/** GitHub answered with something other than "found" or "not found". */
export class GitHubUnreadable extends Error {}

/** The tag form this repository uses: `<pkg>@<version>`, never `v<version>`. */
export const tagFor = (name, version) => `${name}@${version}`;

/**
 * The body of one version's section of a CHANGELOG.md.
 *
 * Reads both heading forms these files carry: the one Changesets writes (`## 0.1.3`) and the one the
 * hand-kept archive used (`## [0.1.1] - 2026-11-07`). The section runs to the next level-one or
 * level-two heading, which is the next version or the archive's own heading.
 *
 * @param {string} text The CHANGELOG.md contents.
 * @param {string} version The version whose section to read.
 * @returns {string | null} The section's body, trimmed, or `null` when there is no such section or it
 *   is empty.
 */
export function changelogSection(text, version) {
  const lines = String(text ?? "").split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+(?:\\[${escaped}\\]|${escaped})(?:\\s+-\\s+.*)?\\s*$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body === "" ? null : body;
}

/**
 * Build one version's release body from its CHANGELOG section, checked like every other body.
 *
 * @param {{ name: string, version: string, dir: string }} pkg The package.
 * @returns {{ body: string } | { problem: string }} The body, or why there is none.
 */
export function changelogBody({ name, version, dir }) {
  const file = join(dir, "CHANGELOG.md");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return { problem: `cannot read ${file}: ${error.message}` };
  }
  const section = changelogSection(text, version);
  if (section === null) {
    return { problem: `${file} has no non-empty \`## ${version}\` section to build a body from` };
  }
  const body = renderNotes({ packageName: name, version, summaries: [section] });
  const problems = assertNotes({ body, packageName: name, version });
  if (problems.length > 0) {
    return { problem: `the body built from ${file} is not fit to publish: ${problems.join("; ")}` };
  }
  return { body };
}

/**
 * The GitHub boundary, through `gh`. A test replaces `gh` on PATH, never this object's logic.
 *
 * Each read separates "not found" from "could not ask": a failed request is not evidence that a tag
 * is missing, and it must not be evidence that one exists either.
 *
 * @param {{ repo?: string, env?: object }} [options] The repository (`owner/name`) and environment.
 * @returns {{ tagExists: Function, releaseExists: Function, createRelease: Function }} The boundary.
 */
export function ghGitHub({ repo = process.env.GITHUB_REPOSITORY, env = process.env } = {}) {
  const run = (args) => {
    const result = spawnSync("gh", args, { env, encoding: "utf8" });
    if (result.error) {
      throw new GitHubUnreadable(`gh could not be started: ${result.error.message}`);
    }
    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    };
  };
  const repoArgs = repo ? ["--repo", repo] : [];
  const firstLine = (text) => String(text).split("\n")[0].slice(0, 200);
  return {
    tagExists(tag) {
      // The singular `git/ref` endpoint matches exactly; the plural one matches by prefix, and
      // `@cosyte/x@0.1` would then "exist" because `@cosyte/x@0.1.3` does.
      const { status, output } = run([
        "api",
        `repos/${repo || "{owner}/{repo}"}/git/ref/tags/${tag}`,
      ]);
      if (status === 0) return true;
      if (/HTTP 404|Not Found/.test(output)) return false;
      throw new GitHubUnreadable(`could not read the tag ${tag}: ${firstLine(output)}`);
    },
    releaseExists(tag) {
      const { status, output } = run(["release", "view", tag, ...repoArgs, "--json", "isDraft"]);
      if (status === 0) {
        try {
          return JSON.parse(output).isDraft !== true;
        } catch {
          throw new GitHubUnreadable(`could not read the release ${tag}: ${firstLine(output)}`);
        }
      }
      if (/release not found|HTTP 404/.test(output)) return false;
      throw new GitHubUnreadable(`could not read the release ${tag}: ${firstLine(output)}`);
    },
    createRelease({ tag, target, notesFile }) {
      // `--target` makes gh create the tag at that commit when it does not exist; when it does, gh
      // uses the existing tag and the target is not read.
      const { status, output } = run([
        "release",
        "create",
        tag,
        ...repoArgs,
        "--target",
        target,
        "--title",
        tag,
        "--notes-file",
        notesFile,
      ]);
      return status === 0 ? { ok: true } : { ok: false, detail: firstLine(output) };
    },
  };
}

/**
 * Give every version on npm its tag and release, then prove it.
 *
 * @param {object} options
 * @param {{ name: string, version: string, dir: string }[]} options.packages Every publishable package.
 * @param {string} options.target The commit a missing tag is created at: the one this run published.
 * @param {string} options.notesDir Where release bodies are written for `gh`.
 * @param {object} options.github The GitHub boundary (see `ghGitHub`).
 * @param {object} [options.presence] Options passed to registry-presence.mjs's `account`: the
 *   budget, the interval, the environment and, in a test, the probe.
 * @param {Function} [options.log] Where lines and annotations go.
 * @returns {Promise<{ code: number, rows: object[] }>} The verdict and one row per package.
 */
export async function reconcile({
  packages,
  target,
  notesDir,
  github,
  presence = {},
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  const rows = packages.map((pkg) => ({
    ...pkg,
    tag: tagFor(pkg.name, pkg.version),
    tagged: false,
    released: false,
    outcome: null,
  }));
  const failures = [];
  const fail = (row, title, message) => {
    row.outcome = "failed";
    failures.push(row.tag);
    log(`::error title=${title}::${message}`);
  };
  const read = (row) => {
    row.tagged = github.tagExists(row.tag);
    row.released = github.releaseExists(row.tag);
  };

  // 1. What GitHub already has. A version with both is done, and is never edited here.
  for (const row of rows) {
    try {
      read(row);
    } catch (error) {
      if (!(error instanceof GitHubUnreadable)) throw error;
      fail(
        row,
        "GitHub could not be read",
        `${row.tag}: ${error.message}. Whether it is owed a tag is unknown, so this cannot pass. ` +
          `Re-run the job: it creates only what is still missing.`,
      );
      continue;
    }
    if (row.tagged && row.released) row.outcome = "already";
  }

  // 2. Which of the rest the registry has. Only those are owed anything.
  const owed = rows.filter((row) => row.outcome === null);
  if (owed.length > 0) {
    const verdict = await account({
      ...presence,
      packages: owed.map(({ name, version }) => ({ name, version })),
      reportAbsent: false,
      log,
    });
    verdict.rows.forEach((answer, index) => {
      owed[index].registry = answer.state;
    });
  }

  mkdirSync(notesDir, { recursive: true });
  for (const row of owed) {
    if (row.registry === ABSENT) {
      row.outcome = "not-on-npm";
      log(
        `::warning title=Not on npm, so not tagged::${row.tag} is the version in ` +
          `${row.name}'s package.json, and the registry does not have it. A tag says a version ` +
          `shipped, so none is created. If the publish step above failed, that is the failure to ` +
          `read; RELEASING.md failure state (c) has the terminal action.`,
      );
      continue;
    }
    if (row.registry !== PRESENT) {
      // registry-presence has already annotated it as unreadable, with the reason.
      fail(
        row,
        "On npm or not is unknown",
        `${row.tag} has no ${row.tagged ? "GitHub release" : "tag"} and the registry could not ` +
          `be read, so whether it is owed one is unknown. Re-run the job.`,
      );
      continue;
    }

    // 3. On npm with something missing: create the release, and with it the tag.
    if (!row.released) {
      const built = changelogBody(row);
      if ("problem" in built) {
        fail(
          row,
          "On npm with no release body",
          `${row.tag} is on npm with no ${row.tagged ? "GitHub release" : "tag"}, and no body ` +
            `could be built for it: ${built.problem}. Create it by hand per RELEASING.md failure ` +
            `state (d), then re-run the job.`,
        );
        continue;
      }
      const notesFile = join(notesDir, `${slugFor(row.name)}.md`);
      writeFileSync(notesFile, built.body, "utf8");
      const created = github.createRelease({ tag: row.tag, target, notesFile });
      if (created.ok) {
        log(
          `Created the ${row.tagged ? "release" : "tag and release"} for ${row.tag}, which is on ` +
            `npm and had none, from its CHANGELOG section.`,
        );
      } else {
        log(`gh release create ${row.tag} failed: ${created.detail}`);
      }
    }

    // 4. Read it back. This, not the create call's exit code, is what decides.
    try {
      read(row);
    } catch (error) {
      if (!(error instanceof GitHubUnreadable)) throw error;
      fail(row, "GitHub could not be read", `${row.tag}: ${error.message}. Re-run the job.`);
      continue;
    }
    if (row.tagged && row.released) {
      row.outcome = "created";
      continue;
    }
    fail(
      row,
      "On npm with no tag",
      `${row.tag} is on npm and has ${row.tagged ? "a tag but no GitHub release" : "no tag"} ` +
        `after this step. Re-run the job; if it fails again, create it by hand per RELEASING.md ` +
        `failure state (d).`,
    );
  }

  if (failures.length > 0) {
    log(
      `${failures.length} of ${rows.length} package version(s) are not accounted for: ` +
        `${failures.join(", ")}. Refusing to report success.`,
    );
    return { code: 1, rows };
  }
  const created = rows.filter((row) => row.outcome === "created").map((row) => row.tag);
  if (created.length > 0) {
    log(
      `Tagged and released ${created.length} version(s) the bumped-package step did not: ${created.join(", ")}.`,
    );
  }
  log(
    `Every package version on npm has its tag and GitHub release (${rows.length} package(s) ` +
      `checked, ${created.length} created).`,
  );
  return { code: 0, rows };
}

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {object} The parsed options.
 */
function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "reconcile") {
    throw new InvocationError(
      `unknown subcommand ${JSON.stringify(subcommand ?? "")}. Expected \`reconcile\`.`,
    );
  }
  const options = { presence: {} };
  const numbers = {
    "--budget-seconds": "budgetSeconds",
    "--probe-interval-seconds": "intervalSeconds",
  };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined || value === "") throw new InvocationError(`${flag} needs a value`);
    i += 1;
    if (flag === "--repo") options.repo = resolve(value);
    else if (flag === "--target") options.target = value;
    else if (flag === "--notes-dir") options.notesDir = resolve(value);
    else if (numbers[flag] !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new InvocationError(`${flag} must be a positive number of seconds, not ${value}`);
      }
      options.presence[numbers[flag]] = parsed;
    } else throw new InvocationError(`unknown argument ${JSON.stringify(flag)}`);
  }
  for (const required of ["repo", "target", "notesDir"]) {
    if (options[required] === undefined) {
      throw new InvocationError(
        `reconcile needs --${required === "notesDir" ? "notes-dir" : required}`,
      );
    }
  }
  return options;
}

/**
 * @param {string[]} argv Arguments after the script name.
 * @param {{ env?: object, log?: Function, github?: object }} [io] Injection points for a test.
 * @returns {Promise<number>} The process exit code.
 */
export async function main(argv, { env = process.env, log, github } = {}) {
  const options = parseArgs(argv);
  const packages = workspacePackages(options.repo);
  const result = await reconcile({
    packages,
    target: options.target,
    notesDir: options.notesDir,
    github: github ?? ghGitHub({ repo: env.GITHUB_REPOSITORY, env }),
    presence: { ...options.presence, env },
    log,
  });
  return result.code;
}

if (isCliEntrypoint(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof InvocationError) {
        process.stderr.write(`ERROR: release-tags could not run: ${error.message}\n`);
        process.exit(2);
      }
      throw error;
    });
}
