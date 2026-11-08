/**
 * The agent-notes checker, `@cosyte/script-utils/agent-notes`: one repository whose notes and
 * pointers follow RD4, and for every rule a mutation of it that must go red on that rule.
 *
 * Each case builds a throwaway git repository in a temp directory; no other repository is read.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_NOTES_OPT_IN,
  AGENT_NOTES_RULES,
  checkAgentNotes,
  makeSlugger,
  readNotes,
  slugify,
} from "../agent-notes.js";

const GATE = join(import.meta.dirname, "..", "agent-notes.js");

const CARD = [
  "# @cosyte/demo",
  "",
  "Our demo parser.",
  "",
  "## Gate",
  "",
  "pnpm test",
  "",
  "## Hazard",
  "",
  "Why: documentation/agent-notes.md#the-hazard-in-full",
  "",
  "## Rules",
  "",
  "- Warnings carry codes (documentation/agent-notes.md#warning-codes, #70).",
  "",
].join("\n");

const NOTES = [
  "# Agent notes: @cosyte/demo",
  "",
  "What does not fit on the card.",
  "",
  "## The hazard in full",
  "",
  "Detail. See [codes](#warning-codes).",
  "",
  "## Rules",
  "",
  "### Warning codes",
  "",
  "Stable.",
  "",
  '<a id="explicit-target"></a>',
  "",
  "## Setup",
  "",
  "First.",
  "",
  "## Setup",
  "",
  "Second, so its slug is setup-1.",
  "",
].join("\n");

const SOURCE =
  "// Why: documentation/agent-notes.md#setup-1 and ../documentation/agent-notes.md#explicit-target\n";

const temporary: string[] = [];
afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() ?? "", { recursive: true, force: true });
});

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

/** A git repository holding these files, every one of them tracked. */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-notes-"));
  temporary.push(dir);
  git(dir, ["init", "-q", "."]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, ["add", "."]);
  return dir;
}

function cli(dir: string, args: string[] = []): { code: number; out: string } {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: dir, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function rules(input: Partial<Parameters<typeof checkAgentNotes>[0]>): string[] {
  return checkAgentNotes({ claude: CARD, notes: NOTES, files: [], ...input }).map((f) => f.rule);
}

describe("slugs, as GitHub writes them", () => {
  it("lowers case, drops punctuation, keeps letters in any script, and hyphenates spaces", () => {
    expect(slugify("The hazard in full")).toBe("the-hazard-in-full");
    expect(slugify("`attw` exits 0: why")).toBe("attw-exits-0-why");
    expect(slugify("[Linked](https://example.com) heading")).toBe("linked-heading");
    expect(slugify("Ünïcode café")).toBe("ünïcode-café");
    expect(slugify("- 001 leading hyphen")).toBe("--001-leading-hyphen");
  });

  it("reads a heading of unclosed link brackets in linear time", () => {
    const started = Date.now();
    slugify("[](".repeat(100_000));
    slugify("[\\".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("suffixes a repeated heading", () => {
    const slug = makeSlugger();
    expect([slug("Setup"), slug("Setup"), slug("Setup")]).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("reads setext headings, and none inside a fence, front matter or an HTML comment", () => {
    const { targets } = readNotes(
      [
        "---",
        "title: x",
        "---",
        "Setext one",
        "==========",
        "",
        "body",
        "",
        "```md",
        "## In a fence",
        "```",
        "<!--",
        "## In a comment",
        "-->",
        "",
      ].join("\n"),
    );
    expect([...targets]).toEqual(["setext-one"]);
  });
});

describe("a repository that follows RD4", () => {
  it("has no findings", () => {
    expect(rules({ files: [{ path: "src/a.ts", text: SOURCE }] })).toEqual([]);
  });

  it("names every rule it can raise", () => {
    expect(Object.keys(AGENT_NOTES_RULES).sort()).toEqual(
      [
        "blank",
        "dangling",
        "empty-section",
        "layout",
        "no-pointer",
        "notes-missing",
        "pointer-form",
        "stale-citation",
        "cross-anchor",
        "title",
        "orphan",
        "card-path",
      ].sort(),
    );
    expect([...AGENT_NOTES_OPT_IN]).toEqual(["title", "orphan", "card-path"]);
  });

  it("passes a repository with no notes and no pointers", () => {
    expect(
      rules({ notes: null, claude: CARD.replace(/documentation\/agent-notes\.md#[\w-]+/g, "") }),
    ).toEqual([]);
  });
});

describe("each rule goes red on its own", () => {
  it("layout: a notes directory", () => {
    expect(rules({ notesDirectory: true })).toEqual(["layout"]);
  });

  it("layout: the card pointing into a notes directory", () => {
    expect(rules({ claude: `${CARD}\nSee documentation/agent-notes/hazard.md.\n` })).toEqual([
      "layout",
    ]);
  });

  it("pointer-form: a bare backticked anchor in the card", () => {
    expect(rules({ claude: `${CARD}\n- See \`#warning-codes\`.\n` })).toEqual(["pointer-form"]);
  });

  it("pointer-form: an issue number in backticks is not a pointer", () => {
    expect(rules({ claude: `${CARD}\n- Fixed in \`#70\`.\n` })).toEqual([]);
  });

  it("pointer-form: the file name without its directory", () => {
    expect(rules({ claude: `${CARD}\n- agent-notes.md#warning-codes\n` })).toEqual([
      "pointer-form",
    ]);
  });

  it("dangling: a card pointer to an anchor the notes do not have", () => {
    expect(rules({ claude: `${CARD}\n- documentation/agent-notes.md#gone\n` })).toEqual([
      "dangling",
    ]);
  });

  it("dangling: a source comment's pointer, which is held to the same anchors", () => {
    const text = "// documentation/agent-notes.md#setup-2\n";
    expect(rules({ files: [{ path: "src/a.ts", text }] })).toEqual(["dangling"]);
  });

  it("dangling: a link inside the notes to an anchor they do not have", () => {
    expect(rules({ notes: NOTES.replace("](#warning-codes)", "](#warning-code)") })).toEqual([
      "dangling",
    ]);
  });

  it("dangling: a trailing period is prose, not anchor", () => {
    expect(rules({ claude: `${CARD}\nSee documentation/agent-notes.md#setup.\n` })).toEqual([]);
  });

  it("notes-missing: a pointer with no notes file", () => {
    expect(rules({ notes: null })).toEqual(["notes-missing", "notes-missing"]);
  });

  it("no-pointer: notes the card never points into", () => {
    const card = CARD.replace(/documentation\/agent-notes\.md#[\w-]+/g, "the notes");
    expect(rules({ claude: card })).toEqual(["no-pointer"]);
  });

  it("blank: an empty notes file, and one with no heading", () => {
    expect(
      rules({ notes: "\n", claude: CARD.replace(/documentation\/agent-notes\.md#[\w-]+/g, "") }),
    ).toEqual(["blank", "no-pointer"]);
    expect(rules({ notes: "Just prose.\n", claude: "# x\n" })).toEqual(["blank", "no-pointer"]);
  });

  it("empty-section: a heading with nothing under it, but not a container", () => {
    expect(rules({ notes: NOTES.replace("Stable.\n", "") })).toEqual(["empty-section"]);
    // `## Rules` holds only `### Warning codes`, which is the container shape, and is not empty.
    expect(rules({})).toEqual([]);
  });

  it("stale-citation: the deleted ADR 0023 and the doc-budget hook", () => {
    const notes = `${NOTES}\nGoverned by ADR 0023 and .claude/hooks/doc-budget.mjs.\n`;
    expect(rules({ notes })).toEqual(["stale-citation"]);
  });

  it("stale-citation: a repository with its own decision 0023 may cite it", () => {
    const notes = `${NOTES}\nSee ADR 0023, ours.\n`;
    expect(rules({ notes, localDecision0023: true })).toEqual([]);
    expect(
      rules({ notes: `${NOTES}\nSee 0023-doc-budgets.md.\n`, localDecision0023: true }),
    ).toEqual(["stale-citation"]);
  });
});

describe("the CLI", () => {
  it("exits 0 over a repository that follows RD4, scanning every tracked file", () => {
    const dir = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": NOTES,
      "src/a.ts": SOURCE,
    });
    const r = cli(dir);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("3 tracked file(s) read");
  });

  it("exits 1 naming the file, the line and the rule", () => {
    const dir = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": NOTES,
      "test/b.test.ts": "\n// documentation/agent-notes.md#missing\n",
    });
    const r = cli(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("test/b.test.ts:2 [dangling]");
  });

  it("reads a notes directory as the layout finding", () => {
    const dir = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": NOTES,
      "documentation/agent-notes/more.md": "# More\n\nText.\n",
    });
    expect(cli(dir).out).toContain("[layout]");
  });

  it("skips a file that is not UTF-8 and does not follow a symlink", () => {
    const dir = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": NOTES,
    });
    // A PNG signature: not UTF-8, so binary, whatever text follows it.
    writeFileSync(
      join(dir, "fixture.png"),
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]),
        Buffer.from("documentation/agent-notes.md#gone"),
      ]),
    );
    symlinkSync("/etc/hostname", join(dir, "link"));
    git(dir, ["add", "fixture.png", "link"]);
    const r = cli(dir);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("2 skipped");
  });

  it("reads a text file holding a NUL byte, so a pointer beside it is still held to the notes", () => {
    // ccda tracks one: a NUL is a separator inside a TypeScript string, and the file is text.
    const dir = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": NOTES,
      "src/merge.ts": 'const key = "a\u0000b"; // documentation/agent-notes.md#gone\n',
    });
    const r = cli(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/merge.ts:1 [dangling]");
    const clean = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": NOTES,
      "src/merge.ts": 'const key = "a\u0000b"; // documentation/agent-notes.md#setup-1\n',
    });
    expect(cli(clean).code).toBe(0);
  });

  it("cross-anchor: a pointer into another tracked Markdown file names an anchor it has", () => {
    const dir = repo({
      "CLAUDE.md": `${CARD}\nSee docs-content/guide.md#install and docs-content/guide.md#gone.\n`,
      "documentation/agent-notes.md": NOTES,
      "docs-content/guide.md": "# Guide\n\n## Install\n\nRun it.\n",
    });
    const r = cli(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[cross-anchor] docs-content/guide.md#gone names no heading");
    expect(r.out).not.toContain("guide.md#install names");
    // A file this repository does not track (the umbrella's, say) is not this rule's to judge.
    const outside = repo({
      "CLAUDE.md": `${CARD}\nSee plans/standards.md#st34.\n`,
      "documentation/agent-notes.md": NOTES,
    });
    expect(cli(outside).code).toBe(0);
  });

  it("title, orphan and card-path run only when --also names them", () => {
    const files = {
      "package.json": JSON.stringify({ name: "@cosyte/other" }),
      "CLAUDE.md": `${CARD}\nThe parser is \`src/parse.ts\`; the plan is \`plans/standards.md\`.\n`,
      "documentation/agent-notes.md": `${NOTES}\n## Never pointed at\n\nText.\n`,
      "src/index.ts": "export {};\n",
    };
    const dir = repo(files);
    expect(cli(dir).code, "default rules").toBe(0);

    const all = cli(dir, ["--also", "title,orphan,card-path"]);
    expect(all.code).toBe(1);
    expect(all.out).toContain("CLAUDE.md:1 [title] the title does not name @cosyte/other");
    expect(all.out).toContain('[orphan] the section "Never pointed at" (#never-pointed-at)');
    expect(all.out).toContain("[card-path] `src/parse.ts` names nothing tracked");
    // A path outside this repository's own top level is not a claim about this repository.
    expect(all.out).not.toContain("plans/standards.md");

    const one = cli(dir, ["--also", "card-path"]);
    expect(one.out).toContain("[card-path]");
    expect(one.out).not.toContain("[title]");
    expect(cli(dir, ["--also", "everything"]).code).toBe(2);
  });

  it("exits 2 outside a git repository, on an unterminated comment, and on a bad argument", () => {
    const plain = mkdtempSync(join(tmpdir(), "agent-notes-plain-"));
    temporary.push(plain);
    expect(cli(plain).code).toBe(2);
    const open = repo({
      "CLAUDE.md": CARD,
      "documentation/agent-notes.md": `${NOTES}<!--\n## x\n`,
    });
    expect(cli(open).code).toBe(2);
    expect(cli(open, ["--fix"]).code).toBe(2);
  });
});
