#!/usr/bin/env node
// scripts/publish-toolchain.mjs
//
// THE PUBLISH PATH'S npm CLI MUST MEET THE TRUSTED-PUBLISHING FLOOR, AND A READER MUST BE ABLE TO
// TELL THAT FROM THE WORKFLOW FILE. REFUSED AT MERGE TIME, NOT AT PUBLISH TIME.
//
// THE DEFECT CLASS. `.github/credential-surface.json` declares that this repository publishes with
// the workflow's own OIDC identity and nothing else. That authentication lives in the npm CLI:
// `pnpm run release` is `changeset publish`, `changeset publish` spawns `pnpm publish` for a pnpm
// workspace, and `pnpm publish` packs and then calls `npm publish` through the `npm` it resolves off
// PATH. npm below the declared floor has no OIDC exchange in it at all, so the publish arrives
// unauthenticated, and npm's answer to an unauthenticated PUT is a 404 that reads like a missing
// package rather than like a refused credential. Nothing downstream of that is a good place to find
// out.
//
// WHY THE VERSION HAS TO BE DECLARED RATHER THAN RESOLVED. A runner's npm is whatever the Node
// release happens to bundle, which is not determinable from any file in this repository and moves
// under us between two runs of the same workflow. A publish path whose npm version is discoverable
// only at run time therefore does not meet the floor, however new the npm on today's runner is: the
// claim cannot be checked before the merge that ships it. So the workflow PINS an exact version in a
// step-level variable the declaration names, and this gate reads that variable.
//
// AND WHY THE DRY RUN HAS TO MATCH. `ci.yml`'s `release-dry-run` job exists to prove the publish
// command path on every push. A dry run on a different toolchain is not evidence about the real
// publish; it is evidence about a publish nobody performs. So the two declared toolchains are
// compared and any difference is a refusal, naming both.
//
// WHERE IT RUNS. `ci.yml`'s `verify` job, which is a REQUIRED status check in this repository's
// `config-ci-required-checks` ruleset, so this is the copy that can refuse a merge. Zero-dependency
// node, like the gates beside it, so it runs before `pnpm install`.
//
// EXIT CODES, and they are a contract:
//   0  the publish path declares an npm CLI at or above the floor, and the dry run declares the same
//      toolchain.
//   1  it does not. Every disagreement found is listed; the file and what was read are named.
//   2  this gate could not run: a bad invocation, or a declaration or workflow that is absent,
//      unreadable or unparseable. Kept distinct from 1 for the reason every sibling gate here keeps
//      it distinct: "we could not check" must not read as "we checked and it was fine".
//
// Usage:
//   node scripts/publish-toolchain.mjs [--repo <dir>] [--declaration <file>]
//                                      [--release-workflow <file>] [--ci-workflow <file>]

import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

import {
  DEFAULT_DECLARATION,
  InvocationError,
  loadDeclaration,
  parseWorkflow,
  WorkflowParseError,
} from "./credential-surface.mjs";

/** The CI workflow that carries the required `verify` job and the release dry run. */
export const DEFAULT_CI_WORKFLOW = ".github/workflows/ci.yml";

/** The job in that workflow whose toolchain must match the publish path's. */
export const DRY_RUN_JOB = "release-dry-run";

/** The action whose input declares the Node version of a job. */
const SETUP_NODE = "actions/setup-node";

/** An exact version: three dot-separated numbers and nothing else. A range is not determinable. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * @param node A parsed node.
 * @param key The key to read.
 * @returns The child node, or undefined.
 */
function mapGet(node, key) {
  if (node === undefined || node.kind !== "map") return undefined;
  for (const [candidate, value] of node.entries) if (candidate === key) return value;
  return undefined;
}

/**
 * @param node A parsed node.
 * @returns Its scalar value, or undefined when it is not a scalar.
 */
function scalarOf(node) {
  return node !== undefined && node.kind === "scalar" ? String(node.value) : undefined;
}

/**
 * Every step of one job, in order.
 *
 * @param workflow The parsed workflow.
 * @param jobId The job.
 * @returns The step nodes, or an empty list when the job or its steps are absent.
 */
function stepsOf(workflow, jobId) {
  const job = mapGet(mapGet(workflow, "jobs"), jobId);
  const steps = mapGet(job, "steps");
  return steps !== undefined && steps.kind === "seq" ? steps.items : [];
}

/**
 * Read the toolchain one job DECLARES, from the committed text alone.
 *
 * Both halves are read off a step rather than inferred: `node-version` from the `setup-node` step's
 * inputs, and the npm CLI version from the step-level variable the declaration names. A step that
 * sets that variable and never installs it is NOT a declaration of anything, so the step's own
 * script has to install the version it names; otherwise the value is decoration and the real npm is
 * whatever the runner had.
 *
 * @param workflow The parsed workflow.
 * @param jobId The job to read.
 * @param setting The variable name the declaration says pins the npm CLI.
 * @returns `{ node, npm, npmInstalled, npmSteps }`.
 */
export function declaredToolchain(workflow, jobId, setting) {
  let node;
  let npm;
  let npmInstalled = false;
  let npmSteps = 0;
  for (const step of stepsOf(workflow, jobId)) {
    const uses = scalarOf(mapGet(step, "uses"));
    if (uses !== undefined && uses.startsWith(`${SETUP_NODE}@`)) {
      node = scalarOf(mapGet(mapGet(step, "with"), "node-version")) ?? node;
    }
    const declared = scalarOf(mapGet(mapGet(step, "env"), setting));
    if (declared === undefined) continue;
    npmSteps += 1;
    npm = declared;
    const script = scalarOf(mapGet(step, "run")) ?? "";
    const installs = new RegExp(
      `npm\\s+(?:install|i)\\s+(?:--global|-g)\\s+["']?npm@\\$\\{?${setting}\\}?["']?`,
    );
    if (installs.test(script)) npmInstalled = true;
  }
  return { node, npm, npmInstalled, npmSteps };
}

/**
 * Compare two exact versions.
 *
 * @param version The version found.
 * @param floor The floor it must meet.
 * @returns True when `version` is at or above `floor`.
 */
export function meetsFloor(version, floor) {
  const left = version.split(".").map(Number);
  const right = floor.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return true;
    if (left[i] < right[i]) return false;
  }
  return true;
}

/**
 * Read and parse one workflow, turning every failure into a refusal rather than a skip.
 *
 * @param path Absolute path.
 * @returns `{ ok: true, workflow }` or `{ ok: false, code, message }`.
 */
function loadWorkflow(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      code: error.code === "ENOENT" ? "workflow-absent" : "workflow-unreadable",
      message: `${path} could not be read, so the toolchain it declares cannot be compared: ${error.message}`,
    };
  }
  try {
    return { ok: true, workflow: parseWorkflow(text) };
  } catch (error) {
    if (!(error instanceof WorkflowParseError)) throw error;
    return {
      ok: false,
      code: "workflow-unparseable",
      message: `${path} could not be parsed, so the toolchain it declares cannot be compared: ${error.message}`,
    };
  }
}

/**
 * Run the whole comparison.
 *
 * @param options.repoRoot The repository root every relative path resolves against.
 * @param options.declarationPath Override for the declaration file.
 * @param options.releaseWorkflowPath Override for the release workflow.
 * @param options.ciWorkflowPath Override for the CI workflow.
 * @returns `{ code, report }` where `code` is the process exit code.
 */
export function checkPublishToolchain({
  repoRoot,
  declarationPath,
  releaseWorkflowPath,
  ciWorkflowPath,
} = {}) {
  const root = resolve(repoRoot ?? join(import.meta.dirname, ".."));
  const declarationFile = resolve(declarationPath ?? join(root, DEFAULT_DECLARATION));

  const loaded = loadDeclaration(declarationFile);
  if (!loaded.ok) {
    return {
      code: 2,
      report: [
        "publish-toolchain: THE COMPARISON COULD NOT BE MADE, so this is a failure and not a pass.",
        `  [${loaded.code}] ${loaded.message}`,
        ...(loaded.problems ?? []).map((problem) => `  [declaration-invalid] ${problem}`),
      ],
    };
  }
  const declaration = loaded.declaration;
  const authentication = declaration.publishPath.authentication;
  const floor = authentication.npmCliFloor;
  const setting = authentication.npmCliVersionSetting;

  const releaseFile = resolve(releaseWorkflowPath ?? join(root, declaration.publishPath.workflow));
  const ciFile = resolve(ciWorkflowPath ?? join(root, DEFAULT_CI_WORKFLOW));
  const loadedRelease = loadWorkflow(releaseFile);
  const loadedCi = loadWorkflow(ciFile);
  const unreadable = [loadedRelease, loadedCi].filter((result) => !result.ok);
  if (unreadable.length > 0) {
    return {
      code: 2,
      report: [
        "publish-toolchain: THE COMPARISON COULD NOT BE MADE, so this is a failure and not a pass.",
        ...unreadable.map((result) => `  [${result.code}] ${result.message}`),
      ],
    };
  }

  const release = loadedRelease.workflow;
  const ci = loadedCi.workflow;
  const publishJob = declaration.publishPath.job;
  const publish = declaredToolchain(release, publishJob, setting);
  const dryRun = declaredToolchain(ci, DRY_RUN_JOB, setting);
  const findings = [];

  // ---- The floor (the publish path's own npm). --------------------------------------------------
  if (publish.npmSteps === 0) {
    findings.push(
      `${releaseFile}: job "${publishJob}" declares no \`${setting}\`, so the npm CLI that would ` +
        `make the publish request is whatever the runner resolves at run time. A version ` +
        `discoverable only at run time does not meet the ${floor} floor, because nothing before ` +
        `the merge can read it.`,
    );
  } else if (publish.npmSteps > 1) {
    findings.push(
      `${releaseFile}: job "${publishJob}" declares \`${setting}\` in ${publish.npmSteps} steps, ` +
        `so a reader cannot tell which npm publishes. Declare it once.`,
    );
  } else if (!EXACT_VERSION.test(publish.npm)) {
    findings.push(
      `${releaseFile}: job "${publishJob}" declares \`${setting}: ${publish.npm}\`, which is not ` +
        `an exact version. A range, a tag or an expression resolves at run time, and the floor ` +
        `${floor} has to be provable from this file.`,
    );
  } else if (!meetsFloor(publish.npm, floor)) {
    findings.push(
      `${releaseFile}: job "${publishJob}" declares \`${setting}: ${publish.npm}\` and trusted ` +
        `publishing needs npm ${floor} or later. Below that floor the npm CLI has no OIDC ` +
        `exchange, so the publish cannot authenticate at all.`,
    );
  } else if (!publish.npmInstalled) {
    findings.push(
      `${releaseFile}: job "${publishJob}" declares \`${setting}: ${publish.npm}\` and no step in ` +
        `it installs that npm globally, so the declared version is decoration and the npm that ` +
        `publishes is still whatever the runner resolved.`,
    );
  }

  // ---- The parity (the dry run proves the real path or it proves nothing). ----------------------
  if (dryRun.npmSteps === 0) {
    findings.push(
      `${ciFile}: job "${DRY_RUN_JOB}" declares no \`${setting}\` and ${releaseFile}'s ` +
        `"${publishJob}" declares \`${publish.npm ?? "none"}\`. A dry run on a different npm than ` +
        `the publish is not evidence about the publish.`,
    );
  } else if (dryRun.npm !== publish.npm) {
    findings.push(
      `${ciFile}: job "${DRY_RUN_JOB}" declares \`${setting}: ${dryRun.npm}\` and ` +
        `${releaseFile}'s "${publishJob}" declares \`${setting}: ${publish.npm ?? "none"}\`. A dry ` +
        `run on a different toolchain is not evidence about the real publish.`,
    );
  } else if (!dryRun.npmInstalled) {
    findings.push(
      `${ciFile}: job "${DRY_RUN_JOB}" declares \`${setting}: ${dryRun.npm}\` and no step in it ` +
        `installs that npm globally, so the dry run still runs on the runner's own npm.`,
    );
  }
  if (publish.node !== dryRun.node) {
    findings.push(
      `${ciFile}: job "${DRY_RUN_JOB}" declares \`node-version: ${dryRun.node ?? "none"}\` and ` +
        `${releaseFile}'s "${publishJob}" declares \`node-version: ${publish.node ?? "none"}\`. A ` +
        `dry run on a different toolchain is not evidence about the real publish.`,
    );
  }

  if (findings.length === 0) {
    return {
      code: 0,
      report: [
        `publish-toolchain: the publish path declares npm ${publish.npm} (floor ${floor}) on node ` +
          `${publish.node}, and "${DRY_RUN_JOB}" declares the same.`,
      ],
    };
  }
  return {
    code: 1,
    report: [
      `publish-toolchain: ${findings.length} problem(s) with the toolchain the publish path declares.`,
      "Every problem found is listed; fix them together rather than one run at a time.",
      ...findings.map((finding) => `  [publish-toolchain] ${finding}`),
    ],
  };
}

/**
 * @param argv Arguments after the script name.
 * @returns The parsed options.
 */
function parseArgs(argv) {
  const options = {};
  const flags = {
    "--repo": "repoRoot",
    "--declaration": "declarationPath",
    "--release-workflow": "releaseWorkflowPath",
    "--ci-workflow": "ciWorkflowPath",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const field = flags[arg];
    if (field === undefined) throw new InvocationError(`unknown argument ${JSON.stringify(arg)}`);
    i += 1;
    const value = argv[i];
    if (value === undefined) throw new InvocationError(`${arg} needs a value`);
    options[field] = isAbsolute(value) ? value : resolve(value);
  }
  return options;
}

/**
 * @param argv Arguments after the script name.
 * @returns The process exit code.
 */
export function main(argv) {
  const result = checkPublishToolchain(parseArgs(argv));
  const stream = result.code === 0 ? process.stdout : process.stderr;
  for (const line of result.report) stream.write(`${line}\n`);
  return result.code;
}

// Same guard, and the same reason, as its sibling gates: importing this file for tests must not run
// the CLI, and a broken invocation must not be able to read as a clean toolchain.
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof InvocationError) {
      process.stderr.write(`ERROR: publish-toolchain could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
