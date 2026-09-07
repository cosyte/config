/**
 * THE ZERO-WARNING LINT REQUIREMENT NOW HAS TWO ROUTES, AND THIS SUITE GRADES BOTH OF THEM.
 *
 * WHAT WAS WRONG. `drift-manifest.json` asked every package repo for the literal text
 * `--max-warnings=0` inside `scripts.lint`. A repo wired to the shared process runner cannot write
 * it: the runner's own `check` verb fails any repo whose five verb scripts are not EXACTLY the
 * delegating bodies, so one gate demanded a flag a second gate forbade it to type. The requirement
 * was unactionable for that repo, and a worklist entry nobody can action is a defect in the standard
 * rather than work owed by a repo.
 *
 * WHAT THE FIX IS. The STANDARD now declares which lint BODIES it accepts as enforcing the flag on a
 * repo's behalf, each with its own provenance. `scripts/drift-check.js` gains no runner name: which
 * bodies count, which file can switch a delegated invocation's flags off, and where in that file,
 * are all arguments read out of the manifest.
 *
 * THE THREE WAYS THIS COULD BE WRONG WITHOUT LOOKING WRONG, WHICH IS WHY EACH HAS ITS OWN CASE.
 *
 *  1. IT COULD CLEAR REPOS IT NEVER GRADED. This requirement grades all thirteen package repos, and
 *     a report that was already read cannot be un-read by a re-run. So: an UNDECLARED body is still
 *     drift, a body that merely STARTS WITH a declared one is still drift, a repo that switched the
 *     flag off through the runner's override file is still drift, and an override file that could
 *     not be parsed is reported as ungraded rather than passed.
 *  2. IT COULD BILL THE SAME ABSENCE TWICE. A repo with no `lint` script owes exactly one line, from
 *     `requiredScripts`; a repo with no readable `package.json` owes exactly the one line it owed
 *     before this change.
 *  3. THE DECLARATION COULD OUTLIVE THE RUNNER IT VOUCHES FOR. The runner lives in THIS repository,
 *     at `packages/process`, so the last block below asserts the declaration against that code
 *     rather than against the prose that describes it: if the invocation stops carrying the flag, or
 *     the runner stops refusing a consumer-edited body, this suite reds.
 *
 * Everything is graded against throwaway trees built for the case, never against whatever is checked
 * out beside `config`, and the phi-scan probe is never enabled here, so nothing in this file can
 * weaken the controls that gate the whole report.
 *
 * SECURITY / PHI: no real repository is read and every fixture written here is synthetic.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  evaluateRepo,
  formatReport,
  gradeEstate,
  lintDelegationFrom,
  runCheck,
} from "../scripts/drift-check.js";
import { DEFAULT_SCHEMA, validateManifest } from "../scripts/validate-drift-manifest.mjs";
import { checkWiring, expectedScriptBody } from "../packages/process/src/check.js";
import { OVERRIDE_FILE, OVERRIDE_KEYS, applyOverride } from "../packages/process/src/overrides.js";
import { BASELINE, DELEGATED_VERBS, toArgv } from "../packages/process/src/verbs.js";

const REPO_ROOT = process.cwd();
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-drift-manifest.mjs");
const MANIFEST_PATH = join(REPO_ROOT, "drift-manifest.json");
const RAW_MANIFEST = readFileSync(MANIFEST_PATH, "utf8");
const MANIFEST = JSON.parse(RAW_MANIFEST) as Record<string, any>;

const SCRIPTS_GROUP = MANIFEST["baselines"].package.groups.scripts;
const REQUIREMENTS = SCRIPTS_GROUP.requirements as {
  requiredScripts: string[];
  lintMustInclude: string;
  lintDelegatingBodies: {
    body: string;
    overrideFile: string;
    overrideFlagsPointer: string;
    provenance: string;
  }[];
};

/**
 * The two strings this change is about, written out here rather than read from the file under test.
 *
 * Grading a manifest against a value it owns is not grading it: the point of the literals is that
 * the standard has to still say these exact things after any later edit.
 */
const REQUIRED_FLAG = "--max-warnings=0";
const DELEGATING_BODY = "cosyte-process lint";

const DECLARATION = REQUIREMENTS.lintDelegatingBodies[0]!;

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drift-lint-delegation-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/** Write a throwaway repo beside a throwaway umbrella root. */
function makeRepo(root: string, name: string, files: Record<string, string>): string {
  const repoDir = join(root, name);
  mkdirSync(repoDir, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(repoDir, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf8");
  }
  return repoDir;
}

/**
 * A baseline holding ONLY the zero-warning requirement and its parameter.
 *
 * `requiredScripts` is deliberately left out of this one so that a case about the lint flag reads
 * only lines the lint flag produced. The cases that need the whole group say so and use it.
 */
function flagOnlyBaseline(names: string[]) {
  return {
    title: "fixture",
    provenance: "fixture",
    repos: names,
    missingPackageJson: "skip",
    groups: {
      scripts: {
        provenance: "fixture",
        requirements: {
          lintMustInclude: REQUIREMENTS.lintMustInclude,
          lintDelegatingBodies: REQUIREMENTS.lintDelegatingBodies,
        },
      },
    },
  };
}

/** The shipped `scripts` group, verbatim, for the cases about interaction between its requirements. */
function wholeScriptsGroupBaseline(names: string[], missingPackageJson = "skip") {
  return {
    title: "fixture",
    provenance: "fixture",
    repos: names,
    missingPackageJson,
    groups: { scripts: SCRIPTS_GROUP },
  };
}

type Finding = { group: string; line: string };

/** Grade one throwaway repo and hand back its findings. */
function grade(files: Record<string, string>, baseline = flagOnlyBaseline(["hl7"])): Finding[] {
  const root = tempDir();
  makeRepo(root, "hl7", files);
  const result = evaluateRepo({
    name: "hl7",
    baselineName: "package",
    baseline,
    root,
    probe: () => null,
  }) as { skipped: boolean; findings: Finding[] };
  expect(result.skipped, "the fixture was skipped, so nothing was graded").toBe(false);
  return result.findings;
}

/** A package.json body with the given lint script and nothing else that this group reads. */
function pkgWithLint(lint: string | undefined): string {
  return JSON.stringify({
    name: "@cosyte/fixture",
    scripts: lint === undefined ? {} : { lint },
  });
}

/** Write a mutated copy of the shipped manifest and hand back its path. */
function manifestFile(mutate: (draft: Record<string, any>) => void): string {
  const draft = JSON.parse(RAW_MANIFEST) as Record<string, any>;
  mutate(draft);
  // The schema is named by a relative `$schema`, so the copy has to point back at the real one.
  draft["$schema"] = DEFAULT_SCHEMA;
  const path = join(tempDir(), "drift-manifest.json");
  writeFileSync(path, JSON.stringify(draft, null, 2), "utf8");
  return path;
}

function runValidator(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The declaration under test, as a mutable draft's copy of it. */
function draftDeclaration(draft: Record<string, any>): Record<string, any> {
  return draft["baselines"].package.groups.scripts.requirements.lintDelegatingBodies[0];
}

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

const CONTROLS_PASS = () => [];
const NO_PROBE = () => null;

// ---------------------------------------------------------------------------
// The standard's own declaration.
// ---------------------------------------------------------------------------

describe("the standard declares the delegating body, with its own provenance", () => {
  it("still asks for the literal flag, unchanged, as the first of the two routes", () => {
    expect(REQUIREMENTS.lintMustInclude).toBe(REQUIRED_FLAG);
  });

  it("declares the shared runner's lint body as enforcing it", () => {
    expect(REQUIREMENTS.lintDelegatingBodies.map((entry) => entry.body)).toEqual([DELEGATING_BODY]);
  });

  it("names the runner's override file and the pointer at that verb's flag tokens", () => {
    expect(DECLARATION.overrideFile).toBe("cosyte-process.config.json");
    expect(DECLARATION.overrideFlagsPointer).toBe("lint.flags");
  });

  it("says WHERE in this repository the enforcement was read, and that the body is graded exactly", () => {
    expect(DECLARATION.provenance).toContain("packages/process/src/verbs.ts");
    expect(DECLARATION.provenance).toContain("packages/process/src/check.ts");
    expect(DECLARATION.provenance).toContain(REQUIRED_FLAG);
    // The second half of the conflict: the runner refuses a consumer-edited script body, which is
    // why a repo cannot simply append the flag and satisfy the first route.
    expect(DECLARATION.provenance).toMatch(/EXACTLY the delegating bodies/);
    expect(DECLARATION.provenance).toMatch(/prefix/i);
  });

  it("is a claim about files in THIS checkout, so every path it names is measured", () => {
    const paths = [
      ...DECLARATION.provenance.matchAll(/\b(packages\/[A-Za-z0-9/._-]+\.[a-z]+)/g),
    ].map((match) => match[1]!);
    expect(paths.length, "the provenance names no path, so it cites nothing").toBeGreaterThan(0);
    for (const path of new Set(paths)) {
      expect(() => readFileSync(join(REPO_ROOT, ...path.split("/")), "utf8"), path).not.toThrow();
    }
  });

  it("keeps the checker free of any runner name, which is where an exemption must never live", () => {
    const checker = readFileSync(join(REPO_ROOT, "scripts", "drift-check.js"), "utf8");
    const code = checker
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toContain(DELEGATING_BODY);
    expect(code).not.toContain(DECLARATION.overrideFile);
    expect(code).not.toContain(DECLARATION.overrideFlagsPointer);
  });
});

// ---------------------------------------------------------------------------
// Grading: the routes that satisfy the requirement.
// ---------------------------------------------------------------------------

describe("a repo satisfies the zero-warning requirement by either route", () => {
  it("reports nothing for a lint script carrying the literal flag", () => {
    expect(grade({ "package.json": pkgWithLint(`eslint "src/**/*.ts" ${REQUIRED_FLAG}`) })).toEqual(
      [],
    );
  });

  it("reports nothing for a declared delegating body with no override file", () => {
    expect(grade({ "package.json": pkgWithLint(DECLARATION.body) })).toEqual([]);
  });

  it("reports nothing when the override file leaves that verb's flag tokens alone", () => {
    const findings = grade({
      "package.json": pkgWithLint(DECLARATION.body),
      // Overriding only the globs is the documented common case: it does not touch the flags, so
      // the runner's own `--max-warnings=0` still runs.
      [DECLARATION.overrideFile]: JSON.stringify({
        lint: { globs: ["src/**/*.ts", "bin/**/*.ts"] },
      }),
    });
    expect(findings).toEqual([]);
  });

  it("reports nothing when the override file replaces the flags but keeps the required one", () => {
    const findings = grade({
      "package.json": pkgWithLint(DECLARATION.body),
      [DECLARATION.overrideFile]: JSON.stringify({
        lint: { flags: [REQUIRED_FLAG, "--cache"] },
      }),
    });
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Grading: the ways a repo is still drifted.
// ---------------------------------------------------------------------------

describe("a repo that neither carries the flag nor delegates is still drift", () => {
  it("reports one finding that names BOTH accepted routes", () => {
    const findings = grade({ "package.json": pkgWithLint("eslint .") });
    expect(findings.length).toBe(1);
    const line = findings[0]!.line;
    expect(line).toContain("scripts.lint");
    expect(line).toContain(REQUIRED_FLAG);
    // "Considered and not accepted" rather than "never asked": the accepted body is quoted at the
    // repo that failed to be it.
    expect(line).toContain(DELEGATING_BODY);
    expect(line).toContain('"eslint ."');
  });

  it("refuses a body that merely STARTS WITH a declared one", () => {
    // The whole point of matching the whole body: this one delegates and then swallows the exit
    // code, so it enforces nothing while reading like the accepted invocation.
    const findings = grade({ "package.json": pkgWithLint(`${DECLARATION.body} || true`) });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("|| true");
  });

  it("refuses a body that merely CONTAINS a declared one", () => {
    const findings = grade({
      "package.json": pkgWithLint(`${DECLARATION.body} && eslint --max-warnings=99 .`),
    });
    expect(findings.length).toBe(1);
  });

  it("refuses a declared body with stray whitespace, which the runner would refuse too", () => {
    expect(grade({ "package.json": pkgWithLint(` ${DECLARATION.body}`) }).length).toBe(1);
  });
});

describe("a delegating repo that switched the flag off through the runner is still drift", () => {
  it("reports the override file, the pointer and the tokens it found", () => {
    const findings = grade({
      "package.json": pkgWithLint(DECLARATION.body),
      [DECLARATION.overrideFile]: JSON.stringify({
        lint: { flags: ["--no-error-on-unmatched-pattern"] },
      }),
    });
    expect(findings.length).toBe(1);
    const line = findings[0]!.line;
    expect(line).toContain(DECLARATION.overrideFile);
    expect(line).toContain(DECLARATION.overrideFlagsPointer);
    expect(line).toContain('["--no-error-on-unmatched-pattern"]');
    expect(line).toContain(REQUIRED_FLAG);
  });

  it("reports an EMPTY flags override, which replaces the tokens with nothing", () => {
    const findings = grade({
      "package.json": pkgWithLint(DECLARATION.body),
      [DECLARATION.overrideFile]: JSON.stringify({ lint: { flags: [] } }),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("does not include");
  });

  it("says the requirement COULD NOT BE GRADED when the override file is unparseable", () => {
    const findings = grade({
      "package.json": pkgWithLint(DECLARATION.body),
      [DECLARATION.overrideFile]: "{ broken",
    });
    expect(findings.length).toBe(1);
    const line = findings[0]!.line;
    expect(line).toContain(DECLARATION.overrideFile);
    expect(line).toContain("unparseable");
    expect(line).toContain("could not be graded");
    // The repo must not read as satisfying it: a present, broken escape hatch is not an absent one.
    expect(line).not.toMatch(/matches|satisfies/);
  });

  it("says the same when the pointer holds something that is not a list of flag tokens", () => {
    const findings = grade({
      "package.json": pkgWithLint(DECLARATION.body),
      [DECLARATION.overrideFile]: JSON.stringify({ lint: { flags: REQUIRED_FLAG } }),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("not a list of flag tokens");
    expect(findings[0]!.line).toContain("could not be graded");
  });
});

// ---------------------------------------------------------------------------
// Grading: one absence is one finding.
// ---------------------------------------------------------------------------

describe("an absence is billed exactly once", () => {
  it("reports a missing lint script from requiredScripts only", () => {
    const findings = grade(
      { "package.json": pkgWithLint(undefined) },
      wholeScriptsGroupBaseline(["hl7"]),
    );
    // `scripts.lint: ` and not `scripts.lint:fix`, which is a different script and a different line.
    const aboutLint = findings.filter((finding) => /^scripts\.lint: /.test(finding.line));
    expect(aboutLint.map((finding) => finding.line)).toEqual(["scripts.lint: missing"]);
    // The rest of the group was still graded, so this is one line rather than an early return.
    expect(findings.length).toBe(REQUIREMENTS.requiredScripts.length);
  });

  it("reports an unparseable package.json as the single line it emitted before this change", () => {
    const findings = grade({ "package.json": "{ broken" }, wholeScriptsGroupBaseline(["hl7"]));
    expect(findings.map((finding) => finding.line)).toEqual([findings[0]?.line ?? ""]);
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("package.json: unparseable");
    expect(findings[0]!.line).toContain("nothing that reads it could be graded");
    expect(findings[0]!.line).not.toContain(DELEGATING_BODY);
  });

  it("reports an absent package.json the same way where the baseline evaluates one", () => {
    const findings = grade(
      { "README.md": "# fixture\n" },
      wholeScriptsGroupBaseline(["hl7"], "evaluate"),
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("package.json: missing");
    expect(findings[0]!.line).not.toContain(DELEGATING_BODY);
  });

  it("still SKIPS a package-baseline repo with no package.json, which is the policy per baseline", () => {
    const root = tempDir();
    makeRepo(root, "hl7", { "README.md": "# fixture\n" });
    const result = evaluateRepo({
      name: "hl7",
      baselineName: "package",
      baseline: wholeScriptsGroupBaseline(["hl7"]),
      root,
      probe: NO_PROBE,
    }) as { skipped: boolean; reason: string };
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("greenfield");
  });
});

// ---------------------------------------------------------------------------
// The report states the accepted set rather than leaving it to silence.
// ---------------------------------------------------------------------------

describe("the report prints the lint bodies the standard accepts as delegating", () => {
  it("prints the declared body, the flag it stands for and the override rule", () => {
    const root = tempDir();
    makeRepo(root, "hl7", { "package.json": pkgWithLint(DECLARATION.body) });
    const manifest = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    manifest["baselines"].package = flagOnlyBaseline(["hl7"]) as any;
    manifest["baselines"].light.repos = ["crew"];
    const results = gradeEstate({ manifest, root, probe: NO_PROBE });
    const report = formatReport(
      results as any,
      manifest["optionalWorkflows"],
      lintDelegationFrom(manifest),
    ).join("\n");

    expect(report).toMatch(/DELEGATING LINT BODIES .*enforcing the zero-warning flag/);
    expect(report).toContain(
      `  ${DELEGATING_BODY}: ACCEPTED as enforcing ${REQUIRED_FLAG}, matched as the WHOLE lint ` +
        `script body; a ${DECLARATION.overrideFile} that replaces ${DECLARATION.overrideFlagsPointer} ` +
        `without ${REQUIRED_FLAG} is still drift`,
    );
    // The repo that took the route produces no drift line, which is exactly why the set has to be
    // printed: silence is not evidence of a decision.
    expect(report).toContain("✓ hl7: matches the package baseline");
  });

  it("prints it from a real run too, not only from formatReport", () => {
    const io = capture();
    runCheck({
      root: tempDir(),
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(io.out.join("\n")).toContain(`  ${DELEGATING_BODY}: ACCEPTED as enforcing`);
  });

  it("reports the manifest it was POINTED AT, never the one the module imported", () => {
    const path = manifestFile((draft) => {
      draftDeclaration(draft).body = "some-other-runner lint";
    });
    const io = capture();
    runCheck({
      manifestPath: path,
      root: tempDir(),
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    const printed = io.out.join("\n");
    expect(printed).toContain("some-other-runner lint: ACCEPTED");
    expect(printed).not.toContain(`${DELEGATING_BODY}: ACCEPTED`);
  });

  it("says so plainly when a manifest declares no delegating body at all", () => {
    const manifest = JSON.parse(RAW_MANIFEST) as Record<string, any>;
    delete manifest["baselines"].package.groups.scripts.requirements.lintDelegatingBodies;
    const report = formatReport(
      [],
      manifest["optionalWorkflows"],
      lintDelegationFrom(manifest),
    ).join("\n");
    expect(report).toContain(
      "none declared: only a lint script carrying the flag itself satisfies it",
    );
  });
});

// ---------------------------------------------------------------------------
// The validator, which is what stops the declaration from being a free pass.
// ---------------------------------------------------------------------------

describe("the manifest validator grades the declaration itself", () => {
  it("exits 0 over the changed standard", () => {
    const result = validateManifest();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const cli = runValidator([]);
    expect(cli.stderr).toBe("");
    expect(cli.status).toBe(0);
  });

  it("REFUSES a declaration with no provenance, naming it", () => {
    const path = manifestFile((draft) => {
      delete draftDeclaration(draft).provenance;
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('lintDelegatingBodies[0]: missing required property "provenance"');
  });

  it("REFUSES a declaration whose provenance is a placeholder", () => {
    const path = manifestFile((draft) => {
      draftDeclaration(draft).provenance = "because";
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lintDelegatingBodies[0].provenance: want at least 40 characters");
  });

  it("REFUSES an empty delegating body, naming it", () => {
    const path = manifestFile((draft) => {
      draftDeclaration(draft).body = "";
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lintDelegatingBodies[0].body: want at least 1 characters");
  });

  it("REFUSES a blank delegating body, which would accept a script nobody could write", () => {
    const path = manifestFile((draft) => {
      draftDeclaration(draft).body = "   ";
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lintDelegatingBodies[0].body");
  });

  it("REFUSES a declaration that names no override file or pointer", () => {
    for (const key of ["overrideFile", "overrideFlagsPointer"]) {
      const path = manifestFile((draft) => {
        delete draftDeclaration(draft)[key];
      });
      const r = runValidator(["--manifest", path]);
      expect(r.status, key).toBe(1);
      expect(r.stderr, key).toContain(`missing required property "${key}"`);
    }
  });

  it("REFUSES a delegating body declared in a group that carries no zero-warning requirement", () => {
    const path = manifestFile((draft) => {
      delete draft["baselines"].package.groups.scripts.requirements.lintMustInclude;
      // The re-derivation record claims that key is carried unchanged, so removing it trips that
      // invariant too. Dropping the claim isolates the one under test.
      draft["reDerivation"].carriedUnchanged = draft["reDerivation"].carriedUnchanged.filter(
        (key: string) => key !== "lintMustInclude",
      );
      draft["reDerivation"].droppedOrChanged.push({
        was: "lintMustInclude",
        now: "removed by this fixture",
        reason: "A fixture that isolates the delegating-body invariant from the re-derivation one.",
      });
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("carries no lintMustInclude");
    expect(r.stderr).toContain(DELEGATING_BODY);
  });

  it("REFUSES the same body declared twice", () => {
    const path = manifestFile((draft) => {
      const bodies = draft["baselines"].package.groups.scripts.requirements.lintDelegatingBodies;
      bodies.push({ ...bodies[0], overrideFile: "other.config.json" });
    });
    const r = runValidator(["--manifest", path]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("is already declared as a delegating lint body at");
  });

  it("grades NO repo and exits non-zero when the declaration does not validate", () => {
    // The invariant this change must not break: a manifest that does not validate cannot say what
    // any repo owes, so drift-check reports on none of them rather than on some of them.
    const path = manifestFile((draft) => {
      delete draftDeclaration(draft).provenance;
    });
    const io = capture();
    const code = runCheck({
      manifestPath: path,
      root: REPO_ROOT,
      controls: CONTROLS_PASS,
      probe: NO_PROBE,
      out: (line: string) => io.out.push(line),
      err: (line: string) => io.err.push(line),
    });
    expect(code).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain("lintDelegatingBodies[0]");
  });
});

// ---------------------------------------------------------------------------
// The control: the declaration is tied to the runner that lives in this repository.
// ---------------------------------------------------------------------------

describe("the declaration cannot outlive the runner it vouches for", () => {
  const PROCESS_PKG = JSON.parse(
    readFileSync(join(REPO_ROOT, "packages", "process", "package.json"), "utf8"),
  ) as { bin: Record<string, string> };

  /** The declared body, read as the runner's own vocabulary rather than as a sentence. */
  const [bin, verb, ...rest] = DECLARATION.body.split(" ");

  it("names the bin THIS repository publishes, and one of that runner's delegated verbs", () => {
    expect(rest, "the declared body carries tokens the runner would not accept").toEqual([]);
    expect(Object.keys(PROCESS_PKG.bin)).toContain(bin);
    expect(DELEGATED_VERBS as readonly string[]).toContain(verb);
  });

  it("REDS if that verb's invocation here ever stops carrying the flag", () => {
    // THE POINT OF THIS FILE. The standard vouches for a runner; the runner is in this repository;
    // a change that drops the flag from its baseline must red this suite rather than leave the
    // standard clearing thirteen repos on an axis nothing downstream re-checks.
    const argv = toArgv(BASELINE[verb as keyof typeof BASELINE]);
    expect(argv).toContain(REQUIRED_FLAG);
    expect(REQUIREMENTS.lintMustInclude).toBe(REQUIRED_FLAG);
  });

  it("REDS if the runner ever stops requiring that exact script body", () => {
    // The other half of the conflict. If the runner started tolerating an edited body, a repo could
    // append the flag itself and this whole accommodation would no longer be needed.
    expect(expectedScriptBody(verb as never)).toBe(DECLARATION.body);

    const dir = tempDir();
    const scripts: Record<string, string> = {};
    for (const each of DELEGATED_VERBS) scripts[each] = expectedScriptBody(each);
    // A consumer that tried to satisfy the old literal-flag requirement by appending the flag.
    scripts[verb!] = `${DECLARATION.body} ${REQUIRED_FLAG}`;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }), "utf8");

    const violations = checkWiring(dir);
    expect(violations.join("\n")).toContain(`script "${verb}"`);
    expect(violations.join("\n")).toContain(`expected exactly: ${DECLARATION.body}`);
  });

  it("names the runner's own override file, and a pointer in the runner's own vocabulary", () => {
    expect(DECLARATION.overrideFile).toBe(OVERRIDE_FILE);
    const [overrideVerb, overrideKey, ...tail] = DECLARATION.overrideFlagsPointer.split(".");
    expect(tail).toEqual([]);
    expect(overrideVerb).toBe(verb);
    expect(OVERRIDE_KEYS).toContain(overrideKey);
  });

  it("REDS if a flags override ever stops replacing the flag tokens wholesale", () => {
    // This is why the override file is graded at all: the escape hatch is real, and a repo that
    // takes it has switched the declared enforcement off.
    const overridden = applyOverride(BASELINE[verb as keyof typeof BASELINE], {
      flags: ["--no-error-on-unmatched-pattern"],
    });
    expect(toArgv(overridden)).not.toContain(REQUIRED_FLAG);
  });
});
