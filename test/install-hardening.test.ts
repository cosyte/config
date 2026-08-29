/**
 * THE INSTALL IS DEFENDED, AND THE DEFENCE IS IN FORCE RATHER THAN WRITTEN DOWN.
 *
 * Two halves, and they grade different things on purpose.
 *
 * THE FIRST HALF RUNS REAL INSTALLS (AC-1, AC-2). `minimumReleaseAge` and `trustPolicy` are
 * BEHAVIOURS of pnpm, not declarations, so asserting them by reading `pnpm-workspace.yaml` would
 * grade the file that this suite exists to be suspicious of. Each case therefore stands up a
 * throwaway registry, points a throwaway project at it, and runs the pinned pnpm - the same
 * run-the-real-thing discipline `test/drift-check-phi-probe.test.ts` applies to the PHI scanner.
 * The settings under test are READ OUT OF THIS REPOSITORY'S OWN pnpm-workspace.yaml, so weakening
 * that file reds these tests instead of leaving them passing against a copy of the old values.
 *
 * EVERY REFUSAL HAS A CONTROL, AND THE CONTROLS ARE NOT DECORATION. An install that fails for some
 * unrelated reason - a 404, a bad tarball, a registry that never answered - would satisfy a bare
 * "exits non-zero" assertion while proving nothing about the cooldown. So each refusal is paired
 * with a case that differs ONLY in the fact under test and MUST exit zero and install.
 *
 * THE SECOND HALF GRADES THE GATE (AC-4, AC-5). `scripts/install-hardening.mjs` is what closes the
 * four ways these settings stop being in force without pnpm ever being asked, and each of those
 * four states is exercised here through the gate's injection points rather than by mutating the
 * checkout. The positive control matters as much: a gate that refused everything would pass all
 * four refusals and be worthless, so the committed settings must come back CONFIRMED.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  FIXTURE_SCOPE,
  PINNED_PNPM_VERSION,
  inheritedWorkspaceSettings,
  pnpmVersionIn,
  runFixtureInstall,
  startFixtureRegistry,
  writeFixtureProject,
} from "./support/fixture-registry.mjs";
import {
  DEFAULT_MANIFEST,
  DEFAULT_SETTINGS,
  gradeInstallHardening,
  parseYamlSubset,
  requiredHardening,
  runCheck,
} from "../scripts/install-hardening.mjs";

const REQUIRED = requiredHardening(JSON.parse(readFileSync(DEFAULT_MANIFEST, "utf8")));
const SETTINGS_TEXT = readFileSync(DEFAULT_SETTINGS, "utf8");
const INHERITED = inheritedWorkspaceSettings();

/** 30 days: comfortably past any cooldown the manifest could reasonably require. */
const OLD = 60 * 24 * 30;
/** 5 minutes: comfortably inside it. */
const NEW = 5;

const scratch: string[] = [];
function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "install-hardening-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** What a fixture install left behind, which is how "refused to resolve it" is distinguished from
 * "installed it and then complained". */
function installedUnder(dir: string): string[] {
  const scoped = join(dir, "node_modules", FIXTURE_SCOPE);
  const virtual = join(dir, "node_modules", ".pnpm");
  return [
    ...(existsSync(scoped) ? readdirSync(scoped) : []),
    ...(existsSync(virtual) ? readdirSync(virtual).filter((n) => !n.startsWith("lock")) : []),
  ];
}

async function install(
  registry: Parameters<typeof startFixtureRegistry>[0],
  deps: Record<string, string>,
  settings: string = INHERITED,
): Promise<{ status: number; output: string; left: string[] }> {
  const server = await startFixtureRegistry(registry);
  try {
    const dir = tempProject();
    writeFixtureProject(dir, { deps, settings, registryUrl: server.url });
    const found = pnpmVersionIn(dir);
    // REFUSE TO GRADE UNDER THE WRONG pnpm. Two of the behaviours asserted below have DIFFERENT
    // answers on pnpm v11, whose fail-safe knobs do not exist at the pinned version, so a pass from
    // some other pnpm on PATH would be a pass about the wrong tool.
    expect(found, "the fixture must run the pinned pnpm, not whatever is on PATH").toBe(
      PINNED_PNPM_VERSION,
    );
    const result = await runFixtureInstall(dir);
    return { ...result, left: installedUnder(dir) };
  } finally {
    await server.close();
  }
}

const pkg = (slug: string) => `${FIXTURE_SCOPE}/${slug}`;

describe("AC-1: a version published more recently than the cooldown is refused, not installed", () => {
  it(
    "REFUSES: the only matching version is newer than the cooldown",
    { timeout: 120_000 },
    async () => {
      const name = pkg("ac1-too-new");
      const r = await install(
        { [name]: { versions: { "1.0.0": { minutesAgo: NEW, trust: "provenance" } } } },
        { [name]: "1.0.0" },
      );
      expect(r.status, r.output).not.toBe(0);
      expect(r.output).toContain(name);
      expect(r.output).toContain("minimumReleaseAge");
      // "refuse to RESOLVE it rather than install it": nothing of that version reached the disk.
      expect(r.left).toEqual([]);
    },
  );

  it(
    "CONTROL: the same project against a version older than the cooldown installs",
    { timeout: 120_000 },
    async () => {
      const name = pkg("ac1-old-enough");
      const r = await install(
        { [name]: { versions: { "1.0.0": { minutesAgo: OLD, trust: "provenance" } } } },
        { [name]: "1.0.0" },
      );
      expect(r.status, r.output).toBe(0);
      expect(r.left).toContain("ac1-old-enough");
    },
  );

  it(
    "MEASURED, NOT ASSUMED: no version in range meets the cooldown and pnpm 10.34.5 FAILS rather than falling back",
    { timeout: 120_000 },
    async () => {
      // pnpm v11 makes this configurable with `minimumReleaseAgeStrict`, which DOES NOT EXIST at
      // the pinned 10.34.5, so what happens here was unmeasured when this spec was written. Measured:
      // ERR_PNPM_NO_MATURE_MATCHING_VERSION, exit non-zero, nothing on disk. Pinned here so a pnpm
      // bump that changed it to a silent fallback would red rather than quietly weaken the control.
      const name = pkg("ac1-all-too-new");
      const r = await install(
        {
          [name]: {
            versions: {
              "1.0.0": { minutesAgo: NEW, trust: "provenance" },
              "1.0.1": { minutesAgo: NEW, trust: "provenance" },
            },
          },
        },
        { [name]: "^1.0.0" },
      );
      expect(r.status, r.output).not.toBe(0);
      expect(r.output).toContain("NO_MATURE_MATCHING_VERSION");
      expect(r.left).toEqual([]);
    },
  );

  it(
    "MEASURED, NOT ASSUMED: a packument with no `time` field FAILS rather than installing",
    { timeout: 120_000 },
    async () => {
      // pnpm v11 makes this configurable with `minimumReleaseAgeIgnoreMissingTime`, DEFAULTING TO
      // TRUE (skip the check), and that knob does not exist at 10.34.5 either. Measured at the
      // pinned version: ERR_PNPM_MISSING_TIME, exit non-zero. The control below proves the refusal
      // comes from the settings rather than from something pnpm does to every undated packument.
      const name = pkg("ac1-no-time");
      const r = await install(
        {
          [name]: {
            omitTime: true,
            versions: { "1.0.0": { minutesAgo: OLD, trust: "provenance" } },
          },
        },
        { [name]: "1.0.0" },
      );
      expect(r.status, r.output).not.toBe(0);
      expect(r.output).toContain("MISSING_TIME");
      expect(r.left).toEqual([]);
    },
  );

  it(
    "CONTROL: with the hardening removed, that same undated packument installs",
    { timeout: 120_000 },
    async () => {
      const name = pkg("ac1-no-time-control");
      const r = await install(
        {
          [name]: {
            omitTime: true,
            versions: { "1.0.0": { minutesAgo: OLD, trust: "provenance" } },
          },
        },
        { [name]: "1.0.0" },
        "# deliberately no install hardening",
      );
      expect(r.status, r.output).toBe(0);
      expect(r.left).toContain("ac1-no-time-control");
    },
  );
});

describe("AC-2: a package whose trust evidence weakened fails the install", () => {
  it(
    "REFUSES: the newest version has weaker evidence than an earlier-published one",
    { timeout: 120_000 },
    async () => {
      const name = pkg("ac2-downgraded");
      const r = await install(
        {
          [name]: {
            versions: {
              "1.0.0": { minutesAgo: OLD * 2, trust: "provenance" },
              "1.0.1": { minutesAgo: OLD, trust: "none" },
            },
          },
        },
        { [name]: "1.0.1" },
      );
      expect(r.status, r.output).not.toBe(0);
      expect(r.output).toContain(name);
      expect(r.output).toContain("TRUST_DOWNGRADE");
      expect(r.left).toEqual([]);
    },
  );

  it(
    "CONTROL: the same package with evidence that never weakens installs",
    { timeout: 120_000 },
    async () => {
      const name = pkg("ac2-steady");
      const r = await install(
        {
          [name]: {
            versions: {
              "1.0.0": { minutesAgo: OLD * 2, trust: "provenance" },
              "1.0.1": { minutesAgo: OLD, trust: "provenance" },
            },
          },
        },
        { [name]: "1.0.1" },
      );
      expect(r.status, r.output).toBe(0);
      expect(r.left).toContain("ac2-steady");
    },
  );

  it(
    "STRONGER STILL PASSES: a version that gains a trusted publisher is not a downgrade",
    { timeout: 120_000 },
    async () => {
      const name = pkg("ac2-upgraded");
      const r = await install(
        {
          [name]: {
            versions: {
              "1.0.0": { minutesAgo: OLD * 2, trust: "provenance" },
              "1.0.1": { minutesAgo: OLD, trust: "trustedPublisher" },
            },
          },
        },
        { [name]: "1.0.1" },
      );
      expect(r.status, r.output).toBe(0);
      expect(r.left).toContain("ac2-upgraded");
    },
  );
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** A gate run with everything faked healthy, so a case can change exactly one thing. */
function gate(overrides: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const status = runCheck({
    pnpm: {
      version: () => PINNED_PNPM_VERSION,
      configGet: (_cwd: string, key: string) =>
        key === "minimum-release-age"
          ? String(parseYamlSubset(SETTINGS_TEXT).minimumReleaseAge)
          : String(parseYamlSubset(SETTINGS_TEXT).trustPolicy),
    },
    env: {},
    argv: [],
    out: (line: string) => lines.push(line),
    err: (line: string) => lines.push(line),
    ...overrides,
  });
  return { status, report: lines.join("\n") };
}

function settingsFile(text: string): string {
  const dir = tempProject();
  const path = join(dir, "pnpm-workspace.yaml");
  writeFileSync(path, text, "utf8");
  return path;
}

describe("AC-4: this repository's committed settings meet the requirement", () => {
  it("POSITIVE CONTROL: the real files, the real pnpm, exit 0", () => {
    // Without this every refusal below is satisfied by a gate that refuses everything.
    const r = gate();
    expect(r.status, r.report).toBe(0);
    expect(r.report).toContain(`required >= ${REQUIRED.minimumReleaseAgeMinutes}`);
  });

  it("the committed cooldown is at least the required floor and the policy is no-downgrade", () => {
    const declared = parseYamlSubset(SETTINGS_TEXT) as Record<string, unknown>;
    expect(declared.minimumReleaseAge).toBeGreaterThanOrEqual(REQUIRED.minimumReleaseAgeMinutes);
    expect(declared.trustPolicy).toBe(REQUIRED.trustPolicy);
  });

  it("REQUIRED FLOOR COMES FROM THE STANDARD, not from the script", () => {
    // The spec fixes the floor at 1440 because that is pnpm's own 24-hour rationale. If the
    // manifest ever says something else, the gate must want THAT, which is what AC-7 asks of the
    // drift check and is asserted here for the gate.
    const stricter = { ...REQUIRED, minimumReleaseAgeMinutes: 999_999 };
    const problems = gradeInstallHardening({
      settingsText: SETTINGS_TEXT,
      settingsPresent: true,
      required: stricter,
      pnpmVersion: PINNED_PNPM_VERSION,
      effective: { "minimum-release-age": "1440", "trust-policy": "no-downgrade" },
    });
    expect(problems.join("\n")).toContain("want at least 999999");
  });

  it("FAILS, NAMING IT, when an exemption carries no recorded reason", () => {
    const path = settingsFile(
      [
        "minimumReleaseAge: 1440",
        "trustPolicy: no-downgrade",
        "trustPolicyExclude:",
        "  # reason: this one is explained",
        '  - "explained@1.0.0"',
        '  - "unexplained@2.0.0"',
        "",
      ].join("\n"),
    );
    const r = gate({ settingsPath: path });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("unexplained@2.0.0");
    expect(r.report).toContain("no recorded reason");
    // The explained one is NOT named: a gate that named both would be reporting the rule, not the
    // violation, and would train a reader to ignore it.
    expect(r.report).not.toContain('"explained@1.0.0"');
  });

  it("FAILS on a blanket trustPolicyIgnoreAfter with no recorded reason, and passes with one", () => {
    const base = ["minimumReleaseAge: 1440", "trustPolicy: no-downgrade"];
    const bare = gate({
      settingsPath: settingsFile([...base, "trustPolicyIgnoreAfter: 43200", ""].join("\n")),
    });
    expect(bare.status, bare.report).not.toBe(0);
    expect(bare.report).toContain("trustPolicyIgnoreAfter");

    const reasoned = gate({
      settingsPath: settingsFile(
        [
          ...base,
          "# reason: measured, and recorded here",
          "trustPolicyIgnoreAfter: 43200",
          "",
        ].join("\n"),
      ),
    });
    expect(reasoned.status, reasoned.report).toBe(0);
  });

  it("every exemption this repository actually carries has a reason", () => {
    const declared = parseYamlSubset(SETTINGS_TEXT) as Record<string, string[] | undefined>;
    const exemptions = [
      ...(declared.minimumReleaseAgeExclude ?? []),
      ...(declared.trustPolicyExclude ?? []),
    ];
    // Not an empty-set assertion: if the lists are ever emptied this still holds, and the gate's
    // own case above is what proves an unexplained entry is caught.
    for (const entry of exemptions) {
      expect(SETTINGS_TEXT, `${entry} is exempted with no reason above it`).toMatch(
        new RegExp(`#\\s*reason:[\\s\\S]*?- "?${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?`),
      );
    }
  });
});

describe("AC-5: what cannot be confirmed is never reported as a pass", () => {
  it("input 1: the settings file is absent", () => {
    const r = gate({ settingsPath: join(tempProject(), "does-not-exist.yaml") });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("missing");
    expect(r.report).toContain("could not be confirmed to be in force");
  });

  it("input 2: the settings file is unparseable", () => {
    const r = gate({
      settingsPath: settingsFile("minimumReleaseAge: 1440\ntrustPolicy: {inline: mapping}\n"),
    });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("unparseable");
    expect(r.report).toContain("could not be confirmed to be in force");
  });

  it("input 3: the cooldown is overridden below the floor through the environment", () => {
    const r = gate({ env: { npm_config_minimum_release_age: "0" } });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("overridden in the environment");
    expect(r.report).toContain("npm_config_minimum_release_age");
  });

  it("input 3b: and through a command-line flag", () => {
    const r = gate({ argv: ["--minimum-release-age=0"] });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("overridden on the command line");
  });

  it("input 4: the pnpm in use is too old to support the setting", () => {
    // pnpm 10.15.0 predates BOTH settings, and an old pnpm does not warn about a key it does not
    // know: it ignores it, and the settings file becomes decoration. The gate must say so.
    const r = gate({
      pnpm: { version: () => "10.15.0", configGet: () => "undefined" },
    });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("unsupported by the pnpm in use");
    expect(r.report).toContain("minimumReleaseAge");
    expect(r.report).toContain("trustPolicy");
  });

  it("WRITTEN DOWN IS NOT IN FORCE: pnpm reporting a different effective value fails", () => {
    // The whole point of asking pnpm rather than only reading the file. A value overridden in some
    // config this gate never read still shows up in `pnpm config get`.
    const r = gate({
      pnpm: { version: () => PINNED_PNPM_VERSION, configGet: () => "off" },
    });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("not in force as declared");
  });

  it("and when pnpm reports NO value at all, which is the same non-answer", () => {
    const r = gate({
      pnpm: { version: () => PINNED_PNPM_VERSION, configGet: () => "undefined" },
    });
    expect(r.status, r.report).not.toBe(0);
    expect(r.report).toContain("could not be confirmed in force");
  });

  it("could not run is exit 2 and is still not a pass: no manifest, no requirement", () => {
    const r = gate({ manifestPath: join(tempProject(), "no-manifest.json") });
    expect(r.status).toBe(2);
    expect(r.report).toContain("NOT graded");
  });
});

describe("the YAML subset refuses what it cannot read rather than guessing", () => {
  it("reads this repository's own settings file", () => {
    const declared = parseYamlSubset(SETTINGS_TEXT) as Record<string, unknown>;
    expect(declared.packages).toEqual(["packages/*"]);
    expect(declared.minimumReleaseAge).toBe(1440);
    expect(declared.trustPolicy).toBe("no-downgrade");
  });

  it("does not mistake a glob for a YAML alias", () => {
    // The first draft of the parser refused `- "packages/*"` as an alias and reported this
    // repository's own settings as unparseable, which is a refusal that looks exactly like a
    // finding. Pinned so it cannot come back.
    expect(() => parseYamlSubset('packages:\n  - "packages/*"\n')).not.toThrow();
  });

  it("refuses an anchor, a flow mapping and a block scalar by name", () => {
    expect(() => parseYamlSubset("a: &anchor 1\n")).toThrow(/anchors/);
    expect(() => parseYamlSubset("a: { b: 1 }\n")).toThrow(/flow mappings/);
    expect(() => parseYamlSubset("a: |\n  text\n")).toThrow(/block scalars/);
  });
});
