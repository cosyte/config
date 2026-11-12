import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCOPED_COMMIT,
  SCOPED_REFERENCE,
  SCOPED_TITLE,
  dependabotTitles,
  ecosystemOf,
  sharedCallers,
  sharedCallersIn,
  updateBlocks,
  type SharedCaller,
} from "./support/shared-workflows.js";

/**
 * ONE SHARED-WORKFLOW PIN, IN THIS REPOSITORY AND IN THE PARSER TEMPLATE ALIKE.
 *
 * Every call to a reusable workflow in cosyte/.github is pinned to the commit of a published
 * `workflows-*` reference, and the pins move together, by hand. This repository calls four of them
 * (codeql, scorecard, pr-title, weekly-mutation) and the template six. When one moves and another does not, the two
 * sets of callers run different shared code under the same reference name in their comments, and
 * every repository scaffolded afterwards is born on the stale one. The title check is where that
 * showed: this repository's pr-title.yml moved to the commit that requires a scope while its
 * security callers and the whole template stayed behind, and the template had no title check at all.
 *
 * The template is read here at its source, `scripts/parser-template/`, beside this repository's
 * own workflows; `test/scaffold-repo-standards.test.ts` grades what the scaffolder emits from it.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const TEMPLATE = join(REPO_ROOT, "scripts", "parser-template");
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

const OWN = sharedCallersIn(join(REPO_ROOT, ".github", "workflows"), ".github/workflows");
const TEMPLATE_CALLERS = sharedCallersIn(
  join(TEMPLATE, ".github", "workflows"),
  "scripts/parser-template/.github/workflows",
);
const ALL = [...OWN, ...TEMPLATE_CALLERS];

/** The distinct `commit # reference` pairs a set of callers names. */
const pins = (callers: SharedCaller[]): string[] => [
  ...new Set(callers.map((c) => `${c.commit} # ${c.reference}`)),
];

describe("the shared-workflow pins", () => {
  it("finds every caller in this repository and in the parser template", () => {
    expect(OWN.map((c) => c.workflow).sort()).toEqual([
      "codeql.yml",
      "pr-title.yml",
      "scorecard.yml",
      "weekly-mutation.yml",
    ]);
    expect(TEMPLATE_CALLERS.map((c) => c.workflow).sort()).toEqual([
      "ci.yml",
      "codeql.yml",
      "gate-no-emdash-install.yml",
      "pr-title.yml",
      "release.yml",
      "scorecard.yml",
    ]);
  });

  it("pins every caller, here and in the template, at one commit with its published name", () => {
    const found = pins(ALL);
    const where = ALL.map((c) => `${c.file}: ${c.commit} # ${c.reference}`).join("\n");
    expect(found, where).toHaveLength(1);
  });

  it("pins them at the commit whose title check requires a scope", () => {
    expect(pins(ALL)).toEqual([`${SCOPED_COMMIT} # ${SCOPED_REFERENCE}`]);
    expect(SCOPED_REFERENCE.endsWith(`-${SCOPED_COMMIT.slice(0, 12)}`)).toBe(true);
  });

  it("NEGATIVE CONTROL: one caller left on another commit makes two pins", () => {
    // Without this, the case above passes for a reader that finds nothing, or that collapses every
    // pin into one. One template caller is moved, in memory, and nothing else changes.
    const file = "scripts/parser-template/.github/workflows/scorecard.yml";
    const text = read(file);
    const stale = text.replace(
      /scorecard\.yml@[0-9a-f]{40} # \S+/,
      "scorecard.yml@c0db8d8e5927269820de4401b3b5ad6141854b76 # workflows-2026-11-08-c0db8d8e5927",
    );
    expect(stale).not.toBe(text);
    const moved = [...ALL.filter((c) => c.file !== file), ...sharedCallers(file, stale)];
    expect(moved).toHaveLength(ALL.length);
    expect(pins(moved)).toHaveLength(2);
  });
});

describe("the parser template's pull request titles", () => {
  it("carries pr-title.yml, calling the shared title check on every title edit", () => {
    const path = join(TEMPLATE, ".github", "workflows", "pr-title.yml");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("types: [opened, synchronize, reopened, edited]");
    expect(sharedCallers("pr-title.yml", text).map((c) => c.workflow)).toEqual(["pr-title.yml"]);
  });

  const blocks = updateBlocks(read("scripts/parser-template/.github/dependabot.yml"));

  it("reads every update block of the template's dependabot.yml", () => {
    expect(blocks.map(ecosystemOf)).toEqual(["npm", "github-actions"]);
  });

  it.each(blocks.map((b) => [ecosystemOf(b), b]))(
    "gives the template's %s updates a scoped title",
    (_ecosystem, block) => {
      for (const title of dependabotTitles(block)) expect(title).toMatch(SCOPED_TITLE);
    },
  );
});

/**
 * Our planning and decision identifiers, in the shapes they take: a standard, a decision, an open
 * work item, a session, a roadmap section. This repository is public, so its workflow and
 * Dependabot comments say what a rule is, never which internal entry it came from.
 */
const INTERNAL_ID =
  /\b(?:ST|EN|RD|OW|KD|ADR|S|D|P)\d+\b|\bPERF-P\d+\b|§|\bplans\/|\broadmap\b|\bPhase [A-Z0-9]\b/;

const DEPENDABOT = [".github/dependabot.yml", "scripts/parser-template/.github/dependabot.yml"];

describe("the workflow and Dependabot comments carry no internal identifiers", () => {
  // Every workflow file, not only the callers: a header comment anywhere is public text.
  const workflows = (dir: string): string[] =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((f) => f.endsWith(".yml"))
      .sort()
      .map((f) => `${dir}/${f}`);
  const files = [
    ...DEPENDABOT,
    ...workflows(".github/workflows"),
    ...workflows("scripts/parser-template/.github/workflows"),
  ];

  it.each(files)("%s", (file) => {
    const hits = read(file)
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => INTERNAL_ID.test(line))
      .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });

  it("NEGATIVE CONTROL: the pattern finds each shape it names", () => {
    for (const sample of [
      "pinned by its commit (ST37)",
      "a decision (D193)",
      "THE SPLIT (S0074, 2026-08-22)",
      "name: PERF-P0 calibration",
      "roadmap section 8",
      "Phase C of the campaign",
      "see plans/standards.md",
    ])
      expect(INTERNAL_ID.test(sample), sample).toBe(true);
    for (const sample of [
      "actions/checkout@abc # v7.0.1",
      "SHA-256",
      "Node 22, 24 and 26",
      "MSH-9",
    ])
      expect(INTERNAL_ID.test(sample), sample).toBe(false);
  });
});
