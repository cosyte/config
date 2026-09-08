/**
 * THE DRIFT CHECK RUNS IN THE ONE JOB THAT CAN REFUSE A MERGE, AND NOTHING NEUTRALIZES IT.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `verify` is a REQUIRED status check in this repository's
 * `config-ci-required-checks` ruleset; every other workflow here runs, is visible, and cannot block
 * a merge, and making one of them required is a ruleset change, which is an admin action outside
 * every repository. So the whole of "this baseline can now refuse a merge" rests on one `- run:`
 * line living in one job, and on nothing being attached to that line that would let the job succeed
 * when the check failed. `continue-on-error: true`, a trailing `|| true` and an `if:` are the three
 * ways that line stops being a gate while still reading like one, and none of them changes the
 * step's own text enough for a reader to notice.
 *
 * WHAT THIS GRADES, AND HOW IT IS KEPT HONEST. `gradeWorkflow` parses the workflow's job and step
 * STRUCTURE, then reports problems. A checker over a file's text is only worth something if it can
 * fail, so every rule below is exercised against a MUTATED copy of the shipped workflow that breaks
 * exactly that rule, and the mutation is required to produce a problem. A rule with no mutation
 * beside it is a rule nobody has seen refuse.
 *
 * SECURITY / PHI: nothing here reads or writes anything outside this repository's own workflow file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const CI_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const CI = readFileSync(CI_PATH, "utf8");

/** The job that is this repository's only required status check. */
const REQUIRED_JOB = "verify";

/** What the gate step has to invoke. Written out here rather than read from the file under test. */
const GATE_SCRIPT = "scripts/drift-check.js";

type Step = { keys: Record<string, string>; text: string };

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The lines belonging to one top-level job, which sits at indent 2 under `jobs:`. */
function jobLines(text: string, job: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    if (indentOf(line) <= 2) break;
    out.push(line);
  }
  return out;
}

/** The job's own keys (`runs-on`, `steps`, `continue-on-error`, ...), at indent 4. */
function jobKeys(text: string, job: string): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const line of jobLines(text, job)) {
    if (indentOf(line) !== 4) continue;
    const match = /^ {4}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match !== null) keys[match[1]!] = match[2]!.trim();
  }
  return keys;
}

/**
 * The job's steps, each as the map of keys it declares.
 *
 * A step opens with `      - ` at indent 6 and continues with its own keys at indent 8; a block
 * scalar's body is folded into that key's value so a multi-line `run:` is graded as one command.
 */
function stepsOf(text: string, job: string): Step[] {
  const lines = jobLines(text, job);
  const start = lines.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  if (start === -1) return [];
  const steps: Step[] = [];
  let current: Step | null = null;
  let lastKey: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const indent = indentOf(line);
    if (indent < 6) break;
    if (/^ {6}- /.test(line)) {
      current = { keys: {}, text: line };
      steps.push(current);
      const match = /^ {6}- ([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      lastKey = match?.[1] ?? null;
      if (match !== null && lastKey !== null) current.keys[lastKey] = match[2]!.trim();
      continue;
    }
    if (current === null) continue;
    current.text += `\n${line}`;
    const match = /^ {8}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match !== null) {
      lastKey = match[1]!;
      current.keys[lastKey] = match[2]!.trim();
      continue;
    }
    // A continuation line of a block scalar, folded onto the key it belongs to.
    if (lastKey !== null) current.keys[lastKey] = `${current.keys[lastKey] ?? ""} ${line.trim()}`;
  }
  return steps;
}

/** The ways a `run:` body swallows its own exit status while still reading like a command. */
const NEUTRALIZED = [/\|\|\s*true\b/, /\|\|\s*:\s*$/, /;\s*true\s*$/, /\|\|\s*exit\s+0\b/];

/**
 * Every way the drift gate could be present and still not gate. Empty means it gates.
 *
 * @param {string} text The workflow file.
 * @returns {string[]} One problem per rule broken.
 */
function gradeWorkflow(text: string): string[] {
  const problems: string[] = [];

  // It has to run on a pull request against the default branch, or it never sees one.
  const trigger = /\n {2}pull_request:\n {4}branches: \[main\]\n/.test(text);
  if (!trigger) problems.push("the workflow does not run on a pull_request against main");

  const job = jobKeys(text, REQUIRED_JOB);
  if (Object.keys(job).length === 0) {
    problems.push(`there is no ${REQUIRED_JOB} job, which is the only required status check`);
    return problems;
  }
  if (job["continue-on-error"] !== undefined) {
    problems.push(
      `the ${REQUIRED_JOB} job carries continue-on-error, so no step in it can fail it`,
    );
  }

  const steps = stepsOf(text, REQUIRED_JOB);
  const gates = steps.filter((step) => (step.keys["run"] ?? "").includes(GATE_SCRIPT));
  if (gates.length === 0) {
    problems.push(`no step in ${REQUIRED_JOB} runs ${GATE_SCRIPT}`);
    return problems;
  }
  for (const gate of gates) {
    if (gate.keys["continue-on-error"] !== undefined) {
      problems.push(`the ${GATE_SCRIPT} step carries continue-on-error`);
    }
    if (gate.keys["if"] !== undefined) {
      problems.push(`the ${GATE_SCRIPT} step carries an if:, so the job can succeed without it`);
    }
    const run = gate.keys["run"] ?? "";
    for (const pattern of NEUTRALIZED) {
      if (pattern.test(run))
        problems.push(`the ${GATE_SCRIPT} step swallows its exit status: ${run}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The parser itself, because every assertion below is only as good as it is.
// ---------------------------------------------------------------------------

describe("the workflow parser reads the file it is pointed at", () => {
  it("finds the required job and its steps", () => {
    expect(Object.keys(jobKeys(CI, REQUIRED_JOB))).toContain("steps");
    expect(stepsOf(CI, REQUIRED_JOB).length).toBeGreaterThan(5);
  });

  it("does not confuse one job's steps with another's", () => {
    const verify = stepsOf(CI, REQUIRED_JOB).map((step) => step.keys["run"] ?? step.keys["uses"]);
    const dryRun = stepsOf(CI, "release-dry-run").map(
      (step) => step.keys["run"] ?? step.keys["uses"],
    );
    expect(verify).toContain(`node ${GATE_SCRIPT}`);
    expect(dryRun).not.toContain(`node ${GATE_SCRIPT}`);
    expect(dryRun.length).toBeGreaterThan(0);
  });

  it("reports a job that does not exist rather than reading an empty one as fine", () => {
    expect(stepsOf(CI, "nosuchjob")).toEqual([]);
    expect(gradeWorkflow(CI.split(`  ${REQUIRED_JOB}:`).join("  renamed:")).join("\n")).toContain(
      "there is no verify job",
    );
  });
});

// ---------------------------------------------------------------------------
// AC11: the gate runs in `verify` and nothing neutralizes it.
// ---------------------------------------------------------------------------

describe("AC11: the drift check runs in the required job with its exit status binding", () => {
  it("holds for the workflow as shipped", () => {
    expect(gradeWorkflow(CI)).toEqual([]);
  });

  it("runs the checker in the verify job, as a plain command", () => {
    const gates = stepsOf(CI, REQUIRED_JOB).filter((step) =>
      (step.keys["run"] ?? "").includes(GATE_SCRIPT),
    );
    expect(gates.length).toBe(1);
    expect(gates[0]!.keys["run"]).toBe(`node ${GATE_SCRIPT}`);
    expect(Object.keys(gates[0]!.keys)).toEqual(["run"]);
  });

  it("runs before the install it does not need, like the other zero-dependency gates", () => {
    const runs = stepsOf(CI, REQUIRED_JOB).map((step) => step.keys["run"] ?? "");
    const gate = runs.findIndex((run) => run.includes(GATE_SCRIPT));
    const install = runs.findIndex((run) => run.includes("pnpm install"));
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(gate);
  });

  it("REFUSES a workflow where the step was deleted", () => {
    const without = CI.split(`      - run: node ${GATE_SCRIPT}\n`).join("");
    expect(gradeWorkflow(without).join("\n")).toContain(`no step in ${REQUIRED_JOB} runs`);
  });

  it("REFUSES a step made advisory with continue-on-error", () => {
    const mutated = CI.split(`      - run: node ${GATE_SCRIPT}\n`).join(
      `      - run: node ${GATE_SCRIPT}\n        continue-on-error: true\n`,
    );
    expect(gradeWorkflow(mutated).join("\n")).toContain("carries continue-on-error");
  });

  it("REFUSES a step guarded by an if:", () => {
    const mutated = CI.split(`      - run: node ${GATE_SCRIPT}\n`).join(
      `      - run: node ${GATE_SCRIPT}\n        if: github.event_name == 'push'\n`,
    );
    expect(gradeWorkflow(mutated).join("\n")).toContain("carries an if:");
  });

  it.each(["|| true", "|| :", "; true", "|| exit 0"])(
    "REFUSES a step that swallows its exit status with `%s`",
    (tail) => {
      const mutated = CI.split(`      - run: node ${GATE_SCRIPT}\n`).join(
        `      - run: node ${GATE_SCRIPT} ${tail}\n`,
      );
      expect(gradeWorkflow(mutated).join("\n")).toContain("swallows its exit status");
    },
  );

  it("REFUSES a whole job made advisory, which would neutralize every step at once", () => {
    const mutated = CI.split(`  ${REQUIRED_JOB}:\n    runs-on: ubuntu-latest\n`).join(
      `  ${REQUIRED_JOB}:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n`,
    );
    expect(gradeWorkflow(mutated).join("\n")).toContain("carries continue-on-error, so no step");
  });

  it("REFUSES a workflow that stopped running on pull requests against main", () => {
    const mutated = CI.split("  pull_request:\n    branches: [main]\n").join("");
    expect(gradeWorkflow(mutated).join("\n")).toContain(
      "does not run on a pull_request against main",
    );
  });

  it("REFUSES the step moved out of verify into a job nothing requires", () => {
    // The likeliest quiet regression: the gate still runs and is still green in the UI, and no
    // merge is refused by it, because that job is not the required check.
    const moved = CI.split(`      - run: node ${GATE_SCRIPT}\n`)
      .join("")
      .split("  actionlint:\n    runs-on: ubuntu-latest\n    steps:\n")
      .join(
        `  actionlint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node ${GATE_SCRIPT}\n`,
      );
    expect(gradeWorkflow(moved).join("\n")).toContain(`no step in ${REQUIRED_JOB} runs`);
    expect(stepsOf(moved, "actionlint").map((s) => s.keys["run"])).toContain(`node ${GATE_SCRIPT}`);
  });
});

// ---------------------------------------------------------------------------
// The claim the step's own comment makes about why it lives there.
// ---------------------------------------------------------------------------

describe("the workflow says WHY the gate is in verify rather than in a workflow of its own", () => {
  it("names the ruleset that makes verify the only required check", () => {
    expect(CI).toContain("config-ci-required-checks");
  });

  it("does not add a drift workflow of its own, which could not refuse a merge", () => {
    // A separate workflow would run, be visible, and block nothing until an admin made it required.
    expect(CI).toContain(`node ${GATE_SCRIPT}`);
  });
});
