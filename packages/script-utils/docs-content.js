// The docs-content structure check: the shape every library's `docs-content/` folder takes, read
// from the folder itself. The standard it checks is documentation/decisions/0006 in cosyte/config.
//
// WHAT IT CHECKS. The sidebar's shape (one `docs` sidebar: the overview, the categories in their
// fixed order, then the two quality pages), that every page is listed exactly once and every listed
// id is a page, that the required pages exist, the front matter of every page, file names, and that
// both quality pages carry the section their generated numbers go in.
//
// It also reads every link a page makes into the generated reference (`./api/<page>.md#<anchor>`):
// the page must exist under `api/`, and the anchor must be one a heading on it gets on the docs
// site. And it reads the "Current numbers" section of both quality pages, which holds only the
// placeholder until the release fills in the measured numbers.
//
// It reads whether each page holds what its kind asks, the kind being the sidebar category it is
// listed in (Tutorials, How-to guides, Explanation, Reference): a how-to guide's title begins with an
// imperative verb and it has no How, Why or alternatives heading; an explanation has no settings
// table and no numbered H2; a tutorial's H2s are numbered steps ending in "What you built" and
// "Next"; the one limitations page is in Reference and no other page has a limitations heading; a
// page id shares a word with its title and does not name a kind; a configuration or command
// reference names, in `held_by`, the generator or test that holds it to the code. A library's
// findings under these rules are held by the ratchet (docs-content-ratchet.json) at the counts it
// had when they landed, which only fall. A measured number outside "Current numbers" is a warning.
//
// It reads the runnable examples at the top of examples/: each has a page, example-<name>.md, listed
// under Examples, whose Code section is the example's file. `--write` writes that section from the
// file (writeExamplePages); the check fails when it differs, so the code is never pasted by hand.
// The ratchet holds these rules too, at each library's count of examples with no page when they
// landed.
//
// WHAT IT DOES NOT CHECK. Any other link, and images: the shared CI's docs-content link check
// resolves those. The pages under `api/` themselves: the reference generator writes them and checks
// them itself; here they are only read for their headings. Whether a sample runs: the sample runner
// in @cosyte/vitest-config does that. Whether the prose is good, or whether a page's content suits
// its kind beyond the patterns above (a how-to that explains under a heading that does not begin How
// or Why, a held_by test that does not really hold every entry): nothing here can judge either, so
// review does.
//
// Zero dependencies, like the rest of this package: the front matter is read by hand, for the one
// form the standard allows (one `key: value` per line), rather than by a YAML parser.

import {
  closeSync,
  constants,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** The folder this check reads, at the repository root. */
export const DOCS_DIR = "docs-content";

/** The sidebar file inside it. */
export const SIDEBARS_FILE = "sidebars.json";

/** The folder the reference generator owns. Its pages are read only for their headings. */
export const GENERATED_DIR = "api";

/** How a link into the generated reference starts. */
export const REFERENCE_LINK_PREFIX = `./${GENERATED_DIR}/`;

/** The pages every library has, by id. */
export const REQUIRED_PAGES = Object.freeze([
  "intro",
  "installation",
  "quickstart",
  "troubleshooting",
  "testing-and-quality",
  "performance",
]);

/**
 * The top-level categories, in the only order they may appear. `first` is the page a category must
 * open with; `required` says whether every library has it.
 */
export const CATEGORIES = Object.freeze([
  Object.freeze({ label: "Installation", required: true, first: "installation" }),
  Object.freeze({ label: "Quickstart", required: true, first: "quickstart" }),
  Object.freeze({ label: "Tutorials", required: false, first: null }),
  Object.freeze({ label: "How-to guides", required: true, first: null }),
  Object.freeze({ label: "Examples", required: false, first: null }),
  Object.freeze({ label: "Explanation", required: true, first: null }),
  Object.freeze({ label: "Reference", required: false, first: null }),
  Object.freeze({ label: "Troubleshooting", required: true, first: "troubleshooting" }),
]);

/** The two fixed pages, listed last at the top level of the sidebar, in this order. */
export const QUALITY_PAGES = Object.freeze(["testing-and-quality", "performance"]);

/** The heading of the section each quality page's generated numbers go in. */
export const NUMBERS_HEADING = "## Current numbers";

/**
 * What the "Current numbers" section holds in the repository: this text and nothing else, however
 * its lines wrap. The release replaces the section with the numbers it measured.
 */
export const NUMBERS_PLACEHOLDER =
  "The numbers for this section are measured on `main` at each release and filled in when the " +
  "release is built. They are never typed by hand.";

/** The label the docs site gives the generated reference. A sidebar never writes it. */
export const RESERVED_LABEL = "API Reference";

/** The front matter keys every page carries. */
export const FRONT_MATTER_KEYS = Object.freeze(["id", "title", "sidebar_label", "description"]);

/** The front matter keys a page must not carry. */
export const FORBIDDEN_KEYS = Object.freeze(["sidebar_position"]);

/** The longest description, in characters: what a search result shows before it cuts the text. */
export const DESCRIPTION_LIMIT = 160;

/** A page's file name, without `.md`: lower-case words joined by single hyphens. */
export const PAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every rule a finding can carry, with what it requires. */
export const DOCS_CONTENT_RULES = Object.freeze({
  sidebar: "sidebars.json holds one `docs` sidebar in the standard shape",
  listing: "every page is listed in the sidebar exactly once, and every listed id is a page",
  "required-page": "the pages every library has exist",
  "front-matter":
    "every page opens with front matter carrying id, title, sidebar_label, description",
  "file-name": "pages are lower-case, hyphenated .md files at the top of docs-content/",
  numbers: `both quality pages carry the "${NUMBERS_HEADING.slice(3)}" section, holding only the placeholder`,
  "reference-link":
    "a link into the generated reference names a page under api/ and, after #, a heading on it",
  "example-page":
    "every runnable example in examples/ has a page, example-<name>, listed under Examples, " +
    "with the headings What it shows, Run it, Expected output (holding a fenced block) and Code",
  "example-code":
    "an example page's Code section is the example's file, written by cosyte-docs-content --write",
  "howto-title": "a how-to guide's title states its goal and begins with a verb in the imperative",
  "howto-steps":
    "a how-to holds steps; how and why it works goes in an explanation it links. A how-to has " +
    "no heading that begins How, Why or The alternatives",
  "explanation-content":
    "an explanation has no settings table and no steps: no table whose header starts Key or " +
    "Option with a Default column, and no numbered H2",
  limitations:
    "each library has one limitations page, id limitations, in Reference; no other page has a " +
    "heading Known limitations or Limitations",
  "tutorial-steps":
    "a tutorial's H2s are numbered steps in order and it ends with What you built and Next",
  "page-id":
    "a page id names what the page is about and shares a content word with its title; a new id " +
    "never begins guides-, concepts- or core-concepts",
  "reference-source":
    "a reference for a surface that is not TypeScript (config keys, CLI commands) is generated " +
    "from the code or a test holds every entry to it",
  "measured-number":
    "a measured number appears only in a Current numbers section, never in prose (a warning)",
});

/**
 * The rules on example pages. The ratchet holds them too: a library's examples with no page are held
 * at the count it had when the rules landed, which only falls, so no library fails the day it takes
 * them and none can add an example without a page. No library records an `example-code` count, so a
 * Code section that differs from its file fails everywhere; `cosyte-docs-content --write` fixes it.
 */
export const EXAMPLE_RULES = Object.freeze(["example-page", "example-code"]);

/** The folder at the repository root whose top-level scripts are the library's runnable examples. */
export const EXAMPLES_DIR = "examples";

/** The sidebar category that lists the example pages. */
export const EXAMPLES_CATEGORY = "Examples";

/** How an example page's id starts: `example-<name>`, the name being the file's without extension. */
export const EXAMPLE_PAGE_PREFIX = "example-";

/** The H2 headings every example page has, in this order. The last one's section is generated. */
export const EXAMPLE_HEADINGS = Object.freeze([
  "What it shows",
  "Run it",
  "Expected output",
  "Code",
]);

/** The heading the generated part of an example page starts at, which runs to the end of the page. */
export const CODE_HEADING = "## Code";

/** The extensions of a runnable example, with the fence language its code is shown in. */
const EXAMPLE_LANGUAGES = Object.freeze({ ".ts": "ts", ".mts": "ts", ".js": "js", ".mjs": "js" });

/** The reason the sample runner reads after `no-run` in an example's code fence. */
const EXAMPLE_NO_RUN = "the example file itself, which the library runs from examples/";

/**
 * The rules that read whether a page holds what its kind asks, and the rules on example pages. A
 * library's findings under them are held by the ratchet up to the counts it records for that
 * library (docs-content-ratchet.json), so a library can only have fewer.
 */
export const RATCHETED_RULES = Object.freeze([
  "howto-title",
  "howto-steps",
  "explanation-content",
  "limitations",
  "tutorial-steps",
  "page-id",
  "reference-source",
  ...EXAMPLE_RULES,
]);

/** The rules that only warn: a check can only approximate them, so a hit never fails. */
export const WARNING_RULES = Object.freeze(["measured-number"]);

/** The front matter key that names the file holding a configuration or CLI reference to the code. */
export const HELD_BY_KEY = "held_by";

/** The page every library keeps its limitations on, in Reference. */
export const LIMITATIONS_PAGE = "limitations";

/** The two sections a tutorial ends with, in this order. */
export const TUTORIAL_ENDING = Object.freeze(["What you built", "Next"]);

/** The id prefixes that name a page's kind, not its subject. */
export const KIND_PREFIXES = Object.freeze(["guides-", "concepts-", "core-concepts"]);

/**
 * The verbs a how-to guide's title may begin with, lower-case. A title that begins with any other
 * word is a finding: add a verb here, in @cosyte/script-utils, when a guide needs one this lacks.
 * Words read first as nouns (release, support, report, list and the like) are left out, so a noun
 * title such as "Release notes" is a finding; a guide that means the verb picks another one.
 */
export const IMPERATIVE_VERBS = Object.freeze(
  [
    "accept acknowledge add adopt allow analyze annotate answer apply archive assert assign attach",
    "audit authenticate authorize avoid bill branch bring build bundle calculate call cancel",
    "capture catch chain change check choose clean clear close collect combine compare compose",
    "compute configure confirm connect contribute convert copy correct count create customize",
    "de-identify debug decide declare decode decrypt define delete deploy describe detect diagnose",
    "diff disable discover dispatch display draw drive drop edit emit enable encode encrypt enforce",
    "enrich ensure escape evaluate exclude expand export extend extract fetch filter find fix flag",
    "follow format forward generate get give group guard handle hash hide host identify ignore",
    "implement import include inspect install integrate join keep label launch link listen load",
    "locate lock look make manage map mask match measure merge migrate mock modify monitor move",
    "name navigate normalize notify observe open organize override parse pass pause persist pin",
    "plug post prepare preserve prevent print property-test protect prove provide publish pull push",
    "put query queue read rebuild receive recover redact reduce refresh register reject reload",
    "remove rename render reorder repair replace replay resend reset resolve respond restart",
    "restore retry return reuse rotate route run sanitize save scale scan search secure select send",
    "separate serialize serve set share ship show sign simulate skip sort split start stop store",
    "stream strip subscribe supply swap switch sync take tell test throttle tokenize tolerate trace",
    "track transform translate triage trim troubleshoot tune turn type undo unpack update upgrade",
    "upload use validate verify wait walk warn watch wrap write",
  ]
    .join(" ")
    .split(" "),
);

/** Words that say nothing about what a page is about, left out when an id is matched to a title. */
const FILLER_WORDS = new Set(
  (
    "a an and are as at be by can concept concepts core do does for from guide guides how in into " +
    "is it its no not of on or our over the this that to under we what when where which why with " +
    "you your"
  ).split(" "),
);

/** The words in an id that say the page is a reference for configuration or a command line. */
const SURFACE_WORDS = new Set(
  "cli command commands config configuration environment options settings".split(" "),
);

/**
 * A number with a unit that is measured rather than set: a percentage, a duration under a second, a
 * size in bytes, a rate a second, or a ratio "times faster". The check can only approximate a
 * measured number, so it warns.
 */
const MEASURED_NUMBER =
  /\b\d[\d,]*(?:\.\d+)?(?:\s?(?:%|ms\b|µs\b|ns\b|[KMGT]i?B\b)|\s(?:\w+\s)?(?:a|per) second\b|\s?\/s\b|\s?x faster\b|\s(?:times) (?:faster|slower|smaller|larger|more|less|fewer)\b)/u;

/**
 * The counts the ratchet holds each library to, by package name and then by rule: today's findings
 * under the ratcheted rules, which a library may only lower. Read from docs-content-ratchet.json.
 */
export const DOCS_CONTENT_RATCHET = Object.freeze(
  // Stryker disable next-line StringLiteral: with no encoding Node returns a Buffer, which JSON.parse reads as UTF-8 text, so the value is the same.
  JSON.parse(readFileSync(new URL("./docs-content-ratchet.json", import.meta.url), "utf8"))
    .libraries,
);
// Each library's counts, frozen with the map: a number inside needs no freezing.
for (const counts of Object.values(DOCS_CONTENT_RATCHET)) Object.freeze(counts);

/** Raised when the check cannot read its input; the CLI turns it into exit 2. */
export class DocsContentRefusal extends Error {}

/**
 * Read a page's front matter: the block between a first line `---` and the next `---`, one
 * `key: value` per line. A value may be wrapped in double quotes (with `\"` and `\\` escapes) or in
 * single quotes (with `''` for a quote).
 *
 * @param {string} text The page.
 * @returns {{ fields: Map<string, { value: string, line: number }>, errors: { line: number, message: string }[], present: boolean }}
 */
export function parseFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  const fields = new Map();
  const errors = [];
  if (lines[0] !== "---") return { fields, errors, present: false };
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    errors.push({ line: 1, message: "the front matter opens with --- and never closes" });
    return { fields, errors, present: true };
  }
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const match = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (match === null) {
      errors.push({ line: i + 1, message: "is not one `key: value` line" });
      continue;
    }
    const key = match[1];
    const value = unquote(match[2] ?? "");
    if (value === null) {
      errors.push({ line: i + 1, message: `${key}: the quoted value is not closed` });
      continue;
    }
    if (fields.has(key)) {
      errors.push({ line: i + 1, message: `${key} appears twice` });
      continue;
    }
    fields.set(key, { value, line: i + 1 });
  }
  return { fields, errors, present: true };
}

/**
 * The value of one front matter line, unquoted.
 *
 * @param {string} raw The text after `key: `.
 * @returns {string | null} The value, or null for a quote that is opened and not closed.
 */
function unquote(raw) {
  const text = raw.trim();
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"') || text.endsWith('\\"')) return null;
    return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) return null;
    return text.slice(1, -1).replaceAll("''", "'");
  }
  return text;
}

/**
 * The id a sidebar item names, when it is a doc reference.
 *
 * @param {unknown} item A sidebar item.
 * @returns {string | null} The id, or null when the item is not a doc reference.
 */
function docId(item) {
  if (typeof item === "string") return item;
  if (isRecord(item) && item.type === "doc" && typeof item.id === "string") return item.id;
  return null;
}

/**
 * Whether a value is a plain object.
 *
 * @param {unknown} value Anything.
 * @returns {value is Record<string, unknown>} True for a non-null, non-array object.
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check one category's items: doc references, or a category one level down whose items are doc
 * references. Every id it reaches is pushed onto `ids`.
 *
 * @param {Record<string, unknown>} category The category.
 * @param {string} pointer Where it sits, as a JSON pointer.
 * @param {boolean} nested Whether it is already one level down.
 * @param {string[]} ids Where the ids it reaches are collected.
 * @param {(pointer: string, message: string) => void} report Records a finding.
 */
function checkCategory(category, pointer, nested, ids, report) {
  if (category.label === RESERVED_LABEL) {
    report(
      pointer,
      `the "${RESERVED_LABEL}" category is the docs site's own, made from api/: remove it`,
    );
    return;
  }
  if (!Array.isArray(category.items) || category.items.length === 0) {
    report(pointer, `the category "${String(category.label)}" has no items`);
    return;
  }
  category.items.forEach((item, index) => {
    const at = `${pointer}/items/${index}`;
    const id = docId(item);
    if (id !== null) {
      ids.push(id);
      return;
    }
    if (!nested && isCategoryItem(item)) {
      checkCategory(item, at, true, ids, report);
      return;
    }
    report(
      at,
      nested
        ? "a category one level down holds doc ids only"
        : "a category holds doc ids, or categories of doc ids one level down",
    );
  });
}

/**
 * Whether a sidebar item is a category with a string label.
 *
 * @param {unknown} item A sidebar item.
 * @returns {item is { type: "category", label: string, items: unknown }} True for a category.
 */
function isCategoryItem(item) {
  return isRecord(item) && item.type === "category" && typeof item.label === "string";
}

/**
 * Check the sidebar's shape and collect every id it lists.
 *
 * @param {unknown} sidebars The parsed sidebars.json.
 * @param {(pointer: string, message: string) => void} report Records a finding.
 * @returns {string[]} Every id the sidebar lists, in order, repeats kept.
 */
function checkSidebar(sidebars, report) {
  const ids = [];
  if (!isRecord(sidebars) || !Array.isArray(sidebars.docs)) {
    report("", 'sidebars.json is not an object whose "docs" is an array');
    return ids;
  }
  for (const key of Object.keys(sidebars)) {
    if (key !== "docs") report(`/${key}`, `one sidebar, "docs": remove "${key}"`);
  }
  const items = sidebars.docs;
  let index = 0;
  if (docId(items[0]) === "intro") {
    ids.push("intro");
    index = 1;
  } else {
    report("/docs/0", 'the sidebar opens with the overview page, "intro"');
    // Whatever stands in the overview's place is that one finding, not the start of the tail.
    if (!isCategoryItem(items[0])) index = 1;
  }
  let last = -1;
  const seen = new Set();
  for (; isCategoryItem(items[index]); index += 1) {
    const item = items[index];
    const pointer = `/docs/${index}`;
    const position = CATEGORIES.findIndex((category) => category.label === item.label);
    if (position === -1) {
      report(
        pointer,
        `"${item.label}" is not a category of the standard (${CATEGORIES.map((c) => c.label).join(", ")})`,
      );
    } else if (position <= last) {
      report(
        pointer,
        `"${item.label}" is out of order: the categories run ${CATEGORIES.map((c) => c.label).join(", ")}`,
      );
    } else {
      last = position;
      seen.add(item.label);
      const first = CATEGORIES[position].first;
      if (first !== null && Array.isArray(item.items) && docId(item.items[0]) !== first) {
        report(`${pointer}/items/0`, `"${item.label}" opens with the page "${first}"`);
      }
    }
    checkCategory(item, pointer, false, ids, report);
  }
  for (const category of CATEGORIES) {
    if (category.required && !seen.has(category.label)) {
      report("/docs", `the category "${category.label}" is missing`);
    }
  }
  const tail = items.slice(index);
  QUALITY_PAGES.forEach((page, offset) => {
    const id = docId(tail[offset]);
    if (id !== page) {
      report(
        `/docs/${index + offset}`,
        `after the categories, the sidebar lists "${QUALITY_PAGES.join('" then "')}" and nothing else`,
      );
    } else {
      ids.push(id);
    }
  });
  for (let offset = QUALITY_PAGES.length; offset < tail.length; offset += 1) {
    const id = docId(tail[offset]);
    if (id !== null) ids.push(id);
    report(
      `/docs/${index + offset}`,
      `after the categories, the sidebar lists "${QUALITY_PAGES.join('" then "')}" and nothing else`,
    );
  }
  return ids;
}

/**
 * A heading that ends the "Current numbers" section: one or two `#`, as the docs site reads it.
 * A deeper heading is part of the section.
 */
const SECTION_END = /^ {0,3}#{1,2}(?:[ \t]|$)/;

/**
 * The text of the section a heading opens, up to the next heading of its level or above, with every
 * run of whitespace read as one space, so a wrapped sentence reads as it does unwrapped.
 *
 * @param {string[]} lines The page's lines.
 * @param {number} at The index of the heading.
 * @returns {string} The section's text.
 */
function sectionText(lines, at) {
  const body = lines.slice(at + 1);
  const end = body.findIndex((line) => SECTION_END.test(line));
  if (end !== -1) body.length = end;
  return body.join(" ").replace(/\s+/g, " ").trim();
}

/** A fence opener or closer: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The lines of a page outside fenced code, each with its 1-based line number. A fence closes on a
 * run of its own character at least as long as the one that opened it, with nothing after it; an
 * unclosed fence runs to the end of the page.
 *
 * @param {string} text A page.
 * @returns {{ text: string, line: number }[]} The lines outside code.
 */
function proseLines(text) {
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const run = FENCE.exec(line)?.[1];
    if (fence === null) {
      if (run === undefined) out.push({ text: line, line: index + 1 });
      else fence = run;
    } else if (
      run !== undefined &&
      run[0] === fence[0] &&
      run.length >= fence.length &&
      line.trim() === run
    ) {
      fence = null;
    }
  });
  return out;
}

/**
 * A line with each inline code span turned into one space, so a link written as code is not read as
 * a link, and text on either side of a span is not read as one link. A run of backticks closes on
 * the next run of the same length; an unclosed run is literal.
 *
 * @param {string} line One line.
 * @returns {string} The line, each code span a space.
 */
function withoutCodeSpans(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      out += line[i];
      i += 1;
      continue;
    }
    const run = backtickRun(line, i);
    const close = closingRun(line, i + run, run);
    if (close === -1) {
      out += line.slice(i, i + run);
      i += run;
    } else {
      out += " ";
      i = close + run;
    }
  }
  return out;
}

/**
 * The length of the run of backticks at a position.
 *
 * @param {string} text Some text.
 * @param {number} at Where the run starts.
 * @returns {number} How many backticks follow, from `at`.
 */
function backtickRun(text, at) {
  let end = at;
  while (text[end] === "`") end += 1;
  return end - at;
}

/**
 * Where the run of exactly `length` backticks that closes a code span starts.
 *
 * @param {string} text Some text.
 * @param {number} from Where to look from.
 * @param {number} length The opening run's length.
 * @returns {number} The closing run's start, or -1 when there is none.
 */
function closingRun(text, from, length) {
  for (let i = from; (i = text.indexOf("`", i)) !== -1;) {
    const run = backtickRun(text, i);
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/** An inline link's destination in the generated reference, read from just after `](`. */
const REFERENCE_DESTINATION = /^ *<?(\.\/api\/[^\s)>]*)/;

/** A link reference definition whose destination is in the generated reference. */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]*\]:[ \t]*<?(\.\/api\/[^\s>]*)/;

/**
 * Every link a page makes into the generated reference: inline links and images, `[text](target)`,
 * and link reference definitions, `[label]: target`, outside fenced and inline code.
 *
 * @param {string} text A page.
 * @returns {{ target: string, line: number }[]} Each target that starts `./api/`, with its line.
 */
function referenceLinks(text) {
  const links = [];
  for (const { text: raw, line } of proseLines(text)) {
    const prose = withoutCodeSpans(raw);
    const definition = REFERENCE_DEFINITION.exec(prose);
    if (definition !== null) links.push({ target: definition[1], line });
    for (let at = prose.indexOf("]("); at !== -1; at = prose.indexOf("](", at + 2)) {
      // The destination: after the parenthesis, spaces and an opening angle bracket, up to a space,
      // a closing parenthesis or angle bracket, or the end of the line.
      const destination = REFERENCE_DESTINATION.exec(prose.slice(at + 2));
      if (destination !== null) links.push({ target: destination[1], line });
    }
  }
  return links;
}

/** An ATX heading: up to three spaces, one to six `#`, then a space, a tab or the end of the line. */
const HEADING = /^ {0,3}#{1,6}(?=[ \t]|$)/;

/** ASCII punctuation, which a backslash escapes in markdown. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * What a character the docs site's slugger drops matches: anything that is not a letter, a mark,
 * a decimal or letter number, a connector such as `_`, another alphabetic character (a circled or
 * squared letter is a symbol, but alphabetic), a space or a hyphen. The site's markdown loader
 * slugs headings with github-slugger 1.5.0, whose class was built from Unicode 13.0. Compared over
 * every code point under Unicode 17.0 (Node.js 26), the two agree on every character except 14,802
 * that Unicode assigned in 14.0 to 17.0 (letters, marks, digits and letter numbers): slugger drops
 * them and this keeps them. Every character that slugger keeps, this keeps.
 */
const SLUG_DROPS = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\p{Alphabetic} -]/gu;

/**
 * The text of a heading as the docs site reads it before slugging: the closing run of `#` dropped,
 * a backslash escape read as its character, a code span as its content, and a link or an image as
 * its text without its destination.
 *
 * @param {string} raw What follows the heading's `#` run.
 * @returns {string} The heading's text.
 */
function headingText(raw) {
  // The closing run of `#` goes with the spaces before it. A `#` the run leaves behind, as in
  // `C#`, is dropped by the slug in any case, and so is every backtick and backslash below: what
  // matters here is only what reaches the slug as a letter, a digit, a space or a hyphen.
  let text = raw.trim();
  while (text.endsWith("#")) text = text.slice(0, -1);
  text = text.trimEnd();
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && ESCAPABLE.test(text.charAt(i + 1))) {
      out += text[i + 1];
      i += 2;
    } else if (char === "`") {
      const run = backtickRun(text, i);
      const close = closingRun(text, i + run, run);
      // An unclosed run is literal backticks, which the slug drops.
      if (close !== -1) out += text.slice(i + run, close);
      i = close === -1 ? i + run : close + run;
    } else if (text.startsWith("](", i) && text.includes(")", i)) {
      i = text.indexOf(")", i) + 1;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/**
 * Every anchor the headings of a page get on the docs site: each heading's text lower-cased, the
 * characters the slugger drops dropped, and each space turned into a hyphen; a slug already taken
 * gets `-1`, `-2` and so on, counted per slug in page order. Headings in fenced code are code.
 *
 * WHAT IT DOES NOT READ, since the reference generator writes none of it: setext headings
 * (underlined with `=` or `-`), an explicit `{#id}`, HTML in a heading, entities such as `&amp;`,
 * and emphasis written with `_`, whose underscores it keeps.
 *
 * @param {string} text A page.
 * @returns {Set<string>} Its anchors.
 */
export function headingAnchors(text) {
  const anchors = new Set();
  const counts = new Map();
  for (const { text: line } of proseLines(text)) {
    const heading = HEADING.exec(line);
    if (heading === null) continue;
    const base = headingText(line.slice(heading[0].length))
      .toLowerCase()
      .replace(SLUG_DROPS, "")
      .replaceAll(" ", "-");
    let slug = base;
    while (anchors.has(slug)) {
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      slug = `${base}-${count}`;
    }
    anchors.add(slug);
  }
  return anchors;
}

/**
 * What is wrong with a link into the generated reference, or null when it resolves.
 *
 * @param {string} target The link's target, starting `./api/`.
 * @param {Map<string, Set<string>>} anchors The anchors of each generated page, by path under api/.
 * @returns {string | null} What is wrong.
 */
function referenceFault(target, anchors) {
  const hash = target.indexOf("#");
  const path = target.slice(REFERENCE_LINK_PREFIX.length, hash === -1 ? undefined : hash);
  const segments = path.split("/");
  if (!path.endsWith(".md") || segments.some((s) => s === "" || s === "." || s === "..")) {
    return `links ${target}: a link into the reference is ${REFERENCE_LINK_PREFIX}<page>.md, with an optional #<anchor>`;
  }
  const headings = anchors.get(path);
  if (headings === undefined) {
    return `links ${target}, but there is no page ${GENERATED_DIR}/${path}`;
  }
  const anchor = target.slice(hash + 1);
  if (hash === -1 || headings.has(anchor)) return null;
  return `links ${target}, but no heading on ${GENERATED_DIR}/${path} has the anchor "${anchor}"`;
}

/**
 * The top-level category each page is listed under, by id: the page's kind. A page in a category one
 * level down takes its parent's label; a page listed twice keeps the first. Only labelled categories
 * at the top of a `docs` array are read, so a sidebar of the wrong shape names no kinds.
 *
 * @param {unknown} sidebars The parsed sidebars.json.
 * @returns {Map<string, string>} Each listed page's top-level category label.
 */
export function pageKinds(sidebars) {
  const kinds = new Map();
  if (!isRecord(sidebars) || !Array.isArray(sidebars.docs)) return kinds;
  const visit = (items, label) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const id = docId(item);
      if (id !== null) {
        if (!kinds.has(id)) kinds.set(id, label);
      } else if (isCategoryItem(item)) {
        visit(item.items, label);
      }
    }
  };
  for (const item of sidebars.docs) {
    if (isCategoryItem(item)) visit(item.items, item.label);
  }
  return kinds;
}

/**
 * Every ATX heading of a page outside fenced code, with its level, its text as the docs site reads
 * it, and its 1-based line.
 *
 * @param {string} text A page.
 * @returns {{ level: number, text: string, line: number }[]} The headings, in page order.
 */
function headings(text) {
  return proseLines(text)
    .map(({ text: line, line: number }) => ({ line, number, heading: HEADING.exec(line) }))
    .filter(({ heading }) => heading !== null)
    .map(({ line, number, heading }) => ({
      level: heading[0].trim().length,
      text: headingText(line.slice(heading[0].length)).trim(),
      line: number,
    }));
}

/** A table's delimiter row: cells of hyphens, each with an optional colon at either end. */
const DELIMITER_ROW = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * The header row of every table on a page outside fenced code, each cell's text with its code spans
 * read as their content, and the row's 1-based line. A closing pipe leaves an empty last cell, which
 * no rule reads: a settings table is told by its first cell and by any cell naming a default.
 *
 * @param {string} text A page.
 * @returns {{ cells: string[], line: number }[]} The header rows, in page order.
 */
function tableHeaders(text) {
  const lines = proseLines(text);
  const out = [];
  lines.forEach((row, index) => {
    const next = lines[index + 1];
    if (!row.text.includes("|") || next === undefined || next.line !== row.line + 1) return;
    if (!DELIMITER_ROW.test(next.text)) return;
    const cells = row.text
      .trim()
      .replace(/^\|/, "")
      .split(/(?<!\\)\|/)
      .map((cell) => headingText(cell).trim());
    out.push({ cells, line: row.line });
  });
  return out;
}

/**
 * Whether a table's header is a settings table: its first cell starts Key or Option, and a cell is
 * a Default column.
 *
 * @param {string[]} cells The header's cells.
 * @returns {boolean} True for a settings table.
 */
function isSettingsTable(cells) {
  return /^(?:key|option)/i.test(cells[0]) && cells.some((cell) => /\bdefault/i.test(cell));
}

/** A numbered step heading: `1. Do this` or `Step 1: do this`, with the step's number. */
const STEP_HEADING = /^(?:step\s+(\d+)\s*[:.]|(\d+)[.)])\s+\S/i;

/**
 * The number of a heading that is a numbered step, or null.
 *
 * @param {string} text A heading's text.
 * @returns {number | null} The step's number.
 */
function stepNumber(text) {
  const match = STEP_HEADING.exec(text);
  return match === null ? null : Number(match[1] ?? match[2]);
}

/**
 * The words of an id or a title that say what a page is about: lower-case runs of letters and
 * digits, without the filler words.
 *
 * @param {string} text An id or a title.
 * @returns {string[]} Its content words.
 */
function contentWords(text) {
  return Array.from(text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu), (m) => m[0]).filter(
    (w) => !FILLER_WORDS.has(w),
  );
}

/**
 * Whether two words are the same word: equal, or one begins with the other and the shorter has at
 * least three letters, so `ack` matches `acks` and `test` matches `testing`.
 *
 * @param {string} a A word.
 * @param {string} b Another.
 * @returns {boolean} True when they match.
 */
function sameWord(a, b) {
  return a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * A `held_by` path that stays inside the repository: relative, with forward slashes, and no empty,
 * `.` or `..` segment.
 *
 * @param {string} path The front matter value.
 * @returns {boolean} True when the path may be read.
 */
export function isHeldByPath(path) {
  // An empty path and an absolute one each have an empty segment, so the split refuses them.
  if (path.includes("\\")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/**
 * A `held_by` path that names a page rather than a generator or a test: a Markdown or MDX file, or
 * any file under docs-content/. A page cannot hold itself, or another page, to the code.
 *
 * @param {string} path The front matter value.
 * @returns {boolean} True when the path names a page.
 */
function isPagePath(path) {
  return /\.mdx?$/i.test(path) || path.startsWith(`${DOCS_DIR}/`);
}

/**
 * A `held_by` path that names a text file rather than a generator or a test: a `.markdown` or
 * `.txt` file, or a file whose name has no extension (a dot at its start does not count), unless
 * its text begins with `#!`, as a script does. Such a file can only name the page, never hold it.
 *
 * @param {string} path The front matter value.
 * @param {string} text The text of the file it names.
 * @returns {boolean} True when the path names a text file.
 */
function isTextPath(path, text) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/\.(?:markdown|txt)$/i.test(name)) return true;
  return !name.slice(1).includes(".") && !text.startsWith("#!");
}

/**
 * Whether a file's text names a page's file as a whole path segment: the name with no letter,
 * digit, dot, hyphen or underscore before it, and none after it but a dot that ends a sentence.
 * "configuration.md" is not named by "cli-configuration.md", "v2.configuration.md",
 * "configuration.mdx" or "configuration.md5".
 *
 * @param {string} text The text of the file `held_by` names.
 * @param {string} file The page's file name, such as "configuration.md".
 * @returns {boolean} True when the text names the file.
 */
function namesFile(text, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.-])${escaped}(?![\\w-]|\\.\\w)`).test(text);
}

/**
 * The findings of the rules that read whether each page holds what its kind asks.
 *
 * @param {{ name: string, text: string }[]} pages The pages.
 * @param {Map<string, string>} kinds Each page's top-level category.
 * @param {Map<string, string>} sources The files `held_by` names, by path, as read.
 * @param {(file: string, line: number, rule: string, message: string) => void} add Records a finding.
 */
function checkKinds(pages, kinds, sources, add) {
  const names = new Set(pages.map((page) => page.name));
  if (!names.has(LIMITATIONS_PAGE)) {
    add(
      `${LIMITATIONS_PAGE}.md`,
      0,
      "limitations",
      `every library has one limitations page, id "${LIMITATIONS_PAGE}", listed in Reference`,
    );
  } else if (kinds.has(LIMITATIONS_PAGE) && kinds.get(LIMITATIONS_PAGE) !== "Reference") {
    add(
      `${LIMITATIONS_PAGE}.md`,
      0,
      "limitations",
      `the limitations page is listed in "${kinds.get(LIMITATIONS_PAGE)}": it belongs in Reference`,
    );
  }

  for (const page of pages) {
    const file = `${page.name}.md`;
    const kind = kinds.get(page.name);
    const { fields } = parseFrontMatter(page.text);
    const title = fields.get("title");
    const outline = headings(page.text);

    if (page.name !== LIMITATIONS_PAGE) {
      for (const heading of outline) {
        if (/^(?:known\s+)?limitations\b/i.test(heading.text)) {
          add(
            file,
            heading.line,
            "limitations",
            `the heading "${heading.text}" belongs on the limitations page, in Reference: move it there and link it`,
          );
        }
      }
    }

    if (!REQUIRED_PAGES.includes(page.name)) {
      const prefix = KIND_PREFIXES.find((p) => page.name.startsWith(p));
      if (prefix !== undefined) {
        add(
          file,
          0,
          "page-id",
          `the id begins "${prefix}", which names the page's kind: a new id names what the page is about`,
        );
      } else if (title !== undefined && title.value.trim() !== "") {
        const words = contentWords(title.value);
        if (!contentWords(page.name).some((w) => words.some((t) => sameWord(w, t)))) {
          add(
            file,
            title.line,
            "page-id",
            `the id "${page.name}" shares no content word with the title "${title.value}"`,
          );
        }
      }
    }

    if (kind === "How-to guides") {
      if (title !== undefined && title.value.trim() !== "") {
        const first = title.value.trim().split(/\s/)[0];
        const word = first.toLowerCase().replace(/[^\p{L}\p{N}-]+$/u, "");
        if (!IMPERATIVE_VERBS.includes(word)) {
          add(
            file,
            title.line,
            "howto-title",
            `the title begins "${first}": a how-to guide's title begins with a verb in the ` +
              "imperative (a verb missing from IMPERATIVE_VERBS is added there)",
          );
        }
      }
      for (const heading of outline) {
        if (heading.level < 2 || heading.level > 3) continue;
        if (/^(?:how|why)\b|^(?:the\s+)?alternatives\b/i.test(heading.text)) {
          add(
            file,
            heading.line,
            "howto-steps",
            `the heading "${heading.text}" explains: move the section to an explanation and link it`,
          );
        }
      }
    }

    if (kind === "Explanation") {
      for (const table of tableHeaders(page.text)) {
        if (isSettingsTable(table.cells)) {
          add(
            file,
            table.line,
            "explanation-content",
            "a settings table (Key or Option, with a Default column) belongs in a reference: move it and link it",
          );
        }
      }
      for (const heading of outline) {
        if (heading.level === 2 && stepNumber(heading.text) !== null) {
          add(
            file,
            heading.line,
            "explanation-content",
            `the heading "${heading.text}" is numbered, which reads as a step: steps go in a how-to guide or a tutorial`,
          );
        }
      }
    }

    if (kind === "Tutorials") {
      const sections = outline.filter((heading) => heading.level === 2);
      const tail = sections.slice(-TUTORIAL_ENDING.length).map((heading) => heading.text);
      const ends =
        tail.length === TUTORIAL_ENDING.length &&
        tail.every((text, i) => text.toLowerCase() === TUTORIAL_ENDING[i].toLowerCase());
      const steps = ends ? sections.slice(0, -TUTORIAL_ENDING.length) : sections;
      if (steps.length === 0) {
        add(file, 0, "tutorial-steps", "a tutorial's H2s are numbered steps: it has none");
      }
      steps.forEach((heading, index) => {
        if (stepNumber(heading.text) !== index + 1) {
          add(
            file,
            heading.line,
            "tutorial-steps",
            `the heading "${heading.text}" is not step ${index + 1} ("${index + 1}. ..." or "Step ${index + 1}: ...")`,
          );
        }
      });
      if (!ends) {
        add(
          file,
          sections.at(-1)?.line ?? 0,
          "tutorial-steps",
          `a tutorial ends with the sections "${TUTORIAL_ENDING.join('" then "')}"`,
        );
      }
    }

    if (kind === "Reference") {
      const surface = contentWords(page.name).some((w) => SURFACE_WORDS.has(w));
      const settings = tableHeaders(page.text).some((table) => isSettingsTable(table.cells));
      if (surface || settings) {
        const held = fields.get(HELD_BY_KEY);
        const what = surface ? "a configuration or command reference" : "a settings table";
        if (held === undefined || held.value.trim() === "") {
          add(
            file,
            0,
            "reference-source",
            `${what}: name the generator or the test that holds every entry to the code in ` +
              `"${HELD_BY_KEY}:" in the front matter`,
          );
        } else if (!isHeldByPath(held.value) || !sources.has(held.value)) {
          add(
            file,
            held.line,
            "reference-source",
            `${HELD_BY_KEY} names "${held.value}", which is not a file in the repository`,
          );
        } else if (isPagePath(held.value)) {
          add(
            file,
            held.line,
            "reference-source",
            `${HELD_BY_KEY} names "${held.value}", which is a page, not the generator or the ` +
              "test that holds the reference to the code",
          );
        } else if (isTextPath(held.value, sources.get(held.value))) {
          add(
            file,
            held.line,
            "reference-source",
            `${HELD_BY_KEY} names "${held.value}", which is a text file, not the generator or ` +
              "the test that holds the reference to the code",
          );
        } else if (!namesFile(sources.get(held.value), file)) {
          add(
            file,
            held.line,
            "reference-source",
            `${HELD_BY_KEY} names "${held.value}", which never names ${file}`,
          );
        }
      }
    }
  }
}

/**
 * The warnings of a docs-content tree: each prose line, outside code and outside a "Current numbers"
 * section, that carries a measured number, on every page that is not in Reference. A number with a
 * unit is only a guess at a measured one, so these never fail the check.
 *
 * @param {{ pages: { name: string, text: string }[], sidebars: string | null }} input The tree.
 * @returns {{ file: string, line: number, rule: "measured-number", message: string }[]} Each warning.
 */
export function docsContentWarnings(input) {
  let kinds = new Map();
  try {
    // JSON.parse reads null as the text "null"; anything that is not JSON throws, and is caught.
    kinds = pageKinds(JSON.parse(input.sidebars));
  } catch {
    // A sidebar that is not JSON is the check's finding; here every page is read.
  }
  const warnings = [];
  for (const page of input.pages) {
    if (kinds.get(page.name) === "Reference") continue;
    const end = parseFrontMatter(page.text).present
      ? page.text.split(/\r?\n/).indexOf("---", 1)
      : -1;
    let numbers = false;
    for (const { text, line } of proseLines(page.text)) {
      // The first line after the closing ---, or line 1 when there is no front matter.
      if (line < end + 2) continue;
      if (HEADING.test(text) && SECTION_END.test(text)) numbers = text.trim() === NUMBERS_HEADING;
      if (numbers) continue;
      const match = MEASURED_NUMBER.exec(withoutCodeSpans(text));
      if (match !== null) {
        warnings.push({
          file: `${page.name}.md`,
          line,
          rule: "measured-number",
          message: `"${match[0]}" reads as a measured number: measured numbers go in the generated "Current numbers" section`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Whether a file at the top of examples/ is a runnable example: a `.ts`, `.mts`, `.js` or `.mjs`
 * script whose name does not begin with `_` or `.` (a helper the examples import), and that is not a
 * declaration file, a test or a tool's configuration (`eslint.config.js`).
 *
 * @param {string} name The file name.
 * @returns {boolean} True for a runnable example.
 */
export function isExampleFile(name) {
  if (name.startsWith("_") || name.startsWith(".")) return false;
  if (/\.d\.m?ts$/.test(name) || /\.(?:test|spec|config)\./.test(name)) return false;
  // A name with no dot gives its last character, which is no language's extension. A name that
  // begins with a dot was refused above.
  return Object.hasOwn(EXAMPLE_LANGUAGES, name.slice(name.lastIndexOf(".")));
}

/**
 * An example's name: its file name without the extension. Its page is `example-<name>.md`.
 *
 * @param {string} file The example's file name.
 * @returns {string} The name.
 */
export function exampleStem(file) {
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * The fence language an example's code is shown in: `ts` for `.ts` and `.mts`, else `js`.
 *
 * @param {string} file The example's file name.
 * @returns {"ts" | "js"} The language.
 */
export function exampleLanguage(file) {
  return EXAMPLE_LANGUAGES[file.slice(file.lastIndexOf("."))] ?? "js";
}

/**
 * The generated Code section of an example page: the whole file, in a fence one backtick longer than
 * its longest backtick run, titled with its path and marked `no-run`, since the sample runner would
 * otherwise run it away from the files it imports. Line endings are read as LF, and the file's
 * trailing blank lines are dropped.
 *
 * @param {string} file The example's file name, under examples/.
 * @param {string} text The file's text.
 * @returns {string} The section, from its heading to the end of the page, ending in one newline.
 */
export function exampleCodeSection(file, text) {
  const code = text.replaceAll("\r\n", "\n").replace(/\n+$/, "");
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const path = `${EXAMPLES_DIR}/${file}`;
  return (
    `${CODE_HEADING}\n\n` +
    `The whole of \`${path}\`, included from the file: \`cosyte-docs-content --write\` writes ` +
    "this section, and the check fails when it differs from the file, so it is never edited by " +
    "hand.\n\n" +
    `${fence}${exampleLanguage(file)} title="${path}" no-run ${EXAMPLE_NO_RUN}\n` +
    `${code}\n${fence}\n`
  );
}

/**
 * The examples a page can be made for, by name, and a finding for each that cannot: a name that is
 * not a page name, or two files with one name.
 *
 * @param {{ file: string, text: string }[]} examples The runnable examples.
 * @param {(file: string, line: number, rule: string, message: string) => void} [add] Records a finding.
 * @returns {Map<string, { file: string, text: string }>} Each example a page is made for, by name.
 */
function examplesByName(examples, add = () => {}) {
  const byName = new Map();
  for (const example of examples) {
    const name = exampleStem(example.file);
    if (!PAGE_NAME.test(name)) {
      add(
        `${EXAMPLE_PAGE_PREFIX}${name}.md`,
        0,
        "example-page",
        `${EXAMPLES_DIR}/${example.file}: an example's name is lower-case words joined by single ` +
          `hyphens, since its page is ${EXAMPLE_PAGE_PREFIX}<name>.md: rename the file`,
      );
      continue;
    }
    byName.set(name, [...(byName.get(name) ?? []), example]);
  }
  const usable = new Map();
  for (const [name, files] of byName) {
    if (files.length === 1) {
      usable.set(name, files[0]);
      continue;
    }
    const paths = files.map((example) => `${EXAMPLES_DIR}/${example.file}`).sort();
    add(
      `${EXAMPLE_PAGE_PREFIX}${name}.md`,
      0,
      "example-page",
      `${paths.join(" and ")} would share the page ${EXAMPLE_PAGE_PREFIX}${name}.md: rename one`,
    );
  }
  return usable;
}

/** The four headings of an example page, as a reader is told them. */
const EXAMPLE_HEADINGS_TEXT = `${EXAMPLE_HEADINGS.slice(0, -1).join(", ")} and ${EXAMPLE_HEADINGS.at(-1)}, in that order`;

/**
 * Check every example page against its example: each example has its page, listed under Examples,
 * with the four headings in order, a fenced block under Expected output, and a Code section that is
 * what the generator writes from the file; each example page has its example; and the Examples
 * category holds example pages only.
 *
 * @param {{ name: string, text: string }[]} pages The pages.
 * @param {Map<string, string>} kinds Each listed page's top-level category.
 * @param {{ file: string, text: string }[]} examples The runnable examples.
 * @param {(file: string, line: number, rule: string, message: string) => void} add Records a finding.
 */
function checkExamples(pages, kinds, examples, add) {
  const byName = examplesByName(examples, add);
  const stems = new Set(examples.map((example) => exampleStem(example.file)));
  const byPage = new Map(pages.map((page) => [page.name, page]));
  for (const [name, example] of byName) {
    const id = `${EXAMPLE_PAGE_PREFIX}${name}`;
    const file = `${id}.md`;
    const page = byPage.get(id);
    if (page === undefined) {
      add(
        file,
        0,
        "example-page",
        `${EXAMPLES_DIR}/${example.file} has no page: write ${DOCS_DIR}/${file} with the headings ` +
          `${EXAMPLE_HEADINGS.slice(0, -1).join(", ")} and ${EXAMPLE_HEADINGS.at(-1)}, list it ` +
          `under ${EXAMPLES_CATEGORY} in ${SIDEBARS_FILE}, and run cosyte-docs-content --write to ` +
          "fill in its Code section",
      );
      continue;
    }
    checkExamplePage(page, example, add);
  }
  for (const page of pages) {
    const file = `${page.name}.md`;
    const kind = kinds.get(page.name);
    if (page.name.startsWith(EXAMPLE_PAGE_PREFIX)) {
      const name = page.name.slice(EXAMPLE_PAGE_PREFIX.length);
      if (!stems.has(name)) {
        const tried = Object.keys(EXAMPLE_LANGUAGES)
          .join(", ")
          .replace(/, ([^,]*)$/, " or $1");
        add(
          file,
          0,
          "example-page",
          `there is no example for this page: no ${EXAMPLES_DIR}/${name}${tried}`,
        );
      } else if (kind !== undefined && kind !== EXAMPLES_CATEGORY) {
        add(
          file,
          0,
          "example-page",
          `the page is listed in "${kind}": an example page is listed under ${EXAMPLES_CATEGORY}`,
        );
      }
    } else if (kind === EXAMPLES_CATEGORY) {
      add(
        file,
        0,
        "example-page",
        `the ${EXAMPLES_CATEGORY} category holds only example pages, ${EXAMPLE_PAGE_PREFIX}<name>, ` +
          `one for each example in ${EXAMPLES_DIR}/`,
      );
    }
  }
}

/**
 * Check one example page: its four headings in order, a fenced block under Expected output, and a
 * Code section that is what the generator writes from the example.
 *
 * @param {{ name: string, text: string }} page The page.
 * @param {{ file: string, text: string }} example Its example.
 * @param {(file: string, line: number, rule: string, message: string) => void} add Records a finding.
 */
function checkExamplePage(page, example, add) {
  const file = `${page.name}.md`;
  const text = page.text.replaceAll("\r\n", "\n");
  const sections = headings(text).filter((heading) => heading.level === 2);
  const found = EXAMPLE_HEADINGS.map((want) => sections.find((h) => h.text === want));
  let complete = true;
  found.forEach((heading, index) => {
    if (heading === undefined) {
      complete = false;
      add(
        file,
        0,
        "example-page",
        `the page has no "## ${EXAMPLE_HEADINGS[index]}" heading: an example page has the ` +
          `headings ${EXAMPLE_HEADINGS_TEXT}`,
      );
    }
  });
  if (!complete) return;
  for (let i = 1; i < found.length; i += 1) {
    // Stryker disable next-line EqualityOperator: the four headings are four lines, so no two share one.
    if (found[i].line < found[i - 1].line) {
      add(
        file,
        found[i].line,
        "example-page",
        `the heading "${found[i].text}" is out of order: an example page has the headings ` +
          EXAMPLE_HEADINGS_TEXT,
      );
      return;
    }
  }
  const lines = text.split("\n");
  const output = found[2];
  // The section ends at the next H2, which is there: Code comes after it.
  const next = sections.find((heading) => heading.line > output.line);
  const body = lines.slice(output.line, next.line - 1);
  if (!body.some((line) => FENCE.test(line))) {
    add(
      file,
      output.line,
      "example-page",
      `the ${EXAMPLE_HEADINGS[2]} section holds no fenced block: put what the example prints in ` +
        "one, as it prints it",
    );
  }
  const code = found[3];
  if (lines.slice(code.line - 1).join("\n") !== exampleCodeSection(example.file, example.text)) {
    add(
      file,
      code.line,
      "example-code",
      `the Code section differs from ${EXAMPLES_DIR}/${example.file}: run cosyte-docs-content ` +
        "--write and commit what it writes",
    );
  }
}

/**
 * Read the runnable examples at the top of a repository's examples/, in name order. A repository
 * without examples/ has none.
 *
 * @param {string} root The repository root.
 * @returns {{ file: string, text: string }[]} Each example's file name and text.
 * @throws {DocsContentRefusal} When examples/ is not a directory, or an example cannot be read.
 */
function readExamples(root) {
  const dir = join(root, EXAMPLES_DIR);
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (stat === undefined) return [];
  if (!stat.isDirectory()) throw new DocsContentRefusal(`${dir} is not a directory.`);
  const examples = [];
  for (const entry of readdirOrRefuse(dir)) {
    if (entry.isDirectory() || !isExampleFile(entry.name)) continue;
    examples.push({ file: entry.name, text: readOrRefuse(join(dir, entry.name), entry) });
  }
  // In name order: Node lists a directory sorted on Linux and macOS, as readDocsContent relies on.
  return examples;
}

/**
 * Write the Code section of every example page from its example: the page from its "## Code" heading
 * to the end is replaced, or the section is added at the end when the page has none. A page is only
 * ever written when its text changes, and a page that does not exist is never written: what an
 * example shows, how to run it and what it prints are written by hand.
 *
 * @param {string} root The repository root.
 * @returns {string[]} The pages written, relative to docs-content/.
 * @throws {DocsContentRefusal} When docs-content/ or examples/ cannot be read, or a page cannot be written.
 */
export function writeExamplePages(root) {
  const docs = join(root, DOCS_DIR);
  if (!isDirectory(docs)) throw new DocsContentRefusal(`${docs} is not a directory.`);
  const written = [];
  for (const [name, example] of examplesByName(readExamples(root))) {
    const file = `${EXAMPLE_PAGE_PREFIX}${name}.md`;
    const path = join(docs, file);
    // One descriptor for the read and the write, so the page written is the page read. A link is
    // not followed where the platform can refuse one, and a folder fails to open for writing.
    let fd;
    try {
      fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new DocsContentRefusal(`${path} could not be written (${error.code}).`);
    }
    try {
      const text = readFileSync(fd, "utf8");
      const want = examplePageText(text, example);
      if (want === text) continue;
      ftruncateSync(fd, 0);
      writeSync(fd, want, 0);
    } finally {
      closeSync(fd);
    }
    written.push(file);
  }
  return written;
}

/**
 * An example page with its Code section written from its example: the page from its "## Code"
 * heading to the end replaced, or the section added at the end when the page has none.
 *
 * @param {string} text The page.
 * @param {{ file: string, text: string }} example Its example.
 * @returns {string} The page as it should be, with LF line endings.
 */
function examplePageText(text, example) {
  const normal = text.replaceAll("\r\n", "\n");
  const lines = normal.split("\n");
  const code = headings(normal).find((h) => h.level === 2 && h.text === EXAMPLE_HEADINGS.at(-1));
  const hand = code === undefined ? normal : lines.slice(0, code.line - 1).join("\n");
  return `${hand.replace(/\n+$/, "")}\n\n${exampleCodeSection(example.file, example.text)}`;
}

/**
 * Hold a library's findings under the ratcheted rules to the counts recorded for it. A rule whose
 * findings are at or under its count is held, and does not fail; over it, every finding under the
 * rule fails. A rule under its count is loose: the count can be lowered.
 *
 * @param {{ file: string, line: number, rule: string, message: string }[]} findings Every finding.
 * @param {Readonly<Record<string, number>>} [allowance] The library's recorded counts, by rule.
 * @returns {{ failing: typeof findings, held: typeof findings, over: { rule: string, count: number, allowed: number }[], loose: { rule: string, count: number, allowed: number }[] }}
 */
export function applyDocsContentRatchet(findings, allowance = {}) {
  const counts = new Map();
  for (const finding of findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
  const over = [];
  const loose = [];
  for (const rule of RATCHETED_RULES) {
    const count = counts.get(rule) ?? 0;
    const allowed = allowance[rule] ?? 0;
    if (count > allowed) over.push({ rule, count, allowed });
    else if (count < allowed) loose.push({ rule, count, allowed });
  }
  const failing = [];
  const held = [];
  for (const finding of findings) {
    const ratcheted = RATCHETED_RULES.includes(finding.rule);
    if (ratcheted && !over.some((o) => o.rule === finding.rule)) held.push(finding);
    else failing.push(finding);
  }
  return { failing, held, over, loose };
}

/**
 * Check a docs-content tree that has already been read.
 *
 * Every finding is returned, the ratcheted rules' included: applyDocsContentRatchet sorts out which
 * of those fail for a library. The rules on kinds run once the sidebar parses.
 *
 * @param {{ pages: { name: string, text: string }[], sidebars: string | null, misplaced?: string[], reference?: Map<string, string>, sources?: Map<string, string>, examples?: { file: string, text: string }[] }} input
 *   `pages` are the `.md` files at the top of docs-content/, by file name without `.md`; `sidebars`
 *   is the text of sidebars.json, or null when there is none; `misplaced` are the paths, relative to
 *   docs-content/, of markdown that is not a top-level `.md` page and is not under api/;
 *   `reference` holds the generated `.md` pages, by their path under api/; `sources` holds the
 *   files `held_by` names, by their path from the repository root; `examples` holds the runnable
 *   examples at the top of examples/, by file name.
 * @returns {{ file: string, line: number, rule: keyof typeof DOCS_CONTENT_RULES, message: string }[]}
 *   Every finding, in a stable order.
 */
export function checkDocsContent(input) {
  const findings = [];
  const add = (file, line, rule, message) => findings.push({ file, line, rule, message });
  const names = new Set(input.pages.map((page) => page.name));

  for (const path of input.misplaced ?? []) {
    add(
      path,
      0,
      "file-name",
      "a page is a .md file at the top of docs-content/: move or rename it",
    );
  }

  for (const page of input.pages) {
    const file = `${page.name}.md`;
    if (!PAGE_NAME.test(page.name)) {
      add(file, 0, "file-name", "a page name is lower-case words joined by single hyphens");
    }
    const { fields, errors, present } = parseFrontMatter(page.text);
    if (!present) {
      add(file, 1, "front-matter", "the page does not open with front matter (a first line ---)");
      continue;
    }
    for (const error of errors) add(file, error.line, "front-matter", error.message);
    for (const key of FRONT_MATTER_KEYS) {
      const field = fields.get(key);
      if (field === undefined) add(file, 1, "front-matter", `${key} is missing`);
      else if (field.value.trim() === "") add(file, field.line, "front-matter", `${key} is empty`);
    }
    for (const key of FORBIDDEN_KEYS) {
      const field = fields.get(key);
      if (field !== undefined) {
        add(file, field.line, "front-matter", `${key}: the sidebar sets the order, remove it`);
      }
    }
    const id = fields.get("id");
    if (id !== undefined && id.value !== page.name) {
      add(
        file,
        id.line,
        "front-matter",
        `id is "${id.value}"; it must be the file name, "${page.name}"`,
      );
    }
    const description = fields.get("description");
    if (description !== undefined && description.value.length > DESCRIPTION_LIMIT) {
      add(
        file,
        description.line,
        "front-matter",
        `description is ${description.value.length} characters; the limit is ${DESCRIPTION_LIMIT}`,
      );
    }
  }

  for (const page of REQUIRED_PAGES) {
    if (!names.has(page)) add(`${page}.md`, 0, "required-page", "every library has this page");
  }

  for (const page of input.pages) {
    if (!QUALITY_PAGES.includes(page.name)) continue;
    const lines = page.text.split(/\r?\n/);
    if (!lines.includes(NUMBERS_HEADING)) {
      add(
        `${page.name}.md`,
        0,
        "numbers",
        `the page has no "${NUMBERS_HEADING}" heading: the generated numbers go in that section`,
      );
    }
    lines.forEach((line, at) => {
      if (line === NUMBERS_HEADING && sectionText(lines, at) !== NUMBERS_PLACEHOLDER) {
        add(
          `${page.name}.md`,
          at + 1,
          "numbers",
          `the section holds only the placeholder until the release fills it in: "${NUMBERS_PLACEHOLDER}"`,
        );
      }
    });
  }

  // Each generated page's anchors, read once: a library has a handful of pages and links into them
  // from many.
  const reference = input.reference ?? new Map();
  const anchors = new Map([...reference].map(([path, text]) => [path, headingAnchors(text)]));
  for (const page of input.pages) {
    for (const link of referenceLinks(page.text)) {
      const fault = referenceFault(link.target, anchors);
      if (fault !== null) add(`${page.name}.md`, link.line, "reference-link", fault);
    }
  }

  if (input.sidebars === null) {
    add(SIDEBARS_FILE, 0, "sidebar", "there is no sidebars.json");
    return findings;
  }
  let sidebars;
  try {
    sidebars = JSON.parse(input.sidebars);
  } catch (error) {
    add(SIDEBARS_FILE, 0, "sidebar", `is not JSON: ${error.message}`);
    return findings;
  }
  const ids = checkSidebar(sidebars, (pointer, message) =>
    add(SIDEBARS_FILE, 0, "sidebar", `${pointer === "" ? "" : `at ${pointer}: `}${message}`),
  );

  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    if (!names.has(id)) add(SIDEBARS_FILE, 0, "listing", `lists "${id}", which is not a page`);
    else if (count > 1) add(SIDEBARS_FILE, 0, "listing", `lists "${id}" ${count} times`);
  }
  for (const page of input.pages) {
    if (!counts.has(page.name))
      add(`${page.name}.md`, 0, "listing", "the sidebar does not list it");
  }

  const kinds = pageKinds(sidebars);
  checkKinds(input.pages, kinds, input.sources ?? new Map(), add);
  checkExamples(input.pages, kinds, input.examples ?? [], add);
  return findings;
}

/**
 * Read docs-content/ under a repository root.
 *
 * @param {string} root The repository root.
 * @returns {{ pages: { name: string, text: string }[], sidebars: string | null, misplaced: string[], reference: Map<string, string>, sources: Map<string, string>, examples: { file: string, text: string }[], library: string | null }}
 * @throws {DocsContentRefusal} When the folder is missing or a file in it cannot be read.
 */
export function readDocsContent(root) {
  const docs = join(root, DOCS_DIR);
  if (!isDirectory(docs)) throw new DocsContentRefusal(`${docs} is not a directory.`);
  const pages = [];
  const misplaced = [];
  const reference = new Map();
  let sidebars = null;
  const generated = `${GENERATED_DIR}/`;
  const walk = (relative) => {
    // Node lists a directory in name order on Linux and macOS (libuv sorts the listing), so the
    // findings come out in one order without sorting here.
    for (const entry of readdirOrRefuse(join(docs, relative))) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
      } else if (path.startsWith(generated)) {
        // The generated pages are read for their headings, which links into the reference name.
        if (entry.name.endsWith(".md")) {
          reference.set(path.slice(generated.length), readOrRefuse(join(docs, path), entry));
        }
      } else if (path === SIDEBARS_FILE) {
        sidebars = readOrRefuse(join(docs, path), entry);
      } else if (relative === "" && entry.name.endsWith(".md")) {
        pages.push({ name: entry.name.slice(0, -3), text: readOrRefuse(join(docs, path), entry) });
      } else if (/\.mdx?$/i.test(entry.name)) {
        misplaced.push(path);
      }
    }
  };
  walk("");
  // The files a reference's `held_by` names, read so the check can see each one names its page. One
  // that is missing, or not a regular file, is left out, and the check reports it.
  const sources = new Map();
  for (const page of pages) {
    const held = parseFrontMatter(page.text).fields.get(HELD_BY_KEY)?.value;
    if (held === undefined || !isHeldByPath(held) || sources.has(held)) continue;
    const path = join(root, held);
    if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) continue;
    sources.set(held, readOrRefuse(path, { isFile: () => true }));
  }
  const examples = readExamples(root);
  return {
    pages,
    sidebars,
    misplaced,
    reference,
    sources,
    examples,
    library: readLibraryName(root),
  };
}

/**
 * The name in a repository's package.json, which the ratchet records a library's counts under.
 *
 * @param {string} root The repository root.
 * @returns {string | null} The name, or null when there is no package.json with a string name.
 */
function readLibraryName(root) {
  try {
    // Stryker disable next-line StringLiteral: with no encoding Node returns a Buffer, which JSON.parse reads as UTF-8 text, so the name is the same.
    const name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/**
 * Whether a path is a directory, without following a symbolic link.
 *
 * @param {string} path A path.
 * @returns {boolean} True for a directory.
 */
function isDirectory(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/**
 * List a directory, refusing when it cannot be listed.
 *
 * @param {string} directory A directory.
 * @returns {import("node:fs").Dirent[]} Its entries, typed without following a link.
 */
function readdirOrRefuse(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new DocsContentRefusal(`${directory} could not be listed (${error.code}).`);
  }
}

/**
 * Read a regular file, refusing anything else.
 *
 * @param {string} path The file.
 * @param {import("node:fs").Dirent} entry Its directory entry.
 * @returns {string} Its text.
 */
function readOrRefuse(path, entry) {
  if (!entry.isFile()) throw new DocsContentRefusal(`${path} is not a regular file.`);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new DocsContentRefusal(`${path} could not be read (${error.code}).`);
  }
}

/**
 * The command line: check docs-content/ in a repository and report.
 *
 * The findings of the ratcheted rules are held to the counts the ratchet records for the library
 * (the name in the repository's package.json); warnings, held findings and counts that can be
 * lowered go to stdout, and never change the exit code.
 *
 * @param {{ argv?: string[], dir?: string, stdout?: { write(text: string): unknown }, stderr?: { write(text: string): unknown }, ratchet?: Readonly<Record<string, Readonly<Record<string, number>>>> }} [options]
 * @returns {number} 0 clean, 1 a finding, 2 the check could not run.
 */
export function runDocsContentCheck(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let dir = options.dir ?? process.cwd();
  let write = false;
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--write") {
      write = true;
    } else {
      stderr.write(
        `docs-content: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          `--dir <repository root> and --write). Nothing was checked.\n`,
      );
      return 2;
    }
  }
  let input;
  try {
    if (write) {
      for (const file of writeExamplePages(resolve(dir))) {
        stdout.write(`docs-content: wrote ${DOCS_DIR}/${file}\n`);
      }
    }
    input = readDocsContent(resolve(dir));
  } catch (error) {
    // Every way reading fails is a refusal: the folder, a listing and a file each raise one.
    stderr.write(`docs-content: ${error.message} Nothing was checked.\n`);
    return 2;
  }
  const library = input.library ?? null;
  const ratchet = options.ratchet ?? DOCS_CONTENT_RATCHET;
  // Stryker disable next-line ConditionalExpression,LogicalOperator: a library the ratchet does not record reads as undefined, which applyDocsContentRatchet takes as {}; Object.hasOwn only keeps out an inherited key such as constructor, which holds no rule's count either.
  const allowance = library !== null && Object.hasOwn(ratchet, library) ? ratchet[library] : {};
  const { failing, held, over, loose } = applyDocsContentRatchet(
    checkDocsContent(input),
    allowance,
  );
  const where = (f) =>
    `  ${DOCS_DIR}/${f.file}${f.line > 0 ? `:${f.line}` : ""} [${f.rule}] ${f.message}`;
  const notes = [];
  for (const warning of docsContentWarnings(input)) notes.push(`${where(warning)} (a warning)`);
  if (held.length > 0) {
    notes.push(
      `docs-content: ${held.length} finding(s) held by the ratchet for ${library}, at or under ` +
        "the counts docs-content-ratchet.json in @cosyte/script-utils records:",
      ...held.map(where),
    );
  }
  for (const { rule, count, allowed } of loose) {
    notes.push(
      `docs-content: [${rule}] is down to ${count} from the ${allowed} recorded for ${library}: ` +
        "lower its count in docs-content-ratchet.json in @cosyte/script-utils",
    );
  }
  if (notes.length > 0) stdout.write(`${notes.join("\n")}\n`);
  if (failing.length === 0) {
    stdout.write(`docs-content: OK (${input.pages.length} page(s) checked)\n`);
    return 0;
  }
  const overLines = over.map(
    ({ rule, count, allowed }) =>
      `docs-content: [${rule}] has ${count} finding(s), over the ${allowed} recorded for ` +
      `${library ?? "this repository"}, so each one fails.`,
  );
  stderr.write(
    `docs-content: ${failing.length} finding(s) in ${input.pages.length} page(s).\n` +
      failing.map(where).join("\n") +
      "\n" +
      overLines.map((line) => `${line}\n`).join(""),
  );
  return 1;
}
