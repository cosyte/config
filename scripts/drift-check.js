// Drift check: fails when an @cosyte/* parser repo diverges from the canonical baseline.
//
// Zero-dep (Node stdlib only). Run from the meta-repo root:
//   node config/scripts/drift-check.js        (or: pnpm --dir config drift)
// It resolves the meta-repo as config's parent, reads drift-manifest.json, and checks each target
// repo's package.json / tsconfig.json / .github/workflows. Exits non-zero on any drift.
//
// NOTE: until Phases D/E migrate each parser onto the standard, this is EXPECTED to report drift:
// that output IS the per-repo migration worklist. Greenfield repos with no package.json are skipped.
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

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configRoot = resolve(scriptDir, ".."); // .../config
const umbrellaRoot = resolve(configRoot, ".."); // meta-repo root
const manifest = readJson(join(configRoot, "drift-manifest.json"));
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

function tryReadJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
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
const COMPLETENESS_LINE = "const unread = [...enumerated].filter((p) => !read.has(p) && !tolerated.has(p));";

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

function checkRepo(name) {
  const repoDir = join(umbrellaRoot, name);
  const pkg = tryReadJson(join(repoDir, "package.json"));
  if (!pkg) {
    return {
      name,
      skipped: true,
      reason: existsSync(repoDir) ? "no package.json (greenfield)" : "not present",
    };
  }

  const violations = [];
  const dev = pkg.devDependencies ?? {};

  // packageManager + Node engine
  if (!String(pkg.packageManager ?? "").startsWith(manifest.packageManagerPrefix)) {
    violations.push(
      `packageManager: want ${manifest.packageManagerPrefix}.x, got ${pkg.packageManager ?? "(none)"}`,
    );
  }
  const engineMajor = Number(/(\d+)/.exec(String(pkg.engines?.node ?? ""))?.[1] ?? 0);
  if (engineMajor < manifest.nodeEngineMinMajor) {
    violations.push(
      `engines.node: want >=${manifest.nodeEngineMinMajor}, got "${pkg.engines?.node ?? "(none)"}"`,
    );
  }

  // prettier config
  if (pkg.prettier !== manifest.prettier) {
    violations.push(
      `prettier: want "${manifest.prettier}", got ${JSON.stringify(pkg.prettier ?? null)}`,
    );
  }

  // required scripts + the --max-warnings gate
  for (const script of manifest.requiredScripts) {
    if (!pkg.scripts?.[script]) violations.push(`scripts.${script}: missing`);
  }
  if (pkg.scripts?.lint && !pkg.scripts.lint.includes(manifest.lintMustInclude)) {
    violations.push(`scripts.lint: must include ${manifest.lintMustInclude}`);
  }

  // devDep versions
  for (const [depName, want] of Object.entries(manifest.devDepVersions)) {
    const spec = dev[depName];
    if (!spec) {
      violations.push(`devDep ${depName}: missing (want ${want || "any"})`);
    } else if (!versionMatches(spec, want)) {
      violations.push(`devDep ${depName}: want ${want}.x, got ${spec}`);
    }
  }

  // shared config packages present
  for (const depName of manifest.requiredCosyteConfigDeps) {
    if (!dev[depName]) violations.push(`devDep ${depName}: missing`);
  }

  // exact pins (one summary line; @types/node and @cosyte/* may stay caret)
  const caretPinned = Object.entries(dev)
    .filter(
      ([depName, spec]) =>
        !manifest.caretAllowed.includes(depName) &&
        !depName.startsWith("@cosyte/") &&
        /^[\^~]/.test(String(spec)),
    )
    .map(([depName]) => depName);
  if (caretPinned.length > 0) {
    violations.push(
      `exact-pin: ${caretPinned.length} devDep(s) use ^/~, ${caretPinned.join(", ")}`,
    );
  }

  // canonical pnpm.overrides (Dependabot dev-dep advisory remediation, suite-wide, no per-repo drift)
  const overrides = pkg.pnpm?.overrides ?? {};
  for (const [key, want] of Object.entries(manifest.pnpmOverrides ?? {})) {
    if (overrides[key] !== want) {
      violations.push(
        `pnpm.overrides["${key}"]: want "${want}", got ${JSON.stringify(overrides[key] ?? null)}`,
      );
    }
  }

  // tsconfig extends the shared base
  const tsconfig = tryReadJson(join(repoDir, "tsconfig.json"));
  if (!tsconfig) {
    violations.push("tsconfig.json: missing");
  } else if (tsconfig.extends !== manifest.tsconfigExtends) {
    violations.push(
      `tsconfig extends: want "${manifest.tsconfigExtends}", got ${JSON.stringify(tsconfig.extends ?? null)}`,
    );
  }

  // required workflows
  const wfDir = join(repoDir, ".github", "workflows");
  const workflows = existsSync(wfDir) ? readdirSync(wfDir) : [];
  for (const workflow of manifest.requiredWorkflows) {
    if (!workflows.includes(workflow)) violations.push(`.github/workflows/${workflow}: missing`);
  }

  // The one BEHAVIOURAL check: the scanner is run, not read. See the top of file.
  const phiScan = checkRepoPhiScan(name, repoDir);
  if (phiScan !== null) violations.push(phiScan);

  return { name, violations };
}

function main() {
  // THE CONTROLS RUN FIRST, AND A BAD CONTROL STOPS THE WHOLE REPORT. A probe
  // whose positive control does not RED grades nothing, and printing thirteen
  // confident lines underneath one would be worse than printing none.
  const controlProblems = phiScanProbeControls();
  if (controlProblems.length > 0) {
    console.error("✗ the phi-scan capability probe cannot be trusted, so nothing was graded:");
    for (const problem of controlProblems) console.error(`    - ${problem}`);
    return 2;
  }
  console.log("phi-scan capability probe: controls pass (shipped template ok, rule removed reds)");

  const results = manifest.targets.map(checkRepo);

  let checked = 0;
  let drifted = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.skipped) {
      skipped += 1;
      console.log(`\n• ${result.name}: SKIP (${result.reason})`);
      continue;
    }
    checked += 1;
    if (result.violations.length === 0) {
      console.log(`\n✓ ${result.name}: matches the baseline`);
      continue;
    }
    drifted += 1;
    console.log(`\n✗ ${result.name}: ${result.violations.length} drift(s)`);
    for (const violation of result.violations) console.log(`    - ${violation}`);
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`checked ${checked} repo(s), ${drifted} with drift, ${skipped} skipped (greenfield)`);
  return drifted > 0 ? 1 : 0;
}

// `isCliEntrypoint` is what lets the tests import the probe without running the
// whole check: importing this file used to run it, so a test could not exercise
// `probePhiScanCompleteness` at all.
if (isCliEntrypoint(import.meta.url)) {
  process.exit(main());
}
