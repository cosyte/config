/**
 * ASSERTS THE PREPARED `0.1.0` STATE, RATHER THAN THE AUDIT'S DESCRIPTION OF IT.
 *
 * `documentation/release-0.1.0-audit.md` says what this release will do and
 * `documentation/decisions/0002-the-0-1-0-version-line.md` says why. Neither is machine-checked by
 * being written down, and this repository has already paid for that gap twice: run 30640138565
 * (2026-07-31) was approved as a real publish and shipped none of six packages, and the hand
 * promotion of the unreleased changelog heading was documented from 2026-08-04 and then skipped in
 * the very next two releases. So every claim the audit makes that CAN be derived from the tree is
 * derived here instead of read there, and the two are asserted to agree.
 *
 * WHY THE PLAN IS READ FROM THE AUDIT AND NOT FROM `.changeset/`.
 *
 * A changeset is DELETED by the version commit, and every manifest moves off `0.0.z` in that same
 * commit. Both are properties of the tree between the changeset landing and the release owner
 * running `pnpm run version` (`RELEASING.md` step 4), not properties of the release. This suite runs
 * inside `ci.yml`'s required `verify` job and inside `release.yml`'s `preflight` job, and `publish`
 * is `needs: preflight`, so a case that only holds before that commit would make the Version
 * Packages PR unmergeable (the org rulesets record `bypass_actors: []`) and would withhold the
 * publish this preparation exists to enable. A test that cannot tell the prepared state from the
 * released state is asserting the calendar.
 *
 * The durable record of the plan is the audit's `## 6. The release plan` table, which is committed
 * and stays. The release set, the from-versions, the bump type and the target are read from there,
 * and the tree is graded against them in whichever of two states it is in:
 *
 *   * `prepared`  - every manifest below `0.1.0`, with pending changesets that carry it there.
 *   * `versioned` - every manifest at `0.1.0` or beyond, those changesets consumed.
 *
 * `RELEASE_STATE` names the state, one case pins that every package is in the SAME state (a
 * half-versioned line is the failure worth catching), and every other case asserts the invariant
 * that is meaningful in the state the tree is actually in. Nothing is skipped and no case is
 * conditionally absent: a skipped case is coverage nobody notices losing.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE.
 *
 *   * That `0.1.0` reaches the registry. Publishing is steps 4 to 6 of `RELEASING.md`, it is out of
 *     this item's scope, and nothing in this file runs `changeset version`, `changeset publish`,
 *     `npm publish` or `git tag`.
 *   * That the registry's `latest` is what the audit says. That was established by fetching npm's
 *     own `dist-tags` when the audit was taken, and the responses are deposited with the item's
 *     spec. Re-asking the network from a test would make the suite depend on egress it does not
 *     have in CI, and would grade a moving answer.
 *   * That the built `dist` of `@cosyte/process` and `@cosyte/test-utils` is behaviourally
 *     identical to the published one. Section 4 of the audit says so explicitly.
 *   * That a `0.1.0` changelog heading carries a DATE. `RELEASING.md` dates a heading from its tag
 *     by hand, after the publish job creates that tag, so `- Unreleased` and a date are each
 *     correct at a different point of one pipeline. What is asserted is that the heading exists and
 *     is one of those two forms, and that every version already SHIPPED carries its date.
 *
 * SECURITY / PHI: this suite reads only this repository's own tracked files and shells out to
 * `git` in this repository. It writes nothing and contacts nothing.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertNotes, parseChangeset, renderNotes } from "../scripts/release-notes.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");
const CHANGESET_DIR = join(REPO_ROOT, ".changeset");
const AUDIT_PATH = join(REPO_ROOT, "documentation", "release-0.1.0-audit.md");

/** The version every classified package must resolve to. The whole point of the release. */
const TARGET_VERSION = "0.1.0";

/** Built rather than written: this file is scanned by `scripts/check-no-emdash.sh` like any other. */
const EM_DASH = String.fromCharCode(0x2014);

/** `.changeset/` entries that are configuration or prose, per `scripts/changeset-guard.mjs`. */
const NOT_A_CHANGESET = new Set(["README.md", "config.json"]);

/**
 * The raw-changelog dump fingerprints `scripts/release-notes.mjs` refuses in a release body.
 *
 * Copied rather than imported because that module does not export them. `assertNotes` is called on
 * the finished body further down, which is the load-bearing check; these are used to grade the
 * AUDIT's per-package summaries, which never pass through that function.
 */
const CHANGELOG_DUMP_MARKERS = [
  { pattern: /^#\s+Changelog\s*$/m, what: "the `# Changelog` file preamble" },
  { pattern: /^##\s*\[Unreleased\]/m, what: "an `## [Unreleased]` heading" },
  { pattern: /keepachangelog\.com/i, what: "the Keep a Changelog boilerplate link" },
];

/**
 * A line asserting that a package stays on the retired pre-alpha ladder.
 *
 * Both orders are matched because the repository wrote it both ways ("stays on the
 * `0.0.x`-until-first-alpha ladder" and "follows the cosyte ladder: `0.0.x` until first alpha").
 * The window is deliberately bounded to one line: a version token and the word "ladder" sixty
 * characters apart on the same line is an assertion; the same two words in different paragraphs is
 * not, and a whole-file test would have to exempt every document that mentions the retirement.
 *
 * It is NOT a `0.0.x` substring test. Three surviving mentions describe how npm resolves a
 * caret range on a `0.0.z` version, which is still true and is not a policy claim.
 */
const LADDER_ASSERTION =
  /0\.0\.x[^\n]{0,60}?(?:ladder|until[- ]first[- ]alpha)|(?:ladder|until[- ]first[- ]alpha)[^\n]{0,60}?0\.0\.x/i;

/**
 * Files permitted to carry a ladder assertion, with the reason each one is permitted.
 *
 * A path is exempt when it equals an entry or sits under one that ends in `/`. Kept as short as it
 * can be: every entry is either a DIFFERENT set of packages or a RECORD of the retirement, and
 * neither is the repository stating a live policy about its own eight published packages.
 */
const LADDER_EXEMPT = [
  // Scaffolded parser repositories. This repository does not publish them, the template calls them
  // "not yet published to npm", and ADR 0002's scope excludes them by name. A repository with no
  // published version has nothing to settle.
  "scripts/parser-template/",
  "scripts/scaffold-parser.mjs",
  // The decision record. A record of what was retired has to name what was retired.
  "documentation/decisions/0002-the-0-1-0-version-line.md",
  // The gate that REFUSES the assertion in every published README, and the suite that proves the
  // refusal fires. `scripts/readme-check.mjs` cannot refuse a sentence without spelling it out, and
  // `test/readme-check.test.ts` cannot prove the refusal without feeding it one. Neither file
  // reaches a consumer: the root manifest is `private: true` and neither path is in any published
  // package's `files` array, so this is enforcement machinery rather than published policy text.
  "scripts/readme-check.mjs",
  "test/readme-check.test.ts",
  // This file, which carries the pattern it bans. The same self-exclusion
  // `scripts/check-no-emdash.sh` takes, for the same reason.
  "test/release-0-1-0-plan.test.ts",
];

/**
 * Run git in this repository.
 *
 * @param {string[]} args Arguments to git.
 * @returns {string} Trimmed stdout.
 */
function git(args: string[]): string {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();
}

/**
 * Order two plain semver versions.
 *
 * Needed because this suite has to say "at or beyond `0.1.0`" rather than "equal to `0.1.0`": it
 * runs on the release owner's version commit and on every commit after it, and string comparison
 * puts `0.0.10` before `0.0.9`.
 *
 * @param {string} a A plain semver version.
 * @param {string} b A plain semver version.
 * @returns {number} Negative when `a` sorts first, zero when equal, positive otherwise.
 * @example
 *   compareVersions("0.0.9", "0.1.0"); // -1
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string): number[] => {
    const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (parsed === null) throw new Error(`not a plain semver version: ${version}`);
    return [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  };
  const [left, right] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    const [x, y] = [left[i] ?? 0, right[i] ?? 0];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

interface WorkspacePackage {
  dir: string;
  name: string;
  version: string;
  files: string[];
}

/**
 * Every publishable package in the workspace, read from the manifests rather than listed here.
 *
 * A list written into a test goes stale the first time a package is added, and the audit's own
 * completeness claim is about "every publishable package", not about eight names.
 *
 * @returns {WorkspacePackage[]} One entry per publishable package, sorted by name.
 */
function publishablePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, "packages"))) {
    const manifestPath = join(REPO_ROOT, "packages", entry, "package.json");
    if (!statSync(manifestPath).isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.private === true) continue;
    found.push({
      dir: entry,
      name: manifest.name,
      version: manifest.version,
      files: manifest.files ?? [],
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

interface ChangesetFile {
  file: string;
  releases: { name: string; type: string }[];
  summary: string;
}

/**
 * Read the pending changesets.
 *
 * The frontmatter reader is the one-pair-per-line form `scripts/changeset-guard.mjs` documents as
 * the only shape changesets itself writes and the only shape any cosyte repo has committed. A case
 * below cross-checks it against `parseChangeset` from `scripts/release-notes.mjs`, so this local
 * copy cannot be quietly wrong about which packages a file bumps.
 *
 * @returns {ChangesetFile[]} One entry per pending changeset, sorted by filename.
 */
function pendingChangesets(): ChangesetFile[] {
  const files = readdirSync(CHANGESET_DIR)
    .filter((entry) => entry.endsWith(".md") && !NOT_A_CHANGESET.has(entry))
    .sort();
  return files.map((file) => {
    const contents = readFileSync(join(CHANGESET_DIR, file), "utf8");
    const match = /\s*---([^]*?)\n\s*---(\s*(?:\n|$)[^]*)/.exec(contents);
    if (match === null) throw new Error(`${file} has no frontmatter block`);
    const releases: { name: string; type: string }[] = [];
    for (const rawLine of (match[1] ?? "").split("\n")) {
      const line = rawLine.trim();
      if (line === "") continue;
      const pair = /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(\S+)\s*$/.exec(line);
      if (pair === null) throw new Error(`${file}: cannot read the frontmatter line ${line}`);
      releases.push({
        name: (pair[1] ?? pair[2] ?? pair[3] ?? "").trim(),
        type: (pair[4] ?? "").trim().replace(/^["'](.*)["']$/, "$1"),
      });
    }
    return { file, releases, summary: (match[2] ?? "").trim() };
  });
}

/**
 * Apply one changeset release type to a version, the way Changesets does.
 *
 * The `minor`-on-`0.0.z` case is the whole mechanical argument of ADR 0002: it is the only type
 * that reaches `0.1.0`, because `patch` reaches `0.0.z+1`.
 *
 * @param {string} version A semver version.
 * @param {string} type One of major, minor, patch, none.
 * @returns {string} The resolved version.
 * @example
 *   applyBump("0.0.6", "minor"); // "0.1.0"
 */
export function applyBump(version: string, type: string): string {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (parsed === null) throw new Error(`not a plain semver version: ${version}`);
  const [major, minor, patch] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  if (type === "none") return version;
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "major") return `${major + 1}.0.0`;
  throw new Error(`not a changeset release type: ${type}`);
}

/** The rank Changesets uses to pick the winning type when several changesets name one package. */
const TYPE_RANK: Record<string, number> = { none: 0, patch: 1, minor: 2, major: 3 };

/**
 * Resolve a release plan from a package set and a changeset set.
 *
 * A package no changeset names, and a package every changeset types `none`, stays exactly where it
 * is. That branch is what criterion "leave every package classified `none` at the version it
 * already has" turns on, and it has its own case below so it is not dead code in this release.
 *
 * @param {WorkspacePackage[]} packages The publishable packages.
 * @param {ChangesetFile[]} changesets The pending changesets.
 * @returns {Map<string, { from: string; type: string; to: string }>} Keyed by package name.
 * @example
 *   resolvePlan(packages, changesets).get("@cosyte/tsconfig"); // { from, type, to }
 */
export function resolvePlan(
  packages: WorkspacePackage[],
  changesets: ChangesetFile[],
): Map<string, { from: string; type: string; to: string }> {
  const winning = new Map<string, string>();
  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      const current = winning.get(release.name);
      if (current === undefined || (TYPE_RANK[release.type] ?? -1) > (TYPE_RANK[current] ?? -1)) {
        winning.set(release.name, release.type);
      }
    }
  }
  const plan = new Map<string, { from: string; type: string; to: string }>();
  for (const pkg of packages) {
    const type = winning.get(pkg.name) ?? "none";
    plan.set(pkg.name, { from: pkg.version, type, to: applyBump(pkg.version, type) });
  }
  return plan;
}

/**
 * The body of one `## ` or `### ` or `#### ` section of a markdown file.
 *
 * @param {string} text The whole file.
 * @param {RegExp} heading A pattern anchored on the heading line.
 * @returns {string | null} The section body, or `null` when the heading is absent.
 */
function sectionBody(text: string, heading: RegExp): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const level = (/^(#+)/.exec(lines[start] ?? "")?.[1] ?? "#").length;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const next = /^(#+)\s/.exec(line);
    if (next !== null && next[1].length <= level) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

/**
 * Collapse whitespace, so a comparison between two hand-wrapped copies of one paragraph is about
 * the words rather than about where the lines were broken.
 *
 * @param {string} text Any text.
 * @returns {string} The same text with runs of whitespace collapsed to one space.
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface PlanRow {
  name: string;
  from: string;
  type: string;
  to: string;
}

const AUDIT = readFileSync(AUDIT_PATH, "utf8");

/**
 * The release plan the audit committed, read out of its `## 6. The release plan` table.
 *
 * This, and not `.changeset/`, is the durable statement of what the `0.1.0` line is. The row for
 * the private root manifest reads `not in the release set` where a bump type would be, so it does
 * not match and is not a package here; a case below asserts that exclusion explicitly rather than
 * leaving it to the shape of a regular expression.
 *
 * @returns {PlanRow[]} One row per planned package, sorted by name.
 */
function auditPlan(): PlanRow[] {
  const table = sectionBody(AUDIT, /^## 6\. The release plan\s*$/);
  if (table === null) throw new Error("the audit has no `## 6. The release plan` section");
  const rows: PlanRow[] = [];
  for (const line of table.split("\n")) {
    const cells = /^\|\s*`(@[^`]+)`\s*\|\s*(\S+)\s*\|\s*`(\S+)`\s*\|\s*(\S+)\s*\|\s*$/.exec(line);
    if (cells === null) continue;
    rows.push({
      name: cells[1] ?? "",
      from: cells[2] ?? "",
      type: cells[3] ?? "",
      to: cells[4] ?? "",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The `#### <pkg>@<version>` release-summary heading in the audit.
 *
 * @param {string} name A package name.
 * @param {string} version The version it is being released at.
 * @returns {RegExp} A pattern anchored on that heading line.
 */
function summaryHeading(name: string, version: string): RegExp {
  const pkg = name.replace(/[/@-]/g, "\\$&");
  return new RegExp(`^#### \`${pkg}@${version.replace(/\./g, "\\.")}\`\\s*$`);
}

const PACKAGES = publishablePackages();
const CHANGESETS = pendingChangesets();
const PLAN = resolvePlan(PACKAGES, CHANGESETS);
const AUDIT_PLAN = auditPlan();
const PLANNED_NAMES = new Set(AUDIT_PLAN.map((row) => row.name));
const BUMPED = [...PLAN.entries()]
  .filter(([, entry]) => entry.type !== "none")
  .map(([name, entry]) => ({ name, ...entry }));

/** Every tag in this repository. Tags are `<pkg>@<version>`, created by the publish job. */
const TAGS = new Set(git(["tag", "--list"]).split("\n").filter(Boolean));

/**
 * The versions of one package this repository has tagged.
 *
 * `RELEASING.md`: the tag-and-release step asks the REGISTRY whether each package is there and
 * creates `<pkg>@<version>` afterwards, so a tag is this repository's own record that a version
 * shipped. That is the signal this suite uses to tell settled history from a prepared release.
 *
 * @param {string} name A package name.
 * @returns {string[]} Its tagged versions, ascending.
 */
function taggedVersions(name: string): string[] {
  const prefix = `${name}@`;
  return [...TAGS]
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .sort(compareVersions);
}

/**
 * Which side of the version commit this tree is on, for one package.
 *
 * @param {string} version A manifest version.
 * @returns {"prepared" | "versioned"} `prepared` below the target line, `versioned` at or past it.
 */
function stateOf(version: string): "prepared" | "versioned" {
  return compareVersions(version, TARGET_VERSION) < 0 ? "prepared" : "versioned";
}

const STATES = new Set(PACKAGES.map((pkg) => stateOf(pkg.version)));
const RELEASE_STATE: "prepared" | "versioned" = STATES.has("prepared") ? "prepared" : "versioned";

/**
 * One package's changelog.
 *
 * @param {string} name A package name.
 * @returns {string} The file contents.
 */
function changelogOf(name: string): string {
  const pkg = PACKAGES.find((entry) => entry.name === name);
  if (pkg === undefined) throw new Error(`no publishable package named ${name}`);
  return readFileSync(join(REPO_ROOT, "packages", pkg.dir, "CHANGELOG.md"), "utf8");
}

describe("the 0.1.0 release line, as the audit committed it", () => {
  it("plans exactly the publishable packages in this workspace, and no phantom", () => {
    // Both directions. A row the workspace does not have is a plan for nothing; a package the plan
    // omits is the completeness claim of criteria 1 and 4 failing. Adding a ninth publishable
    // package is a change to the release set and has to be reflected here, which is a documentation
    // edit and never blocks the release pipeline.
    expect(AUDIT_PLAN.length, "the audit's plan table parsed to no rows").toBeGreaterThan(0);
    expect(AUDIT_PLAN.map((row) => row.name)).toEqual(PACKAGES.map((pkg) => pkg.name));
  });

  it("puts every one of them at exactly 0.1.0, reached by minor and unreachable by patch", () => {
    // ADR 0002's mechanical claim, asserted rather than quoted, against the from-versions the audit
    // RECORDED. Those do not move when the version commit lands; the manifests do, which is why the
    // claim is not re-derived from them.
    for (const row of AUDIT_PLAN) {
      expect(row.to, `${row.name} is not planned at ${TARGET_VERSION}`).toBe(TARGET_VERSION);
      expect(row.type, `${row.name} is not planned as a minor`).toBe("minor");
      expect(applyBump(row.from, row.type)).toBe(TARGET_VERSION);
      expect(applyBump(row.from, "patch")).not.toBe(TARGET_VERSION);
    }
  });

  it("excludes the private root manifest by name", () => {
    expect([...PLANNED_NAMES]).not.toContain("cosyte-config");
    const table = sectionBody(AUDIT, /^## 6\. The release plan\s*$/) ?? "";
    expect(table).toMatch(/`cosyte-config`[^\n]*not in the release set/);
  });

  it("is audited for every publishable package, none omitted", () => {
    const audited = sectionBody(AUDIT, /^## 3\. Per-package audit\s*$/) ?? "";
    for (const pkg of PACKAGES) {
      expect(audited, `${pkg.name} is not in the per-package audit`).toContain(`\`${pkg.name}\``);
    }
  });

  it("states the engine floor of every package that has one, and names every package with none", () => {
    // Section 4 certifies the declared surface, and engine floors are part of it. The count of
    // packages WITHOUT a floor is the kind of fact nobody re-derives by hand, and this audit got it
    // wrong once ("the other four declare no `engines` block" when five declare none). So the
    // paragraph is graded against the manifests: every package is named in it, and every package
    // that declares a floor has that exact floor written out.
    const section = sectionBody(AUDIT, /^## 4\. Public API stability certification\s*$/) ?? "";
    const paragraph = /\*\*Engine floors[^]*?(?=\n\n|$)/.exec(section)?.[0] ?? "";
    expect(paragraph, "the certification has no engine-floor paragraph").not.toBe("");
    for (const pkg of PACKAGES) {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "packages", pkg.dir, "package.json"), "utf8"),
      );
      expect(paragraph, `${pkg.name} is not named in the engine-floor paragraph`).toContain(
        `\`${pkg.name}\``,
      );
      const floor: string | undefined = manifest.engines?.node;
      if (floor === undefined) continue;
      expect(
        paragraph,
        `${pkg.name} declares node ${floor} and the audit does not say so`,
      ).toContain(`node ${floor}`);
    }
  });

  it("moves as one line: no package is versioned while another is still prepared", () => {
    // The failure this catches is a half-applied version commit, which would leave the eight
    // packages on two different lines. It is also what makes every state-aware case below sound:
    // each reads `RELEASE_STATE`, and a mixed tree has no single answer.
    const inventory = PACKAGES.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ");
    expect([...STATES], `packages are split across release states: ${inventory}`).toEqual([
      RELEASE_STATE,
    ]);
  });
});

describe("the pending changeset set", () => {
  it("is pending while the line is prepared and consumed once it is versioned", () => {
    if (RELEASE_STATE === "prepared") {
      expect(CHANGESETS.length, "the line is prepared but no changeset is pending").toBeGreaterThan(
        0,
      );
      expect(BUMPED.map((entry) => entry.name)).toEqual(AUDIT_PLAN.map((row) => row.name));
      return;
    }
    // `changeset version` deleted them. What must not survive is a changeset that would carry a
    // package to this line a second time: the bump is already spent.
    for (const entry of BUMPED) {
      expect(
        compareVersions(entry.to, TARGET_VERSION),
        `${entry.name} still has a pending changeset resolving to ${entry.to}`,
      ).toBeGreaterThan(0);
    }
  });

  it("names only publishable packages in this workspace, each with a real release type", () => {
    const known = new Set(PACKAGES.map((pkg) => pkg.name));
    for (const changeset of CHANGESETS) {
      expect(changeset.releases.length, `${changeset.file} declares no packages`).toBeGreaterThan(
        0,
      );
      for (const release of changeset.releases) {
        expect(known, `${changeset.file} names ${release.name}`).toContain(release.name);
        expect(Object.keys(TYPE_RANK)).toContain(release.type);
      }
    }
  });

  it("agrees with scripts/release-notes.mjs about which packages each file bumps", () => {
    for (const changeset of CHANGESETS) {
      const raw = readFileSync(join(CHANGESET_DIR, changeset.file), "utf8");
      const theirs = parseChangeset(raw);
      const mine = changeset.releases.filter((r) => r.type !== "none").map((r) => r.name);
      expect(theirs.names.sort()).toEqual(mine.sort());
      expect(normalize(theirs.summary)).toBe(normalize(changeset.summary));
    }
  });
});

describe("the resolved release plan", () => {
  it("resolves the audit's plan row for row while the changesets are pending", () => {
    if (RELEASE_STATE !== "prepared") {
      // There is no plan left to resolve; its OUTCOME is asserted by the case below, which is the
      // stronger statement, and the case above pins that nothing is queued to repeat it.
      expect(BUMPED.filter((entry) => entry.to === TARGET_VERSION)).toEqual([]);
      return;
    }
    expect(BUMPED.length).toBe(PACKAGES.length);
    for (const row of AUDIT_PLAN) {
      expect(
        PLAN.get(row.name),
        `the resolved plan disagrees with the audit for ${row.name}`,
      ).toEqual({ from: row.from, type: row.type, to: row.to });
    }
  });

  it("has either not been applied yet or has been applied in full", () => {
    for (const pkg of PACKAGES) {
      const row = AUDIT_PLAN.find((entry) => entry.name === pkg.name);
      expect(row, `${pkg.name} is not in the audit's plan`).toBeDefined();
      if (RELEASE_STATE === "prepared") {
        // Not applied: every manifest is still exactly where the audit measured it, so the plan the
        // audit published is the plan that will run.
        expect(pkg.version, `${pkg.name} is at ${pkg.version}, audited from ${row?.from}`).toBe(
          row?.from,
        );
        continue;
      }
      // Applied: the manifest reached the line the audit planned and did not stop short of it.
      // This is criterion 4's outcome observed rather than predicted.
      expect(
        compareVersions(pkg.version, TARGET_VERSION),
        `${pkg.name} is at ${pkg.version}, short of the ${TARGET_VERSION} line`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves a package no changeset classifies at the version it already has", () => {
    // The branch the release itself does not exercise, because all eight are classified. Run
    // against a fabricated package set so it is not dead code: a resolver that quietly bumped an
    // unclassified package would be invisible in this release and wrong in the next one.
    const untouched: WorkspacePackage = {
      dir: "fixture",
      name: "@cosyte/not-in-this-release",
      version: "0.0.9",
      files: [],
    };
    const plan = resolvePlan(
      [...PACKAGES, untouched],
      [
        ...CHANGESETS,
        {
          file: "fixture-none.md",
          releases: [{ name: untouched.name, type: "none" }],
          summary: "A changeset that pulls a package in without moving it.",
        },
      ],
    );
    expect(plan.get(untouched.name)).toEqual({ from: "0.0.9", type: "none", to: "0.0.9" });
    // And a package no changeset mentions at all takes the same path.
    const bare = resolvePlan([untouched], []);
    expect(bare.get(untouched.name)?.to).toBe("0.0.9");
  });
});

describe("a release body is derivable for every package in the line", () => {
  it("the audit carries a summary naming the package and its 0.1.0 release", () => {
    for (const row of AUDIT_PLAN) {
      const body = sectionBody(AUDIT, summaryHeading(row.name, row.to));
      expect(body, `the audit has no release summary for ${row.name}`).not.toBeNull();
      expect(body).toContain(`${row.name}@${row.to}`);
      expect((body ?? "").length).toBeGreaterThan(20);
      expect(body).not.toContain(EM_DASH);
      for (const { pattern, what } of CHANGELOG_DUMP_MARKERS) {
        expect(pattern.test(body ?? ""), `${row.name}'s audit summary contains ${what}`).toBe(
          false,
        );
      }
    }
  });

  it("the audit's summary and the changeset's summary are the same account", () => {
    if (RELEASE_STATE !== "prepared") {
      // The changesets are consumed and git holds them; the audit's copy survives, and the case
      // below still feeds it to the shipped gate. What must not survive is a changeset that would
      // carry a planned package to this line a SECOND time. A changeset queued for the NEXT
      // release is ordinary work, not a defect, so it is the resolved version that is graded here
      // and not the mere existence of a file: anything pending must resolve ABOVE this line.
      for (const entry of BUMPED) {
        if (!PLANNED_NAMES.has(entry.name)) continue;
        expect(
          compareVersions(entry.to, TARGET_VERSION),
          `${entry.name} still has a pending changeset resolving to ${entry.to}`,
        ).toBeGreaterThan(0);
      }
      return;
    }
    // The changeset that CARRIES a package to this line is the one declaring the audited bump type,
    // and there is exactly one of it. Other changesets may name the same package with a weaker
    // type: an unrelated item can queue a `patch` on a package this release is already taking to
    // `0.1.0`, and Changesets resolves that to the same place. Those belong to their own item and
    // their summaries are theirs, so the account graded here is the one the audit is the record of.
    for (const row of AUDIT_PLAN) {
      const audited = sectionBody(AUDIT, summaryHeading(row.name, row.to));
      const carriers = CHANGESETS.filter((c) =>
        c.releases.some((r) => r.name === row.name && r.type === row.type),
      );
      expect(
        carriers.length,
        `${row.name} is not carried to ${row.to} by exactly one \`${row.type}\` changeset`,
      ).toBe(1);
      expect(normalize(carriers[0].summary)).toBe(normalize(audited ?? ""));
    }
  });

  it("scripts/release-notes.mjs renders a publishable body from it", () => {
    // The load-bearing case: the SHIPPED gate, given the SHIPPED summaries, at the version this
    // line resolves to. `assertNotes` is what `release.yml` calls, and an empty problem list is
    // what "the release can say what it shipped" means there.
    //
    // The audit's copy is run in every state, and the changesets' copy as well while they are
    // pending. The case above pins that the two are the same text, so the gate is handed the bytes
    // `release.yml` will derive from either way.
    for (const row of AUDIT_PLAN) {
      const audited = sectionBody(AUDIT, summaryHeading(row.name, row.to)) ?? "";
      const fromAudit = renderNotes({
        packageName: row.name,
        version: row.to,
        summaries: [audited],
      });
      expect(assertNotes({ body: fromAudit, packageName: row.name, version: row.to })).toEqual([]);

      const summaries = CHANGESETS.filter((c) =>
        c.releases.some((r) => r.name === row.name && r.type !== "none"),
      ).map((c) => c.summary);
      if (summaries.length === 0) continue;
      const fromChangesets = renderNotes({ packageName: row.name, version: row.to, summaries });
      expect(assertNotes({ body: fromChangesets, packageName: row.name, version: row.to })).toEqual(
        [],
      );
    }
  });
});

describe("the hand promotion of the changelog heading", () => {
  it("gives every package in the line a 0.1.0 section carrying something", () => {
    for (const row of AUDIT_PLAN) {
      const body = sectionBody(changelogOf(row.name), /^## \[0\.1\.0\]/);
      expect(body, `${row.name} has no ## [0.1.0] heading`).not.toBeNull();
      expect((body ?? "").length, `${row.name}'s 0.1.0 section is empty`).toBeGreaterThan(40);
    }
  });

  it("heads 0.1.0 as dated or as Unreleased, and as nothing else", () => {
    // `RELEASING.md` dates a heading FROM ITS TAG, by hand, and the tag is created by the publish
    // job at the end of the pipeline. So `- Unreleased` is correct from the moment this preparation
    // writes the heading until the release owner dates it, and a date is correct after. Demanding
    // one of the two would red exactly one of those, on a repository whose required checks nobody
    // can bypass. Demanding NEITHER form is what let the promotion be skipped twice in a row.
    const heading = new RegExp(
      `^## \\[${TARGET_VERSION.replace(/\./g, "\\.")}\\] - (?:Unreleased|\\d{4}-\\d{2}-\\d{2})\\s*$`,
      "m",
    );
    for (const row of AUDIT_PLAN) {
      expect(
        heading.test(changelogOf(row.name)),
        `${row.name}'s ## [${TARGET_VERSION}] heading is neither dated nor marked Unreleased`,
      ).toBe(true);
    }
  });

  it("dates every version a package has already shipped", () => {
    // The defect this closes: `Version Packages (#46)` and `(#51)` both skipped the hand promotion,
    // so content that had shipped was still headed as unreleased in the file that shipped. A
    // version below this line that carries a tag has shipped, is settled history, and must carry
    // its date; the case above governs the line being prepared, which has not shipped yet.
    for (const pkg of PACKAGES) {
      const changelog = changelogOf(pkg.name);
      const shipped = taggedVersions(pkg.name).filter(
        (version) => compareVersions(version, TARGET_VERSION) < 0,
      );
      expect(
        shipped.length,
        `${pkg.name} has no tag below ${TARGET_VERSION}, so this check would pass vacuously`,
      ).toBeGreaterThan(0);
      for (const version of shipped) {
        const heading = new RegExp(
          `^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
          "m",
        );
        expect(
          heading.test(changelog),
          `${pkg.name} has no dated ## [${version}] heading for the version it published`,
        ).toBe(true);
      }
    }
  });

  it("leaves an Unreleased heading present and carrying nothing already shipped", () => {
    for (const pkg of PACKAGES) {
      const body = sectionBody(changelogOf(pkg.name), /^## \[Unreleased\]\s*$/);
      expect(body, `${pkg.name} has no ## [Unreleased] heading`).not.toBeNull();
      expect(body, `${pkg.name} still carries content under [Unreleased]`).toBe("");
    }
  });

  it("ships the changelog it edits, so the bump is not republishing identical bytes", () => {
    for (const pkg of PACKAGES) {
      expect(pkg.files, `${pkg.name} does not ship its CHANGELOG.md`).toContain("CHANGELOG.md");
    }
  });
});

describe("what this preparation must not have done", () => {
  it("leaves the private root manifest at 0.0.0", () => {
    const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(root.name).toBe("cosyte-config");
    expect(root.private).toBe(true);
    expect(root.version).toBe("0.0.0");
    // And no changeset may name it: it is not in the release set.
    for (const changeset of CHANGESETS) {
      for (const release of changeset.releases) {
        expect(release.name).not.toBe("cosyte-config");
      }
    }
  });

  it("tags nothing, because tagging is the publish job's", () => {
    // The durable form of "this preparation adds no tag". A `<pkg>@<v>` tag is created by the
    // publish job AFTER the registry confirms `<v>` is there, so no tag can ever be AHEAD of the
    // manifest it was cut from. While the line is prepared that forbids a `<pkg>@0.1.0` tag
    // outright, which is exactly what this preparation must not have created; after the release
    // owner has versioned and published, the same rule admits precisely the tag they made and
    // nothing else.
    expect(TAGS.size, "no tags are visible, so this check would pass vacuously").toBeGreaterThan(0);
    for (const pkg of PACKAGES) {
      const tagged = taggedVersions(pkg.name);
      expect(tagged.length, `${pkg.name} has no tags at all`).toBeGreaterThan(0);
      for (const version of tagged) {
        expect(
          compareVersions(version, pkg.version),
          `${pkg.name}@${version} is tagged but the manifest is only at ${pkg.version}`,
        ).toBeLessThanOrEqual(0);
      }
      if (RELEASE_STATE === "prepared") {
        expect(tagged, `a ${pkg.name}@${TARGET_VERSION} tag exists`).not.toContain(TARGET_VERSION);
      }
    }
  });

  it("has not run changeset version itself", () => {
    // Scope Out: "Running `changeset version` as part of the landed change. The version commit is
    // the pipeline's step 4/5 and belongs to the release owner." That forbids THIS PREPARATION
    // versioning. It does not forbid the release owner doing it next, and this suite runs on their
    // commit too, so the assertion is about the state the preparation leaves behind: while its own
    // changesets are still pending, no manifest may already sit at the version they resolve to.
    if (RELEASE_STATE !== "prepared") {
      expect(BUMPED.filter((entry) => entry.to === TARGET_VERSION)).toEqual([]);
      return;
    }
    expect(CHANGESETS.length).toBeGreaterThan(0);
    for (const pkg of PACKAGES) {
      expect(pkg.version, `${pkg.name} has already been versioned in this branch`).not.toBe(
        TARGET_VERSION,
      );
    }
  });
});

describe("the repository states one version policy", () => {
  it("the ladder pattern still matches the assertion it exists to find", () => {
    // The self-test, on the same reasoning as `scripts/check-no-emdash.sh`: a sweep that finds
    // nothing is indistinguishable from a sweep whose pattern stopped compiling. Both spellings
    // the repository used are pinned.
    expect(
      LADDER_ASSERTION.test("The package stays on the **`0.0.x`-until-first-alpha** ladder."),
    ).toBe(true);
    expect(
      LADDER_ASSERTION.test(
        "Every package follows the cosyte ladder: **`0.0.x` until first alpha**.",
      ),
    ).toBe(true);
    expect(LADDER_ASSERTION.test("this keeps each package on the `0.0.x` ladder")).toBe(true);
    // And does NOT fire on a statement about how npm resolves a caret range, which is still true.
    expect(
      LADDER_ASSERTION.test("under caret-on-`0.0.x` semantics `^0.0.1` cannot resolve it"),
    ).toBe(false);
  });

  it("no tracked file outside the declared exemptions still asserts it", () => {
    const paths = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean);
    expect(paths.length, "the sweep enumerated no files").toBeGreaterThan(0);
    // The index keeps listing a path git has recorded as deleted from the worktree until that
    // deletion is committed, and `changeset version` deletes the changesets it consumes. A file
    // that is not there has no bytes to sweep, so those paths are subtracted from the enumeration
    // rather than opened. Everything else that cannot be read is still a refusal, below.
    const deleted = new Set(git(["ls-files", "--deleted", "-z"]).split("\0").filter(Boolean));

    const exemptionFor = (path: string): string | undefined =>
      LADDER_EXEMPT.find((entry) =>
        entry.endsWith("/") ? path.startsWith(entry) : path === entry,
      );

    const violations: string[] = [];
    const exemptHits: string[] = [];
    const exercised = new Set<string>();
    let read = 0;
    let absent = 0;
    for (const path of paths) {
      if (deleted.has(path)) {
        absent += 1;
        continue;
      }
      let text: string;
      try {
        text = readFileSync(join(REPO_ROOT, path), "utf8");
      } catch (cause) {
        // Refused rather than skipped: a file the sweep could not open is not a clean file.
        throw new Error(`the ladder sweep could not read ${path}: ${String(cause)}`);
      }
      read += 1;
      text.split("\n").forEach((line, index) => {
        if (!LADDER_ASSERTION.test(line)) return;
        const exemption = exemptionFor(path);
        if (exemption === undefined) {
          violations.push(`${path}:${index + 1}: ${line.trim()}`);
          return;
        }
        exercised.add(exemption);
        exemptHits.push(`${path}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(read + absent).toBe(paths.length);
    expect(read, "every enumerated file was subtracted, so the sweep read nothing").toBeGreaterThan(
      0,
    );
    // Non-vacuity in the other direction, and it is per exemption rather than in aggregate: every
    // declared exemption must still be covering a real assertion. One that covers nothing is either
    // a path that has moved (so the exemption is silently protecting nothing) or a pattern that has
    // stopped matching (so the sweep is reporting clean because it is broken), and an aggregate
    // count hides both behind whichever entry still matches.
    expect(
      exemptHits.length,
      "the sweep matched nothing at all, so it may be broken",
    ).toBeGreaterThan(0);
    expect(
      LADDER_EXEMPT.filter((entry) => !exercised.has(entry)),
      "declared exemptions that cover no ladder assertion, so they protect nothing",
    ).toEqual([]);
    expect(
      violations,
      `files still asserting the retired ladder:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("the decision record and the audit exist and name each other", () => {
    const adr = readFileSync(
      join(REPO_ROOT, "documentation", "decisions", "0002-the-0-1-0-version-line.md"),
      "utf8",
    );
    expect(adr).toContain("release-0.1.0-audit.md");
    expect(AUDIT).toContain("0002-the-0-1-0-version-line.md");
    // The audit has to say the cadence item had not landed, or a later reader cannot tell which
    // decisions here are re-openable.
    expect(AUDIT).toContain("S0161-release-frequency-policy");
    expect(AUDIT).toMatch(/had not landed/i);
  });
});
