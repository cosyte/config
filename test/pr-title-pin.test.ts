import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCOPED_COMMIT,
  SCOPED_REFERENCE,
  SCOPED_TITLE,
  dependabotTitles,
  updateBlocks,
} from "./support/shared-workflows.js";

/**
 * THIS REPOSITORY'S OWN PULL REQUEST TITLES, HELD TO THE SCOPED FORM.
 *
 * `.github/workflows/pr-title.yml` calls the shared title check in cosyte/.github, pinned by commit,
 * so a change to the shared rule takes effect here only when that pin moves. The rule that requires
 * a scope, `type(scope): description`, landed at `SCOPED_COMMIT`. A pin to any earlier commit
 * accepts `fix: something` and lets an unscoped subject onto main. A later bump updates the constant
 * in `test/support/shared-workflows.ts`.
 *
 * Dependabot opens pull requests here too, and its title is its commit message: `prefix` plus, with
 * `include: scope`, the `(deps)` or `(deps-dev)` scope. Without `include: scope` its titles are
 * `chore: bump ...`, which the scoped check refuses, and every Dependabot pull request goes red.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

describe("the pull request title check", () => {
  it("pins the shared workflow at the commit that requires a scope", () => {
    const uses =
      /^\s+uses: cosyte\/\.github\/\.github\/workflows\/pr-title\.yml@(\S+)(?: # (\S+))?$/m.exec(
        read(".github/workflows/pr-title.yml"),
      );
    expect(uses?.[1]).toBe(SCOPED_COMMIT);
    expect(uses?.[2]).toBe(SCOPED_REFERENCE);
  });

  it("accepts a scoped title and refuses an unscoped one, as the shared pattern does", () => {
    expect(SCOPED_TITLE.test("fix(parser): keep the escape sequence")).toBe(true);
    expect(SCOPED_TITLE.test("fix: keep the escape sequence")).toBe(false);
  });
});

describe("Dependabot's titles", () => {
  const blocks = updateBlocks(read(".github/dependabot.yml"));

  it("reads every update block", () => {
    expect(blocks.map((b) => /package-ecosystem: (\S+)/.exec(b)?.[1])).toEqual([
      "npm",
      "github-actions",
    ]);
  });

  it.each(blocks.map((b) => [/package-ecosystem: (\S+)/.exec(b)?.[1] ?? "", b]))(
    "gives the %s updates a scoped title",
    (_ecosystem, block) => {
      for (const title of dependabotTitles(block)) expect(title).toMatch(SCOPED_TITLE);
    },
  );

  it("would give an unscoped title without include: scope, so the check above does work", () => {
    const [npm = ""] = blocks;
    const unscoped = npm.replace(/\n {6}include: scope/, "");
    expect(unscoped).not.toBe(npm);
    expect(dependabotTitles(unscoped)[0]).not.toMatch(SCOPED_TITLE);
  });

  it("would give Dependabot's default title without a commit-message block", () => {
    const [npm = ""] = blocks;
    const bare = npm.replace(/\n {4}commit-message:\n(?: {6}.*\n)+/, "\n");
    expect(bare).not.toBe(npm);
    expect(dependabotTitles(bare)[0]).not.toMatch(SCOPED_TITLE);
  });
});
