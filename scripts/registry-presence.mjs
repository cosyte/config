#!/usr/bin/env node
// scripts/registry-presence.mjs
//
// IS EVERY BUMPED VERSION ACTUALLY ON THE REGISTRY, AND IF NOT, WHY NOT.
//
// THE DEFECT THIS EXISTS FOR, measured rather than assumed. Attempt 1 of publish run 35512528046
// published all eight packages and then reded the release: the presence check gave a just-published
// version three probes and two five second waits, so about ten seconds, and the registry recorded
// `@cosyte/test-utils@0.1.0` 73.594 seconds after the check had already given up. The publish had
// completed; only the registry's record of it had not. Because the `publish` job sits behind the
// protected `release` environment, clearing that false failure cost a second approval from the one
// required reviewer, and the run's terminal sentence went unsaid until they gave it.
// documentation/registry-propagation-evidence.md is the measurement, one row per package, with the
// delay stated as an interval because the publishing step does not record when inside its window
// each package went up.
//
// SO THE CHECK NOW DISTINGUISHES THREE STATES, AND ONLY TWO OF THEM RED:
//
//   present     the registry answered and the version is there. Nothing is owed.
//   absent      the registry answered, and the answer was that this version does not exist, and it
//               went on saying so for the whole budget. This is RELEASING.md failure state (c),
//               `Bumped but never published`, and it is a real state worth reding on.
//   unreadable  no probe ever got an answer: a transport failure, a DNS failure, an authentication
//               failure, a 5xx, or no reply at all. This also reds, SEPARATELY, because sending a
//               human to hunt for a package the registry was never able to answer about is sending
//               them to the wrong place.
//
// WHAT IS DELIBERATELY UNCHANGED. The predicate is the same question it always was and the answer
// still decides the run. Nothing here makes the check optional, advisory or skippable, and nothing
// lets a bumped package go green unpublished. The widening is the BUDGET and nothing else.
//
// IT DECIDES FROM THE REGISTRY ALONE. The work list is what the VERSION COMMIT bumped, handed in as
// `BUMPED_PACKAGES` by the release-notes gate; what a particular run's `changeset publish` reported
// having published is never read. That is what makes a re-run self-healing: `changeset publish`
// finds everything already on the registry, publishes nothing, reports `published=false`, and this
// still accounts for, tags and releases every package the commit bumped. The step in release.yml
// that keys off this records the hole that closed.
//
// WHY ONE MODULE AND NOT TWO COPIES OF INLINE SHELL. Both arms of release.yml ask this question, the
// gated `publish` job and the ungated `version` job, and two copies of a retry loop is how the two
// arms come to tolerate different things. They call this instead, so the budget and the distinction
// cannot drift, and a test can drive the whole thing against a registry it started itself.
//
// ZERO DEPENDENCIES, like the other release gates here, so a broken or malicious install cannot
// decide whether a release gate runs.
//
// Usage:
//   node scripts/registry-presence.mjs account --arm publish|version [--out <file>]
//                                              [--budget-seconds <n>] [--probe-interval-seconds <n>]
//
// Exit codes, which are a contract asserted by test/registry-presence.test.ts:
//   0  every bumped package is on the registry
//   1  at least one is absent after the whole budget, or could not be read at all
//   2  the accounting could not run: a bad invocation, or a work list that names no packages.
//      Distinct from 1 because "we could not check" is not "we checked and it was missing", and
//      non-zero either way, so the release stops regardless.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

/**
 * THE BUDGET: the maximum wall time the check will wait for one package's version to appear on the
 * registry before it declares that version absent.
 *
 * 300 seconds, and the number is derived rather than chosen. The largest delay upper bound in
 * documentation/registry-propagation-evidence.md is 242.594 seconds, measured off publish run
 * 35512528046; 300 is the smallest whole number of minutes at or above it. Moving this DOWN below
 * the measured maximum re-opens the defect, and moving it up without a measurement behind it is the
 * thing the evidence document exists to stop. Re-measure there first, then change it here.
 *
 * It costs nothing when it is not needed: the probe sequence stops on the first success, so a
 * package already visible is one probe. It costs the budget plus one probe, per package, when a
 * package is genuinely absent, and that is a release that needs a human anyway.
 */
export const PRESENCE_BUDGET_SECONDS = 300;

/** The wait between probe rounds. Unchanged: the shell this replaced also slept five seconds. */
export const PRESENCE_PROBE_INTERVAL_SECONDS = 5;

/**
 * How long ONE probe may take before it is killed.
 *
 * AC-9's bound is "the budget plus one probe", and that bound only exists if one probe is finite.
 * npm's own `fetch-timeout` defaults to five minutes, so a registry that accepts the connection and
 * never answers would otherwise hold a probe far past the budget. The retry policy here is the
 * budget, not npm's, which is also why `--fetch-retries=0` is passed below: time spent retrying
 * inside a single probe is time the budget cannot see.
 */
export const PRESENCE_PROBE_TIMEOUT_SECONDS = 30;

/** The registry answered and the version is there. */
export const PRESENT = "present";
/** The registry answered, and the answer was that this version does not exist. */
export const ABSENT = "absent";
/** No probe ever got an answer. Distinct from ABSENT, and this file's reason for existing twice. */
export const UNREADABLE = "unreadable";

/** Thrown when the accounting cannot run at all, which is exit 2 rather than exit 1. */
export class InvocationError extends Error {}

/**
 * Flags every probe carries, each one load-bearing.
 *
 *   --no-update-notifier  npm otherwise asks the registry about ITSELF on every invocation, which is
 *                         one more request that can fail for a reason having nothing to do with the
 *                         package under test.
 *   --prefer-online       force the staleness check. A packument is cacheable, and the whole
 *                         question here is whether a version that was not in the last copy is in the
 *                         registry's current one. Answering it from a cached packument is the defect
 *                         in a different costume.
 *   --fetch-retries=0     the budget is the retry policy. npm's own retries happen inside one probe,
 *                         where the budget cannot account for them, and they would break the bound
 *                         the probe timeout exists to give.
 */
const PROBE_FLAGS = ["--no-update-notifier", "--prefer-online", "--fetch-retries=0"];

/**
 * Credential shapes that must never reach a public job log, and the same set the workflow's npm
 * debug log collector redacts. This module prints npm's own diagnostic text on a failure, so the
 * redaction belongs here rather than in whatever happens to call it: a log path that writes around
 * the seam is a defect even when today's value is safe.
 */
const CREDENTIAL_SHAPES = [
  [/(_authToken|_auth|_password|authToken)(\s*[=:]\s*)\S+/gi, "$1$2REDACTED"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+=/-]{8,}/gi, "$1 REDACTED"],
  [/npm_[A-Za-z0-9]{36}/g, "npm_REDACTED"],
  [/gh[pousr]_[A-Za-z0-9]{36,}/g, "gh_REDACTED"],
  [/github_pat_[A-Za-z0-9_]{22,}/g, "github_pat_REDACTED"],
  [/\/\/[^/@\s:]+:[^/@\s]+@/g, "//REDACTED@"],
];

/**
 * Remove anything credential-shaped from text that is about to be logged.
 *
 * @param {string} text Any text.
 * @returns {string} The same text with credential shapes replaced.
 */
export function redact(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of CREDENTIAL_SHAPES) out = out.replace(pattern, replacement);
  return out;
}

/** One line of npm's own diagnosis, redacted and capped, so an annotation stays readable. */
function firstDiagnostic(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const diagnostics = lines.filter(
    (line) =>
      /^npm (error|ERR!)/.test(line) &&
      !/A complete log of this run/.test(line) &&
      !/Unknown (env|global) config/.test(line),
  );
  const chosen = diagnostics.slice(0, 2).join(" ") || lines[0] || "";
  return redact(chosen).slice(0, 200);
}

/**
 * Decide what one finished `npm view` says about a version.
 *
 * `E404` is npm's code for BOTH "no such package" and "no matching version", and both of those are
 * the registry answering that this version does not exist, which is the definition of absent. Every
 * other non-zero exit is the registry failing to answer, and so is a probe that had to be killed.
 * Unknown failures classify as unreadable rather than absent on purpose: both red the job, and
 * "we could not read the registry" sends a human to the right place, where "never published" does
 * not.
 *
 * @param {{ status: number|null, signal: string|null, output: string }} finished How npm exited.
 * @returns {{ state: string, detail: string }} The state and one line of why.
 */
export function classifyNpmView({ status, signal, output }) {
  if (status === 0) return { state: PRESENT, detail: "" };
  if (signal !== null && signal !== undefined) {
    return {
      state: UNREADABLE,
      detail: `the registry did not answer before the probe timeout (npm was killed with ${signal})`,
    };
  }
  const detail = firstDiagnostic(output);
  if (/\bE404\b/.test(String(output ?? ""))) return { state: ABSENT, detail };
  return { state: UNREADABLE, detail: detail || `npm view exited ${status} and said nothing` };
}

/**
 * One question to the registry: does `<name>@<version>` exist.
 *
 * `npm view` rather than a request of our own, because it is what the workflow has always asked and
 * it resolves the registry, the scope routing and the credentials out of the runner's own npm
 * configuration. Both streams are captured rather than discarded: the difference between "absent"
 * and "unreadable" is in them.
 *
 * @param {{ name: string, version: string, env?: object, timeoutSeconds?: number }} probe What to ask.
 * @returns {Promise<{ state: string, detail: string }>} The answer.
 */
export function probeWithNpm({
  name,
  version,
  env = process.env,
  timeoutSeconds = PRESENCE_PROBE_TIMEOUT_SECONDS,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };

    const child = spawn("npm", ["view", `${name}@${version}`, "version", ...PROBE_FLAGS], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));

    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      Math.max(1, Math.round(timeoutSeconds * 1000)),
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ state: UNREADABLE, detail: `npm could not be started: ${redact(error.message)}` });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      finish(classifyNpmView({ status, signal, output }));
    });
  });
}

/**
 * The work list: what the version commit bumped, as the release-notes gate reported it.
 *
 * It refuses rather than returning nothing. An empty list reaching here means the notes gate said a
 * release was pending and then named no packages, and an accounting that passed on it would report
 * a clean release having checked nothing.
 *
 * @param {string|undefined} raw The `BUMPED_PACKAGES` JSON.
 * @returns {{ name: string, version: string }[]} One entry per bumped package.
 */
export function parseBumpedPackages(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch (error) {
    throw new InvocationError(`the bumped package list is not JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new InvocationError("the notes gate reported a release but named no packages");
  }
  return parsed.map((entry, index) => {
    const name = entry?.name;
    const version = entry?.version;
    if (typeof name !== "string" || name === "") {
      throw new InvocationError(`bumped package ${index} has no name`);
    }
    if (typeof version !== "string" || version === "") {
      throw new InvocationError(`bumped package ${name} has no version`);
    }
    return { name, version };
  });
}

/** Seconds, to one decimal, so a log line reads as a measurement rather than a float. */
const secs = (value) => (Math.round(value * 10) / 10).toFixed(1);

/**
 * Ask the registry about every bumped package, waiting out propagation but not absence.
 *
 * PROBED IN ROUNDS, NOT ONE PACKAGE AT A TIME, and this is the part not to "simplify". Every
 * package in one release starts propagating at roughly the same moment, so the budget is wall time
 * they all spend together. Draining one package's whole budget before the next one is first asked
 * would multiply the step's worst case by the number of packages, for no extra tolerance: each
 * package still gets the full budget of wall time here, because the clock starts once and every
 * pending package is asked again in every round.
 *
 * A package is UNREADABLE only if EVERY probe for it failed for a reason other than the registry
 * reporting the version absent. One real answer of "no such version" is an answer, and it decides.
 *
 * @param {object} options
 * @param {{name: string, version: string}[]} options.packages The work list.
 * @param {"publish"|"version"} [options.arm] Which arm is asking. It decides the terminal action
 *   the annotation names, which is the one thing the two arms legitimately differ on.
 * @param {number} [options.budgetSeconds] Overridable so a test can grade the race without spending
 *   the shipped budget in wall time. The workflow passes nothing and gets the shipped value.
 * @param {number} [options.intervalSeconds] The wait between rounds.
 * @param {number} [options.probeTimeoutSeconds] How long one probe may take.
 * @param {object} [options.env] The environment probes run in.
 * @param {Function} [options.probe] The registry, which is the boundary a test replaces.
 * @param {Function} [options.now] The clock.
 * @param {Function} [options.sleep] The wait.
 * @param {Function} [options.log] Where lines and annotations go.
 * @returns {Promise<{code: number, expected: number, rows: object[]}>} The verdict and one row per
 *   package, in work list order.
 */
export async function account({
  packages,
  arm = "publish",
  budgetSeconds = PRESENCE_BUDGET_SECONDS,
  intervalSeconds = PRESENCE_PROBE_INTERVAL_SECONDS,
  probeTimeoutSeconds = PRESENCE_PROBE_TIMEOUT_SECONDS,
  env = process.env,
  probe = probeWithNpm,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const rows = packages.map(({ name, version }) => ({
    name,
    version,
    state: null,
    probes: 0,
    elapsedSeconds: 0,
    detail: "",
    sawAbsent: false,
  }));
  const expected = rows.length;
  const started = now();
  const deadline = started + budgetSeconds * 1000;

  for (;;) {
    const pending = rows.filter((row) => row.state === null);
    if (pending.length === 0) break;

    for (const row of pending) {
      const answer = await probe({
        name: row.name,
        version: row.version,
        env,
        timeoutSeconds: probeTimeoutSeconds,
      });
      row.probes += 1;
      row.elapsedSeconds = (now() - started) / 1000;
      if (answer.state === PRESENT) {
        row.state = PRESENT;
        // SAY THE WAIT OUT LOUD. A release that waited for propagation and a release that never had
        // to are otherwise the same green step, and the next reader of a slow run has no way to
        // tell that the budget is doing work.
        if (row.probes > 1) {
          log(
            `Propagation wait: ${row.name}@${row.version} was not on the registry on the first ` +
              `probe and appeared on probe ${row.probes}, ${secs(row.elapsedSeconds)}s later ` +
              `(budget ${budgetSeconds}s).`,
          );
        }
        continue;
      }
      row.detail = answer.detail;
      if (answer.state === ABSENT) row.sawAbsent = true;
    }

    const stillPending = rows.filter((row) => row.state === null);
    if (stillPending.length === 0) break;
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      for (const row of stillPending) row.state = row.sawAbsent ? ABSENT : UNREADABLE;
      break;
    }
    await sleep(Math.min(intervalSeconds * 1000, remainingMs));
  }

  const missing = rows.filter((row) => row.state === ABSENT);
  const unreadable = rows.filter((row) => row.state === UNREADABLE);
  const named = (list) => list.map((row) => `${row.name}@${row.version}`).join(", ");

  for (const row of unreadable) {
    log(
      `${row.name}@${row.version}: no probe got an answer. ${row.probes} probe(s) over ` +
        `${secs(row.elapsedSeconds)}s, last failure: ${row.detail}`,
    );
  }
  if (unreadable.length > 0) {
    log(
      `::error title=Registry could not be read::${unreadable.length} of ${expected} package(s) ` +
        `could not be checked at all: ${named(unreadable)}. Every probe failed for a reason other ` +
        `than the registry reporting the version absent, so this is NOT a report that those ` +
        `packages are missing and hunting for them on npm is the wrong first move. Each one's last ` +
        `failure is in the lines above. Check the registry's status and this runner's network ` +
        `access, then re-run this job: the accounting reads the registry rather than this run's ` +
        `own output, so a re-run completes whatever is still owed.`,
    );
  }

  if (missing.length > 0) {
    const shared =
      `${missing.length} of ${expected} package(s) were bumped by this ` +
      `${arm === "version" ? "commit" : "version commit"} but are not on the registry after ` +
      `${budgetSeconds}s of probing: ${named(missing)}.`;
    log(
      arm === "version"
        ? `::error title=Bumped but never published (version arm)::${shared} This push carries a ` +
            `pending changeset AS WELL AS a version bump, so it took the ungated version arm and ` +
            `the gated publish arm never ran; or an earlier step in this job failed. RELEASING.md ` +
            `failure state (c) has the terminal action: merge the Version Packages PR this run ` +
            `just opened, or land a changeset-free commit on main. Either takes the publish arm ` +
            `and publishes these.`
        : `::error title=Bumped but never published::${shared} Either the publish failed for them, ` +
            `or an earlier step in this job failed and the publish never ran. Check the steps ` +
            `above before the registry. RELEASING.md failure state (c) has the terminal action.`,
    );
  }

  return { code: missing.length + unreadable.length > 0 ? 1 : 0, expected, rows };
}

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {object} The parsed options.
 */
function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "account") {
    throw new InvocationError(
      `unknown subcommand ${JSON.stringify(subcommand ?? "")}. Expected \`account\`.`,
    );
  }
  const options = { arm: "publish" };
  const numbers = {
    "--budget-seconds": "budgetSeconds",
    "--probe-interval-seconds": "intervalSeconds",
  };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined) throw new InvocationError(`${flag} needs a value`);
    i += 1;
    if (flag === "--arm") {
      if (value !== "publish" && value !== "version") {
        throw new InvocationError(`--arm must be \`publish\` or \`version\`, not ${value}`);
      }
      options.arm = value;
      continue;
    }
    if (flag === "--out") {
      options.out = value;
      continue;
    }
    const field = numbers[flag];
    if (field === undefined) throw new InvocationError(`unknown argument ${JSON.stringify(flag)}`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new InvocationError(`${flag} must be a positive number of seconds, not ${value}`);
    }
    options[field] = parsed;
  }
  return options;
}

/**
 * @param {string[]} argv Arguments after the script name.
 * @param {{env?: object, log?: Function}} [io] Injection points for a test.
 * @returns {Promise<number>} The process exit code.
 */
export async function main(argv, { env = process.env, log } = {}) {
  const options = parseArgs(argv);
  const packages = parseBumpedPackages(env.BUMPED_PACKAGES);
  const result = await account({ ...options, packages, env, log });
  if (options.out !== undefined) {
    // Written whatever the verdict, because the caller still has to tag and release every package
    // that IS on the registry: a partial publish that tagged nothing is the state a re-run cannot
    // recover from.
    writeFileSync(
      options.out,
      result.rows.map((row) => `${row.name}\t${row.version}\t${row.state}\n`).join(""),
      "utf8",
    );
  }
  return result.code;
}

// Same guard, and the same reason, as scripts/publish-preflight.mjs: importing this file for tests
// must not probe anything, and a broken invocation must not be able to read as a clean accounting.
if (isCliEntrypoint(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof InvocationError) {
        process.stderr.write(`ERROR: registry-presence could not run: ${error.message}\n`);
        process.exit(2);
      }
      throw error;
    });
}
