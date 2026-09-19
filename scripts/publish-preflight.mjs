#!/usr/bin/env node
// scripts/publish-preflight.mjs
//
// REFUSE TO REACH THE REGISTRY WITH THE PUBLISH PATH'S AUTHENTICATION MISSING, OR ON AN npm THAT
// CANNOT USE IT, BEFORE THE BUILD IS PAID FOR.
//
// THE DEFECT THIS CLOSES. `pnpm run release` is `changeset publish`, and `changeset publish`
// discovers that it cannot authenticate the only way it can: by asking the registry and being
// refused. That refusal lands at the LAST step of a job that has already checked out, installed,
// built eight packages and, on this repository, waited for a human to approve a protected
// deployment. The diagnostic is an `E401`, an `ENEEDAUTH`, or, for a failed OIDC exchange, a bare
// 404 on the PUT that reads like a missing package; the operator's first question ("what was this
// supposed to authenticate with, and where does that come from") is answered nowhere in that
// output. Worse, a PARTIAL failure of this shape is the expensive one: the approval has been spent,
// and the run must be approved again after the fix.
//
// So this runs FIRST in the `release` script, ahead of `pnpm run build`, and it checks two things
// and contacts nothing:
//
//   1. THE AUTHENTICATION THE DECLARATION NAMES IS ACTUALLY AVAILABLE HERE. It reads
//      `.github/credential-surface.json`, takes `publishPath.authentication` and every credential
//      that declaration marks `requiredForPublish`, works out which environment variables those
//      amount to, and refuses when one of them is absent or empty. On this repository that is the
//      workflow's OIDC identity: GitHub exposes `ACTIONS_ID_TOKEN_REQUEST_URL` and
//      `ACTIONS_ID_TOKEN_REQUEST_TOKEN` to a job holding `id-token: write`, and their PRESENCE is
//      the whole observable. No value is read into a message, compared, or logged, and nothing is
//      contacted: this check cannot distinguish a good token from a bad one and does not pretend to.
//
//   2. THE npm THAT WILL MAKE THE REQUEST CAN DO TRUSTED PUBLISHING AT ALL. `changeset publish`
//      spawns `pnpm publish`, which packs and then calls `npm publish` through the `npm` it resolves
//      off PATH. npm below `publishPath.authentication.npmCliFloor` has no OIDC exchange in it, so
//      the publish arrives unauthenticated. The floor is asserted HERE, against the npm this process
//      resolves, and independently at merge time by `scripts/publish-toolchain.mjs` against the
//      version the workflow declares. Neither replaces the other: one reads committed text before a
//      merge, this one reads the binary that is about to run.
//
// WHY IT LIVES ON THE PUBLISH COMMAND PATH RATHER THAN IN THE WORKFLOW'S STEP LIST. Two reasons.
// The workflow's step list is `release.yml`'s control flow, which this change deliberately does not
// touch. And a step in the workflow would only guard the workflow: `pnpm run release` run by hand,
// by a future workflow, or by `changesets/action`'s `publish:` input all reach the registry through
// this script, and all of them get the same refusal.
//
// WHAT IT DELIBERATELY DOES NOT REFUSE. `RELEASE_PR_TOKEN` is optional by design and the workflow
// warns loudly when it is absent; failing closed on it would take the release path down to protect
// against a state this repository is already able to be in. The declaration marks it
// `requiredForPublish: false` and this script honours that. The rule is the declaration's, not this
// script's: nothing here hardcodes a credential name, a variable name or a version.
//
// EXIT CODES, and they are a contract:
//   0  the declared authentication is present and the resolved npm meets the declared floor.
//   1  it is not, or it does not. Named, one per line, with no credential value in any of them.
//   2  the preflight could not run at all: a bad invocation, a declaration that is absent, empty,
//      unparseable or malformed, a declaration that names no authentication for the publish path, or
//      an npm this check could not ask for its version. Distinct from 1 because "we could not check"
//      is not "we checked and it was missing", and non-zero either way, so the publish stops
//      regardless. When both kinds of problem are found, 2 wins: an unchecked property is a weaker
//      state than a failed one.
//
// Usage:
//   node scripts/publish-preflight.mjs [--repo <dir>] [--declaration <file>] [--npm-bin <bin>]

import { execFileSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

import { DEFAULT_DECLARATION, InvocationError, loadDeclaration } from "./credential-surface.mjs";

/** How long the version probe gets. A hung binary must not hang a release. */
const PROBE_TIMEOUT_MS = 60_000;

/**
 * Work out which environment variables must be set for the publish command to reach the registry.
 *
 * Derived from the declaration rather than listed again here: the publish job's exposures ARE the
 * variable names the publish command sees, so a rename in the workflow that the declaration follows
 * is picked up with no edit to this script, and a rename the declaration does NOT follow is caught
 * by `credential-surface.mjs` at merge time instead.
 *
 * @param declaration A validated declaration.
 * @returns A list of `{ credential, variable }`, one per variable that must be present.
 */
export function requiredVariables(declaration) {
  const job = declaration.publishPath.job;
  const required = [];
  for (const credential of declaration.credentials) {
    if (!credential.requiredForPublish) continue;
    for (const exposure of credential.exposures) {
      if (exposure.job !== job) continue;
      if (exposure.as !== "env") continue;
      if (exposure.mode === "presence-test") continue;
      required.push({ credential: credential.name, variable: exposure.name });
    }
  }
  return required;
}

/**
 * The variables that say the declared authentication is available in this environment.
 *
 * PRESENCE ONLY, AND THAT IS THE HONEST LIMIT OF IT. One of these variables is itself a credential:
 * it is tested with `in`-style emptiness and never read, compared or printed. A check that examined
 * the value would be a check that could leak it into a public build log for no gain, because
 * whether the registry ACCEPTS the identity is a fact only the registry has.
 *
 * @param declaration A validated declaration.
 * @returns A list of `{ method, variable, note }`, one per variable that must be present.
 */
export function requiredAuthentication(declaration) {
  const authentication = declaration.publishPath.authentication;
  return authentication.runtimeEvidence.map((evidence) => ({
    method: authentication.method,
    variable: evidence.variable,
    note: typeof evidence.note === "string" ? evidence.note : "",
  }));
}

/**
 * Ask the npm that would make the publish request for its version.
 *
 * ASKED, NEVER ASSUMED. Which npm answers is the point: `pnpm publish` calls `npm` off PATH, so the
 * binary this resolves is the binary that publishes. A probe that cannot be run, or whose answer is
 * not a version, is a refusal rather than a skip, for the reason every gate in this repository
 * refuses an input it could not read.
 *
 * @param npmBin The binary to ask. Defaults to `npm` off PATH.
 * @returns `{ ok: true, version }` or `{ ok: false, message }`.
 */
export function resolvedNpmVersion(npmBin = "npm") {
  let stdout;
  try {
    stdout = execFileSync(npmBin, ["--version"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      ok: false,
      message: `\`${npmBin} --version\` could not be run, so the npm that would publish cannot be checked against the floor: ${error.message}`,
    };
  }
  const version = stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    return {
      ok: false,
      message: `\`${npmBin} --version\` answered ${JSON.stringify(version)}, which is not a version this check can compare to the floor`,
    };
  }
  return { ok: true, version };
}

/**
 * Compare two versions by their first three numeric parts.
 *
 * @param version The version found.
 * @param floor The floor it must meet.
 * @returns True when `version` is at or above `floor`.
 */
export function meetsFloor(version, floor) {
  const left = version.split(".").map((part) => Number.parseInt(part, 10));
  const right = floor.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i += 1) {
    const a = Number.isNaN(left[i]) ? 0 : (left[i] ?? 0);
    const b = Number.isNaN(right[i]) ? 0 : (right[i] ?? 0);
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

/**
 * Run the preflight.
 *
 * @param options.repoRoot The repository root the declaration is resolved against.
 * @param options.declarationPath Override for the declaration file.
 * @param options.env The environment to inspect. Defaults to `process.env`.
 * @param options.npmBin The npm binary to ask for its version.
 * @returns `{ code, report }` where `code` is the process exit code.
 */
export function preflight({ repoRoot, declarationPath, env = process.env, npmBin } = {}) {
  const root = resolve(repoRoot ?? join(import.meta.dirname, ".."));
  const file = resolve(declarationPath ?? join(root, DEFAULT_DECLARATION));

  const loaded = loadDeclaration(file);
  if (!loaded.ok) {
    return {
      code: 2,
      report: [
        "publish-preflight: REFUSING TO PUBLISH. The credential declaration could not be read, so",
        "nothing here can say what this publish is supposed to authenticate with.",
        `  [${loaded.code}] ${loaded.message}`,
        ...(loaded.problems ?? []).map((problem) => `  [declaration-invalid] ${problem}`),
      ],
    };
  }
  const declaration = loaded.declaration;
  const authentication = declaration.publishPath.authentication;

  const credentials = requiredVariables(declaration);
  const identities = requiredAuthentication(declaration);
  if (credentials.length + identities.length === 0) {
    return {
      code: 2,
      report: [
        "publish-preflight: REFUSING TO PUBLISH. The declaration names no authentication for the",
        `publish path: \`${authentication.method}\` carries no runtime evidence and no credential is`,
        "marked required for publishing, so this preflight would pass on any environment at all,",
        "including an empty one. That is a declaration bug, not a clean run.",
      ],
    };
  }

  const report = [];
  let missing = 0;
  let unchecked = 0;

  const absent = (variable) => (env[variable] ?? "").trim() === "";
  const missingCredentials = credentials.filter(({ variable }) => absent(variable));
  const missingIdentities = identities.filter(({ variable }) => absent(variable));
  missing = missingCredentials.length + missingIdentities.length;

  if (missing > 0) {
    report.push(
      `publish-preflight: REFUSING TO PUBLISH. ${missing} thing(s) the declared authentication needs`,
      "are absent or empty in this environment, and the registry has NOT been contacted.",
    );
    for (const { method, variable, note } of missingIdentities) {
      report.push(
        `  ${variable} is empty. The declaration says this publish authenticates with`,
        `  \`${method}\`, and that variable is the evidence this environment can do so.`,
        ...(note === "" ? [] : [`  ${note}`]),
        `  ACTION: run the release through the \`${declaration.publishPath.job}\` job of`,
        `  ${declaration.publishPath.workflow}, which is where that authentication exists. There is`,
        "  no credential to substitute here, by design, so a publish run by hand cannot authenticate.",
      );
    }
    for (const { credential, variable } of missingCredentials) {
      const declared = declaration.credentials.find((entry) => entry.name === credential);
      report.push(
        `  ${variable} is empty. It carries ${credential}, whose single permitted storage`,
        `  location is: ${declared.storage}.`,
        `  Required token class: ${declared.tokenClass}`,
      );
    }
    report.push(
      `The declaration is ${DEFAULT_DECLARATION}; ${declaration.documentation.file}, section`,
      `"${declaration.documentation.section}", has the procedure for each.`,
    );
  }

  const floor = authentication.npmCliFloor;
  const probe = resolvedNpmVersion(npmBin);
  if (!probe.ok) {
    unchecked += 1;
    report.push(
      "publish-preflight: REFUSING TO PUBLISH. The npm CLI on this publish path could not be",
      "checked against the floor, and an unchecked floor is not a met one.",
      `  [npm-version-unreadable] ${probe.message}`,
    );
  } else if (!meetsFloor(probe.version, floor)) {
    missing += 1;
    report.push(
      "publish-preflight: REFUSING TO PUBLISH. The npm CLI on this publish path is too old for",
      "trusted publishing, and nothing has been packed.",
      `  npm ${probe.version} is on this path and the floor is npm ${floor}.`,
      "  `pnpm publish` calls this npm to make the publish request, and below that floor it has no",
      "  OIDC exchange in it, so the publish would arrive unauthenticated.",
    );
  }

  if (unchecked > 0) return { code: 2, report };
  if (missing > 0) return { code: 1, report };

  return {
    code: 0,
    report: [
      `publish-preflight: ${identities.length + credentials.length} authentication input(s) present: ` +
        `${[...identities, ...credentials].map(({ variable }) => variable).join(", ")}.`,
      `npm ${probe.version} is on this path, at or above the ${floor} floor. Proceeding to build and publish.`,
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
    "--npm-bin": "npmBin",
  };
  // `--npm-bin` is NOT resolved against the working directory: a bare name is a PATH lookup, which
  // is exactly how `pnpm publish` finds the npm it calls, and resolving it would silently turn that
  // into a path that does not exist.
  const paths = new Set(["repoRoot", "declarationPath"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const field = flags[arg];
    if (field === undefined) throw new InvocationError(`unknown argument ${JSON.stringify(arg)}`);
    i += 1;
    const value = argv[i];
    if (value === undefined) throw new InvocationError(`${arg} needs a value`);
    options[field] = paths.has(field) && !isAbsolute(value) ? resolve(value) : value;
  }
  return options;
}

/**
 * @param argv Arguments after the script name.
 * @returns The process exit code.
 */
export function main(argv) {
  const result = preflight(parseArgs(argv));
  const stream = result.code === 0 ? process.stdout : process.stderr;
  for (const line of result.report) stream.write(`${line}\n`);
  return result.code;
}

// Same guard, and the same reason, as `scripts/changeset-guard.mjs`: importing this file for tests
// must not publish anything, and a broken invocation must not be able to read as a clean preflight.
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof InvocationError) {
      process.stderr.write(`ERROR: publish-preflight could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
