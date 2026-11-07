// @cosyte/script-utils/claude-card
//
// THE CLAUDE.md CARD CHECKER. Every Cosyte repository keeps a short CLAUDE.md that every Claude Code
// session in it reads first: what must pass before a push (`## Gate`), what a change can break that
// a green gate would not show (`## Hazard`), and the rules that bind there (`## Rules`). The spec is
// `documentation/claude-card.md` in cosyte/config; this file is what enforces it.
//
// THE RULES, each one id a finding names:
//
//   title          line 1 is `# <name>` (after a YAML front matter block, when there is one)
//   intro          a paragraph sits between the title and the first section
//   section-missing  `## Gate`, `## Hazard` and `## Rules` are all there (a heading may go on
//                  after its word: `## Hazard: ...`, `## Rules that bind here`)
//   section-order  in that order
//   section-extra  no other level-2 heading
//   section-empty  none of the three is empty
//   lines          at most `CARD_MAX_LINES` lines, counted as `wc -l` counts them
//   width          every line at most `CARD_MAX_LINE_LENGTH` characters, code included
//   bytes          at most `CARD_MAX_BYTES` bytes of UTF-8
//   agents-import  when an AGENTS.md sits beside the card, the card imports it on a line of its own
//                  (`@AGENTS.md`); an import of an AGENTS.md that is not there is a finding too
//
// EXIT CODES, the contract every gate here keeps: 0 the card follows the spec, 1 a finding, 2 the
// gate could not read its input.
//
// ZERO DEPENDENCIES AND NO BUILD STEP, like the rest of this package.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCliEntrypoint } from "./index.js";

/** The most lines a card may have. */
export const CARD_MAX_LINES = 60;

/** The most characters (code points) a line may have, code blocks included. */
export const CARD_MAX_LINE_LENGTH = 100;

/**
 * The most bytes of UTF-8 a card may have: 5 KiB, about 1,300 tokens, paid by every session in the
 * repository before any work starts. 60 lines of 100 characters is up to 6,060 bytes, so this is
 * the cap that binds; the spec gives the measurement behind the number.
 */
export const CARD_MAX_BYTES = 5_120;

/** The three sections, in order. A heading matches when it is the word, or the word then more. */
export const CARD_SECTIONS = Object.freeze(["Gate", "Hazard", "Rules"]);

/** The line that imports AGENTS.md into the card. */
export const AGENTS_IMPORT = "@AGENTS.md";

/** Every rule id a finding can carry, with what it requires. */
export const CARD_RULES = Object.freeze({
  title: "The card opens with `# <name>`, after a YAML front matter block if it has one.",
  intro: "A paragraph sits between the title and the first section.",
  "section-missing": "`## Gate`, `## Hazard` and `## Rules` are all there.",
  "section-order": "The three sections appear in that order.",
  "section-extra": "There is no other level-2 heading.",
  "section-empty": "None of the three sections is empty.",
  lines: `At most ${CARD_MAX_LINES} lines.`,
  width: `Every line is at most ${CARD_MAX_LINE_LENGTH} characters, code blocks included.`,
  bytes: `At most ${CARD_MAX_BYTES.toLocaleString("en-US")} bytes.`,
  "agents-import": `The card imports a sibling AGENTS.md on a line of its own (${AGENTS_IMPORT}).`,
});

/** Which of the three sections a level-2 heading's text is, or `null` for none of them. */
function sectionOf(text) {
  for (const word of CARD_SECTIONS) {
    if (text.startsWith(word) && !/[A-Za-z0-9]/.test(text.charAt(word.length))) return word;
  }
  return null;
}

/**
 * An ATX heading's level and text, or `null` when the line is not one.
 *
 * Read with index arithmetic rather than one regular expression: a pattern of the shape
 * `[ \t]+(.*?)[ \t]*#*[ \t]*$` backtracks polynomially on a long run of tabs or spaces.
 */
function parseHeading(line) {
  let level = 0;
  while (level < line.length && line[level] === "#") level += 1;
  if (level === 0 || level > 6) return null;
  if (line[level] !== " " && line[level] !== "\t") return null;
  let text = line.slice(level).trim();
  // An optional closing run of `#`, which counts only when a space or tab comes before it.
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === 0) text = "";
  else if (end < text.length && (text[end - 1] === " " || text[end - 1] === "\t")) {
    text = text.slice(0, end).trimEnd();
  }
  return { level, text };
}

/** The headings outside fenced code blocks, with 0-based line numbers. */
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
    const heading = parseHeading(line);
    if (heading !== null) headings.push({ ...heading, line: index });
  });
  return headings;
}

/**
 * Check a CLAUDE.md card against the spec.
 *
 * @param {string} text The card's contents.
 * @param {{ agentsMd?: boolean }} [context] `agentsMd`: whether an AGENTS.md sits beside the card.
 *   When it is left out, the import rule is not checked.
 * @returns {{ rule: string, line: number, message: string }[]} The findings; empty when the card
 *   follows the spec. `line` is 1-based, 0 for the whole file.
 */
export function checkClaudeCard(text, context = {}) {
  if (typeof text !== "string") throw new TypeError("checkClaudeCard(text) expects a string.");
  const findings = [];
  const add = (rule, line, message) => findings.push({ rule, line, message });
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  // ---- Size ---------------------------------------------------------------------------------
  const lineCount = (text.match(/\n/g) ?? []).length;
  if (lineCount > CARD_MAX_LINES) {
    add("lines", 0, `the card is ${lineCount} lines; the limit is ${CARD_MAX_LINES}.`);
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > CARD_MAX_BYTES) {
    add(
      "bytes",
      0,
      `the card is ${bytes.toLocaleString("en-US")} bytes; the limit is ` +
        `${CARD_MAX_BYTES.toLocaleString("en-US")}. Move detail to documentation/agent-notes.md.`,
    );
  }
  lines.forEach((line, index) => {
    const length = [...line.replace(/\r$/, "")].length;
    if (length > CARD_MAX_LINE_LENGTH) {
      add(
        "width",
        index + 1,
        `line ${index + 1} is ${length} characters; the limit is ${CARD_MAX_LINE_LENGTH}.`,
      );
    }
  });

  // ---- Title and intro ------------------------------------------------------------------------
  // A YAML front matter block may come first (a repository whose documents carry one); the title
  // is then the first line after it.
  let titleLine = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) titleLine = close + 1;
    while (titleLine < lines.length && lines[titleLine].trim() === "") titleLine += 1;
  }
  if (!/^# \S/.test(lines[titleLine] ?? "")) {
    add("title", titleLine + 1, "the card must open with its title, `# <name>`.");
  }
  const headings = headingsOf(lines);
  const firstSection = headings.find((h) => h.level === 2);
  const introEnd = firstSection === undefined ? lines.length : firstSection.line;
  const intro = lines
    .slice(titleLine + 1, introEnd)
    .filter((line) => line.trim() !== "" && line.trim() !== AGENTS_IMPORT && !/^#/.test(line));
  if (intro.length === 0) {
    add("intro", 2, "say what this repository is in a paragraph under the title.");
  }

  // ---- Sections -------------------------------------------------------------------------------
  const found = new Map();
  for (const heading of headings.filter((h) => h.level === 2)) {
    const word = sectionOf(heading.text);
    if (word === null) {
      add(
        "section-extra",
        heading.line + 1,
        `"## ${heading.text}" is not one of the card's sections (${CARD_SECTIONS.join(", ")}); ` +
          `make it a ### inside one of them, or move it to the agent notes.`,
      );
    } else if (!found.has(word)) {
      found.set(word, heading);
    } else {
      add("section-extra", heading.line + 1, `"## ${heading.text}" repeats the ${word} section.`);
    }
  }
  for (const word of CARD_SECTIONS) {
    if (!found.has(word)) add("section-missing", 0, `the card has no "## ${word}" section.`);
  }
  const present = CARD_SECTIONS.filter((word) => found.has(word));
  for (let i = 1; i < present.length; i += 1) {
    if (found.get(present[i]).line < found.get(present[i - 1]).line) {
      add(
        "section-order",
        found.get(present[i]).line + 1,
        `"## ${present[i]}" must come after "## ${present[i - 1]}" (the order is ` +
          `${CARD_SECTIONS.join(", ")}).`,
      );
      break;
    }
  }
  for (const [word, heading] of found) {
    const next = headings.find((h) => h.line > heading.line && h.level <= 2);
    const body = lines.slice(heading.line + 1, next === undefined ? lines.length : next.line);
    if (body.every((line) => line.trim() === "")) {
      add("section-empty", heading.line + 1, `the ${word} section is empty.`);
    }
  }

  // ---- AGENTS.md ------------------------------------------------------------------------------
  if (typeof context.agentsMd === "boolean") {
    const imports = lines.some((line) => line.trim() === AGENTS_IMPORT);
    if (context.agentsMd && !imports) {
      add(
        "agents-import",
        0,
        `an AGENTS.md sits beside the card, so the card imports it on a line of its own: ` +
          `${AGENTS_IMPORT}.`,
      );
    }
    if (!context.agentsMd && imports) {
      add(
        "agents-import",
        0,
        `the card imports ${AGENTS_IMPORT}, and there is no AGENTS.md beside it.`,
      );
    }
  }

  return findings;
}

/**
 * Run the card checker over one repository: read its CLAUDE.md, note whether an AGENTS.md sits
 * beside it, report, and return the exit code. It never exits the process.
 *
 * @param {{ dir?: string, argv?: string[] }} [options] `dir` is the repository root (default: the
 *   working directory). `argv` is the CLI arguments, read only for `--dir <path>`.
 * @returns {0 | 1 | 2} 0 the card follows the spec, 1 a finding, 2 the card could not be read.
 */
export function runClaudeCardGate(options = {}) {
  let dir = options.dir ?? process.cwd();
  const argv = options.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && typeof argv[i + 1] === "string") {
      dir = argv[i + 1];
      i += 1;
    } else if (argv[i] !== "--") {
      process.stderr.write(
        `CLAUDE.md card: ${JSON.stringify(argv[i])} is not an argument this check accepts (only ` +
          `--dir <repository root>). Nothing was checked.\n`,
      );
      return 2;
    }
  }
  dir = resolve(dir);

  let text;
  try {
    text = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  } catch (err) {
    process.stderr.write(`CLAUDE.md card: could not read CLAUDE.md in ${dir}: ${err.message}\n`);
    return 2;
  }
  const findings = checkClaudeCard(text, { agentsMd: existsSync(join(dir, "AGENTS.md")) });
  if (findings.length === 0) {
    const lineCount = (text.match(/\n/g) ?? []).length;
    process.stdout.write(
      `CLAUDE.md card: follows the spec (${lineCount} of ${CARD_MAX_LINES} lines, ` +
        `${Buffer.byteLength(text, "utf8").toLocaleString("en-US")} of ` +
        `${CARD_MAX_BYTES.toLocaleString("en-US")} bytes).\n`,
    );
    return 0;
  }
  const report = findings
    .map((f) => `  CLAUDE.md${f.line > 0 ? `:${f.line}` : ""} [${f.rule}] ${f.message}`)
    .join("\n");
  process.stderr.write(
    `CLAUDE.md card: CLAUDE.md does not follow the card spec.\n${report}\n` +
      `${findings.length} finding(s). The spec is documentation/claude-card.md in cosyte/config.\n`,
  );
  return 1;
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = runClaudeCardGate({ argv: process.argv.slice(2) });
}
