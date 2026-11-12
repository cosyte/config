// @cosyte/script-utils/release-pr
//
// THE RELEASE PULL REQUEST CHECK: a library's "Version Packages" pull request must pass its own
// checks, and a changeset must not wedge the release that consumes it.
//
// Two defects reached our libraries' release pull requests, each after the change that caused it
// had merged green, and each was fixed by hand in its own repository:
//
//   version-script    The version script did not regenerate the generated API reference, which prints
//                     `VERSION`, so the Version Packages pull request failed the reference's own
//                     drift check. The script runs `changeset version`, then the `VERSION` sync, then
//                     `cosyte-docs-reference`, in that order.
//   changeset-bullet  A changeset's opening sentence becomes one bullet of the GitHub release, and
//                     the shared release workflow refuses a bullet over 400 characters. It refuses it
//                     at release time, after the Version Packages pull request has merged and
//                     consumed the changeset, so recovery is a revert. This reads the pending
//                     changesets on the pull request that adds them, before they can merge.
//
// And one rule beside the last: `changeset-shape`, a changeset the release workflow cannot read once
// the Version Packages pull request has consumed it: no front matter block, an empty one (the file
// `changeset add --empty` writes, `---` then `---`), a front matter line that names no package and
// bump, or a release with no summary. The front matter is read with the release tooling's own pattern.
//
// THE BULLET IS MEASURED AS AN UPPER BOUND, conservatively, not by repeating the release's rewrites.
// The release workflow measures the sentence after them. Removing an internal reference only
// shortens it. Three rewrites can lengthen it: an em dash becomes ": " or ", " (one more each), our
// word "slice" becomes "change" (one more each), and a parenthetical holding an internal reference is
// rebuilt as ` (a, b)`, with a space before it where there was none (one more per parenthetical) and
// ", " where the author wrote a bare comma (one more per comma inside it). So the bound is the
// sentence's length plus one for each em dash, each "slice" (inside a word too), each innermost
// parenthetical and each comma inside one. A sentence this passes, the release passes on length; the
// release can pass a few this refuses, and those carry commas in parentheses or an internal reference
// that a few characters less would fit.
//
// WHAT IT DOES NOT DO. It reads text. It does not read the release workflow's other refusals
// (internal identifiers, phase language), it does not check the API reference itself
// (`cosyte-docs-reference --check` does), and it does not check the test that pins `VERSION` to
// package.json: a release pull request's mutation job is what proves that test today.
//
// EXIT CODES, the contract every gate here keeps: 0 clean, 1 at least one finding, 2 the check could
// not read its input (no package.json, an unreadable file, an argument it does not know).
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package. The command line is the bin
// `cosyte-release-pr`.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The longest release bullet the shared release workflow publishes, in characters. */
export const RELEASE_BULLET_LIMIT = 400;

/** Every rule id, with what it requires. */
export const RELEASE_PR_RULES = Object.freeze({
  "version-script":
    "the version script runs `changeset version`, then the VERSION sync, then `cosyte-docs-reference`",
  "changeset-bullet": `a changeset opens with a sentence of at most ${RELEASE_BULLET_LIMIT} characters`,
  "changeset-shape":
    "a changeset has a front matter block that is not empty, names a package and bump on each line, " +
    "and has a summary when it releases a package",
});

const EM_DASH = String.fromCodePoint(0x2014);

/** A test file: `*.test.*` or `*.spec.*`, in TypeScript or JavaScript: never a source file. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;

/** A source file under `src/`: TypeScript or JavaScript, not a declaration file. */
const SOURCE_FILE = /\.[cm]?[jt]s$/;

/**
 * One finding.
 *
 * @param {keyof typeof RELEASE_PR_RULES} rule
 * @param {string} file
 * @param {string} message
 */
function finding(rule, file, message) {
  return { rule, file, message };
}

/**
 * The steps of a package script, split on `&&`, with a step that runs another script of the same
 * package (`pnpm <name>`, `pnpm run <name>`, `npm run <name>`) replaced by that script's steps.
 *
 * @param {string} body The script.
 * @param {Record<string, unknown>} scripts The package's scripts.
 * @param {Set<string>} [seen] Scripts already being expanded, so a cycle stops.
 * @returns {string[]} The steps, trimmed, empty ones left out.
 */
export function scriptSteps(body, scripts, seen = new Set()) {
  const steps = [];
  for (const raw of String(body).split("&&")) {
    const step = raw.trim();
    if (step === "") continue;
    const call = /^(?:pnpm(?: run)?|npm run) (\S+)$/.exec(step);
    const name = call?.[1];
    if (name !== undefined && typeof scripts[name] === "string" && !seen.has(name)) {
      steps.push(...scriptSteps(scripts[name], scripts, new Set([...seen, name])));
    } else {
      steps.push(step);
    }
  }
  return steps;
}

/**
 * The `version-script` rule over a package's scripts.
 *
 * @param {Record<string, unknown>} scripts The package's scripts.
 * @returns {Array<{rule: string, file: string, message: string}>} One finding per gap.
 */
export function checkVersionScript(scripts) {
  const body = scripts.version;
  if (typeof body !== "string") {
    return [
      finding(
        "version-script",
        "package.json",
        'no "version" script. The release workflow runs it to make the Version Packages pull ' +
          `request; it must run ${RELEASE_PR_RULES["version-script"]}.`,
      ),
    ];
  }
  const steps = scriptSteps(body, scripts);
  const bump = steps.findIndex((s) => /^changeset version(?:\s|$)/.test(s));
  const sync = steps.findIndex((s) => /sync-version/.test(s));
  const docs = steps.findIndex(
    (s) => /^cosyte-docs-reference(?:\s|$)/.test(s) && !/\s--check(?:[=\s]|$)/.test(s),
  );
  const found = [];
  const say = (message) => found.push(finding("version-script", "package.json", message));
  if (bump < 0) say("the version script never runs `changeset version`, which bumps the version.");
  if (sync < 0) {
    say(
      "the version script never syncs VERSION from package.json (`cosyte-process sync-version`), " +
        "so the Version Packages pull request ships a VERSION that names the old release.",
    );
  } else if (bump >= 0 && sync < bump) {
    say("the version script syncs VERSION before `changeset version` has bumped package.json.");
  }
  if (docs < 0) {
    say(
      "the version script never regenerates the API reference (`cosyte-docs-reference`, without " +
        "--check), so the reference page that prints VERSION is stale on the Version Packages " +
        "pull request.",
    );
  } else if (sync >= 0 && docs < sync) {
    say("the version script regenerates the API reference before VERSION is synced; run it after.");
  }
  return found;
}

/**
 * Whether a module's text declares an exported `VERSION` constant at the start of a line.
 *
 * @param {string} text The module's text.
 * @returns {boolean}
 */
export function declaresVersion(text) {
  return /^export const VERSION\b/m.test(String(text));
}

/**
 * The first sentence of a changeset's summary, flattened to one line: the text the release workflow
 * makes a bullet of. The same reading as the release workflow's own, so the two agree on where the
 * sentence ends.
 *
 * @param {string} summary The changeset's text after its front matter.
 * @returns {string}
 */
export function openingSentence(summary) {
  let t = String(summary).trim().split(/\s+/).join(" ");
  t = t.replace(/^\*\*(.+?)\*\*[.:]?\s*/, "$1. ");
  const sentence = /^(.+?[.!?]\*{0,2})(\s|$)/.exec(t);
  const kept = (sentence ? sentence[1] : t).trim();
  // The trailing full stops come off by a scan, not by `/\.+$/`, which backtracks on a long run of
  // full stops that does not end the text.
  let end = kept.length;
  while (end > 0 && kept[end - 1] === ".") end -= 1;
  return kept.slice(0, end);
}

/**
 * The most characters the release workflow's bullet for this sentence can have: its length, plus one
 * for each em dash, each "slice" or "slices" (inside a longer word too), each innermost parenthetical
 * and each comma inside one, the rewrites that lengthen it.
 *
 * @param {string} sentence The opening sentence.
 * @returns {number}
 */
export function bulletLengthBound(sentence) {
  const text = String(sentence);
  const dashes = text.split(EM_DASH).length - 1;
  const slices = (text.match(/slices?\b/gi) ?? []).length;
  let parentheticals = 0;
  // The release's own pattern for a parenthetical: an innermost one, with no parenthesis inside.
  for (const m of text.matchAll(/\(([^()]*)\)/g)) parentheticals += 1 + m[1].split(",").length - 1;
  return text.length + dashes + slices + parentheticals;
}

/** A front matter line the release reads: a package name, a colon and a bump, either quoted. */
const RELEASE_LINE = /^["']?(@?[^"':]+)["']?\s*:\s*["']?([A-Za-z]+)["']?$/;

/**
 * The `changeset-bullet` and `changeset-shape` rules over one changeset.
 *
 * @param {string} path The changeset, relative to the package root.
 * @param {string} text Its text.
 * @returns {Array<{rule: string, file: string, message: string}>}
 */
export function checkChangeset(path, text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const shape = (message) => [finding("changeset-shape", path, message)];
  // The release tooling's own pattern, so the two agree on what a front matter block is.
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (front === null) {
    if (/^---\n---(?:\n|$)/.test(normalized)) {
      return shape(
        "its front matter block is empty (`---` then `---`, the file `changeset add --empty` " +
          "writes), and the release refuses it once the Version Packages pull request has consumed " +
          "it. A change that releases no package gets no changeset at all; a repository-level note " +
          "goes in the root CHANGELOG.md.",
      );
    }
    return shape(
      "no front matter block (`---` lines naming each package and its bump), so it is not a " +
        "changeset the release can read.",
    );
  }
  const releases = front[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  for (const line of releases) {
    const entry = RELEASE_LINE.exec(line);
    if (entry === null) {
      return shape(
        `the front matter line ${JSON.stringify(line)} is not a package and its bump ` +
          '(`"@cosyte/<package>": patch`), and the release refuses it.',
      );
    }
    if (!["major", "minor", "patch"].includes(entry[2].toLowerCase())) {
      return shape(
        `the bump ${JSON.stringify(entry[2])} is not major, minor or patch, and the release ` +
          "refuses it.",
      );
    }
  }
  if (releases.length === 0) return [];
  const summary = normalized.slice(front[0].length).trim();
  if (summary === "") {
    return [
      finding(
        "changeset-shape",
        path,
        "it releases a package and its summary is empty, and the release refuses a change it " +
          "cannot describe.",
      ),
    ];
  }
  const bound = bulletLengthBound(openingSentence(summary));
  if (bound <= RELEASE_BULLET_LIMIT) return [];
  return [
    finding(
      "changeset-bullet",
      path,
      `its opening sentence becomes a release bullet of up to ${bound} characters, and the release ` +
        `refuses a bullet over ${RELEASE_BULLET_LIMIT}, so it is ${bound - RELEASE_BULLET_LIMIT} ` +
        "over. It refuses it after the Version Packages pull request has merged, when the fix is a " +
        `revert. Open the changeset with a sentence of at most ${RELEASE_BULLET_LIMIT} characters ` +
        "saying what changed for a reader, and move the detail into the paragraphs after it.",
    ),
  ];
}

/**
 * Every rule over a package's input.
 *
 * @param {{scripts: Record<string, unknown>, declaresVersion: boolean,
 *   changesets: Array<{path: string, text: string}>}} input
 * @returns {Array<{rule: string, file: string, message: string}>}
 */
export function checkReleasePr(input) {
  const found = [];
  if (input.declaresVersion) found.push(...checkVersionScript(input.scripts));
  for (const c of input.changesets) found.push(...checkChangeset(c.path, c.text));
  return found;
}

/**
 * Every file under a folder whose name matches, as package-relative paths with `/` separators,
 * sorted. A missing folder is empty; `node_modules` and symbolic links are not followed.
 *
 * @param {string} root The package root.
 * @param {string} rel The folder, relative to it.
 * @param {RegExp} pattern Which file names to keep.
 * @returns {string[]}
 */
function filesUnder(root, rel, pattern) {
  let stat;
  try {
    stat = lstatSync(join(root, rel));
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = `${rel}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      out.push(...filesUnder(root, path, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      out.push(path);
    }
  }
  return out.sort();
}

/**
 * Read what the check needs from a package root: its scripts, whether `src/` declares an exported
 * VERSION, and its pending changesets.
 *
 * @param {string} root The package root.
 * @returns {{scripts: Record<string, unknown>, declaresVersion: boolean,
 *   changesets: Array<{path: string, text: string}>}}
 * @throws {Error} When package.json cannot be read or parsed, or a file cannot be read.
 */
export function readReleasePrInput(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const read = (path) => ({ path, text: readFileSync(join(root, path), "utf8") });
  const sources = filesUnder(root, "src", SOURCE_FILE).filter(
    (p) => !TEST_FILE.test(p) && !/\.d\.[cm]?ts$/.test(p),
  );
  const changesets = filesUnder(root, ".changeset", /\.md$/)
    .filter((p) => p !== ".changeset/README.md")
    .map(read);
  return {
    scripts: manifest?.scripts ?? {},
    declaresVersion: sources.some((p) => declaresVersion(read(p).text)),
    changesets,
  };
}

/**
 * Run the check from the command line: `--dir <package root>`, the working directory by default.
 *
 * @param {{argv?: string[], dir?: string, stdout?: {write: (s: string) => unknown},
 *   stderr?: {write: (s: string) => unknown}}} [options]
 * @returns {number} The exit code: 0 clean, 1 a finding, 2 could not read its input.
 */
export function runReleasePrCheck(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let dir = options.dir ?? process.cwd();
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] !== "--") {
      stderr.write(
        `release-pr: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          "--dir <package root>). Nothing was checked.\n",
      );
      return 2;
    }
  }
  let input;
  try {
    input = readReleasePrInput(resolve(dir));
  } catch (error) {
    stderr.write(
      `release-pr: could not read the package in ${dir}: ${error.message} Nothing was checked.\n`,
    );
    return 2;
  }
  const found = checkReleasePr(input);
  if (found.length > 0) {
    const report = found.map((f) => `  ${f.file} [${f.rule}] ${f.message}`).join("\n");
    stderr.write(
      `release-pr: a release pull request made from this tree would fail.\n${report}\n` +
        `${found.length} finding(s). The rules are in the @cosyte/script-utils README, ` +
        '"The release pull request check".\n',
    );
    return 1;
  }
  const version = input.declaresVersion
    ? "the version script is in place"
    : "the package exports no VERSION under src/, so the version rule does not apply";
  stdout.write(
    `release-pr: OK, ${version}; ${input.changesets.length} changeset(s) open within ` +
      `${RELEASE_BULLET_LIMIT} characters.\n`,
  );
  return 0;
}
