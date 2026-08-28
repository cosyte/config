#!/usr/bin/env node
// scripts/npm-config-allow.mjs
//
// REFUSE A PUBLISH WHOSE EFFECTIVE CONFIGURATION NOBODY APPROVED, BEFORE ANY PACKAGE IS PACKED.
//
// THE DEFECT THIS EXISTS FOR (S0055 finding F9). Everything that decides WHERE these eight tarballs
// go, WHAT goes inside them and WHAT METADATA rides along is npm/pnpm configuration, and that
// configuration is assembled at publish time out of several independent sources that nothing in this
// repository used to inspect: a global npmrc, a user npmrc (which on a GitHub runner is a file
// `actions/setup-node` GENERATES and points `NPM_CONFIG_USERCONFIG` at), a repository `.npmrc`, a
// per-package `.npmrc`, `pnpm-workspace.yaml`, the root manifest's `pnpm` block, each package's
// `publishConfig`, `.changeset/config.json`, and the process environment. A redirected `registry`, a
// disabled `provenance`, a widened `access` or an injected lifecycle-script setting changes what
// reaches the public registry WITHOUT changing a single tracked file in a way review would see.
//
// An npm publish is permanent and cannot be withdrawn. So this gate answers one question before the
// publish command starts: is every value the publish command would actually use permitted by an
// allow-set committed in this repository? If not, the release does not happen.
//
// -----------------------------------------------------------------------------------------------
// HOW THE EFFECTIVE CONFIGURATION IS ESTABLISHED, AND WHY IT IS NOT HAND-ROLLED.
//
// The requirement (spec S0081, D1) is an EQUIVALENCE PROPERTY, not a list of files: the values this
// check judges must be the values the publish command would use, resolved in the same context, with
// the same precedence. Re-implementing npm's and pnpm's precedence here would re-create the very
// defect the gate exists to close, one layer down, because a partial precedence model reports GREEN
// exactly when it looked at the wrong layer.
//
// So the precedence is never computed here. It is ASKED OF THE PACKAGE MANAGERS THEMSELVES, in the
// publish command's own process context (same working directory, same environment, same HOME):
//
//   * `npm config ls`          npm's own report of every setting whose value came from a source
//                              OTHER than npm's built-in defaults, GROUPED BY SOURCE, with values
//                              that lost to a higher-precedence source printed commented out and
//                              marked `; overridden by <source>`. npm decides what "default" means,
//                              npm decides who won, and this file only reads the answer.
//   * `npm config ls --json`   the full effective map including defaults. Used to answer "what IS
//                              the effective value of this key" for the allow-set's `require` rules,
//                              which must be able to catch a key that NO source contributes.
//   * `pnpm config list --json`  pnpm's own effective map. This is not redundant: `changeset publish`
//                              spawns `pnpm publish` (verified in @changesets/cli 2.31.0's
//                              `internalPublish`, which branches on `getPublishTool`), and pnpm reads
//                              two sources npm does not, `pnpm-workspace.yaml` and the root
//                              manifest's `pnpm` block.
//
// WHAT "THE PACKAGE MANAGER'S OWN BUILT-IN DEFAULTS" MEANS HERE, stated because the acceptance
// criteria turn on it. For npm it means whatever npm itself omits from `npm config ls`: npm knows
// its own defaults and this file does not second-guess them. For pnpm, which has no such report, it
// means THE VALUE THE SAME pnpm BINARY REPORTS FOR THAT KEY WHEN EVERY NON-DEFAULT SOURCE IS TAKEN
// AWAY: a throwaway directory with no `.npmrc` and no `pnpm-workspace.yaml`, an empty HOME, empty
// user and global rc files, and an environment scrubbed of every `npm_config_*` variable. The
// baseline is MEASURED with the same binary rather than written down as a table, because a table
// goes stale on the next pnpm release and a stale table is a silent hole. The sandbox mirrors the
// root manifest's `packageManager` field so that the baseline and the effective run are the SAME
// pnpm version; without that mirror pnpm's own version switching answers the two runs with different
// binaries, and every key would diff.
//
// FAIL-CLOSED IS THE BOTTOM OF THE PROPERTY. A configuration source that cannot be located, read or
// parsed, and a resolver that cannot be run or whose output cannot be parsed, are REFUSALS (exit 2),
// never skips. That is what keeps the guarantee true when a future package-manager release adds a
// source nobody anticipated today: the unknown source shows up as a key with no known origin and
// still has to be permitted by the committed allow-set before anything is published.
//
// -----------------------------------------------------------------------------------------------
// THE ALLOW-SET IS A COMMITTED ARTIFACT AND ITS ABSENCE IS A REFUSAL (spec S0081, D3).
//
// `npm-config-allow.json` lives in the repository so that changing what a release may be configured
// with is a reviewable diff. A missing, empty or unparseable allow-set is a refusal: "missing" must
// NEVER read as "permit everything", which is the single most likely way a control like this stops
// controlling anything without anyone noticing. A WELL-FORMED allow-set declaring zero permitted
// deviations is a different state and is legitimate: it means "no source may contribute anything
// beyond the package manager's own defaults".
//
// Usage:
//   node scripts/npm-config-allow.mjs [--workspace <repo-root>] [--allow-set <path>]
//                                     [--npm-bin <bin>] [--pnpm-bin <bin>]
//
// Exit codes, which are a contract and are asserted by test/npm-config-allow.test.ts:
//   0  every contributed value is permitted and every required key holds
//   1  the refusal this gate exists for: a value is not permitted, or a required key does not hold
//   2  the check could not run (bad invocation; absent, empty, unparseable or invalid allow-set; a
//      configuration source that is unreadable or malformed; a resolver that failed)
//
// The 1-versus-2 split is the same contract scripts/changeset-guard.mjs keeps, for the same reason:
// a gate that could not read its input must not report the same code as a gate that read it and
// found a violation, or "broken" and "caught something" become one signal in CI.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

// Imported by RELATIVE PATH, not as `@cosyte/script-utils`, and that is deliberate: this gate runs
// BEFORE `pnpm install` in release.yml, so there is no `node_modules` for a bare specifier to
// resolve through. Same reasoning as scripts/changeset-guard.mjs.
import { isCliEntrypoint } from "../packages/script-utils/index.js";

/** Thrown for an invocation, source or resolver problem: exit 2, never exit 1. */
class InvocationError extends Error {}

/** The committed allow-set, relative to the workspace root. */
export const ALLOW_SET_FILENAME = "npm-config-allow.json";

/** What replaces the value of a credential-denoting key in every line this script prints. */
export const REDACTION_MARKER = "[REDACTED]";

/** Sentinel for "no source and no default supplies this key at all". */
const UNSET = "(unset)";

/** How long a resolver gets before the gate refuses. A hung resolver must not hang a release. */
const RESOLVER_TIMEOUT_MS = 120_000;

/**
 * npm settings whose whole name is the credential, matched EXACTLY.
 *
 * `key` is npm's TLS PRIVATE key and `cert` its certificate; both are pasted secrets in practice.
 * They are matched exactly rather than as a word inside a longer key, because `-key` is an ordinary
 * suffix (`global-bin-key`, `some-cache-key`) and classifying every one of those as a secret would
 * force the allow-set to permit them at any value, which is a weaker control, not a stronger one.
 */
const CREDENTIAL_KEY_EXACT = new Set([
  "key",
  "cert",
  "otp",
  "_auth",
  "_authtoken",
  "_password",
  "password",
  "passwd",
  "token",
  "secret",
]);

/**
 * Keys whose value denotes a credential, matched as a segment of the NORMALIZED key.
 *
 * This is what catches npm's nerfed per-registry forms (`//registry.npmjs.org/:_authToken`,
 * `//registry.npmjs.org/:_password`). It deliberately does NOT match a bare `auth` segment, so
 * `always-auth` and `auth-type` stay ordinary settings that the allow-set can pin to an exact value:
 * neither holds a secret, and pinning them is a stronger control than permitting them at any value.
 */
const CREDENTIAL_KEY_PATTERN =
  /(^|[:./_-])(_auth|_authtoken|_password|password|passwd|token|secret|api-?key|credentials?)($|[:./_-])/;

/**
 * Credential-SHAPED text, scrubbed from every byte this script prints regardless of which key it
 * arrived under.
 *
 * The key-name rule above cannot see a token pasted into a key nobody would call a credential, and
 * this repository is public, so its build logs are public. Same posture as the npm-debug-log
 * redaction in release.yml, and deliberately the same token shapes.
 */
const CREDENTIAL_TEXT_PATTERNS = [
  /npm_[A-Za-z0-9]{36}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

/**
 * Normalize a configuration key so that npm's dash-case, pnpm's camelCase and a manifest's
 * camelCase name the same setting.
 *
 * pnpm 10 reports `ignore-scripts` where pnpm 11 reports `ignoreScripts`, and `publishConfig`
 * carries camelCase names. Matching on the normalized form keeps the allow-set from needing one
 * entry per spelling. Display always uses the key as the resolver reported it.
 *
 * @param {string} key Key as some source or resolver spelled it.
 * @returns {string} The normalized key.
 */
export function normalizeKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Does this key denote a credential.
 *
 * @param {string} key Key as reported.
 * @returns {boolean} True when the value must never be printed.
 */
export function isCredentialKey(key) {
  const normalized = normalizeKey(key);
  return CREDENTIAL_KEY_EXACT.has(normalized) || CREDENTIAL_KEY_PATTERN.test(normalized);
}

/**
 * Scrub credential-shaped text out of anything about to be printed.
 *
 * @param {string} text Text to scrub.
 * @returns {string} The same text with credential shapes replaced.
 */
export function redactText(text) {
  let out = text;
  for (const pattern of CREDENTIAL_TEXT_PATTERNS) out = out.replace(pattern, REDACTION_MARKER);
  return out;
}

/**
 * Canonical string form of a configuration value, so that two values compare by content rather than
 * by key order or by whether one arrived as a string.
 *
 * @param {unknown} value Any JSON-representable value.
 * @returns {string} A stable serialization.
 */
export function canonicalValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalValue(value[k])}`).join(",")}}`;
}

/**
 * Render a key and its value for human output, redacted when the key denotes a credential.
 *
 * @param {string} key Key as reported.
 * @param {unknown} value The value.
 * @returns {string} `key = value`, or `key = [REDACTED]`.
 */
export function formatSetting(key, value) {
  if (isCredentialKey(key)) return `${key} = ${REDACTION_MARKER}`;
  return `${key} = ${redactText(canonicalValue(value))}`;
}

// ---------------------------------------------------------------------------------------------
// THE ALLOW-SET
// ---------------------------------------------------------------------------------------------

/**
 * Read, parse and validate the committed allow-set.
 *
 * Every failure here is an InvocationError (exit 2). Absent, empty and unparseable are three
 * different messages and one outcome, because the outcome that must never exist is "treated as
 * permitting everything".
 *
 * @param {string} allowSetPath Absolute path to the allow-set.
 * @returns {{ allow: object[], require: object[], path: string }} The validated allow-set.
 */
export function loadAllowSet(allowSetPath) {
  let raw;
  try {
    raw = readFileSync(allowSetPath, "utf8");
  } catch (cause) {
    const code = /** @type {{ code?: string }} */ (cause).code;
    if (code === "ENOENT") {
      throw new InvocationError(
        `the allow-set ${allowSetPath} does not exist. An absent allow-set is a REFUSAL, never ` +
          `"permit everything": this gate cannot know what a release may be configured with if ` +
          `nobody has written it down. Commit ${ALLOW_SET_FILENAME}.`,
      );
    }
    throw new InvocationError(`cannot read the allow-set ${allowSetPath}: ${String(cause)}`);
  }

  if (raw.trim() === "") {
    throw new InvocationError(
      `the allow-set ${allowSetPath} is empty. An empty FILE is not the same state as an ` +
        `allow-set that declares zero permitted deviations (which is \`{"version": 1, ` +
        `"allow": [], "require": []}\` and is legitimate). Refusing rather than guessing which ` +
        `was meant.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new InvocationError(
      `the allow-set ${allowSetPath} is not parseable JSON: ${String(cause)}. Refusing: an ` +
        `unparseable allow-set must not be read as permitting the observed configuration.`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvocationError(`the allow-set ${allowSetPath} must be a JSON object.`);
  }
  if (parsed.version !== 1) {
    throw new InvocationError(
      `the allow-set ${allowSetPath} declares version ${JSON.stringify(parsed.version)}; this ` +
        `check only understands version 1. Refusing to judge a shape it may not understand.`,
    );
  }
  for (const field of ["allow", "require"]) {
    if (!Array.isArray(parsed[field])) {
      throw new InvocationError(
        `the allow-set ${allowSetPath} must carry a \`${field}\` array (it may be empty).`,
      );
    }
  }

  for (const [index, entry] of parsed.allow.entries()) {
    validateAllowEntry(entry, `allow[${index}]`, allowSetPath);
  }
  for (const [index, entry] of parsed.require.entries()) {
    validateRequireEntry(entry, `require[${index}]`, allowSetPath);
  }

  return { allow: parsed.allow, require: parsed.require, path: allowSetPath };
}

/**
 * Validate one `allow` entry.
 *
 * @param {unknown} entry The entry.
 * @param {string} label Where it sits, for diagnostics.
 * @param {string} allowSetPath The allow-set path, for diagnostics.
 * @returns {void}
 */
function validateAllowEntry(entry, label, allowSetPath) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new InvocationError(`${allowSetPath}: ${label} must be an object.`);
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  if (typeof record.key !== "string" || record.key.trim() === "") {
    throw new InvocationError(`${allowSetPath}: ${label} needs a non-empty string \`key\`.`);
  }
  const modes = ["value", "anyValue", "pattern"].filter((mode) => mode in record);
  if (modes.length !== 1) {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) must carry EXACTLY ONE of \`value\`, ` +
        `\`anyValue: true\` or \`pattern\`; it carries ${modes.length === 0 ? "none" : modes.join(", ")}.`,
    );
  }
  if ("anyValue" in record && record.anyValue !== true) {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) sets \`anyValue\` to something other than true. ` +
        `Delete the field rather than disabling it, so the entry cannot read as a permission it ` +
        `does not grant.`,
    );
  }
  if ("pattern" in record) {
    if (typeof record.pattern !== "string") {
      throw new InvocationError(
        `${allowSetPath}: ${label} (${record.key}) \`pattern\` must be a string.`,
      );
    }
    try {
      new RegExp(record.pattern);
    } catch (cause) {
      throw new InvocationError(
        `${allowSetPath}: ${label} (${record.key}) \`pattern\` does not compile: ${String(cause)}`,
      );
    }
  }
  if (typeof record.why !== "string" || record.why.trim() === "") {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) needs a non-empty \`why\`. The allow-set is the ` +
        `reviewable record of what a release may be configured with, and an entry nobody ` +
        `justified is the one a reviewer waves through.`,
    );
  }
  // A LITERAL CREDENTIAL IN THE ALLOW-SET WOULD BE A COMMITTED SECRET. The allow-set is tracked in
  // a PUBLIC repository, so an entry that pins a credential key to an exact value either leaks a
  // live token or pins a dead one. Credentials are permitted by KEY, never by value.
  if (isCredentialKey(record.key) && ("value" in record || "pattern" in record)) {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) names a credential-denoting key and pins its ` +
        `value. This file is committed to a PUBLIC repository. Use \`"anyValue": true\`: the key ` +
        `is what the allow-set may govern, never the secret.`,
    );
  }
}

/**
 * Validate one `require` entry.
 *
 * @param {unknown} entry The entry.
 * @param {string} label Where it sits, for diagnostics.
 * @param {string} allowSetPath The allow-set path, for diagnostics.
 * @returns {void}
 */
function validateRequireEntry(entry, label, allowSetPath) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new InvocationError(`${allowSetPath}: ${label} must be an object.`);
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  if (typeof record.key !== "string" || record.key.trim() === "") {
    throw new InvocationError(`${allowSetPath}: ${label} needs a non-empty string \`key\`.`);
  }
  if (!("value" in record)) {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) needs a \`value\`: a requirement without one ` +
        `states nothing.`,
    );
  }
  if (isCredentialKey(record.key)) {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) requires a credential-denoting key at a stated ` +
        `value. This file is committed to a PUBLIC repository; a credential is never a committed ` +
        `expectation.`,
    );
  }
  if (typeof record.why !== "string" || record.why.trim() === "") {
    throw new InvocationError(
      `${allowSetPath}: ${label} (${record.key}) needs a non-empty \`why\`.`,
    );
  }
}

/**
 * Is this observation permitted by the allow-set.
 *
 * @param {{ key: string, value: unknown }} observation The observed setting.
 * @param {object[]} allow The allow entries.
 * @returns {boolean} True when some entry permits it.
 */
export function isPermitted(observation, allow) {
  const wanted = normalizeKey(observation.key);
  for (const entry of allow) {
    if (normalizeKey(/** @type {string} */ (entry.key)) !== wanted) continue;
    if (entry.anyValue === true) return true;
    if ("pattern" in entry) {
      const text =
        typeof observation.value === "string"
          ? observation.value
          : canonicalValue(observation.value);
      if (new RegExp(/** @type {string} */ (entry.pattern)).test(text)) return true;
      continue;
    }
    if (canonicalValue(entry.value) === canonicalValue(observation.value)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// CONFIGURATION SOURCES
// ---------------------------------------------------------------------------------------------

/**
 * Parse an npmrc file strictly enough that a line the resolver would silently coerce is refused.
 *
 * npm's ini parser NEVER throws: handed the line `this is not ini` it invents the key
 * `this is not ini` with the value `true`, and handed a truncated file it reports the half it could
 * read. Both are "malformed" in every sense that matters to a release, and both must be refused
 * here rather than reported as a source that contributed nothing. So this parser accepts exactly the
 * three line shapes an npmrc is made of (comment, `[section]`, `key=value`) and refuses anything
 * else BY NAME.
 *
 * @param {string} text File contents.
 * @param {string} label The file's path, for diagnostics.
 * @returns {{ key: string, value: string }[]} One entry per declared setting.
 */
export function parseNpmrc(text, label) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line.startsWith("#") || line.startsWith(";")) continue;
    if (/^\[[^\]]*\]$/.test(line)) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new InvocationError(
        `${label} line ${index + 1} is not a configuration setting: ${JSON.stringify(line)}. An ` +
          `npmrc is comments, \`[section]\` headers and \`key=value\` lines. npm's own ini reader ` +
          `does not throw on this, it invents a setting from it, so refusing here is the only way ` +
          `a malformed source stops looking like one that contributed nothing.`,
      );
    }
    entries.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() });
  }
  return entries;
}

/**
 * Read a JSON file, refusing an unreadable or malformed one by name.
 *
 * @param {string} path Absolute path.
 * @param {string} what What this file is, for diagnostics.
 * @returns {unknown} The parsed contents.
 */
function readJsonSource(path, what) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new InvocationError(
      `cannot read ${what} ${path}: ${String(cause)}. A configuration source that exists but ` +
        `cannot be read is a refusal, not a skip.`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new InvocationError(
      `${what} ${path} is malformed JSON: ${String(cause)}. Refusing to treat it as empty or as ` +
        `contributing nothing.`,
    );
  }
}

/**
 * Does this path exist, and is it a regular file.
 *
 * A path that exists but cannot be stat'ed is a refusal rather than an absence: "not there" and
 * "there and unreadable" are different states and only the first is normal.
 *
 * @param {string} path Absolute path.
 * @param {string} what What this file is, for diagnostics.
 * @returns {boolean} True when the file is present.
 */
function sourceExists(path, what) {
  let stats;
  try {
    stats = statSync(path);
  } catch (cause) {
    const code = /** @type {{ code?: string }} */ (cause).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new InvocationError(
      `cannot inspect ${what} ${path}: ${String(cause)}. Refusing: a source this check cannot ` +
        `resolve must not be reported as absent.`,
    );
  }
  if (!stats.isFile()) {
    throw new InvocationError(
      `${what} ${path} exists but is not a regular file. Refusing to report it as absent: ` +
        `"not there" and "there and unreadable" are different states and only the first is normal.`,
    );
  }
  return true;
}

/**
 * Read the package globs `pnpm-workspace.yaml` declares.
 *
 * ZERO-DEPENDENCY, so this is a line reader rather than a YAML parser, and its limits are refused
 * loudly rather than guessed around: a `packages:` list this cannot read is an InvocationError. It
 * never decides a VALUE, only which package directories the publish would cover, and the resolvers
 * remain the only thing that resolves configuration.
 *
 * @param {string} text File contents.
 * @param {string} label The file's path, for diagnostics.
 * @returns {{ globs: string[], topLevelKeys: string[] }} The declared globs and every top-level key.
 */
export function readWorkspaceYaml(text, label) {
  const globs = [];
  const topLevelKeys = [];
  let inPackages = false;
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;
    const topLevel = /^([A-Za-z0-9_-]+):(.*)$/.exec(rawLine);
    if (topLevel !== null) {
      topLevelKeys.push(topLevel[1]);
      inPackages = topLevel[1] === "packages";
      const rest = topLevel[2].replace(/\s+#.*$/, "").trim();
      if (inPackages && rest !== "" && rest !== "[]") {
        throw new InvocationError(
          `${label} declares \`packages\` inline. This check reads only the block-sequence form ` +
            `(\`packages:\` followed by \`  - "glob"\` lines) and refuses to guess at any other, ` +
            `because guessing wrong means publishing packages whose configuration was never read.`,
        );
      }
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(rawLine);
    if (item !== null) {
      if (inPackages) globs.push(item[1].trim().replace(/^["'](.*)["']$/, "$1"));
      continue;
    }
    // An indented `key: value` is a nested setting, which pnpm 10 and later encourage. It is read
    // for its SHAPE only: the value it resolves to comes from pnpm's own resolver, never from here.
    if (/^\s+[^\s#][^:]*:/.test(rawLine)) continue;

    // ANYTHING ELSE IS REFUSED BY NAME rather than skipped. This is a line reader, not a YAML
    // parser (zero-dependency, by the same rule scripts/changeset-guard.mjs follows), and the whole
    // point of the gate is that a source it cannot read must never look like a source that
    // contributed nothing. KNOWN AND ACCEPTED, the same way changeset-guard states its own limit: a
    // block scalar or a flow mapping is valid YAML and takes this branch. The failure is loud, it
    // names the file, and it is in the safe direction.
    throw new InvocationError(
      `${label} line ${JSON.stringify(rawLine)} is a YAML shape this check does not read. It ` +
        `reads comments, top-level \`key:\` lines, indented \`key: value\` lines and indented ` +
        `\`- item\` list entries. Refusing rather than treating a source it cannot read as one ` +
        `that contributed nothing.`,
    );
  }
  return { globs, topLevelKeys };
}

/**
 * Resolve the package directories a workspace glob names.
 *
 * @param {string} workspaceRoot Repository root.
 * @param {string[]} globs The declared globs.
 * @returns {string[]} Absolute directories that carry a `package.json`.
 */
function resolveWorkspacePackages(workspaceRoot, globs) {
  const dirs = new Set();
  for (const glob of globs) {
    if (glob.startsWith("!")) continue;
    const star = glob.indexOf("*");
    if (star === -1) {
      dirs.add(resolve(workspaceRoot, glob));
      continue;
    }
    if (glob.slice(star) !== "*") {
      throw new InvocationError(
        `cannot resolve the workspace glob ${JSON.stringify(glob)}. This check understands a ` +
          `literal directory or a single trailing \`*\`, and refuses to guess at anything else: ` +
          `a glob read wrongly means a package whose publishConfig was never examined.`,
      );
    }
    const parent = resolve(workspaceRoot, glob.slice(0, star) || ".");
    let entries;
    try {
      entries = readdirSync(parent);
    } catch (cause) {
      throw new InvocationError(`cannot read the workspace directory ${parent}: ${String(cause)}`);
    }
    for (const entry of entries.sort()) {
      const dir = join(parent, entry);
      if (sourceExists(join(dir, "package.json"), "a workspace manifest")) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

// ---------------------------------------------------------------------------------------------
// RESOLVERS
// ---------------------------------------------------------------------------------------------

/**
 * Run a package manager's own config resolver and hand back its stdout.
 *
 * Every failure is an InvocationError naming the resolver: a resolver that could not be run leaves
 * this check unable to say what the publish would use, and that is a refusal rather than a pass over
 * whatever it did manage to read.
 *
 * @param {{ bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, label: string }} options Invocation.
 * @returns {string} The resolver's stdout.
 */
function runResolver({ bin, args, cwd, env, label }) {
  try {
    return execFileSync(bin, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: RESOLVER_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (cause) {
    const err = /** @type {{ status?: number, stderr?: string, message?: string }} */ (cause);
    const detail = redactText(String(err.stderr ?? err.message ?? cause)).trim();
    throw new InvocationError(
      `could not resolve ${label} by running \`${bin} ${args.join(" ")}\`: ${detail || "no output"}. ` +
        `Refusing to report a pass over the sources it did resolve.`,
    );
  }
}

/**
 * Parse a resolver's JSON stdout.
 *
 * @param {string} stdout The resolver's output.
 * @param {string} label What was being resolved, for diagnostics.
 * @returns {Record<string, unknown>} The parsed map.
 */
function parseResolverJson(stdout, label) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new InvocationError(
      `${label} answered with output this check cannot parse as JSON: ${String(cause)}. Refusing: ` +
        `an unreadable answer about the effective configuration is not a pass.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvocationError(`${label} answered with JSON that is not an object.`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Parse `npm config ls`, which is npm's own report of every setting contributed by a source other
 * than its built-in defaults, grouped by source.
 *
 * The shape, verified against npm 10 and npm 11:
 *
 *     ; "user" config from /home/runner/work/_temp/.npmrc
 *
 *     registry = "https://registry.npmjs.org/"
 *
 *     ; "project" config from /repo/.npmrc
 *
 *     ; provenance = true ; overridden by env
 *
 * A commented `; key = value ; overridden by <source>` line is a value that LOST. It is recorded as
 * shadowed and is never judged as the effective value, which is what keeps a run from passing on the
 * strength of a value the publish command would not use.
 *
 * @param {string} text `npm config ls` stdout.
 * @returns {{ effective: object[], shadowed: object[], sources: string[] }} What npm reported.
 */
export function parseNpmConfigList(text) {
  const effective = [];
  const shadowed = [];
  const sources = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    const header = /^;\s*"([^"]+)"\s+config\s+from\s+(.+)$/.exec(line);
    if (header !== null) {
      current = `${header[1]} config from ${header[2]}`;
      sources.push(current);
      continue;
    }

    const overridden = /^;\s*(.+?)\s*=\s*(.*?)\s*;\s*overridden by\s+(\S+)\s*$/.exec(line);
    if (overridden !== null) {
      shadowed.push({
        key: overridden[1],
        value: decodeNpmValue(overridden[2]),
        source: current ?? "unknown",
        overriddenBy: overridden[3],
      });
      continue;
    }

    // Every other `;` line is npm's trailing environment banner ("; node version = ...").
    if (line.startsWith(";")) continue;

    const setting = /^(.+?)\s*=\s*(.*)$/.exec(line);
    if (setting === null) continue;
    if (current === null) {
      throw new InvocationError(
        `npm reported the setting ${JSON.stringify(line)} before naming any configuration ` +
          `source. This check will not attribute a value it cannot place.`,
      );
    }
    effective.push({ key: setting[1], value: decodeNpmValue(setting[2]), source: current });
  }
  return { effective, shadowed, sources };
}

/**
 * Decode the value half of an `npm config ls` line.
 *
 * npm prints JSON for everything it can and the literal `(protected)` for a credential. Anything
 * that does not parse is kept as the raw token rather than coerced, because a value this check
 * cannot decode must still be judged against the allow-set.
 *
 * @param {string} raw The text after the `=`.
 * @returns {unknown} The decoded value.
 */
function decodeNpmValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Measure the package manager's own built-in defaults, with the same binary, in a throwaway context
 * that carries no configuration source at all.
 *
 * See the header for why this is measured rather than tabulated. The sandbox mirrors the root
 * manifest's `packageManager` field so that pnpm's own version switching answers the baseline with
 * the SAME pnpm the effective run used.
 *
 * @param {{ pnpmBin: string, packageManager: string | undefined }} options What to mirror.
 * @returns {Record<string, unknown>} pnpm's defaults.
 */
function measurePnpmDefaults({ pnpmBin, packageManager }) {
  const sandbox = mkdtempSync(join(tmpdir(), "npm-config-allow-baseline-"));
  try {
    const home = join(sandbox, "home");
    mkdirSync(home, { recursive: true });
    const emptyRc = join(sandbox, "empty-npmrc");
    writeFileSync(emptyRc, "", "utf8");
    const manifest = { name: "npm-config-allow-baseline", version: "0.0.0", private: true };
    if (packageManager !== undefined) manifest.packageManager = packageManager;
    writeFileSync(join(sandbox, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    // BUILT FROM NOTHING RATHER THAN FILTERED FROM process.env. A deny-list of variable names is a
    // guess about what the next package-manager release will read; an allow-list of four is not.
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(sandbox, "xdg-config"),
      XDG_DATA_HOME: join(sandbox, "xdg-data"),
      NPM_CONFIG_USERCONFIG: emptyRc,
      NPM_CONFIG_GLOBALCONFIG: emptyRc,
    };
    const stdout = runResolver({
      bin: pnpmBin,
      args: ["config", "list", "--json"],
      cwd: sandbox,
      env,
      label: "pnpm's built-in defaults",
    });
    return parseResolverJson(stdout, "pnpm's built-in defaults");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// THE CHECK
// ---------------------------------------------------------------------------------------------

/**
 * Establish the effective configuration of the publish context and judge it against the allow-set.
 *
 * @param {{ workspaceRoot: string, allowSet: object, npmBin: string, pnpmBin: string, env: NodeJS.ProcessEnv }} options Inputs.
 * @returns {{ ok: boolean, observations: object[], shadowed: object[], violations: string[], sources: object[], report: string[] }} The verdict.
 */
export function check({ workspaceRoot, allowSet, npmBin, pnpmBin, env }) {
  // 1. ASK npm, IN THE PUBLISH CONTEXT. `npm config ls` is npm's own answer to "which settings did
  //    a source other than my built-in defaults contribute, and which source won".
  const npmListText = runResolver({
    bin: npmBin,
    args: ["config", "ls"],
    cwd: workspaceRoot,
    env,
    label: "npm's effective configuration",
  });
  const npmList = parseNpmConfigList(npmListText);
  const npmFull = parseResolverJson(
    runResolver({
      bin: npmBin,
      args: ["config", "ls", "--json"],
      cwd: workspaceRoot,
      env,
      label: "npm's full effective configuration",
    }),
    "npm's full effective configuration",
  );

  // 2. WHERE npm SAYS ITS OWN FILES LIVE. Asked rather than assumed: `NPM_CONFIG_USERCONFIG` moves
  //    the user config, and on a GitHub runner `actions/setup-node` does exactly that.
  for (const key of ["userconfig", "globalconfig"]) {
    if (typeof npmFull[key] !== "string" || npmFull[key] === "") {
      throw new InvocationError(
        `npm did not say where its ${key} lives, so this check cannot tell whether that source ` +
          `contributed anything. Refusing rather than reporting a pass over the sources it did ` +
          `resolve.`,
      );
    }
  }

  // 3. ENUMERATE AND PROBE EVERY FILE SOURCE. Absent is normal (this repository has no `.npmrc` and
  //    that must never be an error). Present-but-unreadable and present-but-malformed are refusals.
  const sources = [];
  const fileObservations = [];

  /**
   * Probe one npmrc-shaped source.
   *
   * @param {string} path Absolute path.
   * @param {string} what What it is, for diagnostics.
   * @returns {{ key: string, value: string }[]} What the file declares.
   */
  const probeNpmrc = (path, what) => {
    if (!sourceExists(path, what)) {
      sources.push({ what, path, state: "absent" });
      return [];
    }
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (cause) {
      throw new InvocationError(
        `cannot read ${what} ${path}: ${String(cause)}. A configuration source that exists but ` +
          `cannot be read is a refusal, not a skip: this check cannot say what the publish would ` +
          `use if it never saw one of the files the publish reads.`,
      );
    }
    const entries = parseNpmrc(raw, `${what} ${path}`);
    sources.push({ what, path, state: "read", declares: entries.map((e) => e.key) });
    return entries;
  };

  const npmUserConfig = /** @type {string} */ (npmFull.userconfig);
  const npmGlobalConfig = /** @type {string} */ (npmFull.globalconfig);
  probeNpmrc(npmGlobalConfig, "the npm global config");
  probeNpmrc(npmUserConfig, "the npm user config");
  probeNpmrc(join(workspaceRoot, ".npmrc"), "the repository .npmrc");

  // pnpm keeps a global rc of its own, and `pnpm config set` writes to it. Its location is derived
  // rather than asked for, so it is probed only when the environment actually says where HOME is: a
  // relative path assembled out of an empty string would probe the working directory instead.
  const pnpmConfigHome =
    env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME !== ""
      ? env.XDG_CONFIG_HOME
      : env.HOME !== undefined && env.HOME !== ""
        ? join(env.HOME, ".config")
        : null;
  if (pnpmConfigHome !== null) {
    probeNpmrc(join(pnpmConfigHome, "pnpm", "rc"), "the pnpm global config");
  }

  // 4. THE WORKSPACE LAYER, WHICH npm DOES NOT READ AND pnpm DOES.
  const rootManifestPath = join(workspaceRoot, "package.json");
  let rootManifest = {};
  if (sourceExists(rootManifestPath, "the root manifest")) {
    rootManifest = /** @type {Record<string, unknown>} */ (
      readJsonSource(rootManifestPath, "the root manifest")
    );
    sources.push({ what: "the root manifest", path: rootManifestPath, state: "read" });
    const pnpmField = rootManifest.pnpm;
    if (pnpmField !== undefined) {
      if (pnpmField === null || typeof pnpmField !== "object" || Array.isArray(pnpmField)) {
        throw new InvocationError(
          `${rootManifestPath} carries a \`pnpm\` field that is not an object. Refusing to treat ` +
            `a malformed package-manager settings block as contributing nothing.`,
        );
      }
      for (const [key, value] of Object.entries(pnpmField)) {
        fileObservations.push({
          key: `pnpm-field:${key}`,
          value,
          source: `the root manifest's \`pnpm\` block (${rootManifestPath})`,
          resolver: "file",
        });
      }
    }
  } else {
    sources.push({ what: "the root manifest", path: rootManifestPath, state: "absent" });
  }

  const workspaceYamlPath = join(workspaceRoot, "pnpm-workspace.yaml");
  let workspaceGlobs = [];
  let workspaceTopLevelKeys = [];
  if (sourceExists(workspaceYamlPath, "the pnpm workspace file")) {
    let raw;
    try {
      raw = readFileSync(workspaceYamlPath, "utf8");
    } catch (cause) {
      throw new InvocationError(
        `cannot read the pnpm workspace file ${workspaceYamlPath}: ${String(cause)}. A source ` +
          `that exists but cannot be read is a refusal, not a skip.`,
      );
    }
    const parsed = readWorkspaceYaml(raw, workspaceYamlPath);
    workspaceGlobs = parsed.globs;
    workspaceTopLevelKeys = parsed.topLevelKeys;
    sources.push({
      what: "the pnpm workspace file",
      path: workspaceYamlPath,
      state: "read",
      declares: workspaceTopLevelKeys,
    });
    if (workspaceTopLevelKeys.includes("packages") && workspaceGlobs.length === 0) {
      throw new InvocationError(
        `${workspaceYamlPath} declares \`packages\` but this check resolved no globs from it. ` +
          `Refusing to report green having examined no package's publish configuration.`,
      );
    }
  } else {
    sources.push({ what: "the pnpm workspace file", path: workspaceYamlPath, state: "absent" });
  }

  // 5. PER-PACKAGE SOURCES. `pnpm publish` runs with the PACKAGE directory as its working directory,
  //    so a `.npmrc` there is a project config for that publish, and `publishConfig` is applied by
  //    the publish itself. Both are configuration of the publish step and both are observed.
  const packageDirs = resolveWorkspacePackages(workspaceRoot, workspaceGlobs);
  if (workspaceGlobs.length > 0 && packageDirs.length === 0) {
    throw new InvocationError(
      `${workspaceYamlPath} declares package globs that resolve to no package directory. ` +
        `Refusing to report green having examined no package's publish configuration.`,
    );
  }
  for (const dir of packageDirs) {
    // OBSERVED FROM THE FILE, not from a resolver, and the difference is worth stating. Both
    // resolvers are asked at the REPOSITORY ROOT, which is where the effective configuration of the
    // release command is decided, and neither of them reads a per-package `.npmrc` from there. But
    // `pnpm publish` runs with the package directory as its working directory, so that file IS a
    // configuration source of the publish. Judging what it DECLARES is stricter than judging what it
    // would resolve to (a value a higher-precedence source would shadow still has to be permitted),
    // and strictness is the safe direction for a permanent action.
    const packageRcPath = join(dir, ".npmrc");
    for (const entry of probeNpmrc(packageRcPath, `the ${basename(dir)} package .npmrc`)) {
      fileObservations.push({
        key: `packageNpmrc:${entry.key}`,
        value: entry.value,
        source: `the ${basename(dir)} package .npmrc (${packageRcPath})`,
        resolver: "file",
      });
    }
    const manifestPath = join(dir, "package.json");
    const manifest = /** @type {Record<string, unknown>} */ (
      readJsonSource(manifestPath, "a workspace manifest")
    );
    sources.push({ what: `the ${basename(dir)} manifest`, path: manifestPath, state: "read" });
    if (manifest.private === true) continue;
    const publishConfig = manifest.publishConfig;
    if (publishConfig === undefined) continue;
    if (
      publishConfig === null ||
      typeof publishConfig !== "object" ||
      Array.isArray(publishConfig)
    ) {
      throw new InvocationError(
        `${manifestPath} carries a \`publishConfig\` that is not an object. Refusing to treat a ` +
          `malformed publish configuration as contributing nothing.`,
      );
    }
    for (const [key, value] of Object.entries(publishConfig)) {
      fileObservations.push({
        key: `publishConfig:${key}`,
        value,
        source: `${manifest.name ?? basename(dir)}'s publishConfig (${manifestPath})`,
        resolver: "file",
      });
    }
  }

  // 6. THE PUBLISH COMMAND'S OWN CONFIGURATION. `changeset publish` reads `.changeset/config.json`,
  //    and its `access` decides whether a scoped package goes out public or restricted.
  const changesetConfigPath = join(workspaceRoot, ".changeset", "config.json");
  if (sourceExists(changesetConfigPath, "the changesets config")) {
    const changesetConfig = /** @type {Record<string, unknown>} */ (
      readJsonSource(changesetConfigPath, "the changesets config")
    );
    sources.push({
      what: "the changesets config",
      path: changesetConfigPath,
      state: "read",
      declares: Object.keys(changesetConfig),
    });
    for (const [key, value] of Object.entries(changesetConfig)) {
      if (key.startsWith("$")) continue;
      fileObservations.push({
        key: `changesets:${key}`,
        value,
        source: `the changesets config (${changesetConfigPath})`,
        resolver: "file",
      });
    }
  } else {
    sources.push({ what: "the changesets config", path: changesetConfigPath, state: "absent" });
  }

  // 7. ASK pnpm, IN THE PUBLISH CONTEXT, AND MEASURE ITS DEFAULTS WITH THE SAME BINARY.
  //    `changeset publish` spawns `pnpm publish`, so pnpm's view is the one that ships.
  const pnpmEffective = parseResolverJson(
    runResolver({
      bin: pnpmBin,
      args: ["config", "list", "--json"],
      cwd: workspaceRoot,
      env,
      label: "pnpm's effective configuration",
    }),
    "pnpm's effective configuration",
  );
  const pnpmDefaults = measurePnpmDefaults({
    pnpmBin,
    packageManager:
      typeof rootManifest.packageManager === "string" ? rootManifest.packageManager : undefined,
  });

  // 8. OBSERVATIONS. npm's report is authoritative about npm keys and about which source won; the
  //    pnpm diff catches everything pnpm reads that npm does not.
  const observations = [];
  for (const entry of npmList.effective) {
    observations.push({
      key: entry.key,
      value: entry.value,
      source: entry.source,
      resolver: "npm",
    });
  }
  // DEDUPED ON KEY *AND* VALUE, never on key alone. pnpm reads sources npm does not, and in pnpm 10
  // and later `pnpm-workspace.yaml` OUTRANKS an `.npmrc`, so the two resolvers can legitimately
  // disagree about the same key. Dropping pnpm's answer because npm already named the key would
  // discard exactly the value the publish command is going to use.
  const npmReported = new Set(
    npmList.effective.map((entry) => `${normalizeKey(entry.key)}=${canonicalValue(entry.value)}`),
  );
  for (const [key, value] of Object.entries(pnpmEffective)) {
    if (canonicalValue(value) === canonicalValue(pnpmDefaults[key])) continue;
    if (npmReported.has(`${normalizeKey(key)}=${canonicalValue(value)}`)) continue;
    observations.push({
      key,
      value,
      source: attributePnpmKey(key, sources, env, workspaceTopLevelKeys, workspaceYamlPath),
      resolver: "pnpm",
    });
  }
  observations.push(...fileObservations);
  observations.sort((a, b) => `${a.key} ${a.source}`.localeCompare(`${b.key} ${b.source}`));

  // 9. JUDGE.
  const violations = [];
  for (const observation of observations) {
    if (isPermitted(observation, allowSet.allow)) continue;
    violations.push(
      `${formatSetting(observation.key, observation.value)} was contributed by ${observation.source}` +
        ` and is NOT permitted by the allow-set.`,
    );
  }
  for (const requirement of allowSet.require) {
    const observed = lookupEffective(requirement.key, npmFull, pnpmEffective, fileObservations);
    const wanted = canonicalValue(requirement.value);
    // EVERY resolver that knows the key must agree with the requirement. If npm and pnpm disagree
    // the publish uses one of them and this check must not pick the convenient one.
    for (const answer of observed) {
      if (canonicalValue(answer.value) === wanted) continue;
      violations.push(
        `${requirement.key} is required at ${wanted} but the publish would use ` +
          `${answer.value === UNSET ? UNSET : redactText(canonicalValue(answer.value))} ` +
          `(${answer.resolver}).`,
      );
    }
  }

  const report = buildReport({ observations, shadowed: npmList.shadowed, violations, allowSet });
  return {
    ok: violations.length === 0,
    observations,
    shadowed: npmList.shadowed,
    violations,
    sources,
    report,
  };
}

/**
 * Name the source that supplied a key pnpm reports and npm does not.
 *
 * ATTRIBUTION ONLY. It never decides a value: the value has already come from pnpm's own resolver,
 * so a source this cannot name changes the diagnostic and never the verdict. The key is still judged
 * against the allow-set, which is what keeps an unattributable deviation from passing.
 *
 * @param {string} key The key pnpm reported.
 * @param {object[]} sources The probed sources.
 * @param {NodeJS.ProcessEnv} env The publish context's environment.
 * @param {string[]} workspaceTopLevelKeys Top-level keys of `pnpm-workspace.yaml`.
 * @param {string} workspaceYamlPath Path to `pnpm-workspace.yaml`.
 * @returns {string} A description of where it came from.
 */
function attributePnpmKey(key, sources, env, workspaceTopLevelKeys, workspaceYamlPath) {
  const wanted = normalizeKey(key);
  const found = [];
  for (const name of Object.keys(env)) {
    if (!/^npm_config_/i.test(name)) continue;
    if (normalizeKey(name.slice("npm_config_".length).replace(/_/g, "-")) === wanted) {
      found.push("the process environment");
      break;
    }
  }
  if (workspaceTopLevelKeys.some((candidate) => normalizeKey(candidate) === wanted)) {
    found.push(`the pnpm workspace file (${workspaceYamlPath})`);
  }
  for (const source of sources) {
    if (source.state !== "read" || source.declares === undefined) continue;
    if (source.declares.some((candidate) => normalizeKey(candidate) === wanted)) {
      found.push(`${source.what} (${source.path})`);
    }
  }
  if (found.length === 0) return "a source this check could not name (reported by pnpm)";
  return [...new Set(found)].join(" and ");
}

/**
 * Every answer the resolvers give for a key, for the allow-set's `require` rules.
 *
 * Consults the resolvers' FULL maps, defaults included, so that a requirement catches a key no
 * source contributes at all rather than passing it by default. Returns one entry per resolver that
 * knows the key, and a single `(unset)` entry when none does, so that "nothing supplies this" is a
 * finding rather than a silent skip.
 *
 * @param {string} key The required key.
 * @param {Record<string, unknown>} npmFull npm's full effective map.
 * @param {Record<string, unknown>} pnpmEffective pnpm's effective map.
 * @param {object[]} fileObservations Values read directly out of manifests.
 * @returns {{ value: unknown, resolver: string }[]} What each resolver answers.
 */
function lookupEffective(key, npmFull, pnpmEffective, fileObservations) {
  const wanted = normalizeKey(key);
  const answers = [];
  for (const [resolver, map] of [
    ["npm", npmFull],
    ["pnpm", pnpmEffective],
  ]) {
    for (const [candidate, value] of Object.entries(map)) {
      if (normalizeKey(candidate) === wanted) answers.push({ value, resolver });
    }
  }
  for (const observation of fileObservations) {
    if (normalizeKey(observation.key) === wanted) {
      answers.push({ value: observation.value, resolver: "a manifest" });
    }
  }
  if (answers.length === 0) return [{ value: UNSET, resolver: "no source and no default" }];
  return answers;
}

/**
 * Build the lines this check prints. Every line is redacted.
 *
 * @param {{ observations: object[], shadowed: object[], violations: string[], allowSet: object }} input What to report.
 * @returns {string[]} The lines.
 */
function buildReport({ observations, shadowed, violations, allowSet }) {
  const lines = [];
  if (violations.length === 0) {
    lines.push(
      `npm-config-allow: OK (${observations.length} setting(s) contributed by a source other than ` +
        `the package manager's built-in defaults, every one permitted by ${basename(allowSet.path)}; ` +
        `${allowSet.require.length} required key(s) hold)`,
    );
    for (const observation of observations) {
      lines.push(
        `  ${formatSetting(observation.key, observation.value)}  <- ${observation.source}`,
      );
    }
    for (const entry of shadowed) {
      lines.push(
        `  (shadowed, not judged) ${formatSetting(entry.key, entry.value)} from ${entry.source}, ` +
          `overridden by ${entry.overriddenBy}`,
      );
    }
    return lines.map(redactText);
  }

  for (const violation of violations) lines.push(`ERROR: npm-config-allow: ${violation}`);
  lines.push(
    "",
    `Refusing the release: ${violations.length} configuration finding(s). An npm publish is`,
    "permanent and cannot be withdrawn, so a value nobody approved does not get to ship.",
    "",
    "Every setting this check observed, with the source that supplied it:",
  );
  for (const observation of observations) {
    lines.push(`  ${formatSetting(observation.key, observation.value)}  <- ${observation.source}`);
  }
  for (const entry of shadowed) {
    lines.push(
      `  (shadowed, not judged) ${formatSetting(entry.key, entry.value)} from ${entry.source}, ` +
        `overridden by ${entry.overriddenBy}`,
    );
  }
  lines.push(
    "",
    `TERMINAL ACTION: either change the source that supplied the value, or add the entry to`,
    `${basename(allowSet.path)} in a reviewed pull request. RELEASING.md has both routes.`,
  );
  return lines.map(redactText);
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/**
 * CLI entry point.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} Process exit code.
 */
export function main(argv) {
  let workspaceRoot = process.cwd();
  let allowSetPath = null;
  let npmBin = "npm";
  let pnpmBin = "pnpm";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    /**
     * Take the value that follows a flag.
     *
     * @returns {string} The value.
     */
    const value = () => {
      i += 1;
      const next = argv[i];
      if (next === undefined) throw new InvocationError(`${arg} needs a value`);
      return next;
    };
    if (arg === "--workspace") workspaceRoot = value();
    else if (arg === "--allow-set") allowSetPath = value();
    else if (arg === "--npm-bin") npmBin = value();
    else if (arg === "--pnpm-bin") pnpmBin = value();
    else throw new InvocationError(`unknown argument ${JSON.stringify(arg)}`);
  }

  workspaceRoot = resolve(workspaceRoot);
  // THE ALLOW-SET IS LOADED FIRST, on purpose. An absent or unparseable allow-set is a refusal
  // whatever the configuration turns out to be, and deciding it before anything expensive runs
  // means the answer cannot depend on how far the rest of the check got.
  const allowSet = loadAllowSet(resolve(allowSetPath ?? join(workspaceRoot, ALLOW_SET_FILENAME)));

  const result = check({ workspaceRoot, allowSet, npmBin, pnpmBin, env: process.env });
  const stream = result.ok ? process.stdout : process.stderr;
  for (const line of result.report) stream.write(`${line}\n`);
  return result.ok ? 0 : 1;
}

// `isCliEntrypoint` is what keeps importing this file for tests from executing the CLI; see the note
// in scripts/changeset-guard.mjs for the three ordinary invocations the naive string comparison got
// wrong. The catch-all is what keeps exit 2 meaning "could not run": left to node's default an
// uncaught throw exits 1, which is the code this contract reserves for "a value was refused", and a
// broken gate must never be indistinguishable from a caught violation. It is also what satisfies
// "if the check cannot run to completion, fail the release run": there is no path out of here that
// exits 0 without a verdict.
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR: npm-config-allow could not run: ${redactText(message)}\n`);
    if (!(error instanceof InvocationError)) {
      process.stderr.write(
        `This is an unexpected failure of the check itself, not a configuration finding. The ` +
          `release is refused anyway: an unexamined configuration must never reach a publish.\n`,
      );
      process.stderr.write(`${redactText(String(error instanceof Error ? error.stack : ""))}\n`);
    }
    process.exit(2);
  }
}

export { InvocationError };
