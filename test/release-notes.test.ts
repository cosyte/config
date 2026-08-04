import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// THE RELEASE-NOTES GATE.
//
// The defect it replaces: with `"changelog": false` in .changeset/config.json and hand-maintained
// Keep-a-Changelog files, `changesets/action`'s default `createGithubReleases: true` finds no
// `## <version>` heading and publishes the WHOLE CHANGELOG.md as the release body. On 2026-07-31 all
// six bodies shipped that way, `# Changelog` preamble and `## [Unreleased]` included.
//
// So the assertions below are in two families, and the second is the one that would catch a
// regression rather than merely exercise the happy path:
//
//   DERIVATION   a version commit yields one body per bumped package, built from the changesets it
//                consumed, with npm untouched.
//   REFUSAL      a body carrying the CHANGELOG-dump fingerprint is refused on its BYTES, by an entry
//                point that knows nothing about how they were produced.
//
// The fixtures are real git repositories driven through the shipped CLI, because the classifier's
// whole input is `HEAD` versus `HEAD^` and a mocked one would be asserting against a different
// program.

const NOTES = join(import.meta.dirname, "..", "scripts", "release-notes.mjs");

/** The em dash, built rather than written: this repo's own gate bans the escape form in source. */
const EM_DASH = String.fromCharCode(0x2014);

const temporaryDirs: string[] = [];

afterEach(() => {
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Run a git command in a fixture repository.
 *
 * @param repo The repository root.
 * @param args Arguments to git.
 * @returns Trimmed stdout.
 */
function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

/**
 * Write a package manifest at a version.
 *
 * @param repo The repository root.
 * @param name The bare package directory name.
 * @param version The version to write.
 */
function writePackage(repo: string, name: string, version: string): void {
  const dir = join(repo, "packages", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: `@cosyte/${name}`, version }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Create a git repository holding two packages and, optionally, some changesets.
 *
 * @param changesets Map of changeset filename to contents.
 * @returns The repository root.
 */
function repoWith(changesets: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "release-notes-"));
  temporaryDirs.push(root);
  git(root, ["init", "--quiet", "--initial-branch", "main"]);
  git(root, ["config", "user.email", "fixture@example.com"]);
  git(root, ["config", "user.name", "Fixture"]);

  writePackage(root, "tsconfig", "0.0.1");
  writePackage(root, "eslint-config", "0.0.1");
  mkdirSync(join(root, ".changeset"), { recursive: true });
  writeFileSync(join(root, ".changeset", "config.json"), '{ "changelog": false }\n', "utf8");
  for (const [filename, contents] of Object.entries(changesets)) {
    writeFileSync(join(root, ".changeset", filename), contents, "utf8");
  }
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "base"]);
  return root;
}

/**
 * Simulate what `changeset version` does: bump versions and delete the consumed changesets.
 *
 * @param repo The repository root.
 * @param bumps Map of bare package directory name to its new version.
 * @param consumed Changeset filenames the bump consumed.
 */
function versionCommit(repo: string, bumps: Record<string, string>, consumed: string[]): void {
  for (const [name, version] of Object.entries(bumps)) writePackage(repo, name, version);
  for (const filename of consumed) rmSync(join(repo, ".changeset", filename));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", "Version Packages"]);
}

/**
 * Run the notes CLI and capture its exit code and output.
 *
 * @param args Arguments after the script path.
 * @returns The exit code and combined output.
 */
function runNotes(args: string[]): { code: number; output: string } {
  try {
    const stdout = execFileSync("node", [NOTES, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** A changeset bumping one package, with a summary a reader could act on. */
const TSCONFIG_CHANGESET = `---
"@cosyte/tsconfig": patch
---

Raise the compiler target to ES2023, which every consuming package inherits.
`;

describe("release-notes: deriving a body from what the version commit consumed", () => {
  it("writes one body per bumped package, built from the consumed changesets", () => {
    const repo = repoWith({ "target.md": TSCONFIG_CHANGESET });
    versionCommit(repo, { tsconfig: "0.0.2" }, ["target.md"]);
    const out = join(repo, "notes-out");

    const { code, output } = runNotes(["prepare", "--repo", repo, "--out", out]);

    expect(code).toBe(0);
    expect(output).toContain("@cosyte/tsconfig@0.0.2");

    const body = readFileSync(join(out, "cosyte-tsconfig.md"), "utf8");
    // The summary the human wrote is what a reader gets, verbatim.
    expect(body).toContain("Raise the compiler target to ES2023");
    expect(body).toContain("npm install @cosyte/tsconfig@0.0.2");
    // And emphatically NOT the file this gate exists to keep out of a release body.
    expect(body).not.toContain("# Changelog");
    expect(body).not.toContain("[Unreleased]");
  });

  it("gives each package only the summaries of the changesets that bumped it", () => {
    const repo = repoWith({
      "target.md": TSCONFIG_CHANGESET,
      "lint.md": `---\n"@cosyte/eslint-config": patch\n---\n\nDrop a rule that fired on valid code.\n`,
    });
    versionCommit(repo, { tsconfig: "0.0.2", "eslint-config": "0.0.2" }, ["target.md", "lint.md"]);
    const out = join(repo, "notes-out");

    expect(runNotes(["prepare", "--repo", repo, "--out", out]).code).toBe(0);

    const tsconfig = readFileSync(join(out, "cosyte-tsconfig.md"), "utf8");
    const eslint = readFileSync(join(out, "cosyte-eslint-config.md"), "utf8");
    // Cross-contamination is the failure worth pinning: a body describing another package's change
    // reads as authoritative and is wrong.
    expect(tsconfig).toContain("compiler target");
    expect(tsconfig).not.toContain("Drop a rule");
    expect(eslint).toContain("Drop a rule");
    expect(eslint).not.toContain("compiler target");
  });

  it("is a no-op on an ordinary push, where no version moved", () => {
    const repo = repoWith({ "target.md": TSCONFIG_CHANGESET });
    writeFileSync(join(repo, "README.md"), "unrelated\n", "utf8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--quiet", "-m", "docs"]);

    const { code, output } = runNotes(["prepare", "--repo", repo, "--out", join(repo, "out")]);

    // Green and silent. Reddening every ordinary push would make the gate something people route
    // around, and there is genuinely nothing to derive here.
    expect(code).toBe(0);
    expect(output).toContain("No release pending");
  });
});

describe("release-notes: refusing a release that cannot say what it shipped", () => {
  it("REFUSES a version bump that consumed no changesets", () => {
    const repo = repoWith({});
    versionCommit(repo, { tsconfig: "0.0.2" }, []);

    const { code, output } = runNotes(["prepare", "--repo", repo, "--out", join(repo, "out")]);

    expect(code).toBe(1);
    expect(output).toContain("consumed no changesets");
  });

  it("REFUSES when a consumed changeset has an empty summary", () => {
    const repo = repoWith({ "mute.md": `---\n"@cosyte/tsconfig": patch\n---\n` });
    versionCommit(repo, { tsconfig: "0.0.2" }, ["mute.md"]);

    const { code, output } = runNotes(["prepare", "--repo", repo, "--out", join(repo, "out")]);

    expect(code).toBe(1);
    expect(output).toContain("empty summary");
  });

  it("REFUSES when a package was bumped by no changeset at all", () => {
    // The shape a hand-edited version bump produces: one package moves with nothing describing it.
    const repo = repoWith({ "target.md": TSCONFIG_CHANGESET });
    versionCommit(repo, { tsconfig: "0.0.2", "eslint-config": "0.0.2" }, ["target.md"]);

    const { code, output } = runNotes(["prepare", "--repo", repo, "--out", join(repo, "out")]);

    expect(code).toBe(1);
    expect(output).toContain("@cosyte/eslint-config");
  });
});

describe("release-notes: assert refuses on the finished bytes", () => {
  /**
   * Write a candidate body and assert it through the shipped CLI.
   *
   * @param body The bytes to check.
   * @param version The version the body claims.
   * @returns The exit code and combined output.
   */
  function assertBody(body: string, version = "0.0.2"): { code: number; output: string } {
    const root = mkdtempSync(join(tmpdir(), "release-notes-assert-"));
    temporaryDirs.push(root);
    const file = join(root, "body.md");
    writeFileSync(file, body, "utf8");
    return runNotes([
      "assert",
      "--file",
      file,
      "--expect-package",
      "@cosyte/tsconfig",
      "--expect-version",
      version,
    ]);
  }

  /** A body that should pass, so every refusal below is attributable to the thing it changes. */
  const GOOD_BODY = [
    "Raise the compiler target to ES2023, which every consuming package inherits.",
    "",
    "### Install",
    "",
    "```bash",
    "npm install @cosyte/tsconfig@0.0.2",
    "```",
    "",
    "**npm:** https://www.npmjs.com/package/@cosyte/tsconfig/v/0.0.2",
    "",
  ].join("\n");

  it("ACCEPTS a derived body (the control for every refusal below)", () => {
    const { code, output } = assertBody(GOOD_BODY);
    expect(code).toBe(0);
    expect(output).toContain("release-notes: OK");
  });

  it("REFUSES a body carrying the raw CHANGELOG preamble", () => {
    // This is the 2026-07-31 defect reproduced exactly: the real file, dumped whole.
    const dumped = [
      "# Changelog",
      "",
      "All notable changes to `@cosyte/tsconfig` are documented here, following",
      "[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).",
      "",
      "## [Unreleased]",
      "",
      "### Changed",
      "",
      "- Something.",
      "",
      "npm install @cosyte/tsconfig@0.0.2",
    ].join("\n");

    const { code, output } = assertBody(dumped);

    expect(code).toBe(1);
    // All three fingerprints are reported, not just the first: a body that lost only its preamble
    // would still be a dump, so the refusal has to name every marker it found.
    expect(output).toContain("`# Changelog` file preamble");
    expect(output).toContain("`## [Unreleased]` heading");
    expect(output).toContain("Keep a Changelog boilerplate link");
  });

  it("REFUSES an empty body", () => {
    expect(assertBody("   \n\n").code).toBe(1);
  });

  it("REFUSES a stub that looks deliberate", () => {
    const stub = `Automated release of v0.0.2.\n\n### Install\n\nnpm install @cosyte/tsconfig@0.0.2\n`;
    const { code, output } = assertBody(stub);
    expect(code).toBe(1);
    expect(output).toContain("stub");
  });

  it("REFUSES a body describing a different version than the one being tagged", () => {
    const { code, output } = assertBody(GOOD_BODY, "0.0.9");
    expect(code).toBe(1);
    expect(output).toContain("never names @cosyte/tsconfig@0.0.9");
  });

  it("REFUSES a body containing an em dash", () => {
    const { code, output } = assertBody(GOOD_BODY.replace("ES2023,", `ES2023 ${EM_DASH}`));
    expect(code).toBe(1);
    expect(output).toContain("em dash");
  });

  it("REFUSES a body that is only scaffolding", () => {
    const bare = [
      "Fix.",
      "",
      "### Install",
      "",
      "```bash",
      "npm install @cosyte/tsconfig@0.0.2",
      "```",
    ].join("\n");
    const { code, output } = assertBody(bare);
    expect(code).toBe(1);
    expect(output).toContain("bytes of description");
  });
});

describe("release-notes: a broken run must not look like a refusal", () => {
  it("exits 2, not 1, on an unknown subcommand", () => {
    const { code, output } = runNotes(["explode"]);
    expect(code).toBe(2);
    expect(output).toContain("could not run");
  });

  it("exits 2, not 1, when the body file cannot be read", () => {
    const { code } = runNotes([
      "assert",
      "--file",
      join(tmpdir(), "definitely-not-here.md"),
      "--expect-package",
      "@cosyte/tsconfig",
      "--expect-version",
      "0.0.2",
    ]);
    expect(code).toBe(2);
  });
});
