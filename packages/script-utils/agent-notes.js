// @cosyte/script-utils/agent-notes
//
// THE AGENT-NOTES CHECKER (RD4). A repository's CLAUDE.md card stays short, and what does not fit in
// it lives in ONE file, `documentation/agent-notes.md`, which the card points into with ONE form:
// `documentation/agent-notes.md#<anchor>`. This checker replaces the eight per-repository checkers
// (mllp, ccda, ncpdp, astm, terminology, transform, deid and cli), keeping every rule they shared and
// resolving the ones they disagreed on; the README section "The agent-notes checker" lists both.
//
// THE RULES, each one id a finding names:
//
//   layout        the notes are one file: no `documentation/agent-notes/` directory, and the card
//                 does not point into one
//   pointer-form  in CLAUDE.md, a pointer is `documentation/agent-notes.md#<anchor>`: not a bare
//                 `#anchor` in backticks, not `agent-notes.md#` without the directory, not `./...`
//   dangling      every pointer, in any tracked file, names an anchor the notes have: a heading's
//                 GitHub slug, or an explicit `<a id>` or `<a name>`
//   notes-missing a pointer exists and the notes file does not
//   no-pointer    the notes exist and CLAUDE.md never points into them
//   blank         the notes file is empty, or has no heading
//   empty-section a heading with nothing under it (a heading followed by a deeper one is a container
//                 and is not empty)
//   stale-citation the notes cite the umbrella's deleted ADR 0023 or its doc-budget hook
//
// The corpus is every file `git ls-files` lists. A file holding a NUL byte is skipped and counted,
// and so is anything that is not a regular file (a symlink is never followed). A pointer is found by
// one pattern in every file, so a source comment that cites the notes is held to the same anchor.
//
// EXIT CODES, the contract every gate here keeps: 0 clean, 1 a finding, 2 the check could not run
// (not a git repository, an unreadable tracked file, an unterminated HTML comment in the notes, or an
// argument it does not accept). Every route that did not finish exits non-zero.
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCliEntrypoint } from "./index.js";

/** The one place the notes live. */
export const NOTES_PATH = "documentation/agent-notes.md";

/** The directory layout the one-file rule retires. */
const NOTES_DIRECTORY = "documentation/agent-notes/";

/** The characters an anchor may carry. A trailing `.` is prose, not anchor. */
const ANCHOR = "[\\p{L}\\p{N}_-]+";

/** Every rule id a finding can carry, with what it requires. */
export const AGENT_NOTES_RULES = Object.freeze({
  layout: `The notes are one file, ${NOTES_PATH}, not a directory.`,
  "pointer-form": `CLAUDE.md points into the notes as ${NOTES_PATH}#<anchor>, and in no other form.`,
  dangling: "Every pointer names an anchor the notes have.",
  "notes-missing": "A pointer exists only when the notes do.",
  "no-pointer": "When the notes exist, CLAUDE.md points into them at least once.",
  blank: "The notes file is not empty and has at least one heading.",
  "empty-section": "No heading is empty, except a container followed by a deeper heading.",
  "stale-citation": "The notes do not cite the umbrella's deleted ADR 0023 or its doc-budget hook.",
});

/** Exit 2: the check could not run. */
export class AgentNotesRefusal extends Error {}

/**
 * Link text in place of a link, as GitHub does before it slugs a heading: `[text](url)` becomes
 * `text`. Read with `indexOf` rather than one global pattern, which backtracks polynomially on a run
 * of unclosed `[](` and is run on text this check does not control.
 */
function stripInline(text) {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("[", at);
    if (open < 0) break;
    const close = text.indexOf("]", open + 1);
    if (close < 0) break;
    if (text[close + 1] !== "(") {
      out += text.slice(at, close + 1);
      at = close + 1;
      continue;
    }
    const end = text.indexOf(")", close + 2);
    if (end < 0) break;
    out += text.slice(at, open) + text.slice(open + 1, close);
    at = end + 1;
  }
  return out + text.slice(at);
}

/**
 * GitHub's heading slug: lower case, every character that is not a letter, a number, a space, `-`
 * or `_` dropped, and each space a hyphen. A transcription of github-slugger, which matched GitHub
 * on all twelve notes files the per-repository checkers read.
 *
 * @param {string} text Heading text.
 * @returns {string}
 */
export function slugify(text) {
  return stripInline(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .replace(/ /g, "-");
}

/**
 * A slugger that suffixes repeats the way GitHub does: the second `Setup` is `setup-1`.
 *
 * @returns {(text: string) => string}
 */
export function makeSlugger() {
  const occurrences = new Map();
  return (text) => {
    const original = slugify(text);
    let result = original;
    while (occurrences.has(result)) {
      occurrences.set(original, (occurrences.get(original) ?? 0) + 1);
      result = `${original}-${String(occurrences.get(original))}`;
    }
    occurrences.set(result, 0);
    return result;
  };
}

/** An ATX heading's level and text, or `null`, read with index arithmetic (no backtracking). */
function atxHeading(line) {
  let indent = 0;
  while (indent < 3 && line[indent] === " ") indent += 1;
  let level = 0;
  while (line[indent + level] === "#") level += 1;
  if (level === 0 || level > 6) return null;
  const after = line[indent + level];
  if (after !== undefined && after !== " " && after !== "\t") return null;
  let text = line.slice(indent + level).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === 0) text = "";
  else if (end < text.length && (text[end - 1] === " " || text[end - 1] === "\t")) {
    text = text.slice(0, end).trimEnd();
  }
  return { level, text };
}

/**
 * The headings and explicit anchors of a notes file, with each section's emptiness.
 *
 * Fenced code, a leading YAML front matter block and HTML comments carry no heading. ATX headings
 * (up to three leading spaces, closing hashes stripped) and setext headings both count.
 *
 * @param {string} text The notes file.
 * @returns {{ targets: Set<string>, headings: { level: number, text: string, line: number,
 *   slug: string, empty: boolean }[] }}
 * @throws {AgentNotesRefusal} On an HTML comment that never closes.
 */
export function readNotes(text) {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const slug = makeSlugger();
  const headings = [];
  const content = new Array(lines.length).fill(false);
  let fence = null;
  let comment = -1;
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) start = close + 1;
  }
  let paragraph = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (comment >= 0) {
      if (line.includes("-->")) comment = -1;
      continue;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      content[i] = true;
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      content[i] = true;
      paragraph = [];
      continue;
    }
    if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) {
      comment = i;
      paragraph = [];
      continue;
    }
    const atx = atxHeading(line);
    if (atx !== null) {
      headings.push({ ...atx, line: i });
      paragraph = [];
      continue;
    }
    const underline = line.trim();
    if (
      paragraph.length > 0 &&
      /^ {0,3}\S/.test(line) &&
      (/^=+$/.test(underline) || /^-+$/.test(underline))
    ) {
      const level = underline[0] === "=" ? 1 : 2;
      const first = paragraph[0];
      for (const index of paragraph) content[index] = false;
      headings.push({ level, text: paragraph.map((j) => lines[j].trim()).join("\n"), line: first });
      paragraph = [];
      continue;
    }
    if (line.trim() === "") {
      paragraph = [];
      continue;
    }
    // An explicit anchor alone on its line marks a place; it is not content of the section.
    if (/^<a\s[^>]*>(?:<\/a>)?$/.test(line.trim())) continue;
    content[i] = true;
    paragraph.push(i);
  }
  if (comment >= 0) {
    throw new AgentNotesRefusal(
      `${NOTES_PATH}:${comment + 1} opens an HTML comment that never closes, so where the notes ` +
        `end could not be read.`,
    );
  }
  headings.sort((a, b) => a.line - b.line);
  const targets = new Set();
  for (const [index, heading] of headings.entries()) {
    heading.slug = slug(heading.text);
    targets.add(heading.slug);
    const next = headings[index + 1];
    const until = next === undefined ? lines.length : next.line;
    const hasBody = content.slice(heading.line + 1, until).some(Boolean);
    heading.empty = !hasBody && !(next !== undefined && next.level > heading.level);
  }
  // Explicit anchors, `<a id="x">` or `<a name="x">`, read one tag at a time.
  let at = text.indexOf("<a");
  while (at >= 0) {
    const close = text.indexOf(">", at);
    if (close < 0) break;
    const tag = text.slice(at, close);
    if (/^<a\s/.test(tag)) {
      const attribute = /\b(?:id|name)\s*=\s*"([^"]+)"/.exec(tag);
      if (attribute !== null) targets.add(attribute[1]);
    }
    at = text.indexOf("<a", close);
  }
  return { targets, headings };
}

/** Every qualified pointer in a text: `[prefix]agent-notes.md#anchor`, with its line. */
function qualifiedPointers(text) {
  const found = [];
  const pattern = new RegExp(
    `(?<![\\w/.-])((?:\\.{1,2}/)*(?:documentation/)?)agent-notes\\.md#(${ANCHOR})`,
    "gu",
  );
  for (const match of text.matchAll(pattern)) {
    found.push({
      prefix: match[1],
      anchor: match[2],
      line: text.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

/**
 * Check the notes and every pointer into them.
 *
 * @param {{ claude: string | null, notes: string | null, notesDirectory?: boolean,
 *   localDecision0023?: boolean, files: { path: string, text: string }[] }} input
 *   `claude` and `notes` are the two files' contents, or `null` when absent; `files` is every other
 *   tracked text file to scan for pointers.
 * @returns {{ rule: string, file: string, line: number, message: string }[]}
 * @throws {AgentNotesRefusal} When the notes cannot be read to the end.
 */
export function checkAgentNotes(input) {
  const findings = [];
  const add = (rule, file, line, message) => findings.push({ rule, file, line, message });
  const { claude, notes } = input;

  if (input.notesDirectory) {
    add(
      "layout",
      NOTES_DIRECTORY,
      0,
      `the notes are one file, ${NOTES_PATH}; fold the files under ${NOTES_DIRECTORY} into it.`,
    );
  }

  let read = { targets: new Set(), headings: [] };
  if (notes !== null) {
    if (notes.trim() === "") {
      add("blank", NOTES_PATH, 0, "the notes file is empty.");
    } else {
      read = readNotes(notes);
      if (read.headings.length === 0) add("blank", NOTES_PATH, 0, "the notes file has no heading.");
      for (const heading of read.headings) {
        if (heading.empty) {
          add(
            "empty-section",
            NOTES_PATH,
            heading.line + 1,
            `the section "${heading.text}" is empty.`,
          );
        }
      }
      notes.split("\n").forEach((line, index) => {
        const deleted =
          /doc-budget/i.test(line) ||
          /0023-doc-budgets/.test(line) ||
          (!input.localDecision0023 && /\bADR[ -]?0023\b/.test(line));
        if (deleted) {
          add(
            "stale-citation",
            NOTES_PATH,
            index + 1,
            "this cites the umbrella's deleted ADR 0023 or its doc-budget hook, neither of which " +
              "exists; the card spec (documentation/claude-card.md in cosyte/config) sets the budget now.",
          );
        }
      });
    }
  }

  const sources = [
    ...(claude === null ? [] : [{ path: "CLAUDE.md", text: claude }]),
    ...(notes === null ? [] : [{ path: NOTES_PATH, text: notes }]),
    ...input.files,
  ];
  let fromCard = 0;
  for (const { path, text } of sources) {
    for (const pointer of qualifiedPointers(text)) {
      if (path === "CLAUDE.md") {
        fromCard += 1;
        if (pointer.prefix !== "documentation/") {
          add(
            "pointer-form",
            path,
            pointer.line,
            `write the pointer as ${NOTES_PATH}#${pointer.anchor}, the one form.`,
          );
        }
      }
      if (notes === null) {
        add(
          "notes-missing",
          path,
          pointer.line,
          `this points at ${NOTES_PATH}, which does not exist.`,
        );
      } else if (!read.targets.has(pointer.anchor)) {
        add(
          "dangling",
          path,
          pointer.line,
          `#${pointer.anchor} names no heading or anchor in ${NOTES_PATH}.`,
        );
      }
    }
    if (path === NOTES_PATH) {
      for (const match of text.matchAll(new RegExp(`\\]\\(#(${ANCHOR})\\)`, "gu"))) {
        if (!read.targets.has(match[1])) {
          add(
            "dangling",
            path,
            text.slice(0, match.index).split("\n").length,
            `#${match[1]} names no heading or anchor in this file.`,
          );
        }
      }
    }
  }

  if (claude !== null) {
    const lines = claude.split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(new RegExp("`#(" + ANCHOR + ")`", "gu"))) {
        if (/^\p{Nd}+$/u.test(match[1])) continue;
        add(
          "pointer-form",
          "CLAUDE.md",
          index + 1,
          `a bare \`#${match[1]}\` is not a pointer anyone can follow; write ` +
            `${NOTES_PATH}#${match[1]}.`,
        );
      }
      if (line.includes(NOTES_DIRECTORY)) {
        add(
          "layout",
          "CLAUDE.md",
          index + 1,
          `this points into ${NOTES_DIRECTORY}; the notes are one file, ${NOTES_PATH}.`,
        );
      }
    });
    if (notes !== null && fromCard === 0) {
      add(
        "no-pointer",
        "CLAUDE.md",
        0,
        `${NOTES_PATH} exists and CLAUDE.md never points into it; point at the sections a ` +
          `session needs as ${NOTES_PATH}#<anchor>.`,
      );
    }
  }
  return findings;
}

/** The tracked files of a repository: regular files read, everything else counted. */
function trackedFiles(dir) {
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "-z", "-s"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new AgentNotesRefusal(`could not list the tracked files of ${dir}: ${err.message}`);
  }
  const files = [];
  const skipped = [];
  for (const record of listing.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const mode = record.slice(0, 6);
    const path = record.slice(tab + 1);
    if (mode !== "100644" && mode !== "100755") {
      skipped.push(path);
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(join(dir, path));
    } catch (err) {
      throw new AgentNotesRefusal(`could not read the tracked file ${path}: ${err.message}`);
    }
    if (bytes.includes(0)) {
      skipped.push(path);
      continue;
    }
    files.push({ path, text: bytes.toString("utf8") });
  }
  return { files, skipped };
}

/**
 * Run the checker over one repository and return the exit code. It never exits the process.
 *
 * @param {{ dir?: string, argv?: string[] }} [options] `dir` is the repository root (default: the
 *   working directory). `argv` is the CLI arguments, read only for `--dir <path>`.
 * @returns {0 | 1 | 2}
 */
export function runAgentNotesCheck(options = {}) {
  let dir = options.dir ?? process.cwd();
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] !== "--") {
      process.stderr.write(
        `agent notes: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          `--dir <repository root>). Nothing was checked.\n`,
      );
      return 2;
    }
  }
  dir = resolve(dir);
  try {
    const { files, skipped } = trackedFiles(dir);
    const byPath = new Map(files.map((file) => [file.path, file.text]));
    const claude = byPath.get("CLAUDE.md") ?? null;
    const notes = byPath.get(NOTES_PATH) ?? null;
    const others = files.filter((f) => f.path !== "CLAUDE.md" && f.path !== NOTES_PATH);
    const decisions = join(dir, "documentation", "decisions");
    const findings = checkAgentNotes({
      claude,
      notes,
      files: others,
      notesDirectory: files.some((f) => f.path.startsWith(NOTES_DIRECTORY)),
      localDecision0023:
        existsSync(decisions) && readdirSync(decisions).some((name) => name.startsWith("0023-")),
    });
    if (findings.length === 0) {
      process.stdout.write(
        `agent notes: OK (${files.length} tracked file(s) read, ${skipped.length} skipped as ` +
          `binary or not a regular file)\n`,
      );
      return 0;
    }
    process.stderr.write(
      `agent notes: ${findings.length} finding(s).\n` +
        findings
          .map((f) => `  ${f.file}${f.line > 0 ? `:${f.line}` : ""} [${f.rule}] ${f.message}`)
          .join("\n") +
        "\n",
    );
    return 1;
  } catch (err) {
    if (err instanceof AgentNotesRefusal) {
      process.stderr.write(`agent notes: ${err.message} Nothing was checked.\n`);
      return 2;
    }
    throw err;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = runAgentNotesCheck({ argv: process.argv.slice(2) });
}
