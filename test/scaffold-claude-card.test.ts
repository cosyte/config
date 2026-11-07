/**
 * A scaffolded parser is born with a CLAUDE.md that follows the card spec
 * (documentation/claude-card.md) and an AGENTS.md the card imports (ST26).
 *
 * It runs the real scaffolder, because the card the template carries is not the card a new repo
 * gets: the scaffolder substitutes the package name and title, which changes line lengths, and then
 * formats the tree. Two name and title lengths are graded, the short end and a long one, so a
 * substitution that pushes a line past the width limit reds here.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkClaudeCard } from "../packages/script-utils/claude-card.js";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");

const CASES = [
  { name: "x12", title: "X12" },
  { name: "a-long-standard-name", title: "A Long Standard Name Release 2.1 Edition" },
];

let root: string;
const emitted = new Map<string, string>();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-card-"));
  for (const { name, title } of CASES) {
    const r = spawnSync(process.execPath, [SCAFFOLDER, name, "--out", root, "--title", title], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) {
      throw new Error(`the scaffolder exited ${r.status}:\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    }
    emitted.set(name, join(root, name));
  }
}, 300_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function everyFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? everyFile(path) : [path];
  });
}

describe.each(CASES)("a parser scaffolded as $name", ({ name }) => {
  it("carries a CLAUDE.md that follows the card spec, importing its AGENTS.md", () => {
    const dir = emitted.get(name) ?? "";
    const card = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(card.startsWith(`# @cosyte/${name}\n`)).toBe(true);
    expect(checkClaudeCard(card, { agentsMd: true })).toEqual([]);
  });

  it("carries an AGENTS.md with the commands, the data rule and the CONTRIBUTING link", () => {
    const agents = readFileSync(join(emitted.get(name) ?? "", "AGENTS.md"), "utf8");
    expect(agents.startsWith(`# @cosyte/${name}\n`)).toBe(true);
    expect(agents).toContain("pnpm install --frozen-lockfile");
    expect(agents).toContain("pnpm test");
    expect(agents).toContain("pnpm phi-scan");
    expect(agents).toContain("Synthetic data only.");
    expect(agents).toContain("https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md");
  });

  it("leaves no template token and no pointer to the deleted umbrella conventions file", () => {
    const offenders = everyFile(emitted.get(name) ?? "").filter((file) => {
      const text = readFileSync(file, "utf8");
      // A template token is `{{WORD}}`; a GitHub expression is `${{ expr }}` and stays.
      return /(?<!\$)\{\{[A-Za-z]+\}\}/.test(text) || text.includes("documentation/conventions.md");
    });
    expect(offenders).toEqual([]);
  });
});

describe("the card checker would catch a template card that broke the spec", () => {
  it("reds the emitted card with its AGENTS.md import removed", () => {
    // Without this, the green above is satisfied by a checker that passes everything.
    const card = readFileSync(join(emitted.get("x12") ?? "", "CLAUDE.md"), "utf8");
    const findings = checkClaudeCard(card.replace("@AGENTS.md\n", ""), { agentsMd: true });
    expect(findings.map((f) => f.rule)).toEqual(["agents-import"]);
  });
});
