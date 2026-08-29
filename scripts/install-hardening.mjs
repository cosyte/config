#!/usr/bin/env node
// scripts/install-hardening.mjs
//
// CONFIRM THAT THIS REPOSITORY'S INSTALL HARDENING IS IN FORCE, NOT MERELY WRITTEN DOWN.
//
// Run from the umbrella root (or anywhere):
//   pnpm --dir config run install-hardening
//   node config/scripts/install-hardening.mjs
//
// WHAT IT DEFENDS. `minimumReleaseAge` and `trustPolicy` are the only two things standing between a
// compromised release and a developer's machine during the window between its publication and its
// removal from the registry. pnpm 10.34.5 ships both switched OFF (the cooldown defaults to 0 before
// v11, the trust policy to `off`), so both are in force here only because pnpm-workspace.yaml says
// so, and a file saying so is not the same as a tool doing so.
//
// WHY A SEPARATE GATE EXISTS AT ALL, AND WHY IT FAILS CLOSED. pnpm v11 ships two fail-safes that
// would settle this inside the package manager - `minimumReleaseAgeStrict` and
// `minimumReleaseAgeIgnoreMissingTime` - and NEITHER EXISTS AT 10.34.5, the version this repository
// pins and must not substitute. What 10.34.5 actually does in the two states those knobs govern was
// therefore measured rather than assumed, against a throwaway registry (test/support/
// fixture-registry.mjs), and BOTH already fail closed at this version:
//
//   * no version in the requested range satisfies the cooldown  -> ERR_PNPM_NO_MATURE_MATCHING_VERSION
//   * the packument carries no `time` field at all              -> ERR_PNPM_MISSING_TIME
//
// So this gate is not compensating for a silent install. It closes the OTHER four ways the settings
// stop being in force, none of which pnpm can report because in each of them pnpm is never asked:
// the settings file is gone, it is unparseable, an environment variable or CLI flag outranks it, or
// the pnpm on the path predates the setting and ignores the key entirely.
//
// IT NEVER TRANSCRIBES THE REQUIREMENT. The floor (1440 minutes) and the policy (`no-downgrade`) are
// read out of drift-manifest.json, the file that IS the standard, so this repository is graded
// against the same values it grades thirteen others against and the two cannot drift apart. The pnpm
// versions each setting was added in are read from the same file.
//
// EVERY EXEMPTION NEEDS A REASON. An entry in `minimumReleaseAgeExclude` or `trustPolicyExclude`, or
// a blanket `trustPolicyIgnoreAfter`, is a hole in the control; a hole nobody wrote a reason for is
// indistinguishable from an accident. The reason is a `# reason:` comment on the lines directly
// above the entry, which is where YAML lets prose sit beside a list item, and an entry without one
// fails this gate BY NAME.
//
// Exit codes, a contract asserted by test/install-hardening.test.ts:
//   0  every required setting was confirmed in force, and every exemption carries a reason
//   1  a setting could not be confirmed in force, or an exemption has no recorded reason. The
//      message names what could not be confirmed. THIS IS NEVER A PASS.
//   2  the gate could not run at all (the manifest is missing or unparseable, so there is no
//      requirement to grade against). Also never a pass, and it says which of the two it is.
//
// Zero dependencies beyond node:*, because it runs BEFORE `pnpm install` in CI's required `verify`
// job: a gate that needs the install it is guarding cannot guard it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configRoot = resolve(scriptDir, "..");

export const DEFAULT_MANIFEST = join(configRoot, "drift-manifest.json");
export const DEFAULT_SETTINGS = join(configRoot, "pnpm-workspace.yaml");

/** Thrown when the GATE cannot run, as opposed to when the SUBJECT fails: exit 2, never exit 1. */
export class GateError extends Error {}

/** Thrown when a settings file cannot be understood. Carries the line so a human can find it. */
export class YamlError extends Error {}

// ---------------------------------------------------------------------------
// The YAML subset
// ---------------------------------------------------------------------------

/**
 * Parse the subset of YAML a `pnpm-workspace.yaml` is written in, and REFUSE the rest.
 *
 * WHY HAND-ROLLED. Same reason `scripts/validate-drift-manifest.mjs` implements its own JSON Schema
 * subset: this runs before `pnpm install`, so there is no `node_modules` for a YAML library to
 * resolve through, and the file it reads is the one that decides whether the install is defended.
 *
 * WHY IT THROWS RATHER THAN GUESSES. A parser that skipped what it did not understand would answer
 * "no cooldown configured" for a file that configures one in a shape it cannot read, and the caller
 * would report a confident failure about the wrong thing - or worse, a shape that HID a weakened
 * value would read as absent and be reported as such. Every construct below is either understood
 * exactly or refused by name: block mappings, block sequences, flow sequences of scalars, comments,
 * quoted and bare scalars. Anchors, aliases, multi-line scalars, flow mappings and multi-document
 * streams are refused.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseYamlSubset(text) {
  const lines = text.split("\n");
  const root = {};
  /** @type {{ indent: number, container: any, key: string | null }[]} */
  const stack = [{ indent: -1, container: root, key: null }];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const withoutComment = stripComment(raw);
    if (withoutComment.trim() === "") continue;
    const where = `line ${i + 1}: ${JSON.stringify(raw.trim())}`;

    // The refusals below are read off the line with QUOTED SPANS BLANKED OUT, because
    // `- "packages/*"` is an ordinary sequence entry and `*` is only an alias when it opens a
    // token. Measured: the first draft of this parser refused this repository's own settings file.
    const unquoted = withoutQuoted(withoutComment);
    if (/^---|^\.\.\./.test(unquoted.trim())) {
      throw new YamlError(`multi-document YAML is not supported here (${where})`);
    }
    if (/(^|[\s:[,-])[*&][A-Za-z0-9_]/.test(unquoted) || /<<\s*:/.test(unquoted)) {
      throw new YamlError(`YAML anchors, aliases and merge keys are not supported here (${where})`);
    }
    if (/:\s*\{/.test(unquoted)) {
      throw new YamlError(`flow mappings are not supported here (${where})`);
    }
    if (/[|>][-+0-9]*\s*$/.test(unquoted)) {
      throw new YamlError(`multi-line block scalars are not supported here (${where})`);
    }

    const indent = withoutComment.length - withoutComment.trimStart().length;
    const body = withoutComment.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];

    if (body.startsWith("- ") || body === "-") {
      if (!Array.isArray(top.container)) {
        throw new YamlError(`a sequence entry appears where no sequence was opened (${where})`);
      }
      top.container.push(parseScalar(body === "-" ? "" : body.slice(2).trim(), where));
      continue;
    }

    const colon = findKeyColon(body);
    if (colon === -1) throw new YamlError(`neither a key nor a sequence entry (${where})`);
    const key = parseScalar(body.slice(0, colon).trim(), where);
    const rest = body.slice(colon + 1).trim();
    if (Array.isArray(top.container)) {
      throw new YamlError(`a mapping key appears inside a sequence (${where})`);
    }

    if (rest === "") {
      // A block follows: a sequence if the next content line is a `-`, otherwise a mapping.
      const next = nextContentLine(lines, i + 1);
      const child = next !== null && next.body.startsWith("-") ? [] : {};
      top.container[key] = child;
      stack.push({ indent, container: child, key });
      continue;
    }
    if (rest.startsWith("[")) {
      top.container[key] = parseFlowSequence(rest, where);
      continue;
    }
    top.container[key] = parseScalar(rest, where);
  }
  return root;
}

/** Drop a trailing `# comment`, respecting quotes. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** The line with every quoted span replaced by spaces, so structural checks ignore string content. */
function withoutQuoted(line) {
  let out = "";
  let quote = null;
  for (const ch of line) {
    if (quote !== null) {
      out += ch === quote ? ((quote = null), " ") : " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/** The index of the `:` that ends a mapping key, or -1. Quoted keys may contain one. */
function findKeyColon(body) {
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ":" && (i + 1 === body.length || /\s/.test(body[i + 1]))) return i;
  }
  return -1;
}

function nextContentLine(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    const body = stripComment(lines[i]).trim();
    if (body !== "") return { body, indent: lines[i].length - lines[i].trimStart().length };
  }
  return null;
}

function parseFlowSequence(text, where) {
  const close = text.lastIndexOf("]");
  if (close === -1) throw new YamlError(`unterminated flow sequence (${where})`);
  const inner = text.slice(1, close).trim();
  if (inner === "") return [];
  return inner.split(",").map((part) => parseScalar(part.trim(), where));
}

function parseScalar(text, where) {
  if (text === "") return null;
  if (/^"(.*)"$/s.test(text) || /^'(.*)'$/s.test(text)) return text.slice(1, -1);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  if (/[[\]{}]/.test(text)) throw new YamlError(`unsupported flow collection (${where})`);
  return text;
}

/**
 * Pair every entry of a sequence with the `# reason:` comment lines directly above it.
 *
 * READ OFF THE RAW TEXT, not off the parsed tree, because a YAML comment is not a value and there is
 * nowhere else in a `pnpm-workspace.yaml` for the reason to live: the alternative is a key pnpm does
 * not know, and this file must stay a file pnpm reads rather than a file about pnpm.
 *
 * @param {string} text The whole settings file.
 * @param {string} key The sequence key, e.g. `trustPolicyExclude`.
 * @returns {{ entry: string, reason: string | null }[]}
 */
export function exemptionReasons(text, key) {
  const lines = text.split("\n");
  const out = [];
  let inBlock = false;
  let pending = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!inBlock) {
      if (new RegExp(`^${key}\\s*:\\s*$`).test(trimmed)) {
        inBlock = true;
        pending = [];
      }
      continue;
    }
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) {
      pending.push(trimmed.replace(/^#\s*/, ""));
      continue;
    }
    if (trimmed.startsWith("- ")) {
      const entry = parseScalar(trimmed.slice(2).trim(), `entry of ${key}`);
      const reason = pending.filter((line) => /^reason:/i.test(line)).join(" ") || null;
      out.push({ entry: String(entry), reason: reason === null ? null : reason.trim() });
      pending = [];
      continue;
    }
    // Anything else at this point has left the block.
    inBlock = false;
  }
  return out;
}

/**
 * Is there a `# reason:` comment on the comment lines directly above `key:`?
 *
 * For an exemption that is a SCALAR rather than a list entry, which is where `exemptionReasons`
 * cannot help: the reason sits above the key itself.
 */
export function reasonAboveKey(text, key) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`^\\s*${key}\\s*:`).test(lines[i])) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      const above = lines[j].trim();
      if (above === "") continue;
      if (!above.startsWith("#")) break;
      if (/^#\s*reason:/i.test(above)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The requirement, read from the standard
// ---------------------------------------------------------------------------

/**
 * The install-hardening requirement, taken out of drift-manifest.json.
 *
 * IT IS AN ERROR FOR TWO BASELINES TO DECLARE DIFFERENT VALUES, and an error for none to declare it
 * at all. Either way there is no single number this repository owes, and inventing one here is
 * exactly the transcription the manifest's own `standing` forbids.
 *
 * @returns {{ settingsFile: string, minimumReleaseAgeMinutes: number, trustPolicy: string,
 *   supportedFrom: Record<string, string> }}
 */
export function requiredHardening(manifest) {
  const found = [];
  for (const baseline of Object.values(manifest.baselines ?? {})) {
    for (const group of Object.values(baseline.groups ?? {})) {
      const requirement = group.requirements?.pnpmInstallHardening;
      if (requirement !== undefined) found.push(requirement);
    }
  }
  if (found.length === 0) {
    throw new GateError(
      "drift-manifest.json declares no `pnpmInstallHardening` requirement, so there is no cooldown " +
        "or trust policy for this gate to confirm. The requirement is the standard; this file only " +
        "observes it.",
    );
  }
  const distinct = new Set(found.map((r) => JSON.stringify(r)));
  if (distinct.size > 1) {
    throw new GateError(
      "drift-manifest.json declares more than one DIFFERENT `pnpmInstallHardening` requirement, so " +
        "there is no single value this repository owes.",
    );
  }
  const probe = manifest.installHardeningProbe;
  if (probe?.supportedFrom === undefined) {
    throw new GateError(
      "drift-manifest.json carries no `installHardeningProbe.supportedFrom`, so this gate cannot " +
        "tell whether the pnpm in use is old enough to ignore the settings entirely.",
    );
  }
  return { ...found[0], supportedFrom: probe.supportedFrom };
}

// ---------------------------------------------------------------------------
// The pnpm in use
// ---------------------------------------------------------------------------

/** `[major, minor, patch]`, or null when the string is not a plain semver triple. */
export function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1, 0 or 1. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** The real pnpm probes: the version on the path, and the effective value of one setting. */
export const realPnpm = {
  version: (cwd) =>
    (
      spawnSync("pnpm", ["--version"], { cwd, encoding: "utf8", timeout: 300_000 }).stdout ?? ""
    ).trim(),
  configGet: (cwd, key) => {
    const r = spawnSync("pnpm", ["config", "get", key], {
      cwd,
      encoding: "utf8",
      timeout: 300_000,
    });
    return r.status === 0 ? (r.stdout ?? "").trim() : null;
  },
};

// ---------------------------------------------------------------------------
// The grading
// ---------------------------------------------------------------------------

/** Environment variables that configure a pnpm setting, in every spelling pnpm accepts. */
export function environmentOverridesFor(env, setting) {
  const wanted = setting
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/-/g, "");
  const hits = [];
  for (const [name, value] of Object.entries(env)) {
    if (!/^(npm|pnpm)_config_/i.test(name)) continue;
    const normalized = name
      .replace(/^(npm|pnpm)_config_/i, "")
      .toLowerCase()
      .replace(/[-_]/g, "");
    if (normalized === wanted) hits.push({ name, value: String(value) });
  }
  return hits;
}

/** Command-line flags that configure a pnpm setting. */
export function argvOverridesFor(argv, setting) {
  const kebab = setting.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const hits = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    const bare = arg.replace(/^--/, "").replace(/^config\./, "");
    const [name, inline] = bare.split("=");
    if (!arg.startsWith("--")) continue;
    if (name.toLowerCase().replace(/[-_]/g, "") !== kebab.replace(/-/g, "")) continue;
    hits.push({ name: arg, value: inline ?? String(argv[i + 1] ?? "") });
  }
  return hits;
}

/**
 * Grade one repository's settings against the requirement.
 *
 * EVERY RETURN IS A REASON THE ANSWER IS NO. An empty array means every clause below was CONFIRMED,
 * which is a different claim from "nothing objected": the caller prints the confirmations too, so a
 * pass says what it checked rather than only that it finished.
 *
 * @returns {string[]}
 */
export function gradeInstallHardening({
  settingsText,
  settingsPresent,
  required,
  pnpmVersion,
  effective,
  env = {},
  argv = [],
}) {
  const problems = [];
  const floor = required.minimumReleaseAgeMinutes;

  if (!settingsPresent) {
    problems.push(
      `${required.settingsFile}: missing, so a cooldown of at least ${floor} minutes and a trust ` +
        `policy of "${required.trustPolicy}" could not be confirmed to be in force`,
    );
    return problems;
  }

  let declared;
  try {
    declared = parseYamlSubset(settingsText);
  } catch (cause) {
    problems.push(
      `${required.settingsFile}: unparseable (${cause.message}), so a cooldown of at least ` +
        `${floor} minutes and a trust policy of "${required.trustPolicy}" could not be confirmed ` +
        `to be in force`,
    );
    return problems;
  }

  // 1. THE PINNED pnpm MUST KNOW THE SETTINGS. An older one ignores the keys, and a file it ignores
  //    is decoration. This is read from the manifest so the floors are not transcribed here.
  const running = parseVersion(pnpmVersion);
  if (running === null) {
    problems.push(
      `could not confirm which pnpm is in use (\`pnpm --version\` gave ${JSON.stringify(pnpmVersion)}), ` +
        `so support for minimumReleaseAge and trustPolicy could not be confirmed`,
    );
  } else {
    for (const [setting, addedIn] of Object.entries(required.supportedFrom)) {
      const floorVersion = parseVersion(addedIn);
      if (floorVersion === null) {
        problems.push(
          `installHardeningProbe.supportedFrom.${setting} is not a version: ${addedIn}`,
        );
        continue;
      }
      if (compareVersions(running, floorVersion) < 0) {
        problems.push(
          `${setting} is unsupported by the pnpm in use: it was added in ${addedIn} and this is ` +
            `pnpm ${pnpmVersion}, which ignores the key entirely`,
        );
      }
    }
  }

  // 2. THE DECLARED VALUES MUST MEET THE REQUIREMENT.
  const declaredAge = declared.minimumReleaseAge;
  if (typeof declaredAge !== "number") {
    problems.push(
      `${required.settingsFile} minimumReleaseAge: want a number of at least ${floor}, got ` +
        `${JSON.stringify(declaredAge ?? null)}`,
    );
  } else if (declaredAge < floor) {
    problems.push(
      `${required.settingsFile} minimumReleaseAge: want at least ${floor}, got ${declaredAge}`,
    );
  }
  if (declared.trustPolicy !== required.trustPolicy) {
    problems.push(
      `${required.settingsFile} trustPolicy: want "${required.trustPolicy}", got ` +
        `${JSON.stringify(declared.trustPolicy ?? null)}`,
    );
  }

  // 3. THE EFFECTIVE VALUES MUST AGREE WITH THE DECLARED ONES. `pnpm config get` answers with what
  //    pnpm would actually use, so a value overridden in a file this gate never read still shows up.
  for (const [setting, key, want] of [
    ["minimumReleaseAge", "minimum-release-age", declaredAge],
    ["trustPolicy", "trust-policy", declared.trustPolicy],
  ]) {
    const value = effective[key];
    if (value === null || value === undefined || value === "undefined") {
      problems.push(
        `${setting} could not be confirmed in force: \`pnpm config get ${key}\` reported no value ` +
          `while ${required.settingsFile} declares ${JSON.stringify(want ?? null)}`,
      );
      continue;
    }
    if (String(value) !== String(want)) {
      problems.push(
        `${setting} is not in force as declared: ${required.settingsFile} says ` +
          `${JSON.stringify(want ?? null)} and \`pnpm config get ${key}\` reports ` +
          `${JSON.stringify(value)}`,
      );
    }
  }

  // 4. NOTHING IN THE ENVIRONMENT OR ON THE COMMAND LINE MAY OUTRANK THE FILE. pnpm documents
  //    `pnpm-workspace.yaml`, the CLI and environment variables as the three configuration routes,
  //    and this gate can only vouch for the first: a weakening value on either of the other two is
  //    reported rather than reasoned about.
  for (const setting of ["minimumReleaseAge", "trustPolicy"]) {
    const declaredValue = setting === "minimumReleaseAge" ? declaredAge : declared.trustPolicy;
    for (const hit of environmentOverridesFor(env, setting)) {
      if (String(hit.value) !== String(declaredValue)) {
        problems.push(
          `${setting} is overridden in the environment: ${hit.name}=${JSON.stringify(hit.value)} ` +
            `disagrees with ${required.settingsFile}, so the declared value could not be confirmed ` +
            `to be in force`,
        );
      }
    }
    for (const hit of argvOverridesFor(argv, setting)) {
      if (String(hit.value) !== String(declaredValue)) {
        problems.push(
          `${setting} is overridden on the command line: ${hit.name} ` +
            `${JSON.stringify(hit.value)} disagrees with ${required.settingsFile}, so the declared ` +
            `value could not be confirmed to be in force`,
        );
      }
    }
  }

  // 5. EVERY EXEMPTION NEEDS A RECORDED REASON, NAMED WHEN IT DOES NOT HAVE ONE.
  for (const key of ["minimumReleaseAgeExclude", "trustPolicyExclude"]) {
    const entries = declared[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      problems.push(`${required.settingsFile} ${key}: want a list, got ${JSON.stringify(entries)}`);
      continue;
    }
    const annotated = exemptionReasons(settingsText, key);
    for (const entry of entries) {
      const match = annotated.find((a) => a.entry === String(entry));
      if (match === undefined || match.reason === null) {
        problems.push(
          `${key} exempts ${JSON.stringify(String(entry))} with no recorded reason: put a ` +
            `"# reason: ..." comment on the line above it, or drop the exemption`,
        );
      }
    }
  }
  // A BLANKET EXEMPTION IS STILL AN EXEMPTION. `trustPolicyIgnoreAfter` names no package, so it
  // exempts every one of them older than its cutoff, which is the widest hole in this file and
  // needs its reason for the same argument as the narrow ones.
  if (
    declared.trustPolicyIgnoreAfter !== undefined &&
    !reasonAboveKey(settingsText, "trustPolicyIgnoreAfter")
  ) {
    problems.push(
      `trustPolicyIgnoreAfter exempts every package published more than ` +
        `${declared.trustPolicyIgnoreAfter} minutes ago with no recorded reason: put a ` +
        `"# reason: ..." comment on the line above it, or drop the exemption`,
    );
  }

  return problems;
}

/**
 * Read, grade, report.
 *
 * The injection points exist so `test/install-hardening.test.ts` can put the gate in each of the
 * four states AC-5 names without mutating the checkout: an absent settings file, an unparseable one,
 * a weakening environment or CLI override, and a pnpm too old to know the settings. The defaults are
 * the real thing.
 */
export function runCheck({
  manifestPath = DEFAULT_MANIFEST,
  settingsPath = DEFAULT_SETTINGS,
  cwd = configRoot,
  pnpm = realPnpm,
  env = process.env,
  argv = process.argv.slice(2),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
} = {}) {
  let required;
  try {
    if (!existsSync(manifestPath)) {
      throw new GateError(`the drift manifest is missing at ${manifestPath}`);
    }
    required = requiredHardening(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (cause) {
    err("x install hardening was NOT graded, because the standard could not be read:");
    err(`    - ${cause.message}`);
    return 2;
  }

  const settingsPresent = existsSync(settingsPath);
  const settingsText = settingsPresent ? readFileSync(settingsPath, "utf8") : "";
  const pnpmVersion = pnpm.version(cwd);
  const effective = {
    "minimum-release-age": pnpm.configGet(cwd, "minimum-release-age"),
    "trust-policy": pnpm.configGet(cwd, "trust-policy"),
  };

  const problems = gradeInstallHardening({
    settingsText,
    settingsPresent,
    required,
    pnpmVersion,
    effective,
    env,
    argv,
  });

  if (problems.length > 0) {
    err(
      `x install hardening is NOT confirmed in force (required: minimumReleaseAge >= ` +
        `${required.minimumReleaseAgeMinutes}, trustPolicy "${required.trustPolicy}"):`,
    );
    for (const problem of problems) err(`    - ${problem}`);
    return 1;
  }

  out(
    `install hardening confirmed on pnpm ${pnpmVersion}: minimumReleaseAge ` +
      `${effective["minimum-release-age"]} (required >= ${required.minimumReleaseAgeMinutes}), ` +
      `trustPolicy "${effective["trust-policy"]}" (required "${required.trustPolicy}"), every ` +
      `exemption carries a recorded reason`,
  );
  return 0;
}

if (isCliEntrypoint(import.meta.url)) {
  process.exit(runCheck());
}
