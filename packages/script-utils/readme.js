// @cosyte/script-utils/readme
//
// THE README GATE FOR EVERY `@cosyte/*` LIBRARY: the house skeleton, and a size limit under npm's.
//
// A library's README ships inside its npm tarball, and the registry keeps only the first 65,536
// characters of it: past that, npmjs.com renders a README cut off mid-sentence, and nothing says so.
// This gate refuses a README longer than 60,000 characters, which leaves a release room to grow
// before npm cuts it, and checks the skeleton every library README shares, so a reader arriving from
// npm, GitHub or the docs site finds the same page in the same order.
//
// THE SKELETON, top to bottom. Each item is one rule id, and each id is what a finding names:
//
//   tile           the shared lockup tile in a <picture> element, byte for byte (`TILE`)
//   tile-alt       the tile's alt text is the one assets `alt-text.json` declares for it
//   title          `# <package name>` after the tile
//   tagline        one blockquote line after the title, at most `TAGLINE_LIMIT` characters
//   badges         the badge row this file defines (`badgeRow`): npm version, CI, license, Node
//   section-*      the `##` sections in `REQUIRED_SECTIONS`, present, in order, and not empty
//   docs-link      a link to the package's page on docs.cosyte.com, after `## Usage` begins and
//                  before `## Support`
//   license-last   `## License` is the last heading
//   license-link   the License section links the repository's LICENSE by absolute URL, because a
//                  relative link resolves on GitHub and breaks on npm
//   size           at most `README_CHARACTER_LIMIT` characters
//
// Other sections may sit between the required ones; what is graded is that the required ones are
// there, in this order, and that License closes the file.
//
// WHAT IS DERIVED, AND FROM WHERE. Everything package-specific comes from the package's own
// `package.json`: the name (the title, the npm badge and the docs slug), the repository (the CI and
// license URLs) and `engines.node` (the Node badge). Nothing is configured, so there is no setting
// that switches a rule off. A manifest that cannot supply one of those is a refusal (exit 2), not a
// finding, because the gate could not work out what the README should say.
//
// EXIT CODES, the contract every gate here keeps: 0 the README follows the skeleton, 1 at least one
// finding, 2 the gate could not read its input (no README, no package.json, an unusable manifest, an
// argument it does not know).
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package, so a gate that runs before
// `pnpm install` can import this file by relative path.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCliEntrypoint } from "./index.js";

/**
 * The tile's alt text, as assets `alt-text.json` declares it for
 * `tile/cosyte-lockup-tile-on-light-1200x300.png`, the image the `<img>` element carries.
 */
export const TILE_ALT = "The Cosyte logo on its own white ground: the icon beside the word Cosyte.";

/**
 * The shared lockup tile, which opens every library README. The URLs are absolute because npm does
 * not resolve relative images, and the `<img>` fallback carries the light tile, so a renderer that
 * drops `<source>` still shows one.
 */
export const TILE = [
  '<a href="https://cosyte.com">',
  "  <picture>",
  '    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">',
  `    <img alt="${TILE_ALT}" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">`,
  "  </picture>",
  "</a>",
].join("\n");

/** npm's own cut: the registry keeps this many characters of a README. */
export const NPM_README_LIMIT = 65_536;

/**
 * This gate's limit, in characters as JavaScript counts them (UTF-16 code units, which is never
 * fewer than the code points npm counts). Well under npm's cut, so a README that passes here still
 * has room for a release's additions before npm truncates it.
 */
export const README_CHARACTER_LIMIT = 60_000;

/** A tagline is one line a reader takes in at a glance. */
export const TAGLINE_LIMIT = 120;

/** The `##` sections every library README carries, in this order, with License last. */
export const REQUIRED_SECTIONS = Object.freeze([
  "Why this exists",
  "Status",
  "Install",
  "Usage",
  "Support",
  "Security",
  "Contributing",
  "License",
]);

/** Every rule id a finding can carry, with what it requires. */
export const README_RULES = Object.freeze({
  tile: "The README opens with the shared lockup tile, byte for byte.",
  "tile-alt": `The tile's alt text is "${TILE_ALT}".`,
  title: "The tile is followed by `# <package name>`.",
  tagline: `The title is followed by a one-line blockquote tagline of at most ${TAGLINE_LIMIT} characters.`,
  badges:
    "The tagline is followed by the badge row: npm version, CI, license and Node, in that order.",
  "section-missing": `Every required section is present: ${REQUIRED_SECTIONS.join(", ")}.`,
  "section-order": "The required sections appear in that order.",
  "section-empty": "No required section is empty.",
  "docs-link":
    "A link to the package's page on docs.cosyte.com sits after `## Usage` begins and before `## Support`.",
  "license-last": "`## License` is the last heading.",
  "license-link": "The License section links the repository's LICENSE by its absolute GitHub URL.",
  size: `The README is at most ${README_CHARACTER_LIMIT.toLocaleString("en-US")} characters.`,
});

/** The facts the skeleton is derived from, read out of a package.json. */
function packageFacts(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("package.json is not a JSON object.");
  }
  const name = manifest.name;
  const scoped = typeof name === "string" ? /^@cosyte\/([a-z0-9][a-z0-9.-]*)$/.exec(name) : null;
  if (scoped === null) {
    throw new TypeError(
      `package.json names ${JSON.stringify(name)}, not a @cosyte/<name> package, so the title, the ` +
        `npm badge and the docs link cannot be derived.`,
    );
  }
  const repositoryUrl =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  const repo =
    typeof repositoryUrl === "string"
      ? /github\.com[/:]cosyte\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(repositoryUrl)
      : null;
  if (repo === null) {
    throw new TypeError(
      `package.json's repository (${JSON.stringify(repositoryUrl ?? null)}) is not a ` +
        `github.com/cosyte/<repo> URL, so the CI and license links cannot be derived.`,
    );
  }
  const node = manifest.engines?.node;
  if (typeof node !== "string" || node.trim() === "") {
    throw new TypeError(
      "package.json declares no engines.node, so the Node badge cannot be derived.",
    );
  }
  return { name, slug: scoped[1], repo: repo[1], node: node.trim() };
}

/** Escape a value for a shields.io static badge path segment: `-` and `_` double, then encode. */
function shieldsText(value) {
  return encodeURIComponent(value.replace(/-/g, "--").replace(/_/g, "__"));
}

/**
 * The badge row a library README carries, one badge per line, derived from its package.json.
 *
 * @param {Record<string, unknown>} manifest The parsed package.json.
 * @returns {string[]} The four badge lines, in order.
 */
export function badgeRow(manifest) {
  const { name, repo, node } = packageFacts(manifest);
  const github = `https://github.com/cosyte/${repo}`;
  return [
    `[![npm version](https://img.shields.io/npm/v/${name}.svg)](https://www.npmjs.com/package/${name})`,
    `[![CI](https://img.shields.io/github/actions/workflow/status/cosyte/${repo}/ci.yml?branch=main&label=CI)](${github}/actions/workflows/ci.yml)`,
    `[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](${github}/blob/main/LICENSE)`,
    `[![Node](https://img.shields.io/badge/node-${shieldsText(node)}-brightgreen.svg)](https://nodejs.org)`,
  ];
}

/** The absolute LICENSE URL the License section links. */
function licenseUrl(repo) {
  return `https://github.com/cosyte/${repo}/blob/main/LICENSE`;
}

/** The headings of a Markdown document, skipping fenced code blocks. Lines are 0-based. */
function headingsOf(lines) {
  const headings = [];
  let fence = null;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      fence = marker[1];
      return;
    }
    const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (heading) headings.push({ level: heading[1].length, text: heading[2], line: index });
  });
  return headings;
}

/** The index of the first non-blank line at or after `from`, or `lines.length`. */
function nextContent(lines, from) {
  let i = from;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  return i;
}

/**
 * Check a library README against the house skeleton.
 *
 * @param {string} text The README's contents.
 * @param {Record<string, unknown>} manifest The package's parsed package.json.
 * @returns {{ rule: string, line: number, message: string }[]} The findings, in document order
 *   within each rule; empty when the README follows the skeleton. `line` is 1-based, 0 for the
 *   whole file.
 * @throws {TypeError} When the manifest cannot supply what the skeleton is derived from.
 */
export function checkReadme(text, manifest) {
  if (typeof text !== "string")
    throw new TypeError("checkReadme(text, manifest) expects a string.");
  const facts = packageFacts(manifest);
  const findings = [];
  const add = (rule, line, message) => findings.push({ rule, line, message });
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));

  // ---- The head: tile, title, tagline, badges ----------------------------------------------
  const tileLines = TILE.split("\n");
  const head = lines.slice(0, tileLines.length);
  let cursor = 0;
  if (head.join("\n") === TILE) {
    cursor = tileLines.length;
  } else {
    const alt = /<img\b[^>]*\balt="([^"]*)"/.exec(head.join("\n"));
    const withDeclaredAlt = head
      .join("\n")
      .replace(/(<img\b[^>]*\balt=")[^"]*(")/, `$1${TILE_ALT}$2`);
    if (alt !== null && withDeclaredAlt === TILE) {
      add(
        "tile-alt",
        1 + head.findIndex((line) => line.includes("<img")),
        `the tile's alt text is "${alt[1]}"; it must be the declared "${TILE_ALT}" ` +
          `(assets alt-text.json, tile/cosyte-lockup-tile-on-light-1200x300.png).`,
      );
      cursor = tileLines.length;
    } else {
      add(
        "tile",
        1,
        `the README must open with the shared lockup tile, starting:\n${tileLines[0]}`,
      );
      // Without the tile, the rest of the head is read from the first heading, so one missing
      // block is one finding rather than four.
      const firstHeading = lines.findIndex((line) => /^#\s/.test(line));
      cursor = firstHeading < 0 ? lines.length : firstHeading;
    }
  }

  cursor = nextContent(lines, cursor);
  const title = `# ${facts.name}`;
  if (lines[cursor] !== title) {
    add("title", cursor + 1, `the tile must be followed by the title "${title}".`);
  }
  // A wrong H1 is still the title line: step over it, so the tagline is read from where it is.
  if (/^#\s/.test(lines[cursor] ?? "")) cursor += 1;

  cursor = nextContent(lines, cursor);
  const tagline = /^> (\S.*)$/.exec(lines[cursor] ?? "");
  if (tagline === null) {
    add("tagline", cursor + 1, "the title must be followed by a one-line tagline: `> <tagline>`.");
  } else {
    if ((lines[cursor + 1] ?? "").trim() !== "") {
      add(
        "tagline",
        cursor + 2,
        "the tagline is one line, followed by a blank line; this one continues onto the next.",
      );
    }
    if (tagline[1].length > TAGLINE_LIMIT) {
      add(
        "tagline",
        cursor + 1,
        `the tagline is ${tagline[1].length} characters; the limit is ${TAGLINE_LIMIT}.`,
      );
    }
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim() !== "") cursor += 1;
  }

  cursor = nextContent(lines, cursor);
  const badges = badgeRow(manifest);
  const badgeNames = ["npm version", "CI", "license", "Node"];
  for (const [offset, expected] of badges.entries()) {
    if (lines[cursor + offset] !== expected) {
      add(
        "badges",
        cursor + offset + 1,
        `line ${cursor + offset + 1} must be the ${badgeNames[offset]} badge:\n${expected}`,
      );
      break;
    }
  }
  if (
    findings.every((f) => f.rule !== "badges") &&
    (lines[cursor + badges.length] ?? "").trim() !== ""
  ) {
    add(
      "badges",
      cursor + badges.length + 1,
      "the badge row is the four badges and nothing else; follow it with a blank line.",
    );
  }

  // ---- The sections --------------------------------------------------------------------------
  const headings = headingsOf(lines);
  const sections = headings.filter((h) => h.level === 2);
  const position = new Map();
  for (const name of REQUIRED_SECTIONS) {
    const found = sections.find((h) => h.text === name);
    if (found === undefined) {
      add("section-missing", 0, `the required section "## ${name}" is missing.`);
    } else {
      position.set(name, found);
    }
  }
  const present = REQUIRED_SECTIONS.filter((name) => position.has(name));
  for (let i = 1; i < present.length; i += 1) {
    const before = position.get(present[i - 1]);
    const after = position.get(present[i]);
    if (after.line < before.line) {
      add(
        "section-order",
        after.line + 1,
        `"## ${present[i]}" must come after "## ${present[i - 1]}" (the order is ` +
          `${REQUIRED_SECTIONS.join(", ")}).`,
      );
      break;
    }
  }
  for (const [name, heading] of position) {
    const next = headings.find((h) => h.line > heading.line && h.level <= 2);
    const body = lines.slice(heading.line + 1, next === undefined ? lines.length : next.line);
    if (body.every((line) => line.trim() === "")) {
      add("section-empty", heading.line + 1, `the section "## ${name}" is empty.`);
    }
  }

  // ---- License last, and linked absolutely --------------------------------------------------
  // A `###` inside the License section belongs to it, so "last" is read over `#` and `##` only.
  const outer = headings.filter((h) => h.level <= 2);
  const lastHeading = outer[outer.length - 1];
  const license = position.get("License");
  if (license !== undefined && lastHeading !== license) {
    add(
      "license-last",
      lastHeading.line + 1,
      `"## License" must be the last heading; "${"#".repeat(lastHeading.level)} ${lastHeading.text}" follows it.`,
    );
  }
  if (license !== undefined) {
    const url = licenseUrl(facts.repo);
    const next = headings.find((h) => h.line > license.line && h.level <= 2);
    const body = lines.slice(license.line + 1, next === undefined ? lines.length : next.line);
    const linked = body.some((line) => line.includes(`](${url})`) || line.includes(`](${url} `));
    if (!linked) {
      add(
        "license-link",
        license.line + 1,
        `the License section must link the LICENSE by its absolute URL, [LICENSE](${url}): a ` +
          `relative link breaks on npm.`,
      );
    }
  }

  // ---- The docs link -----------------------------------------------------------------------------
  // A Markdown link `](url)` or `](url "title")`, or an autolink `<url>`, to the package's own
  // page or anything under it. Another package's docs page does not count.
  const page = `https://docs\\.cosyte\\.com/${facts.slug.replace(/[.]/g, "\\.")}(?:[/#?][^)>\\s]*)?`;
  const docs = new RegExp(`\\]\\(${page}(?:\\)|\\s)|<${page}>`);
  const usage = position.get("Usage");
  const support = position.get("Support");
  const from = usage === undefined ? 0 : usage.line;
  const to = support === undefined ? lines.length : support.line;
  const docsLine = lines.findIndex((line, i) => i > from && i < to && docs.test(line));
  if (docsLine < 0) {
    add(
      "docs-link",
      (usage?.line ?? 0) + 1,
      `link the package's documentation, https://docs.cosyte.com/${facts.slug}, after ` +
        `"## Usage" begins and before "## Support".`,
    );
  }

  // ---- Size ---------------------------------------------------------------------------------
  if (text.length > README_CHARACTER_LIMIT) {
    add(
      "size",
      0,
      `the README is ${text.length.toLocaleString("en-US")} characters; the limit is ` +
        `${README_CHARACTER_LIMIT.toLocaleString("en-US")} (npm keeps the first ` +
        `${NPM_README_LIMIT.toLocaleString("en-US")}). Move reference material to ` +
        `https://docs.cosyte.com/${facts.slug}.`,
    );
  }

  return findings;
}

/**
 * Run the README gate over one package directory: read its README.md and package.json, report,
 * and return the exit code. It writes to stdout on a pass and to stderr otherwise, and never exits.
 *
 * @param {{ dir?: string, argv?: string[] }} [options] `dir` is the package directory (default:
 *   the working directory). `argv` is the CLI arguments, read only for `--dir <path>`.
 * @returns {0 | 1 | 2} 0 the README follows the skeleton, 1 a finding, 2 the input was unreadable.
 */
export function runReadmeGate(options = {}) {
  let dir = options.dir ?? process.cwd();
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] !== "--") {
      process.stderr.write(
        `README gate: ${JSON.stringify(argv[i])} is not an argument this gate accepts (only ` +
          `--dir <package directory>). Nothing was checked.\n`,
      );
      return 2;
    }
  }
  dir = resolve(dir);

  let manifest;
  let text;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    text = readFileSync(join(dir, "README.md"), "utf8");
  } catch (err) {
    process.stderr.write(`README gate: could not read the package in ${dir}: ${err.message}\n`);
    return 2;
  }

  let findings;
  try {
    findings = checkReadme(text, manifest);
  } catch (err) {
    process.stderr.write(`README gate: ${err.message} Nothing was checked.\n`);
    return 2;
  }

  if (findings.length === 0) {
    process.stdout.write(
      `README gate: README.md follows the house skeleton (${text.length.toLocaleString("en-US")} ` +
        `of ${README_CHARACTER_LIMIT.toLocaleString("en-US")} characters).\n`,
    );
    return 0;
  }
  const report = findings
    .map((f) => `  README.md${f.line > 0 ? `:${f.line}` : ""} [${f.rule}] ${f.message}`)
    .join("\n");
  process.stderr.write(
    `README gate: README.md does not follow the house skeleton.\n${report}\n` +
      `${findings.length} finding(s). The skeleton is in the @cosyte/script-utils README, ` +
      `"The README gate".\n`,
  );
  return 1;
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = runReadmeGate({ argv: process.argv.slice(2) });
}
