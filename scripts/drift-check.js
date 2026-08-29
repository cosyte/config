// Drift check: reports how far each repo in the estate is from the baseline drift-manifest.json
// declares. Zero-dep (Node stdlib only). Run from the meta-repo root:
//   node config/scripts/drift-check.js        (or: pnpm --dir config drift)
// It resolves the meta-repo as config's parent and reads each repo as a SIBLING DIRECTORY, so a
// repo that is not checked out beside config is reported as skipped rather than graded.
//
// IT VALIDATES THE MANIFEST BEFORE IT GRADES ANYTHING, and grades nothing if that fails. A manifest
// that does not match drift-manifest.schema.json cannot say what any repo owes, and a per-repo
// verdict derived from it would be a number with no meaning behind it.
//
// TWO BASELINES, BECAUSE A TERRAFORM REPO AND A PARSER CANNOT SHARE A BUILD CONFIG. The `package`
// baseline holds the 13 @cosyte/* package repos; the `light` baseline holds the other 11 and asks
// only for the em-dash gate, one CI entry point and the security workflows. Which requirement
// applies to which repo, and where each requirement came from, is DECLARED IN THE MANIFEST rather
// than encoded here: this file is the evaluator, not the standard.
//
// NOTE: until each repo is migrated onto the standard, this is EXPECTED to report drift: that
// output IS the per-repo migration worklist, and it is not a health report.
//
// ===========================================================================
// ONE ASSERTION HERE IS A CAPABILITY PROBE, NOT A MATCHER, AND THE DISTINCTION
// IS THE WHOLE REASON IT EXISTS.
//
// Every other check in this file reads a declaration: a version range, a script
// name, a workflow filename. That works because those things ARE declarations.
// `scripts/phi-scan.ts`'s completeness rule is not: it is a BEHAVIOUR, and the
// campaign that produced it has now recorded SIX defects that lived in a prose
// carrier while the code was right every time. A regex over a scanner's source
// would grade the comment above the rule, and the sentence "the completeness
// rule is present" would then be asserted by a string.
//
// So `probePhiScanCompleteness` RUNS the scanner: it builds a throwaway git
// repository, plants a synthetic violator and a clean decoy, withdraws the
// DECOY with a logged `--allow-fixture`, and asks whether the scanner refuses
// over a target it enumerated and never read. Nothing is read out of the
// scanner's text.
//
// IT DERIVES EACH REPO'S OWN CODES RATHER THAN ASSUMING THEM. The `@cosyte/*`
// scanners deliberately do NOT agree on their exit codes, so a probe carrying
// the number 2 would be the same porting mistake it is meant to catch. The
// probe learns a repo's HITS code from a control run that produces hits and
// nothing else, and it treats only exit 0 as "reported clean", which is the one
// meaning every CI runner and git hook already branches on.
//
// AND IT CANNOT VOUCH FOR WHAT IT COULD NOT REACH. If the planted payload is
// not detected, or the bypass never gets past the repo's own override-log gate,
// the probe returns `inconclusive` rather than a verdict. `main` runs a POSITIVE
// CONTROL (the rule removed, which MUST come back `drift`) and a NEGATIVE
// CONTROL (the shipped implementation, which MUST come back `ok`) before it
// grades a single repo, and refuses to report at all if either control
// misbehaves: an assertion nobody has seen fail is indistinguishable from one
// that cannot.
//
// THE RULE NOW LIVES IN `@cosyte/script-utils/phi-scan` RATHER THAN IN THIRTEEN
// COPIES, AND WHAT THE PROBE ASKS IS UNCHANGED BECAUSE OF IT. It still RUNS a
// repo's own `scripts/phi-scan.ts`; what is new is that it PLANTS the shared
// package into the throwaway repository first, so a scanner that imports its
// machinery can resolve it. WHICH copy gets planted is what makes this an
// ADOPTION check: the controls plant this workspace's engine, and a target repo
// is graded against the version THAT repo has installed. A repo that has not
// adopted carries a self-contained scanner and needs nothing planted; one that
// HAS adopted but has no `node_modules` produces a scanner that cannot start,
// which prints no marker and lands on `inconclusive` rather than on a pass.
//
// `gradeProbeControls` IS DELIBERATELY GENERIC, and nothing in it mentions PHI.
// `phi-scan` is the first of several scripts every parser repo carries in a
// byte-distinct copy, and the next consolidation needs the same shape: run the
// real thing, break the one line that carries the property, and refuse to report
// if breaking it did not RED.
// ===========================================================================

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

import { isCliEntrypoint } from "../packages/script-utils/index.js";
import { validateManifest } from "./validate-drift-manifest.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configRoot = resolve(scriptDir, ".."); // .../config
const umbrellaRoot = resolve(configRoot, ".."); // meta-repo root
const MANIFEST_PATH = join(configRoot, "drift-manifest.json");

/**
 * The manifest, for the probe-parameter lookups below ONLY.
 *
 * IT IS READ HERE AND VALIDATED IN `runCheck`, deliberately in that order. Importing this module
 * must not throw (the probe tests import it), while GRADING must not proceed over a manifest that
 * does not validate. So the read is unconditional and cheap, and the refusal lives on the path that
 * would otherwise produce verdicts.
 */
const manifest = readJson(MANIFEST_PATH);
const TEMPLATE_SCANNER = join(configRoot, "scripts", "parser-template", "scripts", "phi-scan.ts");
const TEMPLATE_ALLOW_LIST = join(
  configRoot,
  "scripts",
  "parser-template",
  "scripts",
  "phi-allow-list.txt",
);

/**
 * The workspace copy of the package a scanner now imports its machinery from. The probe plants a
 * copy of THIS directory inside its throwaway repository, because a scanner that resolves
 * `@cosyte/script-utils/phi-scan` cannot run in a directory with no `node_modules`.
 */
const SHARED_PACKAGE = join(configRoot, "packages", "script-utils");
const SHARED_PACKAGE_SPECIFIER = "@cosyte/script-utils";
const SHARED_PHI_SCAN = join(SHARED_PACKAGE, "phi-scan.js");

/**
 * Node runs TypeScript by stripping types: required on 22, default from 23,
 * where passing the unknown flag would be a hard error rather than a skip. The
 * scanners' own shebang is `tsx`, which is a dependency of a scaffolded parser
 * and is not installed here.
 */
const STRIP =
  Number(process.versions.node.split(".")[0]) >= 23 ? [] : ["--experimental-strip-types"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cleanVersion(spec) {
  return String(spec)
    .replace(/^[\^~=>< ]+/, "")
    .trim();
}

// "5.9" matches "^5.9.3"; "10" matches "10.2.0" but not "1.0.0"; "" means presence-only.
function versionMatches(spec, want) {
  if (want === "") return true;
  const have = cleanVersion(spec).split(".");
  return want.split(".").every((part, i) => have[i] === part);
}

// ---------------------------------------------------------------------------
// The PHI-scan completeness CAPABILITY PROBE. See the block at the top of this
// file for why it is a probe and not a matcher.
// ---------------------------------------------------------------------------

/** The probe's parameters for one repo: the manifest defaults, overridden per repo. */
export function phiScanProbeSpec(name) {
  const probe = manifest.phiScanProbe ?? {};
  return { ...probe.default, ...(probe.perRepo?.[name] ?? {}) };
}

function runNode(dir, scanner, args) {
  const r = spawnSync(process.execPath, [...STRIP, "--no-warnings", scanner, ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function runGit(dir, args, input) {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8", input });
}

/**
 * Plant a copy of a shared `@cosyte/*` package inside the probe's throwaway repository, so a
 * scanner that imports its machinery by bare specifier resolves.
 *
 * A COPY RATHER THAN A SYMLINK OR AN INSTALL. An install needs a network and a lockfile the probe
 * does not have; a symlink into the source tree would let a probe run mutate the workspace. Copying
 * is also what makes the SOURCE an input: the controls plant `config`'s own working copy, so a
 * change to the engine is graded before it is published, while a target repo is graded against the
 * version THAT repo has installed, which is what "has this repo adopted the fix" actually means.
 *
 * IT IS SILENT WHEN THERE IS NOTHING TO PLANT, AND THAT FAILS SAFE. A repo that has not adopted the
 * shared engine has a self-contained scanner and needs no dependency; one that HAS adopted it but
 * has no `node_modules` produces a scanner that cannot start, which prints no marker and lands the
 * probe on `inconclusive`. Neither route can produce a pass.
 *
 * @param {string} dir The throwaway repository.
 * @param {string | undefined} from The package directory to copy, if any.
 * @param {Record<string, string> | undefined} overrides Files to rewrite after copying, keyed by
 *   the package-relative path. This is how a control weakens the SHARED half rather than the
 *   subject's own scanner.
 */
function plantSharedPackage(dir, from, overrides) {
  if (from === undefined || !existsSync(from)) return;
  const dest = join(dir, "node_modules", ...SHARED_PACKAGE_SPECIFIER.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  // `dereference` because pnpm's `node_modules` entry for a workspace package is a symlink, and a
  // copied symlink would point back out of the throwaway tree.
  cpSync(from, dest, { recursive: true, dereference: true });
  for (const [rel, text] of Object.entries(overrides ?? {})) {
    writeFileSync(join(dest, ...rel.split("/")), text, "utf8");
  }
}

/**
 * Grade a capability probe against two scenarios whose answers are known, and return a list of
 * problems (empty when both controls behaved).
 *
 * THE POSITIVE CONTROL IS THE POINT. A probe that has never been seen to RED is indistinguishable
 * from one that cannot, and this whole campaign exists because a gate that could not fail reported
 * green over an unopened corpus.
 *
 * THIS IS THE REUSABLE HALF, AND IT IS WRITTEN GENERICALLY ON PURPOSE. `phi-scan` is the first of
 * several scripts every parser repo carries in a byte-distinct copy, and the next one to be
 * consolidated will need exactly this shape: run the real thing, break the one line that carries the
 * property, and refuse to report if breaking it did not RED.
 *
 * @param {{
 *   capability: string,
 *   shipped: () => { status: string, detail: string },
 *   weakened: () => { status: string, detail: string } | null,
 *   vacuous: string,
 * }} scenarios `weakened` returns `null` when the weakening could not be applied, which makes the
 *   control VACUOUS rather than passing.
 * @returns {string[]}
 */
export function gradeProbeControls({ capability, shipped, weakened, vacuous }) {
  const problems = [];

  const negative = shipped();
  if (negative.status !== "ok") {
    problems.push(
      `NEGATIVE CONTROL (${capability}): the shipped implementation should carry the rule, got ` +
        `${negative.status}: ${negative.detail}`,
    );
  }

  const positive = weakened();
  if (positive === null) {
    problems.push(`POSITIVE CONTROL (${capability}) is vacuous: ${vacuous}`);
    return problems;
  }
  if (positive.status !== "drift") {
    problems.push(
      `POSITIVE CONTROL (${capability}): the weakened implementation should RED as drift, got ` +
        `${positive.status}: ${positive.detail}`,
    );
  }
  return problems;
}

/**
 * The override-log entry the probe writes.
 *
 * IT CARRIES BOTH SHAPES ON PURPOSE. Some siblings honour any `### <path>`
 * heading; at least two honour one only UNDER a `## Entries` heading, so that a
 * `###` in the prose above cannot become an allow entry. Writing both is what
 * lets the probe reach the completeness rule in either, and where it still
 * cannot the answer is `inconclusive`, never a pass.
 */
function overrideLog(paths) {
  const entries = paths
    .map((p) => `\n### ${p}\n\n- **Date:** capability probe\n- **Reason:** capability probe\n`)
    .join("");
  return `# PHI scan overrides\n\n## Entries\n${entries}`;
}

/**
 * Run one repo's scanner against a throwaway corpus and answer whether it
 * refuses over a target it enumerated and never read.
 *
 * Returns `{ status: "ok" | "drift" | "inconclusive", detail }`. `inconclusive`
 * is a real answer and is NOT a pass: it means this probe could not ground its
 * own premise in that repo, so the caller must not claim the rule is present.
 *
 * WHAT `ok` DOES AND DOES NOT PROVE, STATED RATHER THAN LEFT TO BE ASSUMED. It
 * proves the scanner REFUSED a run that withdrew a target it had enumerated,
 * instead of reporting on it: that is the property a caller of `phi-scan`
 * actually depends on. It does NOT prove WHICH rule produced the refusal. A
 * scanner that refuses ANY run carrying a bypass, or refuses for some unrelated
 * reason AFTER reading the violator, is graded `ok` here. (One that refuses
 * BEFORE reading anything prints no marker and lands on `inconclusive` instead,
 * which is the branch below.) NO COUNT OF HOW MANY REPOS PASS OR FAIL IS
 * WRITTEN HERE: a draft of this paragraph said "every repo in this survey
 * fails" and one already did not. Sharpening that would mean asking the scanner WHY, which means
 * matching its prose, which is the failure mode this whole probe exists to
 * avoid. So the weaker discriminator is deliberate, and the wording of every
 * verdict is kept inside what was observed.
 */
export function probePhiScanCompleteness({
  scannerSource,
  allowList,
  spec,
  sharedPackageDir,
  sharedOverrides,
}) {
  const dir = mkdtempSync(join(tmpdir(), "phi-scan-probe-"));
  try {
    const write = (rel, text) => {
      const abs = join(dir, ...rel.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text, "utf8");
    };
    write("scripts/phi-scan.ts", scannerSource);
    write("scripts/phi-allow-list.txt", allowList);
    // Untracked and unwalked, so planting the dependency cannot change what the corpus is. Written
    // BEFORE `git add -A`, or the copied package would be committed into the probe's own repository.
    write(".gitignore", "node_modules/\n");
    plantSharedPackage(dir, sharedPackageDir, sharedOverrides);
    for (const rel of spec.scaffoldFiles ?? []) write(rel, spec.clean);
    write(spec.violator, spec.payload);
    write(spec.decoy, spec.clean);
    write("phi-scan-overrides.md", overrideLog([spec.decoy]));

    // A real repository, because a sweeping scanner may legitimately refuse
    // without one. `--no-verify` because a developer box can carry a global
    // pre-commit hook, and this repository is thrown away either way.
    runGit(dir, ["init", "-q", "."]);
    runGit(dir, ["config", "user.email", "probe@example.com"]);
    runGit(dir, ["config", "user.name", "probe"]);
    runGit(dir, ["config", "commit.gpgsign", "false"]);
    runGit(dir, ["add", "-A"]);
    const committed = runGit(dir, ["commit", "-qm", "probe corpus", "--no-verify"]);
    if ((committed.status ?? -1) !== 0) {
      return {
        status: "inconclusive",
        detail: `the probe could not commit its corpus: ${(committed.stderr ?? "").trim()}`,
      };
    }

    const scanner = join(dir, "scripts", "phi-scan.ts");

    // CONTROL 1, anti-vacuity. The planted payload has to be something this
    // scanner actually finds at this path, or a clean report over it proves
    // nothing. This run ALSO teaches the probe the repo's own HITS code, which
    // is deliberately not assumed: the siblings do not agree on it.
    //
    // THE DERIVATION HAS A BOUND, AND IT FAILS SAFE. It reads this run's exit
    // code as the HITS code, which is only right if the run found hits and did
    // nothing else. A scanner that refused for some other reason IN THIS RUN
    // would have its refusal code learned as its hits code, and the graded run
    // would then be reported as `drift` when it might not be. That direction is
    // the safe one (it over-reports work, never vouches for a scanner that
    // reports clean), and no target repo is in that state today: all thirteen
    // derive the same code they use for hits.
    const hitRun = runNode(dir, scanner, [spec.violator]);
    if (hitRun.code === 0 || !hitRun.out.includes(spec.marker)) {
      return {
        status: "inconclusive",
        detail:
          `the probe's payload was not detected at ${spec.violator} (exit ${hitRun.code}), so an ` +
          `unread target cannot be told from a clean one. Give this repo its own ` +
          `phiScanProbe.perRepo entry with a fixture its scanner reads.`,
      };
    }
    const hitsCode = hitRun.code;

    // CONTROL 2: the decoy is scannable AND clean, so withdrawing it is the
    // only difference between this run and the graded one.
    const decoyRun = runNode(dir, scanner, [spec.decoy]);
    if (decoyRun.code !== 0) {
      return {
        status: "inconclusive",
        detail: `the probe's decoy ${spec.decoy} did not scan clean on its own (exit ${decoyRun.code})`,
      };
    }

    // THE GRADED RUN. Both files are named, so both are ENUMERATED; the decoy
    // is then withdrawn by a LOGGED bypass, so the run reads one of the two
    // targets it declared.
    const graded = runNode(dir, scanner, [
      spec.violator,
      spec.decoy,
      "--allow-fixture",
      spec.decoy,
    ]);

    // Did the run get PAST the repo's own override-log gate? Observed rather
    // than read off a message: a run that refused the bypass as unlogged never
    // opened the violator, so the marker is absent. Nothing here parses prose.
    if (!graded.out.includes(spec.marker)) {
      return {
        status: "inconclusive",
        detail:
          `this repo's override-log gate did not admit the probe's bypass (exit ${graded.code}), ` +
          `so the completeness rule was never reached. The probe writes both known override-log ` +
          `shapes; a third shape needs its own support here.`,
      };
    }
    if (graded.code === 0) {
      return {
        status: "drift",
        detail:
          `phi-scan reported CLEAN (exit 0) over a target it enumerated and never read ` +
          `(${spec.decoy}). A scan that did not open a file has no clean verdict about it.`,
      };
    }
    if (graded.code === hitsCode) {
      return {
        status: "drift",
        detail:
          `phi-scan reported only its HITS code (${hitsCode}) over a run that withdrew ` +
          `${spec.decoy} after enumerating it: the unread target is not refused, so the same ` +
          `argv over a corpus whose ONLY violator is withdrawn reports clean.`,
      };
    }
    return {
      status: "ok",
      detail:
        `REFUSED (exit ${graded.code}) a run that withdrew ${spec.decoy} after enumerating it, ` +
        `rather than reporting on it`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The template's scanner, with its `{{...}}` tokens substituted as the scaffolder does. */
export function templateScannerSource() {
  const tokens = {
    "{{PKG}}": "@cosyte/demo",
    "{{NAME}}": "demo",
    "{{TITLE}}": "Demo",
    "{{Pascal}}": "Demo",
  };
  let text = readFileSync(TEMPLATE_SCANNER, "utf8");
  for (const [token, value] of Object.entries(tokens)) text = text.split(token).join(value);
  return text;
}

/** The shared engine's source, as `config` currently carries it. */
export function sharedPhiScanSource() {
  return readFileSync(SHARED_PHI_SCAN, "utf8");
}

/**
 * The line whose removal removes the completeness rule, and nothing else.
 *
 * IT NOW LIVES IN THE SHARED ENGINE RATHER THAN IN THE TEMPLATE'S SCANNER, which is the whole
 * point of the consolidation: the property is implemented once. So the control weakens the PLANTED
 * COPY of the engine and leaves the subject scanner untouched, which is also the shape a target
 * repo is graded in.
 */
const COMPLETENESS_LINE = "const unread = [...enumerated].filter((p) => !read.has(p));";

/**
 * The phi-scan probe's two controls: the shipped template scanner over the shipped engine must come
 * back `ok`, and the same scanner over an engine with the completeness rule DELETED must come back
 * `drift`. The deletion is asserted to have landed, so the control cannot go vacuous if the engine
 * is reworded.
 */
export function phiScanProbeControls() {
  const spec = phiScanProbeSpec("__control__");
  const allowList = readFileSync(TEMPLATE_ALLOW_LIST, "utf8");
  const scannerSource = templateScannerSource();
  const engine = sharedPhiScanSource();

  return gradeProbeControls({
    capability: "phi-scan completeness",
    shipped: () =>
      probePhiScanCompleteness({
        scannerSource,
        allowList,
        spec,
        sharedPackageDir: SHARED_PACKAGE,
      }),
    weakened: () => {
      if (!engine.includes(COMPLETENESS_LINE)) return null;
      return probePhiScanCompleteness({
        scannerSource,
        allowList,
        spec,
        sharedPackageDir: SHARED_PACKAGE,
        sharedOverrides: {
          "phi-scan.js": engine.replace(COMPLETENESS_LINE, "const unread = [];"),
        },
      });
    },
    vacuous:
      `${SHARED_PACKAGE_SPECIFIER}/phi-scan no longer contains the line the control removes ` +
      `(${COMPLETENESS_LINE}). Re-derive it before trusting this probe.`,
  });
}

/**
 * The probe, applied to one target repo's own scanner. `null` when it has none.
 *
 * THE REPO'S OWN INSTALLED COPY OF THE SHARED PACKAGE IS WHAT GETS PLANTED, never this workspace's.
 * That is what makes the probe an ADOPTION check rather than a claim about `config`: a repo pinned
 * to a version of the engine that predates a fix is graded on the version it actually has, and a
 * repo that has not adopted at all carries a self-contained scanner and needs nothing planted.
 */
function checkRepoPhiScan(name, repoDir) {
  const scanner = join(repoDir, "scripts", "phi-scan.ts");
  const allowListPath = join(repoDir, "scripts", "phi-allow-list.txt");
  if (!existsSync(scanner)) return "scripts/phi-scan.ts: missing";
  const allowList = existsSync(allowListPath) ? readFileSync(allowListPath, "utf8") : "";
  const result = probePhiScanCompleteness({
    scannerSource: readFileSync(scanner, "utf8"),
    allowList,
    spec: phiScanProbeSpec(name),
    sharedPackageDir: join(repoDir, "node_modules", ...SHARED_PACKAGE_SPECIFIER.split("/")),
  });
  if (result.status === "ok") return null;
  return `phi-scan completeness probe (${result.status}): ${result.detail}`;
}

// ===========================================================================
// THE DECLARATIVE HALF: ONE EVALUATOR PER REQUIREMENT KIND THE MANIFEST CAN
// DECLARE.
//
// The kind names are a CLOSED SET, and the same set is spelled out in
// `drift-manifest.schema.json` under `$defs.requirements.properties`. That is
// checked by test/drift-manifest.test.ts rather than by convention, because the
// two failure modes are silent in opposite directions: a kind the schema allows
// and this table lacks is a requirement nothing grades, and a kind this table
// has and the schema forbids is an evaluator nothing can reach.
//
// WHAT LIVES WHERE. The MANIFEST says which repos owe which requirements and
// where each requirement came from. THIS FILE says how to observe one. Nothing
// here may decide that a repo is exempt, because an exemption that lives in the
// tool is an exemption nobody reading the standard can find.
// ===========================================================================

/** Read a dotted path out of a parsed JSON value. `undefined` when any step is absent. */
function dottedLookup(value, path) {
  let current = value;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Read a repo file as JSON, telling ABSENT apart from UNPARSEABLE.
 *
 * The distinction is load-bearing for `package.json`: a baseline may skip a repo that HAS no
 * package.json (genuinely greenfield), and must never skip one whose package.json is present and
 * broken, which would clear a repo by way of a syntax error.
 *
 * @param {string} path Absolute path.
 * @returns {{ present: boolean, value: unknown, error: string | null }}
 */
function readRepoJson(path) {
  if (!existsSync(path)) return { present: false, value: null, error: null };
  try {
    return { present: true, value: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (cause) {
    return { present: true, value: null, error: String(cause) };
  }
}

/**
 * Grade an agent-context doc's SHAPE, and only its shape.
 *
 * DECISION 15 WAS OVERTURNED FOR SHAPE ALONE, so this function is written so that CONTENT cannot
 * leak into a verdict even by accident: the file is reduced to two facts on its first statement,
 * the heading lines it carries and how many lines it has, and nothing else survives. Every string
 * it can emit is built from the MANIFEST's declared headings and from counts. No body line is read
 * after that reduction, none is reported, and none is asserted on.
 *
 * @param {string} text The file's contents.
 * @param {{ requiredHeadings: string[], maxLines: number }} spec The declared shape.
 * @param {string} label The repo-relative path, for the report.
 * @returns {string[]} One line per shape violation.
 */
export function gradeAgentDoc(text, spec, label) {
  // Line count follows `wc -l`: a single trailing newline terminates the last line, it does not
  // start another one.
  const lines = text.replace(/\n$/, "").split("\n");
  const headings = lines.filter((line) => /^#{1,6} /.test(line));
  const lineCount = lines.length;

  const violations = [];
  for (const wanted of spec.requiredHeadings) {
    if (!headings.some((heading) => heading.startsWith(wanted))) {
      violations.push(`${label}: missing the required section heading "${wanted}"`);
    }
  }
  if (lineCount > spec.maxLines) {
    violations.push(`${label}: ${lineCount} lines, over the declared ceiling of ${spec.maxLines}`);
  }
  return violations;
}

/**
 * The evaluators, keyed by requirement kind.
 *
 * `needsPackageJson` marks the ones that cannot be answered without a manifest to read; a repo
 * without one gets ONE line saying so rather than a line per requirement. `parameterOf` marks a key
 * that is an argument to another kind rather than a requirement in its own right, so it is neither
 * graded twice nor reported as unknown.
 */
export const REQUIREMENT_KINDS = {
  packageManagerPrefix: {
    needsPackageJson: true,
    check: ({ pkg }, want) =>
      String(pkg.packageManager ?? "").startsWith(want)
        ? []
        : [`packageManager: want ${want}.x, got ${pkg.packageManager ?? "(none)"}`],
  },
  nodeEngineMinMajor: {
    needsPackageJson: true,
    check: ({ pkg }, want) => {
      const major = Number(/(\d+)/.exec(String(pkg.engines?.node ?? ""))?.[1] ?? 0);
      return major >= want
        ? []
        : [`engines.node: want >=${want}, got "${pkg.engines?.node ?? "(none)"}"`];
    },
  },
  prettier: {
    needsPackageJson: true,
    check: ({ pkg }, want) =>
      pkg.prettier === want
        ? []
        : [`prettier: want "${want}", got ${JSON.stringify(pkg.prettier ?? null)}`],
  },
  requiredScripts: {
    needsPackageJson: true,
    check: ({ pkg }, wanted) =>
      wanted
        .filter((script) => !pkg.scripts?.[script])
        .map((script) => `scripts.${script}: missing`),
  },
  lintMustInclude: {
    needsPackageJson: true,
    check: ({ pkg }, want) =>
      pkg.scripts?.lint && !pkg.scripts.lint.includes(want)
        ? [`scripts.lint: must include ${want}`]
        : [],
  },
  devDepVersions: {
    needsPackageJson: true,
    check: ({ pkg }, wanted) => {
      const dev = pkg.devDependencies ?? {};
      const violations = [];
      for (const [depName, want] of Object.entries(wanted)) {
        const spec = dev[depName];
        if (!spec) violations.push(`devDep ${depName}: missing (want ${want || "any"})`);
        else if (!versionMatches(spec, want)) {
          violations.push(`devDep ${depName}: want ${want}.x, got ${spec}`);
        }
      }
      return violations;
    },
  },
  requiredCosyteConfigDeps: {
    needsPackageJson: true,
    check: ({ pkg }, wanted) =>
      wanted
        .filter((depName) => !(pkg.devDependencies ?? {})[depName])
        .map((depName) => `devDep ${depName}: missing`),
  },
  requiredDevDeps: {
    needsPackageJson: true,
    check: ({ pkg }, wanted) =>
      wanted
        .filter((depName) => !(pkg.devDependencies ?? {})[depName])
        .map((depName) => `devDep ${depName}: missing`),
  },
  caretAllowed: {
    needsPackageJson: true,
    // One summary line, as version 1 emitted. `caretAllowedScopes` is a PARAMETER of this rule and
    // is read from the same group: it used to be the hardcoded string "@cosyte/" in this file.
    check: ({ pkg }, allowed, requirements) => {
      const scopes = requirements.caretAllowedScopes ?? [];
      const caretPinned = Object.entries(pkg.devDependencies ?? {})
        .filter(
          ([depName, spec]) =>
            !allowed.includes(depName) &&
            !scopes.some((scope) => depName.startsWith(scope)) &&
            /^[\^~]/.test(String(spec)),
        )
        .map(([depName]) => depName);
      return caretPinned.length > 0
        ? [`exact-pin: ${caretPinned.length} devDep(s) use ^/~, ${caretPinned.join(", ")}`]
        : [];
    },
  },
  caretAllowedScopes: { parameterOf: "caretAllowed" },
  pnpmOverrides: {
    needsPackageJson: true,
    check: ({ pkg }, wanted) => {
      const overrides = pkg.pnpm?.overrides ?? {};
      return Object.entries(wanted)
        .filter(([key, want]) => overrides[key] !== want)
        .map(
          ([key, want]) =>
            `pnpm.overrides["${key}"]: want "${want}", got ${JSON.stringify(overrides[key] ?? null)}`,
        );
    },
  },
  packageJsonEquals: {
    needsPackageJson: true,
    check: ({ pkg }, wanted) =>
      Object.entries(wanted)
        .filter(
          ([pointer, want]) => JSON.stringify(dottedLookup(pkg, pointer)) !== JSON.stringify(want),
        )
        .map(
          ([pointer, want]) =>
            `package.json ${pointer}: want ${JSON.stringify(want)}, got ` +
            `${JSON.stringify(dottedLookup(pkg, pointer) ?? null)}`,
        ),
  },
  tsconfigExtends: {
    check: ({ repoDir }, want) => {
      const tsconfig = readRepoJson(join(repoDir, "tsconfig.json"));
      if (!tsconfig.present) return ["tsconfig.json: missing"];
      if (tsconfig.value === null) return [`tsconfig.json: unparseable (${tsconfig.error})`];
      return tsconfig.value.extends === want
        ? []
        : [
            `tsconfig extends: want "${want}", got ${JSON.stringify(tsconfig.value.extends ?? null)}`,
          ];
    },
  },
  jsonFileEquals: {
    check: ({ repoDir }, wanted) => {
      const violations = [];
      const reported = new Set();
      for (const { file, pointer, value } of wanted) {
        const read = readRepoJson(join(repoDir, ...file.split("/")));
        if (read.value === null) {
          if (reported.has(file)) continue;
          reported.add(file);
          violations.push(
            read.present
              ? `${file}: unparseable (${read.error}), so nothing it declares could be graded`
              : `${file}: missing, so nothing it declares could be graded`,
          );
          continue;
        }
        const got = dottedLookup(read.value, pointer);
        if (JSON.stringify(got) !== JSON.stringify(value)) {
          violations.push(
            `${file} ${pointer}: want ${JSON.stringify(value)}, got ${JSON.stringify(got ?? null)}`,
          );
        }
      }
      return violations;
    },
  },
  requiredFiles: {
    check: ({ repoDir }, wanted) =>
      wanted
        .filter((file) => !existsSync(join(repoDir, ...file.split("/"))))
        .map((file) => `${file}: missing`),
  },
  requiredWorkflows: {
    check: ({ repoDir }, wanted) => {
      const dir = join(repoDir, ".github", "workflows");
      const present = existsSync(dir) ? readdirSync(dir) : [];
      return wanted
        .filter((workflow) => !present.includes(workflow))
        .map((workflow) => `.github/workflows/${workflow}: missing`);
    },
  },
  agentDoc: {
    check: ({ repoDir }, spec) => {
      const found = spec.files.find((file) => existsSync(join(repoDir, file)));
      if (found === undefined) {
        // ONE line, naming the canonical expected path, and the run continues to the next repo.
        return [
          `${spec.files[0]}: missing (agent-context doc; ${spec.files.join(" or ")} is accepted)`,
        ];
      }
      return gradeAgentDoc(readFileSync(join(repoDir, found), "utf8"), spec, found);
    },
  },
  phiScanCapabilityProbe: {
    // The one BEHAVIOURAL check: the scanner is run, not read. See the top of file.
    check: ({ name, repoDir, probe }) => {
      const problem = probe(name, repoDir);
      return problem === null ? [] : [problem];
    },
  },
};

/**
 * Resolve a repo's directory from the name a baseline gives it, refusing anything that is not a
 * submodule PATH.
 *
 * THE ORG PROFILE REPO IS WHY THIS FUNCTION EXISTS. Its submodule NAME is `.github` and its PATH is
 * `github-profile`. This resolver joins the umbrella root with the name it is handed, and the
 * umbrella root has its own `.github/` directory, so a manifest that addressed that repo by name
 * would silently grade the umbrella's own workflows and report the answer under the repo's name.
 * The schema refuses to express such a name and this refuses to resolve one: two independent stops,
 * because the failure is silent and produces a plausible-looking verdict.
 *
 * @param {string} root The umbrella root.
 * @param {string} name The repo's `.gitmodules` path.
 * @returns {string} The repo's directory.
 */
export function repoDirFor(root, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `refusing to resolve a repo named ${JSON.stringify(name)}: repos are addressed by their ` +
        `.gitmodules PATH, and that is not one. The org profile repo is why: it is NAMED ` +
        `".github" and PATHED "github-profile", and joining the umbrella root with the name ` +
        `would grade the umbrella's own .github/ directory.`,
    );
  }
  return join(root, name);
}

/**
 * Evaluate one repo against one baseline.
 *
 * A REPO THAT IS NOT THERE IS SKIPPED WITH A REASON, NEVER COUNTED AS MATCHING. The checker reads
 * each repo as a sibling directory of `config`, so an umbrella with only some submodules checked
 * out is the ordinary case rather than an error, and the one thing it must not do is report an
 * unread repo as clean.
 *
 * @param {{ name: string, baselineName: string, baseline: any, root: string, probe: Function }} args
 * @returns {{ name: string, baseline: string, skipped: boolean, reason?: string,
 *   findings?: { group: string, line: string }[] }}
 */
export function evaluateRepo({ name, baselineName, baseline, root, probe = checkRepoPhiScan }) {
  const repoDir = repoDirFor(root, name);
  if (!existsSync(repoDir)) {
    return {
      name,
      baseline: baselineName,
      skipped: true,
      reason: `not present: no ${name}/ directory beside config, so nothing was read`,
    };
  }
  // AN EMPTY DIRECTORY IS AN UNINITIALIZED SUBMODULE, NOT A REPO THAT OWES EVERYTHING. `git
  // submodule` leaves a bare mount point behind for every submodule that is not checked out, which
  // is the umbrella's ordinary state, and grading one produces a confident list of drifts about a
  // tree nobody read. It is skipped for the same reason an absent directory is, and the reason says
  // which of the two it was.
  if (readdirSync(repoDir).length === 0) {
    return {
      name,
      baseline: baselineName,
      skipped: true,
      reason: `not checked out: ${name}/ exists but is empty (an uninitialized submodule), so nothing was read`,
    };
  }

  const pkgRead = readRepoJson(join(repoDir, "package.json"));
  if (!pkgRead.present && baseline.missingPackageJson === "skip") {
    return {
      name,
      baseline: baselineName,
      skipped: true,
      reason: "no package.json (greenfield)",
    };
  }
  const pkg = pkgRead.value;
  let pkgProblem = null;
  if (!pkgRead.present) {
    pkgProblem = "package.json: missing, so nothing that reads it could be graded";
  } else if (pkg === null) {
    pkgProblem = `package.json: unparseable (${pkgRead.error}), so nothing that reads it could be graded`;
  }

  const context = { name, repoDir, pkg, probe };
  const findings = [];
  let pkgProblemReported = false;
  for (const [groupName, group] of Object.entries(baseline.groups)) {
    for (const [kind, value] of Object.entries(group.requirements)) {
      const evaluator = REQUIREMENT_KINDS[kind];
      if (evaluator === undefined) {
        // Unreachable through the schema, which shares this kind set. Loud rather than skipped: a
        // requirement nothing grades must never read as a requirement that passed.
        throw new Error(
          `the manifest declares the requirement kind ${JSON.stringify(kind)}, which this checker ` +
            `cannot evaluate. Add it to REQUIREMENT_KINDS or remove it from the manifest.`,
        );
      }
      if (evaluator.parameterOf !== undefined) continue;
      if (evaluator.needsPackageJson && pkgProblem !== null) {
        if (!pkgProblemReported) {
          pkgProblemReported = true;
          findings.push({ group: groupName, line: pkgProblem });
        }
        continue;
      }
      for (const line of evaluator.check(context, value, group.requirements)) {
        findings.push({ group: groupName, line });
      }
    }
  }

  return { name, baseline: baselineName, skipped: false, findings };
}

/**
 * Evaluate every repo in every baseline, in manifest order.
 *
 * @param {{ manifest: any, root: string, probe?: Function }} args
 * @returns {ReturnType<typeof evaluateRepo>[]}
 */
export function gradeEstate({ manifest: subject, root, probe = checkRepoPhiScan }) {
  const results = [];
  for (const [baselineName, baseline] of Object.entries(subject.baselines)) {
    for (const name of baseline.repos) {
      results.push(evaluateRepo({ name, baselineName, baseline, root, probe }));
    }
  }
  return results;
}

/** Matching, drifted and skipped counts. Skipped is its own bucket and never joins `matching`. */
export function summarize(results) {
  return {
    total: results.length,
    matching: results.filter((r) => !r.skipped && r.findings.length === 0).length,
    drifted: results.filter((r) => !r.skipped && r.findings.length > 0).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}

/**
 * Render the report.
 *
 * IT ENDS IN A WORKLIST RATHER THAN A VERDICT. The manifest's own standing says drift is expected
 * while the migration runs, so the useful output is what each repo still owes, per repo, with the
 * requirement group that asked for it. A total is printed too, and it counts skipped repos apart
 * from matching ones so that an umbrella with three checkouts cannot read as an estate that is 88
 * percent clean.
 *
 * @param {ReturnType<typeof evaluateRepo>[]} results
 * @returns {string[]} Lines to print.
 */
export function formatReport(results) {
  const lines = [];
  const baselines = [...new Set(results.map((r) => r.baseline))];
  for (const baselineName of baselines) {
    const group = results.filter((r) => r.baseline === baselineName);
    lines.push("", `BASELINE ${baselineName} (${group.length} repo(s))`);
    for (const result of group) {
      if (result.skipped) {
        lines.push(`• ${result.name}: SKIP (${result.reason})`);
        continue;
      }
      if (result.findings.length === 0) {
        lines.push(`✓ ${result.name}: matches the ${baselineName} baseline`);
        continue;
      }
      lines.push(`✗ ${result.name}: ${result.findings.length} drift(s)`);
      for (const finding of result.findings) lines.push(`    - [${finding.group}] ${finding.line}`);
    }
  }

  const worklist = results.filter((r) => !r.skipped && r.findings.length > 0);
  lines.push("", "-".repeat(60), "WORKLIST (what each repo owes, in manifest order)");
  if (worklist.length === 0) {
    lines.push("  nothing: every repo that could be read matches its baseline");
  }
  for (const result of worklist) {
    lines.push(
      `  ${result.name} (${result.baseline} baseline): ${result.findings.length} drift(s)`,
    );
  }

  const summary = summarize(results);
  lines.push(
    "",
    `${summary.matching} matching, ${summary.drifted} with drift, ${summary.skipped} skipped, ` +
      `of ${summary.total} repo(s) named by the baselines`,
  );
  return lines;
}

/**
 * Load, validate, grade, report.
 *
 * NOTHING IS GRADED UNTIL TWO GATES PASS, and both refuse in the same way: print why, grade
 * nothing, exit 2. A manifest that does not validate cannot say what any repo owes. A phi-scan
 * probe whose controls misbehave cannot say anything about any repo either, and printing confident
 * lines underneath a broken control would be worse than printing none.
 *
 * @param {{ manifestPath?: string, root?: string, controls?: Function, probe?: Function,
 *   out?: (line: string) => void, err?: (line: string) => void }} options Injection points exist
 *   so the report can be exercised without sibling checkouts; the defaults are the real thing.
 * @returns {number} Process exit code: 0 clean, 1 drift, 2 nothing was graded.
 */
export function runCheck({
  manifestPath = MANIFEST_PATH,
  root = umbrellaRoot,
  controls = phiScanProbeControls,
  probe = checkRepoPhiScan,
  out = (line) => console.log(line),
  err = (line) => console.error(line),
} = {}) {
  const validation = validateManifest({ manifestPath });
  if (!validation.ok) {
    err("✗ the drift manifest does not validate, so nothing was graded:");
    for (const problem of validation.errors) err(`    - ${problem}`);
    return 2;
  }
  const subject = readJson(validation.manifestPath);

  const controlProblems = controls();
  if (controlProblems.length > 0) {
    err("✗ the phi-scan capability probe cannot be trusted, so nothing was graded:");
    for (const problem of controlProblems) err(`    - ${problem}`);
    return 2;
  }
  out("phi-scan capability probe: controls pass (shipped template ok, rule removed reds)");

  const results = gradeEstate({ manifest: subject, root, probe });
  for (const line of formatReport(results)) out(line);

  const summary = summarize(results);
  // A RUN THAT READ NOTHING IS NOT A CLEAN RUN. Every repo skipped means no checkout was beside
  // `config` to read, and exit 0 there would be a green produced by an absent corpus, which is the
  // failure this repo's gates are written against. It is not a refusal either, so it says which.
  if (summary.matching + summary.drifted === 0) {
    err(
      "✗ nothing was graded: no repo named by the baselines is checked out beside config, so this " +
        "run has no verdict about any of them",
    );
    return 2;
  }
  return summary.drifted > 0 ? 1 : 0;
}

// `isCliEntrypoint` is what lets the tests import the probe without running the
// whole check: importing this file used to run it, so a test could not exercise
// `probePhiScanCompleteness` at all.
if (isCliEntrypoint(import.meta.url)) {
  process.exit(runCheck());
}
