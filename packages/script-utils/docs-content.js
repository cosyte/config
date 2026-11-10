// The docs-content structure check: the shape every library's `docs-content/` folder takes, read
// from the folder itself. The standard it checks is documentation/decisions/0006 in cosyte/config.
//
// WHAT IT CHECKS. The sidebar's shape (one `docs` sidebar: the overview, the categories in their
// fixed order, then the two quality pages), that every page is listed exactly once and every listed
// id is a page, that the required pages exist, the front matter of every page, file names, and that
// both quality pages carry the section their generated numbers go in.
//
// WHAT IT DOES NOT CHECK. Links and images: the shared CI's docs-content link check resolves those,
// and this check does not read a link. The pages under `api/`: the reference generator writes them
// and checks them itself. Whether a sample runs: the sample runner in @cosyte/vitest-config does
// that. Whether the prose is good, or whether a page sits in the category its content belongs to:
// nothing here can judge either, so review does.
//
// Zero dependencies, like the rest of this package: the front matter is read by hand, for the one
// form the standard allows (one `key: value` per line), rather than by a YAML parser.

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** The folder this check reads, at the repository root. */
export const DOCS_DIR = "docs-content";

/** The sidebar file inside it. */
export const SIDEBARS_FILE = "sidebars.json";

/** The folder the reference generator owns. Nothing under it is read here. */
export const GENERATED_DIR = "api";

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
  numbers: `both quality pages carry the "${NUMBERS_HEADING.slice(3)}" section`,
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
 * Check a docs-content tree that has already been read.
 *
 * @param {{ pages: { name: string, text: string }[], sidebars: string | null, misplaced?: string[] }} input
 *   `pages` are the `.md` files at the top of docs-content/, by file name without `.md`; `sidebars`
 *   is the text of sidebars.json, or null when there is none; `misplaced` are the paths, relative to
 *   docs-content/, of markdown that is not a top-level `.md` page and is not under api/.
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
    if (!page.text.split(/\r?\n/).includes(NUMBERS_HEADING)) {
      add(
        `${page.name}.md`,
        0,
        "numbers",
        `the page has no "${NUMBERS_HEADING}" heading: the generated numbers go in that section`,
      );
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
 * @returns {{ pages: { name: string, text: string }[], sidebars: string | null, misplaced: string[] }}
 * @throws {DocsContentRefusal} When the folder is missing or a file in it cannot be read.
 */
export function readDocsContent(root) {
  const docs = join(root, DOCS_DIR);
  if (!isDirectory(docs)) throw new DocsContentRefusal(`${docs} is not a directory.`);
  const pages = [];
  const misplaced = [];
  let sidebars = null;
  const walk = (relative) => {
    // Node lists a directory in name order on Linux and macOS (libuv sorts the listing), so the
    // findings come out in one order without sorting here.
    for (const entry of readdirOrRefuse(join(docs, relative))) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== GENERATED_DIR) walk(path);
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
  return { pages, sidebars, misplaced };
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
