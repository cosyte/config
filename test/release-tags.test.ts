/**
 * EVERY PACKAGE VERSION ON NPM MUST HAVE ITS TAG AND ITS GITHUB RELEASE, WHICHEVER COMMIT VERSIONED IT.
 *
 * The defect (config#189, config#192, 2026-11-08): the version commit of #189 bumped eslint-config,
 * process and test-utils, and its release run stopped in `preflight` at the catalog check. The next
 * version commit, #192, bumped script-utils, and its publish run published all four. The tag step
 * works from what HEAD bumped, so it tagged and released script-utils alone, and the run went green
 * with three versions on npm and no tag or release for any of them.
 *
 * The two-commit case below is that history, rebuilt as a real git repository and driven through the
 * shipped steps of `.github/workflows/release.yml`, sliced out of the file rather than re-typed: the
 * release-notes gate that names what HEAD bumped, the bumped-package step that tags only that, and
 * the step scripts/release-tags.mjs adds, which tags the rest. The boundaries are doubled and nothing
 * else: the registry is a real HTTP server on 127.0.0.1 answered by the real `npm view`, and `gh` is a
 * stub on PATH that keeps the repository's tags and releases in a directory, so a tag the step
 * "created" is read back the way the step reads it back on GitHub.
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hermeticEnv } from "./support/fixture-registry.mjs";
import { ABSENT, PRESENT, UNREADABLE, workspacePackages } from "../scripts/registry-presence.mjs";
import {
  GitHubUnreadable,
  changelogBody,
  changelogSection,
  reconcile,
} from "../scripts/release-tags.mjs";

const REPO_ROOT = join(import.meta.dirname, "..");
const WORKFLOW = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");
const NOTES = join(REPO_ROOT, "scripts", "release-notes.mjs");

const BUMPED_STEP = "Every bumped package must be published, tagged and released";
const RECONCILE_STEP = "Every package version on npm must have its tag and release";

const SCOPE = "@cosyte-fixture";

const scratch: string[] = [];
const servers: Server[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The shipped workflow
// ---------------------------------------------------------------------------

/** The `run:` block of a named step of release.yml. A renamed step is a refusal, not a pass. */
function stepScript(stepName: string): string {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (start === -1) throw new Error(`release.yml has no step named ${JSON.stringify(stepName)}`);
  let runAt = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("- name:")) break;
    if (/^\s+run: \|\s*$/.test(lines[i])) {
      runAt = i;
      break;
    }
  }
  if (runAt === -1) throw new Error(`step ${JSON.stringify(stepName)} has no literal run block`);
  const indent = lines[runAt].search(/\S/) + 2;
  const body: string[] = [];
  for (let i = runAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") {
      body.push("");
      continue;
    }
    if (lines[i].search(/\S/) < indent) break;
    body.push(lines[i].slice(indent));
  }
  return `${body.join("\n").trimEnd()}\n`;
}

/** The `if:` line of a named step. */
function stepCondition(stepName: string): string {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("- name:")) break;
    const match = /^\s+if: (.*)$/.exec(lines[i]);
    if (match !== null) return match[1];
  }
  throw new Error(`step ${JSON.stringify(stepName)} has no if: line`);
}

// ---------------------------------------------------------------------------
// The boundaries: the registry and GitHub
// ---------------------------------------------------------------------------

/** A registry on the loopback interface that has exactly the versions it is given. */
async function startRegistry(versions: Record<string, string[]>): Promise<string> {
  const server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\//, "");
    const have = versions[name];
    if (have === undefined) {
      response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(
      JSON.stringify({
        name,
        "dist-tags": { latest: have.at(-1) },
        versions: Object.fromEntries(have.map((v) => [v, { name, version: v, dist: {} }])),
        time: Object.fromEntries(have.map((v) => [v, new Date().toISOString()])),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("registry has no port");
  return `http://127.0.0.1:${address.port}/`;
}

/**
 * A `gh` that keeps a repository's tags and releases as files: one line per tag in `tags`, one per
 * release in `releases`, each created body under `notes/`, and every call in `log`.
 *
 * `GH_CREATE_FAILS` makes `release create` fail; `GH_CREATE_DROPS_TAG` makes it report success and
 * create the release without its tag, which is the case only a read-back can catch.
 */
function stubGh(state: string): string {
  const bin = join(state, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(state, "notes"), { recursive: true });
  for (const file of ["tags", "releases", "log", "creates"]) {
    writeFileSync(join(state, file), "", "utf8");
  }
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      'state="$GH_STATE"',
      'printf "%s\\n" "gh $*" >> "$state/log"',
      'case "$1 $2" in',
      '  "api "*)',
      '    tag="${2#*/git/ref/tags/}"',
      '    if grep -qxF -- "$tag" "$state/tags"; then echo "{\\"ref\\":\\"refs/tags/$tag\\"}"; exit 0; fi',
      '    echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      '  "release view")',
      '    if grep -qxF -- "$3" "$state/releases"; then echo "{\\"isDraft\\":false}"; exit 0; fi',
      '    echo "release not found" >&2; exit 1 ;;',
      '  "release create")',
      '    tag="$3"; shift 3; target=""; notes=""',
      "    while [ $# -gt 0 ]; do",
      '      case "$1" in --target) target="$2"; shift ;; --notes-file) notes="$2"; shift ;; esac',
      "      shift",
      "    done",
      '    if [ -n "${GH_CREATE_FAILS:-}" ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi',
      '    if grep -qxF -- "$tag" "$state/releases"; then echo "a release with the same tag name already exists: $tag" >&2; exit 1; fi',
      '    printf "%s\\n" "$tag" >> "$state/releases"',
      '    if [ -z "${GH_CREATE_DROPS_TAG:-}" ] && ! grep -qxF -- "$tag" "$state/tags"; then printf "%s\\n" "$tag" >> "$state/tags"; fi',
      '    printf "%s\\t%s\\n" "$tag" "$target" >> "$state/creates"',
      '    cp "$notes" "$state/notes/$(printf "%s" "$tag" | sed "s|[@/]|_|g").md"',
      "    exit 0 ;;",
      '  "release edit") exit 0 ;;',
      "esac",
      'echo "stub gh: unexpected call: $*" >&2',
      "exit 64",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

interface GhState {
  dir: string;
  bin: string;
  seed: (tags: string[], releases?: string[]) => void;
  tags: () => string[];
  releases: () => string[];
  creates: () => { tag: string; target: string }[];
  body: (tag: string) => string;
}

function ghState(): GhState {
  const dir = tempDir("release-tags-gh-");
  const bin = stubGh(dir);
  const lines = (file: string) =>
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((line) => line !== "");
  return {
    dir,
    bin,
    seed(tags, releases = tags) {
      writeFileSync(join(dir, "tags"), tags.map((t) => `${t}\n`).join(""), "utf8");
      writeFileSync(join(dir, "releases"), releases.map((t) => `${t}\n`).join(""), "utf8");
    },
    tags: () => lines("tags"),
    releases: () => lines("releases"),
    creates: () =>
      lines("creates").map((line) => {
        const [tag, target] = line.split("\t");
        return { tag, target };
      }),
    body: (tag) => readFileSync(join(dir, "notes", `${tag.replace(/[@/]/g, "_")}.md`), "utf8"),
  };
}

/** Run one shipped step under bash, from this repository's root, as the workflow does. */
function runStep(
  step: string,
  env: NodeJS.ProcessEnv,
): Promise<{ status: number; output: string }> {
  const script = join(tempDir("release-tags-step-"), "step.sh");
  writeFileSync(script, stepScript(step), "utf8");
  const child = spawn("bash", [script], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (output += chunk));
  child.stderr.on("data", (chunk: string) => (output += chunk));
  return new Promise((resolve) => {
    child.on("close", (status) => resolve({ status: status ?? -1, output }));
  });
}

// ---------------------------------------------------------------------------
// The fixture repository
// ---------------------------------------------------------------------------

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

const CHANGELOG_HEAD = "# Changelog\n\n";
const ARCHIVE = [
  "## Released before this file was generated",
  "",
  "Sections below were kept by hand.",
  "",
  "## [0.1.0] - 2026-09-21",
  "",
  "### Changed",
  "",
  "- The first release on the 0.1.x line, kept by hand.",
  "",
].join("\n");

/** Write a package manifest, and its CHANGELOG with one section per version, newest first. */
function writePackage(repo: string, slug: string, sections: [string, string][]): void {
  const dir = join(repo, "packages", slug);
  mkdirSync(dir, { recursive: true });
  const version = sections[0][0];
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: `${SCOPE}/${slug}`, version }, null, 2)}\n`,
    "utf8",
  );
  const body = sections
    .map(([v, text]) => `## ${v}\n\n### Patch Changes\n\n- 1234567: ${text}\n`)
    .join("\n");
  writeFileSync(join(dir, "CHANGELOG.md"), `${CHANGELOG_HEAD}${body}\n${ARCHIVE}`, "utf8");
}

function commitAll(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

const OLD = {
  "eslint-config": "0.1.2",
  process: "0.1.4",
  "test-utils": "0.1.2",
  "script-utils": "0.1.7",
};
const FIRST_BUMP = { "eslint-config": "0.1.3", process: "0.1.5", "test-utils": "0.1.3" };
const SECOND_BUMP = { "script-utils": "0.1.8" };

const what = (slug: string, version: string) =>
  `What changed in ${slug} ${version}, as the changeset that bumped it said.`;

/**
 * The history of #189 to #192: a base, a changeset, the version commit that consumed it (#189),
 * a second changeset (#190), and the version commit that consumed that (#192).
 */
function twoVersionCommits(): { repo: string; first: string; second: string } {
  const repo = tempDir("release-tags-repo-");
  git(repo, ["init", "--quiet", "--initial-branch", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "Fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  const current: Record<string, [string, string][]> = {};
  for (const [slug, version] of Object.entries(OLD)) {
    current[slug] = [[version, what(slug, version)]];
    writePackage(repo, slug, current[slug]);
  }
  mkdirSync(join(repo, ".changeset"), { recursive: true });
  writeFileSync(join(repo, ".changeset", "config.json"), "{}\n", "utf8");
  commitAll(repo, "base");

  const bump = (versions: Record<string, string>, changeset: string) => {
    for (const [slug, version] of Object.entries(versions)) {
      current[slug] = [[version, what(slug, version)], ...current[slug]];
      writePackage(repo, slug, current[slug]);
    }
    rmSync(join(repo, ".changeset", changeset));
  };
  const changeset = (file: string, versions: Record<string, string>) => {
    const front = Object.keys(versions)
      .map((slug) => `"${SCOPE}/${slug}": patch`)
      .join("\n");
    const summary = Object.entries(versions)
      .map(([slug, version]) => what(slug, version))
      .join(" ");
    writeFileSync(join(repo, ".changeset", file), `---\n${front}\n---\n\n${summary}\n`, "utf8");
  };

  changeset("first.md", FIRST_BUMP);
  commitAll(repo, "fix: raise the typescript-eslint floor");
  bump(FIRST_BUMP, "first.md");
  const first = commitAll(repo, "chore(release): version packages (#189 analogue)");

  changeset("second.md", SECOND_BUMP);
  commitAll(repo, "fix(script-utils): refresh the catalog (#190 analogue)");
  bump(SECOND_BUMP, "second.md");
  const second = commitAll(repo, "chore(release): version packages (#192 analogue)");
  return { repo, first, second };
}

const tag = (slug: string, version: string) => `${SCOPE}/${slug}@${version}`;
const OLD_TAGS = Object.entries(OLD).map(([slug, version]) => tag(slug, version));
const FIRST_TAGS = Object.entries(FIRST_BUMP).map(([slug, version]) => tag(slug, version));
const SECOND_TAGS = Object.entries(SECOND_BUMP).map(([slug, version]) => tag(slug, version));

/** What npm has after #192's publish run: every version of every package, old and new. */
function publishedEverything(): Record<string, string[]> {
  const all: Record<string, string[]> = {};
  for (const [slug, version] of Object.entries(OLD)) all[`${SCOPE}/${slug}`] = [version];
  for (const [slug, version] of Object.entries({ ...FIRST_BUMP, ...SECOND_BUMP })) {
    all[`${SCOPE}/${slug}`].push(version);
  }
  return all;
}

function stepEnv(
  gh: GhState,
  registry: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    ...hermeticEnv(),
    npm_config_registry: registry,
    npm_config_cache: tempDir("release-tags-npm-cache-"),
    PATH: `${gh.bin}:${process.env.PATH ?? ""}`,
    GH_STATE: gh.dir,
    GH_TOKEN: "fixture-token",
    GITHUB_REPOSITORY: "cosyte-fixture/config",
    RUNNER_TEMP: tempDir("release-tags-runner-temp-"),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The two-commit case
// ---------------------------------------------------------------------------

describe("the two-commit case: a version commit whose run stopped, then the next one published both", () => {
  it(
    "the bumped-package step tags only what HEAD bumped, and the new step tags and releases the rest",
    { timeout: 180_000 },
    async () => {
      const { repo, second } = twoVersionCommits();
      const registry = await startRegistry(publishedEverything());
      const gh = ghState();
      gh.seed(OLD_TAGS);

      // 1. The release-notes gate at HEAD names only what the LATEST version commit bumped.
      const runnerTemp = tempDir("release-tags-notes-");
      const outputs = join(runnerTemp, "github-output");
      writeFileSync(outputs, "", "utf8");
      execFileSync(
        "node",
        [NOTES, "prepare", "--repo", repo, "--out", join(runnerTemp, "release-notes")],
        { env: { ...process.env, GITHUB_OUTPUT: outputs }, encoding: "utf8" },
      );
      const bumped = /^packages=(.*)$/m.exec(readFileSync(outputs, "utf8"))?.[1] ?? "";
      expect(JSON.parse(bumped)).toEqual([{ name: `${SCOPE}/script-utils`, version: "0.1.8" }]);

      // 2. THE DEFECT, reproduced: the bumped-package step goes green having tagged script-utils
      //    alone, with the three versions #189 bumped on npm and untagged.
      const bumpedStep = await runStep(
        BUMPED_STEP,
        stepEnv(gh, registry, {
          GITHUB_SHA: second,
          BUMPED_PACKAGES: bumped,
          NOTES_DIR: join(runnerTemp, "release-notes"),
        }),
      );
      expect(bumpedStep.status, bumpedStep.output).toBe(0);
      expect(gh.creates().map((c) => c.tag)).toEqual(SECOND_TAGS);
      for (const owed of FIRST_TAGS) expect(gh.tags()).not.toContain(owed);

      // 3. THE FIX: the new step tags and releases them, at the commit this run published from,
      //    with each body taken from that version's CHANGELOG section.
      const env = stepEnv(gh, registry, { GITHUB_SHA: second, GITHUB_WORKSPACE: repo });
      const fixed = await runStep(RECONCILE_STEP, env);
      expect(fixed.status, fixed.output).toBe(0);
      expect(gh.creates()).toEqual([
        ...SECOND_TAGS.map((t) => ({ tag: t, target: second })),
        ...FIRST_TAGS.map((t) => ({ tag: t, target: second })),
      ]);
      for (const owed of FIRST_TAGS) {
        expect(gh.tags()).toContain(owed);
        expect(gh.releases()).toContain(owed);
      }
      for (const [slug, version] of Object.entries(FIRST_BUMP)) {
        const body = gh.body(tag(slug, version));
        expect(body).toContain(what(slug, version));
        expect(body).toContain(`npm install ${tag(slug, version)}`);
        // The section, not the file: no older version and no archive rides along.
        expect(body).not.toContain(what(slug, OLD[slug as keyof typeof OLD]));
        expect(body).not.toContain("# Changelog");
        expect(body).not.toContain("Released before this file was generated");
      }
      expect(fixed.output).toContain("4 package(s) checked, 3 created");

      // 4. IDEMPOTENT: a re-run finds nothing owed and writes nothing.
      const again = await runStep(RECONCILE_STEP, env);
      expect(again.status, again.output).toBe(0);
      expect(gh.creates()).toHaveLength(4);
      expect(again.output).toContain("4 package(s) checked, 0 created");
    },
  );

  it(
    "the run does NOT go green when a version on npm still has no tag after the step",
    { timeout: 120_000 },
    async () => {
      // `gh release create` reports success and the tag never appears. Only the read-back sees it.
      const { repo, second } = twoVersionCommits();
      const registry = await startRegistry(publishedEverything());
      const gh = ghState();
      gh.seed([...OLD_TAGS, ...SECOND_TAGS]);

      const result = await runStep(
        RECONCILE_STEP,
        stepEnv(gh, registry, {
          GITHUB_SHA: second,
          GITHUB_WORKSPACE: repo,
          GH_CREATE_DROPS_TAG: "1",
        }),
      );

      expect(result.status, result.output).toBe(1);
      for (const owed of FIRST_TAGS) {
        expect(result.output).toContain(`::error title=On npm with no tag::${owed} is on npm`);
      }
      expect(result.output).toContain("Refusing to report success");
    },
  );

  it(
    "the run does NOT go green when the release cannot be created",
    { timeout: 120_000 },
    async () => {
      const { repo, second } = twoVersionCommits();
      const registry = await startRegistry(publishedEverything());
      const gh = ghState();
      gh.seed([...OLD_TAGS, ...SECOND_TAGS]);

      const result = await runStep(
        RECONCILE_STEP,
        stepEnv(gh, registry, { GITHUB_SHA: second, GITHUB_WORKSPACE: repo, GH_CREATE_FAILS: "1" }),
      );

      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("HTTP 502");
      expect(gh.tags()).not.toContain(FIRST_TAGS[0]);
    },
  );

  it("runs after any Publish step that ran, on a version commit or not", () => {
    // A push that publishes an earlier version commit's versions need not be a version commit, so
    // the step must not key off `is-release`, nor off `published`, which a re-run reports false.
    const condition = stepCondition(RECONCILE_STEP);
    expect(condition).toBe("${{ !cancelled() && steps.changesets.outcome != 'skipped' }}");
    const steps = WORKFLOW.split("\n")
      .filter((line) => /^\s+- name: /.test(line))
      .map((line) => line.trim().replace(/^- name: /, ""));
    expect(steps.indexOf(RECONCILE_STEP)).toBeGreaterThan(steps.indexOf(BUMPED_STEP));
    expect(steps.indexOf(RECONCILE_STEP)).toBeGreaterThan(steps.indexOf("Publish"));
  });
});

// ---------------------------------------------------------------------------
// The decision, one boundary answer at a time
// ---------------------------------------------------------------------------

/** A GitHub held in memory, for the cases that grade one decision rather than the whole step. */
function memoryGitHub(
  tags: string[],
  releases: string[] = tags,
  options: { unreadable?: string; createFails?: boolean } = {},
) {
  const state = { tags: new Set(tags), releases: new Set(releases), creates: [] as string[] };
  const guard = (t: string) => {
    if (t === options.unreadable) throw new GitHubUnreadable("HTTP 503: Service Unavailable");
  };
  return {
    state,
    tagExists: (t: string) => (guard(t), state.tags.has(t)),
    releaseExists: (t: string) => (guard(t), state.releases.has(t)),
    createRelease: ({ tag: t }: { tag: string }) => {
      if (options.createFails) return { ok: false, detail: "HTTP 502" };
      state.creates.push(t);
      state.releases.add(t);
      state.tags.add(t);
      return { ok: true };
    },
  };
}

/** One package on disk, with a CHANGELOG, as `workspacePackages` would describe it. */
function onePackage(changelog: string | null, version = "0.1.3") {
  const dir = tempDir("release-tags-pkg-");
  if (changelog !== null) writeFileSync(join(dir, "CHANGELOG.md"), changelog, "utf8");
  return { name: `${SCOPE}/one`, version, dir };
}

async function decide(
  pkg: { name: string; version: string; dir: string },
  github: ReturnType<typeof memoryGitHub>,
  registry: string,
) {
  const lines: string[] = [];
  const result = await reconcile({
    packages: [pkg],
    target: "2".repeat(40),
    notesDir: tempDir("release-tags-notes-"),
    github,
    presence: {
      budgetSeconds: 0.2,
      intervalSeconds: 0.05,
      probe: async () => ({ state: registry, detail: "fixture" }),
    },
    log: (line: string) => lines.push(line),
  });
  return { ...result, log: lines.join("\n") };
}

const GOOD = `# Changelog\n\n## 0.1.3\n\n### Patch Changes\n\n- 1234567: ${what("one", "0.1.3")}\n`;

describe("what each version is owed", () => {
  it("leaves a version with its tag and release alone, and asks the registry nothing", async () => {
    let probes = 0;
    const github = memoryGitHub([`${SCOPE}/one@0.1.3`]);
    const result = await reconcile({
      packages: [onePackage(GOOD)],
      target: "2".repeat(40),
      notesDir: tempDir("release-tags-notes-"),
      github,
      presence: { probe: async () => (probes++, { state: PRESENT, detail: "" }) },
      log: () => {},
    });
    expect(result.code).toBe(0);
    expect(probes).toBe(0);
    expect(github.state.creates).toEqual([]);
  });

  it("does not tag a version npm does not have, and does not red on it", async () => {
    const github = memoryGitHub([]);
    const result = await decide(onePackage(GOOD), github, ABSENT);
    expect(result.code, result.log).toBe(0);
    expect(github.state.creates).toEqual([]);
    expect(result.log).toContain("::warning title=Not on npm, so not tagged::");
  });

  it("creates the release on a tag that exists without one", async () => {
    const github = memoryGitHub([`${SCOPE}/one@0.1.3`], []);
    const result = await decide(onePackage(GOOD), github, PRESENT);
    expect(result.code, result.log).toBe(0);
    expect(github.state.creates).toEqual([`${SCOPE}/one@0.1.3`]);
  });

  it("REDS on a version on npm with no tag and no CHANGELOG section to describe it", async () => {
    const github = memoryGitHub([]);
    const result = await decide(onePackage(GOOD.replace("## 0.1.3", "## 0.1.2")), github, PRESENT);
    expect(result.code).toBe(1);
    expect(result.log).toContain("::error title=On npm with no release body::");
    expect(result.log).toContain("no non-empty `## 0.1.3` section");
    expect(github.state.creates).toEqual([]);
  });

  it("REDS on a version on npm with no tag and no CHANGELOG at all", async () => {
    const result = await decide(onePackage(null), memoryGitHub([]), PRESENT);
    expect(result.code).toBe(1);
    expect(result.log).toContain("cannot read");
  });

  it("REDS when the registry cannot be read for a version with no tag", async () => {
    const result = await decide(onePackage(GOOD), memoryGitHub([]), UNREADABLE);
    expect(result.code).toBe(1);
    expect(result.log).toContain("::error title=On npm or not is unknown::");
  });

  it("REDS when GitHub cannot be read, rather than calling the tag present or missing", async () => {
    const github = memoryGitHub([], [], { unreadable: `${SCOPE}/one@0.1.3` });
    const result = await decide(onePackage(GOOD), github, PRESENT);
    expect(result.code).toBe(1);
    expect(result.log).toContain("::error title=GitHub could not be read::");
    expect(github.state.creates).toEqual([]);
  });

  it("REDS when the create fails", async () => {
    const github = memoryGitHub([], [], { createFails: true });
    const result = await decide(onePackage(GOOD), github, PRESENT);
    expect(result.code).toBe(1);
    expect(result.log).toContain("::error title=On npm with no tag::");
  });

  it("refuses a body built from a section carrying an em dash, like every other body", async () => {
    const dash = String.fromCharCode(0x2014);
    const result = await decide(
      onePackage(GOOD.replace("What", `What ${dash}`)),
      memoryGitHub([]),
      PRESENT,
    );
    expect(result.code).toBe(1);
    expect(result.log).toContain("em dash");
  });
});

describe("changelogSection", () => {
  const text = [
    "# Changelog",
    "",
    "## 0.1.30",
    "",
    "- thirty",
    "",
    "## 0.1.3",
    "",
    "### Patch Changes",
    "",
    "- three",
    "",
    "## Released before this file was generated",
    "",
    "Archive prose.",
    "",
    "## [0.1.1] - 2026-11-07",
    "",
    "### Changed",
    "",
    "- one, kept by hand",
    "",
    "## [0.1.0]",
    "",
    "## 0.0.9",
    "",
    "- nine",
  ].join("\n");

  it("reads the section Changesets writes, and stops at the next level-two heading", () => {
    expect(changelogSection(text, "0.1.3")).toBe("### Patch Changes\n\n- three");
  });
  it("does not read 0.1.30 as 0.1.3, or the other way round", () => {
    expect(changelogSection(text, "0.1.30")).toBe("- thirty");
  });
  it("reads the hand-kept heading form, with its date", () => {
    expect(changelogSection(text, "0.1.1")).toBe("### Changed\n\n- one, kept by hand");
  });
  it("answers null for a missing or empty section", () => {
    expect(changelogSection(text, "0.1.2")).toBeNull();
    expect(changelogSection(text, "0.1.0")).toBeNull();
  });
  it("reads the last section to the end of the file", () => {
    expect(changelogSection(text, "0.0.9")).toBe("- nine");
  });
});

const CLI = join(REPO_ROOT, "scripts", "release-tags.mjs");

/** Run the shipped CLI and capture its exit code and output. */
function runCli(args: string[]): { code: number; output: string } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("the CLI contract", () => {
  it("exits 2 when it is not told where to create a missing tag", () => {
    const repo = tempDir("release-tags-cli-");
    const result = runCli(["reconcile", "--repo", repo, "--notes-dir", join(repo, "notes")]);
    expect(result.code, result.output).toBe(2);
    expect(result.output).toContain("reconcile needs --target");
  });

  it("exits 2 on a workspace with no publishable package, rather than passing on nothing", () => {
    const repo = tempDir("release-tags-cli-");
    mkdirSync(join(repo, "packages"));
    const result = runCli([
      "reconcile",
      "--repo",
      repo,
      "--target",
      "3".repeat(40),
      "--notes-dir",
      join(repo, "notes"),
    ]);
    expect(result.code, result.output).toBe(2);
    expect(result.output).toContain("no publishable packages");
  });

  it("exits 2 on an unknown subcommand", () => {
    expect(runCli(["tag"]).code).toBe(2);
  });

  it("could build a fit body for every package version in this repository today", () => {
    // If a version here ever reached npm untagged, the step would build its body from this section,
    // so each one has to exist and pass the same assertion every release body passes.
    const packages = workspacePackages(REPO_ROOT);
    expect(packages.length).toBeGreaterThanOrEqual(8);
    for (const pkg of packages) {
      const built = changelogBody(pkg);
      expect(built, `${pkg.name}@${pkg.version}`).toHaveProperty("body");
    }
  });
});
