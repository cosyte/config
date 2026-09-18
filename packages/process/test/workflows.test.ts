import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, makeTempDir } from "./helpers.js";
import {
  gradeSecurityWorkflows,
  gradeWorkflowFile,
  gradeWorkflowText,
  SECURITY_WORKFLOW_SURFACES,
  WORKFLOW_DIRECTORY,
} from "../src/workflows.js";

/**
 * The canonical trigger surface, and the grader that compares a caller text against it.
 *
 * The two caller texts below are written out here rather than generated from the data: a grader
 * graded against a rendering of its own table proves only that the renderer round-trips. What has to
 * hold is that an independently written file passes and that every single-element mutation of it
 * fails, which is the difference between this check and one that asserts the file exists.
 */

afterAll(cleanupTempDirs);

const CODEQL = `name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: "27 3 * * 1"

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  codeql:
    permissions:
      security-events: write # upload the SARIF to the Security tab
      contents: read
      actions: read
    uses: cosyte/.github/.github/workflows/codeql.yml@main
`;

const SCORECARD = `name: Scorecard

on:
  push:
    branches: [main]
  schedule:
    - cron: "27 3 * * 2"

permissions:
  contents: read

jobs:
  scorecard:
    permissions:
      contents: read # required to resolve the reusable workflow
      security-events: write # upload the SARIF to the Security tab
      id-token: write # publish results to the OpenSSF API (for the badge)
    uses: cosyte/.github/.github/workflows/scorecard.yml@main
`;

const codeqlSurface = SECURITY_WORKFLOW_SURFACES["codeql.yml"];
const scorecardSurface = SECURITY_WORKFLOW_SURFACES["scorecard.yml"];

/** A repository tree carrying the two caller texts it is given. */
function repoWith(codeql: string | null, scorecard: string | null): string {
  const root = makeTempDir("cosyte-process-workflows-");
  const dir = join(root, ...WORKFLOW_DIRECTORY.split("/"));
  mkdirSync(dir, { recursive: true });
  if (codeql !== null) writeFileSync(join(dir, "codeql.yml"), codeql);
  if (scorecard !== null) writeFileSync(join(dir, "scorecard.yml"), scorecard);
  return root;
}

describe("AC-C8: a conforming caller text passes", () => {
  it("grades the canonical codeql caller clean", () => {
    expect(gradeWorkflowText(CODEQL, codeqlSurface)).toEqual([]);
  });

  it("grades the canonical scorecard caller clean, pull_request absent and all", () => {
    expect(gradeWorkflowText(SCORECARD, scorecardSurface)).toEqual([]);
  });

  it("grades both callers of a conforming repository clean", () => {
    expect(gradeSecurityWorkflows(repoWith(CODEQL, SCORECARD))).toEqual([]);
  });
});

describe("AC-C8: existence is not a pass", () => {
  it("fails a codeql caller that exists but has lost its schedule", () => {
    const withoutSchedule = CODEQL.replace('  schedule:\n    - cron: "27 3 * * 1"\n', "");
    const findings = gradeWorkflowText(withoutSchedule, codeqlSurface);
    expect(findings.join("\n")).toContain("codeql.yml: on.schedule");
    expect(findings.length).toBeGreaterThan(0);
  });

  it("fails a scorecard caller that exists but has lost its schedule", () => {
    const withoutSchedule = SCORECARD.replace('  schedule:\n    - cron: "27 3 * * 2"\n', "");
    expect(gradeWorkflowText(withoutSchedule, scorecardSurface).join("\n")).toContain(
      "scorecard.yml: on.schedule",
    );
  });

  it("fails a repository whose files are both present but both gutted", () => {
    const gutted = "name: CodeQL\n\non:\n  workflow_dispatch:\n";
    const findings = gradeSecurityWorkflows(repoWith(gutted, gutted));
    expect(findings.some((finding) => finding.startsWith("codeql.yml:"))).toBe(true);
    expect(findings.some((finding) => finding.startsWith("scorecard.yml:"))).toBe(true);
  });
});

describe("AC-C8: each differing element is named", () => {
  interface Mutation {
    /** What the mutation does, for the test title. */
    readonly what: string;
    /** The caller text after the mutation. */
    readonly text: string;
    /** The element the finding has to name. */
    readonly element: string;
  }

  const mutations: readonly Mutation[] = [
    {
      what: "a changed cron",
      text: CODEQL.replace("27 3 * * 1", "27 3 * * 5"),
      element: "codeql.yml: on.schedule",
    },
    {
      what: "a second cron",
      text: CODEQL.replace('- cron: "27 3 * * 1"', '- cron: "27 3 * * 1"\n    - cron: "27 4 * * 1"'),
      element: "codeql.yml: on.schedule",
    },
    {
      what: "a widened push branch list",
      text: CODEQL.replace("push:\n    branches: [main]", "push:\n    branches: [main, develop]"),
      element: "codeql.yml: on.push.branches",
    },
    {
      what: "a deleted pull_request trigger",
      text: CODEQL.replace("  pull_request:\n    branches: [main]\n", ""),
      element: "codeql.yml: on.pull_request.branches",
    },
    {
      what: "a moved reusable workflow reference",
      text: CODEQL.replace("codeql.yml@main", "codeql.yml@v1"),
      element: "codeql.yml: jobs.codeql.uses",
    },
    {
      what: "a dropped job permission",
      text: CODEQL.replace("      actions: read\n", ""),
      element: "codeql.yml: jobs.codeql.permissions.actions",
    },
    {
      what: "a widened job permission",
      text: CODEQL.replace("      contents: read\n", "      contents: write\n"),
      element: "codeql.yml: jobs.codeql.permissions.contents",
    },
    {
      what: "a job permission nobody asked for",
      text: CODEQL.replace("      actions: read\n", "      actions: read\n      packages: write\n"),
      element: "codeql.yml: jobs.codeql.permissions.packages",
    },
    {
      what: "a widened workflow-level permission",
      text: CODEQL.replace("permissions:\n  contents: read", "permissions:\n  contents: write"),
      element: "codeql.yml: permissions.contents",
    },
    {
      what: "concurrency cancellation switched off",
      text: CODEQL.replace("cancel-in-progress: true", "cancel-in-progress: false"),
      element: "codeql.yml: concurrency.cancel-in-progress",
    },
    {
      what: "a rewritten concurrency group",
      text: CODEQL.replace("group: ${{ github.workflow }}-${{ github.ref }}", "group: codeql"),
      element: "codeql.yml: concurrency.group",
    },
    {
      what: "a second job",
      text: `${CODEQL}  extra:\n    uses: cosyte/.github/.github/workflows/codeql.yml@main\n`,
      element: "codeql.yml: jobs",
    },
  ];

  it.each(mutations)("names the element for $what", ({ text, element }) => {
    const findings = gradeWorkflowText(text, codeqlSurface);
    expect(findings.join("\n")).toContain(element);
  });

  it("reports a scorecard caller that grew a pull_request trigger, which codeql carries and it must not", () => {
    const withPullRequest = SCORECARD.replace(
      "  push:\n    branches: [main]\n",
      "  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n",
    );
    expect(gradeWorkflowText(withPullRequest, scorecardSurface).join("\n")).toContain(
      "scorecard.yml: on.pull_request: want no pull_request trigger at all",
    );
  });

  it("does not report the codeql text against its own surface when the two files are not swapped", () => {
    // The two surfaces are not interchangeable: grading codeql's text against scorecard's surface
    // has to differ, and the same text against its own surface has to pass.
    expect(gradeWorkflowText(CODEQL, codeqlSurface)).toEqual([]);
    expect(gradeWorkflowText(CODEQL, scorecardSurface).length).toBeGreaterThan(0);
  });
});

describe("AC-C8: a file that cannot be read is a finding, never a pass", () => {
  it("names an absent file and where it was expected", () => {
    const root = repoWith(null, SCORECARD);
    const findings = gradeSecurityWorkflows(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("codeql.yml: absent at");
    expect(findings[0]).toContain(join(root, ".github", "workflows", "codeql.yml"));
  });

  it("names a file written in a shape the subset refuses, rather than reading it as empty", () => {
    const anchored = CODEQL.replace("permissions:\n  contents: read", "permissions: &perms\n  contents: read");
    const findings = gradeWorkflowText(anchored, codeqlSurface);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("cannot be read as a workflow");
    expect(findings[0]).toContain("anchors");
  });

  it("reports an empty file as every element missing, not as nothing to say", () => {
    const findings = gradeWorkflowText("", codeqlSurface);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join("\n")).toContain("codeql.yml: on:");
  });

  it("grades a path directly, so a caller outside .github/workflows can be checked", () => {
    const root = repoWith(CODEQL, SCORECARD);
    expect(
      gradeWorkflowFile(join(root, ".github", "workflows", "codeql.yml"), codeqlSurface),
    ).toEqual([]);
  });
});
