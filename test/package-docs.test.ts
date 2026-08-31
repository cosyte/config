import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  docSnippetSuite,
  extractRunnableSnippets,
  runSnippet,
} from "@cosyte/vitest-config/snippets";

import { parseYamlSubset } from "../scripts/install-hardening.mjs";

/**
 * THE PER-PACKAGE DOCUMENTATION GATE.
 *
 * Each published package's README is the only documentation a consumer of that package gets: it is
 * what npm renders, and it ships inside the tarball. Before this gate the eight READMEs ranged from
 * 22 lines to 240, three of the eleven published entry points were documented nowhere, and the same
 * topic carried a different heading in each file. None of that was visible until a consumer hit it,
 * because nothing in the repository looked.
 *
 * WHAT IS GRADED, and why each half exists.
 *
 *   1. TOPIC COVERAGE. Five topics per package: what it is, how to install it, how to consume it,
 *      every entry point its `exports` map declares, and how to override what it enforces. A README
 *      that omits one is named with the topic it omits, so the failure says what to write rather
 *      than that something is missing.
 *   2. ONE VOCABULARY. The heading text for a topic is identical across every package, and every
 *      README ends with the same footer line. Near-miss spellings (`Usage` for `Use`) are refused BY
 *      NAME rather than reported as an absent topic, because "you wrote the wrong word" and "you
 *      wrote nothing" are different repairs.
 *   3. A COPYABLE EXAMPLE, ALWAYS. The `## Use` section of every published package must carry a
 *      fenced block. "How to consume it" answered in prose alone gives a consumer nothing to paste,
 *      and that is true of a package whose entry point is a JSON config just as much as of one that
 *      ships code.
 *   4. EXECUTABLE EXAMPLES. The usage example is the block a consumer copies, so when it is written
 *      in TypeScript or JavaScript it must be one the snippet harness executes against this repo's
 *      own sources. A documented call that no longer matches the code then fails here instead of in
 *      a consumer's editor. Script-language blocks OUTSIDE `## Use` are illustrative - anti-patterns,
 *      fragments, and integrations written against parser packages this repo does not contain - and
 *      are not executed; the boundary between the two is this section heading, checked rather than
 *      left to whoever wrote the fence.
 *
 * THE PACKAGE SET IS DERIVED ON EVERY RUN, NEVER WRITTEN DOWN. It comes from `pnpm-workspace.yaml`
 * through the repo's own YAML-subset parser, minus anything marked `private`. A list maintained by
 * hand inside a check goes stale the first time a package is added, and it goes stale SILENTLY: the
 * check keeps passing over a corpus that no longer matches the repository. The same rule governs the
 * entry points (read from each `exports` map) and the executable-example exemption (derived from
 * whether a package's only export targets are JSON).
 *
 * IT FAILS CLOSED. A manifest that cannot be read or parsed is a REFUSAL naming that manifest, never
 * a package quietly dropped from the run, and never the same message a coverage failure produces: a
 * gate that skips its subject reports the same green as a gate that cleared it.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const SNIPPET_TMP = join(REPO_ROOT, ".cosyte-doc-snippets-package-docs");

// ---------------------------------------------------------------------------
// The vocabulary. Chosen from what the eight READMEs already said, not invented:
// `Install` was already in six of them and `Use` in five, and the footer below was already the last
// line of six. `Entry points` is the one heading with no incumbent, because no README had a section
// for its subpaths at all, which is the gap this gate exists to close.
// ---------------------------------------------------------------------------

/** Topic id -> the exact level-2 heading text every package must use for it. */
const CANONICAL_HEADINGS = {
  install: "Install",
  usage: "Use",
  "entry points": "Entry points",
  overrides: "Overrides",
} as const;

type HeadingTopic = keyof typeof CANONICAL_HEADINGS;

/**
 * Spellings that mean a canonical topic but are not it. A README carrying one is refused by name.
 * Case and punctuation variants (`Entry Points`, `Use.`) are caught structurally instead, so this
 * list only needs the genuine synonyms.
 */
const CONFUSABLE_HEADINGS: Record<HeadingTopic, string[]> = {
  install: ["installation", "installing", "setup", "getting started"],
  usage: ["usage", "using it", "use it", "quick start", "quickstart", "example", "examples"],
  "entry points": ["entrypoints", "entry point", "exports", "subpaths", "sub-paths", "modules"],
  overrides: ["override", "overriding", "customization", "customisation", "opting out", "opt out"],
};

/**
 * Fence languages that are "TypeScript or JavaScript" for the purpose of the usage example.
 *
 * Deliberately WIDER than the set `@cosyte/vitest-config/snippets` executes (`ts`, `typescript`,
 * `tsx`): a usage example fenced ` ```js ` is a script example that nothing runs, and the whole
 * point of the check below is to name that gap rather than to inherit it. A block in one of these
 * languages inside `## Use` must be one the harness actually picks up.
 */
const SCRIPT_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "jsx", "mjs", "cjs"]);

/** The last line of every published README, compared with runs of whitespace collapsed. */
const FOOTER =
  "Part of [cosyte/config](https://github.com/cosyte/config), one enforced toolchain for the " +
  "`@cosyte/*` suite.";

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

/**
 * Thrown when the WORKSPACE cannot be read, as opposed to when a README falls short.
 *
 * The two must not share a message: a coverage failure is a documentation repair, an unreadable
 * manifest is a broken checkout, and a run that reports the second as the first sends the reader to
 * the wrong file. It is also why an unreadable manifest is never skipped: a skipped package is a
 * package this gate silently stops grading.
 */
export class WorkspaceManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceManifestError";
  }
}

interface Manifest {
  name?: unknown;
  private?: unknown;
  exports?: unknown;
}

export interface WorkspacePackage {
  /** The npm name from the manifest. */
  name: string;
  /** Absolute directory. */
  dir: string;
  manifest: Manifest;
  /** README contents, or `null` when the file does not exist. An absent README is not an empty one. */
  readme: string | null;
  /** Repo-relative README path, for diagnostics, whether or not it exists. */
  readmePath: string;
}

/**
 * The `packages:` patterns from `pnpm-workspace.yaml`.
 *
 * Parsed with the repository's own YAML subset parser (`scripts/install-hardening.mjs`) rather than
 * a second one, so this gate and the install-hardening gate cannot disagree about what that file
 * says. A shape the parser refuses arrives here as a throw, which is the fail-closed direction.
 *
 * @param yamlText - Contents of `pnpm-workspace.yaml`.
 * @returns The declared workspace patterns.
 */
export function workspacePatterns(yamlText: string): string[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYamlSubset(yamlText) as Record<string, unknown>;
  } catch (cause) {
    throw new WorkspaceManifestError(`cannot parse pnpm-workspace.yaml: ${String(cause)}`);
  }
  const patterns = parsed["packages"];
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new WorkspaceManifestError(
      `pnpm-workspace.yaml declares no \`packages:\` list. Refusing to grade documentation against ` +
        `an empty workspace, which would clear every package in it.`,
    );
  }
  return patterns.map((p) => String(p));
}

/**
 * Expand the workspace patterns into directories.
 *
 * Only the two shapes pnpm workspaces in this org use are understood: a literal directory, and a
 * single trailing `/*`. Anything else is REFUSED rather than approximated, because a pattern this
 * cannot expand would otherwise contribute zero packages and read exactly like a clean run.
 *
 * @param root - Repository root.
 * @param patterns - Patterns from `pnpm-workspace.yaml`.
 * @returns Absolute directories, sorted.
 */
export function workspaceDirs(root: string, patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      throw new WorkspaceManifestError(
        `the workspace pattern ${JSON.stringify(pattern)} is a negation, which this gate does not ` +
          `implement. Refusing to grade a package set it cannot derive.`,
      );
    }
    if (pattern.endsWith("/*")) {
      const parent = join(root, pattern.slice(0, -2));
      let entries: string[];
      try {
        entries = readdirSync(parent);
      } catch (cause) {
        throw new WorkspaceManifestError(
          `cannot read the workspace directory ${parent}: ${String(cause)}`,
        );
      }
      for (const entry of entries) {
        const full = join(parent, entry);
        if (statSync(full).isDirectory()) dirs.add(full);
      }
      continue;
    }
    if (pattern.includes("*")) {
      throw new WorkspaceManifestError(
        `the workspace pattern ${JSON.stringify(pattern)} is not a literal directory or a single ` +
          `trailing \`/*\`, which are the only shapes this gate expands. Teach workspaceDirs() the ` +
          `new shape rather than letting it contribute no packages.`,
      );
    }
    dirs.add(join(root, pattern));
  }
  return [...dirs].sort();
}

/**
 * Read one workspace package.
 *
 * A directory with no `package.json` is not a package and is skipped. A `package.json` that exists
 * and cannot be read or parsed is a REFUSAL naming that file: the alternative is a package that
 * disappears from the graded set the moment its manifest breaks.
 *
 * @param dir - Absolute package directory.
 * @param root - Repository root, for relative diagnostics.
 * @returns The package, or `null` when the directory holds no manifest.
 */
export function readWorkspacePackage(dir: string, root: string): WorkspacePackage | null {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (cause) {
    throw new WorkspaceManifestError(
      `cannot read the workspace manifest ${relative(root, manifestPath)}: ${String(cause)}`,
    );
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch (cause) {
    throw new WorkspaceManifestError(
      `cannot parse the workspace manifest ${relative(root, manifestPath)}: ${String(cause)}`,
    );
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new WorkspaceManifestError(
      `the workspace manifest ${relative(root, manifestPath)} is not a JSON object.`,
    );
  }
  if (typeof manifest.name !== "string" || manifest.name === "") {
    throw new WorkspaceManifestError(
      `the workspace manifest ${relative(root, manifestPath)} declares no \`name\`, so nothing can ` +
        `say which package its documentation belongs to.`,
    );
  }

  const readmePath = join(dir, "README.md");
  return {
    name: manifest.name,
    dir,
    manifest,
    readme: existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null,
    readmePath: relative(root, readmePath),
  };
}

/**
 * Every package the workspace publishes, derived from `pnpm-workspace.yaml`.
 *
 * `private: true` packages are skipped: they are never published, so no consumer ever reads their
 * README. That is the one exclusion, and it is read off the manifest rather than a list here.
 *
 * @param root - Repository root.
 * @returns Published packages, sorted by name.
 */
export function publishedPackages(root: string): WorkspacePackage[] {
  const patterns = workspacePatterns(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"));
  const out: WorkspacePackage[] = [];
  for (const dir of workspaceDirs(root, patterns)) {
    const pkg = readWorkspacePackage(dir, root);
    if (pkg === null) continue;
    if (pkg.manifest.private === true) continue;
    out.push(pkg);
  }
  if (out.length === 0) {
    throw new WorkspaceManifestError(
      `no published packages found in the workspace. Refusing to report green from a gate that ` +
        `graded nothing.`,
    );
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Every subpath key an `exports` map declares, `./package.json` excluded, or `null` when there is no map. */
export function exportSubpaths(manifest: Manifest): string[] | null {
  const exportsMap = manifest.exports;
  if (exportsMap === undefined) return null;
  if (typeof exportsMap === "string") return ["."];
  if (exportsMap === null || typeof exportsMap !== "object" || Array.isArray(exportsMap)) {
    throw new WorkspaceManifestError(
      `the \`exports\` field of ${String(manifest.name)} is neither a string nor an object, so no ` +
        `entry point can be derived from it.`,
    );
  }
  const keys = Object.keys(exportsMap as Record<string, unknown>).filter((k) => k.startsWith("."));
  // A map whose keys are all CONDITIONS (`types`, `default`, ...) is sugar for the root entry point.
  if (keys.length === 0) return ["."];
  return keys.filter((k) => k !== "./package.json");
}

/** The public specifier a consumer writes for one export subpath: `@cosyte/x` or `@cosyte/x/sub`. */
export function specifierFor(name: string, subpath: string): string {
  return subpath === "." ? name : `${name}${subpath.slice(1)}`;
}

/** The file one `exports` entry resolves to, following conditions the way a bundler would. */
export function exportTarget(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  for (const condition of ["import", "default", "require", "types"]) {
    if (condition in record) {
      const resolved = exportTarget(record[condition]);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

/**
 * Whether a package's only supported consumption is a JSON config entry.
 *
 * DERIVED, not listed. `@cosyte/tsconfig` and `@cosyte/prettier-config` are exempt from carrying an
 * executable example because there is nothing to execute: their entry points are JSON files a tool
 * reads, not modules a consumer calls. Writing those two names down here would be a list that goes
 * stale; asking the `exports` map cannot.
 *
 * @param pkg - The package.
 * @returns `true` when every export target is a `.json` file.
 */
export function isJsonConfigOnly(pkg: WorkspacePackage): boolean {
  const subpaths = exportSubpaths(pkg.manifest);
  if (subpaths === null || subpaths.length === 0) return false;
  const exportsMap = pkg.manifest.exports;
  const targets = subpaths.map((subpath) =>
    typeof exportsMap === "string"
      ? exportsMap
      : exportTarget((exportsMap as Record<string, unknown>)[subpath]),
  );
  if (targets.some((t) => t === null)) return false;
  return targets.every((t) => (t as string).endsWith(".json"));
}

// ---------------------------------------------------------------------------
// Markdown structure
// ---------------------------------------------------------------------------

interface Heading {
  level: number;
  text: string;
  /** 1-based line of the heading. */
  line: number;
}

/** Every ATX heading, in document order. Lines inside a fenced block are not headings. */
export function headings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] as string;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const headingMatch = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (headingMatch) {
      out.push({
        level: (headingMatch[1] as string).length,
        text: headingMatch[2] as string,
        line: i + 1,
      });
    }
  }
  return out;
}

export interface FencedBlock {
  /** The lowercased language token of the info string, or `""` when the fence names none. */
  lang: string;
  /** The remaining info-string tokens, so ` ```ts runnable ` arrives as `["runnable"]`. */
  meta: string[];
  /** 1-based line of the OPENING fence, relative to the text handed in. */
  line: number;
  /** The block's contents, fences excluded. */
  body: string;
}

/**
 * Every top-level fenced block, in document order.
 *
 * NESTING IS RESPECTED, which is the whole reason this is not a regex over the lines: a four-backtick
 * ` ````md ` block that documents the tagging convention contains a three-backtick ` ```ts runnable `
 * fence, and that inner fence is prose about a tag, not a block of this document. Scanning past the
 * outer block's close is what keeps the two apart, and it is the same rule
 * `extractRunnableSnippets` applies, so the two agree about what a block is.
 *
 * @param markdown - Any markdown text; a section body is the usual argument.
 * @returns One entry per top-level fenced block.
 */
export function fencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split(/\r?\n/);
  const out: FencedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i] as string);
    if (open === null) continue;
    const fence = open[1] as string;
    const tokens = (open[2] as string)
      .trim()
      .split(/\s+/)
      .filter((token) => token !== "");
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[j] as string);
      const marker = close === null ? null : (close[1] as string);
      if (marker !== null && marker[0] === fence[0] && marker.length >= fence.length) break;
      body.push(lines[j] as string);
    }
    out.push({
      lang: (tokens[0] ?? "").toLowerCase(),
      meta: tokens.slice(1),
      line: i + 1,
      body: body.join("\n"),
    });
    i = j;
  }
  return out;
}

/** Runs of whitespace collapsed to one space, so a hard-wrapped sentence compares as one line. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The text with inline code spans removed, so backticked specifiers cannot look like punctuation. */
function withoutCodeSpans(text: string): string {
  return text.replace(/`[^`]*`/g, " ");
}

/**
 * How many sentences a paragraph holds.
 *
 * A terminator only ends a sentence when whitespace or the end of the text follows it, so a version
 * number or a hostname does not read as one. Inline code is removed first for the same reason.
 *
 * @param paragraph - One paragraph of prose.
 * @returns The sentence count.
 */
export function sentenceCount(paragraph: string): number {
  return (withoutCodeSpans(collapse(paragraph)).match(/[.!?](?=\s|$)/g) ?? []).length;
}

/**
 * The paragraph directly under the top-level heading: the package's one-sentence summary.
 *
 * "Directly under" is taken literally. The first thing after the `#` line must be prose, so a README
 * that opens with a badge row, a fenced block or another heading has no summary, which is the state
 * this returns `null` for.
 *
 * @param markdown - README contents.
 * @returns The summary paragraph, or `null` when the H1 is not followed by prose.
 */
export function summaryParagraph(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i] as string).trim() === "") i += 1;
  if (i >= lines.length || !/^#\s+/.test(lines[i] as string)) return null;
  i += 1;
  while (i < lines.length && (lines[i] as string).trim() === "") i += 1;
  const paragraph: string[] = [];
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "") break;
    if (/^#{1,6}\s/.test(line) || /^\s*(`{3,}|~{3,})/.test(line)) break;
    paragraph.push(line);
    i += 1;
  }
  return paragraph.length === 0 ? null : paragraph.join("\n");
}

/** The body of the section opened by a heading with exactly this level and text. */
export function sectionBody(markdown: string, level: number, text: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const all = headings(markdown);
  const start = all.find((h) => h.level === level && h.text === text);
  if (start === undefined) return null;
  const next = all.find((h) => h.line > start.line && h.level <= level);
  return lines.slice(start.line, next === undefined ? lines.length : next.line - 1).join("\n");
}

/** The last non-empty paragraph of a document. */
export function lastParagraph(markdown: string): string {
  const blocks = markdown.split(/\n\s*\n/).map((b) => b.trim());
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i] !== "") return blocks[i] as string;
  }
  return "";
}

// ---------------------------------------------------------------------------
// The grader
// ---------------------------------------------------------------------------

/**
 * Grade one package's README against the five topics and the shared vocabulary.
 *
 * Every problem line names the package and, where the failure is a topic, the topic. A caller that
 * prints an empty array has cleared the package; a caller that prints anything has a repair to make
 * and is told which one.
 *
 * @param pkg - The package, with its README already read (or `null` when there is none).
 * @returns One line per problem, in a stable order. Empty means the README conforms.
 */
export function gradeReadme(pkg: WorkspacePackage): string[] {
  const problems: string[] = [];
  const say = (line: string): number => problems.push(`${pkg.name}: ${line}`);

  if (pkg.readme === null) {
    say(
      `no README at ${pkg.readmePath}. Every published package ships its README inside the npm ` +
        `tarball, so an absent one is a package that documents nothing, not an empty one that is ` +
        `merely thin.`,
    );
    return problems;
  }
  if (pkg.readme.trim() === "") {
    say(`the README at ${pkg.readmePath} is empty.`);
    return problems;
  }

  const all = headings(pkg.readme);

  // Topic 1: what the package is, in one sentence, directly under an H1 that is the npm name.
  const title = all.find((h) => h.level === 1);
  if (title === undefined || title.text !== pkg.name) {
    say(
      `missing topic \`summary\`: the first heading must be \`# ${pkg.name}\`, the package's npm ` +
        `name, so npm's rendering opens with the name a consumer installed. Got ` +
        `${title === undefined ? "no level-1 heading" : JSON.stringify(title.text)}.`,
    );
  }
  const summary = summaryParagraph(pkg.readme);
  if (summary === null) {
    say(
      `missing topic \`summary\`: nothing but prose may sit between the title and the first ` +
        `section, and a one-sentence statement of what the package is must be there.`,
    );
  } else if (sentenceCount(summary) !== 1) {
    say(
      `missing topic \`summary\`: the paragraph under the title holds ${sentenceCount(summary)} ` +
        `sentences, and the summary is one. Move the rest into a second paragraph.`,
    );
  }

  // Topics 2, 3 and 5, plus topic 4 when the package declares entry points at all.
  let subpaths: string[] | null;
  try {
    subpaths = exportSubpaths(pkg.manifest);
  } catch (cause) {
    // A malformed `exports` map is a manifest problem, and the caller distinguishes it by type.
    throw cause;
  }
  const required: HeadingTopic[] = ["install", "usage", "overrides"];
  // A package with no `exports` map at all publishes no entry point to document, so the entry-point
  // topic does not apply to it. It is not excused the other four.
  if (subpaths !== null && subpaths.length > 0) required.push("entry points");

  for (const topic of required) {
    const canonical = CANONICAL_HEADINGS[topic];
    const exact = all.find((h) => h.level === 2 && h.text === canonical);
    if (exact !== undefined) continue;

    const variant = all.find(
      (h) =>
        normalizeHeading(h.text) === normalizeHeading(canonical) ||
        CONFUSABLE_HEADINGS[topic].includes(normalizeHeading(h.text)),
    );
    if (variant !== undefined) {
      say(
        `topic \`${topic}\` is documented under \`${"#".repeat(variant.level)} ${variant.text}\` ` +
          `(line ${variant.line}), not the shared heading \`## ${canonical}\`. Every package uses ` +
          `the same words for the same topic, or a consumer reading two of them has to learn two ` +
          `vocabularies.`,
      );
      continue;
    }
    say(`missing topic \`${topic}\`: no \`## ${canonical}\` section.`);
  }

  // Topic 3's content: "how to consume it, WITH A COPYABLE EXAMPLE". The heading alone is not the
  // topic. This is unconditional - a package whose only entry point is a JSON config is excused an
  // EXECUTABLE example, never a copyable one - and it is graded here rather than left to the snippet
  // suite, which by construction never looks at the packages it exempts.
  const usageHeading = all.find((h) => h.level === 2 && h.text === CANONICAL_HEADINGS.usage);
  const usageBody =
    usageHeading === undefined ? null : sectionBody(pkg.readme, 2, CANONICAL_HEADINGS.usage);
  if (usageHeading !== undefined && usageBody !== null) {
    const blocks = fencedBlocks(usageBody).filter((block) => block.body.trim() !== "");
    if (blocks.length === 0) {
      say(
        `missing topic \`usage\`: the \`## ${CANONICAL_HEADINGS.usage}\` section carries no ` +
          `example. It answers how to consume the package in prose and leaves a consumer nothing ` +
          `to copy. Add a fenced block showing the shortest real use; a package whose only entry ` +
          `point is a JSON config is excused an executable example, not a copyable one.`,
      );
    }
    // Criterion 7 binds THE USAGE EXAMPLE: the block a consumer copies. When that block is
    // TypeScript or JavaScript it has to be one the harness runs, or the promise that a documented
    // example cannot drift is carried by a tag nobody is required to write. What the harness will
    // actually execute is asked of the harness, never restated here.
    const executed = new Set(extractRunnableSnippets(usageBody).map((snippet) => snippet.line));
    for (const block of blocks) {
      if (!SCRIPT_LANGS.has(block.lang)) continue;
      // `extractRunnableSnippets` reports a block by its FIRST CODE line, one past the fence.
      if (executed.has(block.line + 1)) continue;
      say(
        `topic \`usage\`: the \`${block.lang}\` example at line ${usageHeading.line + block.line} ` +
          `is inside \`## ${CANONICAL_HEADINGS.usage}\`, so it is the example a consumer copies, ` +
          `and nothing executes it. Fence it \`\`\`ts runnable\`\`\` (the harness runs \`ts\`, ` +
          `\`typescript\` and \`tsx\`) so it fails when the code stops agreeing with it, or move ` +
          `it out of the usage section, where a block is illustrative rather than the documented ` +
          `way to consume the package.`,
      );
    }
  }

  // Topic 4's content: every declared entry point named in the entry-point section.
  if (subpaths !== null && subpaths.length > 0) {
    const body = sectionBody(pkg.readme, 2, CANONICAL_HEADINGS["entry points"]);
    if (body !== null) {
      for (const subpath of subpaths) {
        const specifier = specifierFor(pkg.name, subpath);
        if (!body.includes(specifier)) {
          say(
            `missing topic \`entry points\`: \`exports\` declares ${JSON.stringify(subpath)} but ` +
              `the \`## ${CANONICAL_HEADINGS["entry points"]}\` section never names ` +
              `\`${specifier}\`. An undocumented subpath is one a consumer cannot find.`,
          );
        }
      }
    }
  }

  // The shared footer, compared with whitespace collapsed so prose wrapping is immaterial.
  const footer = collapse(lastParagraph(pkg.readme));
  if (footer !== collapse(FOOTER)) {
    say(
      `the README does not end with the shared repository footer.\n` +
        `  expected: ${collapse(FOOTER)}\n` +
        `  got:      ${footer}`,
    );
  }

  return problems;
}

/** A heading reduced to its words, so `Entry Points`, `entry-points` and `Entry points` compare equal. */
function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Import remapping: a documented example is proven against THIS repo's sources
// ---------------------------------------------------------------------------

/**
 * Map a `@cosyte/*` specifier onto the local file its `exports` map points at.
 *
 * A built package's export target is `dist/`, which does not exist during `test:root` (there is no
 * build step before it, on purpose). Those are mapped to the TypeScript source the build emits from,
 * which is what "executed against this repo's own sources" means and what makes the example fail the
 * moment the source stops agreeing with it. A `dist/` target whose source cannot be located is a
 * THROW, not a silent pass-through: an unremapped specifier would resolve through `node_modules` to
 * the last published version, and the example would then be proven against code this repo no longer
 * contains.
 *
 * @param packages - The published workspace packages.
 * @returns A resolver for {@link docSnippetSuite}'s `resolve` option.
 */
export function localSourceResolver(
  packages: WorkspacePackage[],
): (specifier: string) => string | undefined {
  const byName = new Map(packages.map((p) => [p.name, p]));
  return (specifier) => {
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
    const pkg = byName.get(name);
    if (pkg === undefined) return undefined;

    const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
    const exportsMap = pkg.manifest.exports;
    const target =
      typeof exportsMap === "string"
        ? exportsMap
        : exportTarget((exportsMap as Record<string, unknown>)?.[subpath]);
    if (target === null || target === undefined) {
      throw new WorkspaceManifestError(
        `${pkg.name} declares no \`exports\` entry for ${JSON.stringify(subpath)}, but a ` +
          `documentation example imports ${JSON.stringify(specifier)}.`,
      );
    }

    const distMatch = /^\.\/dist\/(.*)\.[^./]+$/.exec(target);
    const relativePath = distMatch
      ? `src/${distMatch[1] as string}.ts`
      : target.replace(/^\.\//, "");
    const absolute = join(pkg.dir, relativePath);
    if (!existsSync(absolute)) {
      throw new WorkspaceManifestError(
        `${specifier} resolves to ${relative(REPO_ROOT, absolute)}, which does not exist. A ` +
          `documentation example cannot be proven against a file this repo does not have; leaving ` +
          `the specifier unmapped would prove it against the published version instead.`,
      );
    }
    return absolute;
  };
}

// ---------------------------------------------------------------------------
// The suites
// ---------------------------------------------------------------------------

const PACKAGES = publishedPackages(REPO_ROOT);
const RESOLVE = localSourceResolver(PACKAGES);

describe("published package documentation", () => {
  it("derives its package set from the pnpm workspace, skipping private packages", () => {
    // The census must not be empty, or every assertion below clears a corpus it never read.
    expect(PACKAGES.length).toBeGreaterThan(0);

    // The root manifest is `private: true` and is never published; nothing derived from the
    // workspace may grade it. The check is on the PROPERTY, not on the name, so a package that
    // becomes private later drops out here without an edit.
    for (const pkg of PACKAGES) expect(pkg.manifest.private).not.toBe(true);

    // Everything under the workspace patterns that is NOT private is graded, so a package added to
    // `packages/` joins this run with no edit to this file.
    const publishedDirs = workspaceDirs(
      REPO_ROOT,
      workspacePatterns(readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8")),
    ).filter((dir) => {
      const pkg = readWorkspacePackage(dir, REPO_ROOT);
      return pkg !== null && pkg.manifest.private !== true;
    });
    expect(PACKAGES.map((p) => p.dir).sort()).toEqual(publishedDirs.sort());
  });

  it.each(PACKAGES.map((pkg) => [pkg.name, pkg] as const))(
    "%s covers every required topic in the shared vocabulary",
    (_name, pkg) => {
      const problems = gradeReadme(pkg);
      expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
    },
  );

  it("ends every published README with the same footer line", () => {
    const footers = new Set(PACKAGES.map((pkg) => collapse(lastParagraph(pkg.readme ?? ""))));
    expect([...footers]).toEqual([collapse(FOOTER)]);
  });

  it("uses one heading text per topic across every published README", () => {
    for (const topic of Object.keys(CANONICAL_HEADINGS) as HeadingTopic[]) {
      const spellings = new Set<string>();
      for (const pkg of PACKAGES) {
        for (const heading of headings(pkg.readme ?? "")) {
          if (normalizeHeading(heading.text) === normalizeHeading(CANONICAL_HEADINGS[topic])) {
            spellings.add(heading.text);
          }
        }
      }
      expect([...spellings].sort(), `topic \`${topic}\` is spelled more than one way`).toEqual([
        CANONICAL_HEADINGS[topic],
      ]);
    }
  });
});

describe("the documentation gate's own failure modes", () => {
  const scratch = mkdtempSync(join(tmpdir(), "cosyte-package-docs-"));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Build a throwaway package directory, so the unhappy paths are exercised on real files. */
  function fixture(id: string, manifest: unknown, readme?: string): string {
    const dir = join(scratch, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
    );
    if (readme !== undefined) writeFileSync(join(dir, "README.md"), readme);
    return dir;
  }

  const CONFORMING = [
    "# @acme/widget",
    "",
    "A widget.",
    "",
    "## Install",
    "",
    "```sh",
    "pnpm add -D @acme/widget",
    "```",
    "",
    "## Use",
    "",
    "```ts runnable",
    "import { widget } from '@acme/widget';",
    "```",
    "",
    "## Entry points",
    "",
    "- `@acme/widget`",
    "",
    "## Overrides",
    "",
    "Nothing here can be overridden.",
    "",
    FOOTER,
    "",
  ].join("\n");

  it("refuses an absent README rather than treating it as an empty-but-acceptable one", () => {
    const dir = fixture("absent", { name: "@acme/absent", exports: { ".": "./index.js" } });
    const pkg = readWorkspacePackage(dir, scratch) as WorkspacePackage;
    expect(pkg.readme).toBeNull();
    const problems = gradeReadme(pkg);
    expect(problems.join("\n")).toContain("no README at");
    expect(problems.join("\n")).toContain("@acme/absent");
    // An absent README must NOT be graded as an empty one: the two messages are different repairs.
    expect(problems.join("\n")).not.toContain("is empty");
  });

  it("refuses an empty README, and says so in its own words", () => {
    const dir = fixture("empty", { name: "@acme/empty", exports: { ".": "./index.js" } }, "\n\n");
    const pkg = readWorkspacePackage(dir, scratch) as WorkspacePackage;
    const problems = gradeReadme(pkg);
    expect(problems.join("\n")).toContain("@acme/empty: the README at");
    expect(problems.join("\n")).toContain("is empty");
  });

  it("names the package AND the specific missing topic", () => {
    const dir = fixture(
      "thin",
      { name: "@acme/thin", exports: { ".": "./index.js" } },
      ["# @acme/thin", "", "A thin package.", "", "## Install", "", "yes", "", FOOTER, ""].join(
        "\n",
      ),
    );
    const pkg = readWorkspacePackage(dir, scratch) as WorkspacePackage;
    const report = gradeReadme(pkg).join("\n");
    expect(report).toContain("@acme/thin: missing topic `usage`");
    expect(report).toContain("@acme/thin: missing topic `entry points`");
    expect(report).toContain("@acme/thin: missing topic `overrides`");
    // The topic it DOES cover is not reported.
    expect(report).not.toContain("missing topic `install`");
  });

  it("requires a copyable example in the usage section, JSON-config-only packages included", () => {
    const proseOnly = [
      "# @acme/editorconfig",
      "",
      "Shared editor configuration.",
      "",
      "## Install",
      "",
      "```sh",
      "pnpm add -D @acme/editorconfig",
      "```",
      "",
      "## Use",
      "",
      "Consume it the way the other shared configs are consumed.",
      "",
      "## Entry points",
      "",
      "- `@acme/editorconfig/base.json`",
      "",
      "## Overrides",
      "",
      "Nothing here can be overridden.",
      "",
      FOOTER,
      "",
    ].join("\n");
    const manifest = { name: "@acme/editorconfig", exports: { "./base.json": "./base.json" } };

    const dir = fixture("json-only", manifest, proseOnly);
    const pkg = readWorkspacePackage(dir, scratch) as WorkspacePackage;
    // This is the class criterion 7 excuses an EXECUTABLE example, so the snippet suite skips it
    // entirely and `gradeReadme` is the only thing between this README and a green run. Criterion 1
    // is unconditional, and a shared-config repo is exactly where the next JSON-only package lands.
    expect(isJsonConfigOnly(pkg)).toBe(true);
    const report = gradeReadme(pkg).join("\n");
    expect(report).toContain("@acme/editorconfig: missing topic `usage`");
    expect(report).toMatch(/example/i);

    // A JSON block IS a copyable example. The criterion asks for something to paste, not for code.
    const withExample = fixture(
      "json-only-example",
      manifest,
      proseOnly.replace(
        "Consume it the way the other shared configs are consumed.",
        ["```json", '{ "extends": "@acme/editorconfig/base.json" }', "```"].join("\n"),
      ),
    );
    expect(gradeReadme(readWorkspacePackage(withExample, scratch) as WorkspacePackage)).toEqual([]);
  });

  it("refuses a usage example nothing executes, and only when it is script code", () => {
    const manifest = { name: "@acme/widget", exports: { ".": "./index.js" } };

    const untagged = fixture(
      "untagged-usage",
      manifest,
      CONFORMING.replace("```ts runnable", "```ts"),
    );
    const untaggedReport = gradeReadme(
      readWorkspacePackage(untagged, scratch) as WorkspacePackage,
    ).join("\n");
    expect(untaggedReport).toContain("@acme/widget: topic `usage`");
    // The line named is the fence's line in the FILE, not in the section body.
    expect(untaggedReport).toContain("at line 13");
    expect(untaggedReport).toContain("```ts runnable```");

    // The trap a tag check alone would miss: the harness runs `ts`, `typescript` and `tsx`, so a
    // JavaScript block WEARING the tag is still never executed, and must still be refused.
    const js = fixture(
      "js-usage",
      manifest,
      CONFORMING.replace("```ts runnable", "```js runnable"),
    );
    expect(gradeReadme(readWorkspacePackage(js, scratch) as WorkspacePackage).join("\n")).toContain(
      "topic `usage`",
    );

    // Outside `## Use` a script block is illustrative - an anti-pattern, a fragment, or an example
    // written against a package this repo does not contain - and is not required to run.
    const illustrative = fixture(
      "illustrative",
      manifest,
      CONFORMING.replace(
        "Nothing here can be overridden.",
        ["```ts", "// Do not do this.", "widget({ unsafe: true });", "```"].join("\n"),
      ),
    );
    expect(gradeReadme(readWorkspacePackage(illustrative, scratch) as WorkspacePackage)).toEqual(
      [],
    );

    // A JSON usage example is not script code, so criterion 7's condition never arises for it.
    const json = fixture(
      "json-usage",
      manifest,
      CONFORMING.replace("```ts runnable", "```json").replace(
        "import { widget } from '@acme/widget';",
        '{ "widget": true }',
      ),
    );
    expect(gradeReadme(readWorkspacePackage(json, scratch) as WorkspacePackage)).toEqual([]);
  });

  it("counts a fence nested inside a wider one as prose, not as a block of the document", () => {
    // A ````md block documenting the tagging convention holds a ```ts runnable fence that is TEXT.
    // Reading it as a block of the document would credit a usage section with an example it does
    // not have, and would then demand that example be executed.
    const blocks = fencedBlocks(
      ["````md", "```ts runnable", "const x = 1;", "```", "````", "", "```sh", "ls", "```"].join(
        "\n",
      ),
    );
    expect(blocks.map((b) => [b.lang, b.line])).toEqual([
      ["md", 1],
      ["sh", 7],
    ]);
  });

  it("names a near-miss heading as the wrong word, not as an absent topic", () => {
    const dir = fixture(
      "synonym",
      { name: "@acme/synonym", exports: { ".": "./index.js" } },
      CONFORMING.replace("## Use", "## Usage"),
    );
    const pkg = readWorkspacePackage(dir, scratch) as WorkspacePackage;
    const report = gradeReadme(pkg).join("\n");
    expect(report).toContain("topic `usage` is documented under `## Usage`");
    expect(report).not.toContain("missing topic `usage`");
  });

  it("refuses a summary that is not one sentence, and one that is not there", () => {
    const two = fixture(
      "two-sentence",
      { name: "@acme/two", exports: { ".": "./index.js" } },
      CONFORMING.replace("# @acme/widget", "# @acme/two").replace(
        "A widget.",
        "A widget. It does two things.",
      ),
    );
    const twoReport = gradeReadme(readWorkspacePackage(two, scratch) as WorkspacePackage).join(
      "\n",
    );
    expect(twoReport).toContain("missing topic `summary`");
    expect(twoReport).toContain("holds 2 sentences");

    const none = fixture(
      "no-summary",
      { name: "@acme/none", exports: { ".": "./index.js" } },
      CONFORMING.replace("# @acme/widget", "# @acme/none").replace("A widget.\n\n", ""),
    );
    const noneReport = gradeReadme(readWorkspacePackage(none, scratch) as WorkspacePackage).join(
      "\n",
    );
    expect(noneReport).toContain("missing topic `summary`");
  });

  it("refuses a title that is not the package's npm name", () => {
    const dir = fixture(
      "mistitled",
      { name: "@acme/mistitled", exports: { ".": "./index.js" } },
      CONFORMING.replace("# @acme/widget", "# Widget"),
    );
    const report = gradeReadme(readWorkspacePackage(dir, scratch) as WorkspacePackage).join("\n");
    expect(report).toContain("must be `# @acme/mistitled`");
  });

  it("requires the other four topics of a package with no `exports` map, and not the fifth", () => {
    const dir = fixture(
      "no-exports",
      { name: "@acme/widget" },
      CONFORMING.split("\n")
        .filter((line, i, lines) => {
          const start = lines.indexOf("## Entry points");
          return i < start || i > start + 2;
        })
        .join("\n"),
    );
    const pkg = readWorkspacePackage(dir, scratch) as WorkspacePackage;
    expect(exportSubpaths(pkg.manifest)).toBeNull();
    const report = gradeReadme(pkg).join("\n");
    expect(report).not.toContain("entry points");
    // The other four are still required: dropping `exports` is not a way out of documenting.
    expect(gradeReadme(pkg)).toEqual([]);
    const thin = fixture(
      "no-exports-thin",
      { name: "@acme/widget" },
      ["# @acme/widget", "", "A widget.", "", FOOTER, ""].join("\n"),
    );
    const thinReport = gradeReadme(readWorkspacePackage(thin, scratch) as WorkspacePackage).join(
      "\n",
    );
    expect(thinReport).toContain("missing topic `install`");
    expect(thinReport).toContain("missing topic `usage`");
    expect(thinReport).toContain("missing topic `overrides`");
    expect(thinReport).not.toContain("missing topic `entry points`");
  });

  it("refuses an unparseable manifest by name, distinguishably from a coverage failure", () => {
    const dir = fixture("broken", "{ this is not json", CONFORMING);
    expect(() => readWorkspacePackage(dir, scratch)).toThrow(WorkspaceManifestError);
    try {
      readWorkspacePackage(dir, scratch);
      expect.unreachable("an unparseable manifest must not be readable");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("cannot parse the workspace manifest");
      expect(message).toContain(join("broken", "package.json"));
      // Distinguishable: a coverage failure never says this, and this never says that.
      expect(message).not.toContain("missing topic");
    }
  });

  it("refuses a manifest with no name rather than grading a package nothing can identify", () => {
    const dir = fixture("nameless", { version: "1.0.0" }, CONFORMING);
    expect(() => readWorkspacePackage(dir, scratch)).toThrow(/declares no `name`/);
  });

  it("does not skip a package whose manifest is broken", () => {
    // The failure mode this pins: a `try { ... } catch { continue }` in the discovery loop would
    // drop the package silently and the run would stay green over a corpus one package smaller.
    const root = join(scratch, "silent-skip");
    mkdirSync(join(root, "packages"), { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    mkdirSync(join(root, "packages", "good"), { recursive: true });
    writeFileSync(
      join(root, "packages", "good", "package.json"),
      JSON.stringify({ name: "@acme/good" }),
    );
    writeFileSync(join(root, "packages", "good", "README.md"), CONFORMING);
    mkdirSync(join(root, "packages", "bad"), { recursive: true });
    writeFileSync(join(root, "packages", "bad", "package.json"), "{ nope");
    expect(() => publishedPackages(root)).toThrow(WorkspaceManifestError);
  });

  it("skips `private` packages and refuses a workspace with none left", () => {
    const root = join(scratch, "all-private");
    mkdirSync(join(root, "packages", "internal"), { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    writeFileSync(
      join(root, "packages", "internal", "package.json"),
      JSON.stringify({ name: "@acme/internal", private: true }),
    );
    expect(() => publishedPackages(root)).toThrow(/no published packages/);
  });

  it("refuses a workspace pattern it cannot expand rather than grading nothing", () => {
    expect(() => workspaceDirs(scratch, ["packages/**/deep"])).toThrow(
      /only shapes this gate expands/,
    );
    expect(() => workspaceDirs(scratch, ["!packages/private"])).toThrow(/negation/);
    expect(() => workspacePatterns("minimumReleaseAge: 1440\n")).toThrow(/declares no `packages:`/);
  });
});

describe("documentation examples are executed against this repo's sources", () => {
  const executable = PACKAGES.filter((pkg) => !isJsonConfigOnly(pkg));
  const exempt = PACKAGES.filter((pkg) => isJsonConfigOnly(pkg));

  it("exempts exactly the packages whose only entry points are JSON config files", () => {
    // Pinned as a control on the DERIVATION: at this tree those two are the JSON-config packages,
    // and if the derivation ever starts excusing a package that ships real code, this reds.
    expect(exempt.map((p) => p.name).sort()).toEqual([
      "@cosyte/prettier-config",
      "@cosyte/tsconfig",
    ]);
    expect(executable.length).toBeGreaterThan(0);
  });

  it.each(executable.map((pkg) => [pkg.name, pkg] as const))(
    "%s documents a runnable example for every entry point it declares",
    (_name, pkg) => {
      const snippets = extractRunnableSnippets(pkg.readme ?? "");
      expect(
        snippets.length,
        `${pkg.name} has no \`ts runnable\` block, so nothing proves its example still works`,
      ).toBeGreaterThan(0);

      const imported = snippets.flatMap((s) =>
        [...s.code.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1] as string),
      );
      const missing = (exportSubpaths(pkg.manifest) ?? [])
        .map((subpath) => specifierFor(pkg.name, subpath))
        .filter((specifier) => !imported.includes(specifier));
      expect(
        missing,
        `${pkg.name} declares these entry points but no runnable example imports them`,
      ).toEqual([]);
    },
  );

  it("fails naming the README file and the line when an example stops agreeing with the code", async () => {
    // The seeded-drift gate, run END TO END rather than asserted about. `docSnippetSuite` is what
    // labels a failure `<file>:<line>`, so the only honest evidence that a drifted example is
    // reported that way is a real Vitest run that fails and prints it. A nested run is the price.
    const driftDir = join(REPO_ROOT, ".cosyte-doc-snippets-drift");
    rmSync(driftDir, { recursive: true, force: true });
    mkdirSync(driftDir, { recursive: true });

    const readme = [
      "# @acme/drifted", // 1
      "", // 2
      "```ts runnable", // 3
      "const documented = 1 + 1;", // 4 <- the block's first code line
      "documented; // => 3", // 5 <- the assertion that no longer matches the code
      "```", // 6
    ].join("\n");
    writeFileSync(join(driftDir, "README.md"), readme);
    expect(extractRunnableSnippets(readme)[0]?.line).toBe(4);

    const snippetsModule = join(REPO_ROOT, "packages", "vitest-config", "snippets.js");
    writeFileSync(
      join(driftDir, "drift.test.ts"),
      [
        `import { docSnippetSuite } from ${JSON.stringify(snippetsModule)};`,
        "",
        "docSnippetSuite({",
        `  files: [${JSON.stringify(join(driftDir, "README.md"))}],`,
        `  tmpDir: ${JSON.stringify(join(driftDir, ".tmp"))},`,
        "});",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(driftDir, "vitest.config.ts"),
      [
        'import { defineConfig } from "vitest/config";',
        "",
        'export default defineConfig({ test: { include: ["drift.test.ts"] } });',
        "",
      ].join("\n"),
    );

    let output = "";
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
          "run",
          "--config",
          "vitest.config.ts",
        ],
        { cwd: driftDir, encoding: "utf8", stdio: "pipe", env: { ...process.env, CI: "1" } },
      );
    } catch (error) {
      failed = true;
      const e = error as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }

    expect(failed, `a drifted example must fail the run. Output:\n${output}`).toBe(true);
    // The file and the line, together, in the label the harness prints.
    expect(output, `the failure must name the README and the line. Output:\n${output}`).toContain(
      "README.md:4",
    );
    rmSync(driftDir, { recursive: true, force: true });
  }, 120_000);
});

// Registered at module scope, exactly as a consumer repo wires its own docs: every runnable block in
// every published README becomes a Vitest test labelled by file and line, executed against the local
// sources the resolver above points it at.
docSnippetSuite({
  name: "README examples",
  files: PACKAGES.map((pkg) => join(pkg.dir, "README.md")).filter((path) => existsSync(path)),
  resolve: RESOLVE,
  tmpDir: SNIPPET_TMP,
  requireSnippet: true,
});
