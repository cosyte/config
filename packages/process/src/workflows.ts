import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseYamlSubset, YamlSubsetError, type YamlMapping, type YamlValue } from "./yaml.js";

/**
 * The canonical trigger surface of the two security-workflow callers, published as data, plus the
 * grader that compares a caller text against it.
 *
 * A GitHub Actions workflow only runs when the file is in that repository's own
 * `.github/workflows/` directory, so there is no way to consolidate these files by deleting them.
 * What can be consolidated is the DEFINITION of what they must say: one canonical surface here, and
 * a mechanical comparison a consuming repo runs against its own copies.
 *
 * WHAT A PASS MEANS, AND WHAT IT DOES NOT. A pass means every element below was found and was equal.
 * The presence of the file is not one of the elements: a `codeql.yml` whose `schedule:` has been
 * deleted is a file that exists and a scan that no longer runs, and a check that reports the first
 * is a check that hides the second. The absence of a `pull_request` trigger on `scorecard.yml` is an
 * element in exactly the same way as the presence of one on `codeql.yml`: Scorecard grades the
 * default branch and its publish route is only valid from there, so a grader that treats the two
 * files as interchangeable is wrong about both.
 */

/** The two security-workflow callers this surface describes. */
export type SecurityWorkflowFile = "codeql.yml" | "scorecard.yml";

/** A permissions block, as a map from permission name to the grant it carries. */
export interface WorkflowPermissions {
  readonly [permission: string]: string;
}

/** The canonical trigger surface of one caller: every element a copy of it is graded on. */
export interface TriggerSurface {
  /** The file name this surface describes. */
  readonly file: SecurityWorkflowFile;
  /** The branches the `push` trigger must name. */
  readonly push: { readonly branches: readonly string[] };
  /**
   * The branches the `pull_request` trigger must name, or `null` when the surface requires the file
   * to carry NO `pull_request` trigger at all.
   */
  readonly pullRequest: { readonly branches: readonly string[] } | null;
  /** The cron expressions the `schedule` trigger must carry, in order. */
  readonly schedule: readonly string[];
  /**
   * The concurrency group and its cancellation flag.
   *
   * Absent when concurrency is not part of that file's surface, in which case a copy is graded on
   * neither carrying nor omitting one.
   */
  readonly concurrency?: { readonly group: string; readonly cancelInProgress: boolean };
  /** The workflow-level permissions, exactly. */
  readonly permissions: WorkflowPermissions;
  /** The single job's permissions and the reusable workflow it calls. */
  readonly job: { readonly permissions: WorkflowPermissions; readonly uses: string };
}

/** The directory a caller has to live in for GitHub to run it at all. */
export const WORKFLOW_DIRECTORY = ".github/workflows";

/**
 * The canonical trigger surface of each caller.
 *
 * @example
 * SECURITY_WORKFLOW_SURFACES["scorecard.yml"].pullRequest; // => null
 */
export const SECURITY_WORKFLOW_SURFACES: Readonly<Record<SecurityWorkflowFile, TriggerSurface>> = {
  "codeql.yml": {
    file: "codeql.yml",
    push: { branches: ["main"] },
    pullRequest: { branches: ["main"] },
    schedule: ["27 3 * * 1"],
    concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancelInProgress: true },
    permissions: { contents: "read" },
    job: {
      permissions: { "security-events": "write", contents: "read", actions: "read" },
      uses: "cosyte/.github/.github/workflows/codeql.yml@main",
    },
  },
  "scorecard.yml": {
    file: "scorecard.yml",
    push: { branches: ["main"] },
    // Scorecard grades the default branch, and its publish route is only valid from there.
    pullRequest: null,
    schedule: ["27 3 * * 2"],
    permissions: { contents: "read" },
    job: {
      permissions: { contents: "read", "security-events": "write", "id-token": "write" },
      uses: "cosyte/.github/.github/workflows/scorecard.yml@main",
    },
  },
};

/**
 * The two files, in the order a grader reports them.
 *
 * @example
 * SECURITY_WORKFLOW_FILES.length; // => 2
 */
export const SECURITY_WORKFLOW_FILES: readonly SecurityWorkflowFile[] = [
  "codeql.yml",
  "scorecard.yml",
];

/** A plain mapping, which is not an array and not null. @internal */
function isMapping(value: YamlValue | undefined): value is YamlMapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** How a value is named in a finding: structural, and short. @internal */
function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

/** Structural equality over the values this subset produces. @internal */
function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Grade one element by structural equality. @internal */
function gradeValue(
  file: string,
  element: string,
  want: unknown,
  got: YamlValue | undefined,
): string[] {
  return equal(want, got) ? [] : [`${file}: ${element}: want ${show(want)}, got ${show(got)}`];
}

/** Grade a permissions block as an exact map: a grant nobody asked for is a difference. @internal */
function gradePermissions(
  file: string,
  element: string,
  want: WorkflowPermissions,
  got: YamlValue | undefined,
): string[] {
  if (!isMapping(got)) {
    return [`${file}: ${element}: want ${show(want)}, got ${show(got)}`];
  }
  const findings: string[] = [];
  for (const [permission, grant] of Object.entries(want)) {
    const actual: YamlValue | undefined = got[permission];
    if (actual === undefined) {
      findings.push(`${file}: ${element}.${permission}: want ${show(grant)}, got nothing`);
    } else if (actual !== grant) {
      findings.push(`${file}: ${element}.${permission}: want ${show(grant)}, got ${show(actual)}`);
    }
  }
  for (const [permission, grant] of Object.entries(got)) {
    if (!(permission in want)) {
      findings.push(
        `${file}: ${element}.${permission}: not part of the canonical trigger surface, got ${show(grant)}`,
      );
    }
  }
  return findings;
}

/** The cron expressions a `schedule:` block carries, or `undefined` if it is not that shape. @internal */
function scheduleCrons(schedule: YamlValue | undefined): string[] | undefined {
  if (!Array.isArray(schedule)) return undefined;
  const crons: string[] = [];
  for (const entry of schedule) {
    if (!isMapping(entry)) return undefined;
    const cron: YamlValue | undefined = entry["cron"];
    if (typeof cron !== "string") return undefined;
    crons.push(cron);
  }
  return crons;
}

/** Grade the `on:` triggers, which is where an element goes missing without a red build. @internal */
function gradeTriggers(surface: TriggerSurface, root: YamlMapping): string[] {
  const file = surface.file;
  const triggers: YamlValue | undefined = root["on"];
  if (!isMapping(triggers)) {
    return [
      `${file}: on: want a mapping of triggers carrying push, schedule and the rest of the ` +
        `canonical surface, got ${show(triggers)}`,
    ];
  }

  const findings: string[] = [];
  const push: YamlValue | undefined = triggers["push"];
  findings.push(
    ...gradeValue(
      file,
      "on.push.branches",
      surface.push.branches,
      isMapping(push) ? push["branches"] : undefined,
    ),
  );

  const pullRequest: YamlValue | undefined = triggers["pull_request"];
  if (surface.pullRequest === null) {
    if (pullRequest !== undefined) {
      findings.push(
        `${file}: on.pull_request: want no pull_request trigger at all, got ${show(pullRequest)}`,
      );
    }
  } else {
    findings.push(
      ...gradeValue(
        file,
        "on.pull_request.branches",
        surface.pullRequest.branches,
        isMapping(pullRequest) ? pullRequest["branches"] : undefined,
      ),
    );
  }

  const crons = scheduleCrons(triggers["schedule"]);
  if (crons === undefined) {
    findings.push(
      `${file}: on.schedule: want ${String(surface.schedule.length)} cron entr(y/ies) ` +
        `${show(surface.schedule)}, got ${show(triggers["schedule"])}`,
    );
  } else {
    findings.push(...gradeValue(file, "on.schedule", surface.schedule, crons));
  }
  return findings;
}

/** Grade the single job's permissions and the reusable workflow it calls. @internal */
function gradeJob(surface: TriggerSurface, root: YamlMapping): string[] {
  const file = surface.file;
  const jobs: YamlValue | undefined = root["jobs"];
  if (!isMapping(jobs)) {
    return [`${file}: jobs: want exactly one job, got ${show(jobs)}`];
  }
  const ids = Object.keys(jobs);
  const [id] = ids;
  if (id === undefined || ids.length > 1) {
    return [`${file}: jobs: want exactly one job, got ${String(ids.length)} (${ids.join(", ")})`];
  }
  const job: YamlValue | undefined = jobs[id];
  if (!isMapping(job)) {
    return [`${file}: jobs.${id}: want a job calling the shared workflow, got ${show(job)}`];
  }
  return [
    ...gradePermissions(
      file,
      `jobs.${id}.permissions`,
      surface.job.permissions,
      job["permissions"],
    ),
    ...gradeValue(file, `jobs.${id}.uses`, surface.job.uses, job["uses"]),
  ];
}

/**
 * Grade a caller's text against a canonical trigger surface.
 *
 * @param text - The whole caller workflow file.
 * @param surface - The canonical surface to grade it against.
 * @returns One finding per differing element, each naming the file and the element. Empty is a pass.
 * @example
 * gradeWorkflowText("", SECURITY_WORKFLOW_SURFACES["codeql.yml"]).length > 0; // => true
 */
export function gradeWorkflowText(text: string, surface: TriggerSurface): string[] {
  let root: YamlMapping;
  try {
    root = parseYamlSubset(text);
  } catch (error: unknown) {
    const where = error instanceof YamlSubsetError ? error.message : "the file is not a mapping";
    return [
      `${surface.file}: the file cannot be read as a workflow (${where}): rewrite it in the block ` +
        `mapping form the canonical caller uses, then grade it again`,
    ];
  }

  const findings = [...gradeTriggers(surface, root)];
  if (surface.concurrency !== undefined) {
    const concurrency: YamlValue | undefined = root["concurrency"];
    const block = isMapping(concurrency) ? concurrency : undefined;
    findings.push(
      ...gradeValue(surface.file, "concurrency.group", surface.concurrency.group, block?.["group"]),
      ...gradeValue(
        surface.file,
        "concurrency.cancel-in-progress",
        surface.concurrency.cancelInProgress,
        block?.["cancel-in-progress"],
      ),
    );
  }
  findings.push(
    ...gradePermissions(surface.file, "permissions", surface.permissions, root["permissions"]),
    ...gradeJob(surface, root),
  );
  return findings;
}

/**
 * Grade the caller at a path. An absent file is a finding, never a pass.
 *
 * @param path - Absolute or relative path of the caller workflow file.
 * @param surface - The canonical surface to grade it against.
 * @returns One finding per differing element. Empty is a pass.
 * @example
 * gradeWorkflowFile("/nowhere/codeql.yml", SECURITY_WORKFLOW_SURFACES["codeql.yml"]).length; // => 1
 */
export function gradeWorkflowFile(path: string, surface: TriggerSurface): string[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [
      `${surface.file}: absent at ${path}: a workflow only runs from the repository's own ` +
        `${WORKFLOW_DIRECTORY} directory, so restore the canonical caller text there, then grade it again`,
    ];
  }
  return gradeWorkflowText(text, surface);
}

/**
 * Grade both security-workflow callers of a repository against the canonical surfaces.
 *
 * @param repoRoot - The repository root, which is where `.github/workflows` sits.
 * @returns Every finding, in file order. Empty is a pass.
 * @example
 * gradeSecurityWorkflows("/repo/with/no/workflows").length; // => 2
 */
export function gradeSecurityWorkflows(repoRoot: string): string[] {
  return SECURITY_WORKFLOW_FILES.flatMap((file) =>
    gradeWorkflowFile(
      join(repoRoot, ...WORKFLOW_DIRECTORY.split("/"), file),
      SECURITY_WORKFLOW_SURFACES[file],
    ),
  );
}
