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

const PACKAGES = publishablePackages();
const CHANGESETS = pendingChangesets();
const PLAN = resolvePlan(PACKAGES, CHANGESETS);
const AUDIT = readFileSync(AUDIT_PATH, "utf8");
const BUMPED = [...PLAN.entries()]
  .filter(([, entry]) => entry.type !== "none")
  .map(([name, entry]) => ({ name, ...entry }));

describe("the pending changeset set", () => {
  it("is non-empty, so this suite is grading a real release plan", () => {
    expect(CHANGESETS.length).toBeGreaterThan(0);
    expect(BUMPED.length).toBeGreaterThan(0);
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
  it("puts every classified package at exactly 0.1.0", () => {
    expect(BUMPED.length).toBe(PACKAGES.length);
    for (const entry of BUMPED) {
      expect(entry.to, `${entry.name} resolves from ${entry.from} by ${entry.type}`).toBe(
        TARGET_VERSION,
      );
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

  it("reaches 0.1.0 by minor and could not have reached it by patch", () => {
    // ADR 0002's mechanical claim, asserted rather than quoted.
    for (const pkg of PACKAGES) {
      expect(applyBump(pkg.version, "minor")).toBe(TARGET_VERSION);
      expect(applyBump(pkg.version, "patch")).not.toBe(TARGET_VERSION);
    }
  });

  it("matches the plan table in the audit, row for row", () => {
    const table = sectionBody(AUDIT, /^## 6\. The release plan\s*$/);
    expect(table).not.toBeNull();
    for (const entry of BUMPED) {
      const row = new RegExp(
        `\\|\\s*\`${entry.name.replace(/[/@-]/g, "\\$&")}\`\\s*\\|\\s*${entry.from.replace(/\./g, "\\.")}\\s*\\|\\s*\`${entry.type}\`\\s*\\|\\s*${entry.to.replace(/\./g, "\\.")}\\s*\\|`,
      );
      expect(row.test(table ?? ""), `no plan row for ${entry.name}`).toBe(true);
    }
  });

  it("is audited for every publishable package, none omitted", () => {
    const audited = sectionBody(AUDIT, /^## 3\. Per-package audit\s*$/) ?? "";
    for (const pkg of PACKAGES) {
      expect(audited, `${pkg.name} is not in the per-package audit`).toContain(`\`${pkg.name}\``);
    }
  });
});

describe("a release body is derivable for every bumped package", () => {
  it("the audit carries a summary naming the package and its 0.1.0 release", () => {
    for (const entry of BUMPED) {
      const escaped = entry.name.replace(/[/@-]/g, "\\$&");
      const body = sectionBody(AUDIT, new RegExp(`^#### \`${escaped}@${TARGET_VERSION}\`\\s*$`));
      expect(body, `the audit has no release summary for ${entry.name}`).not.toBeNull();
      expect(body).toContain(`${entry.name}@${TARGET_VERSION}`);
      expect((body ?? "").length).toBeGreaterThan(20);
      expect(body).not.toContain(EM_DASH);
      for (const { pattern, what } of CHANGELOG_DUMP_MARKERS) {
        expect(pattern.test(body ?? ""), `${entry.name}'s audit summary contains ${what}`).toBe(
          false,
        );
      }
    }
  });

  it("the audit's summary and the changeset's summary are the same account", () => {
    for (const entry of BUMPED) {
      const escaped = entry.name.replace(/[/@-]/g, "\\$&");
      const audited = sectionBody(AUDIT, new RegExp(`^#### \`${escaped}@${TARGET_VERSION}\`\\s*$`));
      const changesets = CHANGESETS.filter((c) =>
        c.releases.some((r) => r.name === entry.name && r.type !== "none"),
      );
      expect(changesets.length, `${entry.name} has no changeset of its own`).toBe(1);
      expect(normalize(changesets[0].summary)).toBe(normalize(audited ?? ""));
    }
  });

  it("scripts/release-notes.mjs renders a publishable body from it", () => {
    // The load-bearing case: the SHIPPED gate, given the SHIPPED summaries, at the version this
    // plan resolves to. `assertNotes` is what `release.yml` calls, and an empty problem list is
    // what "the release can say what it shipped" means there.
    for (const entry of BUMPED) {
      const summaries = CHANGESETS.filter((c) =>
        c.releases.some((r) => r.name === entry.name && r.type !== "none"),
      ).map((c) => c.summary);
      const body = renderNotes({ packageName: entry.name, version: entry.to, summaries });
      expect(assertNotes({ body, packageName: entry.name, version: entry.to })).toEqual([]);
    }
  });
});

describe("the hand promotion of the changelog heading", () => {
  it("gives every bumped package a 0.1.0 section carrying something", () => {
    for (const entry of BUMPED) {
      const pkg = PACKAGES.find((p) => p.name === entry.name);
      const changelog = readFileSync(
        join(REPO_ROOT, "packages", pkg?.dir ?? "", "CHANGELOG.md"),
        "utf8",
      );
      const body = sectionBody(changelog, /^## \[0\.1\.0\]/);
      expect(body, `${entry.name} has no ## [0.1.0] heading`).not.toBeNull();
      expect((body ?? "").length, `${entry.name}'s 0.1.0 section is empty`).toBeGreaterThan(40);
    }
  });

  it("leaves an Unreleased heading present and carrying nothing already shipped", () => {
    for (const pkg of PACKAGES) {
      const changelog = readFileSync(join(REPO_ROOT, "packages", pkg.dir, "CHANGELOG.md"), "utf8");
      const body = sectionBody(changelog, /^## \[Unreleased\]\s*$/);
      expect(body, `${pkg.name} has no ## [Unreleased] heading`).not.toBeNull();
      expect(body, `${pkg.name} still carries content under [Unreleased]`).toBe("");
    }
  });

  it("dates every already-shipped version to a heading of its own", () => {
    // The defect this closes: `Version Packages (#46)` and `(#51)` both skipped the hand
    // promotion, so content that had shipped was still headed as unreleased in the file that
    // shipped. A package's own manifest version is its published version here (nothing in this
    // preparation runs `changeset version`), so that heading must exist.
    for (const pkg of PACKAGES) {
      const changelog = readFileSync(join(REPO_ROOT, "packages", pkg.dir, "CHANGELOG.md"), "utf8");
      const escaped = pkg.version.replace(/\./g, "\\.");
      const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`, "m");
      expect(
        heading.test(changelog),
        `${pkg.name} has no dated ## [${pkg.version}] heading for the version it published`,
      ).toBe(true);
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

  it("adds no 0.1.0 tag, because tagging is the publish job's and it has not run", () => {
    const tags = new Set(git(["tag", "--list"]).split("\n").filter(Boolean));
    expect(tags.size, "no tags are visible, so this check would pass vacuously").toBeGreaterThan(0);
    for (const pkg of PACKAGES) {
      expect(tags, `a ${pkg.name}@${TARGET_VERSION} tag exists`).not.toContain(
        `${pkg.name}@${TARGET_VERSION}`,
      );
    }
  });

  it("leaves every package's version where the registry has it, since version is a later step", () => {
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

    const isExempt = (path: string): boolean =>
      LADDER_EXEMPT.some((entry) =>
        entry.endsWith("/") ? path.startsWith(entry) : path === entry,
      );

    const violations: string[] = [];
    const exemptHits: string[] = [];
    let read = 0;
    for (const path of paths) {
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
        (isExempt(path) ? exemptHits : violations).push(`${path}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(read).toBe(paths.length);
    // Non-vacuity in the other direction: the pattern must still be finding the mentions that are
    // legitimately there, or a green sweep proves nothing about the ones that are not.
    expect(
      exemptHits.length,
      "the sweep matched nothing at all, so it may be broken",
    ).toBeGreaterThan(0);
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
