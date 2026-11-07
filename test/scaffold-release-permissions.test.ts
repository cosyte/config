/**
 * The Release caller a scaffolded parser is born with grants the token permissions the shared
 * release workflow asks for.
 *
 * A called workflow can only narrow the caller's `GITHUB_TOKEN`, never widen it, and a repository's
 * default token is `contents: read`. The shared pipeline in cosyte/.github asks for `actions: read`,
 * `contents: write`, `id-token: write` and `pull-requests: write`, so a caller with no
 * `permissions:` block is rejected at startup with no jobs and no logs. hl7, ccda and mllp grant
 * exactly these four on the same call.
 *
 * It runs the real scaffolder, so it grades the emitted file rather than the template: the template
 * is copied, and the copy is what a new repository runs.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const NAME = "probe";

/** What the shared release workflow's jobs request, and therefore what the caller must grant. */
const REQUIRED = {
  actions: "read",
  contents: "write",
  "id-token": "write",
  "pull-requests": "write",
};

let root: string;
let release: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-release-"));
  const r = spawnSync(process.execPath, [SCAFFOLDER, NAME, "--out", root], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`the scaffolder exited ${r.status}:\n${r.stdout ?? ""}${r.stderr ?? ""}`);
  }
  release = readFileSync(join(root, NAME, ".github", "workflows", "release.yml"), "utf8");
}, 180_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * The `permissions:` map of one job under `jobs:`, or `null` when the job has no such block.
 *
 * A reader of this one shape (two-space job keys, four-space job fields, six-space grants), not a
 * YAML parser: the file it reads is generated from a template this repository owns, and a shape it
 * does not recognize reads as no block, which fails the assertion below rather than passing it.
 */
function jobPermissions(workflow: string, job: string): Record<string, string> | null {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return null;
  let inBlock = false;
  const grants: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^ {0,3}\S/.test(line)) break;
    if (/^ {4}permissions:\s*(#.*)?$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      if (inBlock) break;
      continue;
    }
    const grant = /^ {6}([a-z-]+):\s*([a-z]+)\s*(#.*)?$/.exec(line);
    if (inBlock && grant) grants[grant[1]!] = grant[2]!;
  }
  return inBlock ? grants : null;
}

describe("a scaffolded parser's Release caller", () => {
  it("grants exactly the four permissions the shared release workflow asks for", () => {
    expect(release).toContain("uses: cosyte/.github/.github/workflows/release.yml@");
    expect(jobPermissions(release, "release")).toEqual(REQUIRED);
  });

  it("NEGATIVE CONTROL: the same file without the block reads as having none", () => {
    // Without this, the case above is satisfied by a reader that returns the expected map for any
    // input. The block is cut out of the emitted file, and nothing else is changed.
    const withoutBlock = release
      .split("\n")
      .filter((line) => !/^ {4}permissions:/.test(line) && !/^ {6}[a-z-]+: (read|write)/.test(line))
      .join("\n");
    expect(withoutBlock).not.toBe(release);
    expect(jobPermissions(withoutBlock, "release")).toBeNull();
  });
});
