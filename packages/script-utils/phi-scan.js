// @cosyte/script-utils/phi-scan
//
// THE PHI COMMIT-GATE, WHOLE. The engine owns the PROCESS; a consuming repo declares DATA.
//
// WHY: `scripts/parser-template/` is a scaffold, not a dependency, so `scripts/phi-scan.ts` was
// COPIED into thirteen repos. Three escape classes have been found so far and each was paid for
// thirteen times. Founder directive 2026-08-11: "all updates go to script-utils to parameterize the
// process." So everything below the DECLARATION line lives here, once.
//
// WHAT "PROCESS" MEANS HERE, AND IT IS THE WHOLE LIST: walking, reading, enumeration, the union of
// the walk with the bytes git carries, staged-blob handling, completeness and its bookkeeping,
// reporting, exit codes, refusals, AND THE PROCESS TAIL that delivers all of it. A consuming repo
// declares roots, exclusions, allow-list conventions, views and detector vocabularies. It runs none
// of the above.
//
// THE DESIGN RULE THIS FILE IS BUILT ON, and it comes from a measurement rather than a taste. Twelve
// repos derived against 0.0.2 and every defect they found made the gate WEAKER THAN DECLARED and
// said nothing: not one produced a false alarm, all produced false confidence. A parameterised
// engine makes that worse, because thirteen repos inherit each default. So: WHEREVER A PARAMETER CAN
// BE MISDECLARED, MISPARSED, UNSUPPORTED OR IGNORED, THIS ENGINE REFUSES RATHER THAN PROCEEDING
// QUIETLY. A silent `default: break`, a dropped tag, an unread root, an undecoded view and a
// declared format that failed to parse are all the same bug.
//
// ZERO DEPENDENCIES, NO BUILD STEP. `git` is the only subprocess, always `execFileSync` with array
// args, never shell-form.
//
// PHI DISCIPLINE INSIDE THIS FILE: no identifier-shaped literal appears anywhere in this source, not
// even as an example in a comment. Describe the shape; never write one down.

import { readFileSync, lstatSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

/**
 * Every state in which the scan cannot account for something. Raised throughout, caught in `run`,
 * turned into the caller's REFUSE code there.
 *
 * NOT EXPORTED, DELIBERATELY: a consumer that could catch it could swallow it.
 */
class InvocationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "InvocationError";
  }
}

/** git's file modes for a regular blob. Every other mode names something with no bytes to read. */
const DEFAULT_REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/** The routes an exclusion can apply to. `named` is a path given as a positional argument. */
const EXCLUSION_ROUTES = ["walk", "index", "staged", "named"];

/** Today's undeclared exclusion policy, now written down: every sweeping route, but not argv. */
const DEFAULT_EXCLUSION_ROUTES = ["walk", "index", "staged"];

/**
 * The allow-list tag namespace, as data. Each entry names the bucket it fills and how the value is
 * folded before it is stored, so `normalizeConfig` can refuse an unknown tag instead of dropping it.
 *
 * D5 WAS EXACTLY THIS TABLE NOT EXISTING. The old parser had a `switch` with `default: break`, so
 * `ADDR`, `PHONE` and `EMAIL` were parsed, matched nothing, and vanished. Five repos measured the
 * cost as hits over values their own allow-list already declared synthetic.
 *
 * `arity` is how many whitespace-separated fields follow the tag. `1` takes the rest of the line as
 * one value; `2` takes a repo-relative path and then the rest, which is what a path-scoped
 * declaration needs.
 *
 * 🛑 `DOB` FOLDS TO NOTHING AND IS COMPARED VERBATIM. One repo's allow-list carries a deliberately
 * truncated synthetic date pinning a partial-timestamp fixture; every normalising implementation
 * silently drops that declaration and every fixture behind it. Another repo independently reported
 * that it stores verbatim and every consumer re-derives. Both are satisfied by the same rule: store
 * verbatim, compare verbatim, and let the caller declare the match shape on the `dob` kind.
 */
const DEFAULT_ALLOW_LIST_TAGS = [
  { tag: "NAME", bucket: "names", fold: "upper", arity: 1 },
  { tag: "DOB", bucket: "dobs", fold: "none", arity: 1 },
  { tag: "ID", bucket: "ids", fold: "upper", arity: 1 },
  { tag: "ADDR", bucket: "addresses", fold: "lower", arity: 1 },
  { tag: "CITY", bucket: "cities", fold: "upper", arity: 1 },
  { tag: "ZIP", bucket: "zips", fold: "none", arity: 1 },
  { tag: "PHONE", bucket: "phones", fold: "digits", arity: 1 },
  { tag: "EMAIL", bucket: "emails", fold: "lower", arity: 1 },
  { tag: "EMAIL", bucket: "scopedEmails", fold: "lower", arity: 2 },
  { tag: "EMAILDOMAIN", bucket: "emailDomains", fold: "lower", arity: 1 },
];

/** Every bucket `DEFAULT_ALLOW_LIST_TAGS` can fill. An `AllowList` always has all of them. */
const ALLOW_BUCKETS = [
  "names",
  "dobs",
  "ids",
  "addresses",
  "cities",
  "zips",
  "phones",
  "emails",
  "scopedEmails",
  "emailDomains",
];

/**
 * The reserved spaces a synthetic value can be declared to live in, as CONVENTIONS rather than as
 * literals. Declaring five never-issued SSN literals as `ID` entries is exactly the hand-maintenance
 * this work deletes.
 *
 * 🛑 THERE IS NO RESERVED DATE-OF-BIRTH SPACE, and that is a stated limit of this gate rather than
 * an omission. Name, phone, identifier and email each have a space that is itself the provenance
 * marker; a date of birth has none, so no `dob` rule can be written that separates a synthetic one
 * from a real one. A repo whose hand-written scanner did not gate DOB loses nothing here.
 */
const RESERVED_SPACES = {
  /**
   * NANP fictional numbers: exchange `555`, line number in the reserved hundred. Stricter than the
   * `includes("555")` test four sibling scanners carried, which accepted a `555` anywhere in the
   * digits, including inside a real area code or line number.
   */
  "nanp-fictional": (value) => {
    const digits = value.replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length !== 10) return false;
    const line = Number(ten.slice(6));
    return ten.slice(3, 6) === "555" && line >= 100 && line <= 199;
  },
  /**
   * Ranges the SSA states it has never issued: area 000, 666 and 900-999; group 00; serial 0000. A
   * number in one of these cannot belong to a person, so it is a provenance marker.
   */
  "ssa-never-issued": (value) => {
    const d = value.replace(/\D/g, "");
    if (d.length !== 9) return false;
    const area = Number(d.slice(0, 3));
    return (
      area === 0 || area === 666 || area >= 900 || d.slice(3, 5) === "00" || d.slice(5) === "0000"
    );
  },
  /** Domains RFC 2606 and RFC 6761 reserve for documentation and testing. */
  "reserved-domain": (value) => {
    const at = value.lastIndexOf("@");
    const domain = (at < 0 ? value : value.slice(at + 1)).toLowerCase();
    return (
      domain === "example.com" ||
      domain === "example.net" ||
      domain === "example.org" ||
      domain === "example.edu" ||
      domain === "invalid" ||
      domain === "test" ||
      domain === "localhost" ||
      domain.endsWith(".example") ||
      domain.endsWith(".invalid") ||
      domain.endsWith(".test") ||
      domain.endsWith(".localhost")
    );
  },
};

export { RESERVED_SPACES };

/**
 * The READ filter that reads everything, and the DEFAULT.
 *
 * 🛑 THIS IS A FLIP FROM 0.0.2 AND IT IS THE FIX FOR THE MARKDOWN DEFECT. The old default exempted
 * Markdown, so `scanRoots: ["README.md"]` returned `OK: no hits` at exit 0 over a live dashed
 * identifier, and a tracked `.md` was read by NEITHER sweeping route while `README.md` and
 * `CHANGELOG.md` ship inside the npm tarball. Six of thirteen repos measured that they needed the
 * exemption gone.
 *
 * The argument is the one this whole file is built on: a repo that wants LESS coverage should have
 * to declare it. A repo surprised by new hits gets a loud, fixable result; a repo surprised by the
 * old default got exit 0.
 *
 * @param {string} _relPath
 * @returns {boolean} Always `true`.
 */
export function readsEverything(_relPath) {
  return true;
}

/**
 * The Markdown read-exemption, kept as an EXPLICIT OPT-IN rather than as the default.
 *
 * A repo declaring this is choosing not to read its own `.md` files on the sweeping routes. That is
 * a real choice with a real cost, it is the third of this item's three escape classes, so it is
 * spelled out at the call site rather than inherited.
 *
 * @param {string} relPath A repo-relative, forward-slashed path.
 * @returns {boolean} `true` when the sweeping routes may read this path's bytes.
 */
export function exemptsMarkdown(relPath) {
  return !relPath.toLowerCase().endsWith(".md");
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** @param {unknown} v @returns {boolean} */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalise and CHECK the caller's configuration.
 *
 * IT THROWS A `TypeError` RATHER THAN RETURNING A CODE: at the point a required axis is missing
 * there is no trustworthy code to return, since `exitCodes` is itself the thing that was not
 * supplied. That escapes with a stack, which is loud and lands on the author's very first run.
 *
 * WHAT IT CANNOT CHECK, NAMED RATHER THAN IMPLIED: the CONTENT of a caller's predicate. The one
 * containment that used to matter there, a staged path admitted outside every root, is now a
 * config-time comparison of two declared lists, because `stagedRoots` replaced `isStagedReadable`.
 *
 * @param {import("./phi-scan.js").PhiScanConfig} config
 * @returns {NormalizedConfig}
 */
function normalizeConfig(config) {
  if (!isPlainObject(config)) {
    throw new TypeError("runPhiScan(config) expects a configuration object.");
  }

  const repoRoot = config.repoRoot ?? process.cwd();
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new TypeError("runPhiScan: `repoRoot` must be a non-empty string when given.");
  }
  /** @param {string} p */
  const rel = (p) =>
    relative(repoRoot, isAbsolute(p) ? p : resolve(repoRoot, p))
      .split(sep)
      .join("/") || ".";

  // ── AXIS 1: the exit contract. ────────────────────────────────────────────
  const codes = config.exitCodes;
  if (!isPlainObject(codes)) {
    throw new TypeError(
      "runPhiScan: `exitCodes` is REQUIRED ({ clean, hits, refuse }). There is deliberately no " +
        "default: the sibling @cosyte/* scanners do not agree on these numbers, and a caller that " +
        "branches on the code (CI does) must read this repo's own contract, never an inherited one.",
    );
  }
  for (const key of ["clean", "hits", "refuse"]) {
    const value = codes[key];
    if (!Number.isInteger(value) || value < 0 || value > 125) {
      throw new TypeError(
        `runPhiScan: exitCodes.${key} must be an integer in 0..125, got ${String(value)}.`,
      );
    }
  }
  if (codes.clean === codes.hits || codes.clean === codes.refuse || codes.hits === codes.refuse) {
    throw new TypeError(
      "runPhiScan: exitCodes.clean, .hits and .refuse must be three DIFFERENT numbers. A caller " +
        "has to be able to tell `this corpus contains something that looks like PHI` from `this " +
        "scan is not trustworthy`: those need different human responses.",
    );
  }

  // ── AXIS 2: the roots. ────────────────────────────────────────────────────
  const rawRoots = config.scanRoots;
  if (!Array.isArray(rawRoots) || rawRoots.length === 0) {
    throw new TypeError(
      'runPhiScan: `scanRoots` is REQUIRED and must name at least one root. Use `["."]` for the ' +
        "whole repository, but DERIVE it rather than copying it: two repos measured that a " +
        "whole-repository root exits on their own manifest's author address, and five measured " +
        "that a sibling's narrow roots silently drop tracked files the index union already read.",
    );
  }
  /** @type {Map<string, RootSpec>} */
  const roots = new Map();
  for (const raw of rawRoots) {
    /** @type {Record<string, unknown>} */
    let spec;
    if (typeof raw === "string") spec = { rel: raw };
    else if (isPlainObject(raw)) spec = { ...raw };
    else {
      throw new TypeError(
        "runPhiScan: every entry in `scanRoots` must be a string or a { rel, shape?, walk?, " +
          "require? } object.",
      );
    }
    if ("abs" in spec) {
      // NOT A FIELD, and this is a deletion rather than a rename. Two repos re-derived that in every
      // live `{abs, rel}` pair `abs === join(repoRoot, rel)`, so it carried no information: `abs`
      // fed `readdirSync` and `rel` fed the `git ls-files` pathspec and the refusal text, and both
      // are process. There is no second half for the engine to check for agreement.
      throw new TypeError(
        "runPhiScan: `scanRoots` entries have no `abs` field. It is derived from `rel` and " +
          "`repoRoot`; a declared one carried no information in any live scanner.",
      );
    }
    if (typeof spec.rel !== "string" || spec.rel === "") {
      throw new TypeError("runPhiScan: every `scanRoots` entry needs a non-empty `rel`.");
    }
    const normalized = rel(spec.rel);
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new TypeError(
        `runPhiScan: scanRoots entry ${JSON.stringify(spec.rel)} resolves outside the repository ` +
          `(${normalized}). No path git can name is under it, so every index-keyed rule would go ` +
          `silently empty and the sweep would report clean over a corpus it never had in scope.`,
      );
    }
    const shape = spec.shape ?? "directory";
    if (shape !== "directory" && shape !== "file") {
      throw new TypeError(
        `runPhiScan: scanRoots entry ${JSON.stringify(spec.rel)} declares shape ` +
          `${JSON.stringify(spec.shape)}; it must be "directory" or "file".`,
      );
    }
    for (const flag of ["walk", "require"]) {
      if (spec[flag] !== undefined && typeof spec[flag] !== "boolean") {
        throw new TypeError(
          `runPhiScan: scanRoots entry ${JSON.stringify(spec.rel)} has a non-boolean \`${flag}\`.`,
        );
      }
    }
    const merged = {
      rel: normalized,
      shape,
      walk: spec.walk ?? true,
      require: spec.require ?? true,
    };
    const existing = roots.get(normalized);
    if (existing !== undefined) {
      // Two spellings of one root. They must not disagree, because whichever the engine kept would
      // silently be the other one's answer.
      for (const key of ["shape", "walk", "require"]) {
        if (existing[key] !== merged[key]) {
          throw new TypeError(
            `runPhiScan: scanRoots names ${JSON.stringify(normalized)} twice with different ` +
              `\`${key}\`. Declare it once.`,
          );
        }
      }
      continue;
    }
    roots.set(normalized, merged);
  }
  const scanRoots = [...roots.values()];

  // ── AXIS 3: the `--staged` root half. ─────────────────────────────────────
  if (config.isStagedReadable !== undefined) {
    throw new TypeError(
      "runPhiScan: `isStagedReadable` has been replaced by `stagedRoots`, a declared list of " +
        "repo-relative roots defaulting to `scanRoots`. A predicate and a root list were two " +
        "independent keys with nothing relating them, and a staged path admitted by the first and " +
        "covered by no member of the second was enumerated, read, and had a link's target path " +
        "handed to a detector as content.",
    );
  }
  const rawStagedRoots = config.stagedRoots;
  /** @type {string[]} */
  let stagedRoots;
  if (rawStagedRoots === undefined) {
    stagedRoots = scanRoots.map((r) => r.rel);
  } else if (Array.isArray(rawStagedRoots)) {
    stagedRoots = [];
    for (const r of rawStagedRoots) {
      if (typeof r !== "string" || r === "") {
        throw new TypeError("runPhiScan: every entry in `stagedRoots` must be a non-empty string.");
      }
      const normalized = rel(r);
      if (normalized === ".." || normalized.startsWith("../")) {
        throw new TypeError(
          `runPhiScan: stagedRoots entry ${JSON.stringify(r)} resolves outside the repository.`,
        );
      }
      // THE CONTAINMENT, NOW AT CONFIGURATION TIME, and a refusal rather than a silent narrowing to
      // the intersection: narrowing would hide a misconfiguration in the one place this gate blocks
      // a commit.
      const covered = scanRoots.some(
        (root) =>
          root.rel === "." || normalized === root.rel || normalized.startsWith(`${root.rel}/`),
      );
      if (!covered) {
        throw new TypeError(
          `runPhiScan: stagedRoots entry ${JSON.stringify(r)} is covered by no scan root, so the ` +
            "checks that key on the root half of scope would never run for paths under it. Widen " +
            "`scanRoots`, or drop it from `stagedRoots`.",
        );
      }
      if (!stagedRoots.includes(normalized)) stagedRoots.push(normalized);
    }
    if (stagedRoots.length === 0) {
      throw new TypeError("runPhiScan: `stagedRoots` must name at least one root when given.");
    }
  } else {
    throw new TypeError("runPhiScan: `stagedRoots` must be an array of strings when given.");
  }

  // ── AXIS 2, the subtractive halves. ───────────────────────────────────────
  /** @type {Set<string>} */
  const excludedPaths = new Set();
  /** @type {string[]} */
  let excludedRoutes = DEFAULT_EXCLUSION_ROUTES;
  const rawExcluded = config.excludedPaths;
  if (rawExcluded !== undefined) {
    /** @type {any} */
    let paths = rawExcluded;
    if (isPlainObject(rawExcluded) && "paths" in rawExcluded) {
      paths = rawExcluded.paths;
      if (rawExcluded.routes !== undefined) {
        if (!Array.isArray(rawExcluded.routes) || rawExcluded.routes.length === 0) {
          throw new TypeError(
            "runPhiScan: `excludedPaths.routes` must be a non-empty array when given.",
          );
        }
        for (const route of rawExcluded.routes) {
          if (!EXCLUSION_ROUTES.includes(route)) {
            throw new TypeError(
              `runPhiScan: unknown excludedPaths route ${JSON.stringify(route)}. Known routes: ` +
                `${EXCLUSION_ROUTES.join(", ")}.`,
            );
          }
        }
        excludedRoutes = [...rawExcluded.routes];
      }
    }
    if (
      paths === undefined ||
      typeof paths.has !== "function" ||
      typeof paths[Symbol.iterator] !== "function"
    ) {
      throw new TypeError(
        "runPhiScan: `excludedPaths` must be a Set of repo-relative paths, or " +
          "{ paths: Set, routes?: string[] }. An array used to survive normalization, reach " +
          "`.has(...)` inside enumeration, and take node's exit 1, the code reserved for HITS.",
      );
    }
    for (const p of paths) {
      if (typeof p !== "string" || p === "") {
        throw new TypeError(
          "runPhiScan: every entry in `excludedPaths` must be a non-empty string.",
        );
      }
      excludedPaths.add(rel(p));
    }
  }

  const detectorExemptPaths = readPathSet(config.detectorExemptPaths, "detectorExemptPaths", rel);

  /** @type {string[]} */
  const unreadablePrefixes = [];
  if (config.unreadablePrefixes !== undefined) {
    if (!Array.isArray(config.unreadablePrefixes)) {
      throw new TypeError("runPhiScan: `unreadablePrefixes` must be an array of strings.");
    }
    for (const p of config.unreadablePrefixes) {
      if (typeof p !== "string" || p === "") {
        throw new TypeError(
          "runPhiScan: every entry in `unreadablePrefixes` must be a non-empty string.",
        );
      }
      unreadablePrefixes.push(rel(p));
    }
  }

  for (const key of ["isReadable", "detect"]) {
    if (config[key] !== undefined && typeof config[key] !== "function") {
      throw new TypeError(`runPhiScan: \`${key}\` must be a function when given.`);
    }
  }
  if (config.isWalkReadable !== undefined) {
    throw new TypeError(
      "runPhiScan: `isWalkReadable` is now `isReadable`, and it governs BOTH sweeping routes and " +
        "`--staged` rather than the walk alone. Its default also changed from the Markdown " +
        "exemption to reading everything; `exemptsMarkdown` is still exported for a repo that " +
        "declares the exemption deliberately.",
    );
  }

  if (config.regularBlobModes !== undefined && typeof config.regularBlobModes.has !== "function") {
    throw new TypeError("runPhiScan: `regularBlobModes` must be a Set (or anything with `.has`).");
  }
  for (const key of ["allowListPath", "overrideLogPath"]) {
    const value = config[key];
    if (value !== undefined && (typeof value !== "string" || value === "")) {
      throw new TypeError(`runPhiScan: \`${key}\` must be a non-empty string when given.`);
    }
  }
  if (config.argv !== undefined && !Array.isArray(config.argv)) {
    throw new TypeError("runPhiScan: `argv` must be an array of strings when given.");
  }

  /** @type {Set<string>} */
  const partialReasons = new Set();
  if (config.partialReasons !== undefined) {
    if (!Array.isArray(config.partialReasons)) {
      throw new TypeError("runPhiScan: `partialReasons` must be an array of strings when given.");
    }
    for (const r of config.partialReasons) {
      if (typeof r !== "string" || r === "") {
        throw new TypeError(
          "runPhiScan: every entry in `partialReasons` must be a non-empty string.",
        );
      }
      partialReasons.add(r);
    }
  }
  const partialExit = config.partialExit ?? "clean";
  if (partialExit !== "clean" && partialExit !== "refuse") {
    throw new TypeError('runPhiScan: `partialExit` must be "clean" or "refuse".');
  }

  const vanished = config.vanishedUntrackedWalkTarget ?? "refuse";
  if (vanished !== "refuse" && vanished !== "report-unobserved") {
    throw new TypeError(
      'runPhiScan: `vanishedUntrackedWalkTarget` must be "refuse" or "report-unobserved".',
    );
  }

  return {
    repoRoot,
    argv: config.argv ?? process.argv.slice(2),
    exitCodes: { clean: codes.clean, hits: codes.hits, refuse: codes.refuse },
    scanRoots,
    stagedRoots,
    excludedPaths,
    excludedRoutes,
    detectorExemptPaths,
    unreadablePrefixes,
    isReadable: config.isReadable ?? readsEverything,
    regularBlobModes: config.regularBlobModes ?? DEFAULT_REGULAR_BLOB_MODES,
    allowListPath: config.allowListPath ?? join(repoRoot, "scripts", "phi-allow-list.txt"),
    overrideLogPath: config.overrideLogPath ?? join(repoRoot, "phi-scan-overrides.md"),
    allowListTags: normalizeAllowListTags(config.allowListTags),
    textViews: normalizeTextViews(config.textViews),
    floor: normalizeFloor(config.floor),
    detectors: normalizeDetectors(config.detectors),
    detect: config.detect,
    partialReasons,
    partialExit,
    vanishedUntrackedWalkTarget: vanished,
  };
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {(p: string) => string} rel
 * @returns {Set<string>}
 */
function readPathSet(value, name, rel) {
  /** @type {Set<string>} */
  const out = new Set();
  if (value === undefined) return out;
  /** @type {any} */
  const v = value;
  if (typeof v.has !== "function" || typeof v[Symbol.iterator] !== "function") {
    throw new TypeError(`runPhiScan: \`${name}\` must be a Set of repo-relative paths.`);
  }
  for (const p of v) {
    if (typeof p !== "string" || p === "") {
      throw new TypeError(`runPhiScan: every entry in \`${name}\` must be a non-empty string.`);
    }
    out.add(rel(p));
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ tag: string, bucket: string, fold: string, arity: number }[]}
 */
function normalizeAllowListTags(raw) {
  if (raw === undefined) return DEFAULT_ALLOW_LIST_TAGS.map((t) => ({ ...t }));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TypeError("runPhiScan: `allowListTags` must be a non-empty array when given.");
  }
  /** @type {{ tag: string, bucket: string, fold: string, arity: number }[]} */
  const out = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      throw new TypeError("runPhiScan: every `allowListTags` entry must be an object.");
    }
    const tag = entry.tag;
    const bucket = entry.bucket;
    const fold = entry.fold ?? "none";
    const arity = entry.arity ?? 1;
    if (typeof tag !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(tag)) {
      throw new TypeError(
        `runPhiScan: allowListTags tag ${JSON.stringify(tag)} must be an uppercase identifier.`,
      );
    }
    if (typeof bucket !== "string" || !ALLOW_BUCKETS.includes(bucket)) {
      throw new TypeError(
        `runPhiScan: allowListTags entry ${tag} names bucket ${JSON.stringify(bucket)}; known ` +
          `buckets are ${ALLOW_BUCKETS.join(", ")}.`,
      );
    }
    if (!["none", "upper", "lower", "digits"].includes(fold)) {
      throw new TypeError(
        `runPhiScan: allowListTags entry ${tag} has fold ${JSON.stringify(fold)}; it must be ` +
          '"none", "upper", "lower" or "digits".',
      );
    }
    if (arity !== 1 && arity !== 2) {
      throw new TypeError(`runPhiScan: allowListTags entry ${tag} must have arity 1 or 2.`);
    }
    if (out.some((e) => e.tag === tag && e.arity === arity)) {
      throw new TypeError(
        `runPhiScan: allowListTags declares ${tag} twice at arity ${String(arity)}.`,
      );
    }
    out.push({ tag, bucket, fold, arity });
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ kind: string, appliesTo: string[], holePattern: RegExp }[]}
 */
function normalizeTextViews(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new TypeError("runPhiScan: `textViews` must be an array when given.");
  }
  return raw.map((entry) => {
    if (!isPlainObject(entry)) {
      throw new TypeError("runPhiScan: every `textViews` entry must be an object.");
    }
    if (entry.kind !== "source-literals") {
      throw new TypeError(
        `runPhiScan: unknown textViews kind ${JSON.stringify(entry.kind)}. The only kind this ` +
          'engine ships is "source-literals".',
      );
    }
    // 🛑 NO DEFAULT EXTENSION SET, DELIBERATELY. A repo whose WIRE FORMAT is a source-shaped text
    // must not have that text escape-decoded: one sibling excludes `.json` from its own view for
    // exactly this reason while another needs `.json` included, and decoding a wire payload
    // fabricates content the file does not carry.
    if (!Array.isArray(entry.appliesTo) || entry.appliesTo.length === 0) {
      throw new TypeError(
        "runPhiScan: a `source-literals` textView must declare a non-empty `appliesTo` list of " +
          "path suffixes. There is deliberately no default: a repo whose wire format is itself " +
          "source-shaped would have its payload escape-decoded, which fabricates content.",
      );
    }
    for (const s of entry.appliesTo) {
      if (typeof s !== "string" || s === "") {
        throw new TypeError(
          "runPhiScan: every `textViews.appliesTo` entry must be a non-empty string.",
        );
      }
    }
    if (entry.holePattern !== undefined && !(entry.holePattern instanceof RegExp)) {
      throw new TypeError("runPhiScan: `textViews.holePattern` must be a RegExp when given.");
    }
    return {
      kind: "source-literals",
      appliesTo: entry.appliesTo.map((s) => s.toLowerCase()),
      holePattern: entry.holePattern ?? /\$\{[^{}]*\}/g,
    };
  });
}

/**
 * The cross-cutting floor's two branches, as declared conventions.
 *
 * @param {unknown} raw
 * @returns {{ ssn: { enabled: boolean, spaces: string[] }, email: { enabled: boolean, spaces: string[] } }}
 */
function normalizeFloor(raw) {
  const out = {
    ssn: { enabled: true, spaces: [] },
    email: { enabled: true, spaces: [] },
  };
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) throw new TypeError("runPhiScan: `floor` must be an object when given.");
  for (const branch of ["ssn", "email"]) {
    const spec = raw[branch];
    if (spec === undefined) continue;
    if (spec === false) {
      // A repo turning a floor branch off is declaring that it has no verdict from it. That is a
      // real subtraction, so it is spelled `false` at the call site rather than reached by omission.
      out[branch] = { enabled: false, spaces: [] };
      continue;
    }
    if (!isPlainObject(spec)) {
      throw new TypeError(`runPhiScan: \`floor.${branch}\` must be false or an object.`);
    }
    const spaces = spec.reservedSpaces ?? [];
    if (!Array.isArray(spaces)) {
      throw new TypeError(`runPhiScan: \`floor.${branch}.reservedSpaces\` must be an array.`);
    }
    for (const s of spaces) {
      if (!Object.hasOwn(RESERVED_SPACES, s)) {
        throw new TypeError(
          `runPhiScan: unknown reserved space ${JSON.stringify(s)}. Known spaces: ` +
            `${Object.keys(RESERVED_SPACES).join(", ")}.`,
        );
      }
    }
    out[branch] = { enabled: true, spaces: [...spaces] };
  }
  return out;
}

/**
 * Run the PHI scan and RETURN an exit code. Nothing here calls `process.exit`, so a test can drive
 * the engine in-process. `runPhiScanCli` is the tail that turns this into a process result, and it
 * is shipped here rather than written thirteen times.
 *
 * ===========================================================================================
 * MODES
 *   `--staged`            scan only the blobs `git diff --cached` names.
 *   `<path> [<path>...]`  scan specific paths.
 *   (no args)             `all` mode: sweep the scan roots, as a union with the bytes git carries.
 *
 * `--allow-fixture <path>` IS A MODIFIER, NOT A MODE. A bypass is subtractive, so it must not also
 * decide what gets scanned. TWO DISTINCT SIBLING DEFECTS LIVE HERE: seeding the target list only
 * when no positional was given made the bypass a silent no-op, and selecting `paths` mode from the
 * flag WITHOUT seeding made the run enumerate NOTHING and print a clean line at exit 0. The mode is
 * chosen by positional paths alone, and in `paths` mode the flag is UNCONDITIONALLY UNIONED into the
 * target list, deduped by repo-relative path.
 * ===========================================================================================
 * THE COMPLETENESS RULE: a target this run ENUMERATED and NEVER READ refuses, IN EVERY MODE, NAMING
 * THE PATHS. The comparison is a SET DIFFERENCE, never a size: a count counts the targets that DID
 * get read, so a plausible-looking total hides exactly the paths that did not.
 *
 * PER-ROOT OBSERVATION IS A SECOND, INDEPENDENT TIER. A declared root that yields no file actually
 * READ refuses, because the whole-run floor only asks that SOMETHING was observed. Two repos
 * measured two silent exit-2-to-exit-0 losses this catches, a root absent with its files untracked,
 * and a root starved by gitignore, and a third state it CANNOT catch, a directory root replaced by
 * a one-line file, which is why `shape` is declared and checked separately.
 * ===========================================================================================
 * `all` MODE READS THE BYTES GIT CARRIES AS A UNION WITH THE WALK.
 *
 * The walk answers "what is on disk under the scan roots", which is not the question "what does this
 * repository carry". Three states were measured in which the walk alone reported clean at exit 0
 * over a TRACKED file carrying a live hit: the path OCCUPIED BY A DIRECTORY (a path-set
 * reconciliation cannot see this one, because the path IS present: only reading the OBJECT closes
 * it), the working tree SHORT of a tracked file, and the two copies simply DIFFERING.
 *
 * DEDUPLICATION IS BY CONTENT, NOT BY PATH, AND THAT IS THE EOL AXIS. A walk target is skipped by
 * the union only when the bytes it read hash to the index entry's own object id, so on a clean
 * checkout the union adds ZERO reads and never invokes `cat-file`. Where the two copies DIFFER, BOTH
 * are scanned.
 *
 * `all` MODE REFUSES WHEN GIT CANNOT NAME THE INDEX, OR NAMES IT EMPTY. Measured on git 2.39.5: a
 * directory that is no repository FATALS at 128, so the `catch` is what turns it into a refusal, and
 * WITHOUT that catch the throw escapes and the run takes node's own exit 1, which this contract
 * reserves for HITS FOUND.
 * ===========================================================================================
 *
 * @param {import("./phi-scan.js").PhiScanConfig} config
 * @returns {number} The exit code, drawn from `config.exitCodes`.
 */
export function runPhiScan(config) {
  return new PhiScan(normalizeConfig(config)).run();
}

/**
 * THE PROCESS TAIL, SHIPPED ONCE. Run the scan, deliver its report, and end the process with the
 * right status.
 *
 * 🛑 THIS EXISTS BECAUSE THE OBVIOUS TAIL IS WRONG AND SO IS THE OBVIOUS FIX, and both were
 * measured. A sibling drove 2,000 hits through three tails against two consumer shapes:
 *
 *   - `process.exit(runPhiScan(...))`, today's template, delivered 86 of 2,000 HIT lines and NO
 *     summary to a reader that had not drained stderr. The report is truncated by the exit.
 *   - `process.exitCode = runPhiScan(...)`, the naive repair, delivered more, but HUNG against an
 *     open, never-drained pipe (killed at 8 s), and turned a CLEAN run into this contract's HITS
 *     code through an uncaught `EPIPE` when the stdout reader had gone.
 *   - the same plus an `EPIPE` guard still HUNG.
 *
 * A hang in a pre-commit hook is worse than a truncated report, so neither is shippable alone.
 *
 * WHY THE REPORT AND THE EXIT CODE ARE NOT ACTUALLY IN TENSION: `process.exit` discharges FOUR
 * obligations at once, set the status, abandon the write queue, swallow `EPIPE`, and force
 * termination. The exit code is computed from the findings BEFORE anything is written, so it never
 * depended on delivery. Obligations 3 and 4 were side effects nobody chose. This function restores
 * all four EXPLICITLY, and separately:
 *
 *   1. status      `process.exitCode`, set before anything can fail.
 *   2. queue       left to drain naturally, so the report is delivered in full.
 *   3. `EPIPE`     swallowed on both streams, so a vanished reader cannot move the status.
 *   4. terminate   an UNREF'd timer. If the queues drain, the loop empties and node exits on its own
 *                  with the status already set, full delivery, no timer involvement. If a reader
 *                  holds the pipe open and never drains it, the pending write keeps the loop alive,
 *                  the timer fires, and `process.exit` ends it with the same status. Bounded, never
 *                  hung, and the status is identical on every path.
 *
 * @param {import("./phi-scan.js").PhiScanConfig & { drainGraceMs?: number }} config
 * @returns {void}
 */
export function runPhiScanCli(config) {
  // 3, FIRST: installed before the report is written, because the writes themselves are what can
  // raise it. A vanished reader must never be able to move a clean run onto the HITS code.
  const swallow = () => {};
  process.stdout.on("error", swallow);
  process.stderr.on("error", swallow);

  const code = runPhiScan(config);

  // 1: the status is a function of the findings and is fixed here, whatever delivery does next.
  process.exitCode = code;

  // 4: bounded termination. `unref` is what keeps this from being the thing that holds the process
  // open, so the fast path is "queues drain, loop empties, node exits with the status above".
  const grace = config.drainGraceMs ?? 2000;
  if (grace > 0) {
    const timer = setTimeout(() => {
      process.exit(code);
    }, grace);
    timer.unref();
  }
}

class PhiScan {
  /** @param {NormalizedConfig} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    /** Does any scan root name the repository root itself? Then everything is in scope. */
    this.wholeRepo = cfg.scanRoots.some((r) => r.rel === ".");
    /** @type {Map<string, { objects: number, bytes: number, reasons: Set<string> }>} */
    this.partials = new Map();
  }

  // -------------------------------------------------------------------------
  // Paths and scope
  // -------------------------------------------------------------------------

  /**
   * A repo-relative, forward-slashed path: the key every filter, exclusion, dedupe and completeness
   * tier uses, and the only spelling that appears in a diagnostic.
   *
   * @param {string} p
   * @returns {string}
   */
  normalizePath(p) {
    const abs = isAbsolute(p) ? p : resolve(this.cfg.repoRoot, p);
    return relative(this.cfg.repoRoot, abs).split(sep).join("/") || ".";
  }

  /** @param {string} root @returns {string} */
  absoluteRoot(root) {
    return root === "." ? this.cfg.repoRoot : join(this.cfg.repoRoot, ...root.split("/"));
  }

  /**
   * AXIS 2, the ROOT half of scope: is this entry the scan's BUSINESS at all?
   *
   * THERE ARE TWO SCOPE PREDICATES AND COLLAPSING THEM REOPENS A MEASURED HOLE. This one decides
   * whether an entry is in scope; the READ filter decides whether a REGULAR FILE's bytes get read.
   * Every non-regular and non-blob check keys on THIS one. Two sibling ports independently shipped a
   * single shared predicate and both had the routes disagree about the same entry: a `.md`-named
   * link fell out through the read filter on one route while the other refused it. A link's NAME is
   * no evidence at all about what is on the other side of it.
   *
   * `walk: false` roots ARE in scope here, and that is the whole reason the flag exists: one sibling
   * keeps a second root list of directories that must EXIST and must not be walked, and a flat list
   * merges two roles.
   *
   * A bare root name is in scope because git records no index entry for a directory. A scan root
   * appearing as an index entry therefore means it is not a directory, and AT LEAST these readings
   * exist: the root has been replaced by a blob or a link; it is a declared FILE root; or it is a
   * gitlink, which the index refusal names in those words.
   *
   * @param {string} relPath
   * @returns {boolean}
   */
  isUnderScanRoot(relPath) {
    if (this.wholeRepo) return true;
    return this.cfg.scanRoots.some(
      (root) => relPath === root.rel || relPath.startsWith(`${root.rel}/`),
    );
  }

  /** @param {string} relPath @returns {boolean} */
  isUnderStagedRoot(relPath) {
    return this.cfg.stagedRoots.some(
      (root) => root === "." || relPath === root || relPath.startsWith(`${root}/`),
    );
  }

  /**
   * AXIS 2, the READ half of scope, for every sweeping route.
   *
   * `unreadablePrefixes` is DATA and `isReadable` is the escape hatch. One sibling needs six vendored
   * tarball paths unread, their names carry versions, and an exact-match exclusion silently renames
   * one out of the list on a re-pack. Note the polarity: this subtracts a READ, never SCOPE, so a
   * link named under such a prefix is still refused by the root half rather than buying a pass on
   * its name.
   *
   * @param {string} relPath
   * @returns {boolean}
   */
  isReadable(relPath) {
    for (const prefix of this.cfg.unreadablePrefixes) {
      if (relPath === prefix || relPath.startsWith(`${prefix}/`)) return false;
    }
    return this.cfg.isReadable(relPath);
  }

  /**
   * @param {string} relPath
   * @param {string} route
   * @returns {boolean}
   */
  isExcluded(relPath, route) {
    if (!this.cfg.excludedRoutes.includes(route)) return false;
    return this.cfg.excludedPaths.has(relPath);
  }

  // -------------------------------------------------------------------------
  // Argument parsing
  // -------------------------------------------------------------------------

  /**
   * @param {string[]} argv
   * @returns {{ mode: string, paths: string[], allowFixtures: string[] }}
   */
  parseArgs(argv) {
    let staged = false;
    /** @type {string[]} */
    const paths = [];
    /** @type {string[]} */
    const allowFixtures = [];
    let i = 0;
    while (i < argv.length) {
      const a = argv[i];
      if (a === "--") {
        for (let j = i + 1; j < argv.length; j += 1) {
          const v = argv[j];
          if (v !== undefined) paths.push(v);
        }
        break;
      } else if (a === "--staged") {
        staged = true;
        i += 1;
      } else if (a === "--allow-fixture") {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new InvocationError("--allow-fixture requires a path argument");
        }
        allowFixtures.push(next);
        i += 2;
      } else if (a !== undefined && a.startsWith("--")) {
        throw new InvocationError(`Unknown flag: ${a}`);
      } else if (a !== undefined) {
        paths.push(a);
        i += 1;
      } else {
        i += 1;
      }
    }

    if (staged && paths.length > 0) {
      throw new InvocationError("--staged cannot be combined with positional paths");
    }

    let mode;
    if (staged) mode = "staged";
    else if (paths.length > 0) mode = "paths";
    else mode = "all";

    const seed = [...paths, ...allowFixtures];
    const scanPaths = mode === "paths" ? this.dedupeByRepoPath(seed) : paths;
    return { mode, paths: scanPaths, allowFixtures };
  }

  /** @param {string[]} paths @returns {string[]} */
  dedupeByRepoPath(paths) {
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    for (const p of paths) {
      const key = this.normalizePath(p);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Allow-list + override log
  // -------------------------------------------------------------------------

  /**
   * Read a configuration file this gate depends on.
   *
   * EVERY FAILURE HERE IS A REFUSAL, AND THAT IS A FIX RATHER THAN A TIDY-UP. A file that EXISTS but
   * cannot be READ, a directory at that path, mode 000, an EACCES on a parent, used to make
   * `readFileSync` throw a plain `Error`, which escaped and took node's exit 1, the code this
   * contract reserves for HITS FOUND. Four repos measured seven distinct instances of that shape. A
   * crash and a PHI finding must not share a code, so the catch is BARE: it does not enumerate errno
   * spellings, because a deny-list of spellings buys exactly one more evasion per round.
   *
   * @param {string} path
   * @param {string} what
   * @returns {string}
   */
  readConfigFile(path, what) {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      throw new InvocationError(
        `could not read the ${what} at ${this.normalizePath(path)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * The positive declaration that specific identifiers are synthetic.
   *
   * 🛑 AN UNRECOGNISED TAG REFUSES, NAMING THE TAG AND THE LINE. The old parser had a `switch` with
   * `default: break`, so a declaration the header promised, `ADDR`, `PHONE`, `EMAIL`, was parsed,
   * matched nothing and vanished. Five repos measured the cost as hits over values their own
   * allow-list already declared synthetic. A declaration that does nothing is worse than a missing
   * one, because its author believes it took effect.
   *
   * @returns {import("./phi-scan.js").AllowList}
   */
  loadAllowList() {
    if (!existsSync(this.cfg.allowListPath)) {
      throw new InvocationError(`allow-list not found at ${this.cfg.allowListPath}`);
    }
    const raw = this.readConfigFile(this.cfg.allowListPath, "allow-list");
    /** @type {any} */
    const allow = {};
    for (const bucket of ALLOW_BUCKETS) allow[bucket] = new Set();

    const lines = raw.split(/\r?\n/);
    /** @type {string[]} */
    const unknown = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = (lines[i] ?? "").trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const parts = line.split(/\s+/);
      const tag = parts[0] ?? "";
      const rest = parts.slice(1);
      const candidates = this.cfg.allowListTags.filter((t) => t.tag === tag);
      if (candidates.length === 0) {
        unknown.push(`  - line ${String(i + 1)}: ${tag}`);
        continue;
      }
      // Arity 2 is the path-scoped form and wins when the line carries enough fields: an address
      // never contains whitespace, and a path plus an address always does.
      const chosen =
        candidates.find((c) => c.arity === 2 && rest.length >= 2) ??
        candidates.find((c) => c.arity === 1);
      if (chosen === undefined || rest.length === 0) {
        unknown.push(`  - line ${String(i + 1)}: ${tag} (no value)`);
        continue;
      }
      if (chosen.arity === 2) {
        const scopePath = this.normalizePath(rest[0] ?? "");
        allow[chosen.bucket].add(`${scopePath} ${fold(rest.slice(1).join(" "), chosen.fold)}`);
      } else {
        allow[chosen.bucket].add(fold(rest.join(" "), chosen.fold));
      }
    }
    if (unknown.length > 0) {
      throw new InvocationError(
        `refusing the scan: ${String(unknown.length)} allow-list line(s) declare a tag this ` +
          `scanner does not implement:\n${unknown.join("\n")}\n` +
          `A declaration nothing consumes is worse than a missing one, because its author believes ` +
          `it took effect. Known tags: ` +
          `${[...new Set(this.cfg.allowListTags.map((t) => t.tag))].sort().join(", ")}. Fix the ` +
          `tag in ${this.relAllowList()}, or declare it in \`allowListTags\`.`,
      );
    }
    return allow;
  }

  /**
   * Every path the override log records, repo-relative.
   *
   * 🛑 SECTION-SCOPED. A `### <path>` heading counts only under an `## Entries` heading. One
   * sibling's committed log holds five `###` headings ABOVE its `## Entries` section, a legend,
   * not entries, and an unscoped reading turns all five into honoured bypass paths. The scoping is
   * a narrowing of what a heading MEANS, not a parser nicety. Fenced blocks are skipped, so a
   * heading quoted inside an example is not an entry either.
   *
   * @returns {Set<string>}
   */
  loadOverrideLog() {
    /** @type {Set<string>} */
    const out = new Set();
    if (!existsSync(this.cfg.overrideLogPath)) return out;
    const raw = this.readConfigFile(this.cfg.overrideLogPath, "override log");
    let inEntries = false;
    let inFence = false;
    for (const lineRaw of raw.split(/\r?\n/)) {
      if (/^\s{0,3}(?:```|~~~)/.test(lineRaw)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const h2 = /^##\s+(.+?)\s*$/.exec(lineRaw);
      if (h2 !== null) {
        inEntries = (h2[1] ?? "").trim().toLowerCase() === "entries";
        continue;
      }
      if (!inEntries) continue;
      const h3 = /^###\s+(.+?)\s*$/.exec(lineRaw);
      if (h3 !== null && h3[1] !== undefined) out.add(this.normalizePath(h3[1]));
    }
    return out;
  }

  /** @param {string[]} allowFixtures */
  validateAllowFixtures(allowFixtures) {
    if (allowFixtures.length === 0) return;
    const overrides = this.loadOverrideLog();
    const missing = allowFixtures
      .map((p) => this.normalizePath(p))
      .filter((p) => !overrides.has(p));
    if (missing.length > 0) {
      const lines = missing.map((p) => `  - ${p}`).join("\n");
      throw new InvocationError(
        `--allow-fixture rejected: no matching entry in ${this.relOverrideLog()} for:\n${lines}\n` +
          `Add a "### <path>" subsection UNDER the "## Entries" heading in ` +
          `${this.relOverrideLog()} and commit it.`,
      );
    }
  }

  /** @returns {string} */
  relOverrideLog() {
    return this.normalizePath(this.cfg.overrideLogPath);
  }

  /** @returns {string} */
  relAllowList() {
    return this.normalizePath(this.cfg.allowListPath);
  }

  // -------------------------------------------------------------------------
  // git
  // -------------------------------------------------------------------------

  /**
   * Which of these paths git considers ignored.
   *
   * ONE BOUNDARY, NOT TWO: an ignored entry is already out of scope for the file route, so applying
   * the same rule to a link keeps a single boundary. `git check-ignore` is INDEX-AWARE, so `git add
   * -f` on an ignored link does not buy a bypass.
   *
   * @param {string[]} paths
   * @returns {Set<string>}
   */
  gitIgnored(paths) {
    /** @type {Set<string>} */
    const ignored = new Set();
    if (paths.length === 0) return ignored;
    try {
      // SECURITY: array-form execFileSync, no shell.
      const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
        cwd: this.cfg.repoRoot,
        input: paths.map((p) => this.normalizePath(p)).join("\0"),
        stdio: ["pipe", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
      for (const p of out.toString("utf8").split("\0")) {
        if (p.length > 0) ignored.add(p);
      }
    } catch {
      // `git check-ignore` exits 1 when nothing matches, and fatals outside a repository. Both mean
      // "none ignored" here: in `all` mode the missing index is refused separately and loudly, and
      // pruning nothing can only ever make the sweep read MORE.
    }
    return ignored;
  }

  /**
   * The repository's object format as a Node hash name, or `null` when git says something we do not
   * recognise. `null` disables the union's content deduplication, which scans MORE, never less.
   *
   * @returns {string | null}
   */
  gitObjectHash() {
    let answer;
    try {
      // SECURITY: array-form execFileSync, no shell.
      answer = execFileSync("git", ["rev-parse", "--show-object-format"], {
        cwd: this.cfg.repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString("utf8")
        .trim();
    } catch {
      // A git too old to know this flag predates sha256 repositories entirely, so this is a
      // derivation rather than a guess. An answer we do not RECOGNISE is a newer git, and there the
      // honest move is to stop deduplicating.
      return "sha1";
    }
    if (answer === "sha1") return "sha1";
    if (answer === "sha256") return "sha256";
    return null;
  }

  /**
   * The object id git would record for these bytes, under its own `blob <len>\0` framing.
   *
   * THIS IS THE EOL AXIS: where a `text` attribute or `core.autocrlf` makes the index carry LF and
   * the working tree CRLF, the two ids differ and BOTH copies are scanned.
   *
   * @param {string} algorithm
   * @param {Buffer} bytes
   * @returns {string | null}
   */
  blobOid(algorithm, bytes) {
    try {
      return createHash(algorithm)
        .update(`blob ${String(bytes.length)}\0`)
        .update(bytes)
        .digest("hex");
    } catch {
      return null;
    }
  }

  /**
   * Every stage-0 index entry keyed by repo-relative path, plus the paths that have a record but NO
   * stage-0 record, or `null` when git could not answer.
   *
   * AN EMPTY ANSWER COUNTS AS NO ANSWER: an empty map would make every tracked path untracked, which
   * is the one state in which the union silently stops existing.
   *
   * 🛑 THE STAGE DIGIT IS READ, AND KEYING ON IT IS NOT OPTIONAL. THE RULE IS THE ABSENCE OF STAGE 0.
   * Do NOT re-derive it from a record count or from a mode: an unmerged path is reported here only
   * at stages 1, 2 and/or 3, with ORDINARY BLOB MODES, so the mode rule cannot see it. A sibling's
   * draft took the FIRST record per path and never looked at the stage: it scanned STAGE 1, THE
   * MERGE BASE, labelled it as the bytes git carries, and printed a clean line over a marker living
   * only in stage 3.
   *
   * @returns {{ entries: Map<string, any>, unmerged: string[] } | null}
   */
  gitIndexEntries() {
    let out;
    try {
      // SECURITY: array-form execFileSync, no shell. `maxBuffer` is raised because a TRUNCATED list
      // is a SHORT list, and a short list is the unscanned corpus this whole rule is about; Node
      // throws `ENOBUFS` rather than truncating, so the bound refuses either way.
      out = execFileSync("git", ["ls-files", "-s", "-z"], {
        cwd: this.cfg.repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      // LOAD-BEARING. A directory that is no repository FATALS at 128; without this catch the throw
      // escapes and the run takes node's exit 1, which this contract reserves for HITS FOUND.
      return null;
    }
    /** @type {Map<string, any>} */
    const entries = new Map();
    /** @type {Set<string>} */
    const higherStages = new Set();
    for (const rec of out.toString("utf8").split("\0")) {
      if (rec.length === 0) continue;
      const m = /^(\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(rec);
      const mode = m?.[1];
      const oid = m?.[2];
      const stage = m?.[3];
      const path = m?.[4];
      if (mode === undefined || oid === undefined || stage === undefined || path === undefined) {
        // An unparseable record means the list may be SHORT in a way we cannot see.
        return null;
      }
      if (stage === "0") entries.set(path, { mode, oid });
      else higherStages.add(path);
    }
    const unmerged = [...higherStages].filter((p) => !entries.has(p));
    if (entries.size === 0 && unmerged.length === 0) return null;
    return { entries, unmerged };
  }

  // -------------------------------------------------------------------------
  // Enumeration: the walk
  // -------------------------------------------------------------------------

  /**
   * Enumerate the scan roots.
   *
   * THE ROOT'S SHAPE IS DECLARED AND CHECKED, NOT DERIVED. Deriving is what let a corpus root
   * replaced by a one-line file through: the sweep read the file, the per-root observation rule saw
   * a file READ under that root and passed, and the run went from exit 2 to exit 0. `require` cannot
   * catch that state because the replacement IS read. So a root that is not the shape it declares is
   * an `Unscannable` naming both shapes.
   *
   * 🛑 `lstat`, NEVER `stat`, AT A ROOT. The root is the one place a link can be followed by
   * construction, because the walk starts there. A refuter caught a live follow-a-link escape here
   * in a tree it had already passed once.
   *
   * A DECLARED FILE ROOT BYPASSES THE READ FILTER. Naming a file as a root is the same explicit act
   * as naming it on argv, and the alternative is the measured defect: a `README.md` root that reads
   * nothing and reports clean at exit 0 over a live identifier.
   *
   * IGNORED DIRECTORIES ARE PRUNED DURING DESCENT, one `git check-ignore` per level, and that is not
   * an optimisation bolted onto a filter. `git check-ignore` IS INDEX-AWARE AT DIRECTORY
   * GRANULARITY. Measured on git 2.39.5 with `node_modules/` ignored: nothing tracked underneath ->
   * the directory is pruned, which is right, because no file under it could have survived the
   * file-level filter either; one file force-added underneath -> `check-ignore` exits 1, the
   * directory is NOT pruned, and the walk reads the tracked file exactly as before.
   *
   * THE BFS `visited` SET IS WHAT MAKES NESTED ROOTS SAFE, and it is measured rather than asserted:
   * a root list and the same list with a nested child added report the same hits and the same count
   * over the same tree. A repo does not need two root lists to avoid a double-report.
   *
   * A DIRECTORY NAMED `.git` IS SKIPPED BY NAME, at any depth. It is git's own object store rather
   * than the corpus, git does not report it ignored, and the union already reads what the repository
   * carries.
   *
   * @returns {{ files: string[], unscannable: any[] }}
   */
  walkRoots() {
    /** @type {string[]} */
    const files = [];
    /** @type {any[]} */
    const unscannable = [];
    /** @type {string[]} */
    const rootDirs = [];

    for (const root of this.cfg.scanRoots) {
      const abs = this.absoluteRoot(root.rel);
      const stats = lstatOrNull(abs);
      if (stats === null) {
        // A missing or unreadable root is skipped HERE and caught by `require` below, which is the
        // tier that can tell "declared and yielded nothing" from "not declared".
        continue;
      }
      const actual = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : null;
      if (actual === null) {
        unscannable.push({ path: root.rel, kind: statsKind(stats) });
        continue;
      }
      if (actual !== root.shape) {
        unscannable.push({
          path: root.rel,
          kind: `a ${actual}, where a ${root.shape} is declared`,
        });
        continue;
      }
      if (!root.walk) continue;
      if (root.shape === "file") files.push(abs);
      else rootDirs.push(abs);
    }

    let frontier = rootDirs;
    const visited = new Set(frontier);

    while (frontier.length > 0) {
      /** @type {string[]} */
      const nextDirs = [];
      for (const dir of frontier) {
        /** @type {any[]} */
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          // A directory the walk cannot open is a refusal, never a skip and never a crash. Uncaught,
          // this took node's exit 1, the HITS code, for a directory at mode 000.
          throw new InvocationError(
            `could not enumerate ${this.normalizePath(dir)}: ` +
              `${err instanceof Error ? err.message : String(err)}. A directory the sweep cannot ` +
              `open has no clean verdict to give about what is inside it.`,
          );
        }
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === ".git") continue;
            if (visited.has(full)) continue;
            visited.add(full);
            nextDirs.push(full);
          } else if (e.isFile()) {
            // A READ filter. The branch below is deliberately NOT subject to it: that exemption is a
            // judgement about a file whose bytes the walk could have read, and a link's name is no
            // evidence about what is on the other side.
            if (!this.isReadable(this.normalizePath(full))) continue;
            files.push(full);
          } else {
            unscannable.push({ path: this.normalizePath(full), kind: direntKind(e) });
          }
        }
      }
      frontier = this.pruneIgnoredDirs(nextDirs);
    }

    files.sort((a, b) => (this.normalizePath(a) < this.normalizePath(b) ? -1 : 1));
    unscannable.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { files, unscannable };
  }

  /** @param {string[]} dirs @returns {string[]} */
  pruneIgnoredDirs(dirs) {
    if (dirs.length === 0) return dirs;
    const ignored = this.gitIgnored(dirs);
    return dirs.filter((d) => !ignored.has(this.normalizePath(d)));
  }

  // -------------------------------------------------------------------------
  // Enumeration: the three routes
  // -------------------------------------------------------------------------

  /**
   * `all` mode's enumeration: the walk, PLUS the in-scope index the union half reads.
   *
   * @returns {{ targets: any[], index: Map<string, any> }}
   */
  buildTargetsForAll() {
    const { files, unscannable } = this.walkRoots();

    const ignored = this.gitIgnored([
      ...files.map((f) => this.normalizePath(f)),
      ...unscannable.map((u) => u.path),
    ]);

    this.refuseUnscannable(
      unscannable.filter((u) => !ignored.has(u.path) && !this.isExcluded(u.path, "walk")),
      "The walk can neither read such an entry nor vouch for what is on the other side of it.",
      "Remove it, replace it with what the declaration says, or (if it is genuinely not part of " +
        "the corpus) untrack it and add it to .gitignore.",
    );

    const listed = this.gitIndexEntries();
    if (listed === null) {
      throw new InvocationError(
        "refusing the sweep: git could not name this repository's index, or named it empty, so the " +
          "sweep would be the working-tree walk's word alone and could report clean over tracked " +
          "bytes it never opened. Run it inside a git repository with a readable index.",
      );
    }

    // Unmerged first, under its OWN sentence: an unmerged path is not a link and not a gitlink, and
    // reporting it as one sends a developer looking for something that is not there.
    this.refuseUnscannable(
      listed.unmerged
        .filter((p) => this.isUnderScanRoot(p) && !this.isExcluded(p, "index"))
        .map((p) => ({ path: p, kind: "no stage-0 blob" })),
      "An unmerged path has no single merged blob, so there is no one set of bytes git carries here " +
        "for the sweep to read, only the conflicting sides and, when there is one, their base.",
      "Resolve the conflict and stage the result, then re-run.",
      { one: "path is unmerged", many: "paths are unmerged" },
    );

    this.refuseUnscannable(
      [...listed.entries]
        .filter(
          ([p, e]) =>
            this.isUnderScanRoot(p) &&
            !this.cfg.regularBlobModes.has(e.mode) &&
            !this.isExcluded(p, "index"),
        )
        .map(([p, e]) => ({ path: p, kind: gitModeKind(e.mode) })),
      "Git records no readable content at such a path, so scanning it would prove nothing about " +
        "what it stands for.",
      "Untrack it, or replace it with a regular file.",
      { one: "index entry is not a regular blob", many: "index entries are not regular blobs" },
    );

    const trackedPaths = new Set(listed.entries.keys());
    const targets = files
      .map((abs) => ({ abs, rel: this.normalizePath(abs) }))
      .filter(({ rel }) => !ignored.has(rel) && !this.isExcluded(rel, "walk"))
      .map(({ abs, rel }) => ({
        path: rel,
        read: () => readFileSync(abs),
        // Only an UNTRACKED walk target can be tolerated when it vanishes; a tracked one has bytes
        // git carries, and the union will read them.
        tolerateVanish:
          this.cfg.vanishedUntrackedWalkTarget === "report-unobserved" && !trackedPaths.has(rel),
        absPath: abs,
      }));
    return { targets, index: listed.entries };
  }

  /**
   * The in-scope tracked paths the union half is entitled to read.
   *
   * COMPUTED BEFORE THE FIRST BYTE IS READ, AND THAT IS LOAD-BEARING. This set is part of what `all`
   * mode ENUMERATES, so both completeness tiers see it: a bypass naming a tracked-but-absent path
   * subtracts something real rather than being refused as naming nothing.
   *
   * @param {Map<string, any>} index
   * @returns {string[]}
   */
  unionCandidatePaths(index) {
    return [...index]
      .filter(
        ([p, e]) =>
          this.cfg.regularBlobModes.has(e.mode) &&
          this.isUnderScanRoot(p) &&
          this.isReadable(p) &&
          !this.isExcluded(p, "index"),
      )
      .map(([p]) => p);
  }

  /**
   * THE UNION HALF of `all` mode: the bytes git carries at every in-scope tracked path whose bytes
   * the walk did not already read VERBATIM.
   *
   * @param {Map<string, any>} index
   * @param {Map<string, string>} readOids
   * @returns {any[]}
   */
  buildTargetsForGitIndex(index, readOids) {
    /** @type {any[]} */
    const targets = [];
    for (const path of this.unionCandidatePaths(index)) {
      const entry = index.get(path);
      if (entry === undefined) continue;
      if (readOids.get(path) === entry.oid) continue;
      targets.push({
        path,
        origin: "as git carries it",
        // SECURITY: array-form execFileSync, no shell. Naming the OBJECT rather than the path is the
        // whole point: it cannot be redirected by whatever the working tree currently holds.
        // `maxBuffer` is raised to the same bound the index listing uses; at node's 1 MiB default a
        // larger tracked blob refused, which is right, but it refused while the run had no locus to
        // name it by.
        read: () =>
          execFileSync("git", ["cat-file", "blob", entry.oid], {
            cwd: this.cfg.repoRoot,
            encoding: "buffer",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 512 * 1024 * 1024,
          }),
      });
    }
    return targets;
  }

  /**
   * A path named on argv.
   *
   * 🛑 `lstat`, NOT `existsSync` + `statSync`. Both of those dereference, so a symbolic link named
   * here was classified by what it POINTED AT. Measured: a link at an in-repo path pointing at a
   * clean file OUTSIDE the repository reported `OK: no hits` at exit 0, vouching for an in-repo path
   * over bytes git does not carry; pointed at a payload, the hits were reported under the LINK's
   * path. A dangling link answered "File not found" rather than naming it a link.
   *
   * @param {string[]} paths
   * @returns {any[]}
   */
  buildTargetsForPaths(paths) {
    return paths.map((p) => {
      const abs = isAbsolute(p) ? p : resolve(this.cfg.repoRoot, p);
      const relPath = this.normalizePath(abs);
      if (this.isExcluded(relPath, "named")) {
        throw new InvocationError(
          `${relPath} is declared in \`excludedPaths\` for the \`named\` route, so this run has ` +
            `no verdict to give about it.`,
        );
      }
      const stats = lstatOrNull(abs);
      if (stats === null) throw new InvocationError(`File not found: ${p}`);
      if (!stats.isFile()) {
        throw new InvocationError(
          `refusing ${relPath}: it is ${statsKind(stats)}. Naming it on the command line does not ` +
            `make it readable, and following it would scan bytes at a path this run did not name.`,
        );
      }
      return { path: relPath, read: () => readFileSync(abs) };
    });
  }

  /**
   * `--staged`: exactly the blobs a commit would carry.
   *
   * `--raw` rather than `--name-only` because the DESTINATION MODE is the only thing that
   * distinguishes a staged regular file from a staged symlink or gitlink. `git show :<path>` does
   * not stand in for it: for a symbolic link it hands back the target path as if it were content.
   *
   * `--diff-filter=d` IS AN EXCLUSION ("everything EXCEPT deletions"), NOT AN ALLOW-LIST OF STATUS
   * LETTERS, AND THE POLARITY IS THE WHOLE POINT. An allow-list drops every letter it does not name,
   * silently; that polarity is what made sibling scanners miss `R` (rename) and then `T`
   * (typechange), each found by a separate refuter pass one round apart.
   *
   * 🛑 `--ignore-submodules=none` IS LOAD-BEARING AND ITS ABSENCE WAS A REGRESSION. With
   * `diff.ignoreSubmodules=all` in a user's git config, a staged gitlink under a scan root vanished
   * from `--raw` entirely and the PRE-COMMIT GATE REPORTED CLEAN, measured 2 -> 0 by two repos, one
   * of which had already closed it by hand before adopting. The loss is bounded (a refusal, not a
   * scan: a gitlink has no bytes) and `ls-files -s` is unaffected, so `all` mode still refuses; but
   * this is the commit-blocking route, and a git CONFIG must not be able to move it.
   *
   * `--no-renames` IS SEPARATELY LOAD-BEARING. Rename detection is on by default, so `git mv <link>
   * <scan root>/<name>` stages as one record carrying TWO paths, which desyncs the two-field stride.
   *
   * @returns {any[]}
   */
  buildTargetsForStaged() {
    let listBuf;
    try {
      // SECURITY: array-form execFileSync, no shell.
      listBuf = execFileSync(
        "git",
        [
          "diff",
          "--cached",
          "--raw",
          "-z",
          "--no-renames",
          "--ignore-submodules=none",
          "--diff-filter=d",
        ],
        {
          cwd: this.cfg.repoRoot,
          encoding: "buffer",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    } catch (err) {
      throw new InvocationError(
        `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const fields = listBuf.toString("utf8").split("\0");
    /** @type {{ path: string, mode: string, status: string }[]} */
    const staged = [];
    let i = 0;
    while (i < fields.length) {
      const info = fields[i];
      if (info === undefined || info.length === 0) {
        i += 1;
        continue;
      }
      const m = RAW_RECORD.exec(info);
      const mode = m?.[1];
      const status = m?.[2];
      const path = fields[i + 1];
      if (mode === undefined || status === undefined || path === undefined || path.length === 0) {
        throw new InvocationError(
          "could not read the output of `git diff --cached --raw -z`: unrecognized record. " +
            "Refusing rather than scanning a list that may be short.",
        );
      }
      staged.push({ path, mode, status });
      i += 2;
    }

    // THE UNMERGED SENTENCE, SEPARATE FROM THE MODE SENTENCE. An unmerged path lists with
    // destination mode `000000`, so a single non-regular-mode refusal diagnosed it as "the index
    // holds no file content for such an entry", true of a link, false here, and it sends a
    // developer looking for the wrong thing. `U` is the status letter that says so.
    this.refuseUnscannable(
      staged
        .filter(
          (s) =>
            s.status.startsWith("U") &&
            this.isUnderStagedRoot(s.path) &&
            !this.isExcluded(s.path, "staged"),
        )
        .map((s) => ({ path: s.path, kind: "unmerged in the index" })),
      "An unmerged path has no single staged blob, so there is no one set of bytes a commit would " +
        "carry here for this route to read.",
      "Resolve the conflict and stage the result, then re-run.",
      { one: "staged path is unmerged", many: "staged paths are unmerged" },
    );

    // THE REFUSAL KEYS ON THE ROOT HALF OF SCOPE, NOT ON THE READ FILTER. Running the read filter
    // first would let a link whose NAME the filter drops fall out through a filter that exists to
    // judge a file's BYTES, and this route would then disagree with the walk about the same entry.
    this.refuseUnscannable(
      staged
        .filter(
          (s) =>
            !s.status.startsWith("U") &&
            this.isUnderStagedRoot(s.path) &&
            !this.cfg.regularBlobModes.has(s.mode) &&
            !this.isExcluded(s.path, "staged"),
        )
        .map((s) => ({ path: s.path, kind: gitModeKind(s.mode) })),
      "The index holds no file content for such an entry, so scanning it would prove nothing about " +
        "what it refers to.",
      "Unstage it, or replace it with a regular file.",
    );

    return staged
      .filter(
        (s) =>
          this.isUnderStagedRoot(s.path) &&
          this.isReadable(s.path) &&
          !this.isExcluded(s.path, "staged"),
      )
      .map((s) => s.path)
      .map((relPath) => ({
        path: relPath,
        // SECURITY: array-form execFileSync, no shell. `:<path>` is a git pathspec.
        read: () =>
          execFileSync("git", ["show", `:${relPath}`], {
            cwd: this.cfg.repoRoot,
            encoding: "buffer",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 512 * 1024 * 1024,
          }),
      }));
  }

  /**
   * Refuse over entries the enumeration reached and cannot scan. EVERY offender IN THE GROUP is
   * named, not just the first: a developer who has to re-run the gate once per link learns to
   * distrust it.
   *
   * A refusal names the entry's own repo-relative path and an engine-owned token for its kind. IT
   * NEVER REPORTS A LINK TARGET, which is text off the working tree and can itself carry PHI.
   *
   * @param {any[]} entries
   * @param {string} why
   * @param {string} remedy
   * @param {{ one: string, many: string }} [noun]
   */
  refuseUnscannable(
    entries,
    why,
    remedy,
    noun = { one: "entry is not a regular file", many: "entries are not regular files" },
  ) {
    if (entries.length === 0) return;
    const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
    const phrase = entries.length === 1 ? noun.one : noun.many;
    throw new InvocationError(
      `refusing the scan: ${String(entries.length)} ${phrase}:\n${lines}\n${why} ${remedy}`,
    );
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /**
   * The views a target's bytes are judged through.
   *
   * `raw` always exists. A declared `source-literals` view is ADDITIVE: it decodes the string-escape
   * sequences a TypeScript or JavaScript source uses. A wire payload written as a literal (`"...\r"`
   * for a record separator, `\x` and `\u` escapes inside a value) is then judged as the bytes it
   * stands for rather than as the characters that spell it. Three repos derived this
   * independently, and it is what replaces two siblings' hand-written embedded-payload extractors.
   *
   * 🛑 IT IS ONLY EVER ADDITIVE, so it can add a finding and can never remove one: the raw view is
   * scanned too, and hits are deduplicated by locator and value rather than by view.
   *
   * @param {string} relPath
   * @param {string} raw
   * @returns {{ id: string, text: string }[]}
   */
  viewsOf(relPath, raw) {
    const views = [{ id: "raw", text: raw }];
    const lower = relPath.toLowerCase();
    for (const view of this.cfg.textViews) {
      if (!view.appliesTo.some((suffix) => lower.endsWith(suffix))) continue;
      const decoded = decodeSourceLiterals(raw, view.holePattern);
      if (decoded !== raw) views.push({ id: "source-literals", text: decoded });
    }
    return views;
  }

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  /**
   * The format-agnostic FLOOR: a dashed Social Security Number shape, and an email at a domain the
   * allow-list does not declare.
   *
   * BOTH BRANCHES CONSULT THE ALLOW-LIST, AND BOTH ACCEPT A DECLARED CONVENTION AS WELL AS A
   * LITERAL. Declaring five never-issued SSN literals as `ID` entries is the hand-maintenance this
   * work exists to delete, so `floor.ssn.reservedSpaces` names the SPACE instead. The email branch
   * reads a path-scoped declaration as well as a domain one, because widening a whole domain to
   * clear one address is a real subtraction on the commit-blocking route.
   *
   * @param {string} locus
   * @param {string} relPath The undecorated repo-relative path, for a path-scoped declaration.
   * @param {string} content
   * @param {any} allow
   * @param {any[]} hits
   */
  scanFloor(locus, relPath, content, allow, hits) {
    const { ssn, email } = this.cfg.floor;
    if (ssn.enabled) {
      for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
        const value = m[0];
        if (allow.ids.has(value.toUpperCase())) continue;
        if (allow.ids.has(value.replace(/\D/g, ""))) continue;
        if (ssn.spaces.some((s) => RESERVED_SPACES[s](value))) continue;
        hits.push({ path: locus, segment: "(ssn)", value, reason: "dashed SSN pattern" });
      }
    }
    if (email.enabled) {
      for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
        const value = m[0];
        const domain = (m[1] ?? "").toLowerCase();
        if (allow.emailDomains.has(domain)) continue;
        if (allow.emails.has(value.toLowerCase())) continue;
        if (allow.scopedEmails.has(`${relPath} ${value.toLowerCase()}`)) continue;
        if (email.spaces.some((s) => RESERVED_SPACES[s](value))) continue;
        hits.push({ path: locus, segment: "(email)", value, reason: "email with non-test domain" });
      }
    }
  }

  /**
   * Scan one target and RETURN THE BYTES IT OBSERVED. The bytes are returned rather than a boolean
   * so `all` mode can ask whether the walk already read exactly what the index carries at this path.
   *
   * THE LOCUS IS COMPUTED BEFORE THE READ. It used to be computed after, so a read that failed
   * (reachable, because `cat-file` runs under a byte bound) named the BARE path in its refusal,
   * while the bytes it could not read were the ones git carries.
   *
   * THE CALLER'S DETECTOR IS HANDED BOTH THE LOCUS AND THE UNDECORATED PATH. Handing only the locus
   * was a measured false negative and a measured false positive in two different repos: an
   * extension-keyed detector stops matching once `(as git carries it)` is appended, so the union
   * half silently lost a whole detector class in one repo and gained a wrong one in another. Six
   * repos derived this independently, and two of them REFUSED to strip the label caller-side. That
   * refusal was right: parsing engine-owned text narrows silently.
   *
   * A DETECTOR THAT THROWS REFUSES THE SCAN rather than escaping to node's own exit code.
   *
   * 🛑 THE REFUSAL PRINTS THE DETECTOR'S OWN MESSAGE VERBATIM, AND THAT IS A DISCLOSED RESIDUAL
   * RATHER THAN A CLOSED ONE. Everywhere else this engine prints only a repo-relative path and a
   * token from a closed set, precisely because a diagnostic ABOUT a PHI leak is itself a PHI
   * surface. Throw a message that names the position, never the content.
   *
   * @param {any} target
   * @param {any} allow
   * @param {any[]} hits
   * @returns {Buffer | null} `null` when an untracked walk target vanished and that is tolerated.
   */
  scanTarget(target, allow, hits) {
    const locus = target.origin === undefined ? target.path : `${target.path} (${target.origin})`;
    let buf;
    try {
      buf = target.read();
    } catch (err) {
      if (target.tolerateVanish === true && errorCode(err) === "ENOENT") return null;
      throw new InvocationError(
        `could not read ${locus}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (this.cfg.detectorExemptPaths.has(target.path)) {
      // READ AND ACCOUNTED FOR, JUDGED BY NOTHING. This is not `excludedPaths`, which withdraws the
      // path before the read: one says "this run has no verdict here", the other says "read it, and
      // choose not to judge it". Only the second stays inside completeness accounting, which is why
      // it cannot fold into the first.
      return buf;
    }

    const text = buf.toString("utf8");
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {any[]} */
    const collected = [];
    /** @param {any} h */
    const push = (h) => {
      const key = `${h.segment}\u0000${h.value}\u0000${h.reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      collected.push(h);
    };

    const views = this.viewsOf(target.path, text);
    for (const view of views) {
      /** @type {any[]} */
      const viewHits = [];
      // THE FLOOR RUNS OVER EVERY VIEW. It used to run over the raw text alone, so a declared second
      // view got the detectors and not the floor, where the hand-written scanners it replaces gave
      // both.
      this.scanFloor(locus, target.path, view.text, allow, viewHits);
      for (const detector of this.cfg.detectors) {
        runDetector(detector, {
          locus,
          relPath: target.path,
          text: view.text,
          allow,
          hits: viewHits,
        });
      }
      for (const h of viewHits) push(h);
    }

    const detect = this.cfg.detect;
    if (detect !== undefined) {
      /** @type {any[]} */
      const detectHits = [];
      try {
        detect({
          path: locus,
          targetPath: target.path,
          origin: target.origin,
          text,
          bytes: buf,
          views,
          allow,
          hit: (h) => {
            detectHits.push({ path: locus, segment: h.segment, value: h.value, reason: h.reason });
          },
          partial: (p) => this.recordPartial(locus, p),
        });
      } catch (err) {
        throw new InvocationError(
          `the field detector threw on ${locus}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      for (const h of detectHits) push(h);
    }

    for (const h of collected) hits.push(h);
    return buf;
  }

  /**
   * The completeness sink a detector writes to when it read a target but did not reach the end of
   * it.
   *
   * WHAT IT CARRIES AND WHAT IT REFUSES TO CARRY: a locus, two COUNTS, and a token from the caller's
   * OWN CLOSED TABLE. No offset, no value and no byte of the payload, because the bytes at a halt
   * are unvouched-for input and a diagnostic about a PHI leak is a PHI surface. A reason the table
   * does not declare REFUSES, which is what stops payload-derived text reaching stderr through this
   * channel. It is bounded in memory by construction: one entry per locus, and the reason set cannot
   * exceed the declared table.
   *
   * @param {string} locus
   * @param {{ bytes: number, reason: string }} p
   */
  recordPartial(locus, p) {
    if (!isPlainObject(p) || !Number.isFinite(p.bytes) || p.bytes < 0) {
      throw new Error("partial() expects { bytes: a non-negative number, reason: string }");
    }
    if (typeof p.reason !== "string" || !this.cfg.partialReasons.has(p.reason)) {
      throw new Error(
        "partial() was given a reason this scanner does not declare. Declare every reason in " +
          "`partialReasons`; the table is closed so that no text derived from a scanned file can " +
          "reach a diagnostic.",
      );
    }
    const tally = this.partials.get(locus);
    if (tally === undefined) {
      this.partials.set(locus, { objects: 1, bytes: p.bytes, reasons: new Set([p.reason]) });
    } else {
      tally.objects += 1;
      tally.bytes += p.bytes;
      tally.reasons.add(p.reason);
    }
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  /**
   * Print the hits.
   *
   * SPLIT FROM THE CLEAN LINE ON PURPOSE. Every refusal that can follow a read prints the hits
   * FIRST, so a run that is both incomplete and carrying hits prints both. The clean line is printed
   * only once every tier has passed, so it can never appear beside a refusal.
   *
   * THE FOOTER IS SCOPED TO WHAT THIS ENGINE KNOWS. It does not claim the allow-list reaches a clean
   * run for every hit, because a repo's own `detect` may raise one without consulting it at all.
   *
   * @param {any[]} hits
   */
  reportHits(hits) {
    if (hits.length === 0) return;
    /** @type {Map<string, any[]>} */
    const byPath = new Map();
    for (const h of hits) {
      const arr = byPath.get(h.path);
      if (arr) arr.push(h);
      else byPath.set(h.path, [h]);
    }
    for (const [path, group] of byPath) {
      process.stderr.write(`[phi-scan] HIT: ${path}\n`);
      for (const h of group) {
        process.stderr.write(
          `  segment=${h.segment} value=${JSON.stringify(h.value)} (${h.reason})\n`,
        );
      }
    }
    process.stderr.write(
      `[phi-scan] ${String(hits.length)} hit(s) across ${String(byPath.size)} file(s). ` +
        `The cross-cutting floor consults ${this.relAllowList()}, so a genuinely synthetic ` +
        `identifier is declared there: a token-level, reviewed declaration, or a reserved space ` +
        `declared once in \`floor\`. A hit raised by this repo's own detectors is answerable that ` +
        `way only if that detector consults the allow-list. A whole-file --allow-fixture bypass is ` +
        `recorded and then REFUSED, because a scan that never opened a file has no clean verdict ` +
        `to give about it.\n`,
    );
  }

  /**
   * Print what this run declared it would NOT judge.
   *
   * ANNOUNCED ON EVERY RUN, NEVER INFERRED FROM SILENCE. A sibling's superseded scanner announced
   * its exclusions and the engine dropped them silently; that is the same class as a dropped
   * allow-list tag. An exclusion nobody sees is an exclusion nobody reviews.
   */
  reportDeclaredSubtractions() {
    for (const p of [...this.cfg.excludedPaths].sort()) {
      process.stderr.write(
        `[phi-scan] EXCLUDED: ${p} (no verdict; routes: ${this.cfg.excludedRoutes.join(", ")})\n`,
      );
    }
    for (const p of [...this.cfg.detectorExemptPaths].sort()) {
      process.stderr.write(
        `[phi-scan] DETECTOR-EXEMPT: ${p} (read and accounted, judged by none)\n`,
      );
    }
    for (const p of this.cfg.unreadablePrefixes) {
      process.stderr.write(`[phi-scan] UNREAD PREFIX: ${p} (in scope, bytes never read)\n`);
    }
  }

  /**
   * Print the partial-read tally.
   *
   * DELIBERATELY UNCAPPED: the output is bounded by the number of LOCI rather than by anything a
   * payload can choose, so a loud file cannot bury it.
   *
   * @returns {number}
   */
  reportPartials() {
    if (this.partials.size === 0) return 0;
    for (const [path, tally] of this.partials) {
      process.stderr.write(
        `[phi-scan] PARTIAL: ${path}: a detector stopped before the end of ` +
          `${String(tally.objects)} object(s), leaving ${String(tally.bytes)} byte(s) it never ` +
          `read: ${[...tally.reasons].join("; ")}\n`,
      );
    }
    process.stderr.write(
      `[phi-scan] a detector stopped early in ${String(this.partials.size)} file(s). A result over ` +
        `an object it did not read to the end is not a clearance of that object.\n`,
    );
    return this.partials.size;
  }

  // -------------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------------

  /**
   * ===========================================================================================
   * THE EXIT CONTRACT IS THE CALLER'S, NOT THIS FILE'S. The three codes come from `exitCodes`:
   *
   *   clean   the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
   *   hits    this corpus contains something that looks like PHI. Nothing this engine RAISES takes
   *           it. A `TypeError` from `normalizeConfig` still escapes to node's own exit 1, and that
   *           is deliberate: it is a misconfigured scanner rather than a scan result, and it lands
   *           on the author's first run.
   *   refuse  every state in which the scan cannot account for something: a bad argument, a missing
   *           or unreadable allow-list, an unreadable override log, an unknown allow-list tag, an
   *           unlogged bypass, a bypass naming a path this run does not enumerate, an in-scope entry
   *           that is not a regular file, a root that is not the shape it declares, a directory the
   *           walk cannot open, a declared root that yielded nothing read, an unparseable
   *           `git diff --cached` record, an index git cannot name or names empty, an in-scope index
   *           entry that is not a regular blob, an in-scope path with no stage-0 blob, a staged
   *           unmerged path, a target whose bytes cannot be read, a DECLARED FORMAT THAT FAILED TO
   *           PARSE, a field detector that threw, and a target enumerated but never read.
   * ===========================================================================================
   *
   * @returns {number}
   */
  run() {
    const { clean: EXIT_CLEAN, hits: EXIT_HITS, refuse: EXIT_REFUSE } = this.cfg.exitCodes;

    /** @type {any} */
    let args;
    /** @type {any} */
    let allow;
    /** @type {any[]} */
    let targets;
    /** @type {Map<string, any> | null} */
    let index = null;
    try {
      args = this.parseArgs(this.cfg.argv);
      this.validateAllowFixtures(args.allowFixtures);
      // INSIDE THIS HANDLER, AND THAT PLACEMENT IS THE POINT. Outside it, a missing or unreadable
      // allow-list escaped as an uncaught throw and took node's exit 1, the HITS code.
      allow = this.loadAllowList();
      if (args.mode === "staged") targets = this.buildTargetsForStaged();
      else if (args.mode === "paths") targets = this.buildTargetsForPaths(args.paths);
      else {
        const built = this.buildTargetsForAll();
        targets = built.targets;
        index = built.index;
      }
    } catch (err) {
      if (err instanceof InvocationError) {
        process.stderr.write(`[phi-scan] ${err.message}\n`);
        return EXIT_REFUSE;
      }
      throw err;
    }

    this.reportDeclaredSubtractions();

    const allowed = new Set(args.allowFixtures.map((p) => this.normalizePath(p)));

    // ENUMERATED: the set of paths this run declared it would read.
    const enumerated = new Set(targets.map((t) => t.path));
    if (index !== null) for (const p of this.unionCandidatePaths(index)) enumerated.add(p);

    // TIER: A BYPASS MUST NAME A PATH THIS RUN ENUMERATES. Otherwise it subtracts nothing, and a
    // flag that subtracts nothing lets a developer believe a file was acknowledged when the run
    // never had it in scope. FIRES BEFORE ANY TARGET IS READ, so no hit exists for it to swallow.
    const unmatched = [...allowed].filter((p) => !enumerated.has(p));
    if (unmatched.length > 0) {
      process.stderr.write(
        `[phi-scan] --allow-fixture names ${String(unmatched.length)} path(s) this run does not ` +
          `enumerate, so the flag subtracts nothing:\n${unmatched.map((p) => `  - ${p}`).join("\n")}\n` +
          `Scan a corpus that contains the path, or drop the flag.\n`,
      );
      return EXIT_REFUSE;
    }

    /** @type {any[]} */
    const hits = [];
    /** READ: filled in only after a target's bytes have been through `scanTarget`. */
    /** @type {Set<string>} */
    const read = new Set();
    /** @type {{ path: string, absPath: string }[]} */
    const vanished = [];
    /** @type {Map<string, string>} */
    const readOids = new Map();
    const objectHash = index === null ? null : this.gitObjectHash();

    /**
     * @param {any[]} batch
     * @returns {number | null}
     */
    const sweep = (batch) => {
      for (const t of batch) {
        if (allowed.has(t.path)) continue;
        let bytes;
        try {
          bytes = this.scanTarget(t, allow, hits);
        } catch (err) {
          if (err instanceof InvocationError) {
            // HITS FOUND SO FAR ARE PRINTED BEFORE THIS REFUSAL. A fatal partway through the sweep
            // used to discard every hit found before it, so a consumer saw a refusal with no
            // indication that PHI had already been found. The refusal still wins the exit code.
            this.reportHits(hits);
            process.stderr.write(`[phi-scan] ${err.message}\n`);
            return EXIT_REFUSE;
          }
          throw err;
        }
        if (bytes === null) {
          vanished.push({ path: t.path, absPath: t.absPath ?? "" });
          continue;
        }
        read.add(t.path);
        if (objectHash !== null && t.origin === undefined) {
          const oid = this.blobOid(objectHash, bytes);
          if (oid !== null) readOids.set(t.path, oid);
        }
      }
      return null;
    };

    const walkFailure = sweep(targets);
    if (walkFailure !== null) return walkFailure;

    // THE VANISH RE-CHECK RUNS BEFORE THE UNION, AND ALL THREE HALVES ARE PRESENT OR NONE IS.
    // Tolerating an ENOENT is only defensible when the path was untracked (checked at enumeration),
    // when the error was ENOENT and nothing else (checked at the read), and when a path that has
    // REAPPEARED by the end of the sweep refuses rather than being written off. Carrying one or two
    // of the three is worse than refusing outright, which is why the default is to refuse.
    if (vanished.length > 0) {
      const back = vanished.filter((v) => v.absPath !== "" && existsSync(v.absPath));
      if (back.length > 0) {
        this.reportHits(hits);
        process.stderr.write(
          `[phi-scan] refusing the scan: ${String(back.length)} untracked target(s) vanished ` +
            `during the sweep and were present again when it ended:\n` +
            `${back.map((v) => `  - ${v.path}`).join("\n")}\n` +
            `A file that came back is a file this run did not read, not one that was never there.\n`,
        );
        return EXIT_REFUSE;
      }
      process.stderr.write(
        `[phi-scan] ${String(vanished.length)} untracked target(s) were enumerated and had gone ` +
          `by the time the sweep reached them:\n${vanished.map((v) => `  - ${v.path}`).join("\n")}\n`,
      );
    }
    const tolerated = new Set(vanished.map((v) => v.path));

    // THE UNION. It runs AFTER the walk, not instead of it, and only over the paths the walk did not
    // already read verbatim.
    if (index !== null) {
      const unionFailure = sweep(this.buildTargetsForGitIndex(index, readOids));
      if (unionFailure !== null) return unionFailure;
    }

    // Hits FIRST, so no refusal below can swallow one.
    this.reportHits(hits);
    const partialLoci = this.reportPartials();

    // THE COMPLETENESS RULE. A SET DIFFERENCE, NEVER A SIZE COMPARISON: a count counts the targets
    // that DID get read, so `n read of n targets` is exactly the arithmetic that hides which ones
    // did not.
    const unread = [...enumerated].filter((p) => !read.has(p) && !tolerated.has(p));
    if (unread.length > 0) {
      process.stderr.write(
        `[phi-scan] refusing the scan: ${String(unread.length)} target(s) were enumerated and ` +
          `never read:\n${unread.map((p) => `  - ${p}`).join("\n")}\n` +
          `A scan that did not open a file has no clean verdict to give about it. If the file is ` +
          `genuinely synthetic, declare its identifiers in ${this.relAllowList()} rather than ` +
          `withdrawing the file from the scan.\n`,
      );
      return EXIT_REFUSE;
    }

    // PER-ROOT OBSERVATION, THE SECOND COMPLETENESS TIER. `all` mode only: the other two routes are
    // scoped by argv and by the index, so a root legitimately contributes nothing to them.
    if (args.mode === "all") {
      const readPaths = [...read];
      const starved = this.cfg.scanRoots
        .filter((root) => root.require)
        .filter(
          (root) =>
            !readPaths.some(
              (p) => root.rel === "." || p === root.rel || p.startsWith(`${root.rel}/`),
            ),
        );
      if (starved.length > 0) {
        process.stderr.write(
          `[phi-scan] refusing the scan: ${String(starved.length)} declared scan root(s) yielded ` +
            `no file this run actually read:\n${starved.map((r) => `  - ${r.rel}`).join("\n")}\n` +
            `A root that contributes nothing is indistinguishable from one that was never there, ` +
            `and the whole-run floor only asks that SOMETHING was observed. Fix the root, or ` +
            `declare it \`{ rel, require: false }\`.\n`,
        );
        return EXIT_REFUSE;
      }
    }

    if (partialLoci > 0 && this.cfg.partialExit === "refuse") {
      process.stderr.write(
        `[phi-scan] refusing the scan: a detector stopped early in ${String(partialLoci)} file(s), ` +
          `and this scanner declares \`partialExit: "refuse"\`.\n`,
      );
      return EXIT_REFUSE;
    }

    if (hits.length > 0) return EXIT_HITS;

    // THE CLEAN LINE CARRIES ITS DENOMINATORS, AND DROPS THE WORD `OK` WHEN IT CANNOT EARN IT.
    // `OK` is a claim; the numbers are a measurement. Thirteen suites parse this string, and given
    // that every defect in this lineage made the gate weaker while saying nothing, a clean line that
    // cannot state what it covered is the wrong default. A run whose detector stopped partway
    // through an object has not cleared that object, so it does not get to say `OK`, the same
    // requirement two repos derived from opposite directions.
    const denominator =
      `${String(read.size)} target(s) read, ${String(enumerated.size)} enumerated, ` +
      `${String(this.cfg.detectors.length)} declared detector(s)` +
      (tolerated.size > 0 ? `, ${String(tolerated.size)} untracked target(s) gone` : "");
    if (partialLoci > 0) {
      process.stdout.write(
        `[phi-scan] no hits, over a corpus in which a detector stopped early in ` +
          `${String(partialLoci)} file(s), listed on stderr. This run is not an all-clear. ` +
          `${denominator}\n`,
      );
    } else {
      process.stdout.write(`[phi-scan] OK: no hits. ${denominator}\n`);
    }
    return EXIT_CLEAN;
  }
}

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>`: the info half of a `--raw -z` record. */
const RAW_RECORD = /^:(?:\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z]\d*)$/;

/**
 * `lstatSync` that reports a missing path as `null` rather than throwing. LSTAT, not stat, so a
 * symbolic link is seen as a link rather than as whatever it points at.
 *
 * @param {string} path
 * @returns {any}
 */
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** @param {unknown} err @returns {string | undefined} */
function errorCode(err) {
  return isPlainObject(err) && typeof (/** @type {any} */ (err).code) === "string"
    ? /** @type {any} */ (err).code
    : undefined;
}

/**
 * @param {string} value
 * @param {string} how
 * @returns {string}
 */
function fold(value, how) {
  if (how === "upper") return value.toUpperCase();
  if (how === "lower") return value.toLowerCase();
  if (how === "digits") return value.replace(/\D/g, "");
  return value;
}

/**
 * Closed-set, engine-owned description of a `Stats` kind.
 *
 * @param {any} s
 * @returns {string}
 */
function statsKind(s) {
  if (s.isSymbolicLink()) return "a symbolic link";
  if (s.isDirectory()) return "a directory";
  if (s.isFIFO()) return "a FIFO";
  if (s.isSocket()) return "a socket";
  if (s.isBlockDevice()) return "a block device";
  if (s.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * Closed-set, engine-owned description of a directory entry's kind. Nothing off the other side of a
 * link is ever recorded.
 *
 * `Dirent` and `Stats` answer the same closed set through the same predicate names, and the two
 * functions are pinned against each other by a test rather than by this comment.
 *
 * @param {any} e
 * @returns {string}
 */
function direntKind(e) {
  if (e.isSymbolicLink()) return "a symbolic link";
  if (e.isDirectory()) return "a directory";
  if (e.isFIFO()) return "a FIFO";
  if (e.isSocket()) return "a socket";
  if (e.isBlockDevice()) return "a block device";
  if (e.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * Closed-set, engine-owned description of a git file mode.
 *
 * @param {string} mode
 * @returns {string}
 */
function gitModeKind(mode) {
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
}

/**
 * Decode the string-escape sequences a TypeScript / JavaScript source literal uses.
 *
 * ONE PASS, CONSUMING `\\` AS A PAIR, so an escaped backslash cannot be re-read as the start of the
 * next escape. A template hole is replaced by a single underscore rather than erased: an underscore
 * is neither a letter nor a digit, so no detector fires on it, while erasing it would JOIN the two
 * sides of the hole into one token the source does not contain.
 *
 * `\r` and `\n` become real line terminators, which is what makes a wire payload written as a
 * one-line literal split into records at all.
 *
 * @param {string} source
 * @param {RegExp} holePattern
 * @returns {string}
 */
function decodeSourceLiterals(source, holePattern) {
  const flags = holePattern.flags.includes("g") ? holePattern.flags : `${holePattern.flags}g`;
  const holed = source.replace(new RegExp(holePattern.source, flags), "_");
  let out = "";
  for (let i = 0; i < holed.length; i += 1) {
    const c = holed[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = holed[i + 1];
    if (next === undefined) {
      out += c;
      break;
    }
    i += 1;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "0":
        out += "\0";
        break;
      case "\\":
        out += "\\";
        break;
      case "'":
      case '"':
      case "`":
        out += next;
        break;
      case "x": {
        const hex = holed.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
        } else out += next;
        break;
      }
      case "u": {
        if (holed[i + 1] === "{") {
          const end = holed.indexOf("}", i + 2);
          const hex = end < 0 ? "" : holed.slice(i + 2, end);
          if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
            const code = Number.parseInt(hex, 16);
            if (code <= 0x10ffff) {
              out += String.fromCodePoint(code);
              i = end;
              break;
            }
          }
          out += next;
          break;
        }
        const hex = holed.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else out += next;
        break;
      }
      default:
        out += next;
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Declarative detectors
// ---------------------------------------------------------------------------

/** Honorifics, suffixes and credentials that are not name evidence. */
const DEFAULT_NAME_NOISE = new Set([
  "MD",
  "DO",
  "DR",
  "MR",
  "MRS",
  "MS",
  "MISS",
  "JR",
  "SR",
  "II",
  "III",
  "IV",
  "RN",
  "NP",
  "PA",
  "PHD",
  "DDS",
  "DMD",
  "ESQ",
  "PROF",
  "FNP",
  "APRN",
]);

/**
 * @param {string} value
 * @param {Set<string>} noise
 * @returns {string[]} Uppercased tokens that could be a name.
 */
function nameTokens(value, noise) {
  /** @type {string[]} */
  const out = [];
  for (const raw of value.split(/[^\p{L}\p{M}]+/u)) {
    if (raw.length === 0) continue;
    // A single CJK ideograph is a whole name; a single Latin letter is an initial.
    if (raw.length < 2 && !/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(raw)) {
      continue;
    }
    const token = raw.toUpperCase();
    if (noise.has(token)) continue;
    out.push(token);
  }
  return out;
}

/**
 * The value rules this engine ships, keyed by the `kind` a vocabulary entry declares.
 *
 * 🛑 THE KIND SET IS DECLARED AND OPEN, AND THAT IS A CORRECTION MEASURED ACROSS THE FLEET. The
 * premise this work started from was five universal kinds, names, DOB, MRN, address, phone, with
 * only the vocabulary differing per standard. It does not survive contact: one repo has no address,
 * phone or identifier vocabulary at all; one declares no field vocabulary of any kind and is right
 * to, because its corpus is code-system content rather than patient demographics; one has no
 * address; and one has no date-of-birth detector at all, its date tags are study and acquisition
 * dates governed by a wall-clock-relative rule, so the same bytes get a different verdict next year.
 * So a repo NAMES the kinds it fills, several legitimately fill none, and the engine ships each kind
 * as a rule rather than assuming a fixed five of everyone.
 *
 * EVERY RULE RETURNS `true` WHEN THE VALUE IS A HIT.
 */
const VALUE_RULES = {
  /**
   * A person name. Tokenised on Unicode letters, noise tokens dropped, each surviving token checked
   * against the declared bucket. Tokenising is what stops a coded value, an identifier followed by
   * its display text, being read as a family name.
   */
  name: (value, allow, spec) => {
    const tokens = nameTokens(value, spec.noise ?? DEFAULT_NAME_NOISE);
    return tokens.length > 0 && tokens.some((t) => !allow[spec.bucket ?? "names"].has(t));
  },
  /**
   * A date of birth. MATCHED AGAINST A DECLARED PATTERN AND COMPARED VERBATIM.
   *
   * 🛑 IT MUST NOT NORMALISE, and that is measured rather than stylistic: one repo's allow-list
   * carries a deliberately truncated seven-digit synthetic date pinning a partial-timestamp fixture,
   * and every normalising implementation silently drops that declaration and every fixture behind
   * it. A second repo independently reported that it stores verbatim and every consumer re-derives.
   * Both are satisfied here. See also the stated limit above: there is no reserved date space, so
   * this rule can only ever be a declaration check.
   */
  dob: (value, allow, spec) => {
    const pattern = spec.pattern ?? /^\d{4,}$/;
    if (!pattern.test(value)) return false;
    return !allow[spec.bucket ?? "dobs"].has(value);
  },
  /** An identifier, gated on a declared digit-count window before the declaration is consulted. */
  id: (value, allow, spec) => {
    const digits = value.replace(/\D/g, "");
    const min = spec.minDigits ?? 6;
    const max = spec.maxDigits ?? Number.POSITIVE_INFINITY;
    if (digits.length < min || digits.length > max) return false;
    if (spec.digitsOnly === true && digits.length !== value.length) return false;
    const bucket = allow[spec.bucket ?? "ids"];
    if (bucket.has(value.toUpperCase()) || bucket.has(digits)) return false;
    return !(spec.reservedSpaces ?? []).some((s) => RESERVED_SPACES[s](value));
  },
  /** A street address line: a house number followed by a word, then the declaration. */
  address: (value, allow, spec) => {
    const trimmed = value.trim();
    if (!/^\d+\s+\p{L}/u.test(trimmed)) return false;
    return !allow[spec.bucket ?? "addresses"].has(trimmed.toLowerCase());
  },
  /** A locality name. Tokenised like a person name, checked against its own bucket. */
  city: (value, allow, spec) => {
    const tokens = nameTokens(value, spec.noise ?? DEFAULT_NAME_NOISE);
    return tokens.length > 0 && tokens.some((t) => !allow[spec.bucket ?? "cities"].has(t));
  },
  /** A postal code. */
  "postal-code": (value, allow, spec) => {
    const pattern = spec.pattern ?? /^\d{5}(?:-\d{4})?$/;
    const trimmed = value.trim();
    if (!pattern.test(trimmed)) return false;
    return !allow[spec.bucket ?? "zips"].has(trimmed);
  },
  /** A telephone number, answered by a declaration or by a declared reserved space. */
  phone: (value, allow, spec) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length < (spec.minDigits ?? 10)) return false;
    if (allow[spec.bucket ?? "phones"].has(digits)) return false;
    return !(spec.reservedSpaces ?? ["nanp-fictional"]).some((s) => RESERVED_SPACES[s](value));
  },
  /** An email address, answered by a domain, a mailbox or a reserved space. */
  email: (value, allow, spec) => {
    const lower = value.trim().toLowerCase();
    const at = lower.lastIndexOf("@");
    if (at < 0) return false;
    if (allow.emailDomains.has(lower.slice(at + 1))) return false;
    if (allow[spec.bucket ?? "emails"].has(lower)) return false;
    return !(spec.reservedSpaces ?? ["reserved-domain"]).some((s) => RESERVED_SPACES[s](value));
  },
};

/**
 * Raised by a grammar that was SELECTED for a target and could not parse it.
 *
 * 🛑 A DECLARED FORMAT THAT FAILS TO PARSE IS A REFUSAL, NEVER A DOWNGRADE TO THE FLOOR. A sibling's
 * shipped scanner falls back to the floor alone when its JSON parse throws, and `origin/main`
 * reports 0 hits at exit 0 over a FRAGMENTARY resource carrying a name, a date of birth AND a street
 * address. That is this lineage's dominant class exactly: weaker than declared, silent, exit 0. If a
 * repo declared that a path carries a format, a run that could not read that format has no verdict
 * to give about it.
 */
class FormatParseError extends Error {}

/**
 * Validate the declared detectors.
 *
 * 🛑 THE BOUNDARY, DRAWN EXPLICITLY BECAUSE IT IS THE THING THIS SURFACE COULD MOST EASILY GET
 * WRONG. What a repo may declare is: POSITIONS (a record id with a field or component index, an
 * element or attribute name, a property path), CONJUNCTIVE EQUALITY GUARDS over a sibling position,
 * a REGION bound, and a named value RULE with numeric or pattern parameters. There are no operators,
 * no arithmetic, no negation and no control flow. That is a table, and a table is reviewable in a
 * diff.
 *
 * Anything needing more than that stays a function in the repo's own `detect`, and that is not a
 * hedge: a rule keyed on the cardinality of distinct digits in an identifier, a policy cutoff on a
 * service date, a wall-clock-relative recency window, and a heuristic over the ADJACENCY of two
 * single-token components are all real, all live in shipping scanners, and all become LESS
 * reviewable written as data than written as code. A PHI detector expressed in a hand-rolled
 * expression language is harder to review than a function, and reviewability is what this gate is
 * for.
 *
 * @param {unknown} raw
 * @returns {any[]}
 */
function normalizeDetectors(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new TypeError("runPhiScan: `detectors` must be an array.");
  return raw.map((d, i) => {
    if (!isPlainObject(d)) {
      throw new TypeError(`runPhiScan: detectors[${String(i)}] must be an object.`);
    }
    const id = d.id;
    if (typeof id !== "string" || id === "") {
      throw new TypeError(`runPhiScan: detectors[${String(i)}] needs a non-empty \`id\`.`);
    }
    const grammar = d.grammar;
    if (!isPlainObject(grammar) || !Object.hasOwn(GRAMMARS, String(grammar.kind))) {
      throw new TypeError(
        `runPhiScan: detector ${id} declares grammar kind ` +
          `${JSON.stringify(isPlainObject(grammar) ? grammar.kind : grammar)}; known kinds are ` +
          `${Object.keys(GRAMMARS).join(", ")}.`,
      );
    }
    const appliesTo = normalizeAppliesTo(d.appliesTo, id);
    // A GRAMMAR THAT CAN REFUSE MUST BE SELECTIVE. Because a parse failure is now a refusal rather
    // than a downgrade, a strict grammar with no `appliesTo` would refuse on every file in the
    // corpus. So the requirement is checked at configuration time, where the author sees it.
    if (
      STRICT_GRAMMARS.has(String(grammar.kind)) &&
      appliesTo.pathSuffixes.length === 0 &&
      appliesTo.pathPrefixes.length === 0 &&
      appliesTo.contentMarker === null
    ) {
      throw new TypeError(
        `runPhiScan: detector ${id} uses the \`${String(grammar.kind)}\` grammar, which REFUSES a ` +
          `target it cannot parse, so it must declare an \`appliesTo\` that selects the targets ` +
          `carrying that format. Without one it would refuse on every file in the corpus.`,
      );
    }
    if (!Array.isArray(d.fields) || d.fields.length === 0) {
      throw new TypeError(`runPhiScan: detector ${id} must declare a non-empty \`fields\` list.`);
    }
    const fields = d.fields.map((f, j) => {
      if (!isPlainObject(f)) {
        throw new TypeError(`runPhiScan: detector ${id} field ${String(j)} must be an object.`);
      }
      if (!Object.hasOwn(VALUE_RULES, String(f.kind))) {
        throw new TypeError(
          `runPhiScan: detector ${id} field ${String(j)} declares kind ${JSON.stringify(f.kind)}; ` +
            `known kinds are ${Object.keys(VALUE_RULES).join(", ")}.`,
        );
      }
      if (f.bucket !== undefined && !ALLOW_BUCKETS.includes(String(f.bucket))) {
        throw new TypeError(
          `runPhiScan: detector ${id} field ${String(j)} names bucket ` +
            `${JSON.stringify(f.bucket)}; known buckets are ${ALLOW_BUCKETS.join(", ")}.`,
        );
      }
      for (const space of f.reservedSpaces ?? []) {
        if (!Object.hasOwn(RESERVED_SPACES, String(space))) {
          throw new TypeError(
            `runPhiScan: detector ${id} field ${String(j)} names reserved space ` +
              `${JSON.stringify(space)}; known spaces are ` +
              `${Object.keys(RESERVED_SPACES).join(", ")}.`,
          );
        }
      }
      if (f.pattern !== undefined && !(f.pattern instanceof RegExp)) {
        throw new TypeError(
          `runPhiScan: detector ${id} field ${String(j)} \`pattern\` must be a RegExp.`,
        );
      }
      for (const g of f.guard ?? []) {
        if (!isPlainObject(g) || !Array.isArray(g.oneOf) || g.oneOf.length === 0) {
          throw new TypeError(
            `runPhiScan: detector ${id} field ${String(j)} has a guard without a non-empty ` +
              `\`oneOf\`. A guard is an equality test over a sibling position and nothing else.`,
          );
        }
      }
      return {
        ...f,
        noise:
          f.noise === undefined
            ? undefined
            : new Set([...f.noise].map((t) => String(t).toUpperCase())),
      };
    });
    return { id, grammar, appliesTo, fields, regionEndsAt: d.regionEndsAt };
  });
}

/**
 * @param {unknown} raw
 * @param {string} id
 * @returns {{ pathSuffixes: string[], pathPrefixes: string[], contentMarker: RegExp | null }}
 */
function normalizeAppliesTo(raw, id) {
  /** @type {any} */
  const out = { pathSuffixes: [], pathPrefixes: [], contentMarker: null };
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    throw new TypeError(`runPhiScan: detector ${id} has a non-object \`appliesTo\`.`);
  }
  for (const key of ["pathSuffixes", "pathPrefixes"]) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key])) {
      throw new TypeError(`runPhiScan: detector ${id} \`appliesTo.${key}\` must be an array.`);
    }
    out[key] = raw[key].map((s) => String(s).toLowerCase());
  }
  if (raw.contentMarker !== undefined) {
    if (!(raw.contentMarker instanceof RegExp)) {
      throw new TypeError(
        `runPhiScan: detector ${id} \`appliesTo.contentMarker\` must be a RegExp.`,
      );
    }
    out.contentMarker = raw.contentMarker;
  }
  return out;
}

/**
 * Grammars whose parse can FAIL, and which therefore refuse rather than yielding nothing. A
 * delimited-record or element sweep cannot fail, it finds records or it does not, while a
 * structured document parse distinguishes "no records here" from "I could not read this".
 */
const STRICT_GRAMMARS = new Set(["json"]);

/**
 * The grammars this engine ships. Each turns a target's text into a stream of records, and nothing
 * else: the value rules and the guards are shared across all of them.
 *
 * `delimited-record` covers HL7 v2, X12 and ASTM, which are the same shape with different numbers:
 * a header record that DECLARES the delimiters at fixed offsets, records separated by line
 * terminators, fields by one character, components by another. One grammar serves three repos, and
 * that is the property that makes the next escape cost one pull request rather than thirteen.
 */
const GRAMMARS = {
  /**
   * @param {string} text
   * @param {any} grammar
   * @returns {any[]}
   */
  "delimited-record": (text, grammar) => {
    const stripped = text.replace(/^\ufeff/, "").replace(/^\u000b+/, "");
    const headerIds = new Set(grammar.headerRecordIds ?? ["MSH"]);
    const fallback = grammar.fallback ?? { field: "|", component: "^" };
    const idLength = grammar.recordIdLength ?? 3;
    let fieldSep = fallback.field;
    let componentSep = fallback.component;

    const lines = stripped.split(/\r\n|\r|\n/);
    for (const line of lines) {
      if (!headerIds.has(line.slice(0, idLength))) continue;
      const declared = line.charAt(grammar.fieldSeparatorOffset ?? idLength);
      // A delimiter is a punctuation character. Reading a letter, a digit or a space as one turns a
      // prose line beginning with the header's letters into a record.
      if (declared.length === 1 && !/[\p{L}\p{N}\s]/u.test(declared)) fieldSep = declared;
      const compOffset = grammar.componentSeparatorOffset;
      if (typeof compOffset === "number") {
        const c = line.charAt(compOffset);
        if (c.length === 1 && !/[\p{L}\p{N}\s]/u.test(c)) componentSep = c;
      }
      break;
    }

    /** @type {any[]} */
    const out = [];
    for (const line of lines) {
      const trimmed = line.replace(/\s+$/, "");
      if (trimmed.length < (grammar.minRecordLength ?? 4)) continue;
      const id = trimmed.slice(0, idLength);
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(id)) continue;
      // The separator must sit exactly where the format says, which is what stops an English
      // sentence whose first three letters happen to match a record id becoming a record.
      if (trimmed.charAt(idLength) !== fieldSep) continue;
      out.push({
        record: id,
        index: out.length,
        fields: trimmed.split(fieldSep).map((f) => f.split(componentSep)),
        attrs: {},
      });
    }
    return out;
  },

  /**
   * XML by local name, prefix-tolerant and entity-decoded. There is NO document model, on purpose: a
   * span-to-the-next-close regex runs away across a source file that merely MENTIONS an element in a
   * comment, which one sibling measured and then refused to ship. The cost is stated rather than
   * hidden, mixed content loses the text that sits beside a child element.
   *
   * @param {string} text
   * @returns {any[]}
   */
  xml: (text) => {
    const stripped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner) => inner);
    /** @type {any[]} */
    const out = [];
    for (const m of stripped.matchAll(/<(?:[\w.-]+:)?([A-Za-z_][\w.-]*)\b([^>]*?)(\/?)>/g)) {
      const name = (m[1] ?? "").toLowerCase();
      /** @type {Record<string, string>} */
      const attrs = {};
      for (const a of (m[2] ?? "").matchAll(
        /(?:[\w.-]+:)?([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
      )) {
        attrs[(a[1] ?? "").toLowerCase()] = decodeXmlEntities(a[2] ?? a[3] ?? "");
      }
      // The element's DIRECT text only. `[^<]*` is deliberate: an element with children yields the
      // empty string, and its children are matched on their own.
      let leaf = "";
      if (m[3] !== "/") {
        const after = stripped.slice((m.index ?? 0) + m[0].length);
        leaf = decodeXmlEntities(/^([^<]*)/.exec(after)?.[1] ?? "");
      }
      out.push({ record: name, index: out.length, fields: [[leaf]], attrs });
    }
    return out;
  },

  /**
   * JSON by property path. A record's `record` is the dotted path to the property, so a vocabulary
   * keys on STRUCTURE rather than on a bare word: `family`, `given`, `line` and `city` are ordinary
   * English and ordinary property names, and a detector keyed on the word alone fires on prose.
   *
   * A PARSE FAILURE REFUSES. See `FormatParseError`.
   *
   * @param {string} text
   * @returns {any[]}
   */
  json: (text) => {
    /** @type {unknown} */
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      throw new FormatParseError(err instanceof Error ? err.message : String(err));
    }
    /** @type {any[]} */
    const out = [];
    /**
     * @param {unknown} node
     * @param {string} path
     */
    const visit = (node, path) => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item, path);
        return;
      }
      if (!isPlainObject(node)) return;
      for (const [key, value] of Object.entries(node)) {
        const child = path === "" ? key : `${path}.${key}`;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          out.push({ record: child, index: out.length, fields: [[String(value)]], attrs: {} });
        } else {
          visit(value, child);
        }
      }
    };
    visit(doc, "");
    return out;
  },
};

/** @param {string} s @returns {string} */
function decodeXmlEntities(s) {
  return (
    s
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeCodePoint(Number.parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, d) => safeCodePoint(Number.parseInt(d, 10)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // `&amp;` LAST, so a literal ampersand is not re-read as the start of another reference.
      .replace(/&amp;/g, "&")
  );
}

/** @param {number} code @returns {string} */
function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Run one declared detector over one view of a target.
 *
 * @param {any} detector
 * @param {any} ctx
 */
function runDetector(detector, ctx) {
  const lower = ctx.relPath.toLowerCase();
  const { pathSuffixes, pathPrefixes, contentMarker } = detector.appliesTo;
  const anyPath = pathSuffixes.length === 0 && pathPrefixes.length === 0;
  const pathMatches =
    anyPath ||
    pathSuffixes.some((s) => lower.endsWith(s)) ||
    pathPrefixes.some((p) => lower.startsWith(p));
  if (!pathMatches) return;
  if (contentMarker !== null && !contentMarker.test(ctx.text)) return;

  /** @type {any[]} */
  let records;
  try {
    records = GRAMMARS[detector.grammar.kind](ctx.text, detector.grammar);
  } catch (err) {
    if (err instanceof FormatParseError) {
      throw new InvocationError(
        `refusing ${ctx.locus}: detector ${detector.id} selected it as ` +
          `\`${String(detector.grammar.kind)}\` and could not parse it (${err.message}). A run ` +
          `that could not read a format it declared has no verdict to give about that file, and ` +
          `falling back to the cross-cutting floor alone would report a fragmentary document as ` +
          `clean. Fix the file, or narrow this detector's \`appliesTo\`.`,
      );
    }
    throw err;
  }
  if (records.length === 0) return;

  // A REGION BOUND, when declared: a vocabulary entry may be restricted to the records BEFORE the
  // first record of a named kind. One repo measured that without it the same element name means a
  // patient in the header and a drug in the body, and checking both makes the gate fire on
  // purpose-built fixtures until someone turns it off.
  let limit = records.length;
  if (typeof detector.regionEndsAt === "string") {
    const end = records.findIndex((r) => r.record === detector.regionEndsAt);
    if (end >= 0) limit = end;
  }

  for (let i = 0; i < limit; i += 1) {
    const record = records[i];
    if (record === undefined) continue;
    for (const spec of detector.fields) {
      if (spec.record !== undefined && spec.record !== record.record) continue;
      if (!guardsPass(spec.guard, record)) continue;
      for (const value of valuesAt(spec, record)) {
        if (typeof value !== "string" || value.trim().length === 0) continue;
        if (VALUE_RULES[spec.kind](value, ctx.allow, spec)) {
          ctx.hits.push({
            path: ctx.locus,
            segment: spec.id ?? `${detector.id}:${record.record}`,
            value,
            reason: spec.reason ?? `${String(spec.kind)} not declared synthetic`,
          });
        }
      }
    }
  }
}

/**
 * @param {any[] | undefined} guards
 * @param {any} record
 * @returns {boolean}
 */
function guardsPass(guards, record) {
  for (const g of guards ?? []) {
    const values = valuesAt(g, record);
    if (!values.some((v) => typeof v === "string" && g.oneOf.includes(v.trim()))) return false;
  }
  return true;
}

/**
 * The values a locator names inside one record. A locator is a POSITION and nothing else: a field
 * index, a component index, or an attribute name.
 *
 * @param {any} spec
 * @param {any} record
 * @returns {any[]}
 */
function valuesAt(spec, record) {
  if (typeof spec.attr === "string") {
    const v = record.attrs?.[spec.attr.toLowerCase()];
    return typeof v === "string" ? [v] : [];
  }
  const field = record.fields?.[spec.field ?? 0];
  if (field === undefined) return [];
  if (typeof spec.component === "number") {
    const v = field[spec.component];
    return typeof v === "string" ? [v] : [];
  }
  return field;
}

/**
 * @typedef {ReturnType<typeof normalizeConfig>} NormalizedConfig
 * @typedef {{ rel: string, shape: string, walk: boolean, require: boolean }} RootSpec
 */
