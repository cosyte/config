// @cosyte/script-utils/release-pr
//
// THE RELEASE PULL REQUEST CHECK: a library's "Version Packages" pull request must pass its own
// checks, and a changeset must not wedge the release that consumes it.
//
// Three defects reached our libraries' release pull requests, each after the change that caused it
// had merged green, and each was fixed by hand in its own repository:
//
//   version-test      The mutation run on a Version Packages pull request mutates the exported
//                     `VERSION` string, and no test it links to that line pinned it to package.json.
//                     `VERSION` is set once, when its module is first evaluated, and the mutation run
//                     links a mutant only to the tests that run while its line is evaluated. A test
//                     file with a static import of the source evaluates it before any test starts, so
//                     the mutant survives however exactly a test compares it. What works: a test file
//                     with no static import of the source, that resets the module cache
//                     (`vi.resetModules()`) and then imports the source inside the test body, and
//                     compares `VERSION` with package.json's version.
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
// And one rule beside the last: `changeset-shape`, a changeset with no front matter block, or one
// that releases a package and says nothing, which the release workflow also refuses.
//
// THE BULLET IS MEASURED AS AN UPPER BOUND. The release workflow measures the sentence after its own
// rewrites: it removes internal references (which only shortens it), turns an em dash into ": " or
// ", " (at most one character more each) and our word "slice" into "change" (one more each). So the
// bound here is the sentence's length plus one for each em dash and each "slice" or "slices". A
// sentence this passes, the release passes on length; the release can pass a few this refuses, and
// those carry an internal reference a public changeset should not carry anyway.
//
// WHAT IT DOES NOT DO. It reads text, so it cannot tell that a test it accepts runs, or that its
// assertion is right: the test's own run does that. It does not read the release workflow's other
// refusals (internal identifiers, phase language), and it does not check the API reference itself:
// `cosyte-docs-reference --check` does.
//
// EXIT CODES, the contract every gate here keeps: 0 clean, 1 at least one finding, 2 the check could
// not read its input (no package.json, an unreadable file, an argument it does not know).
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package. The command line is the bin
// `cosyte-release-pr`.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

/** The longest release bullet the shared release workflow publishes, in characters. */
export const RELEASE_BULLET_LIMIT = 400;

/** Every rule id, with what it requires. */
export const RELEASE_PR_RULES = Object.freeze({
  "version-script":
    "the version script runs `changeset version`, then the VERSION sync, then `cosyte-docs-reference`",
  "version-test":
    "a test file with no static import of the source resets the module cache, imports the source " +
    "in its body and compares VERSION with package.json",
  "changeset-bullet": `a changeset opens with a sentence of at most ${RELEASE_BULLET_LIMIT} characters`,
  "changeset-shape":
    "a changeset has a front matter block, and a summary when it releases a package",
});

const EM_DASH = String.fromCodePoint(0x2014);

/** The folders tests are read from, relative to the package root. */
const TEST_DIRS = ["test", "src"];

/** A test file: `*.test.*` or `*.spec.*`, in TypeScript or JavaScript. */
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
    (s) => /^cosyte-docs-reference(?:\s|$)/.test(s) && !/\s--check(?:\s|$)/.test(s),
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
 * Whether an import specifier, written in the file at `path`, points at the source folder.
 *
 * @param {string} path The importing file, relative to the package root, with `/` separators.
 * @param {string} specifier The specifier.
 * @returns {boolean}
 */
function intoSource(path, specifier) {
  if (!specifier.startsWith(".")) return false;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return target === "src" || target.startsWith("src/");
}

/** A static import or re-export at the start of a line, with the specifier it names. */
const STATIC_IMPORTS = [
  /^[ \t]*import\s+(?=\S)(?!type\s)[^;]*?\bfrom\s*(["'])([^"'\n]+)\1/gm,
  /^[ \t]*import\s*(["'])([^"'\n]+)\1/gm,
  /^[ \t]*export\s[^;]*?\bfrom\s*(["'])([^"'\n]+)\1/gm,
];

/** A dynamic import with a literal specifier. */
const DYNAMIC_IMPORT = /\bimport\(\s*(["'`])([^"'`\n]+)\1\s*\)/g;

/**
 * What one test file lacks to pin VERSION through a fresh import. Empty when it does.
 *
 * @param {string} path The test file, relative to the package root, with `/` separators.
 * @param {string} text Its text.
 * @returns {string[]} One sentence per gap.
 */
export function freshVersionTestGaps(path, text) {
  const source = String(text);
  const gaps = [];
  if (!/\bVERSION\b/.test(source)) gaps.push("it never reads VERSION");
  if (!source.includes("package.json")) gaps.push("it never reads package.json");
  const staticSource = STATIC_IMPORTS.some((pattern) =>
    [...source.matchAll(pattern)].some((m) => intoSource(path, m[2])),
  );
  if (staticSource) {
    gaps.push(
      "it imports the source statically, so the module is evaluated before any test runs and the " +
        "mutation run links the VERSION line to no test",
    );
  }
  const dynamic = [...source.matchAll(DYNAMIC_IMPORT)].find((m) => intoSource(path, m[2]));
  if (dynamic === undefined) {
    gaps.push('it has no dynamic import of the source, `await import("../src/index.js")`');
  } else {
    const reset = source.indexOf("resetModules(");
    if (reset < 0 || reset > dynamic.index) {
      gaps.push("it does not call `vi.resetModules()` before its dynamic import of the source");
    }
  }
  return gaps;
}

/**
 * The `version-test` rule over a package's test files: at least one must pin VERSION through a
 * fresh import.
 *
 * @param {Array<{path: string, text: string}>} tests The test files.
 * @returns {Array<{rule: string, file: string, message: string}>} No finding, or one.
 */
export function checkVersionTests(tests) {
  const readers = [];
  for (const test of tests) {
    const gaps = freshVersionTestGaps(test.path, test.text);
    if (gaps.length === 0) return [];
    if (/\bVERSION\b/.test(test.text)) readers.push(`${test.path}: ${gaps.join("; ")}`);
  }
  const named =
    readers.length === 0
      ? "No test file reads VERSION."
      : `The test files that read VERSION, and what each lacks:\n    ${readers.join("\n    ")}`;
  return [
    finding(
      "version-test",
      "test/",
      "no test pins VERSION to package.json where the mutation run can link it, so the mutant " +
        "that changes VERSION survives on the Version Packages pull request. Add a test file with " +
        "no static import of the source that calls `vi.resetModules()`, then imports the source " +
        `inside the test body and compares VERSION with package.json's version. ${named}`,
    ),
  ];
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
 * for each em dash and each "slice" or "slices", the rewrites that lengthen it.
 *
 * @param {string} sentence The opening sentence.
 * @returns {number}
 */
export function bulletLengthBound(sentence) {
  const text = String(sentence);
  const dashes = text.split(EM_DASH).length - 1;
  const slices = (text.match(/\bslices?\b/gi) ?? []).length;
  return text.length + dashes + slices;
}

/**
 * The `changeset-bullet` and `changeset-shape` rules over one changeset.
 *
 * @param {string} path The changeset, relative to the package root.
 * @param {string} text Its text.
 * @returns {Array<{rule: string, file: string, message: string}>}
 */
export function checkChangeset(path, text) {
  const normalized = String(text).replace(/\r\n/g, "\n");
  const front = /^---\n(?:([\s\S]*?)\n)?---(?:\n|$)/.exec(normalized);
  if (front === null) {
    return [
      finding(
        "changeset-shape",
        path,
        "no front matter block (`---` lines naming each package and its bump), so it is not a " +
          "changeset the release can read.",
      ),
    ];
  }
  const releases = (front[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
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
 *   tests: Array<{path: string, text: string}>, changesets: Array<{path: string, text: string}>}} input
 * @returns {Array<{rule: string, file: string, message: string}>}
 */
export function checkReleasePr(input) {
  const found = [];
  if (input.declaresVersion) {
    found.push(...checkVersionScript(input.scripts), ...checkVersionTests(input.tests));
  }
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
 * VERSION, its test files and its pending changesets.
 *
 * @param {string} root The package root.
 * @returns {{scripts: Record<string, unknown>, declaresVersion: boolean,
 *   tests: Array<{path: string, text: string}>, changesets: Array<{path: string, text: string}>}}
 * @throws {Error} When package.json cannot be read or parsed, or a file cannot be read.
 */
export function readReleasePrInput(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const read = (path) => ({ path, text: readFileSync(join(root, path), "utf8") });
  const sources = filesUnder(root, "src", SOURCE_FILE).filter(
    (p) => !TEST_FILE.test(p) && !/\.d\.[cm]?ts$/.test(p),
  );
  const tests = TEST_DIRS.flatMap((dir) => filesUnder(root, dir, TEST_FILE)).map(read);
  const changesets = filesUnder(root, ".changeset", /\.md$/)
    .filter((p) => p !== ".changeset/README.md")
    .map(read);
  return {
    scripts: manifest?.scripts ?? {},
    declaresVersion: sources.some((p) => declaresVersion(read(p).text)),
    tests: tests.sort((a, b) => a.path.localeCompare(b.path)),
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
    ? "the version script and a fresh-import VERSION test are in place"
    : "the package exports no VERSION under src/, so the version rules do not apply";
  stdout.write(
    `release-pr: OK, ${version}; ${input.changesets.length} changeset(s) open within ` +
      `${RELEASE_BULLET_LIMIT} characters.\n`,
  );
  return 0;
}
