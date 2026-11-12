#!/usr/bin/env node
// scripts/standards-pages.mjs
//
// THE TESTING AND PERFORMANCE STANDARDS AS docs.cosyte.com PAGES, WRITTEN FROM THEIR DECISION
// RECORDS SO THERE IS ONE SOURCE.
//
// Every library's "Testing and quality" and "Performance" pages send a reader to the standard they
// are measured against. Those standards are decision records in this repository's
// `documentation/decisions/`, which docs.cosyte.com does not render. This writes each one as a page
// under `docs-content/`, the folder a release packs into `docs-content.tar.gz` for the site, so the
// libraries can link to the site instead of to GitHub.
//
// THE RECORD IS THE SOURCE AND THE PAGE IS WRITTEN FROM IT. A hand copy would drift from the record
// the first time the record is amended, and nothing would say so. So the page is the record with
// front matter in place of its title, a line naming the record, and its relative links rewritten:
// a link to another record that is a page becomes a link to that page, and any other link into this
// repository becomes its address on GitHub, since the site has none of those files. The result is
// formatted with this repository's Prettier, so `pnpm format:check` and this agree.
//
//   node scripts/standards-pages.mjs           write the pages
//   node scripts/standards-pages.mjs --check   write nothing; exit 1 if a page differs from its record
//   --root <dir>                               the repository root (default: this checkout)
//
// It refuses (exit 1, naming the file and line) a relative link whose target is not in the tree, and
// a brace or an angle bracket outside code, which the site's MDX build would read as markup. Exit 0
// is clean, 1 a finding, 2 it could not run: a record it could not read, or an unknown argument.

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

/** Where the decision records live, relative to the repository root. */
export const RECORDS_DIR = "documentation/decisions";

/** The folder docs.cosyte.com renders, relative to the repository root. */
export const DOCS_DIR = "docs-content";

/** Where a link into this repository points once it is on the site. */
export const REPOSITORY_URL = "https://github.com/cosyte/config";

/**
 * The pages, each with the record it is written from and the front matter the site reads.
 * `description` is one sentence of at most 160 characters, the length a search result shows.
 */
export const PAGES = Object.freeze([
  Object.freeze({
    id: "testing-standard",
    record: "0004-the-testing-standard.md",
    title: "The testing standard",
    sidebarLabel: "Testing standard",
    description:
      "How every Cosyte package is tested: a coverage floor that only rises, a change's own code at 100%, mutation testing and property-based tests.",
  }),
  Object.freeze({
    id: "performance-standard",
    record: "0005-the-performance-standard.md",
    title: "The performance standard",
    sidebarLabel: "Performance standard",
    description:
      "How every Cosyte package measures its speed, memory, import time and bundle size, how much noise each instrument has, and what it cannot detect.",
  }),
]);

/** A refusal the run cannot recover from: exit 2. */
export class StandardsPagesError extends Error {}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /\]\(([^)\s]+)\)/g;
const DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(\S+)/gm;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * A line split into the parts outside code spans (even indexes) and inside them (odd indexes).
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCodeSpans(line) {
  const parts = [];
  let text = "";
  let at = 0;
  while (at < line.length) {
    if (line[at] !== "`") {
      text += line[at];
      at += 1;
      continue;
    }
    let length = 1;
    while (line[at + length] === "`") length += 1;
    const run = "`".repeat(length);
    let close = line.indexOf(run, at + length);
    while (close !== -1 && line[close + length] === "`") {
      let skip = close;
      while (line[skip] === "`") skip += 1;
      close = line.indexOf(run, skip);
    }
    if (close === -1) {
      text += run;
      at += length;
      continue;
    }
    parts.push(text, line.slice(at, close + length));
    text = "";
    at = close + length;
  }
  parts.push(text);
  return parts;
}

/**
 * Where a relative link in a record points once it is a page: another page, or GitHub.
 *
 * @param {string} target the link destination as the record writes it
 * @param {{ root: string, pages: readonly { id: string, record: string }[] }} context
 * @returns {string | null} the new destination, or null when the target is not in the tree
 */
export function rewriteTarget(target, { root, pages }) {
  if (EXTERNAL.test(target)) return target;
  const hash = target.indexOf("#");
  const path = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? "" : target.slice(hash);
  const inRepo = posix.normalize(posix.join(RECORDS_DIR, path)).replace(/\/$/, "");
  if (inRepo.startsWith("../") || inRepo === "..") return null;
  const page = pages.find((p) => posix.join(RECORDS_DIR, p.record) === inRepo);
  if (page) return `./${page.id}.md${anchor}`;
  const stats = statSync(join(root, inRepo), { throwIfNoEntry: false });
  if (stats === undefined) return null;
  const kind = stats.isDirectory() ? "tree" : "blob";
  return `${REPOSITORY_URL}/${kind}/main/${inRepo}${anchor}`;
}

/**
 * One paragraph of a record, its links rewritten, as lines; a refusal goes into `findings`.
 *
 * @param {string} text the paragraph, its lines joined with newlines
 * @param {number} firstLine the record's line number of its first line
 * @param {(line: number) => string} where names a line of the record
 * @param {{ root: string, pages: readonly { id: string, record: string }[] }} context
 * @param {string[]} findings
 * @returns {string[]}
 */
function proseFromRecord(text, firstLine, where, context, findings) {
  const parts = splitCodeSpans(text);
  let offset = 0;
  for (let p = 0; p < parts.length; p += 1) {
    const part = parts[p];
    const lineAt = (at) => firstLine + text.slice(0, offset + at).split("\n").length - 1;
    if (p % 2 === 0) {
      const rewrite = (target, at) => {
        const next = rewriteTarget(target, context);
        if (next === null)
          findings.push(`${where(lineAt(at))}: "${target}" is not in this repository`);
        return next ?? target;
      };
      // A reference definition starts a line, so one at the very start of a part that follows a
      // code span is not one.
      parts[p] = part
        .replace(DEFINITION, (match, lead, target, at) =>
          at === 0 && p > 0 ? match : lead + rewrite(target, at),
        )
        .replace(INLINE_LINK, (_, target, at) => `](${rewrite(target, at)})`);
      const markup = /[{}<]/.exec(part);
      if (markup) {
        findings.push(
          `${where(lineAt(markup.index))}: a brace or an angle bracket outside code, which the site's MDX build reads as markup; put it in code`,
        );
      }
    }
    offset += part.length;
  }
  return parts.join("").split("\n");
}

/**
 * A record turned into the body of its page, before formatting, with what it could not accept.
 *
 * @param {string} text the record
 * @param {{ id: string, record: string, title: string, sidebarLabel: string, description: string }} page
 * @param {{ root: string, pages: readonly { id: string, record: string }[] }} context
 * @returns {{ text: string, findings: string[] }}
 */
export function pageFromRecord(text, page, context) {
  const findings = [];
  const where = (n) => `${RECORDS_DIR}/${page.record}:${n}`;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const title = lines.findIndex((line) => /^# \S/.test(line));
  if (title === -1) {
    findings.push(`${where(1)}: the record has no "# " title line to replace`);
    return { text: "", findings };
  }
  const body = [];
  // A paragraph is held until a blank line or a fence ends it, because a code span may run across
  // the lines of one paragraph (and never past it): read line by line, the second half of such a
  // span would look like prose.
  let paragraph = [];
  let paragraphStart = 0;
  const flush = () => {
    if (paragraph.length === 0) return;
    body.push(...proseFromRecord(paragraph.join("\n"), paragraphStart, where, context, findings));
    paragraph = [];
  };
  let fence = null;
  for (let i = title + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const opener = FENCE.exec(line);
    if (fence !== null) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      body.push(line);
      continue;
    }
    if (opener) {
      flush();
      fence = opener[1];
      body.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      body.push(line);
      continue;
    }
    if (paragraph.length === 0) paragraphStart = i + 1;
    paragraph.push(line);
  }
  flush();
  const source = `${RECORDS_DIR}/${page.record}`;
  const head = [
    "---",
    `id: ${page.id}`,
    `title: ${page.title}`,
    `sidebar_label: ${page.sidebarLabel}`,
    `description: ${JSON.stringify(page.description)}`,
    "---",
    "",
    `This page is the decision record [\`${source}\`](${REPOSITORY_URL}/blob/main/${source}) in`,
    "cosyte/config, written out for this site. The record is the source: a change is made there.",
  ];
  return { text: `${[...head, ...body].join("\n").replace(/\n+$/, "")}\n`, findings };
}

/**
 * Format a page the way `pnpm format` would, with this repository's Prettier configuration. The
 * configuration is the one of the checkout this script is in, whatever `--root` names, so a page
 * is formatted the same wherever it is written.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function formatPage(text) {
  const prettier = await import("prettier");
  const filepath = join(dirname(fileURLToPath(import.meta.url)), "..", DOCS_DIR, "page.md");
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...options, filepath });
}

/**
 * A file's text, or null when there is no file: one read, with no separate check before it.
 *
 * @param {string} path
 * @returns {string | null}
 */
function readIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Write, or with `check` compare, every page.
 *
 * @param {{ root: string, check: boolean, pages?: typeof PAGES, log?: (line: string) => void }} options
 * @returns {Promise<number>} the exit code: 0 clean, 1 a finding
 */
export async function run({ root, check, pages = PAGES, log = console.log }) {
  const findings = [];
  const outputs = [];
  for (const page of pages) {
    const recordPath = join(root, RECORDS_DIR, page.record);
    let text;
    try {
      text = readFileSync(recordPath, "utf8");
    } catch (error) {
      throw new StandardsPagesError(
        `could not read ${relative(root, recordPath)}: ${/** @type {Error} */ (error).message}`,
      );
    }
    const made = pageFromRecord(text, page, { root, pages });
    findings.push(...made.findings);
    const target = join(root, DOCS_DIR, `${page.id}.md`);
    outputs.push({ target, text: made.text });
  }
  if (findings.length > 0) {
    for (const finding of findings) log(`standards-pages: ${finding}`);
    log(`standards-pages: ${findings.length} finding(s); no page written.`);
    return 1;
  }
  let stale = 0;
  for (const output of outputs) {
    const formatted = await formatPage(output.text);
    const name = relative(root, output.target);
    const current = readIfPresent(output.target);
    if (current === formatted) continue;
    if (check) {
      stale += 1;
      log(
        `standards-pages: ${name} ${current === null ? "is missing" : "differs from its record"}; run node scripts/standards-pages.mjs`,
      );
    } else {
      writeFileSync(output.target, formatted);
      log(`standards-pages: wrote ${name}`);
    }
  }
  if (stale > 0) return 1;
  log(
    `standards-pages: ${outputs.length} page(s) ${check ? "match their records" : "up to date"}.`,
  );
  return 0;
}

/**
 * The command line: `[--check] [--root <dir>]`.
 *
 * @param {string[]} argv
 * @returns {{ check: boolean, root: string }}
 */
export function parseArgs(argv) {
  let check = false;
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--root" && argv[i + 1] !== undefined) root = resolve(argv[(i += 1)]);
    else
      throw new StandardsPagesError(
        `unknown argument "${argv[i]}"; usage: [--check] [--root <dir>]`,
      );
  }
  return { check, root };
}

if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exitCode = await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    // Anything that stopped the run is "could not run", never a finding and never clean.
    console.error(`standards-pages: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
