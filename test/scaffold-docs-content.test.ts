/**
 * A scaffolded parser's docs-content passes the two docs checks its CI runs on day one: the
 * structure check (`cosyte-docs-content`, from @cosyte/script-utils) and the reference check
 * (`cosyte-docs-reference --check`, from @cosyte/process), each run here from this repository's own
 * source over the emitted tree. The template commits the generated API reference with its tokens
 * in, so the reference check is run on a name with a hyphen too: the page's heading anchors are the
 * lower-case identifier, which differs from the name only there.
 *
 * It runs the real scaffolder, because the template is copied and then substituted and formatted.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no shell form.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDocsReference } from "../packages/process/src/docs-reference.js";
import { runDocsContentCheck } from "../packages/script-utils/docs-content.js";

const REPO_ROOT = process.cwd();
const SCAFFOLDER = join(REPO_ROOT, "scripts", "scaffold-parser.mjs");
const NAMES = ["probe", "x-ray"] as const;

let root: string;

/** Collects what a check writes to one stream. */
function sink(): { write(text: string): boolean; text(): string } {
  let out = "";
  return {
    write(text: string) {
      out += text;
      return true;
    },
    text: () => out,
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-docs-content-"));
  for (const name of NAMES) {
    const r = spawnSync(process.execPath, [SCAFFOLDER, name, "--out", root], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`the scaffolder exited ${r.status}:\n${r.stderr ?? ""}`);
    // The reference generator reads the emitted tsconfig.json, which extends the shared one by
    // package name. `pnpm install` would put it here; this repository's own copy is the source.
    const tsconfig = join(root, name, "node_modules", "@cosyte", "tsconfig");
    mkdirSync(tsconfig, { recursive: true });
    cpSync(join(REPO_ROOT, "packages", "tsconfig"), tsconfig, {
      recursive: true,
      filter: (src) => !src.includes("node_modules"),
    });
  }
}, 240_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the emitted docs-content", () => {
  it("passes the structure check, with the print rule required", () => {
    const repo = join(root, "probe");
    expect(JSON.parse(readFileSync(join(repo, "cosyte-docs-content.config.json"), "utf8"))).toEqual(
      { examplePrint: { required: true } },
    );
    const stdout = sink();
    const stderr = sink();
    const code = runDocsContentCheck({ dir: repo, stdout, stderr });
    expect(code, `${stdout.text()}${stderr.text()}`).toBe(0);
    expect(stdout.text()).toContain("docs-content: OK (10 page(s) checked)");
  });

  it("NEGATIVE CONTROL: the structure check fails the same tree with a sidebar_position put back", () => {
    const repo = join(root, "probe");
    const page = join(repo, "docs-content", "intro.md");
    const original = readFileSync(page, "utf8");
    try {
      writeFileSync(
        page,
        original.replace("sidebar_label:", "sidebar_position: 1\nsidebar_label:"),
      );
      const stderr = sink();
      expect(runDocsContentCheck({ dir: repo, stdout: sink(), stderr })).toBe(1);
      expect(stderr.text()).toContain("sidebar_position");
    } finally {
      writeFileSync(page, original);
    }
  });

  it("lists docs-content/api/ in .prettierignore, so the formatter never rewrites the reference", () => {
    const ignored = readFileSync(join(root, "probe", ".prettierignore"), "utf8").split("\n");
    expect(ignored).toContain("docs-content/api/");
  });

  it.each(NAMES)(
    "carries the API reference its source generates, for the name %s",
    async (name) => {
      const stdout = sink();
      const stderr = sink();
      const code = await runDocsReference(["--check"], { cwd: join(root, name), stdout, stderr });
      expect(code, `${stdout.text()}${stderr.text()}`).toBe(0);
    },
    120_000,
  );

  it("NEGATIVE CONTROL: the reference check fails a committed page that differs", async () => {
    const page = join(root, "probe", "docs-content", "api", "README.md");
    const original = readFileSync(page, "utf8");
    try {
      writeFileSync(page, `${original}\nAn edit by hand.\n`);
      const stderr = sink();
      expect(await runDocsReference(["--check"], { cwd: join(root, "probe"), stderr })).toBe(1);
      expect(stderr.text()).toContain("README.md: differs from what the source generates");
    } finally {
      writeFileSync(page, original);
    }
  }, 120_000);
});
