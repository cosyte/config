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
// WHAT IT DOES NOT CHECK. Any other link, and images: the shared CI's docs-content link check
// resolves those. The pages under `api/` themselves: the reference generator writes them and checks
// them itself; here they are only read for their headings. Whether a sample runs: the sample runner
// in @cosyte/vitest-config does that. Whether the prose is good, or whether a page sits in the
// category its content belongs to: nothing here can judge either, so review does.
//
// Zero dependencies, like the rest of this package: the front matter is read by hand, for the one
// form the standard allows (one `key: value` per line), rather than by a YAML parser.

import { lstatSync, readFileSync, readdirSync } from "node:fs";
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
});

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
 * Check a docs-content tree that has already been read.
 *
 * @param {{ pages: { name: string, text: string }[], sidebars: string | null, misplaced?: string[], reference?: Map<string, string> }} input
 *   `pages` are the `.md` files at the top of docs-content/, by file name without `.md`; `sidebars`
 *   is the text of sidebars.json, or null when there is none; `misplaced` are the paths, relative to
 *   docs-content/, of markdown that is not a top-level `.md` page and is not under api/;
 *   `reference` holds the generated `.md` pages, by their path under api/.
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
  return findings;
}

/**
 * Read docs-content/ under a repository root.
 *
 * @param {string} root The repository root.
 * @returns {{ pages: { name: string, text: string }[], sidebars: string | null, misplaced: string[], reference: Map<string, string> }}
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
  return { pages, sidebars, misplaced, reference };
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
 * @param {{ argv?: string[], dir?: string, stdout?: { write(text: string): unknown }, stderr?: { write(text: string): unknown } }} [options]
 * @returns {number} 0 clean, 1 a finding, 2 the check could not run.
 */
export function runDocsContentCheck(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let dir = options.dir ?? process.cwd();
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else {
      stderr.write(
        `docs-content: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          `--dir <repository root>). Nothing was checked.\n`,
      );
      return 2;
    }
  }
  let input;
  try {
    input = readDocsContent(resolve(dir));
  } catch (error) {
    // Every way reading fails is a refusal: the folder, a listing and a file each raise one.
    stderr.write(`docs-content: ${error.message} Nothing was checked.\n`);
    return 2;
  }
  const findings = checkDocsContent(input);
  if (findings.length === 0) {
    stdout.write(`docs-content: OK (${input.pages.length} page(s) checked)\n`);
    return 0;
  }
  stderr.write(
    `docs-content: ${findings.length} finding(s) in ${input.pages.length} page(s).\n` +
      findings
        .map(
          (f) =>
            `  ${DOCS_DIR}/${f.file}${f.line > 0 ? `:${f.line}` : ""} [${f.rule}] ${f.message}`,
        )
        .join("\n") +
      "\n",
  );
  return 1;
}
