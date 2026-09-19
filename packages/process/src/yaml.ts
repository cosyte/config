/**
 * The subset of YAML a GitHub Actions caller workflow is written in, and a refusal for the rest.
 *
 * WHY A SUBSET RATHER THAN A PARSER DEPENDENCY. This package is installed by every repo in the
 * estate, so a YAML implementation added here is a transitive dependency of all of them, and the
 * files it would read are twenty lines of block mappings. `node:*` and nothing else keeps the
 * install surface where it is.
 *
 * WHY IT REFUSES RATHER THAN GUESSES. A parser that skipped what it did not understand would answer
 * "no schedule configured" for a file that configures one in a shape it cannot read, and the grader
 * on top of it would then report a confident difference about the wrong element, or worse, read a
 * weakened trigger as an absent one. Every construct below is either understood exactly or refused
 * by line number: block mappings, block sequences, sequences of mappings, flow sequences of scalars,
 * comments, quoted and bare scalars, and GitHub expression scalars. Anchors, aliases, merge keys,
 * flow mappings, multi-line block scalars and multi-document streams are refused.
 *
 * A refusal names the LINE NUMBER and the construct, never the line's text: this runs over files a
 * consumer hands it, and a parser that echoes what it read is a parser that decides what is safe to
 * print.
 */

/** A mapping in the parsed tree. */
export interface YamlMapping {
  [key: string]: YamlValue;
}

/** Any value the subset can produce. */
export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMapping;

/**
 * Thrown when a line is outside the subset. Carries the line number, never the line.
 *
 * @example
 * new YamlSubsetError(7, "flow mappings are not supported here").line; // => 7
 */
export class YamlSubsetError extends Error {
  /** The 1-based line the refusal is about. */
  readonly line: number;

  /**
   * @param line - The 1-based line the refusal is about.
   * @param reason - The construct that is outside the subset.
   */
  constructor(line: number, reason: string) {
    super(`line ${String(line)}: ${reason}`);
    this.name = "YamlSubsetError";
    this.line = line;
  }
}

/** Every quoted span replaced by spaces, so structural checks ignore string content. @internal */
function maskQuoted(line: string): string {
  let out = "";
  let quote: string | null = null;
  for (const character of line) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      out += " ";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      out += " ";
      continue;
    }
    out += character;
  }
  return out;
}

/** Every `${{ ... }}` expression replaced by spaces: it is opaque text, not a flow mapping. @internal */
function maskExpressions(line: string): string {
  return line.replace(/\$\{\{[^}]*\}\}/g, (match) => " ".repeat(match.length));
}

/** Drop a trailing `# comment`, respecting quotes. @internal */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index);
    }
  }
  return line;
}

/** The index of the `:` that ends a mapping key, or -1. Quoted keys may contain one. @internal */
function findKeyColon(body: string): number {
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (
      character === ":" &&
      (index + 1 === body.length || /\s/.test(body[index + 1] ?? ""))
    ) {
      return index;
    }
  }
  return -1;
}

/** A mapping key, with its quotes removed if it carried any. @internal */
function parseKey(text: string): string {
  return /^"(.*)"$/s.test(text) || /^'(.*)'$/s.test(text) ? text.slice(1, -1) : text;
}

/** A scalar value. Keys never come through here, so `on` stays the string `on`. @internal */
function parseScalar(text: string, line: number): YamlValue {
  if (text === "") return null;
  if (/^"(.*)"$/s.test(text) || /^'(.*)'$/s.test(text)) return text.slice(1, -1);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  if (/[[\]{}]/.test(maskExpressions(maskQuoted(text)))) {
    throw new YamlSubsetError(line, "unsupported flow collection");
  }
  return text;
}

/** A `[a, b]` flow sequence of scalars. @internal */
function parseFlowSequence(text: string, line: number): YamlValue[] {
  const close = text.lastIndexOf("]");
  if (close === -1) {
    throw new YamlSubsetError(line, "unterminated flow sequence");
  }
  const inner = text.slice(1, close).trim();
  if (inner === "") return [];
  return inner.split(",").map((part) => parseScalar(part.trim(), line));
}

/** The first content line at or after an index, comment stripped and trimmed. @internal */
function nextContentLine(lines: readonly string[], from: number): string | null {
  for (let index = from; index < lines.length; index += 1) {
    const body = stripComment(lines[index] ?? "").trim();
    if (body !== "") return body;
  }
  return null;
}

/** Refuse a line that carries a construct outside the subset. @internal */
function refuseUnsupported(line: string, number_: number): void {
  const unquoted = maskExpressions(maskQuoted(line));
  if (/^---|^\.\.\./.test(unquoted.trim())) {
    throw new YamlSubsetError(number_, "multi-document YAML is not supported here");
  }
  if (/(^|[\s:[,-])[*&][A-Za-z0-9_]/.test(unquoted) || /<<\s*:/.test(unquoted)) {
    throw new YamlSubsetError(number_, "anchors, aliases and merge keys are not supported here");
  }
  if (/:\s*\{/.test(unquoted)) {
    throw new YamlSubsetError(number_, "flow mappings are not supported here");
  }
  if (/[|>][-+0-9]*\s*$/.test(unquoted)) {
    throw new YamlSubsetError(number_, "multi-line block scalars are not supported here");
  }
}

/** One open container and the indentation that closes it. @internal */
interface Frame {
  /** Lines indented past this belong to `container`. */
  readonly indent: number;
  /** The container being filled. */
  readonly container: YamlValue[] | YamlMapping;
}

/**
 * Parse the supported subset, refusing every construct outside it.
 *
 * @param text - The whole file.
 * @returns The parsed top-level mapping.
 * @throws YamlSubsetError When a line carries a construct outside the subset.
 * @example
 * parseYamlSubset("on:\n  push:\n    branches: [main]\n"); // => { on: { push: { branches: ["main"] } } }
 */
export function parseYamlSubset(text: string): YamlMapping {
  const lines = text.split("\n");
  const root: YamlMapping = {};
  const rootFrame: Frame = { indent: -1, container: root };
  const stack: Frame[] = [rootFrame];

  for (let index = 0; index < lines.length; index += 1) {
    const withoutComment = stripComment(lines[index] ?? "");
    if (withoutComment.trim() === "") continue;
    const line = index + 1;
    refuseUnsupported(withoutComment, line);

    const indent = withoutComment.length - withoutComment.trimStart().length;
    while (stack.length > 1 && indent <= (stack.at(-1) ?? rootFrame).indent) {
      stack.pop();
    }

    let frame = stack.at(-1) ?? rootFrame;
    let body = withoutComment.trim();
    let keyIndent = indent;

    if (body === "-" || body.startsWith("- ")) {
      const sequence = frame.container;
      if (!Array.isArray(sequence)) {
        throw new YamlSubsetError(line, "a sequence entry appears where no sequence was opened");
      }
      const entry = body === "-" ? "" : body.slice(2).trim();
      if (findKeyColon(entry) === -1) {
        sequence.push(
          entry.startsWith("[") ? parseFlowSequence(entry, line) : parseScalar(entry, line),
        );
        continue;
      }
      // A mapping opens inside the sequence entry: its keys sit two columns right of the dash.
      const mapping: YamlMapping = {};
      sequence.push(mapping);
      frame = { indent: indent + 1, container: mapping };
      stack.push(frame);
      body = entry;
      keyIndent = indent + 2;
    }

    const mapping = frame.container;
    if (Array.isArray(mapping)) {
      throw new YamlSubsetError(line, "a mapping key appears inside a sequence");
    }
    const colon = findKeyColon(body);
    if (colon === -1) {
      throw new YamlSubsetError(line, "neither a mapping key nor a sequence entry");
    }
    const key = parseKey(body.slice(0, colon).trim());
    const rest = body.slice(colon + 1).trim();

    if (rest === "") {
      const next = nextContentLine(lines, index + 1);
      const child: YamlValue[] | YamlMapping = next !== null && next.startsWith("-") ? [] : {};
      mapping[key] = child;
      stack.push({ indent: keyIndent, container: child });
      continue;
    }
    mapping[key] = rest.startsWith("[") ? parseFlowSequence(rest, line) : parseScalar(rest, line);
  }

  return root;
}
