#!/usr/bin/env node
// scripts/publish-preflight.mjs
//
// REFUSE TO REACH THE REGISTRY WITH A CREDENTIAL MISSING, BEFORE THE BUILD IS PAID FOR.
//
// THE DEFECT THIS CLOSES. `pnpm run release` is `changeset publish`, and `changeset publish`
// discovers a missing or empty npm token the only way it can: by asking the registry and being
// refused. That refusal lands at the LAST step of a job that has already checked out, installed,
// built eight packages and, on this repository, waited for a human to approve a protected
// deployment. The diagnostic is an `E401` or an `EOTP` from npm rather than a sentence naming the
// credential, and the operator's first question ("which token, and where is it supposed to live")
// is answered nowhere in that output. Worse, a PARTIAL failure of this shape is the expensive one:
// the approval has been spent, and the run must be approved again after the fix.
//
// So this runs FIRST in the `release` script, ahead of `pnpm run build`, and it is a pure
// environment check: it reads `.github/credential-surface.json`, takes the credentials that
// declaration marks `requiredForPublish`, works out which environment variables the publish job is
// declared to hand them to, and refuses when one of them is absent or empty. Nothing is contacted,
// nothing is written, and no credential VALUE is ever read into a message.
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
// script's: nothing here hardcodes a credential name.
//
// EXIT CODES, and they are a contract:
//   0  every required credential is present and non-empty.
//   1  at least one required credential is absent or empty. Named, one per line.
//   2  the preflight could not run at all: a bad invocation, or a declaration that is absent,
//      empty, unparseable or malformed. Distinct from 1 because "we could not check" is not
//      "we checked and it was missing", and non-zero either way, so the publish stops regardless.
//
// Usage:
//   node scripts/publish-preflight.mjs [--repo <dir>] [--declaration <file>]

import { isAbsolute, join, resolve } from "node:path";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

import { DEFAULT_DECLARATION, InvocationError, loadDeclaration } from "./credential-surface.mjs";

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
 * Run the preflight.
 *
 * @param options.repoRoot The repository root the declaration is resolved against.
 * @param options.declarationPath Override for the declaration file.
 * @param options.env The environment to inspect. Defaults to `process.env`.
 * @returns `{ code, report }` where `code` is the process exit code.
 */
export function preflight({ repoRoot, declarationPath, env = process.env } = {}) {
  const root = resolve(repoRoot ?? join(import.meta.dirname, ".."));
  const file = resolve(declarationPath ?? join(root, DEFAULT_DECLARATION));

  const loaded = loadDeclaration(file);
  if (!loaded.ok) {
    return {
      code: 2,
      report: [
        "publish-preflight: REFUSING TO PUBLISH. The credential declaration could not be read, so",
        "nothing here can say which credentials this publish needs.",
        `  [${loaded.code}] ${loaded.message}`,
        ...(loaded.problems ?? []).map((problem) => `  [declaration-invalid] ${problem}`),
      ],
    };
  }
  const declaration = loaded.declaration;

  const required = requiredVariables(declaration);
  if (required.length === 0) {
    return {
      code: 2,
      report: [
        "publish-preflight: REFUSING TO PUBLISH. The declaration marks no credential as required",
        "for publishing, so this preflight would pass on any environment at all, including an empty",
        "one. That is a declaration bug, not a clean run.",
      ],
    };
  }

  const missing = required.filter(({ variable }) => (env[variable] ?? "").trim() === "");
  if (missing.length > 0) {
    const report = [
      `publish-preflight: REFUSING TO PUBLISH. ${missing.length} required credential(s) are absent`,
      "or empty in this environment, and the registry has NOT been contacted.",
    ];
    for (const { credential, variable } of missing) {
      const declared = declaration.credentials.find((entry) => entry.name === credential);
      report.push(
        `  ${variable} is empty. It carries ${credential}, whose single permitted storage`,
        `  location is: ${declared.storage}.`,
        `  Required token class: ${declared.tokenClass}`,
      );
    }
    report.push(
      `The declaration is ${DEFAULT_DECLARATION}; ${declaration.documentation.file}, section`,
      `"${declaration.documentation.section}", has the issue and install procedure for each.`,
    );
    return { code: 1, report };
  }

  return {
    code: 0,
    report: [
      `publish-preflight: ${required.length} required credential(s) present: ${required
        .map(({ variable }) => variable)
        .join(", ")}. Proceeding to build and publish.`,
    ],
  };
}

/**
 * @param argv Arguments after the script name.
 * @returns The parsed options.
 */
function parseArgs(argv) {
  const options = {};
  const flags = { "--repo": "repoRoot", "--declaration": "declarationPath" };
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
