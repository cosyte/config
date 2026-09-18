import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  gradeWorkflowFile,
  gradeWorkflowText,
  SECURITY_WORKFLOW_FILES,
  SECURITY_WORKFLOW_SURFACES,
} from "../packages/process/src/workflows.js";

/**
 * THE CANONICAL CALLER TEXTS, GRADED AGAINST THE DATA THIS REPOSITORY PUBLISHES.
 *
 * `scripts/parser-template/.github/workflows/` holds the scaffold every parser repo's security
 * workflows are derived from, and `@cosyte/process` publishes the trigger surface a consuming repo
 * grades its own copies against. Those are two statements of one thing, in two files, so this asserts
 * they say the same thing: if the scaffold loses an element of the surface, every repo scaffolded
 * afterwards is born outside the standard that thirteen repos are graded by, and nothing else looks.
 *
 * It is deliberately not a diff of the two files. The surface is what a caller is graded on, and the
 * scaffold carries more than that (a name, comments); what has to hold is that every graded element
 * is present and equal in the scaffold.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const TEMPLATE_WORKFLOWS = join(REPO_ROOT, "scripts", "parser-template", ".github", "workflows");

describe("AC-C9: this repository's canonical caller texts match the surface it publishes", () => {
  it.each(SECURITY_WORKFLOW_FILES)("grades %s clean against the published surface", (file) => {
    const findings = gradeWorkflowFile(
      join(TEMPLATE_WORKFLOWS, file),
      SECURITY_WORKFLOW_SURFACES[file],
    );
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it.each(SECURITY_WORKFLOW_FILES)(
    "reports %s when its schedule is deleted, so the canonical cannot rot quietly",
    (file) => {
      // The mutation proves the grader is doing work: the same text, one element removed, must be
      // reported rather than passed on the ground that the file still exists and still parses.
      const text = readFileSync(join(TEMPLATE_WORKFLOWS, file), "utf8");
      const [cron] = SECURITY_WORKFLOW_SURFACES[file].schedule;
      const withoutSchedule = text.replace(`  schedule:\n    - cron: "${String(cron)}"\n`, "");
      expect(withoutSchedule).not.toBe(text);
      expect(gradeWorkflowText(withoutSchedule, SECURITY_WORKFLOW_SURFACES[file]).join("\n")).toContain(
        `${file}: on.schedule`,
      );
    },
  );

  it("reports the canonical codeql text when its reusable workflow reference moves", () => {
    const text = readFileSync(join(TEMPLATE_WORKFLOWS, "codeql.yml"), "utf8");
    const moved = text.replace("codeql.yml@main", "codeql.yml@v2");
    expect(moved).not.toBe(text);
    expect(gradeWorkflowText(moved, SECURITY_WORKFLOW_SURFACES["codeql.yml"]).join("\n")).toContain(
      "uses",
    );
  });

  it("reports the canonical scorecard text if it ever grows a pull_request trigger", () => {
    const text = readFileSync(join(TEMPLATE_WORKFLOWS, "scorecard.yml"), "utf8");
    const withPullRequest = text.replace(
      "  push:\n    branches: [main]\n",
      "  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n",
    );
    expect(withPullRequest).not.toBe(text);
    expect(
      gradeWorkflowText(withPullRequest, SECURITY_WORKFLOW_SURFACES["scorecard.yml"]).join("\n"),
    ).toContain("scorecard.yml: on.pull_request");
  });
});
