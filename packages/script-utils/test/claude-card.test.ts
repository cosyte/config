/**
 * The CLAUDE.md card checker, `@cosyte/script-utils/claude-card`: one card that follows the spec,
 * and for every rule a mutation of it that must go red on that rule.
 *
 * Every card here is written in this file. No other repository is read.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CARD_MAX_BYTES,
  CARD_MAX_LINE_LENGTH,
  CARD_MAX_LINES,
  CARD_RULES,
  checkClaudeCard,
} from "../claude-card.js";

const GATE = join(import.meta.dirname, "..", "claude-card.js");

/** A card that follows the spec: an AGENTS.md import, a qualified heading, a ### and a fence. */
function good(): string {
  return [
    "# @cosyte/demo",
    "",
    "Our demo parser for Node.js and TypeScript, published to npm under MIT.",
    "",
    "@AGENTS.md",
    "",
    "## Gate",
    "",
    "Required checks: `verify (22)`, `verify (24)` and `verify (26)`.",
    "",
    "```sh",
    "pnpm install --frozen-lockfile",
    "## not a heading, because it is inside a fence",
    "pnpm test",
    "```",
    "",
    "## Hazard: a field parsed wrong but plausible travels on",
    "",
    "Warn rather than guess.",
    "",
    "## Rules that bind here",
    "",
    "### Errors",
    "",
    "- Errors carry bounded tokens, never message text (#70).",
    "",
  ].join("\n");
}

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error(`the fixture does not contain ${JSON.stringify(from)} exactly once`);
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}

function rules(text: string, agentsMd = true): string[] {
  return checkClaudeCard(text, { agentsMd }).map((f) => f.rule);
}

describe("a card that follows the spec", () => {
  it("has no findings", () => {
    expect(checkClaudeCard(good(), { agentsMd: true })).toEqual([]);
  });

  it("states the limits the spec states", () => {
    expect([CARD_MAX_LINES, CARD_MAX_LINE_LENGTH, CARD_MAX_BYTES]).toEqual([60, 100, 5120]);
    expect(Object.keys(CARD_RULES).sort()).toEqual(
      [
        "agents-import",
        "bytes",
        "intro",
        "lines",
        "section-empty",
        "section-extra",
        "section-missing",
        "section-order",
        "title",
        "width",
      ].sort(),
    );
  });

  it("accepts YAML front matter before the title", () => {
    expect(rules(`---\ntitle: demo\n---\n\n${good()}`)).toEqual([]);
  });

  it("accepts a heading that goes on after its word with punctuation", () => {
    expect(
      rules(replaceOnce(good(), "## Rules that bind here", "## Rules, each from a PR")),
    ).toEqual([]);
  });
});

describe("each rule goes red on its own", () => {
  it("title: no title on line 1", () => {
    expect(rules(good().replace("# @cosyte/demo\n", "@cosyte/demo\n"))).toEqual(["title"]);
  });

  it("intro: nothing between the title and the first section", () => {
    const text = replaceOnce(
      good(),
      "Our demo parser for Node.js and TypeScript, published to npm under MIT.\n\n",
      "",
    );
    expect(rules(text)).toEqual(["intro"]);
  });

  for (const word of ["Gate", "Hazard", "Rules"]) {
    it(`section-missing: no ${word} section`, () => {
      const heading = good()
        .split("\n")
        .find((line) => line.startsWith(`## ${word}`));
      const text = replaceOnce(good(), `${heading}\n`, `### ${word} notes\n`);
      expect(rules(text)).toContain("section-missing");
    });
  }

  it("section-missing: a word that only begins another word does not count", () => {
    expect(rules(replaceOnce(good(), "## Gate\n", "## Gateway\n"))).toEqual([
      "section-extra",
      "section-missing",
    ]);
  });

  it("section-order: Hazard before Gate", () => {
    const text = replaceOnce(
      replaceOnce(good(), "## Gate\n", "## TEMP\n"),
      "## Hazard: a field parsed wrong but plausible travels on\n",
      "## Gate\n",
    ).replace("## TEMP\n", "## Hazard\n");
    expect(rules(text)).toEqual(["section-order"]);
  });

  it("section-extra: a fourth level-2 heading", () => {
    expect(rules(`${good()}\n## Notes\n\nMore.\n`)).toEqual(["section-extra"]);
  });

  it("section-extra: a second Rules section", () => {
    expect(rules(`${good()}\n## Rules, again\n\nMore.\n`)).toEqual(["section-extra"]);
  });

  it("section-empty: a section with nothing under it", () => {
    expect(rules(replaceOnce(good(), "Warn rather than guess.\n", ""))).toEqual(["section-empty"]);
  });

  it("lines: one line over the limit, and not at it", () => {
    const base = good();
    const baseLines = (base.match(/\n/g) ?? []).length;
    const pad = (n: number): string => `${base}${"- one more rule.\n".repeat(n)}`;
    expect(rules(pad(CARD_MAX_LINES - baseLines))).toEqual([]);
    expect(rules(pad(CARD_MAX_LINES - baseLines + 1))).toEqual(["lines"]);
  });

  it("width: a line of 101 characters, code blocks included", () => {
    const at = `pnpm ${"x".repeat(CARD_MAX_LINE_LENGTH - 5)}`;
    expect(at.length).toBe(CARD_MAX_LINE_LENGTH);
    expect(rules(replaceOnce(good(), "pnpm test\n", `${at}\n`))).toEqual([]);
    const findings = checkClaudeCard(replaceOnce(good(), "pnpm test\n", `${at}y\n`), {
      agentsMd: true,
    });
    expect(findings.map((f) => f.rule)).toEqual(["width"]);
    expect(findings[0]?.line).toBe(14);
  });

  it("width: counts characters, not bytes", () => {
    // 100 two-byte characters is 100 characters, so the width rule passes it.
    const line = `- ${"é".repeat(CARD_MAX_LINE_LENGTH - 2)}`;
    expect(rules(replaceOnce(good(), "Warn rather than guess.", line))).toEqual([]);
  });

  it("bytes: over the cap with every line inside the line and width limits", () => {
    // Two-byte characters: each line is 100 characters and 198 bytes, so the byte cap is the one
    // rule that sees it.
    const rule = `- ${"é".repeat(CARD_MAX_LINE_LENGTH - 2)}\n`;
    const text = `${good()}${rule.repeat(30)}`;
    expect((text.match(/\n/g) ?? []).length).toBeLessThanOrEqual(CARD_MAX_LINES);
    expect(Buffer.byteLength(text)).toBeGreaterThan(CARD_MAX_BYTES);
    expect(rules(text)).toEqual(["bytes"]);
  });

  it("agents-import: an AGENTS.md beside the card that it does not import", () => {
    expect(rules(replaceOnce(good(), "@AGENTS.md\n\n", ""), true)).toEqual(["agents-import"]);
  });

  it("agents-import: an import of an AGENTS.md that is not there", () => {
    expect(rules(good(), false)).toEqual(["agents-import"]);
  });

  it("agents-import: not checked when the caller does not say", () => {
    expect(checkClaudeCard(replaceOnce(good(), "@AGENTS.md\n\n", ""))).toEqual([]);
  });
});

describe("input the checker does not control", () => {
  it("reads a heading line padded with a long run of tabs in linear time", () => {
    const started = Date.now();
    checkClaudeCard(`${good()}\n## ${"\t".repeat(200_000)}x\n`, { agentsMd: true });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("the CLI", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "claude-card-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function repo(label: string, card: string | null, agents: boolean): string {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    if (card !== null) writeFileSync(join(dir, "CLAUDE.md"), card);
    if (agents) writeFileSync(join(dir, "AGENTS.md"), "# demo\n");
    return dir;
  }

  function cli(args: string[], cwd: string): { code: number; out: string } {
    const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: "utf8" });
    return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("exits 0 on a card that follows the spec, reading AGENTS.md from beside it", () => {
    const r = cli([], repo("good", good(), true));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("follows the spec");
  });

  it("exits 1 when the AGENTS.md it imports is not there", () => {
    const r = cli([], repo("no-agents", good(), false));
    expect(r.code).toBe(1);
    expect(r.out).toContain("[agents-import]");
  });

  it("reads --dir", () => {
    expect(cli(["--dir", repo("by-dir", good(), true)], root).code).toBe(0);
  });

  it("exits 2 when there is no CLAUDE.md, and on an argument it does not accept", () => {
    expect(cli([], repo("no-card", null, true)).code).toBe(2);
    expect(cli(["--fix"], repo("bad-arg", good(), true)).code).toBe(2);
  });
});
